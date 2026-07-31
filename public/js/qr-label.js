// Pure logic for QR location labels: building the deep-link URL a label's
// QR code encodes, parsing it back out of the page's query string, and
// composing the label's SVG (QR code + centered logo overlay). No DOM
// access here beyond string manipulation, so this is testable the same
// way helpers.js is (no JSDOM needed).
import qrcode from '../vendor/qrcode-generator.mjs';

// The deep link a location's QR code encodes: <base>/plugins/signalk-stowage-mgmt/?location=<id>.
// baseUrl is expected to already be an absolute origin (e.g.
// "http://192.168.1.50:3000"), with or without a trailing slash.
export function locationDeepLink(baseUrl, locationId) {
  var base = (baseUrl || '').replace(/\/+$/, '');
  return base + '/plugins/signalk-stowage-mgmt/?location=' + encodeURIComponent(locationId);
}

// Reads the `location` query param out of a location.search-shaped string
// (e.g. "?location=abc123"), or null if absent.
export function parseLocationParam(search) {
  var params = new URLSearchParams(search || '');
  return params.get('location') || null;
}

// Builds a label's SVG: a scannable QR code (error-correction level 'H',
// which tolerates ~30% obstruction) encoding `url`, with `logoUrl` (any
// URL an <image> element can resolve — a static asset path is fine, no
// need for a data: URI — or falsy to skip) centered on top in a white
// keep-out square sized to stay within that error-correction budget.
export function buildLabelSvg(url, opts) {
  opts = opts || {};
  var cellSize = opts.cellSize || 4;
  var margin = typeof opts.margin === 'number' ? opts.margin : cellSize * 2;

  var qr = qrcode(0, 'H');
  qr.addData(url);
  qr.make();
  var svg = qr.createSvgTag({ cellSize: cellSize, margin: margin, scalable: true });

  if (!opts.logoUrl) return svg;

  var size = qr.getModuleCount() * cellSize + margin * 2;
  // Keep the logo well inside level H's ~30% redundancy budget so the
  // code stays scannable even with a logo covering the center.
  var logoSize = Math.round(size * 0.22);
  var offset = (size - logoSize) / 2;
  var overlay =
    '<rect x="' + offset + '" y="' + offset + '" width="' + logoSize + '" height="' + logoSize + '" fill="white"/>' +
    '<image x="' + offset + '" y="' + offset + '" width="' + logoSize + '" height="' + logoSize +
    '" href="' + opts.logoUrl + '" preserveAspectRatio="xMidYMid meet"/>';
  return svg.replace('</svg>', overlay + '</svg>');
}
