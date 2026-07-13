const { test } = require('node:test')
const assert = require('node:assert/strict')
const { startTestServer } = require('../../test-helpers/server')

test('categories: create requires a non-blank name and enforces uniqueness', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const blank = await server.post('/categories', { name: '   ' })
  assert.equal(blank.status, 400)

  const first = await server.post('/categories', { name: 'Electrical' })
  assert.equal(first.status, 201)

  const dup = await server.post('/categories', { name: 'Electrical' })
  assert.equal(dup.status, 409)
})

test('categories: rename enforces uniqueness against other categories, not itself', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const a = await (await server.post('/categories', { name: 'Electrical' })).json()
  const b = await (await server.post('/categories', { name: 'Consumables' })).json()

  const noOpRename = await server.patch(`/categories/${a.id}`, { name: 'Electrical' })
  assert.equal(noOpRename.status, 200)

  const clash = await server.patch(`/categories/${a.id}`, { name: 'Consumables' })
  assert.equal(clash.status, 409)

  const ok = await server.patch(`/categories/${b.id}`, { name: 'Consumables (Renamed)' })
  assert.equal(ok.status, 200)
})

test('categories: deleting a category removes it from items that had it', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const cat = await (await server.post('/categories', { name: 'Electrical' })).json()
  const item = await (await server.post('/items', { name: 'Fuse', category_ids: [cat.id] })).json()
  assert.equal(item.categories.length, 1)

  const del = await server.delete(`/categories/${cat.id}`)
  assert.equal(del.status, 204)

  const refreshed = await (await server.get(`/items/${item.id}`)).json()
  assert.deepEqual(refreshed.categories, [])
})

test('categories: 404s for unknown ids', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())
  assert.equal((await server.patch('/categories/nope', { name: 'X' })).status, 404)
  assert.equal((await server.delete('/categories/nope')).status, 404)
})
