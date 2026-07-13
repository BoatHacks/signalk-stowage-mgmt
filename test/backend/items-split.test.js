const { test } = require('node:test')
const assert = require('node:assert/strict')
const { startTestServer } = require('../../test-helpers/server')

async function makeLocation (server, name) {
  return (await server.post('/locations', { name, type: 'storage_space' })).json()
}

test('split: first split materializes placements and detaches item.location_id', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const locA = await makeLocation(server, 'Locker A')
  const locB = await makeLocation(server, 'Locker B')
  const item = await (await server.post('/items', {
    name: 'Rope', actual_quantity: 10, location_id: locA.id
  })).json()

  const res = await server.post(`/items/${item.id}/split`, {
    from_location_id: locA.id, to_location_id: locB.id, quantity: 4
  })
  assert.equal(res.status, 200)
  const updated = await res.json()
  assert.equal(updated.location_id, null)
  assert.equal(updated.placements.length, 2)
  const byLoc = Object.fromEntries(updated.placements.map((p) => [p.location_id, p.quantity]))
  assert.equal(byLoc[locA.id], 6)
  assert.equal(byLoc[locB.id], 4)
  assert.equal(updated.actual_quantity, 10) // total is unchanged by a split

  const log = await (await server.get('/item-log')).json()
  const splitEvent = log.find((e) => e.item_id === item.id && e.event === 'split')
  assert.ok(splitEvent)
  assert.equal(splitEvent.quantity, 4)
})

test('split: moving all remaining stock away collapses back to a plain item', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const locA = await makeLocation(server, 'Locker A')
  const locB = await makeLocation(server, 'Locker B')
  const item = await (await server.post('/items', {
    name: 'Rope', actual_quantity: 10, location_id: locA.id
  })).json()

  await server.post(`/items/${item.id}/split`, { from_location_id: locA.id, to_location_id: locB.id, quantity: 4 })
  // Move the remaining 6 out of A too -> everything now at B -> should collapse.
  const res = await server.post(`/items/${item.id}/split`, { from_location_id: locA.id, to_location_id: locB.id, quantity: 6 })
  const updated = await res.json()
  assert.equal(updated.placements.length, 0)
  assert.equal(updated.location_id, locB.id)
  assert.equal(updated.actual_quantity, 10)
})

test('split: rejects wrong source, over-quantity, and same from/to', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const locA = await makeLocation(server, 'Locker A')
  const locB = await makeLocation(server, 'Locker B')
  const item = await (await server.post('/items', {
    name: 'Rope', actual_quantity: 5, location_id: locA.id
  })).json()

  const sameLoc = await server.post(`/items/${item.id}/split`, { from_location_id: locA.id, to_location_id: locA.id, quantity: 1 })
  assert.equal(sameLoc.status, 400)

  const wrongSource = await server.post(`/items/${item.id}/split`, { from_location_id: locB.id, to_location_id: locA.id, quantity: 1 })
  assert.equal(wrongSource.status, 400)

  const tooMany = await server.post(`/items/${item.id}/split`, { from_location_id: locA.id, to_location_id: locB.id, quantity: 999 })
  assert.equal(tooMany.status, 400)

  const zero = await server.post(`/items/${item.id}/split`, { from_location_id: locA.id, to_location_id: locB.id, quantity: 0 })
  assert.equal(zero.status, 400)
})

test('placement quantity: editing one placement keeps the item total in sync and logs it', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const locA = await makeLocation(server, 'Locker A')
  const locB = await makeLocation(server, 'Locker B')
  const item = await (await server.post('/items', {
    name: 'Rope', actual_quantity: 10, location_id: locA.id
  })).json()
  const split = await (await server.post(`/items/${item.id}/split`, {
    from_location_id: locA.id, to_location_id: locB.id, quantity: 4
  })).json()
  const placementB = split.placements.find((p) => p.location_id === locB.id)

  const res = await server.patch(`/items/${item.id}/placements/${placementB.id}`, { quantity: 7 })
  const updated = await res.json()
  assert.equal(updated.actual_quantity, 13) // 6 (A) + 7 (B)

  const log = await (await server.get('/item-log')).json()
  const qtyEvent = log.find((e) => e.item_id === item.id && e.event === 'actual_quantity')
  assert.ok(qtyEvent)
  assert.equal(qtyEvent.old_value, 10)
  assert.equal(qtyEvent.new_value, 13)
})

