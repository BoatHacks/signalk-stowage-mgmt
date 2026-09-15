const { test } = require('node:test')
const assert = require('node:assert/strict')
const { startTestServer } = require('../../test-helpers/server')

// Verifies plugin/index.js and plugin/routes/items.js actually call into
// plugin/stockAlerts.js over real HTTP requests — plugin/stockAlerts.js's
// own unit tests (test/backend/stockAlerts.test.js) cover the state logic
// itself, this covers the wiring (issue #64).

test('stock alerts wiring: plugin.start() publishes an initial notification even with an empty inventory', async (t) => {
  const calls = []
  const server = await startTestServer({ handleMessage: (pluginId, delta) => calls.push({ pluginId, delta }) })
  t.after(() => server.close())

  assert.equal(calls.length, 1)
  const paths = calls[0].delta.updates[0].values.map((v) => v.path)
  assert.deepEqual(paths, ['notifications.stowage.stock', 'notifications.stowage.expiring', 'notifications.stowage.overall'])
  assert.equal(calls[0].delta.updates[0].values[0].value.state, 'normal')
})

test('stock alerts wiring: an item dropping to zero actual_quantity republishes an alarm', async (t) => {
  const calls = []
  const server = await startTestServer({ handleMessage: (pluginId, delta) => calls.push(delta) })
  t.after(() => server.close())

  // actual_quantity: 0 on create falls back to the "starts at 1" default
  // (see routes/items.js), so drive it to zero via PATCH instead — the
  // realistic path (using the last unit) anyway.
  const created = await (await server.post('/items', { name: 'Zip ties', actual_quantity: 1, target_quantity: 10 })).json()
  await server.patch(`/items/${created.id}`, { actual_quantity: 0 })

  const latest = calls[calls.length - 1]
  const stockValue = latest.updates[0].values.find((v) => v.path === 'notifications.stowage.stock').value
  assert.equal(stockValue.state, 'alarm')
  assert.match(stockValue.message, /Zip ties/)
})

test('stock alerts wiring: setting an expiry date in the past republishes an alarm on the expiring path', async (t) => {
  const calls = []
  const server = await startTestServer({ handleMessage: (pluginId, delta) => calls.push(delta) })
  t.after(() => server.close())

  const created = await (await server.post('/items', { name: 'Milk' })).json()
  calls.length = 0 // only care about the PATCH below

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  await server.patch(`/items/${created.id}`, { expires_at: yesterday })

  assert.equal(calls.length, 1)
  const expiringValue = calls[0].updates[0].values.find((v) => v.path === 'notifications.stowage.expiring').value
  assert.equal(expiringValue.state, 'alarm')
  assert.match(expiringValue.message, /Milk/)
})

test('stock alerts wiring: deleting the only understocked item returns state to normal', async (t) => {
  const calls = []
  const server = await startTestServer({ handleMessage: (pluginId, delta) => calls.push(delta) })
  t.after(() => server.close())

  const created = await (await server.post('/items', { name: 'Engine oil', actual_quantity: 1, target_quantity: 5 })).json()
  await server.delete(`/items/${created.id}`)

  const latest = calls[calls.length - 1]
  const stockValue = latest.updates[0].values.find((v) => v.path === 'notifications.stowage.stock').value
  assert.equal(stockValue.state, 'normal')
})

test('stock alerts wiring: disabled via plugin option, no notifications published at all', async (t) => {
  const calls = []
  const server = await startTestServer({
    handleMessage: (pluginId, delta) => calls.push(delta),
    options: { publishStockAlertsNotification: false }
  })
  t.after(() => server.close())

  await server.post('/items', { name: 'Zip ties', actual_quantity: 0, target_quantity: 10 })

  assert.equal(calls.length, 0)
})
