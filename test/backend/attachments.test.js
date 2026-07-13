const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { startTestServer } = require('../../test-helpers/server')

test('attachments: upload (any file type, no size limit), list, and byte-exact download', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const item = await (await server.post('/items', { name: 'Fuse' })).json()
  const payload = Buffer.from('hello attachments test, arbitrary bytes here');

  const uploaded = await (await server.postRaw(`/items/${item.id}/attachments`, payload, {
    'Content-Type': 'application/octet-stream',
    'X-Filename': encodeURIComponent('weird name (v2).bin')
  })).json()
  assert.equal(uploaded.filename, 'weird name (v2).bin')
  assert.equal(uploaded.mime_type, 'application/octet-stream')
  assert.equal(uploaded.size, payload.length)

  const list = await (await server.get(`/items/${item.id}/attachments`)).json()
  assert.equal(list.length, 1)
  assert.equal(list[0].id, uploaded.id)

  const downloadRes = await server.get(`/items/${item.id}/attachments/${uploaded.id}`)
  assert.equal(downloadRes.status, 200)
  const downloaded = Buffer.from(await downloadRes.arrayBuffer())
  assert.ok(downloaded.equals(payload))
  assert.match(downloadRes.headers.get('content-disposition'), /weird name/)
})

test('attachments: missing X-Filename defaults to "attachment"', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const item = await (await server.post('/items', { name: 'Fuse' })).json()
  const uploaded = await (await server.postRaw(`/items/${item.id}/attachments`, Buffer.from('data'), {})).json()
  assert.equal(uploaded.filename, 'attachment')
})

test('attachments: 404 for uploads/downloads against a non-existent item or attachment', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const uploadToMissing = await server.postRaw('/items/nope/attachments', Buffer.from('x'), {})
  assert.equal(uploadToMissing.status, 404)

  const item = await (await server.post('/items', { name: 'Fuse' })).json()
  const downloadMissing = await server.get(`/items/${item.id}/attachments/nope`)
  assert.equal(downloadMissing.status, 404)
})

test('attachments: delete removes the row and the file, list reflects it', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const item = await (await server.post('/items', { name: 'Fuse' })).json()
  const uploaded = await (await server.postRaw(`/items/${item.id}/attachments`, Buffer.from('data'), {})).json()

  const del = await server.delete(`/items/${item.id}/attachments/${uploaded.id}`)
  assert.equal(del.status, 204)

  const list = await (await server.get(`/items/${item.id}/attachments`)).json()
  assert.equal(list.length, 0)
  assert.equal((await server.get(`/items/${item.id}/attachments/${uploaded.id}`)).status, 404)
})

test('attachments: deleting the item cleans up its attachment files on disk', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const item = await (await server.post('/items', { name: 'Fuse' })).json()
  await server.postRaw(`/items/${item.id}/attachments`, Buffer.from('data'), {})

  const itemAttachmentDir = path.join(server.dataDir, 'attachments', item.id)
  assert.ok(fs.existsSync(itemAttachmentDir))

  await server.delete(`/items/${item.id}`)
  // Cleanup is fire-and-forget (fs.rm callback-style) — give it a tick.
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.ok(!fs.existsSync(itemAttachmentDir))
})
