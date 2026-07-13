import { html, useState } from '../vendor/preact-htm-standalone.js';
import { useApp, IconBtn, Icon, QuantityEditor } from './app-core.js';
import { childLocations, resolvedItemsIn, isSplit } from './helpers.js';

// ---------- item chip ----------

export function ItemChip(props) {
  var item = props.item;
  var app = useApp();
  var draggingState = useState(false);
  var dragging = draggingState[0];
  var setDragging = draggingState[1];

  var split = isSplit(item);
  var isPlacementRow = item.placementId !== undefined && item.placementId !== null;

  var thumb = item.thumbnail
    ? html`<img class="item-thumb" src=${item.thumbnail} alt="" />`
    : html`<span class="item-thumb item-thumb-placeholder"></span>`;

  var categoryBadges = (item.categories || []).map(function (cat) {
    return html`
      <span class="category-badge" key=${cat.id}>
        <span class="type-icon"><${Icon} name="tag" title="Category" /></span>${cat.name}
        <button type="button" class="category-badge-remove" title=${'Remove "' + cat.name + '" from this item'}
                onClick=${function (e) { e.stopPropagation(); app.removeItemCategory(item.id, cat.id); }}>×</button>
      </span>
    `;
  });

  function deleteWholeItem () {
    var warning = split ? ' This item is split across ' + item.placements.length + ' locations — deleting it removes all of them.' : '';
    if (!confirm('Really delete "' + item.name + '"?' + warning)) return;
    app.deleteItem(item, true);
  }

  return html`
    <div class="item-row ${dragging ? 'dragging' : ''}"
         draggable="true"
         onDragStart=${function (e) {
           e.dataTransfer.effectAllowed = 'move';
           e.dataTransfer.setData('text/plain', item.id);
           e.dataTransfer.setData('application/x-drag-type', 'item');
           e.dataTransfer.setData('application/x-placement-id', item.placementId || '');
           setDragging(true);
           app.setDragActive(true);
         }}
         onDragEnd=${function () { setDragging(false); app.setDragActive(false); }}>
      <div class="item-row-main">
        <span>
          ${thumb}<span class="type-icon"><${Icon} name="dot" title="Item" /></span>${item.name}
          ${isPlacementRow
            ? html`<${QuantityEditor} item=${item} placementId=${item.placementId} className="qty split-qty" />`
            : html`<${QuantityEditor} item=${item} className="qty" />`}
          ${item.target_quantity !== null && item.target_quantity !== undefined
            ? html`<span class="qty-target-inline"> / ${item.target_quantity}</span>`
            : null}
          ${split ? html`<span class="split-badge" title=${item.placements.length + ' locations'}>split \u00d7${item.placements.length}</span>` : null}
        </span>
        <span>
          <${IconBtn} icon="edit" title="Edit" onClick=${function () { app.openPropertiesModal(item); }} />
          <${IconBtn} icon="photo" title="Photo" onClick=${function () { app.openPhotoModal(item); }} />
          <${IconBtn} icon="split" title="Split this item across another location"
                      onClick=${function () { app.openSplitModal(item, isPlacementRow ? (item.placements.find(function (p) { return p.id === item.placementId; }) || {}).location_id : item.location_id); }} />
          <${IconBtn} icon="move" title="Move"
                      onClick=${function () {
                        if (isPlacementRow) app.openMoveModal('placement', item);
                        else app.openMoveModal('item', item);
                      }} />
          <${IconBtn} icon="delete" title="Delete" danger=${true} onClick=${deleteWholeItem} />
        </span>
      </div>
      <div class="item-categories">
        ${categoryBadges}
        <${IconBtn} icon="add-tag" title="Add category" onClick=${function () { app.openCategoryModal(item); }} />
      </div>
    </div>
  `;
}

// ---------- location node (storage space / container), recursive ----------

export function LocationNode(props) {
  var loc = props.loc;
  var app = useApp();
  var draggingState = useState(false);
  var dragging = draggingState[0];
  var setDragging = draggingState[1];
  var dropTargetState = useState(false);
  var isDropTarget = dropTargetState[0];
  var setIsDropTarget = dropTargetState[1];

  var children = childLocations(app.data, loc.id);
  var items = resolvedItemsIn(app.data, loc.id);
  var isContainer = loc.type === 'container';
  var mapped = loc.type === 'storage_space' && loc.svg_element_id;

  function handleDrop(e) {
    e.preventDefault();
    setIsDropTarget(false);
    var dragType = e.dataTransfer.getData('application/x-drag-type');
    var draggedId = e.dataTransfer.getData('text/plain');
    var placementId = e.dataTransfer.getData('application/x-placement-id');
    if (!draggedId) return;
    if (dragType === 'container') {
      if (draggedId === loc.id) return;
      app.moveContainer(draggedId, loc.id);
    } else if (placementId) {
      app.movePlacementTo(draggedId, placementId, loc.id);
    } else {
      app.moveItemTo(draggedId, loc.id);
    }
  }

  return html`
    <div class="node">
      <div class="node-header ${isContainer ? 'draggable-node' : ''} ${dragging ? 'dragging' : ''} ${isDropTarget ? 'drop-target' : ''}"
           draggable=${isContainer ? 'true' : 'false'}
           onDragStart=${isContainer ? function (e) {
             e.stopPropagation();
             e.dataTransfer.effectAllowed = 'move';
             e.dataTransfer.setData('text/plain', loc.id);
             e.dataTransfer.setData('application/x-drag-type', 'container');
             setDragging(true);
             app.setDragActive(true);
           } : null}
           onDragEnd=${isContainer ? function () { setDragging(false); app.setDragActive(false); } : null}
           onDragEnter=${function (e) { e.preventDefault(); }}
           onDragOver=${function (e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setIsDropTarget(true); }}
           onDragLeave=${function () { setIsDropTarget(false); }}
           onDrop=${handleDrop}>
        <span class="node-title"><span class="type-icon"><${Icon} name=${isContainer ? 'box' : 'cabinet'} title=${isContainer ? 'Container' : 'Storage space'} /></span>${loc.name}${mapped ? html`<span class="svg-mapped-badge">on plan</span>` : null}</span>
        <span class="node-actions">
          <${IconBtn} icon="add-cabinet" title="Add storage space" onClick=${function () { app.addStorageSpace(loc.id); }} />
          <${IconBtn} icon="add-box" title="Add container" onClick=${function () { app.addContainer(loc.id); }} />
          <${IconBtn} icon="plus" title="Add item" onClick=${function () { app.addItem(loc.id); }} />
          <${IconBtn} icon="edit" title="Rename" onClick=${function () { app.renameLocation(loc); }} />
          ${!isContainer ? html`<button type="button" title="Manually set the SVG area id this storage space maps to" onClick=${function () { app.setManualSvgId(loc); }}>ID</button>` : null}
          ${isContainer ? html`<${IconBtn} icon="move" title="Move" onClick=${function () { app.openMoveModal('container', loc); }} />` : null}
          <${IconBtn} icon="delete" title="Delete" danger=${true} onClick=${function () { app.deleteLocation(loc); }} />
        </span>
      </div>
      ${(children.length || items.length) ? html`
        <div class="children">
          ${children.map(function (child) { return html`<${LocationNode} loc=${child} key=${child.id} />`; })}
          ${items.map(function (item) { return html`<${ItemChip} item=${item} key=${item.id + ':' + (item.placementId || '')} />`; })}
        </div>
      ` : null}
    </div>
  `;
}

