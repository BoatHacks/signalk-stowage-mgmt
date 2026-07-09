import {
  h, html, render, Component, createContext,
  useState, useEffect, useRef, useCallback, useContext, useMemo
} from '../vendor/preact-htm-standalone.js';
import { api } from './api.js';
import { renderMarkdown } from './markdown.js';
import { ICONS } from './icons.js';
import {
  childLocations, itemsIn, descendantIds, pathToRoot, locationHasAnyItems,
  isUnderstocked, deriveNameFromSvgElementId, buildInventoryMarkdown,
  buildShoppingListMarkdown
} from './helpers.js';
import { getPreferredTheme, applyTheme } from './theme.js';

var POLL_INTERVAL_MS = 5000;
var PHOTO_VIEWPORT_SIZE = 280;
var PHOTO_OUTPUT_SIZE = 300;

var AppCtx = createContext(null);
function useApp() { return useContext(AppCtx); }

// ---------- small shared bits ----------

function Icon(props) {
  return html`<span class="icon" dangerouslySetInnerHTML=${{ __html: ICONS[props.name] || '' }}></span>`;
}

function IconBtn(props) {
  var cls = 'icon-btn' + (props.danger ? ' danger' : '');
  return html`
    <button type="button" class=${cls} title=${props.title} aria-label=${props.title} onClick=${props.onClick}>
      <${Icon} name=${props.icon} />
    </button>
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
    app.updateItem(item.id, { actual_quantity: v }).catch(app.showToast);
  }

  if (!isEditing) {
    var label = (props.prefix || '') + '\u00d7' + item.actual_quantity;
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
                onClick=${function (e) { e.stopPropagation(); setValue(Math.max(0, (parseInt(value, 10) || 0) + 1)); }}>&#9650;</button>
        <button type="button" class="qty-step qty-down" onMouseDown=${function (e) { e.preventDefault(); }}
                onClick=${function (e) { e.stopPropagation(); setValue(Math.max(0, (parseInt(value, 10) || 0) - 1)); }}>&#9660;</button>
      </span>
    </span>
  `;
}

export { AppCtx, useApp, Icon, IconBtn, Toast, QuantityEditor, POLL_INTERVAL_MS, PHOTO_VIEWPORT_SIZE, PHOTO_OUTPUT_SIZE };
