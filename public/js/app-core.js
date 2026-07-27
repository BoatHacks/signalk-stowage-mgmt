import {
  html, createContext,
  useState, useEffect, useRef, useContext
} from '../vendor/preact-htm-standalone.js';
import { ICONS } from './icons.js';
import { isSplit, defaultPlacementFor } from './helpers.js';

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
      ${isOpen ? props.children : null}
      ${!app.editMode ? html`
        <${IconBtn} icon="more" title=${isOpen ? 'Hide actions' : 'Show actions'}
                    onClick=${function () { app.toggleExpandedChip(props.chipKey); }} />
      ` : null}
    </span>
  `;
}

// A click handler for a wrapper around an ItemChip that should locate the
// item on the floorplan when the chip's main body is clicked, but not when
// one of the chip's own interactive bits is (edit/photo/split/move/delete,
// category add/remove, the quantity stepper's click-to-edit).
function makeLocateOnChipClick (app, item) {
  return function (e) {
    if (e.target.closest('.item-actions, .item-categories, .qty, button, input')) return;
    app.locateItem(item);
  };
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
  // A split item with a default storage location set edits/displays that
  // placement's own quantity here, exactly as if it had been passed
  // explicitly via props.placementId — this is what lets the quick +/-
  // editors on Overview/Categories/etc. act on "the usual place" for an
  // item that's also got some stock elsewhere (e.g. beans mostly in the
  // galley, a few extra in the bilge).
  var defaultPlacement = props.placementId ? null : defaultPlacementFor(item);
  var effectivePlacementId = props.placementId || (defaultPlacement && defaultPlacement.id) || null;
  var effectiveQuantity = defaultPlacement ? defaultPlacement.quantity : item.actual_quantity;
  // On overview-style listings (props.showTotal) the pre-edit number should
  // always be the item's total across all locations, even when a default
  // placement is set — that's what "how much of this do I have" means in a
  // list of items. Editing still targets the default placement's own
  // quantity, exactly as before; only the displayed label changes.
  var displayQuantity = props.showTotal ? item.actual_quantity : effectiveQuantity;

  var editing = useState(false);
  var isEditing = editing[0];
  var setEditing = editing[1];
  var valueState = useState(effectiveQuantity);
  var value = valueState[0];
  var setValue = valueState[1];
  var inputRef = useRef(null);

  useEffect(function () {
    if (!isEditing) setValue(effectiveQuantity);
  }, [effectiveQuantity, isEditing]);

  useEffect(function () {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  function commit() {
    var v = Math.max(0, parseInt(value, 10) || 0);
    setEditing(false);
    if (v === effectiveQuantity) return;
    if (effectivePlacementId) {
      app.setPlacementQuantity(item.id, effectivePlacementId, v, null).catch(function () {});
    } else {
      app.updateItem(item.id, { actual_quantity: v }).catch(function () {});
    }
  }

  if (!isEditing) {
    var label = (props.prefix || '') + '\u00d7' + displayQuantity;
    if (isSplit(item) && !effectivePlacementId) {
      return html`
        <span class=${'qty-display' + (props.className ? ' ' + props.className : '')}
              title="This item is split across multiple locations — use Split to change its quantity, or set a default storage location in Item Properties to enable quick edits here.">
          ${label}
        </span>
      `;
    }
    var title = defaultPlacement
      ? (props.showTotal
        ? 'Total across all locations. Click to edit its default location (' +
          (defaultPlacement.location_name || 'unnamed') + '): ' + defaultPlacement.quantity + '.'
        : 'Quantity at its default location (' + (defaultPlacement.location_name || 'unnamed') + '). ' +
          'Click to edit — total across all locations: ' + item.actual_quantity + '.')
      : 'Click to edit quantity';
    return html`
      <span class=${'qty-display' + (props.className ? ' ' + props.className : '')}
            title=${title}
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

export { AppCtx, useApp, Icon, IconBtn, Toast, QuantityEditor, ChipActionsMenu, makeLocateOnChipClick, POLL_INTERVAL_MS, PHOTO_VIEWPORT_SIZE, PHOTO_OUTPUT_SIZE };
