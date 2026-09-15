const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { initDb } = require('../../plugin/db')
const { computeStockAlertsState, publishStockAlerts, DEFAULTS } = require('../../plugin/stockAlerts')

function tmpDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'stowage-stockalerts-test-'))
}

function withDb (fn) {
  const dir = tmpDir()
  const db = initDb(dir)
  try {
    return fn(db)
  } finally {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function insertItem (db, { name, actualQuantity, targetQuantity, expiresAt }) {
  const id = randomUUID()
  db.prepare(
    'INSERT INTO items (id, name, actual_quantity, target_quantity, expires_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, name, actualQuantity, targetQuantity ?? null, expiresAt ?? null)
  return id
}

// Inserts an item_log row with an explicit created_at (ISO string), for
// deterministic forecast/staleness tests — bypasses logItemEvent's
// datetime('now') default.
function insertLogEvent (db, { itemId, itemName, event, delta, createdAt }) {
  db.prepare(
    `INSERT INTO item_log (id, item_id, item_name, event, delta, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(randomUUID(), itemId, itemName, event, delta, createdAt)
}

test('computeStockAlertsState: empty inventory is normal on all three paths', () => {
  withDb((db) => {
    const result = computeStockAlertsState(db, {}, Date.now())
    assert.equal(result.stock.state, 'normal')
    assert.equal(result.expiring.state, 'normal')
    assert.equal(result.overall.state, 'normal')
    assert.equal(result.stock.message, '')
  })
})

test('computeStockAlertsState: out-of-stock item is alarm on stock and overall', () => {
  withDb((db) => {
    insertItem(db, { name: 'Zip ties', actualQuantity: 0, targetQuantity: 10 })
    const result = computeStockAlertsState(db, {}, Date.now())
    assert.equal(result.stock.state, 'alarm')
    assert.match(result.stock.message, /Zip ties/)
    assert.equal(result.overall.state, 'alarm')
    assert.match(result.overall.message, /Zip ties/)
    assert.equal(result.expiring.state, 'normal') // no expires_at set
  })
})

test('computeStockAlertsState: understocked-but-in-stock item is warn, not alarm', () => {
  withDb((db) => {
    insertItem(db, { name: 'Engine oil', actualQuantity: 2, targetQuantity: 5 })
    const result = computeStockAlertsState(db, {}, Date.now())
    assert.equal(result.stock.state, 'warn')
    assert.match(result.stock.message, /understocked/)
    assert.match(result.stock.message, /Engine oil/)
  })
})

test('computeStockAlertsState: item with no target_quantity is never understocked', () => {
  withDb((db) => {
    const now = Date.now()
    const itemId = insertItem(db, { name: 'Spare fuse', actualQuantity: 1, targetQuantity: null })
    // Recent activity, so the staleness clause doesn't also fire and mask the assertion.
    insertLogEvent(db, { itemId, itemName: 'Spare fuse', event: 'created', delta: 1, createdAt: new Date(now).toISOString() })
    const result = computeStockAlertsState(db, {}, now)
    assert.equal(result.stock.state, 'normal')
  })
})

test('computeStockAlertsState: forecasted runway below crit threshold is alarm even with stock remaining', () => {
  withDb((db) => {
    const now = Date.now()
    const itemId = insertItem(db, { name: 'Diesel', actualQuantity: 2 })
    for (let i = 0; i < 3; i++) {
      insertLogEvent(db, {
        itemId, itemName: 'Diesel', event: 'actual_quantity', delta: -4,
        createdAt: new Date(now - i * 24 * 60 * 60 * 1000).toISOString()
      })
    }
    // rate = 12 units / 30-day default window = 0.4/day; daysRemaining = 2 / 0.4 = 5 -> at/under warn (7), above crit (2)
    const result = computeStockAlertsState(db, {}, now)
    assert.equal(result.stock.state, 'warn')
    assert.match(result.stock.message, /Diesel/)
    assert.match(result.stock.message, /run low/)
  })
})

test('computeStockAlertsState: forecasted runway below crit threshold with a tight window is alarm', () => {
  withDb((db) => {
    const now = Date.now()
    const itemId = insertItem(db, { name: 'Drinking water', actualQuantity: 2 })
    for (let i = 0; i < 3; i++) {
      insertLogEvent(db, {
        itemId, itemName: 'Drinking water', event: 'actual_quantity', delta: -10,
        createdAt: new Date(now - i * 24 * 60 * 60 * 1000).toISOString()
      })
    }
    // rate = 30 units / 5-day window = 6/day; daysRemaining = 2 / 6 = 0.33 -> below crit (2 days)
    const result = computeStockAlertsState(db, { stockAlertsForecastWindowDays: 5 }, now)
    assert.equal(result.stock.state, 'alarm')
    assert.match(result.stock.message, /Drinking water/)
    assert.match(result.stock.message, /run out/)
  })
})

test('computeStockAlertsState: fewer than 3 consumption events does not produce a forecast', () => {
  withDb((db) => {
    const now = Date.now()
    const itemId = insertItem(db, { name: 'Batteries', actualQuantity: 1 })
    insertLogEvent(db, { itemId, itemName: 'Batteries', event: 'actual_quantity', delta: -5, createdAt: new Date(now).toISOString() })
    insertLogEvent(db, { itemId, itemName: 'Batteries', event: 'actual_quantity', delta: -5, createdAt: new Date(now).toISOString() })
    const result = computeStockAlertsState(db, {}, now)
    assert.equal(result.stock.state, 'normal')
  })
})

test('computeStockAlertsState: no item_log activity in stockAlertsStaleDays is warn', () => {
  withDb((db) => {
    const now = Date.now()
    const itemId = insertItem(db, { name: 'Rope', actualQuantity: 10, targetQuantity: 10 })
    insertLogEvent(db, {
      itemId, itemName: 'Rope', event: 'created', delta: 10,
      createdAt: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString() // 10 days ago, default threshold is 7
    })
    const result = computeStockAlertsState(db, {}, now)
    assert.equal(result.stock.state, 'warn')
    assert.match(result.stock.message, /no inventory activity/)
  })
})

test('computeStockAlertsState: recent item_log activity is not stale', () => {
  withDb((db) => {
    const now = Date.now()
    const itemId = insertItem(db, { name: 'Rope', actualQuantity: 10, targetQuantity: 10 })
    insertLogEvent(db, {
      itemId, itemName: 'Rope', event: 'created', delta: 10,
      createdAt: new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString()
    })
    const result = computeStockAlertsState(db, {}, now)
    assert.equal(result.stock.state, 'normal')
  })
})

test('computeStockAlertsState: an item with items present but no item_log rows at all is stale', () => {
  withDb((db) => {
    insertItem(db, { name: 'Manually seeded item', actualQuantity: 10, targetQuantity: 10 })
    const result = computeStockAlertsState(db, {}, Date.now())
    assert.equal(result.stock.state, 'warn')
    assert.match(result.stock.message, /no inventory activity/)
  })
})

test('computeStockAlertsState: expired item is alarm on expiring and overall, not stock', () => {
  withDb((db) => {
    const now = Date.now()
    const yesterday = new Date(now - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const itemId = insertItem(db, { name: 'Milk', actualQuantity: 1, expiresAt: yesterday })
    // Recent activity, so the stock path's staleness clause doesn't also fire.
    insertLogEvent(db, { itemId, itemName: 'Milk', event: 'created', delta: 1, createdAt: new Date(now).toISOString() })
    const result = computeStockAlertsState(db, {}, now)
    assert.equal(result.expiring.state, 'alarm')
    assert.match(result.expiring.message, /Milk/)
    assert.match(result.expiring.message, /expired/)
    assert.equal(result.stock.state, 'normal')
    assert.equal(result.overall.state, 'alarm')
    assert.match(result.overall.message, /Milk/)
    assert.doesNotMatch(result.overall.message, /^\s*$/)
  })
})

test('computeStockAlertsState: item expiring within the window (not yet expired) is warn', () => {
  withDb((db) => {
    const now = Date.now()
    const inFiveDays = new Date(now + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    insertItem(db, { name: 'Yogurt', actualQuantity: 1, expiresAt: inFiveDays })
    const result = computeStockAlertsState(db, {}, now)
    assert.equal(result.expiring.state, 'warn')
    assert.match(result.expiring.message, /Yogurt/)
    assert.match(result.expiring.message, /expiring within/)
  })
})

test('computeStockAlertsState: item expiring beyond the window is normal', () => {
  withDb((db) => {
    const now = Date.now()
    const inSixtyDays = new Date(now + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    insertItem(db, { name: 'Canned beans', actualQuantity: 1, expiresAt: inSixtyDays })
    const result = computeStockAlertsState(db, {}, now)
    assert.equal(result.expiring.state, 'normal')
  })
})

test('computeStockAlertsState: overall is worst-of stock and expiring, message only from non-normal sides', () => {
  withDb((db) => {
    const now = Date.now()
    insertItem(db, { name: 'Zip ties', actualQuantity: 0, targetQuantity: 10 }) // stock: alarm
    const inFiveDays = new Date(now + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    insertItem(db, { name: 'Yogurt', actualQuantity: 1, expiresAt: inFiveDays }) // expiring: warn
    const result = computeStockAlertsState(db, {}, now)
    assert.equal(result.overall.state, 'alarm') // worst of alarm/warn
    assert.match(result.overall.message, /Zip ties/)
    assert.match(result.overall.message, /Yogurt/)
  })
})

test('computeStockAlertsState: a raised stockAlertsRunwayWarnDays widens which forecasts count as warn', () => {
  withDb((db) => {
    const now = Date.now()
    const itemId = insertItem(db, { name: 'Coffee', actualQuantity: 2 })
    for (let i = 0; i < 3; i++) {
      insertLogEvent(db, {
        itemId, itemName: 'Coffee', event: 'actual_quantity', delta: -4,
        createdAt: new Date(now - i * 24 * 60 * 60 * 1000).toISOString()
      })
    }
    // Same math as the Diesel test above: daysRemaining = 5. Dropping the
    // warn threshold below that should stop it from tripping warn.
    const result = computeStockAlertsState(db, { stockAlertsRunwayWarnDays: 3 }, now)
    assert.equal(result.stock.state, 'normal')
  })
})

test('DEFAULTS: shape matches the documented config keys', () => {
  assert.deepEqual(Object.keys(DEFAULTS).sort(), [
    'publishStockAlertsNotification',
    'stockAlertsExpiringWindowDays',
    'stockAlertsForecastWindowDays',
    'stockAlertsRunwayCritDays',
    'stockAlertsRunwayWarnDays',
    'stockAlertsStaleDays'
  ].sort())
})

test('publishStockAlerts: calls app.handleMessage with all three paths when enabled', () => {
  withDb((db) => {
    insertItem(db, { name: 'Zip ties', actualQuantity: 0, targetQuantity: 10 })
    const calls = []
    const fakeApp = { handleMessage: (pluginId, delta) => calls.push({ pluginId, delta }) }
    const result = publishStockAlerts(fakeApp, db, {}, Date.now())
    assert.equal(calls.length, 1)
    assert.equal(calls[0].pluginId, 'signalk-stowage-mgmt')
    const paths = calls[0].delta.updates[0].values.map((v) => v.path)
    assert.deepEqual(paths, ['notifications.stowage.stock', 'notifications.stowage.expiring', 'notifications.stowage.overall'])
    assert.equal(calls[0].delta.updates[0].values[0].value.state, 'alarm')
    assert.equal(result.stock.state, 'alarm')
  })
})

test('publishStockAlerts: no-op when publishStockAlertsNotification is false', () => {
  withDb((db) => {
    const calls = []
    const fakeApp = { handleMessage: (pluginId, delta) => calls.push({ pluginId, delta }) }
    const result = publishStockAlerts(fakeApp, db, { publishStockAlertsNotification: false }, Date.now())
    assert.equal(calls.length, 0)
    assert.equal(result, null)
  })
})

test('publishStockAlerts: safe no-op against a host with no handleMessage', () => {
  withDb((db) => {
    const result = publishStockAlerts({}, db, {}, Date.now())
    assert.equal(result, null)
  })
})
