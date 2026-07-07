const { randomUUID } = require('crypto')

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

  function getItemOr404 (id, res) {
    const item = db().prepare('SELECT * FROM items WHERE id = ?').get(id)
    if (!item) {
      res.status(404).json({ error: 'not found' })
      return null
    }
    return item
  }

  router.get('/items', (req, res) => {
    const items = db().prepare('SELECT * FROM items ORDER BY name').all()
    res.json(withCategories(items))
  })

  router.post('/items', (req, res) => {
    const {
      name, actual_quantity: actualQuantity, target_quantity: targetQuantity, notes,
      location_id: locationId, category_ids: categoryIds
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
    const create = db().transaction(() => {
      db().prepare(
        'INSERT INTO items (id, name, actual_quantity, target_quantity, notes, location_id) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(id, name, actualQuantity || 1, targetQuantity ?? null, notes || null, locationId || null)
      const link = db().prepare('INSERT INTO item_categories (item_id, category_id) VALUES (?, ?)')
      for (const catId of ids) link.run(id, catId)
    })
    create()
    res.status(201).json(withCategories(db().prepare('SELECT * FROM items WHERE id = ?').get(id)))
  })

  router.patch('/items/:id', (req, res) => {
    const item = getItemOr404(req.params.id, res)
    if (!item) return
    const body = req.body || {}
    const { name, actual_quantity: actualQuantity } = body
    const hasTargetQuantity = Object.prototype.hasOwnProperty.call(body, 'target_quantity')
    const hasNotes = Object.prototype.hasOwnProperty.call(body, 'notes')
    db().prepare(
      `UPDATE items SET
        name = COALESCE(?, name),
        actual_quantity = COALESCE(?, actual_quantity),
        target_quantity = CASE WHEN ? = 1 THEN ? ELSE target_quantity END,
        notes = CASE WHEN ? = 1 THEN ? ELSE notes END
       WHERE id = ?`
    ).run(
      name ?? null,
      actualQuantity ?? null,
      hasTargetQuantity ? 1 : 0, hasTargetQuantity ? (body.target_quantity ?? null) : null,
      hasNotes ? 1 : 0, hasNotes ? (body.notes ?? null) : null,
      item.id
    )
    res.json(withCategories(db().prepare('SELECT * FROM items WHERE id = ?').get(item.id)))
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
    res.json(withCategories(db().prepare('SELECT * FROM items WHERE id = ?').get(item.id)))
  })

  // Add one category to an item. Body: { category_id }
  router.post('/items/:id/categories', (req, res) => {
    const item = getItemOr404(req.params.id, res)
    if (!item) return
    const { category_id: categoryId } = req.body || {}
    const cat = categoryId && db().prepare('SELECT * FROM categories WHERE id = ?').get(categoryId)
    if (!cat) return res.status(400).json({ error: 'category_id does not exist' })
    db().prepare('INSERT OR IGNORE INTO item_categories (item_id, category_id) VALUES (?, ?)').run(item.id, cat.id)
    res.status(201).json(withCategories(db().prepare('SELECT * FROM items WHERE id = ?').get(item.id)))
  })

  // Remove one category from an item.
  router.delete('/items/:id/categories/:categoryId', (req, res) => {
    const item = getItemOr404(req.params.id, res)
    if (!item) return
    db().prepare('DELETE FROM item_categories WHERE item_id = ? AND category_id = ?').run(item.id, req.params.categoryId)
    res.json(withCategories(db().prepare('SELECT * FROM items WHERE id = ?').get(item.id)))
  })

  router.patch('/items/:id/move', (req, res) => {
    const { location_id: locationId } = req.body || {}
    const item = getItemOr404(req.params.id, res)
    if (!item) return
    if (locationId) {
      const loc = db().prepare('SELECT id FROM locations WHERE id = ?').get(locationId)
      if (!loc) return res.status(400).json({ error: 'location_id does not exist' })
    }
    db().prepare('UPDATE items SET location_id = ? WHERE id = ?').run(locationId || null, item.id)
    res.json(withCategories(db().prepare('SELECT * FROM items WHERE id = ?').get(item.id)))
  })

  router.delete('/items/:id', (req, res) => {
    const item = getItemOr404(req.params.id, res)
    if (!item) return
    db().prepare('DELETE FROM items WHERE id = ?').run(item.id)
    res.status(204).end()
  })

  // Walks the location chain upward from the item until it finds a storage
  // space that has been mapped to an SVG area, so the frontend knows which
  // element to blink. Works no matter how many containers the item is nested in.
  router.get('/items/:id/locate', (req, res) => {
    const item = getItemOr404(req.params.id, res)
    if (!item) return
    if (!item.location_id) return res.status(404).json({ error: "item has no location set" })

    const path = []
    let cursor = db().prepare('SELECT * FROM locations WHERE id = ?').get(item.location_id)
    while (cursor) {
      path.push({ id: cursor.id, name: cursor.name, type: cursor.type })
      if (cursor.type === 'storage_space' && cursor.floorplan_id && cursor.svg_element_id) {
        return res.json({
          item_id: item.id,
          path: path.reverse(),
          floorplan_id: cursor.floorplan_id,
          svg_element_id: cursor.svg_element_id,
          storage_space: { id: cursor.id, name: cursor.name }
        })
      }
      cursor = cursor.parent_id ? db().prepare('SELECT * FROM locations WHERE id = ?').get(cursor.parent_id) : null
    }
    res.status(404).json({
      error: 'no mapped storage space found in this item\'s location chain',
      path: path.reverse()
    })
  })
}
