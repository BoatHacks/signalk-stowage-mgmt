const { buildLocationSiteMap, buildItemSiteQuantities } = require('../sites')

module.exports = function registerItemLogRoutes (router, getDb) {
  function db () {
    const instance = getDb()
    if (!instance) throw Object.assign(new Error('database not ready'), { statusCode: 503 })
    return instance
  }

  // Returns raw log rows within an optional date range, optionally
  // scoped to one item. start/end are inclusive, ISO date strings (e.g.
  // "2026-06-01"); the frontend does its own aggregation for display.
  // Omit all filters to get the full history.
  router.get('/item-log', (req, res) => {
    const { start, end, item_id: itemId, site } = req.query || {}
    const conditions = []
    const params = []
    if (start) {
      conditions.push('created_at >= ?')
      params.push(start)
    }
    if (end) {
      // end is a date (no time component) meant to be inclusive of the
      // whole day, so compare against the start of the following day.
      conditions.push("created_at < datetime(?, '+1 day')")
      params.push(end)
    }
    if (itemId) {
      conditions.push('item_id = ?')
      params.push(itemId)
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    let rows = db().prepare(`SELECT * FROM item_log ${where} ORDER BY created_at ASC`).all(...params)
    if (site) {
      // A row belongs to a site if either of its locations is in it. Rows
      // with no location (target changes, deletions of unlocated items) fall
      // back to wherever the item sits now; a deleted item's no-location
      // rows therefore only show under "all sites".
      const siteOf = buildLocationSiteMap(db())
      const quantities = buildItemSiteQuantities(db())
      rows = rows.filter(row => {
        const locationIds = [row.from_location_id, row.to_location_id].filter(Boolean)
        if (locationIds.length) return locationIds.some(id => siteOf.get(id) === site)
        return quantities.has(row.item_id) && quantities.get(row.item_id).has(site)
      })
    }
    res.json(rows)
  })
}