test('placement quantity: setting to 0 removes the placement and can collapse to a plain item', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const locA = await makeLocation(server, 'Locker A')
  const locB = await makeLocation(server, 'Locker B')
  const item = await (await server.post('/items', {
    name: 'Rope', actual_quantity: 10, location_id: locA.id
  })).json()
  const split = await (await server.post(`/items/${item.id}/split`, {
    from_location_id: locA.id, to_location_id: locB.id, quantity: 4
  })).json()
  const placementB = split.placements.find((p) => p.location_id === locB.id)

  const res = await server.patch(`/items/${item.id}/placements/${placementB.id}`, { quantity: 0 })
  const updated = await res.json()
  assert.equal(updated.placements.length, 0)
  assert.equal(updated.location_id, locA.id)
  assert.equal(updated.actual_quantity, 6)
})

test('placement move: merges into an existing placement at the destination', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const locA = await makeLocation(server, 'Locker A')
  const locB = await makeLocation(server, 'Locker B')
  const locC = await makeLocation(server, 'Locker C')
  const item = await (await server.post('/items', {
    name: 'Rope', actual_quantity: 10, location_id: locA.id
  })).json()
  await server.post(`/items/${item.id}/split`, { from_location_id: locA.id, to_location_id: locB.id, quantity: 3 })
  const afterSecondSplit = await (await server.post(`/items/${item.id}/split`, {
    from_location_id: locA.id, to_location_id: locC.id, quantity: 2
  })).json()
  const placementC = afterSecondSplit.placements.find((p) => p.location_id === locC.id)

  // Move C's placement onto B -> should merge (3 + 2 = 5), not create a duplicate row.
  const res = await server.patch(`/items/${item.id}/placements/${placementC.id}/move`, { location_id: locB.id })
  const updated = await res.json()
  const byLoc = Object.fromEntries(updated.placements.map((p) => [p.location_id, p.quantity]))
  assert.equal(Object.keys(byLoc).length, 2) // A and B only
  assert.equal(byLoc[locB.id], 5)
})

test('a split (not a real quantity change) is not logged as actual_quantity', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const locA = await makeLocation(server, 'Locker A')
  const locB = await makeLocation(server, 'Locker B')
  const item = await (await server.post('/items', {
    name: 'Rope', actual_quantity: 10, location_id: locA.id
  })).json()
  await server.post(`/items/${item.id}/split`, { from_location_id: locA.id, to_location_id: locB.id, quantity: 4 })

  const log = await (await server.get('/item-log')).json()
  const qtyEvents = log.filter((e) => e.item_id === item.id && e.event === 'actual_quantity')
  assert.equal(qtyEvents.length, 0)
})

test('locate: walks up through unmapped containers/storage spaces to the nearest mapped one', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const aft = await makeLocation(server, 'Aft Cabin') // unmapped
  const locker = await makeLocation(server, 'Port Locker')
  await server.patch(`/locations/${locker.id}/move`, { parent_id: aft.id })
  const box = await (await server.post('/locations', { name: 'Box 3', type: 'container', parent_id: locker.id })).json()

  const fp = await (await server.post('/floorplans', { name: 'Boat', svg_content: '<svg><path id="portlocker"/></svg>' })).json()
  await server.patch(`/locations/${locker.id}/svg-mapping`, { floorplan_id: fp.id, svg_element_id: 'portlocker' })

  const item = await (await server.post('/items', { name: 'Fuse', location_id: box.id })).json()
  const res = await server.get(`/items/${item.id}/locate`)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.svg_element_id, 'portlocker')
  assert.equal(body.storage_space.id, locker.id)
})

test('locate: 404s when no mapped storage space is found, split items return per-placement matches', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const item = await (await server.post('/items', { name: 'Fuse' })).json()
  const notFound = await server.get(`/items/${item.id}/locate`)
  assert.equal(notFound.status, 404)

  const locA = await makeLocation(server, 'Locker A')
  const locB = await makeLocation(server, 'Locker B')
  const fp = await (await server.post('/floorplans', { name: 'Boat', svg_content: '<svg><path id="a"/></svg>' })).json()
  await server.patch(`/locations/${locA.id}/svg-mapping`, { floorplan_id: fp.id, svg_element_id: 'a' })

  const splitItem = await (await server.post('/items', { name: 'Rope', actual_quantity: 10, location_id: locA.id })).json()
  await server.post(`/items/${splitItem.id}/split`, { from_location_id: locA.id, to_location_id: locB.id, quantity: 4 })

  const res = await server.get(`/items/${splitItem.id}/locate`)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.split, true)
  assert.equal(body.matches.length, 1) // only A is mapped; B has no match
  assert.equal(body.matches[0].svg_element_id, 'a')
})
