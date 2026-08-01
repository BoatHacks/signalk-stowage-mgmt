# Implementation Plan: Issues #44, #45 — Item detail page + live-filter

## Overview

Add a dedicated item detail view (full-view, not a modal) showing an
item's placements/quantities, log history, properties, and attachments,
each independently configurable (shown/hidden, reorderable). Wire search
results (currently floorplan-locate only, which does nothing useful for
items with no floorplan mapping) to open it. Also make the global search
box live-filter the Inventory tree and Overview rows as you type,
removing Overview's separate local filter field.

## Relevant SPEC/ARCHITECTURE Sections

- SPEC.md §5.1 (`item_id` filter on `GET /item-log`), §6.2 (item detail
  page UI: sections, navigation entry points, deep link), §6.3
  (live-filter UI), §8 (`detailPageSections` config field), §9.3 (MVP
  scope, both parts), §11 (design decisions — full view over modal,
  search always opens detail page, one ordered-array config field, filter
  on the existing `/item-log` endpoint rather than a new route,
  live-filter included in this MVP, one global `SearchBox`).
- ARCHITECTURE.md §2.1 (`routes/itemLog.js` addition), §2.3 (item detail
  page component sketch, `selectedItemId` state, deep-link handling),
  §2.5 (live-filter component sketch), §5 (integration — second
  `signalk-maintenance-tracker` link target), §6 (security — deep link is
  read-only, `item_id` filter is just a narrower read query).

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

Live-filter (independent of the above, but same issue/PR):
8. `helpers.js`: add a pure `filterQuery(items, locations, query)` helper
   reusing `SearchBox`'s existing name/notes matching, returning matching
   item ids plus the ancestor location ids needed to keep them visible
   (via the existing `ancestorIds`).
9. `app.js`: lift search query state up (`app.searchQuery`/
   `setSearchQuery`); `app-search.js`'s `SearchBox` reads/writes it
   instead of (or in addition to) its own local `query` state, keeping
   its existing dropdown-results behavior unchanged.
10. `app-nodes.js`'s tree renderer and `app-overview-tab.js`'s table/touch
    rows both consume `app.searchQuery` through `filterQuery` to hide
    non-matching branches/rows when a query is active.
11. `app-overview-tab.js`: remove the local "Filter table…" field
    (`filterState`/`setFilter`) — Overview responds to the global query
    only.

## Test Strategy

- **Backend** (`test/backend/`): `item_id` filter on `GET /item-log`
  (returns only matching rows; combines correctly with `start`/`end`;
  unknown/empty `item_id` returns zero rows, not an error). Config
  schema/`/webapp-config` test for the new `detailPageSections` field and
  its default.
- **Frontend** (`test/frontend/helpers.test.mjs`): any new pure logic —
  `?item=<id>` parsing, the section-ordering/filtering logic that turns
  `detailPageSections` config + item data into the list of sections to
  render, and `filterQuery` (name match, notes match, no match, nested
  location ancestor-revealing, case-insensitivity, empty query returns
  everything) — all kept pure/DOM-free like the rest of `helpers.js`, even
  though the components consuming them aren't.
