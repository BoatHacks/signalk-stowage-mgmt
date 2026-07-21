const { test } = require('node:test')
const assert = require('node:assert/strict')
const { startTestServer } = require('../../test-helpers/server')

test('config: autoTheme off by default, no recommendation', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const body = await (await server.get('/config')).json()
  assert.deepEqual(body, { autoTheme: false, themeRecommendation: null })
})

test('config: autoTheme on but no getSelfPath support -> no recommendation', async (t) => {
  const server = await startTestServer({ options: { autoTheme: true } })
  t.after(() => server.close())

  const body = await (await server.get('/config')).json()
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

  assert.equal((await (await server.get('/config')).json()).themeRecommendation, 'light')

  for (const phase of ['dawn', 'sunrise', 'sunset', 'dusk', 'night']) {
    sunValue = phase
    const body = await (await server.get('/config')).json()
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

  const body = await (await server.get('/config')).json()
  assert.equal(body.themeRecommendation, 'dark')
})

test('config: unwraps a {value, timestamp, $source}-shaped getSelfPath result', async (t) => {
  const server = await startTestServer({
    options: { autoTheme: true },
    getSelfPath: (path) => (path === 'environment.sun' ? { value: 'day', timestamp: '2026-01-01', $source: 'x' } : undefined)
  })
  t.after(() => server.close())

  const body = await (await server.get('/config')).json()
  assert.equal(body.themeRecommendation, 'light')
})

test('config: a throwing getSelfPath does not crash the endpoint', async (t) => {
  const server = await startTestServer({
    options: { autoTheme: true },
    getSelfPath: () => { throw new Error('no such path') }
  })
  t.after(() => server.close())

  const res = await server.get('/config')
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

  const body = await (await server.get('/config')).json()
  assert.equal(body.autoTheme, false)
  assert.equal(body.themeRecommendation, null)
})
