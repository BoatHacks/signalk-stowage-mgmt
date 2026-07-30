# signalk-stowage-mgmt

SignalK server plugin for inventory/stowage management. npm:
`signalk-stowage-mgmt`, GitHub: BoatHacks/signalk-stowage-mgmt. Formerly
scaffolded as `signalk-quartermaster`.

## Stack
- Frontend: buildless Preact + htm SPA (no bundler), Chromium 69+ compatible
  for MFD use.
- Backend: Node.js with `node:sqlite`; SQLite storage.
- Error response shape is flat `{error: "..."}`, not nested (a downstream
  consumer's docs got this wrong, see [[signalk-maintenance-tracker]]).

## Features shipped (v0.7.x - v0.9.3, most recent: v0.9.0-v0.9.3)
- Split items across multiple locations (full `item_placements`/`item_log`
  schema, floorplan blinking, placement chips, inline quantity editing), with
  an optional default storage location per split item (v0.9.0) so quick
  +/- editors can act on it directly instead of staying disabled.
- Expiration date tracking, merged with Understocked into a single "Stock
  Alerts" tab (v0.8.8).
- Consumption rate prediction (Predicted Runway, requires 3+ events).
- `GET /items/:id` and `GET /items?q=` endpoints for the external consumer
  [[signalk-maintenance-tracker]].
- File attachments (v0.8.4): disk storage under
  `<dataDir>/attachments/<item_id>/<attachment_id>`, streaming upload via raw
  request body, cascade cleanup on item deletion.
- Nested storage spaces (v0.8.5): backend already supported arbitrary
  nesting; UI gap closed with breadcrumb paths in the floorplan picker.
- Collapsible Store Log sections; search extended to notes; `CHANGELOG.md`
  and `ROADMAP.md` created.
- Automated test suite (v0.8.7) via `node --test`, covering both
  `test/backend/` (real HTTP requests against the mounted plugin, fresh temp
  SQLite db per test) and `test/frontend/` (pure data-layer helpers, no
  DOM/JSDOM needed).
- App-wide "Edit mode" toggle (v0.8.10) collapsing chip action buttons
  behind "..." until toggled; auto light/dark theme following SignalK's sun
  data (v0.8.13); collapsible inventory-tree nodes at any depth (v0.8.12,
  v0.8.14).
- JSON export/import (v0.8.9): full backup/restore of categories, locations,
  and items; import is a full replace, not a merge.
- New "Touch" view on the Overview tab (v0.9.0): always-visible +/- chips
  sized for MFD touchscreens, plus a dynamic coarse/fine +/- scale option
  (v0.9.3) for items with large quantities.
- Store Log's Individual Movements table now shows location per event
  (v0.9.1).
- Webapp's own config endpoint renamed from `/config` to `/webapp-config`
  (v0.9.3) — it collided with signalk-server's reserved
  `GET /plugins/{id}/config`, silently no-opping `autoTheme` and
  `dynamicQuantityScale`.

## Release/publish setup
- npm OIDC trusted publishing is fully configured and working — confirmed
  by multiple hands-free, tokenless `publish-npm.yml` runs (e.g. v0.8.12,
  v0.9.4) that published with a signed provenance statement, no OTP, no
  human present. (Earlier notes here claiming npm-side Trusted Publisher
  config was incomplete were stale/wrong.)
- `cut-release.yml` (added ~v0.9.4, `workflow_dispatch`) is the **only**
  release path now: verifies `package.json`'s version and the CHANGELOG
  entry, runs the test suite, tags, creates the GitHub release, and — as
  of issue #43's fix — publishes to npm itself in the same run, gated on
  Plugin CI (`plugin-ci.yml`) having already completed successfully for
  the exact commit. It publishes directly rather than relying on a
  separate release-triggered workflow, because a release created with
  the default `GITHUB_TOKEN` doesn't cascade into other workflows'
  `release: published` triggers (GitHub suppresses that, to prevent
  recursive workflow chains) — a separate workflow would never have
  fired on its own.
- `publish-npm.yml` (the previous release-triggered workflow, and briefly
  a manual-fallback candidate) was **removed** once npm's Trusted
  Publisher config for this package was repointed at `cut-release.yml`'s
  exact workflow filename — npm's OIDC exchange is pinned to a specific
  repo + workflow filename, so only one workflow can actually publish at
  a time. If a manual-retry path is needed again later, it'll need to be
  re-added and re-registered as the trusted workflow (or npm would need
  to support multiple trusted workflows per package, which it doesn't
  currently).
- GitHub release and npm publish are separate explicit steps (see the
  user-level `plugin-release` skill for the general procedure).
- **Standing rule:** before cutting a **minor or major** release (not a
  patch), regenerate the screenshots in `docs/screenshots/` (all 7 —
  Inventory, Floorplan, Categories, Overview, Overview Touch view, Stock
  Alerts, Store Log — see the README's Usage section and
  `signalk.screenshots` in `package.json`) so both the README and the
  SignalK App Store listing reflect the current UI. Not required for
  patch releases unless a patch specifically changed something visible
  in one of them.

## History
Original scaffold was `signalk-quartermaster` (npm:
`signalk-quartermaster`, github.com/boathacks/signalk-quartermaster) — a
Node.js/SQLite inventory webapp plugin. Core features at that stage: nested
containers/storage spaces (arbitrary nesting via `parent_id`), items with
many-to-many categories, SVG floorplan upload with clickable
area-to-storage-space mapping, blink-to-locate search, overview table. Used
`better-sqlite3` and Express routes; frontend was a vanilla JS SPA (no build
step) with tabs: Bestand, Grundriss, Übersicht, Kategorien.
