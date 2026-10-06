import { test } from 'node:test'
import assert from 'node:assert/strict'
import { visibleChipKeys, retainFailedKeys, filterQuery } from '../../public/js/helpers.js'

const bulkData = {
  locations: [
    { id: 'a', name: 'Galley', type: 'storage_space', parent_id: null },
    { id: 'b', name: 'Box', type: 'container', parent_id: 'a' },
    { id: 'c', name: 'Engine', type: 'storage_space', parent_id: null }
  ],
  items: [
    { id: 'i1', name: 'Rice', location_id: 'a', placements: [] },
    { id: 'i2', name: 'Salt', location_id: 'b', placements: [] },
    { id: 'i3', name: 'Oil', location_id: 'c', placements: [] },
    { id: 'i4', name: 'Loose', location_id: null, placements: [] },
    { id: 'i5', name: 'Rope', location_id: null, placements: [{ id: 'p1', location_id: 'a', quantity: 1 }, { id: 'p2', location_id: 'c', quantity: 2 }] }
  ],
  categories: []
}

test('visibleChipKeys lists every chip when nothing is collapsed or filtered', () => {
  const keys = visibleChipKeys(bulkData, new Set(), filterQuery(bulkData, ''))
  assert.deepEqual([...keys].sort(), ['i1:', 'i2:', 'i3:', 'i4:', 'i5:p1', 'i5:p2'])
})

test('visibleChipKeys skips chips under a collapsed ancestor but keeps Not Stored items', () => {
  const keys = visibleChipKeys(bulkData, new Set(['a']), filterQuery(bulkData, ''))
  assert.deepEqual([...keys].sort(), ['i3:', 'i4:', 'i5:p2'])
})

test('visibleChipKeys applies the search filter and ignores collapse while filtering', () => {
  const keys = visibleChipKeys(bulkData, new Set(['a']), filterQuery(bulkData, 'salt'))
  assert.deepEqual([...keys].sort(), ['i2:', 'i4:'])
})

test('retainFailedKeys keeps the exact key of a failed move pair', () => {
  const selected = new Set(['i1:', 'i5:p1', 'i5:p2'])
  const targets = [{ itemId: 'i1', placementId: null }, { itemId: 'i5', placementId: 'p1' }, { itemId: 'i5', placementId: 'p2' }]
  const results = [{ status: 'fulfilled' }, { status: 'rejected' }, { status: 'fulfilled' }]
  assert.deepEqual([...retainFailedKeys(selected, targets, results)], ['i5:p1'])
})

test('retainFailedKeys keeps all keys of a failed item id and nothing when all succeed', () => {
  const selected = new Set(['i1:', 'i5:p1', 'i5:p2'])
  const failed = retainFailedKeys(selected, ['i1', 'i5'], [{ status: 'fulfilled' }, { status: 'rejected' }])
  assert.deepEqual([...failed].sort(), ['i5:p1', 'i5:p2'])
  assert.equal(retainFailedKeys(selected, ['i1', 'i5'], [{ status: 'fulfilled' }, { status: 'fulfilled' }]).size, 0)
})
