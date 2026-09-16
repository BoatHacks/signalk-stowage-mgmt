const { randomUUID } = require('crypto')
const { runInTransaction } = require('../tx')

// Full-snapshot backup/restore for the inventory (locations, items,
// categories, placements). Deliberately excludes:
// - Attachment file contents — only metadata (filename/mime_type/size) is
//   included, for the record. Attachments are not restored on import.
// - Store Log history — an append-only audit trail, not configuration.
//
// Floorplans themselves are never created or modified by import (floorplan
// *content* isn't config the same way locations/items are — it's a
// deliberately separate upload step, see README). The export does include
// each floorplan's id/name/svg_content, but only so import can *match*
// a location's floorplan_id/svg_element_id mapping against whatever
// floorplans already exist in the target database: first by id (the
// same-instance restore case), then, if that id isn't present, by exact
// svg_content match (the cross-instance migration case — upload the same
// floorplan SVG to the new server first, then import; the mapping finds
// its way back to the newly-uploaded floorplan's id even though that id
// is different from the one in the export). A mapping that matches
// neither way is dropped, not fatal.
//
// Import defaults to a full replace: everything in scope is wiped and
// replaced with the imported snapshot, preserving original ids (so external
// consumers of this API — see README's "Known external consumers" —
// keep working against the same item/location ids after a restore).
//
// `mode: "merge"` (see #26) instead adds the imported rows alongside
// whatever is already there:
// - An id from the import is kept as-is unless it collides with a row
//   already in the target database, in which case a fresh one is generated
//   and every reference to the old id (item.location_id, item.category_ids,
//   placement.location_id, location.parent_id) is remapped to match. This
//   (rather than unconditionally regenerating every id) is so a hand-built
//   import — e.g. from an external floorplan-SVG generator — can use ids
//   that intentionally match svg_element_id mappings or a previous export,
//   per issue #26's discussion.
// - Categories are matched to an existing category by exact name (they're
//   globally unique by name — see `POST /categories`'s 409) and merged into
//   it rather than creating a duplicate.
// - Locations don't have a uniqueness constraint, but two locations with
//   the same name under the same parent are almost never intentional, so a
//   colliding name is disambiguated with a " (2)", " (3)", ... suffix
//   instead of silently creating a same-named sibling.
// - A location's parent_id (and an item's location_id / a placement's
//   location_id) may point outside the import's own rows, at a location
//   already in the target database — that reference is kept as-is, so a
//   hand-built import can drop new items/locations into an existing tree
//   without re-sending its ancestors.
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

// Picks the id a merge-mode row should be inserted under: the row's own id,
// unless it's missing or already taken (by an existing row or by another row
// already resolved earlier in this same import), in which case a fresh one
// is generated. `taken` is mutated to record whichever id is chosen.
function resolveMergeId (originalId, taken) {
  if (originalId && !taken.has(originalId)) {
    taken.add(originalId)
    return originalId
  }
  let id = randomUUID()
  while (taken.has(id)) id = randomUUID()
  taken.add(id)
  return id
}

// Disambiguates `name` against the sibling names already recorded under
// `siblingKey` in `namesByGroup` (existing rows plus any already resolved
// earlier in this same import), appending " (2)", " (3)", ... on collision.
// Mutates `namesByGroup` to record whichever name is chosen.
function dedupeName (name, siblingKey, namesByGroup) {
  let names = namesByGroup.get(siblingKey)
  if (!names) {
    names = new Set()
    namesByGroup.set(siblingKey, names)
  }
  if (!names.has(name)) {
    names.add(name)
    return name
  }
  let n = 2
  while (names.has(`${name} (${n})`)) n++
  const deduped = `${name} (${n})`
  names.add(deduped)
  return deduped
}

