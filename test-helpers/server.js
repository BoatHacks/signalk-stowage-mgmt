const express = require('express')
const fs = require('fs')
const os = require('os')
const path = require('path')

const pluginFactory = require('../plugin/index.js')

// Boots a real instance of the plugin (same registerWithRouter() path the
// actual SignalK server uses) against a throwaway temp directory, and
// returns helpers for making real HTTP requests against it. Every call
// gets its own fresh SQLite db — no shared state between tests.
async function startTestServer () {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stowage-test-'))
  const fakeApp = {
    debug: () => {},
    error: () => {},
    getDataDirPath: () => dataDir
  }

  const plugin = pluginFactory(fakeApp)
  plugin.start({})

  const app = express()
  const router = express.Router()
  plugin.registerWithRouter(router)
  app.use('/plugins/signalk-stowage-mgmt', router)

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  const port = server.address().port
  const baseUrl = `http://127.0.0.1:${port}/plugins/signalk-stowage-mgmt`

  async function get (p) { return fetch(baseUrl + p) }
  async function post (p, body) {
    return fetch(baseUrl + p, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  }
  async function patch (p, body) {
    return fetch(baseUrl + p, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  }
  async function del (p) { return fetch(baseUrl + p, { method: 'DELETE' }) }
  // Raw upload: body is bytes, not JSON — mirrors how the frontend uploads
  // attachments (see public/js/api.js uploadRaw).
  async function postRaw (p, body, headers) {
    return fetch(baseUrl + p, { method: 'POST', headers: headers || {}, body })
  }

  return {
    baseUrl,
    dataDir,
    get,
    post,
    patch,
    delete: del,
    postRaw,
    async close () {
      plugin.stop()
      await new Promise((resolve) => server.close(resolve))
      fs.rmSync(dataDir, { recursive: true, force: true })
    }
  }
}

module.exports = { startTestServer }
