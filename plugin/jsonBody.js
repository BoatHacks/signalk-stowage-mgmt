// A minimal stand-in for express.json() so this plugin doesn't need its own
// `express` dependency — the router passed into registerWithRouter() by
// Signal K server already behaves like an Express router (.get/.post/.patch/
// .delete/.use all work on it directly), so the only thing we actually
// needed express for was JSON body parsing.
function jsonBodyParser ({ limit = 1024 * 1024 } = {}) {
  return function (req, res, next) {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'DELETE') {
      req.body = {}
      return next()
    }

    const contentType = req.headers['content-type'] || ''
    if (!contentType.includes('application/json')) {
      req.body = {}
      return next()
    }

    let received = 0
    const chunks = []
    let aborted = false

    req.on('data', (chunk) => {
      if (aborted) return
      received += chunk.length
      if (received > limit) {
        aborted = true
        res.status(413).json({ error: 'request body too large' })
        req.destroy()
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => {
      if (aborted) return
      if (!chunks.length) {
        req.body = {}
        return next()
      }
      try {
        req.body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        next()
      } catch (err) {
        res.status(400).json({ error: 'invalid JSON body' })
      }
    })

    req.on('error', (err) => next(err))
  }
}

module.exports = { jsonBodyParser }
