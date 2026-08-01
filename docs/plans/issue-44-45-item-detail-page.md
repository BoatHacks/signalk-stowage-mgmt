# Implementation Plan: Issues #44, #45 — Item detail page

## Overview

Add a dedicated item detail view (full-view, not a modal) showing an
item's placements/quantities, log history, properties, and attachments,
each independently configurable (shown/hidden, reorderable). Wire search
results (currently floorplan-locate only, which does nothing useful for
items with no floorplan mapping) to open it.

## Relevant SPEC/ARCHITECTURE Sections

- SPEC.md §5.1 (`item_id` filter on `GET /item-log`), §6.2 (UI: sections,
  navigation entry points, deep link), §8 (`detailPageSections` config
  field), §9.3 (MVP scope), §11 (design decisions — full view over modal,
  search always opens detail page, one ordered-array config field, filter
  on the existing `/item-log` endpoint rather than a new route).
- ARCHITECTURE.md §2.1 (`routes/itemLog.js` addition), §2.3 (component
  sketch, `selectedItemId` state, deep-link handling), §5 (integration —
  second `signalk-maintenance-tracker` link target), §6 (security — deep
  link is read-only, `item_id` filter is just a narrower read query).

## Approach

Backend: one small addition — `item_id` query param on `GET /item-log`
(`plugin/routes/itemLog.js`), composed with the existing date-range
filter. No schema change, no new routes (`GET /items/:id` already exists).

Frontend:
1. New `app-item-detail-view.js` — top-level `ItemDetailView` component,
   rendered by `app.js` in place of the tab content when
   `app.selectedItemId` is set (parallel to how `activeTab` currently
   picks the tab view). Header (name/photo thumbnail/quantities) always
   shown; then the four sections in `config.detailPageSections` order,
   skipping any not present in that array.
2. Reuse existing pieces rather than rebuilding them:
   - Placements section: iterate `item.placements` (or the single
     `location_id` case) using the existing `QuantityEditor`
     (`app-core.js`) per placement; a "Locate on floorplan" button calls
     the existing `app.locateItem` and switches to the Floorplan tab,
     shown only when `app.locateItem` would succeed (i.e. the location
     chain has a floorplan mapping — checked the same way
     `NotStoredPanel`/`app-nodes.js` already resolve location chains, or
     simply attempt it and hide/disable on 404).
   - History section: fetch via a new `app.getItemLog(item.id)`-style
     call (extends the existing `getItemLog(start, end)` action creator
     in `app.js` to accept an `item_id`), rendered with the same
     row-formatting logic already in `app-storelog-tab.js` (extract the
     shared bit if it's not already a standalone helper).
   - Properties + Attachments sections: extract the read/edit form
     currently inside `ItemPropertiesModal` (`app-item-modals.js`) into
     reusable sub-components so both the modal and the detail view render
     the same fields, rather than duplicating markup. `AttachmentsSection`
     in that file is already a standalone component — reuse directly.
3. `app.js`: add `selectedItemId` state + `selectItem(id)` /
   `closeItemDetail()`, independent of `activeTab` (selecting an item
   doesn't change which tab is "underneath"). Render `ItemDetailView`
   instead of the tab view when `selectedItemId` is set.
4. `qr-label.js`: add an `item` sibling to `parseLocationParam` (or a
   parallel `parseItemParam`) for the `?item=<id>` deep link; `app.js`'s
   initial-load effect calls `selectItem` when present, parallel to the
   existing `?location=<id>` handling.
5. `app-search.js`: `SearchBox.pick` calls `app.selectItem(item.id)`
   instead of `app.locateItem(item)`. `LocateItemPopup` becomes unused by
   search (the floorplan-locate flow now lives inside the Placements
   section) — remove it if nothing else calls it, otherwise leave as-is.
6. Add "open detail page" entry points to item chip actions
   (`app-nodes.js`) and Overview rows (`app-overview-tab.js`).
7. `plugin/index.js`: add `detailPageSections` to `plugin.schema` (array
   of enum `placements | history | properties | attachments`, default all
   four in that order); surface it via `plugin/routes/config.js`'s
   `/webapp-config` response, same pattern as `qrLabelBaseUrl`.

## Test Strategy

- **Backend** (`test/backend/`): `item_id` filter on `GET /item-log`
  (returns only matching rows; combines correctly with `start`/`end`;
  unknown/empty `item_id` returns zero rows, not an error). Config
  schema/`/webapp-config` test for the new `detailPageSections` field and
  its default.
- **Frontend** (`test/frontend/helpers.test.mjs`): any new pure logic —
  `?item=<id>` parsing, and the section-ordering/filtering logic that
  turns `detailPageSections` config + item data into the list of sections
  to render (keep this pure/DOM-free like the rest of `helpers.js`, even
  though the component consuming it isn't).
- **Manual, in-browser**: open the detail page via search (with and
  without a floorplan mapping — confirm the old silent-failure case is
  gone), via `?item=<id>`, from an item chip and from Overview; toggle a
  section off and reorder via Plugin Config and confirm the page reflects
  it; verify placements +/- editors, attachments upload/download, and
  history all work from the new view; touch-target sizing check on a
  narrow/touch viewport (per SPEC §6's standing constraint).

## Implementation Steps

- [ ] Add `item_id` filter to `GET /item-log` (`plugin/routes/itemLog.js`)
- [ ] Add `detailPageSections` to `plugin.schema` (`plugin/index.js`) and
      `/webapp-config` (`plugin/routes/config.js`)
- [ ] Extract reusable Properties/Attachments sub-components from
      `ItemPropertiesModal` (`app-item-modals.js`)
- [ ] Extract a shared log-row-formatting helper from
      `app-storelog-tab.js` if needed for the History section
- [ ] Build `app-item-detail-view.js` (header + four sections, driven by
      `detailPageSections` config)
- [ ] Add `selectedItemId`/`selectItem`/`closeItemDetail` to `app.js`;
      render `ItemDetailView` when set
- [ ] Add `?item=<id>` parsing (`qr-label.js`) + initial-load handling
      (`app.js`)
- [ ] Wire `app-search.js`'s `SearchBox.pick` to `selectItem`; adjust/
      remove `LocateItemPopup` if it becomes unused
- [ ] Add "open detail page" entry points: item chip actions
      (`app-nodes.js`), Overview rows (`app-overview-tab.js`)
- [ ] Add/update tests (see Test Strategy)
- [ ] Manual verification (see Test Strategy)
- [ ] Update README.md (API table, Usage section, config table); update
      CHANGELOG.md

## Files to Create/Modify

- `plugin/routes/itemLog.js` (`item_id` filter)
- `plugin/index.js` (schema addition)
- `plugin/routes/config.js` (`/webapp-config` response)
- `public/js/app-item-detail-view.js` (new)
- `public/js/app-item-modals.js` (extract reusable sub-components)
- `public/js/app-storelog-tab.js` (possible shared helper extraction)
- `public/js/app.js` (`selectedItemId` state, deep-link handling, render
  wiring)
- `public/js/qr-label.js` (`?item=<id>` parsing)
- `public/js/app-search.js` (`SearchBox.pick` wiring, `LocateItemPopup`)
- `public/js/app-nodes.js` (item chip actions entry point)
- `public/js/app-overview-tab.js` (Overview row entry point)
- `public/js/helpers.js` (pure section-filtering/ordering helper)
- `test/backend/itemLog.test.js` or similar, `test/backend/config.test.js`,
  `test/frontend/helpers.test.mjs`
- `README.md`, `CHANGELOG.md`