// ---------- "Not Stored" panel ----------

export function NotStoredPanel() {
  var app = useApp();
  var orphanedContainers = childLocations(app.data, null).filter(function (l) { return l.type === 'container'; });
  var unassignedItems = resolvedItemsIn(app.data, null);
  var hasOrphans = orphanedContainers.length > 0 || unassignedItems.length > 0;
  var visible = app.dragActive || hasOrphans;
  var hiddenForTab = app.activeTab === 'overview' || app.activeTab === 'categories' || app.activeTab === 'understocked' || app.activeTab === 'expiring' || app.activeTab === 'storelog';

  var dropTargetState = useState(false);
  var isDropTarget = dropTargetState[0];
  var setIsDropTarget = dropTargetState[1];

  function handleDrop(e) {
    e.preventDefault();
    setIsDropTarget(false);
    var dragType = e.dataTransfer.getData('application/x-drag-type');
    var draggedId = e.dataTransfer.getData('text/plain');
    var placementId = e.dataTransfer.getData('application/x-placement-id');
    if (!draggedId) return;
    if (dragType === 'container') app.moveContainer(draggedId, null);
    else if (placementId) app.movePlacementTo(draggedId, placementId, null);
    else app.moveItemTo(draggedId, null);
  }

  if (hiddenForTab || !visible) return null;

  return html`
    <div class="orphaned-panel">
      <div class="orphaned-panel-title">Not Stored</div>
      <div class="node-header ${isDropTarget ? 'drop-target' : ''}"
           onDragEnter=${function (e) { e.preventDefault(); }}
           onDragOver=${function (e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setIsDropTarget(true); }}
           onDragLeave=${function () { setIsDropTarget(false); }}
           onDrop=${handleDrop}>
        <span class="node-title">Drop here to unassign</span>
      </div>
      ${orphanedContainers.map(function (loc) { return html`<${LocationNode} loc=${loc} key=${loc.id} />`; })}
      ${unassignedItems.length ? html`
        <div class="children">
          ${unassignedItems.map(function (item) { return html`<${ItemChip} item=${item} key=${item.id + ':' + (item.placementId || '')} />`; })}
        </div>
      ` : null}
      ${!hasOrphans ? html`<p class="hint">Nothing unstored right now.</p>` : null}
    </div>
  `;
}

// ---------- "Drop here to split" panel ----------

export function SplitDropPanel() {
  var app = useApp();
  var hiddenForTab = app.activeTab === 'overview' || app.activeTab === 'categories' || app.activeTab === 'understocked' || app.activeTab === 'expiring' || app.activeTab === 'storelog';

  var dropTargetState = useState(false);
  var isDropTarget = dropTargetState[0];
  var setIsDropTarget = dropTargetState[1];

  function handleDrop(e) {
    e.preventDefault();
    setIsDropTarget(false);
    var dragType = e.dataTransfer.getData('application/x-drag-type');
    var draggedId = e.dataTransfer.getData('text/plain');
    var placementId = e.dataTransfer.getData('application/x-placement-id');
    if (dragType !== 'item' || !draggedId) return;
    var item = app.data.items.find(function (i) { return i.id === draggedId; });
    if (!item) return;
    var fromLocationId = placementId
      ? ((item.placements.find(function (p) { return p.id === placementId; }) || {}).location_id || null)
      : (item.location_id || null);
    app.openSplitModal(item, fromLocationId);
  }

  if (hiddenForTab || !app.dragActive) return null;

  return html`
    <div class="orphaned-panel split-drop-panel">
      <div class="orphaned-panel-title">Split</div>
      <div class="node-header ${isDropTarget ? 'drop-target' : ''}"
           onDragEnter=${function (e) { e.preventDefault(); }}
           onDragOver=${function (e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setIsDropTarget(true); }}
           onDragLeave=${function () { setIsDropTarget(false); }}
           onDrop=${handleDrop}>
        <span class="node-title">Drop here to split</span>
      </div>
    </div>
  `;
}
