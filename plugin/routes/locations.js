const { randomUUID } = require('crypto')

module.exports = function registerLocationRoutes (router, getDb) {
  function db () {
    const instance = getDb()
    if (!instance) throw Object.assign(new Error('database not ready'), { statusCode: 503 })
    return instance
  }

  router.get('/locations', (req, res) => {
    res.json(db().prepare('SELECT * FROM locations ORDER BY name').all())
  })

  router.post('/locations', (req, res) => {
    const { name, type, parent_id: parentId } = req.body || {}
    if (!name || !['storage_space', 'container'].includes(type)) {
      return res.status(400).json({ error: 'name and a valid type (storage_space|container) are required' })
    }
    if (parentId) {
      const parent = db().prepare('SELECT id FROM locations WHERE id = ?').get(parentId)
      if (!parent) return res.status(400).json({ error: 'parent_id does not exist' })
    }
    const id = randomUUID()
    db().prepare('INSERT INTO locations (id, name, type, parent_id) VALUES (?, ?, ?, ?)')
      .run(id, name, type, parentId || null)
    res.status(201).json(db().prepare('SELECT * FROM locations WHERE id = ?').get(id))
  })

  router.patch('/locations/:id', (req, res) => {
    const loc = db().prepare('SELECT * FROM locations WHERE id = ?').get(req.params.id)
    if (!loc) return res.status(404).json({ error: 'not found' })
    const { name } = req.body || {}
    if (name) db().prepare('UPDATE locations SET name = ? WHERE id = ?').run(name, loc.id)
    res.json(db().prepare('SELECT * FROM locations WHERE id = ?').get(loc.id))
  })

  // Re-parent a container under another container or storage space,
  // or re-home a storage space (parent_id may be null to make it top-level).
  router.patch('/locations/:id/move', (req, res) => {
    const { parent_id: parentId } = req.body || {}
    const loc = db().prepare('SELECT * FROM locations WHERE id = ?').get(req.params.id)
    if (!loc) return res.status(404).json({ error: 'not found' })

    if (parentId) {
      const parent = db().prepare('SELECT * FROM locations WHERE id = ?').get(parentId)
      if (!parent) return res.status(400).json({ error: 'parent_id does not exist' })
      if (parentId === loc.id) return res.status(400).json({ error: 'a location cannot be its own parent' })

      // Walk up from the proposed parent to make sure we never loop back to `loc`.
      let cursor = parent
      while (cursor) {
        if (cursor.id === loc.id) return res.status(400).json({ error: 'move would create a cycle' })
        cursor = cursor.parent_id ? db().prepare('SELECT * FROM locations WHERE id = ?').get(cursor.parent_id) : null
      }
    }
    db().prepare('UPDATE locations SET parent_id = ? WHERE id = ?').run(parentId || null, loc.id)
    res.json(db().prepare('SELECT * FROM locations WHERE id = ?').get(loc.id))
  })

  // Assign or clear which SVG element (on which floorplan) represents this storage space.
  router.patch('/locations/:id/svg-mapping', (req, res) => {
    const { floorplan_id: floorplanId, svg_element_id: svgElementId } = req.body || {}
    const loc = db().prepare('SELECT * FROM locations WHERE id = ?').get(req.params.id)
    if (!loc) return res.status(404).json({ error: 'not found' })
    if (loc.type !== 'storage_space') {
      return res.status(400).json({ error: 'only storage_space locations can be mapped to an SVG area' })
    }
    if (floorplanId) {
      const fp = db().prepare('SELECT id FROM floorplans WHERE id = ?').get(floorplanId)
      if (!fp) return res.status(400).json({ error: 'floorplan_id does not exist' })
    }
    db().prepare('UPDATE locations SET floorplan_id = ?, svg_element_id = ? WHERE id = ?')
      .run(floorplanId || null, svgElementId || null, loc.id)
    res.json(db().prepare('SELECT * FROM locations WHERE id = ?').get(loc.id))
  })

  router.delete('/locations/:id', (req, res) => {
    const loc = db().prepare('SELECT * FROM locations WHERE id = ?').get(req.params.id)
    if (!loc) return res.status(404).json({ error: 'not found' })
    const childLocations = db().prepare('SELECT COUNT(*) c FROM locations WHERE parent_id = ?').get(loc.id)
    const childItems = db().prepare('SELECT COUNT(*) c FROM items WHERE location_id = ?').get(loc.id)
    if (childLocations.c > 0 || childItems.c > 0) {
      return res.status(400).json({ error: 'location is not empty; move or delete its contents first' })
    }
    db().prepare('DELETE FROM locations WHERE id = ?').run(loc.id)
    res.status(204).end()
  })
}