module.exports = function registerBackupRoutes (router, getDb) {
  function db () {
    const instance = getDb()
    if (!instance) throw Object.assign(new Error('database not ready'), { statusCode: 503 })
    return instance
  }

  router.get('/export', (req, res) => {
    // Only the floorplans actually referenced by a location mapping need to
    // travel with the export — id/name/svg_content, just enough for import
    // on a different instance to find (or fail to find) a content match.
    const referencedFloorplanIds = db().prepare(
      'SELECT DISTINCT floorplan_id FROM locations WHERE floorplan_id IS NOT NULL'
    ).all().map((r) => r.floorplan_id)
    const floorplans = referencedFloorplanIds.length
      ? db().prepare(
          `SELECT id, name, svg_content FROM floorplans WHERE id IN (${referencedFloorplanIds.map(() => '?').join(',')})`
        ).all(...referencedFloorplanIds)
      : []

    const categories = db().prepare('SELECT id, name, created_at FROM categories ORDER BY name').all()

    const locations = db().prepare(
      'SELECT id, name, type, parent_id, floorplan_id, svg_element_id, created_at FROM locations'
    ).all()

    const items = db().prepare(
      'SELECT id, name, actual_quantity, target_quantity, notes, location_id, thumbnail, expires_at, acquired_date, price_paid, unit, created_at FROM items'
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
      floorplans,
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
    const mode = payload.mode === 'merge' ? 'merge' : 'replace'
    if (payload.mode !== undefined && payload.mode !== 'merge' && payload.mode !== 'replace') {
      return res.status(400).json({ error: `unsupported import mode (got ${JSON.stringify(payload.mode)}, expected "replace" or "merge")` })
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

    const existingFloorplans = db().prepare('SELECT id, svg_content FROM floorplans').all()
    const existingFloorplanIds = new Set(existingFloorplans.map((f) => f.id))
    // Only used as a same-instance-id fallback when a location's
    // floorplan_id isn't in existingFloorplanIds: maps the *old* (exported)
    // floorplan id to its svg_content, so it can be looked up against a
    // floorplan already sitting in the target database under a different id.
    const payloadFloorplanContentById = new Map(
      (Array.isArray(payload.floorplans) ? payload.floorplans : [])
        .map((f) => [f.id, f.svg_content])
    )
    const existingFloorplanIdByContent = new Map(existingFloorplans.map((f) => [f.svg_content, f.id]))
    let droppedFloorplanMappings = 0
    let remappedFloorplanMappings = 0

    // Shared by both import modes: resolves a location's floorplan_id
    // against what's actually in the target database, first by id (the
    // same-instance case), then falling back to an exact svg_content match
    // (the cross-instance migration case). Drops the mapping (not fatal)
    // when neither matches.
    function resolveFloorplanMapping (loc) {
      let floorplanId = loc.floorplan_id || null
      let svgElementId = loc.svg_element_id || null
      if (floorplanId && !existingFloorplanIds.has(floorplanId)) {
        const content = payloadFloorplanContentById.get(floorplanId)
        const matchedId = content != null ? existingFloorplanIdByContent.get(content) : undefined
        if (matchedId) {
          floorplanId = matchedId
          remappedFloorplanMappings++
        } else {
          floorplanId = null
          svgElementId = null
          droppedFloorplanMappings++
        }
      }
      return { floorplanId, svgElementId }
    }

    let result
    try {
      result = runInTransaction(db(), () => {
        return mode === 'merge' ? runMergeImport(db(), payload, resolveFloorplanMapping) : runReplaceImport(db(), payload, resolveFloorplanMapping)
      })
    } catch (err) {
      return res.status(400).json({ error: 'import failed: ' + err.message })
    }

    res.json({
      ...result,
      dropped_floorplan_mappings: droppedFloorplanMappings,
      remapped_floorplan_mappings: remappedFloorplanMappings
    })
  })
}

// Full-replace import: wipes everything in scope and reinserts the payload
// verbatim, preserving original ids. item_placements/item_categories cascade
// automatically when their item is deleted; floorplans, attachments, and
// item_log are deliberately left untouched.
function runReplaceImport (db, payload, resolveFloorplanMapping) {
  db.prepare('DELETE FROM items').run()
  db.prepare('DELETE FROM locations').run()
  db.prepare('DELETE FROM categories').run()

  const insertCategory = db.prepare('INSERT INTO categories (id, name, created_at) VALUES (?, ?, ?)')
  payload.categories.forEach((c) => {
    insertCategory.run(c.id || randomUUID(), c.name, c.created_at || new Date().toISOString())
  })
  const restoredCategoryIds = new Set(payload.categories.map((c) => c.id))

  // Locations reference each other via parent_id, so insert every row
  // with parent_id NULL first (avoids needing a topological sort of
  // the input), then fix up parent_id in a second pass once every
  // row already exists.
  const insertLocation = db.prepare(
    'INSERT INTO locations (id, name, type, parent_id, floorplan_id, svg_element_id, created_at) VALUES (?, ?, ?, NULL, ?, ?, ?)'
  )
  payload.locations.forEach((loc) => {
    const { floorplanId, svgElementId } = resolveFloorplanMapping(loc)
    insertLocation.run(loc.id, loc.name, loc.type, floorplanId, svgElementId, loc.created_at || new Date().toISOString())
  })
  const updateParent = db.prepare('UPDATE locations SET parent_id = ? WHERE id = ?')
  const locationIds = new Set(payload.locations.map((l) => l.id))
  payload.locations.forEach((loc) => {
    if (loc.parent_id && locationIds.has(loc.parent_id)) updateParent.run(loc.parent_id, loc.id)
  })

  const insertItem = db.prepare(
    'INSERT INTO items (id, name, actual_quantity, target_quantity, notes, location_id, thumbnail, expires_at, acquired_date, price_paid, unit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
  const insertItemCategory = db.prepare('INSERT INTO item_categories (item_id, category_id) VALUES (?, ?)')
  const insertPlacement = db.prepare('INSERT INTO item_placements (id, item_id, location_id, quantity) VALUES (?, ?, ?, ?)')

  payload.items.forEach((item) => {
    const locationId = item.location_id && locationIds.has(item.location_id) ? item.location_id : null
    insertItem.run(
      item.id, item.name, item.actual_quantity != null ? item.actual_quantity : 1,
      item.target_quantity != null ? item.target_quantity : null, item.notes || null,
      locationId, item.thumbnail || null, item.expires_at || null,
      item.acquired_date || null, item.price_paid != null ? item.price_paid : null,
      item.unit || null, item.created_at || new Date().toISOString()
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

  return {
    mode: 'replace',
    restored: {
      categories: payload.categories.length,
      locations: payload.locations.length,
      items: payload.items.length
    }
  }
}

// Merge/append import (#26): adds the payload's rows alongside whatever is
// already in the target database, instead of replacing it. See the block
// comment above SCHEMA_VERSION for the id-collision and name-collision
// policy this implements.
function runMergeImport (db, payload, resolveFloorplanMapping) {
  // --- Categories: matched to an existing category by exact name (merged
  // into it, not duplicated — names are globally unique, see POST
  // /categories's 409); otherwise inserted, keeping the payload's id unless
  // it collides.
  const existingCategories = db.prepare('SELECT id, name FROM categories').all()
  const categoryIdByName = new Map(existingCategories.map((c) => [c.name, c.id]))
  const takenCategoryIds = new Set(existingCategories.map((c) => c.id))
  const categoryIdMap = new Map() // payload category id -> final id in this database
  const insertCategory = db.prepare('INSERT INTO categories (id, name, created_at) VALUES (?, ?, ?)')
  let categoriesAdded = 0
  let categoriesMatchedExisting = 0
  payload.categories.forEach((c) => {
    const name = (c.name || '').trim()
    const existingId = categoryIdByName.get(name)
    if (existingId) {
      categoryIdMap.set(c.id, existingId)
      categoriesMatchedExisting++
      return
    }
    const finalId = resolveMergeId(c.id, takenCategoryIds)
    insertCategory.run(finalId, name, c.created_at || new Date().toISOString())
    categoryIdMap.set(c.id, finalId)
    categoryIdByName.set(name, finalId) // so duplicate names within the same payload also merge
    categoriesAdded++
  })

  // --- Locations: keep the payload's id unless it collides; a parent_id
  // pointing at another row in this same payload is remapped to that row's
  // final id, a parent_id pointing at a location already in the target
  // database is kept as-is (importing into an existing tree), anything else
  // is dropped to top-level. A name colliding with an existing sibling (or
  // an earlier-resolved one from this same payload) gets a " (2)" suffix.
  const existingLocations = db.prepare('SELECT id, name, parent_id FROM locations').all()
  const existingLocationIds = new Set(existingLocations.map((l) => l.id))
  const takenLocationIds = new Set(existingLocationIds)
  const locationIdMap = new Map() // payload location id -> final id in this database
  payload.locations.forEach((loc) => {
    locationIdMap.set(loc.id, resolveMergeId(loc.id, takenLocationIds))
  })

  const siblingNamesByParent = new Map()
  existingLocations.forEach((l) => {
    const key = l.parent_id || 'null'
    if (!siblingNamesByParent.has(key)) siblingNamesByParent.set(key, new Set())
    siblingNamesByParent.get(key).add(l.name)
  })

  function resolveMergeParent (loc) {
    if (!loc.parent_id) return null
    if (locationIdMap.has(loc.parent_id)) return locationIdMap.get(loc.parent_id)
    if (existingLocationIds.has(loc.parent_id)) return loc.parent_id
    return null
  }

  const resolvedLocations = payload.locations.map((loc) => {
    const finalParentId = resolveMergeParent(loc)
    const finalName = dedupeName(loc.name, finalParentId || 'null', siblingNamesByParent)
    const { floorplanId, svgElementId } = resolveFloorplanMapping(loc)
    return { loc, finalId: locationIdMap.get(loc.id), finalParentId, finalName, floorplanId, svgElementId }
  })
  let locationsRenamed = 0

  const insertLocation = db.prepare(
    'INSERT INTO locations (id, name, type, parent_id, floorplan_id, svg_element_id, created_at) VALUES (?, ?, ?, NULL, ?, ?, ?)'
  )
  resolvedLocations.forEach((r) => {
    if (r.finalName !== r.loc.name) locationsRenamed++
    insertLocation.run(r.finalId, r.finalName, r.loc.type, r.floorplanId, r.svgElementId, r.loc.created_at || new Date().toISOString())
  })
  const updateParent = db.prepare('UPDATE locations SET parent_id = ? WHERE id = ?')
  resolvedLocations.forEach((r) => {
    if (r.finalParentId) updateParent.run(r.finalParentId, r.finalId)
  })

  // --- Items: no uniqueness policy to apply (item names were never unique,
  // even under replace mode) — just keep the payload's id unless it
  // collides, and remap location_id/category_ids/placements to match
  // whatever categories/locations ended up at.
  const existingItemIds = new Set(db.prepare('SELECT id FROM items').all().map((r) => r.id))
  const takenItemIds = new Set(existingItemIds)
  const existingPlacementIds = new Set(db.prepare('SELECT id FROM item_placements').all().map((r) => r.id))
  const takenPlacementIds = new Set(existingPlacementIds)

  function resolveMergeLocationRef (locationId) {
    if (locationId == null) return null
    if (locationIdMap.has(locationId)) return locationIdMap.get(locationId)
    if (existingLocationIds.has(locationId)) return locationId
    return null
  }

  const insertItem = db.prepare(
    'INSERT INTO items (id, name, actual_quantity, target_quantity, notes, location_id, thumbnail, expires_at, acquired_date, price_paid, unit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
  const insertItemCategory = db.prepare('INSERT INTO item_categories (item_id, category_id) VALUES (?, ?)')
  const insertPlacement = db.prepare('INSERT INTO item_placements (id, item_id, location_id, quantity) VALUES (?, ?, ?, ?)')

  payload.items.forEach((item) => {
    const finalItemId = resolveMergeId(item.id, takenItemIds)
    const locationId = resolveMergeLocationRef(item.location_id)
    insertItem.run(
      finalItemId, item.name, item.actual_quantity != null ? item.actual_quantity : 1,
      item.target_quantity != null ? item.target_quantity : null, item.notes || null,
      locationId, item.thumbnail || null, item.expires_at || null,
      item.acquired_date || null, item.price_paid != null ? item.price_paid : null,
      item.unit || null, item.created_at || new Date().toISOString()
    );
    (item.category_ids || []).forEach((categoryId) => {
      const finalCategoryId = categoryIdMap.get(categoryId)
      if (finalCategoryId) insertItemCategory.run(finalItemId, finalCategoryId)
    });
    (item.placements || []).forEach((p) => {
      // Unlike replace mode (which drops a placement outright when its
      // location_id isn't among the imported locations), a dangling
      // reference here falls back to "not stored anywhere" (location_id
      // NULL) rather than dropping the row — merge mode can't assume a
      // referenced location is missing from the *target*, only that it
      // wasn't resolvable, and silently losing quantity would leave
      // actual_quantity and the sum of placements inconsistent.
      const placementLocationId = resolveMergeLocationRef(p.location_id)
      const finalPlacementId = resolveMergeId(p.id, takenPlacementIds)
      insertPlacement.run(finalPlacementId, finalItemId, placementLocationId, p.quantity)
    })
  })

  return {
    mode: 'merge',
    added: {
      categories: categoriesAdded,
      locations: payload.locations.length,
      items: payload.items.length
    },
    categories_matched_existing: categoriesMatchedExisting,
    locations_renamed: locationsRenamed
  }
}
