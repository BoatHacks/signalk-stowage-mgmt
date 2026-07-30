const { randomUUID } = require('crypto')
const { runInTransaction } = require('../tx')

// Full-snapshot backup/restore for the inventory (locations, items,
// categories, placements). Deliberately excludes:
// - Floorplan SVG content — only each location's *mapping* (floorplan_id +
//   svg_element_id) is included, not the floorplan itself. On import, a
//   mapping only survives if that floorplan_id still exists in the
//   *target* database (floorplans are never touched by import) — this
//   makes the feature best suited to backup/restore on the same instance,
//   not migrating to a different one.
// - Attachment file contents — only metadata (filename/mime_type/size) is
//   included, for the record. Attachments are not restored on import.
// - Store Log history — an append-only audit trail, not configuration.
//
// Import is a full replace: everything in scope is wiped and replaced
// with the imported snapshot, preserving original ids (so external
// consumers of this API — see README's "Known external consumers" —
// keep working against the same item/location ids after a restore).
const SCHEMA_VERSION = 1

// Import runs as a single synchronous transaction (see runInTransaction) —
// node:sqlite has no async API, so nothing yields back to the event loop
// between rows. A payload under the router's 15MB body-size cap can still
// contain a very large number of small rows, and the whole server (a
// single-threaded Node process) would be unresponsive for the entire import.
// This caps the total row count to keep worst-case blocking bounded, rather
// than the more invasive change of splitting the write across multiple
// transactions (which would risk a partially-applied "replace").
const MAX_IMPORT_ROWS = 20000

// Detects a parent_id cycle among an array of {id, parent_id} location rows,
// treating a parent_id that isn't one of the rows' own ids as top-level
// (matching how the actual import's parent-fixup pass treats a dangling
// parent_id). Used to reject a cyclic import before it's ever written —
// locateFrom() (routes/items.js) walks the parent chain with no cycle guard
// and would otherwise loop forever on a cyclic graph.
function hasLocationCycle (locations) {
  const ids = new Set(locations.map((l) => l.id))
  const parentOf = new Map(locations.map((l) => [l.id, ids.has(l.parent_id) ? l.parent_id : null]))
  for (const loc of locations) {
    const seen = new Set()
    let cursor = loc.id
    while (cursor) {
      if (seen.has(cursor)) return true
      seen.add(cursor)
      cursor = parentOf.get(cursor)
    }
  }
  return false
}

