const { test } = require('node:test')
const assert = require('node:assert/strict')
const { startTestServer } = require('../../test-helpers/server')

test('items: create requires a name, defaults actual_quantity to 1', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const missingName = await server.post('/items', {})
  assert.equal(missingName.status, 400)

  const res = await server.post('/items', { name: 'Spare Fuse' })
  assert.equal(res.status, 201)
  const item = await res.json()
  assert.equal(item.name, 'Spare Fuse')
  assert.equal(item.actual_quantity, 1)
  assert.deepEqual(item.categories, [])
  assert.deepEqual(item.placements, [])
})

test('items: create rejects a non-existent location_id', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const res = await server.post('/items', { name: 'X', location_id: 'nope' })
  assert.equal(res.status, 400)
})

test('items: get, list, and search by name', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  await server.post('/items', { name: 'Spare Fuse' })
  await server.post('/items', { name: 'Fuse Puller' })
  await server.post('/items', { name: 'Life Jacket' })

  const all = await (await server.get('/items')).json()
  assert.equal(all.length, 3)

  const fuseResults = await (await server.get('/items?q=fuse')).json()
  assert.equal(fuseResults.length, 2)
  assert.ok(fuseResults.every((i) => /fuse/i.test(i.name)))
})

test('items: get 404 for unknown id', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())
  assert.equal((await server.get('/items/nope')).status, 404)
})

test('items: patch updates fields and logs actual_quantity changes', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const item = await (await server.post('/items', { name: 'Fuse', actual_quantity: 3 })).json()
  const res = await server.patch(`/items/${item.id}`, { actual_quantity: 5, target_quantity: 6 })
  assert.equal(res.status, 200)
  const updated = await res.json()
  assert.equal(updated.actual_quantity, 5)
  assert.equal(updated.target_quantity, 6)

  const log = await (await server.get('/item-log')).json()
  const qtyEvents = log.filter((e) => e.item_id === item.id && e.event === 'actual_quantity')
  assert.equal(qtyEvents.length, 1)
  assert.equal(qtyEvents[0].old_value, 3)
  assert.equal(qtyEvents[0].new_value, 5)
})

test('items: categories can be assigned at creation and via endpoints', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const cat = await (await server.post('/categories', { name: 'Electrical' })).json()
  const item = await (await server.post('/items', { name: 'Fuse', category_ids: [cat.id] })).json()
  assert.equal(item.categories.length, 1)
  assert.equal(item.categories[0].name, 'Electrical')

  const cat2 = await (await server.post('/categories', { name: 'Consumables' })).json()
  const added = await (await server.post(`/items/${item.id}/categories`, { category_id: cat2.id })).json()
  assert.equal(added.categories.length, 2)

  const removed = await (await server.delete(`/items/${item.id}/categories/${cat.id}`)).json()
  assert.equal(removed.categories.length, 1)
  assert.equal(removed.categories[0].name, 'Consumables')
})

test('items: create rejects a non-existent category_id', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())
  const res = await server.post('/items', { name: 'X', category_ids: ['nope'] })
  assert.equal(res.status, 400)
})

test('items: move to a location, then move rejected for a nonexistent location', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const loc = await (await server.post('/locations', { name: 'Shelf', type: 'storage_space' })).json()
  const item = await (await server.post('/items', { name: 'Fuse' })).json()

  const moved = await (await server.patch(`/items/${item.id}/move`, { location_id: loc.id })).json()
  assert.equal(moved.location_id, loc.id)

  const bad = await server.patch(`/items/${item.id}/move`, { location_id: 'nope' })
  assert.equal(bad.status, 400)
})

test('items: thumbnail set and clear', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const item = await (await server.post('/items', { name: 'Fuse' })).json()
  const withThumb = await (await server.patch(`/items/${item.id}/thumbnail`, { thumbnail: 'data:image/jpeg;base64,AAAA' })).json()
  assert.equal(withThumb.thumbnail, 'data:image/jpeg;base64,AAAA')

  const cleared = await (await server.patch(`/items/${item.id}/thumbnail`, { thumbnail: null })).json()
  assert.equal(cleared.thumbnail, null)

  const badType = await server.patch(`/items/${item.id}/thumbnail`, { thumbnail: 12345 })
  assert.equal(badType.status, 400)
})

test('items: delete removes the item and logs a deleted event', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const item = await (await server.post('/items', { name: 'Fuse' })).json()
  const del = await server.delete(`/items/${item.id}`)
  assert.equal(del.status, 204)
  assert.equal((await server.get(`/items/${item.id}`)).status, 404)

  const log = await (await server.get('/item-log')).json()
  assert.ok(log.some((e) => e.item_id === item.id && e.event === 'deleted'))
})
