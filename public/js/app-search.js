import { h, html, useState } from '../vendor/preact-htm-standalone.js';
import { useApp, Icon } from './app-core.js';
import { ItemChip } from './app-nodes.js';

export function SearchBox() {
  var app = useApp();
  var queryState = useState('');
  var query = queryState[0], setQuery = queryState[1];
  var openState = useState(false);
  var open = openState[0], setOpen = openState[1];

  var results = query.trim()
    ? app.data.items.filter(function (i) { return i.name.toLowerCase().indexOf(query.trim().toLowerCase()) !== -1; }).slice(0, 8)
    : [];

  function pick(item) {
    setQuery(item.name);
    setOpen(false);
    app.locateItem(item);
  }

  return html`
    <div class="search-box">
      <input type="text" placeholder="Search items…" autocomplete="off" value=${query}
             onInput=${function (e) { setQuery(e.target.value); setOpen(true); }}
             onFocus=${function () { setOpen(true); }}
             onBlur=${function () { setTimeout(function () { setOpen(false); }, 150); }} />
      <div class=${'search-results' + (open && query.trim() ? ' open' : '')}>
        ${!results.length ? html`<div class="search-result">No results</div>` : null}
        ${results.map(function (item) {
          return html`<div class="search-result" key=${item.id} onMouseDown=${function () { pick(item); }}>${item.name}</div>`;
        })}
      </div>
    </div>
  `;
}

export function LocateItemPopup() {
  var app = useApp();
  if (!app.locatePopupItem) return null;
  var liveItem = app.data.items.find(function (i) { return i.id === app.locatePopupItem.id; }) || app.locatePopupItem;
  return html`
    <div class="locate-item-popup">
      <button class="modal-close locate-item-popup-close" aria-label="Close" onClick=${app.closeLocatePopup}>×</button>
      <div class="orphaned-panel-title">Found</div>
      <${ItemChip} item=${liveItem} />
    </div>
  `;
}

export function ThemeToggle() {
  var app = useApp();
  return html`
    <button type="button" class="theme-toggle" title="Toggle light/dark theme" aria-label="Toggle light/dark theme"
            onClick=${function () { app.setTheme(app.theme === 'dark' ? 'light' : 'dark'); }}>
      <${Icon} name=${app.theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  `;
}
