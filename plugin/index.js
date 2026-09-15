const fs = require('fs')
const path = require('path')
const { initDb } = require('./db')
const { jsonBodyParser } = require('./jsonBody')
const { publishStockAlerts } = require('./stockAlerts')
const registerLocationRoutes = require('./routes/locations')
const registerItemRoutes = require('./routes/items')
const registerFloorplanRoutes = require('./routes/floorplans')
const registerCategoryRoutes = require('./routes/categories')
const registerItemLogRoutes = require('./routes/itemLog')
const registerAttachmentRoutes = require('./routes/attachments')
const registerBackupRoutes = require('./routes/backup')
const registerConfigRoutes = require('./routes/config')

const PLUGIN_ID = 'signalk-stowage-mgmt'

// status-tiles-examples.json ships ready-made signalk-status-tiles tiles for
// notifications.stowage.* (issue #64) — see doc/sharing-example-tile-sets.md
// in meri-imperiumi/signalk-status-tiles for the contract this implements.
const stockAlertsTileExamples = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'status-tiles-examples.json'), 'utf8')
)

module.exports = function (app) {
  const plugin = {}
  plugin.id = PLUGIN_ID
  plugin.name = 'Stowage Management'
  plugin.description = 'Organize items into containers and storage spaces, and locate them on an SVG floorplan.'

  let db = null
  let dataDir = null
  let pluginOptions = {}
  let stockAlertsTimer = null
  let running = false
  let tileExamplesProviderRegistered = false

  // Read-only statusTileExamples resource provider, per
  // doc/sharing-example-tile-sets.md. Returns {} while stopped so a
  // disabled plugin contributes no stale entries; the providerRegistered
  // guard keeps a stop()-then-start() (a config save) from double-registering.
  function registerTileExamplesProvider () {
    if (tileExamplesProviderRegistered) return
    if (typeof app.registerResourceProvider !== 'function') {
      app.debug(`${PLUGIN_ID}: server has no resource provider registry; status-tiles examples disabled`)
      return
    }
    app.registerResourceProvider({
      type: 'statusTileExamples',
      methods: {
        listResources: async () => (running ? { [PLUGIN_ID]: stockAlertsTileExamples } : {}),
        getResource: async (id) => {
          if (!running || id !== PLUGIN_ID) {
            throw new Error(`No such statusTileExamples resource: ${id}`)
          }
          return stockAlertsTileExamples
        },
        setResource: async () => { throw new Error(`${PLUGIN_ID} is a read-only provider`) },
        deleteResource: async () => { throw new Error(`${PLUGIN_ID} is a read-only provider`) }
      }
    })
    tileExamplesProviderRegistered = true
  }

  // Recomputes and republishes notifications.stowage.{stock,expiring,overall}
  // (issue #64) — called after every write that can change stock/expiration
  // status, plus on an hourly timer below to catch pure calendar drift
  // (a forecast's days-remaining shrinking, or an item crossing into the
  // expiring window) that happens with no new write at all.
  function recomputeStockAlerts () {
    if (!db) return
    try {
      publishStockAlerts(app, db, pluginOptions)
    } catch (err) {
      app.error(err)
    }
  }

  plugin.start = function (options) {
    pluginOptions = options || {}
    dataDir = typeof app.getDataDirPath === 'function'
      ? app.getDataDirPath()
      : path.join(__dirname, '..', 'data')
    db = initDb(dataDir)
    app.debug(`SignalK Stowage Management: database ready at ${dataDir}`)
    recomputeStockAlerts()
    stockAlertsTimer = setInterval(recomputeStockAlerts, 60 * 60 * 1000)
    running = true
    registerTileExamplesProvider()
  }

  plugin.stop = function () {
    running = false
    if (stockAlertsTimer) {
      clearInterval(stockAlertsTimer)
      stockAlertsTimer = null
    }
    if (db) {
      db.close()
      db = null
    }
  }

  plugin.schema = {
    type: 'object',
    properties: {
      autoTheme: {
        type: 'boolean',
        title: 'Automatically switch light/dark theme based on sun position',
        description:
          'Webapp follows vessels.self.environment.sun (preferred - dawn/sunrise/day/sunset/dusk/night) or vessels.self.environment.mode (simpler day/night fallback) instead of the manual light/dark toggle. Needs a plugin like signalk-derived-data publishing one of those paths.',
        default: false
      },
      dynamicQuantityScale: {
        type: 'boolean',
        title: 'Dynamic +/- scale for touch interface',
        description:
          'Overview tab Touch view: the -/+ buttons\u2019 step grows with the quantity (1 for small counts, 10 in the hundreds, 100 in the thousands, and so on) instead of always stepping by 1. Useful once you start tracking bulk goods by weight/volume (e.g. grams) rather than by piece.',
        default: false
      },
      qrLabelBaseUrl: {
        type: 'string',
        title: 'Server URL for QR labels',
        description:
          'Absolute base URL (e.g. http://192.168.1.50:3000) that a printed location QR label\u2019s link points at. Signal K plugins can\u2019t reliably auto-detect the right LAN address/hostname, so the webapp pre-fills this from the browser\u2019s own address when you open the Print Labels page \u2014 only set this if that guess would be wrong (e.g. labels generated from a device other than the boat\u2019s own display).',
        default: ''
      },
      detailPageSections: {
        type: 'array',
        title: 'Item detail page sections',
        description:
          'Which sections appear on an item\u2019s detail page, and in what order. Remove a section to hide it; reorder to change where it appears. All five are shown by default. When the Floorplan section is hidden, a "Locate on floorplan" button appears in Placements instead.',
        items: {
          type: 'string',
          enum: ['placements', 'floorplan', 'history', 'properties', 'attachments'],
          enumNames: ['Placements', 'Floorplan', 'History', 'Properties', 'Attachments']
        },
        default: ['placements', 'floorplan', 'history', 'properties', 'attachments']
      },
      publishStockAlertsNotification: {
        type: 'boolean',
        title: 'Publish stock alert status to Signal K',
        description:
          'Publishes notifications.stowage.stock, notifications.stowage.expiring, and notifications.stowage.overall summarizing understocked/out-of-stock/expiring items and a forecasted runway, for dashboards like signalk-status-tiles to consume (issue #64).',
        default: true
      },
      stockAlertsForecastWindowDays: {
        type: 'number',
        title: 'Consumption forecast window (days)',
        description:
          'Trailing window of Store Log history used to estimate each item’s consumption rate for the runway forecast below.',
        default: 30
      },
      stockAlertsRunwayWarnDays: {
        type: 'number',
        title: 'Forecast runway warning threshold (days)',
        description: 'An item forecasted to run out within this many days marks notifications.stowage.stock as warn.',
        default: 7
      },
      stockAlertsRunwayCritDays: {
        type: 'number',
        title: 'Forecast runway critical threshold (days)',
        description: 'An item forecasted to run out within this many days marks notifications.stowage.stock as alarm.',
        default: 2
      },
      stockAlertsStaleDays: {
        type: 'number',
        title: 'Inventory staleness threshold (days)',
        description: 'No inventory activity in this many days marks notifications.stowage.stock as warn.',
        default: 7
      },
      stockAlertsExpiringWindowDays: {
        type: 'number',
        title: 'Expiring-soon window (days)',
        description: 'An item with an expiration date within this many days marks notifications.stowage.expiring as warn.',
        default: 14
      }
    }
  }

  plugin.getOpenApi = function () {
    return require('../openApi.json')
  }

  // The server mounts this router under /plugins/signalk-stowage-mgmt
  plugin.registerWithRouter = function (router) {
    router.use(jsonBodyParser({ limit: 15 * 1024 * 1024 })) // floorplan SVGs can be a few MB

    registerLocationRoutes(router, () => db)
    registerItemRoutes(router, () => db, () => dataDir, recomputeStockAlerts)
    registerFloorplanRoutes(router, () => db)
    registerCategoryRoutes(router, () => db)
    registerItemLogRoutes(router, () => db)
    registerAttachmentRoutes(router, () => db, () => dataDir)
    registerBackupRoutes(router, () => db)
    registerConfigRoutes(router, app, () => pluginOptions)

    // eslint-disable-next-line no-unused-vars
    router.use((err, req, res, next) => {
      app.error(err)
      res.status(err.statusCode || 500).json({ error: err.message || 'internal error' })
    })
  }

  return plugin
}
