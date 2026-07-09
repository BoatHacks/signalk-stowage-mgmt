import { html, useState } from '../vendor/preact-htm-standalone.js';
import { useApp } from './app-core.js';
import { ItemChip } from './app-nodes.js';
import { pathToRoot } from './helpers.js';

export function CategoriesTab() {
  var app = useApp();
  var expandedState = useState({});
  var expanded = expandedState[0], setExpanded = expandedState[1];
  var newNameState = useState('');
  var newName = newNameState[0], setNewName = newNameState[1];

  function toggle(id) {
    var next = Object.assign({}, expanded);
    next[id] = !next[id];
    setExpanded(next);
  }

  function createCategory() {
    var name = newName.trim();
    if (!name) return;
    app.createCategory(name).then(function () { setNewName(''); }).catch(function () {});
  }

  return html`
    <section class="tab-panel active">
      <div class="toolbar">
        <input type="text" placeholder="New category name" value=${newName}
               onInput=${function (e) { setNewName(e.target.value); }}
               onKeyDown=${function (e) { if (e.key === 'Enter') createCategory(); }} />
        <button type="button" onClick=${createCategory}>+ Category</button>
      </div>
      <div class="categories-list">
        ${!app.data.categories.length ? html`<p class="hint">No categories created yet.</p>` : null}
        ${app.data.categories.map(function (cat) {
          var items = app.data.items.filter(function (i) { return (i.categories || []).some(function (c) { return c.id === cat.id; }); });
          var isExpanded = !!expanded[cat.id];
          return html`
            <div class="category-fold" key=${cat.id}>
              <div class="category-row category-fold-header" onClick=${function () { toggle(cat.id); }}>
                <span><span class="fold-arrow">${isExpanded ? '\u25be' : '\u25b8'}</span>${cat.name}<span class="category-count">${items.length} Item(s)</span></span>
                <span class="node-actions">
                  <button type="button" onClick=${function (e) {
                    e.stopPropagation();
                    var name = prompt('New name:', cat.name);
                    if (name && name !== cat.name) app.renameCategory(cat.id, name).catch(function () {});
                  }}>Rename</button>
                  <button type="button" onClick=${function (e) {
                    e.stopPropagation();
                    var warning = items.length ? ' It is currently assigned to ' + items.length + ' item(s) \u2014 this assignment will also be removed.' : '';
                    if (confirm('Really delete category "' + cat.name + '"?' + warning)) app.deleteCategory(cat.id).catch(function () {});
                  }}>Delete</button>
                </span>
              </div>
              ${isExpanded ? html`
                <div class="category-fold-body">
                  ${!items.length ? html`<p class="hint">No items in this category.</p>` : null}
                  ${items.map(function (item) { return html`
                    <div class="category-fold-item" key=${item.id}>
                      <div class="category-fold-item-location hint">${item.location_id ? pathToRoot(app.data, item.location_id) : 'no location'}</div>
                      <${ItemChip} item=${item} />
                    </div>
                  `; })}
                </div>
              ` : null}
            </div>
          `;
        })}
      </div>
    </section>
  `;
}