- **Manual, in-browser**: open the detail page via search (with and
  without a floorplan mapping — confirm the old silent-failure case is
  gone), via `?item=<id>`, from an item chip and from Overview; toggle a
  section off and reorder via Plugin Config and confirm the page reflects
  it; verify placements +/- editors, attachments upload/download, and
  history all work from the new view; type into the global search box
  and confirm the Inventory tree and Overview rows filter live (and
  ancestor locations of a match stay visible), confirm Overview's old
  local filter field is gone; touch-target sizing check on a narrow/touch
  viewport (per SPEC §6's standing constraint).

## Implementation Steps

- [x] Add `item_id` filter to `GET /item-log` (`plugin/routes/itemLog.js`)
- [x] Add `detailPageSections` to `plugin.schema` (`plugin/index.js`) and
      `/webapp-config` (`plugin/routes/config.js`)
- [x] Properties/Attachments sections built — `AttachmentsSection` is
      reused directly (exported from `app-item-modals.js`); Properties
      ended up as a new read-only summary component (photo, categories,
      expiration, rendered notes) with an "Edit" button opening the
      existing `ItemPropertiesModal` for changes, rather than extracting
      the modal's edit form into a shared component — simpler, and the
      modal's form already covers editing well
- [x] Reused `buildIndividualRows` from `app-storelog-tab.js` (exported)
      for the History section instead of a new helper
- [x] Build `app-item-detail-view.js` (header + four sections, driven by
      `detailPageSections` config)
- [x] Add `selectedItemId`/`selectItem`/`closeItemDetail` to `app.js`;
      render `ItemDetailView` when set
- [x] Add `?item=<id>` parsing (`qr-label.js`) + initial-load handling
      (`app.js`)
- [x] Wire `app-search.js`'s `SearchBox.pick` to `selectItem`;
      `LocateItemPopup`/`app.locateItem` kept as-is — now triggered from
      the detail page's "Locate on floorplan" button instead of search
- [x] Add "open detail page" entry points: item chip actions
      (`app-nodes.js`), Overview rows/touch chips (`app-overview-tab.js`,
      now also opening the detail page instead of locating directly)
- [x] Add `filterQuery` helper (`helpers.js`), extended to also match
      location names directly (revealing their whole subtree), per
      SPEC.md §6.3
- [x] Lift search query state to `app.js`; wire `SearchBox` to it
- [x] Apply live filtering in `app-nodes.js` (Inventory tree, via a
      `filter` prop threaded through the recursive `LocationNode`) and
      `app-overview-tab.js` (table/touch rows)
- [x] Remove Overview's local "Filter table…" field
- [x] Add/update tests (backend: `item_id` filter, config field;
      frontend: `filterQuery`, `itemHasFloorplanMapping`,
      `resolveDetailPageSections`, `parseItemParam`) — 123/123 passing
- [x] Manual verification: smoke-tested in a headless browser against a
      throwaway server instance (search → detail page with no floorplan
      mapping, all four sections render, back button, live-filter on
      Inventory and Overview, Overview's local filter field gone)
- [x] Update README.md (API table, Usage section, config table, Known
      external consumers); update CHANGELOG.md

## Files to Create/Modify

- `plugin/routes/itemLog.js` (`item_id` filter)
- `plugin/index.js` (schema addition)
- `plugin/routes/config.js` (`/webapp-config` response)
- `public/js/app-item-detail-view.js` (new)
- `public/js/app-item-modals.js` (`AttachmentsSection` exported for reuse)
- `public/js/app-storelog-tab.js` (`buildIndividualRows` exported for reuse)
- `public/js/app.js` (`selectedItemId`/`searchQuery` state, deep-link
  handling, render wiring)
- `public/js/qr-label.js` (`?item=<id>` parsing)
- `public/js/api.js` (`getItemLog` gains an `itemId` param)
- `public/js/app-search.js` (query state lifted to `app`, `SearchBox.pick`
  wiring)
- `public/js/app-nodes.js` (item chip "View details" action, live-filter)
- `public/js/app-overview-tab.js` (row/chip entry points, live-filter,
  remove local filter field)
- `public/js/app-inventory-tab.js` (thread live-filter down to
  `LocationNode`)
- `public/js/helpers.js` (`filterQuery`, `itemHasFloorplanMapping`,
  `locationHasFloorplanMapping`, `itemMatchesQuery`,
  `resolveDetailPageSections`)
- `public/js/icons.js` (`info`, `back`, `locate` icons)
- `public/style.css` (item detail page styles)
- `test/backend/item-log.test.js`, `test/backend/config.test.js`,
  `test/frontend/helpers.test.mjs`, `test/frontend/qr-label.test.mjs`
- `README.md`, `CHANGELOG.md`
