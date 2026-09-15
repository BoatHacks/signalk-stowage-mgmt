const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const pluginFactory = require('../../plugin/index.js')

// Covers the statusTileExamples resource provider registration
// (doc/sharing-example-tile-sets.md in meri-imperiumi/signalk-status-tiles,
// issue #64) — not exercised via startTestServer since that helper's
// fakeApp has no registerResourceProvider.

function fakeAppWithProvider () {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stowage-tileexamples-test-'))
  let provider = null
  return {
    app: {
      debug: () => {},
      error: () => {},
      getDataDirPath: () => dataDir,
      registerResourceProvider: (p) => { provider = p }
    },
    getProvider: () => provider,
    dataDir
  }
}

test('statusTileExamples: listResources returns the examples keyed by plugin id while running', async (t) => {
  const { app, getProvider, dataDir } = fakeAppWithProvider()
  const plugin = pluginFactory(app)
  plugin.start({})
  t.after(() => { plugin.stop(); fs.rmSync(dataDir, { recursive: true, force: true }) })

  const provider = getProvider()
  assert.equal(provider.type, 'statusTileExamples')

  const result = await provider.methods.listResources()
  assert.ok(result['signalk-stowage-mgmt'])
  const setIds = result['signalk-stowage-mgmt'].sets.map((s) => s.id)
  assert.deepEqual(setIds, ['stowage-stock', 'stowage-expiring', 'stowage-overall'])
})

test('statusTileExamples: getResource returns the same object for the plugin\'s own id, throws for any other', async (t) => {
  const { app, getProvider, dataDir } = fakeAppWithProvider()
  const plugin = pluginFactory(app)
  plugin.start({})
  t.after(() => { plugin.stop(); fs.rmSync(dataDir, { recursive: true, force: true }) })

  const provider = getProvider()
  const resource = await provider.methods.getResource('signalk-stowage-mgmt')
  assert.ok(resource.sets)
  await assert.rejects(() => provider.methods.getResource('some-other-plugin'))
})

test('statusTileExamples: listResources returns {} once stopped (no stale entries)', async (t) => {
  const { app, getProvider, dataDir } = fakeAppWithProvider()
  const plugin = pluginFactory(app)
  plugin.start({})
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }))

  const provider = getProvider()
  plugin.stop()
  const result = await provider.methods.listResources()
  assert.deepEqual(result, {})
})

test('statusTileExamples: is read-only — setResource/deleteResource always throw', async (t) => {
  const { app, getProvider, dataDir } = fakeAppWithProvider()
  const plugin = pluginFactory(app)
  plugin.start({})
  t.after(() => { plugin.stop(); fs.rmSync(dataDir, { recursive: true, force: true }) })

  const provider = getProvider()
  await assert.rejects(() => provider.methods.setResource())
  await assert.rejects(() => provider.methods.deleteResource())
})

test('statusTileExamples: a restart (stop then start) does not double-register the provider', async (t) => {
  let registerCount = 0
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stowage-tileexamples-test-'))
  const app = {
    debug: () => {},
    error: () => {},
    getDataDirPath: () => dataDir,
    registerResourceProvider: () => { registerCount += 1 }
  }
  const plugin = pluginFactory(app)
  plugin.start({})
  plugin.stop()
  plugin.start({})
  t.after(() => { plugin.stop(); fs.rmSync(dataDir, { recursive: true, force: true }) })

  assert.equal(registerCount, 1)
})

test('statusTileExamples: gracefully no-ops on a host with no registerResourceProvider', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stowage-tileexamples-test-'))
  const app = { debug: () => {}, error: () => {}, getDataDirPath: () => dataDir }
  const plugin = pluginFactory(app)
  assert.doesNotThrow(() => plugin.start({}))
  t.after(() => { plugin.stop(); fs.rmSync(dataDir, { recursive: true, force: true }) })
})

test('every tile in status-tiles-examples.json uses the standard notification/severityMap shape', () => {
  const examples = require('../../plugin/status-tiles-examples.json')
  assert.ok(examples.sets.length > 0)
  for (const set of examples.sets) {
    assert.match(set.id, /^[A-Za-z][A-Za-z0-9_-]*$/)
    assert.ok(set.tiles.length > 0)
    for (const tile of set.tiles) {
      assert.equal(tile.checks.length, 1)
      assert.equal(tile.checks[0].type, 'notification')
      assert.match(tile.checks[0].path, /^notifications\.stowage\./)
      assert.deepEqual(Object.keys(tile.checks[0].severityMap).sort(), ['alarm', 'normal', 'warn'])
    }
  }
})
