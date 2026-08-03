// Hashtag navigation (issue #54): the address bar tracks the active tab
// and, independent of tab, the open item detail page — as `#/`,
// `#/<tab-id>`, or `#/items/<item-id>` — so the browser's back/forward
// buttons work and any of those states can be bookmarked/deep-linked.
// Pure string<->state functions so they're testable without a DOM; app.js
// is the only caller that touches window.location/history.

function hashForState(tabId, itemId, defaultTabId) {
  if (itemId) return '#/items/' + encodeURIComponent(itemId);
  if (tabId === defaultTabId) return '#/';
  return '#/' + tabId;
}

function parseHash(hash, tabIds, defaultTabId) {
  var path = String(hash || '').replace(/^#\/?/, '');
  if (!path) return { tab: defaultTabId, itemId: null };

  var itemMatch = path.match(/^items\/(.+)$/);
  if (itemMatch) return { tab: null, itemId: decodeURIComponent(itemMatch[1]) };

  if (tabIds.indexOf(path) !== -1) return { tab: path, itemId: null };
  return { tab: defaultTabId, itemId: null };
}

export { hashForState, parseHash };
