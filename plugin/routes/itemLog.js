module.exports = function registerItemLogRoutes (router, getDb) {
  function db () {
    const instance = getDb()
    if (!instance) throw Object.assign(new Error('database not ready'), { statusCode: 503 })
    return instance
  }

  // Returns raw log rows within an optional date range. start/end are
  // inclusive, ISO date strings (e.g. "2026-06-01"); the frontend does its
  // own aggregation for display. Omit both to get the full history.
  router.get('/item-log', (req, res) => {
    const { start, end } = req.query || {}
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
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const rows = db().prepare(`SELECT * FROM item_log ${where} ORDER BY created_at ASC`).all(...params)
    res.json(rows)
  })
}
