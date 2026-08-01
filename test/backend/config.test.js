const { test } = require('node:test')
const assert = require('node:assert/strict')
const { startTestServer } = require('../../test-helpers/server')

test('config: autoTheme and dynamicQuantityScale off by default, no recommendation, no qrLabelBaseUrl', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const body = await (await server.get('/webapp-config')).json()
  assert.deepEqual(body, {
    autoTheme: false, themeRecommendation: null, dynamicQuantityScale: false, qrLabelBaseUrl: '',
    detailPageSections: ['placements', 'history', 'properties', 'attachments']
  })
})

test('config: detailPageSections reflects the plugin option when set, including an explicit empty array', async (t) => {
  const server = await startTestServer({ options: { detailPageSections: ['history', 'placements'] } })
  t.after(() => server.close())

  const body = await (await server.get('/webapp-config')).json()
  assert.deepEqual(body.detailPageSections, ['history', 'placements'])

  const emptyServer = await startTestServer({ options: { detailPageSections: [] } })
  t.after(() => emptyServer.close())
  const emptyBody = await (await emptyServer.get('/webapp-config')).json()
  assert.deepEqual(emptyBody.detailPageSections, [])
})

test('config: qrLabelBaseUrl reflects the plugin option when set', async (t) => {
  const server = await startTestServer({ options: { qrLabelBaseUrl: 'http://192.168.1.50:3000' } })
  t.after(() => server.close())

  const body = await (await server.get('/webapp-config')).json()
  assert.equal(body.qrLabelBaseUrl, 'http://192.168.1.50:3000')
})

test('config: dynamicQuantityScale reflects the plugin option when enabled', async (t) => {
  const server = await startTestServer({ options: { dynamicQuantityScale: true } })
  t.after(() => server.close())

  const body = await (await server.get('/webapp-config')).json()
  assert.equal(body.dynamicQuantityScale, true)
})

test('config: autoTheme on but no getSelfPath support -> no recommendation', async (t) => {
  const server = await startTestServer({ options: { autoTheme: true } })
  t.after(() => server.close())

  const body = await (await server.get('/webapp-config')).json()
  assert.equal(body.autoTheme, true)
  assert.equal(body.themeRecommendation, null)
})

test('config: environment.sun "day" -> light, dark phases -> dark', async (t) => {
  let sunValue = 'day'
  const server = await startTestServer({
    options: { autoTheme: true },
    getSelfPath: (path) => (path === 'environment.sun' ? sunValue : undefined)
  })
  t.after(() => server.close())

  assert.equal((await (await server.get('/webapp-config')).json()).themeRecommendation, 'light')

  for (const phase of ['dawn', 'sunrise', 'sunset', 'dusk', 'night']) {
    sunValue = phase
    const body = await (await server.get('/webapp-config')).json()
    assert.equal(body.themeRecommendation, 'dark', `phase ${phase} should recommend dark`)
  }
})

test('config: falls back to environment.mode (case-insensitive) when environment.sun is unset', async (t) => {
  const server = await startTestServer({
    options: { autoTheme: true },
    getSelfPath: (path) => {
      if (path === 'environment.sun') return undefined
      if (path === 'environment.mode') return 'NIGHT'
      return undefined
    }
  })
  t.after(() => server.close())

  const body = await (await server.get('/webapp-config')).json()
  assert.equal(body.themeRecommendation, 'dark')
})

test('config: unwraps a {value, timestamp, $source}-shaped getSelfPath result', async (t) => {
  const server = await startTestServer({
    options: { autoTheme: true },
    getSelfPath: (path) => (path === 'environment.sun' ? { value: 'day', timestamp: '2026-01-01', $source: 'x' } : undefined)
  })
  t.after(() => server.close())

  const body = await (await server.get('/webapp-config')).json()
  assert.equal(body.themeRecommendation, 'light')
})

test('config: a throwing getSelfPath does not crash the endpoint', async (t) => {
  const server = await startTestServer({
    options: { autoTheme: true },
    getSelfPath: () => { throw new Error('no such path') }
  })
  t.after(() => server.close())

  const res = await server.get('/webapp-config')
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.themeRecommendation, null)
})

test('config: autoTheme off overrides an otherwise-valid recommendation', async (t) => {
  const server = await startTestServer({
    options: { autoTheme: false },
    getSelfPath: (path) => (path === 'environment.sun' ? 'night' : undefined)
  })
  t.after(() => server.close())

  const body = await (await server.get('/webapp-config')).json()
  assert.equal(body.autoTheme, false)
  assert.equal(body.themeRecommendation, null)
})
