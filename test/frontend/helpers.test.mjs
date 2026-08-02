import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  childLocations, itemsIn, formatBytes, isSplit, resolvedItemsIn, descendantIds,
  pathToRoot, ancestorIds, locationHasAnyItems, isUnderstocked, deriveNameFromSvgElementId,
  buildInventoryMarkdown, extractSourceFromNotes, buildShoppingListMarkdown,
  isExpiringSoon, daysUntil, expiringStatusText, subtreeSummary, defaultPlacementFor, quantityStepsFor,
  locationHasFloorplanMapping, itemHasFloorplanMapping, itemFloorplanTargets, itemMatchesQuery, filterQuery,
  resolveDetailPageSections, DETAIL_PAGE_SECTIONS, anyItemHasPhoto
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

test('defaultPlacementFor: finds the placement matching default_location_id', () => {
  const item = {
    default_location_id: 'loc-b',
    placements: [
      { id: 'p1', location_id: 'loc-a', quantity: 6 },
      { id: 'p2', location_id: 'loc-b', quantity: 4 }
    ]
  }
  assert.deepEqual(defaultPlacementFor(item), { id: 'p2', location_id: 'loc-b', quantity: 4 })
})

test('defaultPlacementFor: null for a plain item, no default set, or a stale default', () => {
  assert.equal(defaultPlacementFor({ placements: [] }), null)
  assert.equal(defaultPlacementFor({ placements: [{ id: 'p1', location_id: 'loc-a', quantity: 1 }] }), null)
  assert.equal(defaultPlacementFor({
    default_location_id: 'loc-gone',
    placements: [{ id: 'p1', location_id: 'loc-a', quantity: 1 }]
  }), null)
})

test('quantityStepsFor: fine/coarse steps by digit count, not by trailing zeros', () => {
  assert.deepEqual(quantityStepsFor(0), { fine: 1, coarse: 1 })
  assert.deepEqual(quantityStepsFor(7), { fine: 1, coarse: 1 })
  assert.deepEqual(quantityStepsFor(99), { fine: 1, coarse: 10 })
  assert.deepEqual(quantityStepsFor(450), { fine: 10, coarse: 100 })
  assert.deepEqual(quantityStepsFor(999), { fine: 10, coarse: 100 })
  assert.deepEqual(quantityStepsFor(1000), { fine: 100, coarse: 1000 })
  assert.deepEqual(quantityStepsFor(7450), { fine: 100, coarse: 1000 })
  assert.deepEqual(quantityStepsFor(9999), { fine: 100, coarse: 1000 })
  assert.deepEqual(quantityStepsFor(10000), { fine: 1000, coarse: 10000 })
  // A round number does not get bigger steps than its neighbor just for
  // being round (contrast with "step by the first significant digit").
  assert.deepEqual(quantityStepsFor(5000), quantityStepsFor(5001))
})

