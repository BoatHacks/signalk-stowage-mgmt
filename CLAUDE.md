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

## Features shipped (v0.7.x - v0.8.5, most recent: v0.8.4/v0.8.5)
- Split items across multiple locations (full `item_placements`/`item_log`
  schema, floorplan blinking, placement chips, inline quantity editing).
- Expiration date tracking with an Expiring tab (14-day window).
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

## Release/publish setup
- npm OIDC trusted publishing set up in CI, but npmjs.com-side Trusted
  Publisher config not yet completed — all publishes are manual with OTP.
- `publish-npm.yml` has a `workflow_dispatch` trigger for retries.
- GitHub release and npm publish are separate explicit steps (see the
  user-level `plugin-release` skill for the general procedure).

## History
Original scaffold was `signalk-quartermaster` (npm:
`signalk-quartermaster`, github.com/boathacks/signalk-quartermaster) — a
Node.js/SQLite inventory webapp plugin. Core features at that stage: nested
containers/storage spaces (arbitrary nesting via `parent_id`), items with
many-to-many categories, SVG floorplan upload with clickable
area-to-storage-space mapping, blink-to-locate search, overview table. Used
`better-sqlite3` and Express routes; frontend was a vanilla JS SPA (no build
step) with tabs: Bestand, Grundriss, Übersicht, Kategorien.
