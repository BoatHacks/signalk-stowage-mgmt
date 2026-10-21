const { randomUUID } = require('crypto')
const { runInTransaction } = require('../tx')

module.exports = function registerSiteRoutes (router, getDb, recomputeStockAlerts, getOptions) {
  function db () {
    const instance = getDb()
    if (!instance) throw Object.assign(new Error('database not ready'), { statusCode: 503 })
    return instance
  }

  function getSite (id) {
    return db().prepare('SELECT * FROM sites WHERE id = ?').get(id)
  }

  router.get('/sites', (req, res) => {
    res.json(db().prepare('SELECT * FROM sites ORDER BY is_vessel DESC, name').all())
  })

  router.get('/sites/:id', (req, res) => {
    const site = getSite(req.params.id)
    if (!site) return res.status(404).json({ error: 'not found' })
    res.json(site)
  })

  // Body: { name, floorplan_id?, is_vessel? }. Setting is_vessel: true
  // moves the flag off the current vessel site.
  router.post('/sites', (req, res) => {
    if (!(getOptions() || {}).multipleSites) {
      return res.status(403).json({ error: 'multiple sites is disabled; enable "Enable multiple sites" in the plugin configuration' })
    }
    const { name, floorplan_id: floorplanId, is_vessel: isVessel } = req.body || {}
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name required' })
    }
    if (floorplanId && !db().prepare('SELECT id FROM floorplans WHERE id = ?').get(floorplanId)) {
      return res.status(400).json({ error: 'floorplan_id does not exist' })
    }
    const id = randomUUID()
    runInTransaction(db(), () => {
      if (isVessel) db().prepare('UPDATE sites SET is_vessel = 0 WHERE is_vessel = 1').run()
      db().prepare('INSERT INTO sites (id, name, is_vessel, floorplan_id) VALUES (?, ?, ?, ?)')
        .run(id, name.trim(), isVessel ? 1 : 0, floorplanId || null)
    })
    if (isVessel) recomputeStockAlerts()
    res.status(201).json(getSite(id))
  })

  router.patch('/sites/:id', (req, res) => {
    const site = getSite(req.params.id)
    if (!site) return res.status(404).json({ error: 'not found' })
    const body = req.body || {}
    const hasFloorplan = Object.prototype.hasOwnProperty.call(body, 'floorplan_id')
    if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim())) {
      return res.status(400).json({ error: 'name must be a non-empty string' })
    }
    if (hasFloorplan && body.floorplan_id &&
        !db().prepare('SELECT id FROM floorplans WHERE id = ?').get(body.floorplan_id)) {
      return res.status(400).json({ error: 'floorplan_id does not exist' })
    }
    if (body.is_vessel === false && site.is_vessel) {
      return res.status(409).json({ error: 'exactly one site must be the vessel; set is_vessel on another site instead' })
    }
    const becomesVessel = body.is_vessel === true && !site.is_vessel
    runInTransaction(db(), () => {
      if (becomesVessel) db().prepare('UPDATE sites SET is_vessel = 0 WHERE is_vessel = 1').run()
      db().prepare(
        `UPDATE sites SET
          name = COALESCE(?, name),
          floorplan_id = CASE WHEN ? = 1 THEN ? ELSE floorplan_id END,
          is_vessel = CASE WHEN ? = 1 THEN 1 ELSE is_vessel END
         WHERE id = ?`
      ).run(body.name ? body.name.trim() : null, hasFloorplan ? 1 : 0, body.floorplan_id || null, becomesVessel ? 1 : 0, site.id)
    })
    if (becomesVessel) recomputeStockAlerts()
    res.json(getSite(site.id))
  })

  router.delete('/sites/:id', (req, res) => {
    const site = getSite(req.params.id)
    if (!site) return res.status(404).json({ error: 'not found' })
    if (site.is_vessel) {
      return res.status(409).json({ error: 'the vessel site cannot be deleted; set another site as the vessel first' })
    }
    const locations = db().prepare('SELECT COUNT(*) c FROM locations WHERE site_id = ?').get(site.id)
    if (locations.c > 0) {
      return res.status(400).json({ error: 'site still has locations; move or delete them first' })
    }
    db().prepare('DELETE FROM sites WHERE id = ?').run(site.id)
    res.status(204).end()
  })
}
