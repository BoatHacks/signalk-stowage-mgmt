import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  childLocations, itemsIn, formatBytes, isSplit, resolvedItemsIn, descendantIds,
  pathToRoot, locationHasAnyItems, isUnderstocked, deriveNameFromSvgElementId,
  buildInventoryMarkdown, extractSourceFromNotes, buildShoppingListMarkdown
} from '../../public/js/helpers.js'

function makeData (overrides) {
  return Object.assign({ locations: [], items: [], categories: [], floorplans: [] }, overrides)
}

test('childLocations: filters by parent_id, treating undefined/null as top-level', () => {
  const data = makeData({
    locations: [
      { id: 'a', parent_id: null },
      { id: 'b', parent_id: 'a' },
      { id: 'c' } // no parent_id key at all
    ]
  })
  const topLevel = childLocations(data, null).map((l) => l.id).sort()
  assert.deepEqual(topLevel, ['a', 'c'])
  assert.deepEqual(childLocations(data, 'a').map((l) => l.id), ['b'])
})

test('itemsIn: filters items by location_id', () => {
  const data = makeData({
    items: [{ id: '1', location_id: 'a' }, { id: '2', location_id: null }, { id: '3', location_id: 'a' }]
  })
  assert.deepEqual(itemsIn(data, 'a').map((i) => i.id), ['1', '3'])
  assert.deepEqual(itemsIn(data, null).map((i) => i.id), ['2'])
})

test('formatBytes: formats across units', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(500), '500 B')
  assert.equal(formatBytes(1024), '1.0 KB')
  assert.equal(formatBytes(1536), '1.5 KB')
  assert.equal(formatBytes(1024 * 1024), '1.0 MB')
  assert.equal(formatBytes(15 * 1024 * 1024), '15 MB')
  assert.equal(formatBytes(null), '')
})

test('isSplit: true only when placements is a non-empty array', () => {
  assert.equal(isSplit({ placements: [] }), false)
  assert.equal(isSplit({ placements: [{ id: 'p1' }] }), true)
  assert.equal(isSplit({}), false)
})

test('resolvedItemsIn: plain items pass through, split items produce one view per matching placement', () => {
  const data = makeData({
    items: [
      { id: 'plain', name: 'Plain', location_id: 'loc-a', actual_quantity: 5 },
      {
        id: 'split',
        name: 'Split',
        actual_quantity: 10,
        placements: [
          { id: 'p1', location_id: 'loc-a', quantity: 4 },
          { id: 'p2', location_id: 'loc-b', quantity: 6 }
        ]
      }
    ]
  })
  const atA = resolvedItemsIn(data, 'loc-a')
  assert.equal(atA.length, 2)
  const plainView = atA.find((v) => v.id === 'plain')
  assert.equal(plainView.placementId, null)
  assert.equal(plainView.actual_quantity, 5)
  const splitView = atA.find((v) => v.id === 'split')
  assert.equal(splitView.placementId, 'p1')
  assert.equal(splitView.actual_quantity, 4) // overridden to this placement's share, not the item total

  const atB = resolvedItemsIn(data, 'loc-b')
  assert.equal(atB.length, 1)
  assert.equal(atB[0].actual_quantity, 6)
})

test('descendantIds: collects all nested children recursively', () => {
  const data = makeData({
    locations: [
      { id: 'a', parent_id: null },
      { id: 'b', parent_id: 'a' },
      { id: 'c', parent_id: 'b' },
      { id: 'd', parent_id: null }
    ]
  })
  assert.deepEqual(descendantIds(data, 'a').sort(), ['b', 'c'])
  assert.deepEqual(descendantIds(data, 'd'), [])
})

test('pathToRoot: builds a breadcrumb string from root to the given location', () => {
  const data = makeData({
    locations: [
      { id: 'a', name: 'Aft Cabin', parent_id: null },
      { id: 'b', name: 'Port Locker', parent_id: 'a' }
    ]
  })
  assert.equal(pathToRoot(data, 'b'), 'Aft Cabin \u2192 Port Locker')
  assert.equal(pathToRoot(data, 'a'), 'Aft Cabin')
})

