const { test } = require('node:test')
const assert = require('node:assert/strict')
const { startTestServer } = require('../../test-helpers/server')

test('locations: create requires name and a valid type', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const missingName = await server.post('/locations', { type: 'storage_space' })
  assert.equal(missingName.status, 400)

  const badType = await server.post('/locations', { name: 'X', type: 'bogus' })
  assert.equal(badType.status, 400)

  const ok = await server.post('/locations', { name: 'Aft Cabin', type: 'storage_space' })
  assert.equal(ok.status, 201)
  const body = await ok.json()
  assert.equal(body.name, 'Aft Cabin')
  assert.equal(body.type, 'storage_space')
  assert.equal(body.parent_id, null)
})

test('locations: storage spaces can nest inside storage spaces to any depth', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const aft = await (await server.post('/locations', { name: 'Aft Cabin', type: 'storage_space' })).json()
  const locker = await (await server.post('/locations', {
    name: 'Port Locker', type: 'storage_space', parent_id: aft.id
  })).json()
  const box = await (await server.post('/locations', {
    name: 'Box 3', type: 'container', parent_id: locker.id
  })).json()

  assert.equal(locker.parent_id, aft.id)
  assert.equal(box.parent_id, locker.id)

  const list = await (await server.get('/locations')).json()
  assert.equal(list.length, 3)
})

test('locations: create with a non-existent parent_id is rejected', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const res = await server.post('/locations', { name: 'X', type: 'container', parent_id: 'does-not-exist' })
  assert.equal(res.status, 400)
})

test('locations: rename', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const loc = await (await server.post('/locations', { name: 'Old Name', type: 'storage_space' })).json()
  const res = await server.patch(`/locations/${loc.id}`, { name: 'New Name' })
  assert.equal(res.status, 200)
  const updated = await res.json()
  assert.equal(updated.name, 'New Name')
})

test('locations: move rejects self-parenting and cycles', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const a = await (await server.post('/locations', { name: 'A', type: 'storage_space' })).json()
  const b = await (await server.post('/locations', { name: 'B', type: 'storage_space', parent_id: a.id })).json()

  const selfParent = await server.patch(`/locations/${a.id}/move`, { parent_id: a.id })
  assert.equal(selfParent.status, 400)

  // A is B's parent; moving A under B would create a cycle.
  const cycle = await server.patch(`/locations/${a.id}/move`, { parent_id: b.id })
  assert.equal(cycle.status, 400)

  // Legitimate move: detach B back to top level.
  const detach = await server.patch(`/locations/${b.id}/move`, { parent_id: null })
  assert.equal(detach.status, 200)
  const updated = await detach.json()
  assert.equal(updated.parent_id, null)
})

test('locations: svg-mapping only allowed on storage_space, at any nesting depth', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const aft = await (await server.post('/locations', { name: 'Aft Cabin', type: 'storage_space' })).json()
  const locker = await (await server.post('/locations', {
    name: 'Port Locker', type: 'storage_space', parent_id: aft.id
  })).json()
  const box = await (await server.post('/locations', { name: 'Box', type: 'container' })).json()

  const fp = await (await server.post('/floorplans', { name: 'Boat', svg_content: '<svg><path id="p1"/></svg>' })).json()

  const onContainer = await server.patch(`/locations/${box.id}/svg-mapping`, { floorplan_id: fp.id, svg_element_id: 'p1' })
  assert.equal(onContainer.status, 400)

  const onNestedStorageSpace = await server.patch(`/locations/${locker.id}/svg-mapping`, { floorplan_id: fp.id, svg_element_id: 'p1' })
  assert.equal(onNestedStorageSpace.status, 200)
  const updated = await onNestedStorageSpace.json()
  assert.equal(updated.floorplan_id, fp.id)
  assert.equal(updated.svg_element_id, 'p1')
})

test('locations: delete is blocked while it still has children or items', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const parent = await (await server.post('/locations', { name: 'Parent', type: 'storage_space' })).json()
  await server.post('/locations', { name: 'Child', type: 'container', parent_id: parent.id })

  const blocked = await server.delete(`/locations/${parent.id}`)
  assert.equal(blocked.status, 400)

  const empty = await (await server.post('/locations', { name: 'Empty', type: 'storage_space' })).json()
  const ok = await server.delete(`/locations/${empty.id}`)
  assert.equal(ok.status, 204)
})

test('locations: 404s for unknown ids', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  assert.equal((await server.patch('/locations/nope', { name: 'X' })).status, 404)
  assert.equal((await server.patch('/locations/nope/move', { parent_id: null })).status, 404)
  assert.equal((await server.patch('/locations/nope/svg-mapping', {})).status, 404)
  assert.equal((await server.delete('/locations/nope')).status, 404)
})
