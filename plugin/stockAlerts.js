// Computes and publishes three SK notifications summarizing stowage health,
// for consumption by dashboards like signalk-status-tiles (issue #64):
//   notifications.stowage.stock     — restocking (understocked/out-of-stock/forecast)
//   notifications.stowage.expiring  — spoilage (expiring/expired items)
//   notifications.stowage.overall   — worst of the two above, one glance
//
// Pure computation (computeStockAlertsState) is separated from the SK
// publish step (publishStockAlerts) so the state logic is testable without
// a fake `app`.

const DEFAULTS = {
  publishStockAlertsNotification: true,
  stockAlertsForecastWindowDays: 30,
  stockAlertsRunwayWarnDays: 7,
  stockAlertsRunwayCritDays: 2,
  stockAlertsStaleDays: 7,
  stockAlertsExpiringWindowDays: 14
}

// A consumption event needs at least this many data points in the forecast
// window before a rate is trusted — matches buildPredictionRows' MIN_EVENTS
// in public/js/app-storelog-tab.js (a single/couple events is too noisy).
const MIN_FORECAST_EVENTS = 3

const STATE_RANK = { normal: 0, warn: 1, alarm: 2 }

function worstOf (a, b) {
  return STATE_RANK[a] >= STATE_RANK[b] ? a : b
}

// Whole-days difference between "now" (local midnight) and a "YYYY-MM-DD"
// date string, parsed as local midnight too — same approach as daysUntil in
// public/js/helpers.js, to stay consistent with what the webapp itself shows.
function daysUntil (dateStr, now) {
  const today = new Date(now || Date.now())
  today.setHours(0, 0, 0, 0)
  const target = new Date(dateStr + 'T00:00:00')
  return Math.round((target - today) / (1000 * 60 * 60 * 24))
}

function joinList (names, max) {
  max = max || 5
  if (names.length <= max) return names.join(', ')
  return names.slice(0, max).join(', ') + ', and ' + (names.length - max) + ' more'
}

function pluralize (count, noun) {
  return count + ' ' + noun + (count === 1 ? '' : 's')
}

// Per-item consumption rate (units/day) over the trailing forecast window,
// keyed by item id. Only includes items with >= MIN_FORECAST_EVENTS
// consumption events in the window. Same source rows as
// buildPredictionRows: actual_quantity decreases, or a deletion using up
// whatever remained. Restocking doesn't affect the rate.
function computeForecastRates (db, options, now) {
  const windowDays = options.stockAlertsForecastWindowDays
  const sinceIso = new Date((now || Date.now()) - windowDays * 24 * 60 * 60 * 1000).toISOString()
  const rows = db.prepare(`
    SELECT item_id, SUM(ABS(delta)) as totalConsumed, COUNT(*) as eventCount
    FROM item_log
    WHERE created_at >= ?
      AND ((event = 'actual_quantity' AND delta < 0) OR event = 'deleted')
    GROUP BY item_id
  `).all(sinceIso)

  const rates = new Map()
  for (const row of rows) {
    if (row.eventCount < MIN_FORECAST_EVENTS) continue
    const rate = row.totalConsumed / windowDays
    if (rate > 0) rates.set(row.item_id, rate)
  }
  return rates
}

// Days since the most recent item_log row, or null if the log is empty
// (distinct from "very stale" — an empty log on a fresh install shouldn't
// itself trigger staleness, see computeStockState).
function daysSinceLastActivity (db, now) {
  const row = db.prepare('SELECT MAX(created_at) as last FROM item_log').get()
  if (!row || !row.last) return null
  const lastMs = new Date(row.last).getTime()
  return Math.floor(((now || Date.now()) - lastMs) / (1000 * 60 * 60 * 24))
}

