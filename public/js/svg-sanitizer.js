// Minimal allowlist-based sanitizer for untrusted floorplan SVG uploads.
//
// Floorplans are user-uploaded (or third-party-supplied) SVG files that get
// injected into the DOM via innerHTML for area-click/hover interaction
// (see FloorplanSvg in app-floorplan-modals.js). Raw SVG can carry <script>,
// event-handler attributes (onload/onerror/onclick/...), <foreignObject>
// HTML, and javascript:/data: URLs — all of which execute even when the
// markup is inserted via innerHTML. A floorplan only ever needs shapes,
// groups, gradients, and basic styling, so this strips everything else down
// to a conservative allowlist rather than trying to blocklist every known
// XSS vector.

var ALLOWED_TAGS = [
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline',
  'line', 'text', 'tspan', 'defs', 'title', 'desc', 'style',
  'clippath', 'lineargradient', 'radialgradient', 'stop', 'symbol',
  'marker', 'pattern'
];

var ALLOWED_ATTRS = [
  'id', 'class', 'style', 'transform', 'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
  'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'points', 'viewbox',
  'xmlns', 'version', 'fill', 'fill-opacity', 'fill-rule', 'stroke',
  'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin',
  'stroke-dasharray', 'opacity', 'font-family', 'font-size', 'font-weight',
  'text-anchor', 'offset', 'stop-color', 'stop-opacity', 'gradientunits',
  'gradienttransform', 'preserveaspectratio', 'clip-path', 'clip-rule',
  'marker-start', 'marker-end', 'marker-mid'
];

// CSS inside <style> can't run script directly, but old/legacy engines
// supported script-like behavior via these constructs — stripped out
// wholesale rather than trying to parse CSS properly.
var UNSAFE_CSS_PATTERN = /expression\s*\(|@import|javascript:|-moz-binding|behavior\s*:/i;
var DANGEROUS_URL_PATTERN = /^\s*(javascript|data|vbscript):/i;

function sanitizeAttributes(el) {
  Array.prototype.slice.call(el.attributes || []).forEach(function (attr) {
    var name = attr.name.toLowerCase();
    var isEventHandler = name.indexOf('on') === 0;
    var isAllowed = ALLOWED_ATTRS.indexOf(name) !== -1;
    var isDangerousUrl = DANGEROUS_URL_PATTERN.test(attr.value || '');
    if (isEventHandler || !isAllowed || isDangerousUrl) {
      el.removeAttribute(attr.name);
    }
  });
}

function stripUnsafeNodes(node) {
  Array.prototype.slice.call(node.children || []).forEach(function (el) {
    var tag = el.tagName.toLowerCase();
    if (ALLOWED_TAGS.indexOf(tag) === -1) {
      el.remove();
      return;
    }
    sanitizeAttributes(el);
    if (tag === 'style') {
      if (UNSAFE_CSS_PATTERN.test(el.textContent || '')) el.textContent = '';
    } else {
      stripUnsafeNodes(el);
    }
  });
}

// Parses an SVG string, strips it down to an allowlist of safe
// elements/attributes, and returns the sanitized markup as a string — or
// null if the input doesn't parse as a valid SVG document.
export function sanitizeSvg(svgText) {
  var doc = new DOMParser().parseFromString(svgText || '', 'image/svg+xml');
  var root = doc.querySelector('svg');
  if (!root || doc.querySelector('parsererror')) return null;
  sanitizeAttributes(root);
  stripUnsafeNodes(root);
  return new XMLSerializer().serializeToString(root);
}
