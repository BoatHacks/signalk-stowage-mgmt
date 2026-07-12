const fs = require('fs')
const path = require('path')
const { randomUUID } = require('crypto')
const { attachmentDir, attachmentPath, deleteAttachmentFile } = require('../attachmentsStore')

// File attachments for items (manuals, spec sheets, receipts — issue #15).
// Unlike the thumbnail (a small data: URI stored directly in the items
// table), attachments have no size limit and no type restriction, so they're
// streamed straight to disk instead of buffering them into a JSON body.
// The upload request body is the raw file bytes; the jsonBodyParser
// middleware only touches requests with an `application/json` content type,
// so it leaves this stream untouched for us to read here.
module.exports = function registerAttachmentRoutes (router, getDb, getDataDir) {
  function db () {
    const instance = getDb()
    if (!instance) throw Object.assign(new Error('database not ready'), { statusCode: 503 })
    return instance
  }

  function getItemOr404 (id, res) {
    const item = db().prepare('SELECT * FROM items WHERE id = ?').get(id)
    if (!item) {
      res.status(404).json({ error: 'not found' })
      return null
    }
    return item
  }

  const ATTACHMENT_FIELDS = 'id, item_id, filename, mime_type, size, uploaded_at'

  router.get('/items/:id/attachments', (req, res) => {
    const item = getItemOr404(req.params.id, res)
    if (!item) return
    res.json(db().prepare(`SELECT ${ATTACHMENT_FIELDS} FROM item_attachments WHERE item_id = ? ORDER BY uploaded_at`).all(item.id))
  })

  // Body: raw file bytes. Original filename comes in the X-Filename header
  // (URI-encoded, since headers can't safely carry arbitrary UTF-8), mime
  // type comes from Content-Type. Both are display-only metadata — the file
  // itself is written under a server-generated attachment id, never the
  // client-supplied filename.
  router.post('/items/:id/attachments', (req, res) => {
    const item = getItemOr404(req.params.id, res)
    if (!item) return

    let filename = 'attachment'
    const filenameHeader = req.headers['x-filename']
    if (filenameHeader) {
      try { filename = decodeURIComponent(filenameHeader) } catch (err) { filename = String(filenameHeader) }
    }
    // Strip any path separators a client might (accidentally or not) send —
    // this is only ever used for display/Content-Disposition, but there's
    // no reason to let it look like a path.
    filename = filename.split(/[\\/]/).pop() || 'attachment'
    const mimeType = (req.headers['content-type'] || 'application/octet-stream').split(';')[0].trim()

    const id = randomUUID()
    const dir = attachmentDir(getDataDir(), item.id)
    const filePath = attachmentPath(getDataDir(), item.id, id)

    let size = 0
    let settled = false

    function fail (statusCode, message) {
      if (settled) return
      settled = true
      fs.unlink(filePath, () => {})
      if (!res.headersSent) res.status(statusCode).json({ error: message })
    }

    try {
      fs.mkdirSync(dir, { recursive: true })
    } catch (err) {
      return fail(500, 'could not create attachment storage directory')
    }

    const writeStream = fs.createWriteStream(filePath)
    req.on('data', (chunk) => { size += chunk.length })
    req.on('error', () => fail(400, 'upload interrupted'))
    writeStream.on('error', () => fail(500, 'failed to write attachment to disk'))
    writeStream.on('finish', () => {
      if (settled) return
      settled = true
      db().prepare(
        'INSERT INTO item_attachments (id, item_id, filename, mime_type, size) VALUES (?, ?, ?, ?, ?)'
      ).run(id, item.id, filename, mimeType, size)
      res.status(201).json(db().prepare(`SELECT ${ATTACHMENT_FIELDS} FROM item_attachments WHERE id = ?`).get(id))
    })
    req.pipe(writeStream)
  })

  // Serves the raw file so the browser can handle it natively (render
  // inline for PDFs/images, download for anything else).
  router.get('/items/:id/attachments/:attachmentId', (req, res) => {
    const item = getItemOr404(req.params.id, res)
    if (!item) return
    const att = db().prepare('SELECT * FROM item_attachments WHERE id = ? AND item_id = ?').get(req.params.attachmentId, item.id)
    if (!att) return res.status(404).json({ error: 'not found' })

    const filePath = attachmentPath(getDataDir(), item.id, att.id)
    fs.stat(filePath, (err) => {
      if (err) return res.status(404).json({ error: 'attachment file missing on disk' })
      res.setHeader('Content-Type', att.mime_type || 'application/octet-stream')
      const safeName = att.filename.replace(/"/g, '')
      res.setHeader('Content-Disposition', `inline; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(att.filename)}`)
      fs.createReadStream(filePath).pipe(res)
    })
  })

  router.delete('/items/:id/attachments/:attachmentId', (req, res) => {
    const item = getItemOr404(req.params.id, res)
    if (!item) return
    const att = db().prepare('SELECT * FROM item_attachments WHERE id = ? AND item_id = ?').get(req.params.attachmentId, item.id)
    if (!att) return res.status(404).json({ error: 'not found' })
    db().prepare('DELETE FROM item_attachments WHERE id = ?').run(att.id)
    deleteAttachmentFile(getDataDir(), item.id, att.id)
    res.status(204).end()
  })
}
