import {
  html, createContext,
  useState, useEffect, useRef, useContext
} from '../vendor/preact-htm-standalone.js';
import { ICONS } from './icons.js';
import { isSplit } from './helpers.js';

var POLL_INTERVAL_MS = 5000;
var PHOTO_VIEWPORT_SIZE = 280;
var PHOTO_OUTPUT_SIZE = 300;

var AppCtx = createContext(null);
function useApp() { return useContext(AppCtx); }

// ---------- small shared bits ----------

function Icon(props) {
  return html`<span class="icon" title=${props.title || null} aria-label=${props.title || null} dangerouslySetInnerHTML=${{ __html: ICONS[props.name] || '' }}></span>`;
}

function IconBtn(props) {
  var cls = 'icon-btn' + (props.danger ? ' danger' : '');
  return html`
    <button type="button" class=${cls} title=${props.title} aria-label=${props.title} onClick=${props.onClick}>
      <${Icon} name=${props.icon} />
    </button>
  `;
}

// Wraps a chip/node's row of action buttons (edit, move, delete, etc.).
// When the global edit-mode toggle is on, all of them are always shown.
// When it's off, they collapse behind a single "..." button — clicking it
// temporarily reveals them for just that one chip (chipKey must be unique
// per chip/node); clicking "..." again, or opening a different chip's
// menu, collapses it back. Only one chip's menu can be open at a time.
function ChipActionsMenu (props) {
  var app = useApp();
  var isOpen = app.editMode || app.expandedChipKey === props.chipKey;
  return html`
    <span class=${props.className}>
      ${!app.editMode ? html`
        <${IconBtn} icon="more" title=${isOpen ? 'Hide actions' : 'Show actions'}
                    onClick=${function () { app.toggleExpandedChip(props.chipKey); }} />
      ` : null}
      ${isOpen ? props.children : null}
    </span>
  `;
}

function Toast() {
  var app = useApp();
  if (!app.toastMessage) return null;
  return html`<div class="toast show">${app.toastMessage}</div>`;
}

// Editable actual-quantity control: click to reveal a number input with
// +/- steppers; commits on blur/Enter, cancels on Escape.
function QuantityEditor(props) {
  var item = props.item;
  var app = useApp();
  var editing = useState(false);
  var isEditing = editing[0];
  var setEditing = editing[1];
  var valueState = useState(item.actual_quantity);
  var value = valueState[0];
  var setValue = valueState[1];
  var inputRef = useRef(null);

  useEffect(function () {
    if (!isEditing) setValue(item.actual_quantity);
  }, [item.actual_quantity, isEditing]);

  useEffect(function () {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  function commit() {
    var v = Math.max(0, parseInt(value, 10) || 0);
    setEditing(false);
    if (v === item.actual_quantity) return;
    if (props.placementId) {
      app.setPlacementQuantity(item.id, props.placementId, v, null).catch(function () {});
    } else {
      app.updateItem(item.id, { actual_quantity: v }).catch(function () {});
    }
  }

  if (!isEditing) {
    var label = (props.prefix || '') + '\u00d7' + item.actual_quantity;
    if (isSplit(item) && !props.placementId) {
      return html`
        <span class=${'qty-display' + (props.className ? ' ' + props.className : '')}
              title="This item is split across multiple locations — use Split to change its quantity.">
          ${label}
        </span>
      `;
    }
    return html`
      <span class=${'qty-display' + (props.className ? ' ' + props.className : '')}
            title="Click to edit quantity"
            onClick=${function (e) { e.stopPropagation(); setEditing(true); }}>
        ${label}
      </span>
    `;
  }

  return html`
    <span class="qty-editor" onClick=${function (e) { e.stopPropagation(); }}>
      <input ref=${inputRef} type="number" class="qty-input" min="0" step="1" value=${value}
             onInput=${function (e) { setValue(e.target.value); }}
             onKeyDown=${function (e) {
               if (e.key === 'Enter') commit();
               else if (e.key === 'Escape') setEditing(false);
             }}
             onBlur=${commit} />
      <span class="qty-steppers">
        <button type="button" class="qty-step qty-up" onMouseDown=${function (e) { e.preventDefault(); }}
                onClick=${function (e) { e.stopPropagation(); setValue(Math.max(0, (parseInt(value, 10) || 0) + 1)); }}>\u25b2</button>
        <button type="button" class="qty-step qty-down" onMouseDown=${function (e) { e.preventDefault(); }}
                onClick=${function (e) { e.stopPropagation(); setValue(Math.max(0, (parseInt(value, 10) || 0) - 1)); }}>\u25bc</button>
      </span>
    </span>
  `;
}

export { AppCtx, useApp, Icon, IconBtn, Toast, QuantityEditor, ChipActionsMenu, POLL_INTERVAL_MS, PHOTO_VIEWPORT_SIZE, PHOTO_OUTPUT_SIZE };
