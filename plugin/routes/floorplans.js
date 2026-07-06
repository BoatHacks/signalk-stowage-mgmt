const { randomUUID } = require('crypto')

module.exports = function registerFloorplanRoutes (router, getDb) {
  function db () {
    const instance = getDb()
    if (!instance) throw Object.assign(new Error('database not ready'), { statusCode: 503 })
    return instance
  }

  router.get('/floorplans', (req, res) => {
    res.json(db().prepare('SELECT id, name, uploaded_at FROM floorplans ORDER BY uploaded_at DESC').all())
  })

  router.get('/floorplans/:id', (req, res) => {
    const fp = db().prepare('SELECT * FROM floorplans WHERE id = ?').get(req.params.id)
    if (!fp) return res.status(404).json({ error: 'not found' })
    res.json(fp)
  })

  // Body: { name, svg_content }. svg_content is the raw SVG markup as text
  // (read client-side with FileReader.readAsText before posting).
  router.post('/floorplans', (req, res) => {
    const { name, svg_content: svgContent } = req.body || {}
    if (!name || !svgContent) return res.status(400).json({ error: 'name and svg_content are required' })
    if (!svgContent.includes('<svg')) {
      return res.status(400).json({ error: 'svg_content does not look like an SVG document' })
    }
    const id = randomUUID()
    db().prepare('INSERT INTO floorplans (id, name, svg_content) VALUES (?, ?, ?)').run(id, name, svgContent)
    res.status(201).json(db().prepare('SELECT id, name, uploaded_at FROM floorplans WHERE id = ?').get(id))
  })

  router.delete('/floorplans/:id', (req, res) => {
    const fp = db().prepare('SELECT * FROM floorplans WHERE id = ?').get(req.params.id)
    if (!fp) return res.status(404).json({ error: 'not found' })
    const mapped = db().prepare('SELECT COUNT(*) c FROM locations WHERE floorplan_id = ?').get(fp.id)
    if (mapped.c > 0) return res.status(400).json({ error: 'floorplan is still mapped to storage spaces; unmap them first' })
    db().prepare('DELETE FROM floorplans WHERE id = ?').run(fp.id)
    res.status(204).end()
  })
}
