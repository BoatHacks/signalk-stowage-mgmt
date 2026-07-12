# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This log begins at v0.2.3, when the project (originally `signalk-quartermaster`)
was renamed to `signalk-stowage-mgmt`.

## [Unreleased]

### Added

- Storage spaces can now be nested inside another storage space (or
  container) to any depth, not just created at the top level — e.g.
  "Port Locker" inside "Aft Cabin". Backend and floorplan-mapping/locate
  logic already supported this; the missing piece was a "+ Storage
  Space" button on every tree node, not just the top-level toolbar.
  The floorplan "Assign area" picker now lists storage spaces by their
  full breadcrumb path rather than bare name, since nesting makes
  same-named spaces at different depths (e.g. two "Port Locker"s)
  possible.

## [0.8.4] - 2026-07-12

### Added

- File attachments for items (issue #15): upload manuals, spec
  sheets, receipts, or any other file type from the Item Properties
  dialog. Unlike the existing photo thumbnail, attachments have no
  size limit and are stored on disk (under the plugin's data
  directory) rather than in SQLite, since they're unbounded in both
  size and count. `GET/POST /items/:id/attachments`,
  `GET/DELETE /items/:id/attachments/:attachmentId`.

## [0.8.2] - 2026-07-12

### Added

- Expiration date tracking: an optional date per item, a new
  "Expiring" tab (items expiring within 14 days or already expired,
  soonest/most-overdue first), and its own markdown export. Not
  tracked in the Store Log.
- Consumption rate prediction: a 5th Store Log section ("Predicted
  Runway") projecting a consumption rate from items with at least 3
  separate usage events in the selected date range, estimating days
  remaining and an approximate run-out date.
- `GET /items/:id` — single-item fetch.
- `GET /items?q=<text>` — case-insensitive substring search against
  item name (not notes), for autocomplete/picker use cases. Returns
  all matches, unbounded.
- `ROADMAP.md`, to track future ideas without losing them.

### Changed

- README: documented the `source: <shop name>` notes convention that
  groups the Understocked page's shopping list export by shop
  (implemented earlier, but never documented).

## [0.8.1] - 2026-07-11

### Fixed

- Split items' quantity was entirely read-only outside the Split
  dialog. A split item's per-location chip now supports inline
  quantity editing, exactly like a normal item's, scoped to that one
  placement — the item's overall quantity (always the sum of its
  placements) updates automatically. Item Properties and the
  Understocked page remain read-only for split items, since neither
  has a single location to attribute a change to.

## [0.8.0] - 2026-07-11

### Added

- App icon for the Signal K App Store / Webapps list.
- **Split items**: an item's stock can now be divided across multiple
  locations at once (e.g. 5 of 8 oil filters in one storage space, 3 in
  a container elsewhere), instead of every item living in exactly one
  place. A "Split" action opens a dialog to allocate quantity across
  locations; a split item renders as one chip per placement, each
  draggable independently; a "Drop here to split" panel appears
  alongside "Not Stored" while dragging; searching for or locating a
  split item blinks every one of its mapped areas at once; and the
  Store Log gains a fourth "Splits" section with its own markdown
  export. An item's overall quantity becomes read-only elsewhere once
  split — change it via the Split dialog instead.

### Changed

- Search (the header search box and the Overview table's filter field)
  now also matches against item notes, not just the name — a
  notes-only match shows a short snippet of surrounding text so it's
  clear why that item came up.
- The Item Properties and Split dialogs' primary action button moved
  from the footer to the header, next to the close button.
- The Overview table now shows split items informatively (e.g. "Split
  (2 locations)", every placement's path) instead of a blank/no-location
  row.

### Fixed

- A few more leftover HTML entities — numeric character references in
  the quantity +/- stepper buttons, and two more in the Split dialog —
  that rendered as literal text instead of being decoded, the same
  underlying issue as the entities fixed in 0.6.0.

## [0.7.2] - 2026-07-10

### Changed

- Store Log split into three independently-exportable sections: Individual
  Movements, Aggregate Movements, and Target Adjustments, each with its own
  "Export as Markdown" button.

## [0.7.1] - 2026-07-10

### Fixed

- Unreadable buttons and form controls in dark mode: the generic `<button>`
  rule (and `input`/`textarea`/`select`) had no `color` set at all, so they
  fell back to browser-default colors regardless of theme.

## [0.7.0] - 2026-07-10

### Added

- Store Log: an audit trail of item creation, actual/target quantity
  changes, and deletion, with date-range presets and a markdown export.

## [0.6.6] - 2026-07-10

### Fixed

- Dark mode contrast: several text colors were hardcoded and un-themed
  (most notably the active tab label, nearly invisible on a dark
  background). All visible text is now a medium red, and functional
  indicators (drag-and-drop feedback, "needs assignment" highlighting)
  are bright red, for genuine night-vision-preserving readability.

## [0.6.5] - 2026-07-10

### Fixed

- Item quantity displaying as `××3` instead of `×3` on inventory chips.
- The floorplan area not blinking when locating an item via search.

## [0.6.4] - 2026-07-10

### Added

- Manual SVG area ID assignment for storage spaces, for floorplan areas
  that visually overlap another one and can't be clicked directly.

## [0.6.3] - 2026-07-09

### Changed

- Uploading a replacement floorplan now preserves area-to-storage-space
  assignments when the new SVG has matching element IDs, instead of
  clearing every assignment unconditionally.

## [0.6.2] - 2026-07-09

### Fixed

- SVG-editor auto-generated IDs (e.g. Inkscape's default `path10340`) are
  no longer treated as assignable storage areas, which previously could
  turn every traced shape in a floorplan into a meaningless "area."

## [0.6.1] - 2026-07-09

### Fixed

- SVG floorplan uploads hanging indefinitely under certain request-body
  parsing conditions instead of completing.

## [0.6.0] - 2026-07-09

### Changed

- Rewrote the frontend as a buildless Preact + htm SPA — no bundler, no
  transpile step, targeting browsers as old as Chromium 69 (some Navico/
  B&G MFD displays). Preact/htm are vendored locally as a single
  self-contained module, so the app works fully offline.
- Added a light/dark theme toggle and live polling (background refresh
  every 5 seconds) on top of the existing feature set.

### Fixed

- HTML entities (e.g. `&hellip;`) rendering as literal text instead of
  being decoded, across several dialogs.
- Drag-and-drop silently failing when dropped on a drop zone's own label
  text.
- A batch of bugs found during review: duplicate error toasts, stale
  modal state persisting between opens, and dead imports.

## [0.5.5] - 2026-07-09

### Changed

- Locating an item (via search or the Overview page) now shows an
  interactive item chip popup instead of a plain toast notification.

## [0.5.4] - 2026-07-09

### Added

- OpenAPI 3.0 specification for the plugin's REST API, rendered in the
  Signal K Admin UI's Documentation tab.

## [0.5.3] - 2026-07-09

### Changed

- Cleaned up the inventory markdown export (heading levels, quantity
  formatting, empty-location filtering).
- Various Item Properties dialog improvements.

## [0.5.2] - 2026-07-09

### Changed

- Redesigned the "Move" dialog to a floorplan-based target picker
  (hover a storage space to see its containers, click or drag to move)
  instead of a text prompt.

## [0.5.1] - 2026-07-09

### Removed

- The `express` dependency. Routes are registered directly on the host
  server's router, which already behaves like an Express router.

## [0.5.0] - 2026-07-09

### Changed

- Documented that this plugin is not compatible with Victron Cerbo GX /
  Venus OS, which ships Node.js 20 (predates `node:sqlite`).

## [0.4.0] - 2026-07-09

### Added

- `plugin-ci` GitHub Actions workflow so Signal K App Store CI
  indicators show pass/fail status per platform.

### Removed

- The `better-sqlite3` native dependency, replaced with Node's built-in
  `node:sqlite` module. This removes the last native/npm-install-time
  dependency, fixing installs under the App Store's `--ignore-scripts`
  policy.

## [0.3.6] - 2026-07-09

### Added

- Rename button for storage spaces and containers.

### Fixed

- Documented a build-tooling fallback for `better-sqlite3` install
  failures on some platforms (superseded by 0.4.0's native-dependency
  removal).

## [0.3.5] - 2026-07-08

### Changed

- Shopping list export is now grouped by shop, with items sorted by
  category within each group.

## [0.3.4] - 2026-07-08

### Added

- "Export as Markdown" (shopping list) button on the Understocked page.

## [0.3.3] - 2026-07-08

### Changed

- A newly created storage space is now auto-assigned to the floorplan
  area you were editing when you created it.

## [0.3.2] - 2026-07-08

### Changed

- Rewrote the README: App Store install instructions, full data model
  documentation, and current API reference.

## [0.3.1] - 2026-07-08

### Changed

- The "new storage space" name field in the area-assignment dialog is
  now pre-filled with a name guessed from the SVG area's ID.

## [0.3.0] - 2026-07-08

### Added

- Create a new storage space directly from the floorplan area
  assignment dialog, instead of having to do it from the Inventory tab
  first.

## [0.2.24] - 2026-07-08

### Changed

- Renamed the plugin's display name and Plugin Config entry to
  "Stowage Management" for consistency across the Admin UI.

## [0.2.23] - 2026-07-08

### Added

- Edit/Display mode toggle on the Floorplan page.

## [0.2.22] - 2026-07-07

### Added

- "Export as Markdown" button on the Inventory page.

## [0.2.21] - 2026-07-07

### Changed

- Renamed the notes markdown editor's tabs (Write → Edit, Preview →
  Show); the editor now defaults to the rendered Show view.

## [0.2.20] - 2026-07-07

### Changed

- The Floorplan page now shows only the single most recently uploaded
  SVG, and warns before an upload would clear existing area
  assignments.

## [0.2.19] - 2026-07-07

### Changed

- Merged the item `description` field into `notes`; the notes markdown
  editor now lives inside the Item Properties modal.

## [0.2.18] - 2026-07-07

### Added

- Target quantity shown alongside actual quantity on inventory item
  chips.

## [0.2.17] - 2026-07-07

### Added

- Item Properties modal, target quantity field, Understocked page, and
  a markdown notes editor.

## [0.2.16] - 2026-07-07

### Fixed

- Floorplan page showing an unnecessary scrollbar (the viewport-fit
  calculation didn't account for the container's own padding/border).

## [0.2.15] - 2026-07-07

### Changed

- Item/container action buttons switched from text labels to icons;
  item quantity is now editable inline.

### Added

- Drag items directly onto a floorplan area to stow them.

## [0.2.14] - 2026-07-07

### Added

- Category rows are now collapsible fold-downs listing their items.

### Fixed

- Floorplan SVG now dynamically fits the viewport instead of a fixed
  size.

## [0.2.13] - 2026-07-07

### Added

- Persistent "Not Stored" side panel surfacing orphaned containers and
  unassigned items.

## [0.2.12] - 2026-07-07

### Added

- Disclaimer warning at the top of the README.

## [0.2.11] - 2026-07-07

### Added

- Draggable containers, item photo thumbnails with square cropping, and
  a floating drop panel for unassigning items.

## [0.2.10] - 2026-07-07

### Changed

- Floorplan area assignment now uses a click-based dialog instead of a
  text prompt.

## [0.2.9] - 2026-07-07

### Added

- Drag-and-drop for moving items between locations.

## [0.2.8] - 2026-07-07

### Added

- GitHub Actions workflow to auto-publish to npm on release.

## [0.2.7] - 2026-07-07

### Fixed

- `better-sqlite3` install script being blocked by script-gating tools
  on some platforms; pre-approved via an `allowScripts` entry.

## [0.2.6] - 2026-07-07

### Changed

- Translated the webapp UI from German to English.

## [0.2.5] - 2026-07-07

### Fixed

- Plugin not appearing in the Signal K Webapps list or serving its
  static files, due to a missing `signalk-webapp` keyword.

## [0.2.4] - 2026-07-06

### Added

- `homepage` and `bugs` URLs, and an Apache-2.0 `LICENSE` file, for the
  npm release.

### Removed

- Unused `postinstall` script.

## [0.2.3] - 2026-07-06

### Changed

- Renamed the project from `signalk-quartermaster` to
  `signalk-stowage-mgmt`; translated the example floorplan's labels to
  English boat storage terms; updated repository metadata.

[Unreleased]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.8.2...HEAD
[0.8.2]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.7.2...v0.8.0
[0.7.2]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.6.6...v0.7.0
[0.6.6]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.6.5...v0.6.6
[0.6.5]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.6.4...v0.6.5
[0.6.4]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.6.3...v0.6.4
[0.6.3]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.5.5...v0.6.0
[0.5.5]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.5.4...v0.5.5
[0.5.4]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.5.3...v0.5.4
[0.5.3]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.3.6...v0.4.0
[0.3.6]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.3.5...v0.3.6
[0.3.5]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.3.4...v0.3.5
[0.3.4]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.2.24...v0.3.0
[0.2.24]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.2.23...v0.2.24
[0.2.23]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.2.22...v0.2.23
[0.2.22]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.2.21...v0.2.22
[0.2.21]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.2.20...v0.2.21
[0.2.20]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.2.19...v0.2.20
[0.2.19]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.2.18...v0.2.19
[0.2.18]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.2.17...v0.2.18
[0.2.17]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.2.16...v0.2.17
[0.2.16]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.2.15...v0.2.16
[0.2.15]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.2.14...v0.2.15
[0.2.14]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.2.13...v0.2.14
[0.2.13]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.2.12...v0.2.13
[0.2.12]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.2.11...v0.2.12
[0.2.11]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.2.10...v0.2.11
[0.2.10]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.2.9...v0.2.10
[0.2.9]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.2.8...v0.2.9
[0.2.8]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.2.7...v0.2.8
[0.2.7]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.2.6...v0.2.7
[0.2.6]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.2.5...v0.2.6
[0.2.5]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/BoatHacks/signalk-stowage-mgmt/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/BoatHacks/signalk-stowage-mgmt/releases/tag/v0.2.3