// notifications.stowage.stock — restocking: out-of-stock, understocked
// (actual_quantity < target_quantity, same test as isUnderstocked in
// public/js/helpers.js), forecasted runway, and whole-boat log staleness.
function computeStockState (db, items, options, now) {
  const rates = computeForecastRates(db, options, now)

  const outOfStock = []
  const understocked = []
  const runwayWarn = []
  const runwayCrit = []
  let worst = 'normal'

  for (const item of items) {
    let itemState = 'normal'

    if (item.actual_quantity <= 0) {
      outOfStock.push(item.name)
      itemState = 'alarm'
    }

    const rate = rates.get(item.id)
    if (rate) {
      const daysRemaining = item.actual_quantity / rate
      if (daysRemaining <= options.stockAlertsRunwayCritDays) {
        runwayCrit.push(item.name)
        itemState = 'alarm'
      } else if (daysRemaining <= options.stockAlertsRunwayWarnDays) {
        runwayWarn.push(item.name)
        itemState = worstOf(itemState, 'warn')
      }
    }

    if (item.target_quantity != null && item.actual_quantity < item.target_quantity) {
      understocked.push(item.name)
      itemState = worstOf(itemState, 'warn')
    }

    worst = worstOf(worst, itemState)
  }

  // A fresh install with no items yet is "nothing to track", not "stale".
  const staleDays = items.length > 0 ? daysSinceLastActivity(db, now) : null
  const isStale = items.length > 0 && (staleDays === null || staleDays >= options.stockAlertsStaleDays)
  if (isStale) worst = worstOf(worst, 'warn')

  const parts = []
  if (outOfStock.length) {
    parts.push(`${pluralize(outOfStock.length, 'item')} out of stock (${joinList(outOfStock)})`)
  }
  if (runwayCrit.length) {
    parts.push(`${joinList(runwayCrit)} forecasted to run out within ${options.stockAlertsRunwayCritDays} days`)
  }
  if (understocked.length) {
    parts.push(`${pluralize(understocked.length, 'item')} understocked (${joinList(understocked)})`)
  }
  if (runwayWarn.length) {
    parts.push(`${joinList(runwayWarn)} forecasted to run low within ${options.stockAlertsRunwayWarnDays} days`)
  }
  if (isStale) {
    parts.push(`no inventory activity in ${staleDays === null ? 'a while' : pluralize(staleDays, 'day')}`)
  }

  return { state: worst, message: parts.length ? parts.join('. ') + '.' : '' }
}

// notifications.stowage.expiring — spoilage: already-expired and
// expiring-within-window items, ported from isExpiringSoon/
// EXPIRING_WINDOW_DAYS/daysUntil in public/js/helpers.js.
function computeExpiringState (items, options, now) {
  const expired = []
  const expiringSoon = []

  for (const item of items) {
    if (!item.expires_at) continue
    const days = daysUntil(item.expires_at, now)
    if (days < 0) expired.push(item.name)
    else if (days <= options.stockAlertsExpiringWindowDays) expiringSoon.push(item.name)
  }

  let state = 'normal'
  if (expired.length) state = 'alarm'
  else if (expiringSoon.length) state = 'warn'

  const parts = []
  if (expired.length) {
    parts.push(`${pluralize(expired.length, 'item')} expired (${joinList(expired)})`)
  }
  if (expiringSoon.length) {
    parts.push(`${pluralize(expiringSoon.length, 'item')} expiring within ${options.stockAlertsExpiringWindowDays} days (${joinList(expiringSoon)})`)
  }

  return { state, message: parts.length ? parts.join('. ') + '.' : '' }
}

// notifications.stowage.overall — worst of stock/expiring, no new logic of
// its own. Only concatenates messages from branches that aren't 'normal',
// so a single-source trip doesn't get padded with the other side's silence.
function computeOverallState (stock, expiring) {
  const state = worstOf(stock.state, expiring.state)
  const messages = []
  if (stock.state !== 'normal' && stock.message) messages.push(stock.message)
  if (expiring.state !== 'normal' && expiring.message) messages.push(expiring.message)
  return { state, message: messages.join(' ') }
}

// now (optional): epoch ms, for deterministic tests. Defaults to Date.now().
function computeStockAlertsState (db, options, now) {
  const opts = Object.assign({}, DEFAULTS, options)
  const items = db.prepare('SELECT id, name, actual_quantity, target_quantity, expires_at FROM items').all()

  const stock = computeStockState(db, items, opts, now)
  const expiring = computeExpiringState(items, opts, now)
  const overall = computeOverallState(stock, expiring)

  return { stock, expiring, overall }
}

// Publishes the three notifications via app.handleMessage. No-op if
// publishing is disabled in options, or the host has no handleMessage
// (shouldn't happen for a real SK server, but keeps this safe to call from
// a test harness's fake app).
function publishStockAlerts (app, db, options, now) {
  const opts = Object.assign({}, DEFAULTS, options)
  if (!opts.publishStockAlertsNotification) return null
  if (typeof app.handleMessage !== 'function') return null

  const result = computeStockAlertsState(db, opts, now)

  app.handleMessage('signalk-stowage-mgmt', {
    updates: [{
      values: [
        { path: 'notifications.stowage.stock', value: { state: result.stock.state, method: [], message: result.stock.message } },
        { path: 'notifications.stowage.expiring', value: { state: result.expiring.state, method: [], message: result.expiring.message } },
        { path: 'notifications.stowage.overall', value: { state: result.overall.state, method: [], message: result.overall.message } }
      ]
    }]
  })

  return result
}

module.exports = {
  DEFAULTS,
  computeStockAlertsState,
  publishStockAlerts
}
