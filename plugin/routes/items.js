const { randomUUID } = require('crypto')
const { runInTransaction } = require('../tx')
const { logItemEvent, logSplitEvent } = require('../itemLog')

module.exports = function registerItemRoutes (router, getDb) {
  function db () {
    const instance = getDb()
    if (!instance) throw Object.assign(new Error('database not ready'), { statusCode: 503 })
    return instance
  }

  // Attaches a `categories` array (each { id, name }) to one or more item rows.
  function withCategories (itemOrItems) {
    const items = Array.isArray(itemOrItems) ? itemOrItems : [itemOrItems]
    if (items.length === 0) return itemOrItems
    const placeholders = items.map(() => '?').join(',')
    const rows = db().prepare(`
      SELECT ic.item_id as item_id, c.id as id, c.name as name
      FROM item_categories ic
      JOIN categories c ON c.id = ic.category_id
      WHERE ic.item_id IN (${placeholders})
      ORDER BY c.name
    `).all(...items.map(i => i.id))
    const byItem = new Map()
    for (const row of rows) {
      if (!byItem.has(row.item_id)) byItem.set(row.item_id, [])
      byItem.get(row.item_id).push({ id: row.id, name: row.name })
    }
    for (const item of items) item.categories = byItem.get(item.id) || []
    return itemOrItems
  }

  // Attaches a `placements` array to one or more item rows — empty for a
  // normal (unsplit) item, or one entry per location its stock is split
  // across ({ id, location_id, location_name, quantity }).
  function withPlacements (itemOrItems) {
    const items = Array.isArray(itemOrItems) ? itemOrItems : [itemOrItems]
    if (items.length === 0) return itemOrItems
    const placeholders = items.map(() => '?').join(',')
    const rows = db().prepare(`
      SELECT p.id as id, p.item_id as item_id, p.location_id as location_id,
             l.name as location_name, p.quantity as quantity
      FROM item_placements p
      LEFT JOIN locations l ON l.id = p.location_id
      WHERE p.item_id IN (${placeholders})
      ORDER BY l.name
    `).all(...items.map(i => i.id))
    const byItem = new Map()
    for (const row of rows) {
      if (!byItem.has(row.item_id)) byItem.set(row.item_id, [])
      byItem.get(row.item_id).push({
        id: row.id, location_id: row.location_id, location_name: row.location_name, quantity: row.quantity
      })
    }
    for (const item of items) item.placements = byItem.get(item.id) || []
    return itemOrItems
  }

  function withDetails (itemOrItems) {
    return withPlacements(withCategories(itemOrItems))
  }

  function getItemOr404 (id, res) {
    const item = db().prepare('SELECT * FROM items WHERE id = ?').get(id)
    if (!item) {
      res.status(404).json({ error: 'not found' })
      return null
    }
    return item
  }

  function getPlacements (itemId) {
    return db().prepare('SELECT * FROM item_placements WHERE item_id = ?').all(itemId)
  }

  router.get('/items', (req, res) => {
    const items = db().prepare('SELECT * FROM items ORDER BY name').all()
    res.json(withDetails(items))
  })

  router.post('/items', (req, res) => {
    const {
      name, actual_quantity: actualQuantity, target_quantity: targetQuantity, notes,
      location_id: locationId, category_ids: categoryIds, note, expires_at: expiresAt
    } = req.body || {}
    if (!name) return res.status(400).json({ error: 'name required' })
    if (locationId) {
      const loc = db().prepare('SELECT id FROM locations WHERE id = ?').get(locationId)
      if (!loc) return res.status(400).json({ error: 'location_id does not exist' })
    }
    const ids = Array.isArray(categoryIds) ? categoryIds : []
    for (const catId of ids) {
      if (!db().prepare('SELECT id FROM categories WHERE id = ?').get(catId)) {
        return res.status(400).json({ error: `category_id ${catId} does not exist` })
      }
    }
    const id = randomUUID()
    const startingQuantity = actualQuantity || 1
    runInTransaction(db(), () => {
      db().prepare(
        'INSERT INTO items (id, name, actual_quantity, target_quantity, notes, location_id, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(id, name, startingQuantity, targetQuantity ?? null, notes || null, locationId || null, expiresAt || null)
      const link = db().prepare('INSERT INTO item_categories (item_id, category_id) VALUES (?, ?)')
      for (const catId of ids) link.run(id, catId)
      logItemEvent(db(), { itemId: id, itemName: name, event: 'created', oldValue: 0, newValue: startingQuantity, note })
    })
    res.status(201).json(withDetails(db().prepare('SELECT * FROM items WHERE id = ?').get(id)))
  })

  router.patch('/items/:id', (req, res) => {
    const item = getItemOr404(req.params.id, res)
    if (!item) return
    const body = req.body || {}
    const { name, actual_quantity: actualQuantity, note } = body
    const hasTargetQuantity = Object.prototype.hasOwnProperty.call(body, 'target_quantity')
    const hasNotes = Object.prototype.hasOwnProperty.call(body, 'notes')
    const hasExpiresAt = Object.prototype.hasOwnProperty.call(body, 'expires_at')
    const newTargetQuantity = hasTargetQuantity ? (body.target_quantity ?? null) : null

    if (actualQuantity != null && getPlacements(item.id).length > 0) {
      return res.status(400).json({
        error: 'this item is split across multiple locations — use POST /items/:id/split to change its quantity/allocation'
      })
    }

    runInTransaction(db(), () => {
      db().prepare(
        `UPDATE items SET
          name = COALESCE(?, name),
          actual_quantity = COALESCE(?, actual_quantity),
          target_quantity = CASE WHEN ? = 1 THEN ? ELSE target_quantity END,
          notes = CASE WHEN ? = 1 THEN ? ELSE notes END,
          expires_at = CASE WHEN ? = 1 THEN ? ELSE expires_at END
         WHERE id = ?`
      ).run(
        name ?? null,
        actualQuantity ?? null,
        hasTargetQuantity ? 1 : 0, newTargetQuantity,
        hasNotes ? 1 : 0, hasNotes ? (body.notes ?? null) : null,
        hasExpiresAt ? 1 : 0, hasExpiresAt ? (body.expires_at ?? null) : null,
        item.id
      )

      const logName = name || item.name
      if (actualQuantity != null && actualQuantity !== item.actual_quantity) {
        logItemEvent(db(), {
          itemId: item.id, itemName: logName, event: 'actual_quantity',
          oldValue: item.actual_quantity, newValue: actualQuantity, note
        })
      }
      if (hasTargetQuantity && newTargetQuantity !== item.target_quantity) {
        logItemEvent(db(), {
          itemId: item.id, itemName: logName, event: 'target_quantity',
          oldValue: item.target_quantity, newValue: newTargetQuantity, note
        })
      }
      // expires_at changes are deliberately not logged to item_log.
    })

    res.json(withDetails(db().prepare('SELECT * FROM items WHERE id = ?').get(item.id)))
  })

  // Sets or clears an item's thumbnail. Body: { thumbnail } — a data URI
  // string, or null/omitted to remove the thumbnail entirely.
  router.patch('/items/:id/thumbnail', (req, res) => {
    const item = getItemOr404(req.params.id, res)
    if (!item) return
    const { thumbnail } = req.body || {}
    if (thumbnail && typeof thumbnail !== 'string') {
      return res.status(400).json({ error: 'thumbnail must be a string (data URI) or null' })
    }
    db().prepare('UPDATE items SET thumbnail = ? WHERE id = ?').run(thumbnail || null, item.id)
    res.json(withDetails(db().prepare('SELECT * FROM items WHERE id = ?').get(item.id)))
  })

  // Add one category to an item. Body: { category_id }
  router.post('/items/:id/categories', (req, res) => {
    const item = getItemOr404(req.params.id, res)
    if (!item) return
    const { category_id: categoryId } = req.body || {}
    const cat = categoryId && db().prepare('SELECT * FROM categories WHERE id = ?').get(categoryId)
    if (!cat) return res.status(400).json({ error: 'category_id does not exist' })
    db().prepare('INSERT OR IGNORE INTO item_categories (item_id, category_id) VALUES (?, ?)').run(item.id, cat.id)
    res.status(201).json(withDetails(db().prepare('SELECT * FROM items WHERE id = ?').get(item.id)))
  })

  // Remove one category from an item.
  router.delete('/items/:id/categories/:categoryId', (req, res) => {
    const item = getItemOr404(req.params.id, res)
    if (!item) return
    db().prepare('DELETE FROM item_categories WHERE item_id = ? AND category_id = ?').run(item.id, req.params.categoryId)
    res.json(withDetails(db().prepare('SELECT * FROM items WHERE id = ?').get(item.id)))
  })

  router.patch('/items/:id/move', (req, res) => {
    const { location_id: locationId } = req.body || {}
    const item = getItemOr404(req.params.id, res)
    if (!item) return
    if (getPlacements(item.id).length > 0) {
      return res.status(400).json({
        error: 'this item is split across multiple locations — move a specific placement via PATCH /items/:id/placements/:placementId/move instead'
      })
    }
    if (locationId) {
      const loc = db().prepare('SELECT id FROM locations WHERE id = ?').get(locationId)
      if (!loc) return res.status(400).json({ error: 'location_id does not exist' })
    }
    db().prepare('UPDATE items SET location_id = ? WHERE id = ?').run(locationId || null, item.id)
    res.json(withDetails(db().prepare('SELECT * FROM items WHERE id = ?').get(item.id)))
  })

  // Moves one placement of a split item to a different location. Silent
  // (not logged), same as an ordinary item move — only the act of splitting
  // itself is logged, not subsequently relocating a placement.
  router.patch('/items/:id/placements/:placementId/move', (req, res) => {
    const { location_id: locationId } = req.body || {}
    const item = getItemOr404(req.params.id, res)
    if (!item) return
    const placement = db().prepare('SELECT * FROM item_placements WHERE id = ? AND item_id = ?').get(req.params.placementId, item.id)
    if (!placement) return res.status(404).json({ error: 'placement not found' })
    if (locationId) {
      const loc = db().prepare('SELECT id FROM locations WHERE id = ?').get(locationId)
      if (!loc) return res.status(400).json({ error: 'location_id does not exist' })
    }
    if ((locationId || null) === placement.location_id) {
      return res.json(withDetails(db().prepare('SELECT * FROM items WHERE id = ?').get(item.id)))
    }
    runInTransaction(db(), () => {
      // Merge into an existing placement at the destination, if there is one.
      const existing = db().prepare(
        'SELECT * FROM item_placements WHERE item_id = ? AND location_id IS ? AND id != ?'
      ).get(item.id, locationId || null, placement.id)
      if (existing) {
        db().prepare('UPDATE item_placements SET quantity = quantity + ? WHERE id = ?').run(placement.quantity, existing.id)
        db().prepare('DELETE FROM item_placements WHERE id = ?').run(placement.id)
      } else {
        db().prepare('UPDATE item_placements SET location_id = ? WHERE id = ?').run(locationId || null, placement.id)
      }
      collapseIfSingleLocation(item.id)
    })
    res.json(withDetails(db().prepare('SELECT * FROM items WHERE id = ?').get(item.id)))
  })

  // Sets one placement's quantity directly — the split-item equivalent of
  // PATCH /items/:id { actual_quantity }. The item's overall actual_quantity
  // is kept in sync (it's always the sum of its placements) and the change
  // is logged as an ordinary 'actual_quantity' event, exactly like editing a
  // normal item's quantity — this is a real stock change (found/used more),
  // not a reallocation between locations, so it deliberately isn't a 'split'
  // event. Setting a placement to 0 removes it; if that leaves only one
  // placement, the item automatically reverts to the plain representation.
  router.patch('/items/:id/placements/:placementId', (req, res) => {
    const item = getItemOr404(req.params.id, res)
    if (!item) return
    const placement = db().prepare('SELECT * FROM item_placements WHERE id = ? AND item_id = ?').get(req.params.placementId, item.id)
    if (!placement) return res.status(404).json({ error: 'placement not found' })
    const { quantity, note } = req.body || {}
    const newQuantity = parseInt(quantity, 10)
    if (!Number.isInteger(newQuantity) || newQuantity < 0) {
      return res.status(400).json({ error: 'quantity must be a non-negative integer' })
    }

    const oldTotal = item.actual_quantity
    const newTotal = oldTotal + (newQuantity - placement.quantity)

    runInTransaction(db(), () => {
      if (newQuantity === 0) {
        db().prepare('DELETE FROM item_placements WHERE id = ?').run(placement.id)
      } else {
        db().prepare('UPDATE item_placements SET quantity = ? WHERE id = ?').run(newQuantity, placement.id)
      }
      db().prepare('UPDATE items SET actual_quantity = ? WHERE id = ?').run(newTotal, item.id)
      collapseIfSingleLocation(item.id)
      if (newTotal !== oldTotal) {
        logItemEvent(db(), { itemId: item.id, itemName: item.name, event: 'actual_quantity', oldValue: oldTotal, newValue: newTotal, note })
      }
    })

    res.json(withDetails(db().prepare('SELECT * FROM items WHERE id = ?').get(item.id)))
  })

  router.get('/items/:id/placements', (req, res) => {
    const item = getItemOr404(req.params.id, res)
    if (!item) return
    res.json(withPlacements(item).placements)
  })

  // Moves `quantity` units of an item from one location to another,
  // splitting it across locations if it wasn't already. from/to may be
  // null ("no location"). This is the only way to change quantity or
  // location for an item once it has placements.
  router.post('/items/:id/split', (req, res) => {
    const item = getItemOr404(req.params.id, res)
    if (!item) return
    const { from_location_id: fromLocationId, to_location_id: toLocationId, quantity, note } = req.body || {}

    const qty = parseInt(quantity, 10)
    if (!Number.isInteger(qty) || qty <= 0) {
      return res.status(400).json({ error: 'quantity must be a positive integer' })
    }
    if ((fromLocationId || null) === (toLocationId || null)) {
      return res.status(400).json({ error: 'from_location_id and to_location_id must be different' })
    }
    for (const locId of [fromLocationId, toLocationId]) {
      if (locId && !db().prepare('SELECT id FROM locations WHERE id = ?').get(locId)) {
        return res.status(400).json({ error: `location_id ${locId} does not exist` })
      }
    }

    const placements = getPlacements(item.id)
    let sourceQuantity
    let sourcePlacementId = null
    if (placements.length === 0) {
      // Not split yet — the only valid source is the item's current location.
      if ((fromLocationId || null) !== (item.location_id || null)) {
        return res.status(400).json({ error: 'from_location_id does not match where this item currently is' })
      }
      sourceQuantity = item.actual_quantity
    } else {
      const sourcePlacement = placements.find(p => (p.location_id || null) === (fromLocationId || null))
      if (!sourcePlacement) return res.status(400).json({ error: 'no stock of this item at from_location_id' })
      sourceQuantity = sourcePlacement.quantity
      sourcePlacementId = sourcePlacement.id
    }
    if (qty > sourceQuantity) {
      return res.status(400).json({ error: `only ${sourceQuantity} available at from_location_id` })
    }

    runInTransaction(db(), () => {
      if (placements.length === 0) {
        // First split: materialize placements for the remainder (if any)
        // and the destination, then detach the item's own location_id.
        const remaining = sourceQuantity - qty
        if (remaining > 0) {
          db().prepare('INSERT INTO item_placements (id, item_id, location_id, quantity) VALUES (?, ?, ?, ?)')
            .run(randomUUID(), item.id, item.location_id || null, remaining)
        }
        db().prepare('INSERT INTO item_placements (id, item_id, location_id, quantity) VALUES (?, ?, ?, ?)')
          .run(randomUUID(), item.id, toLocationId || null, qty)
        db().prepare('UPDATE items SET location_id = NULL WHERE id = ?').run(item.id)
      } else {
        if (qty === sourceQuantity) {
          db().prepare('DELETE FROM item_placements WHERE id = ?').run(sourcePlacementId)
        } else {
          db().prepare('UPDATE item_placements SET quantity = quantity - ? WHERE id = ?').run(qty, sourcePlacementId)
        }
        const destPlacement = db().prepare(
          'SELECT * FROM item_placements WHERE item_id = ? AND location_id IS ?'
        ).get(item.id, toLocationId || null)
        if (destPlacement) {
          db().prepare('UPDATE item_placements SET quantity = quantity + ? WHERE id = ?').run(qty, destPlacement.id)
        } else {
          db().prepare('INSERT INTO item_placements (id, item_id, location_id, quantity) VALUES (?, ?, ?, ?)')
            .run(randomUUID(), item.id, toLocationId || null, qty)
        }
      }

      collapseIfSingleLocation(item.id)

      const nameOf = (locId) => locId ? (db().prepare('SELECT name FROM locations WHERE id = ?').get(locId) || {}).name || null : null
      logSplitEvent(db(), {
        itemId: item.id, itemName: item.name,
        fromLocationId: fromLocationId || null, fromLocationName: nameOf(fromLocationId),
        toLocationId: toLocationId || null, toLocationName: nameOf(toLocationId),
        quantity: qty, note
      })
    })

    res.json(withDetails(db().prepare('SELECT * FROM items WHERE id = ?').get(item.id)))
  })

  // If an item's placements have collapsed down to a single location (e.g.
  // after moving everything back together), fold that back into the item's
  // own location_id/actual_quantity and remove the now-redundant placement
  // rows, restoring the plain (unsplit) representation.
  function collapseIfSingleLocation (itemId) {
    const placements = getPlacements(itemId)
    if (placements.length !== 1) return
    const only = placements[0]
    db().prepare('UPDATE items SET location_id = ?, actual_quantity = ? WHERE id = ?')
      .run(only.location_id, only.quantity, itemId)
    db().prepare('DELETE FROM item_placements WHERE item_id = ?').run(itemId)
  }

  router.delete('/items/:id', (req, res) => {
    const item = getItemOr404(req.params.id, res)
    if (!item) return
    runInTransaction(db(), () => {
      logItemEvent(db(), {
        itemId: item.id, itemName: item.name, event: 'deleted',
        oldValue: item.actual_quantity, newValue: 0, note: null
      })
      db().prepare('DELETE FROM items WHERE id = ?').run(item.id)
    })
    res.status(204).end()
  })

  // Walks the location chain upward from the item until it finds a storage
  // space that has been mapped to an SVG area, so the frontend knows which
  // element to blink. Works no matter how many containers the item is nested in.
  // Walks the location chain upward from a starting location until it finds
  // a storage space that's been mapped to an SVG area. Shared by the plain
  // and split-item locate logic below.
  function locateFrom (locationId) {
    const path = []
    let cursor = locationId ? db().prepare('SELECT * FROM locations WHERE id = ?').get(locationId) : null
    while (cursor) {
      path.push({ id: cursor.id, name: cursor.name, type: cursor.type })
      if (cursor.type === 'storage_space' && cursor.floorplan_id && cursor.svg_element_id) {
        return {
          path: path.slice().reverse(),
          floorplan_id: cursor.floorplan_id,
          svg_element_id: cursor.svg_element_id,
          storage_space: { id: cursor.id, name: cursor.name }
        }
      }
      cursor = cursor.parent_id ? db().prepare('SELECT * FROM locations WHERE id = ?').get(cursor.parent_id) : null
    }
    return { path: path.reverse() }
  }

  router.get('/items/:id/locate', (req, res) => {
    const item = getItemOr404(req.params.id, res)
    if (!item) return
    const placements = getPlacements(item.id)

    if (placements.length > 0) {
      // Split item: locate every placement independently (skipping ones
      // with no location at all) — the frontend blinks every match found.
      const matches = placements
        .filter(p => p.location_id)
        .map(p => {
          const result = locateFrom(p.location_id)
          return result.floorplan_id ? Object.assign({ placement_id: p.id, quantity: p.quantity }, result) : null
        })
        .filter(Boolean)
      if (!matches.length) {
        return res.status(404).json({ error: 'no mapped storage space found for any placement of this split item' })
      }
      return res.json({ item_id: item.id, split: true, matches })
    }

    if (!item.location_id) return res.status(404).json({ error: 'item has no location set' })
    const result = locateFrom(item.location_id)
    if (!result.floorplan_id) {
      return res.status(404).json({ error: 'no mapped storage space found in this item\'s location chain', path: result.path })
    }
    res.json(Object.assign({ item_id: item.id }, result))
  })
}