test('quantityStepsFor: treats missing/negative values as 0; fine === coarse for single digits', () => {
  assert.deepEqual(quantityStepsFor(undefined), { fine: 1, coarse: 1 })
  assert.deepEqual(quantityStepsFor(null), { fine: 1, coarse: 1 })
  assert.deepEqual(quantityStepsFor(-450), { fine: 10, coarse: 100 })
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

test('ancestorIds: ids from root to the given location, inclusive', () => {
  const data = makeData({
    locations: [
      { id: 'a', name: 'Aft Cabin', parent_id: null },
      { id: 'b', name: 'Port Locker', parent_id: 'a' },
      { id: 'c', name: 'Box 3', parent_id: 'b' }
    ]
  })
  assert.deepEqual(ancestorIds(data, 'c'), ['a', 'b', 'c'])
  assert.deepEqual(ancestorIds(data, 'a'), ['a'])
  assert.deepEqual(ancestorIds(data, 'nope'), [])
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

test('anyItemHasPhoto: false when no item has a thumbnail, true if even one does', () => {
  assert.equal(anyItemHasPhoto([]), false)
  assert.equal(anyItemHasPhoto([{ thumbnail: null }, { thumbnail: undefined }]), false)
  assert.equal(anyItemHasPhoto([{ thumbnail: null }, { thumbnail: 'data:image/png;base64,x' }]), true)
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

test('buildInventoryMarkdown: renders headings per storage space (with an *S* marker) and a Not Stored section', () => {
  const data = makeData({
    locations: [{ id: 'a', name: 'Aft Cabin', type: 'storage_space', parent_id: null }],
    items: [
      { id: '1', name: 'Fuse', location_id: 'a', actual_quantity: 3, target_quantity: null },
      { id: '2', name: 'Loose Item', location_id: null, actual_quantity: 1, target_quantity: null }
    ]
  })
  const md = buildInventoryMarkdown(data)
  assert.match(md, /# Aft Cabin \*S\*/)
  assert.match(md, /Fuse.*\u00d73/)
  assert.match(md, /# Not Stored/)
  assert.match(md, /Loose Item/)
})

test('buildInventoryMarkdown: marks containers with *C*, nested under their parent storage space', () => {
  const data = makeData({
    locations: [
      { id: 'a', name: 'Aft Cabin', type: 'storage_space', parent_id: null },
      { id: 'b', name: 'Tool Box', type: 'container', parent_id: 'a' }
    ],
    items: [{ id: '1', name: 'Wrench', location_id: 'b', actual_quantity: 1 }]
  })
  const md = buildInventoryMarkdown(data)
  assert.match(md, /# Aft Cabin \*S\*/)
  assert.match(md, /## Tool Box \*C\*/)
})

test('buildInventoryMarkdown: includes empty top-level storage spaces and empty nested containers', () => {
  const data = makeData({
    locations: [
      { id: 'a', name: 'Empty Cabin', type: 'storage_space', parent_id: null },
      { id: 'b', name: 'Cabin With Empty Box', type: 'storage_space', parent_id: null },
      { id: 'c', name: 'Empty Box', type: 'container', parent_id: 'b' }
    ],
    items: []
  })
  const md = buildInventoryMarkdown(data)
  assert.match(md, /# Empty Cabin \*S\*/)
  assert.match(md, /# Cabin With Empty Box \*S\*/)
  assert.match(md, /## Empty Box \*C\*/)
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

test('locationHasFloorplanMapping: true for a directly mapped storage space, or via an ancestor', () => {
  const data = makeData({
    locations: [
      { id: 'mapped', type: 'storage_space', parent_id: null, floorplan_id: 'fp1', svg_element_id: 'area-1' },
      { id: 'unmapped', type: 'storage_space', parent_id: null },
      { id: 'container-in-mapped', type: 'container', parent_id: 'mapped' },
      { id: 'container-in-unmapped', type: 'container', parent_id: 'unmapped' }
    ]
  })
  assert.equal(locationHasFloorplanMapping(data, 'mapped'), true)
  assert.equal(locationHasFloorplanMapping(data, 'container-in-mapped'), true)
  assert.equal(locationHasFloorplanMapping(data, 'unmapped'), false)
  assert.equal(locationHasFloorplanMapping(data, 'container-in-unmapped'), false)
  assert.equal(locationHasFloorplanMapping(data, null), false)
  assert.equal(locationHasFloorplanMapping(data, 'does-not-exist'), false)
})

test('itemHasFloorplanMapping: plain item checks its own location, split item checks any placement', () => {
  const data = makeData({
    locations: [
      { id: 'mapped', type: 'storage_space', parent_id: null, floorplan_id: 'fp1', svg_element_id: 'area-1' },
      { id: 'unmapped', type: 'storage_space', parent_id: null }
    ]
  })
  assert.equal(itemHasFloorplanMapping(data, { location_id: 'mapped' }), true)
  assert.equal(itemHasFloorplanMapping(data, { location_id: 'unmapped' }), false)
  assert.equal(itemHasFloorplanMapping(data, { location_id: null }), false)

  const splitNoMatch = { placements: [{ location_id: 'unmapped' }, { location_id: null }] }
  assert.equal(itemHasFloorplanMapping(data, splitNoMatch), false)
  const splitMatch = { placements: [{ location_id: 'unmapped' }, { location_id: 'mapped' }] }
  assert.equal(itemHasFloorplanMapping(data, splitMatch), true)
})

test('itemFloorplanTargets: plain item returns 0 or 1 target; split item returns one per mapped placement, skipping unmapped ones', () => {
  const data = makeData({
    locations: [
      { id: 'mapped-a', type: 'storage_space', parent_id: null, floorplan_id: 'fp1', svg_element_id: 'area-a' },
      { id: 'mapped-b', type: 'storage_space', parent_id: null, floorplan_id: 'fp1', svg_element_id: 'area-b' },
      { id: 'unmapped', type: 'storage_space', parent_id: null }
    ]
  })
  assert.deepEqual(itemFloorplanTargets(data, { location_id: 'mapped-a' }), [{ floorplanId: 'fp1', svgElementId: 'area-a' }])
  assert.deepEqual(itemFloorplanTargets(data, { location_id: 'unmapped' }), [])
  assert.deepEqual(itemFloorplanTargets(data, { location_id: null }), [])

  const split = { placements: [{ location_id: 'mapped-a' }, { location_id: 'unmapped' }, { location_id: 'mapped-b' }] }
  assert.deepEqual(itemFloorplanTargets(data, split), [
    { floorplanId: 'fp1', svgElementId: 'area-a' },
    { floorplanId: 'fp1', svgElementId: 'area-b' }
  ])
})

test('itemMatchesQuery: matches name or notes, case-insensitively; empty query matches everything', () => {
  const item = { name: 'Fuel Filter', notes: 'spare for the generator' }
  assert.equal(itemMatchesQuery(item, 'fuel'), true)
  assert.equal(itemMatchesQuery(item, 'GENERATOR'), true)
  assert.equal(itemMatchesQuery(item, 'rope'), false)
  assert.equal(itemMatchesQuery(item, ''), true)
  assert.equal(itemMatchesQuery({ name: 'X', notes: null }, 'x'), true)
})

test('filterQuery: empty query returns null sets ("show everything")', () => {
  const data = makeData({ items: [{ id: '1', name: 'Rope', location_id: null }] })
  const result = filterQuery(data, '')
  assert.equal(result.itemIds, null)
  assert.equal(result.locationIds, null)
})

test('filterQuery: matching items reveal their own location and every ancestor', () => {
  const data = makeData({
    locations: [
      { id: 'root', name: 'Root', parent_id: null },
      { id: 'child', name: 'Child', parent_id: 'root' }
    ],
    items: [
      { id: 'match', name: 'Fuel Filter', location_id: 'child' },
      { id: 'no-match', name: 'Rope', location_id: 'child' }
    ]
  })
  const result = filterQuery(data, 'fuel')
  assert.deepEqual(Array.from(result.itemIds), ['match'])
  assert.deepEqual(Array.from(result.locationIds).sort(), ['child', 'root'])
})

test('filterQuery: a location matching by name reveals its whole subtree, including non-matching items inside it', () => {
  const data = makeData({
    locations: [
      { id: 'root', name: 'Galley', parent_id: null },
      { id: 'child', name: 'Drawer', parent_id: 'root' }
    ],
    items: [
      { id: 'inside', name: 'Rope', location_id: 'child' },
      { id: 'elsewhere', name: 'Bulb', location_id: null }
    ]
  })
  const result = filterQuery(data, 'galley')
  assert.deepEqual(Array.from(result.locationIds).sort(), ['child', 'root'])
  assert.deepEqual(Array.from(result.itemIds), ['inside'])
})

test('filterQuery: a split item reveals ancestors of every matching placement', () => {
  const data = makeData({
    locations: [
      { id: 'a', name: 'A', parent_id: null },
      { id: 'b', name: 'B', parent_id: null }
    ],
    items: [
      {
        id: 'split', name: 'Beans',
        placements: [{ id: 'p1', location_id: 'a', quantity: 2 }, { id: 'p2', location_id: 'b', quantity: 3 }]
      }
    ]
  })
  const result = filterQuery(data, 'beans')
  assert.deepEqual(Array.from(result.locationIds).sort(), ['a', 'b'])
})

test('resolveDetailPageSections: filters to known sections, falls back to the default order when missing/invalid', () => {
  assert.deepEqual(resolveDetailPageSections(['history', 'placements']), ['history', 'placements'])
  assert.deepEqual(resolveDetailPageSections(['history', 'bogus']), ['history'])
  assert.deepEqual(resolveDetailPageSections([]), [])
  assert.deepEqual(resolveDetailPageSections(undefined), DETAIL_PAGE_SECTIONS)
  assert.deepEqual(resolveDetailPageSections(null), DETAIL_PAGE_SECTIONS)
})
