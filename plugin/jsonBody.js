// A minimal stand-in for express.json() so this plugin doesn't need its own
// `express` dependency — the router passed into registerWithRouter() by
// Signal K server already behaves like an Express router (.get/.post/.patch/
// .delete/.use all work on it directly), so the only thing we actually
// needed express for was JSON body parsing.
function jsonBodyParser ({ limit = 1024 * 1024 } = {}) {
  return function (req, res, next) {
    // If something upstream (e.g. the host server's own body-parsing
    // middleware) already parsed this request, req.body will already be
    // set. Reading the request stream a second time in that case finds it
    // already drained: our 'data'/'end' listeners then never fire, and the
    // request hangs forever instead of completing. Deferring to whatever
    // already ran avoids that entirely.
    if (req.body !== undefined) return next()

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

    // Safety net: if the body stream never completes for any reason, fail
    // the request instead of hanging it forever.
    const timeout = setTimeout(() => {
      if (aborted) return
      aborted = true
      res.status(408).json({ error: 'timed out waiting for request body' })
      req.destroy()
    }, 30000)

    req.on('data', (chunk) => {
      if (aborted) return
      received += chunk.length
      if (received > limit) {
        aborted = true
        clearTimeout(timeout)
        res.status(413).json({ error: 'request body too large' })
        req.destroy()
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => {
      if (aborted) return
      clearTimeout(timeout)
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

    req.on('error', (err) => {
      clearTimeout(timeout)
      next(err)
    })
  }
}

module.exports = { jsonBodyParser }