module.exports = function registerBackupRoutes (router, getDb) {
  function db () {
    const instance = getDb()
    if (!instance) throw Object.assign(new Error('database not ready'), { statusCode: 503 })
    return instance
  }

  router.get('/export', (req, res) => {
    const categories = db().prepare('SELECT id, name, created_at FROM categories ORDER BY name').all()

    const locations = db().prepare(
      'SELECT id, name, type, parent_id, floorplan_id, svg_element_id, created_at FROM locations'
    ).all()

    const items = db().prepare(
      'SELECT id, name, actual_quantity, target_quantity, notes, location_id, thumbnail, expires_at, created_at FROM items'
    ).all()

    const categoryIdsByItem = db().prepare('SELECT item_id, category_id FROM item_categories').all()
      .reduce((acc, row) => {
        (acc[row.item_id] = acc[row.item_id] || []).push(row.category_id)
        return acc
      }, {})

    const placementsByItem = db().prepare(
      'SELECT id, item_id, location_id, quantity FROM item_placements'
    ).all().reduce((acc, row) => {
      (acc[row.item_id] = acc[row.item_id] || []).push({ id: row.id, location_id: row.location_id, quantity: row.quantity })
      return acc
    }, {})

    const attachmentsByItem = db().prepare(
      'SELECT item_id, filename, mime_type, size, uploaded_at FROM item_attachments'
    ).all().reduce((acc, row) => {
      (acc[row.item_id] = acc[row.item_id] || []).push({
        filename: row.filename, mime_type: row.mime_type, size: row.size, uploaded_at: row.uploaded_at
      })
      return acc
    }, {})

    res.json({
      schema_version: SCHEMA_VERSION,
      exported_at: new Date().toISOString(),
      categories,
      locations,
      items: items.map((item) => ({
        ...item,
        category_ids: categoryIdsByItem[item.id] || [],
        placements: placementsByItem[item.id] || [],
        attachments: attachmentsByItem[item.id] || [] // metadata only — not restored on import
      }))
    })
  })

  router.post('/import', (req, res) => {
    const payload = req.body
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: 'invalid import payload' })
    }
    if (payload.schema_version !== SCHEMA_VERSION) {
      return res.status(400).json({
        error: `unsupported schema_version (got ${JSON.stringify(payload.schema_version)}, expected ${SCHEMA_VERSION})`
      })
    }
    if (!Array.isArray(payload.categories) || !Array.isArray(payload.locations) || !Array.isArray(payload.items)) {
      return res.status(400).json({ error: 'payload must include categories, locations, and items arrays' })
    }
    if (hasLocationCycle(payload.locations)) {
      return res.status(400).json({ error: 'locations contain a parent_id cycle' })
    }
    const totalPlacements = payload.items.reduce(
      (sum, item) => sum + (Array.isArray(item.placements) ? item.placements.length : 0), 0
    )
    const totalRows = payload.categories.length + payload.locations.length + payload.items.length + totalPlacements
    if (totalRows > MAX_IMPORT_ROWS) {
      return res.status(400).json({
        error: `import payload too large (${totalRows} rows across categories/locations/items/placements, max ${MAX_IMPORT_ROWS})`
      })
    }

    const existingFloorplanIds = new Set(db().prepare('SELECT id FROM floorplans').all().map((f) => f.id))
    let droppedFloorplanMappings = 0

    try {
      runInTransaction(db(), () => {
        // Wipe everything in scope. item_placements/item_categories cascade
        // automatically when their item is deleted; floorplans, attachments,
        // and item_log are deliberately left untouched.
        db().prepare('DELETE FROM items').run()
        db().prepare('DELETE FROM locations').run()
        db().prepare('DELETE FROM categories').run()

        const insertCategory = db().prepare('INSERT INTO categories (id, name, created_at) VALUES (?, ?, ?)')
        payload.categories.forEach((c) => {
          insertCategory.run(c.id || randomUUID(), c.name, c.created_at || new Date().toISOString())
        })
        const restoredCategoryIds = new Set(payload.categories.map((c) => c.id))

        // Locations reference each other via parent_id, so insert every row
        // with parent_id NULL first (avoids needing a topological sort of
        // the input), then fix up parent_id in a second pass once every
        // row already exists.
        const insertLocation = db().prepare(
          'INSERT INTO locations (id, name, type, parent_id, floorplan_id, svg_element_id, created_at) VALUES (?, ?, ?, NULL, ?, ?, ?)'
        )
        payload.locations.forEach((loc) => {
          let floorplanId = loc.floorplan_id || null
          let svgElementId = loc.svg_element_id || null
          if (floorplanId && !existingFloorplanIds.has(floorplanId)) {
            floorplanId = null
            svgElementId = null
            droppedFloorplanMappings++
          }
          insertLocation.run(loc.id, loc.name, loc.type, floorplanId, svgElementId, loc.created_at || new Date().toISOString())
        })
        const updateParent = db().prepare('UPDATE locations SET parent_id = ? WHERE id = ?')
        const locationIds = new Set(payload.locations.map((l) => l.id))
        payload.locations.forEach((loc) => {
          if (loc.parent_id && locationIds.has(loc.parent_id)) updateParent.run(loc.parent_id, loc.id)
        })

        const insertItem = db().prepare(
          'INSERT INTO items (id, name, actual_quantity, target_quantity, notes, location_id, thumbnail, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        const insertItemCategory = db().prepare('INSERT INTO item_categories (item_id, category_id) VALUES (?, ?)')
        const insertPlacement = db().prepare('INSERT INTO item_placements (id, item_id, location_id, quantity) VALUES (?, ?, ?, ?)')

        payload.items.forEach((item) => {
          const locationId = item.location_id && locationIds.has(item.location_id) ? item.location_id : null
          insertItem.run(
            item.id, item.name, item.actual_quantity != null ? item.actual_quantity : 1,
            item.target_quantity != null ? item.target_quantity : null, item.notes || null,
            locationId, item.thumbnail || null, item.expires_at || null,
            item.created_at || new Date().toISOString()
          );
          (item.category_ids || []).forEach((categoryId) => {
            if (restoredCategoryIds.has(categoryId)) insertItemCategory.run(item.id, categoryId)
          });
          (item.placements || []).forEach((p) => {
            // location_id is nullable — a placement can legitimately be
            // "not stored anywhere". Set.has(null) is false, so that case
            // must be let through explicitly rather than only dropping
            // placements that reference a *non-null* location missing from
            // this import.
            if (p.location_id != null && !locationIds.has(p.location_id)) return
            insertPlacement.run(p.id || randomUUID(), item.id, p.location_id ?? null, p.quantity)
          })
        })
      })
    } catch (err) {
      return res.status(400).json({ error: 'import failed: ' + err.message })
    }

    res.json({
      restored: {
        categories: payload.categories.length,
        locations: payload.locations.length,
        items: payload.items.length
      },
      dropped_floorplan_mappings: droppedFloorplanMappings
    })
  })
}
