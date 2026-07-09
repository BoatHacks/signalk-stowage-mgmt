const path = require('path')
const { initDb } = require('./db')
const { jsonBodyParser } = require('./jsonBody')
const registerLocationRoutes = require('./routes/locations')
const registerItemRoutes = require('./routes/items')
const registerFloorplanRoutes = require('./routes/floorplans')
const registerCategoryRoutes = require('./routes/categories')

module.exports = function (app) {
  const plugin = {}
  plugin.id = 'signalk-stowage-mgmt'
  plugin.name = 'Stowage Management'
  plugin.description = 'Organize items into containers and storage spaces, and locate them on an SVG floorplan.'

  let db = null

  plugin.start = function (options) {
    const dataDir = typeof app.getDataDirPath === 'function'
      ? app.getDataDirPath()
      : path.join(__dirname, '..', 'data')
    db = initDb(dataDir)
    app.debug(`SignalK Stowage Management: database ready at ${dataDir}`)
  }

  plugin.stop = function () {
    if (db) {
      db.close()
      db = null
    }
  }

  plugin.schema = {
    type: 'object',
    properties: {}
  }

  plugin.getOpenApi = function () {
    return require('../openApi.json')
  }

  // The server mounts this router under /plugins/signalk-stowage-mgmt
  plugin.registerWithRouter = function (router) {
    router.use(jsonBodyParser({ limit: 15 * 1024 * 1024 })) // floorplan SVGs can be a few MB

    registerLocationRoutes(router, () => db)
    registerItemRoutes(router, () => db)
    registerFloorplanRoutes(router, () => db)
    registerCategoryRoutes(router, () => db)

    // eslint-disable-next-line no-unused-vars
    router.use((err, req, res, next) => {
      app.error(err)
      res.status(err.statusCode || 500).json({ error: err.message || 'internal error' })
    })
  }

  return plugin
}
