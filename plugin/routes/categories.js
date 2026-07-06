const { randomUUID } = require('crypto')

module.exports = function registerCategoryRoutes (router, getDb) {
  function db () {
    const instance = getDb()
    if (!instance) throw Object.assign(new Error('database not ready'), { statusCode: 503 })
    return instance
  }

  router.get('/categories', (req, res) => {
    res.json(db().prepare('SELECT * FROM categories ORDER BY name').all())
  })

  router.post('/categories', (req, res) => {
    const { name } = req.body || {}
    if (!name || !name.trim()) return res.status(400).json({ error: 'name required' })
    const existing = db().prepare('SELECT id FROM categories WHERE name = ?').get(name.trim())
    if (existing) return res.status(409).json({ error: 'a category with this name already exists' })
    const id = randomUUID()
    db().prepare('INSERT INTO categories (id, name) VALUES (?, ?)').run(id, name.trim())
    res.status(201).json(db().prepare('SELECT * FROM categories WHERE id = ?').get(id))
  })

  router.patch('/categories/:id', (req, res) => {
    const cat = db().prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id)
    if (!cat) return res.status(404).json({ error: 'not found' })
    const { name } = req.body || {}
    if (!name || !name.trim()) return res.status(400).json({ error: 'name required' })
    const clash = db().prepare('SELECT id FROM categories WHERE name = ? AND id != ?').get(name.trim(), cat.id)
    if (clash) return res.status(409).json({ error: 'a category with this name already exists' })
    db().prepare('UPDATE categories SET name = ? WHERE id = ?').run(name.trim(), cat.id)
    res.json(db().prepare('SELECT * FROM categories WHERE id = ?').get(cat.id))
  })

  // Deleting a category also removes it from any items that had it
  // (item_categories has ON DELETE CASCADE on category_id).
  router.delete('/categories/:id', (req, res) => {
    const cat = db().prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id)
    if (!cat) return res.status(404).json({ error: 'not found' })
    db().prepare('DELETE FROM categories WHERE id = ?').run(cat.id)
    res.status(204).end()
  })
}
