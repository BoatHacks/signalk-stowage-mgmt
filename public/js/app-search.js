import { html, useState } from '../vendor/preact-htm-standalone.js';
import { useApp, Icon, makeLocateOnChipClick } from './app-core.js';
import { ItemChip } from './app-nodes.js';

export function SearchBox() {
  var app = useApp();
  // The query lives in app-level state (app.searchQuery), not locally —
  // it also drives live-filtering of the Inventory tree and Overview rows
  // (SPEC.md §6.3), so both the dropdown below and those other tabs read
  // the same value.
  var query = app.searchQuery;
  var setQuery = app.setSearchQuery;
  var openState = useState(false);
  var open = openState[0], setOpen = openState[1];

  var q = query.trim().toLowerCase();
  var results = q
    ? app.data.items
        .map(function (item) {
          var nameMatch = item.name.toLowerCase().indexOf(q) !== -1;
          var notesIndex = item.notes ? item.notes.toLowerCase().indexOf(q) : -1;
          if (!nameMatch && notesIndex === -1) return null;
          return { item: item, noteSnippet: (!nameMatch && notesIndex !== -1) ? noteSnippetAround(item.notes, notesIndex, q.length) : null };
        })
        .filter(Boolean)
        .slice(0, 8)
    : [];

  // Opens the item's detail page instead of attempting a floorplan locate
  // — the old behavior did nothing useful for an item with no floorplan
  // mapping (issue #45). "Locate on floorplan" is still available, as a
  // button inside the detail page's Placements section when applicable.
  function pick(item) {
    setOpen(false);
    app.selectItem(item.id);
  }

  return html`
    <div class="search-box">
      <input type="text" placeholder="Search items…" autocomplete="off" value=${query}
             onInput=${function (e) { setQuery(e.target.value); setOpen(true); }}
             onFocus=${function () { setOpen(true); }}
             onBlur=${function () { setTimeout(function () { setOpen(false); }, 150); }} />
      <div class=${'search-results' + (open && query.trim() ? ' open' : '')}>
        ${!results.length ? html`<div class="search-result">No results</div>` : null}
        ${results.map(function (r) {
          return html`
            <div class="search-result" key=${r.item.id} onMouseDown=${function () { pick(r.item); }}>
              <div>${r.item.name}</div>
              ${r.noteSnippet ? html`<div class="search-result-snippet">${r.noteSnippet}</div>` : null}
            </div>
          `;
        })}
      </div>
    </div>
  `;
}

// Builds a short "...text around the match..." snippet from an item's
// notes, for search results that matched on notes rather than name.
function noteSnippetAround (notes, matchIndex, matchLength) {
  var radius = 40;
  var start = Math.max(0, matchIndex - radius);
  var end = Math.min(notes.length, matchIndex + matchLength + radius);
  var snippet = notes.slice(start, end).replace(/\s+/g, ' ').trim();
  return (start > 0 ? '\u2026' : '') + snippet + (end < notes.length ? '\u2026' : '');
}

export function LocateItemPopup() {
  var app = useApp();
  if (!app.locatePopupItem) return null;
  var liveItem = app.data.items.find(function (i) { return i.id === app.locatePopupItem.id; }) || app.locatePopupItem;

  return html`
    <div class="locate-item-popup">
      <button class="modal-close locate-item-popup-close" aria-label="Close" onClick=${app.closeLocatePopup}>×</button>
      <div class="orphaned-panel-title">Found</div>
      <div onClick=${makeLocateOnChipClick(app, liveItem)}>
        <${ItemChip} item=${liveItem} />
      </div>
    </div>
  `;
}

export function EditModeToggle() {
  var app = useApp();
  var label = app.editMode ? 'Turn off edit mode' : 'Turn on edit mode';
  return html`
    <button type="button" class=${'edit-mode-toggle' + (app.editMode ? ' active' : '')} title=${label} aria-label=${label}
            onClick=${app.toggleEditMode}>
      <${Icon} name="edit" />
    </button>
  `;
}

export function ThemeToggle() {
  var app = useApp();
  var label = app.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  return html`
    <button type="button" class="theme-toggle" title=${label} aria-label=${label}
            onClick=${function () { app.setTheme(app.theme === 'dark' ? 'light' : 'dark'); }}>
      <${Icon} name=${app.theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  `;
}
