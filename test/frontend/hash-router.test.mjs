import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hashForState, parseHash } from '../../public/js/hash-router.js'

const TAB_IDS = ['inventory', 'floorplan', 'overview', 'categories', 'stock-alerts', 'storelog']
const DEFAULT_TAB = 'inventory'

test('hashForState: default tab with no item is just "#/"', () => {
  assert.equal(hashForState('inventory', null, DEFAULT_TAB), '#/')
})

test('hashForState: non-default tab is "#/<tab-id>"', () => {
  assert.equal(hashForState('floorplan', null, DEFAULT_TAB), '#/floorplan')
  assert.equal(hashForState('stock-alerts', null, DEFAULT_TAB), '#/stock-alerts')
})

test('hashForState: an open item wins over the tab, and is URI-encoded', () => {
  assert.equal(hashForState('overview', 'abc123', DEFAULT_TAB), '#/items/abc123')
  assert.equal(hashForState('inventory', 'has space', DEFAULT_TAB), '#/items/has%20space')
})

test('parseHash: empty/missing hash resolves to the default tab', () => {
  assert.deepEqual(parseHash('', TAB_IDS, DEFAULT_TAB), { tab: 'inventory', itemId: null })
  assert.deepEqual(parseHash(null, TAB_IDS, DEFAULT_TAB), { tab: 'inventory', itemId: null })
  assert.deepEqual(parseHash('#/', TAB_IDS, DEFAULT_TAB), { tab: 'inventory', itemId: null })
})

test('parseHash: a known tab id resolves to that tab', () => {
  assert.deepEqual(parseHash('#/floorplan', TAB_IDS, DEFAULT_TAB), { tab: 'floorplan', itemId: null })
  assert.deepEqual(parseHash('#/stock-alerts', TAB_IDS, DEFAULT_TAB), { tab: 'stock-alerts', itemId: null })
})

test('parseHash: an unknown tab id falls back to the default tab', () => {
  assert.deepEqual(parseHash('#/not-a-real-tab', TAB_IDS, DEFAULT_TAB), { tab: 'inventory', itemId: null })
})

test('parseHash: "#/items/<id>" yields the item id with no tab opinion', () => {
  assert.deepEqual(parseHash('#/items/abc123', TAB_IDS, DEFAULT_TAB), { tab: null, itemId: 'abc123' })
})

test('parseHash: item ids round-trip through hashForState\'s encoding', () => {
  const hash = hashForState('inventory', 'has space/slash', DEFAULT_TAB)
  assert.deepEqual(parseHash(hash, TAB_IDS, DEFAULT_TAB), { tab: null, itemId: 'has space/slash' })
})
