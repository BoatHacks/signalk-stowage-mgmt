const { test } = require('node:test')
const assert = require('node:assert/strict')
const { startTestServer } = require('../../test-helpers/server')

test('item-log: returns full history with no filters, newest-created-first inserts still sorted ascending', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  await server.post('/items', { name: 'Fuse' })
  await server.post('/items', { name: 'Rope' })

  const log = await (await server.get('/item-log')).json()
  assert.equal(log.length, 2)
  // ORDER BY created_at ASC
  assert.ok(new Date(log[0].created_at) <= new Date(log[1].created_at))
})

test('item-log: start/end range filters are inclusive of the whole end day', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  await server.post('/items', { name: 'Fuse' })

  const today = new Date().toISOString().slice(0, 10)
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const withinRange = await (await server.get(`/item-log?start=${past}&end=${future}`)).json()
  assert.equal(withinRange.length, 1)

  const beforeToday = await (await server.get(`/item-log?end=${past}`)).json()
  assert.equal(beforeToday.length, 0)

  const fromToday = await (await server.get(`/item-log?start=${today}`)).json()
  assert.equal(fromToday.length, 1)
})

test('item-log: item_id filter scopes results to that item, combines with date range', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const fuse = await (await server.post('/items', { name: 'Fuse' })).json()
  const rope = await (await server.post('/items', { name: 'Rope' })).json()

  const fuseOnly = await (await server.get(`/item-log?item_id=${fuse.id}`)).json()
  assert.equal(fuseOnly.length, 1)
  assert.equal(fuseOnly[0].item_id, fuse.id)

  const ropeOnly = await (await server.get(`/item-log?item_id=${rope.id}`)).json()
  assert.equal(ropeOnly.length, 1)
  assert.equal(ropeOnly[0].item_id, rope.id)

  const unknown = await (await server.get('/item-log?item_id=does-not-exist')).json()
  assert.equal(unknown.length, 0)

  const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const combined = await (await server.get(`/item-log?item_id=${fuse.id}&start=${future}`)).json()
  assert.equal(combined.length, 0)
})

test('item-log: records the location an item was created into (to_location)', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const loc = await (await server.post('/locations', { name: 'Galley', type: 'storage_space' })).json()
  const item = await (await server.post('/items', { name: 'Fuse', location_id: loc.id })).json()

  const log = await (await server.get('/item-log')).json()
  const created = log.find((e) => e.item_id === item.id && e.event === 'created')
  assert.equal(created.to_location_id, loc.id)
  assert.equal(created.to_location_name, 'Galley')
  assert.equal(created.from_location_id, null)
})

test('item-log: a quantity increase records to_location, a decrease records from_location', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const loc = await (await server.post('/locations', { name: 'Galley', type: 'storage_space' })).json()
  const item = await (await server.post('/items', { name: 'Fuse', actual_quantity: 5, location_id: loc.id })).json()

  await server.patch(`/items/${item.id}`, { actual_quantity: 8 })
  await server.patch(`/items/${item.id}`, { actual_quantity: 3 })

  const log = await (await server.get('/item-log')).json()
  const events = log.filter((e) => e.item_id === item.id && e.event === 'actual_quantity')
  assert.equal(events.length, 2)

  const increase = events.find((e) => e.new_value === 8)
  assert.equal(increase.to_location_id, loc.id)
  assert.equal(increase.to_location_name, 'Galley')
  assert.equal(increase.from_location_id, null)

  const decrease = events.find((e) => e.new_value === 3)
  assert.equal(decrease.from_location_id, loc.id)
  assert.equal(decrease.from_location_name, 'Galley')
  assert.equal(decrease.to_location_id, null)
})

test('item-log: a placement quantity change records that specific placement\'s location', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const locA = await (await server.post('/locations', { name: 'Galley', type: 'storage_space' })).json()
  const locB = await (await server.post('/locations', { name: 'Bilge', type: 'storage_space' })).json()
  const item = await (await server.post('/items', { name: 'Beans', actual_quantity: 10, location_id: locA.id })).json()
  const split = await (await server.post(`/items/${item.id}/split`, {
    from_location_id: locA.id, to_location_id: locB.id, quantity: 4
  })).json()
  const placementB = split.placements.find((p) => p.location_id === locB.id)

  await server.patch(`/items/${item.id}/placements/${placementB.id}`, { quantity: 6 }) // +2 at Bilge

  const log = await (await server.get('/item-log')).json()
  const event = log.find((e) => e.item_id === item.id && e.event === 'actual_quantity' && e.new_value === 12)
  assert.equal(event.to_location_id, locB.id)
  assert.equal(event.to_location_name, 'Bilge')
})

test('item-log: deleting a plain item records its location; deleting a split item records a descriptive fallback', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const locA = await (await server.post('/locations', { name: 'Galley', type: 'storage_space' })).json()
  const locB = await (await server.post('/locations', { name: 'Bilge', type: 'storage_space' })).json()

  const plain = await (await server.post('/items', { name: 'Fuse', location_id: locA.id })).json()
  await server.delete(`/items/${plain.id}`)

  const splitItem = await (await server.post('/items', { name: 'Beans', actual_quantity: 10, location_id: locA.id })).json()
  await server.post(`/items/${splitItem.id}/split`, { from_location_id: locA.id, to_location_id: locB.id, quantity: 4 })
  await server.delete(`/items/${splitItem.id}`)

  const log = await (await server.get('/item-log')).json()
  const plainDeleted = log.find((e) => e.item_id === plain.id && e.event === 'deleted')
  assert.equal(plainDeleted.from_location_id, locA.id)
  assert.equal(plainDeleted.from_location_name, 'Galley')

  const splitDeleted = log.find((e) => e.item_id === splitItem.id && e.event === 'deleted')
  assert.equal(splitDeleted.from_location_id, null)
  assert.equal(splitDeleted.from_location_name, 'Split (2 locations)')
})