test('locationHasAnyItems: true if the location or any descendant has items', () => {
  const data = makeData({
    locations: [{ id: 'a', parent_id: null }, { id: 'b', parent_id: 'a' }],
    items: [{ id: '1', location_id: 'b', actual_quantity: 1 }]
  })
  assert.equal(locationHasAnyItems(data, 'a'), true)
  assert.equal(locationHasAnyItems(data, 'b'), true)

  const empty = makeData({ locations: [{ id: 'c', parent_id: null }] })
  assert.equal(locationHasAnyItems(empty, 'c'), false)
})

test('isUnderstocked: true only when target_quantity is set and actual is below it', () => {
  assert.equal(isUnderstocked({ actual_quantity: 1, target_quantity: 3 }), true)
  assert.equal(isUnderstocked({ actual_quantity: 3, target_quantity: 3 }), false)
  assert.equal(isUnderstocked({ actual_quantity: 1, target_quantity: null }), false)
  assert.equal(isUnderstocked({ actual_quantity: 1 }), false)
})

test('deriveNameFromSvgElementId: strips area prefix, replaces separators, title-cases', () => {
  assert.equal(deriveNameFromSvgElementId('area-navtable'), 'Navtable')
  assert.equal(deriveNameFromSvgElementId('area_port_locker'), 'Port Locker')
  assert.equal(deriveNameFromSvgElementId('AREA-Galley'), 'Galley')
  assert.equal(deriveNameFromSvgElementId('quarter-berth'), 'Quarter Berth')
})

test('extractSourceFromNotes: pulls a "source: X" line, case-insensitively, or null', () => {
  assert.equal(extractSourceFromNotes('source: West Marine'), 'West Marine')
  assert.equal(extractSourceFromNotes('Some notes\nSource: Amazon\nmore notes'), 'Amazon')
  assert.equal(extractSourceFromNotes('no source line here'), null)
  assert.equal(extractSourceFromNotes(null), null)
})

test('buildInventoryMarkdown: renders headings per storage space and a Not Stored section', () => {
  const data = makeData({
    locations: [{ id: 'a', name: 'Aft Cabin', type: 'storage_space', parent_id: null }],
    items: [
      { id: '1', name: 'Fuse', location_id: 'a', actual_quantity: 3, target_quantity: null },
      { id: '2', name: 'Loose Item', location_id: null, actual_quantity: 1, target_quantity: null }
    ]
  })
  const md = buildInventoryMarkdown(data)
  assert.match(md, /# Aft Cabin/)
  assert.match(md, /Fuse.*\u00d73/)
  assert.match(md, /# Not Stored/)
  assert.match(md, /Loose Item/)
})

test('buildInventoryMarkdown: bolds understocked items', () => {
  const data = makeData({
    locations: [{ id: 'a', name: 'Cabin', type: 'storage_space', parent_id: null }],
    items: [{ id: '1', name: 'Fuse', location_id: 'a', actual_quantity: 1, target_quantity: 3 }]
  })
  const md = buildInventoryMarkdown(data)
  // The bold wraps only the quantity part (e.g. "**×1 (target 3)**"), not the item name.
  assert.match(md, /Fuse.*\*\*\u00d71 \(target 3\)\*\*/)
})

test('buildShoppingListMarkdown: groups understocked items by "source:" note, sorted, with a fallback group', () => {
  const data = makeData({
    items: [
      { id: '1', name: 'Fuse', actual_quantity: 1, target_quantity: 3, notes: 'source: West Marine' },
      { id: '2', name: 'Rope', actual_quantity: 0, target_quantity: 2, notes: null },
      { id: '3', name: 'Bulb', actual_quantity: 5, target_quantity: 5 } // not understocked
    ]
  })
  const md = buildShoppingListMarkdown(data)
  assert.match(md, /## West Marine/)
  assert.match(md, /Fuse.*need 2/)
  assert.match(md, /## No Shop Specified/)
  assert.match(md, /Rope.*need 2/)
  assert.doesNotMatch(md, /Bulb/)
})

test('buildShoppingListMarkdown: says nothing needed when nothing is understocked', () => {
  const data = makeData({ items: [{ id: '1', name: 'Bulb', actual_quantity: 5, target_quantity: 5 }] })
  assert.match(buildShoppingListMarkdown(data), /Nothing needed right now/)
})
