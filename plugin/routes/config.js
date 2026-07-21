// Copied from signalk-dead-mans-switch's auto-theme feature: recommends
// 'light' or 'dark' for the webapp based on vessels.self.environment.sun
// (preferred - dawn/sunrise/day/sunset/dusk/night, set by a plugin like
// signalk-derived-data) or vessels.self.environment.mode (a simpler
// day/night fallback some setups use instead).

// "day" is the only phase/mode treated as light - everything else (dawn/
// sunrise/sunset/dusk/night for environment.sun; anything other than "day"
// for environment.mode) is treated as dark, protecting night vision from
// dusk through dawn, not just once it's fully dark.
const SUN_DARK_PHASES = new Set(['dawn', 'sunrise', 'sunset', 'dusk', 'night'])

// app.getSelfPath() may return either the raw leaf value or the full tree
// node ({ value, timestamp, $source }) wrapping it, depending on server
// version - this unwraps either shape to the plain value.
function unwrapPlainValue (raw) {
  if (raw && typeof raw === 'object' && 'value' in raw) return raw.value
  return raw
}

module.exports = function registerConfigRoutes (router, app, getOptions) {
  // Recommends 'light' or 'dark', or null if autoTheme is off, there's no
  // app.getSelfPath support, or neither environment path has a recognized
  // value yet. Read fresh on every /config call (already polled regularly
  // by the frontend) rather than maintained via a subscription.
  function computeThemeRecommendation () {
    const options = getOptions() || {}
    if (!options.autoTheme) return null
    if (typeof app.getSelfPath !== 'function') return null

    let sun
    try {
      sun = unwrapPlainValue(app.getSelfPath('environment.sun'))
    } catch (err) {
      sun = undefined
    }
    if (sun === 'day') return 'light'
    if (SUN_DARK_PHASES.has(sun)) return 'dark'

    let mode
    try {
      mode = unwrapPlainValue(app.getSelfPath('environment.mode'))
    } catch (err) {
      mode = undefined
    }
    if (typeof mode === 'string') {
      const normalized = mode.toLowerCase()
      if (normalized === 'day') return 'light'
      if (normalized === 'night') return 'dark'
    }

    return null
  }

  router.get('/config', (req, res) => {
    const options = getOptions() || {}
    res.json({
      autoTheme: !!options.autoTheme,
      themeRecommendation: computeThemeRecommendation()
    })
  })
}
