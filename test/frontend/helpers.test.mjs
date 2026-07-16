import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  childLocations, itemsIn, formatBytes, isSplit, resolvedItemsIn, descendantIds,
  pathToRoot, locationHasAnyItems, isUnderstocked, deriveNameFromSvgElementId,
  buildInventoryMarkdown, extractSourceFromNotes, buildShoppingListMarkdown,
  isExpiringSoon, daysUntil, expiringStatusText, subtreeSummary
} from '../../public/js/helpers.js'

function makeData (overrides) {
  return Object.assign({ locations: [], items: [], categories: [], floorplans: [] }, overrides)
}

// "YYYY-MM-DD" for today + offsetDays (local time), matching the format
// isExpiringSoon/daysUntil expect.
function dateOffset (offsetDays) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + offsetDays)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
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

test('subtreeSummary: counts nested spaces/containers and distinct items (including split items, counted once)', () => {
  const data = makeData({
    locations: [
      { id: 'aft', name: 'Aft Cabin', type: 'storage_space', parent_id: null },
      { id: 'locker', name: 'Port Locker', type: 'storage_space', parent_id: 'aft' },
      { id: 'box', name: 'Box', type: 'container', parent_id: 'locker' },
      { id: 'box2', name: 'Box 2', type: 'container', parent_id: 'aft' },
      { id: 'other', name: 'Other Cabin', type: 'storage_space', parent_id: null }
    ],
    items: [
      { id: '1', name: 'Fuse', location_id: 'box', actual_quantity: 1 },
      { id: '2', name: 'Rope', location_id: 'aft', actual_quantity: 1 },
      // Split item with one placement inside the subtree, one outside -- counts once.
      {
        id: '3',
        name: 'Split Item',
        placements: [
          { id: 'p1', location_id: 'box2', quantity: 2 },
          { id: 'p2', location_id: 'other', quantity: 3 }
        ]
      },
      // Entirely outside the subtree -- not counted.
      { id: '4', name: 'Elsewhere', location_id: 'other', actual_quantity: 1 }
    ]
  })
  const summary = subtreeSummary(data, 'aft')
  assert.equal(summary.spaces, 1) // locker (nested storage space), not aft itself
  assert.equal(summary.containers, 2) // box, box2
  assert.equal(summary.items, 3) // Fuse, Rope, Split Item
})

test('subtreeSummary: empty subtree', () => {
  const data = makeData({ locations: [{ id: 'a', name: 'Empty', type: 'storage_space', parent_id: null }] })
  assert.deepEqual(subtreeSummary(data, 'a'), { spaces: 0, containers: 0, items: 0 })
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

test('daysUntil: whole-day difference between today and a date string', () => {
  assert.equal(daysUntil(dateOffset(0)), 0)
  assert.equal(daysUntil(dateOffset(5)), 5)
  assert.equal(daysUntil(dateOffset(-3)), -3)
})

test('expiringStatusText: describes today, future, and past dates', () => {
  assert.equal(expiringStatusText(0), 'Expires today')
  assert.equal(expiringStatusText(1), 'Expires in 1 day')
  assert.equal(expiringStatusText(5), 'Expires in 5 days')
  assert.equal(expiringStatusText(-1), 'Expired 1 day ago')
  assert.equal(expiringStatusText(-4), 'Expired 4 days ago')
})

test('isExpiringSoon: true when expires_at is within the window (or already past), false otherwise', () => {
  assert.equal(isExpiringSoon({ expires_at: dateOffset(5) }), true)
  assert.equal(isExpiringSoon({ expires_at: dateOffset(-2) }), true)
  assert.equal(isExpiringSoon({ expires_at: dateOffset(30) }), false)
  assert.equal(isExpiringSoon({ expires_at: null }), false)
  assert.equal(isExpiringSoon({}), false)
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

test('buildShoppingListMarkdown: includes expiring items, treated as 0 in stock, with an expires-date note', () => {
  const soonDate = dateOffset(5)
  const data = makeData({
    items: [
      // Fully stocked but expiring soon: still needed, full target amount since it's treated as 0 on hand.
      { id: '1', name: 'Flares', actual_quantity: 4, target_quantity: 4, expires_at: soonDate, notes: null },
      // Not expiring, not understocked: excluded.
      { id: '2', name: 'Bulb', actual_quantity: 5, target_quantity: 5 }
    ]
  })
  const md = buildShoppingListMarkdown(data)
  assert.match(md, /Flares.*need 4.*\(expires/)
  assert.match(md, new RegExp(`expires ${soonDate}`))
  assert.doesNotMatch(md, /Bulb/)
})

test('buildShoppingListMarkdown: an item that is both understocked and expiring is treated as 0 in stock (full target needed)', () => {
  const soonDate = dateOffset(1)
  const data = makeData({
    items: [{ id: '1', name: 'Milk', actual_quantity: 2, target_quantity: 3, expires_at: soonDate, notes: null }]
  })
  const md = buildShoppingListMarkdown(data)
  // Needed is the full target (3), not target - actual (1), since expiring items count as 0 on hand.
  assert.match(md, /Milk.*need 3.*\(expires/)
})

test('buildShoppingListMarkdown: expiring item with no target_quantity falls back to its actual quantity as the amount needed', () => {
  const soonDate = dateOffset(2)
  const data = makeData({
    items: [{ id: '1', name: 'Cheese', actual_quantity: 2, target_quantity: null, expires_at: soonDate, notes: null }]
  })
  const md = buildShoppingListMarkdown(data)
  assert.match(md, /Cheese.*need 2.*\(expires/)
})
