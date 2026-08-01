import { test } from 'node:test'
import assert from 'node:assert/strict'
import { locationDeepLink, itemDeepLink, parseLocationParam, parseItemParam, buildLabelSvg } from '../../public/js/qr-label.js'

test('locationDeepLink: builds the deep link, trimming a trailing slash on the base URL', () => {
  assert.equal(
    locationDeepLink('http://192.168.1.50:3000', 'loc-1'),
    'http://192.168.1.50:3000/signalk-stowage-mgmt/?location=loc-1'
  )
  assert.equal(
    locationDeepLink('http://192.168.1.50:3000/', 'loc-1'),
    'http://192.168.1.50:3000/signalk-stowage-mgmt/?location=loc-1'
  )
})

test('locationDeepLink: URI-encodes the location id', () => {
  assert.equal(
    locationDeepLink('http://x', 'loc with spaces'),
    'http://x/signalk-stowage-mgmt/?location=loc%20with%20spaces'
  )
})

test('itemDeepLink: builds the deep link, trimming a trailing slash on the base URL', () => {
  assert.equal(
    itemDeepLink('http://192.168.1.50:3000', 'item-1'),
    'http://192.168.1.50:3000/signalk-stowage-mgmt/?item=item-1'
  )
  assert.equal(
    itemDeepLink('http://192.168.1.50:3000/', 'item-1'),
    'http://192.168.1.50:3000/signalk-stowage-mgmt/?item=item-1'
  )
})

test('itemDeepLink: URI-encodes the item id', () => {
  assert.equal(
    itemDeepLink('http://x', 'item with spaces'),
    'http://x/signalk-stowage-mgmt/?item=item%20with%20spaces'
  )
})

test('parseLocationParam: reads the location query param, or null if absent', () => {
  assert.equal(parseLocationParam('?location=abc123'), 'abc123')
  assert.equal(parseLocationParam('?foo=bar'), null)
  assert.equal(parseLocationParam(''), null)
  assert.equal(parseLocationParam(null), null)
})

test('parseItemParam: reads the item query param, or null if absent', () => {
  assert.equal(parseItemParam('?item=abc123'), 'abc123')
  assert.equal(parseItemParam('?foo=bar'), null)
  assert.equal(parseItemParam(''), null)
  assert.equal(parseItemParam(null), null)
})

test('buildLabelSvg: produces a scannable SVG QR code with no logo', () => {
  const svg = buildLabelSvg('http://x/signalk-stowage-mgmt/?location=loc-1')
  assert.match(svg, /^<svg/)
  assert.match(svg, /<\/svg>$/)
  assert.doesNotMatch(svg, /<image/)
})

test('buildLabelSvg: overlays a centered logo when logoUrl is given', () => {
  const svg = buildLabelSvg('http://x/signalk-stowage-mgmt/?location=loc-1', {
    logoUrl: 'assets/icons/icon-512.png'
  })
  assert.match(svg, /<image x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+" href="assets\/icons\/icon-512\.png"/)
  // The white keep-out rect must come before the image so the image renders on top of it.
  assert.ok(svg.indexOf('<rect') < svg.indexOf('<image'))
})

test('buildLabelSvg: different location ids produce different QR data (not a static image)', () => {
  const a = buildLabelSvg('http://x/signalk-stowage-mgmt/?location=loc-1')
  const b = buildLabelSvg('http://x/signalk-stowage-mgmt/?location=loc-2')
  assert.notEqual(a, b)
})
