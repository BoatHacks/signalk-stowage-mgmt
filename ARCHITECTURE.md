# signalk-stowage-mgmt Architecture

## 1. Overview

A Signal K server plugin with two halves: a Node.js backend (Express-style
router mounted by signalk-server) backed by a single SQLite database, and
a buildless Preact/htm single-page webapp served as static files under a
separate mount point (the plugin's package name, at the server root — not
under `/plugins/`).

```
Browser (webapp, served from /signalk-stowage-mgmt/)
  │  fetch() JSON + raw-byte uploads
  ▼
signalk-server ── mounts plugin router at /plugins/signalk-stowage-mgmt
  │
  ▼
plugin/index.js ── registers route modules, error middleware
  │
  ├── plugin/routes/*.js ── one module per resource (items, locations, ...)
  │     │
  │     ▼
  ├── plugin/db.js (node:sqlite) ── inventory.db in the plugin's data dir
  └── plugin/attachmentsStore.js ── attachment file bytes on disk
```

## 2. System Components

### 2.1 Backend plugin (`plugin/`)

- `index.js` — plugin entrypoint: `start`/`stop` lifecycle, config schema,
  registers every route module on the server-provided router, and a
  catch-all error middleware mapping thrown `{statusCode, message}`
  errors to the flat `{error: "..."}` JSON shape.
- `routes/*.js` — one module per resource (`locations`, `items`,
  `categories`, `floorplans`, `itemLog`, `attachments`, `backup`,
  `config`), each a `registerXRoutes(router, getDb, ...)` factory.
- `db.js` — `initDb(dataDir)`: opens/creates `inventory.db`, runs schema
  DDL (idempotent `CREATE TABLE IF NOT EXISTS`) and small ad-hoc
  migrations (column add/rename checks) on every start.
- `tx.js` — `runInTransaction(db, fn)`: `BEGIN`/`COMMIT`/`ROLLBACK`
  wrapper, since `node:sqlite` has no built-in transaction helper.
- `itemLog.js` — shared helper for writing an audit-trail row, used by
  every route that changes an item's quantity or lifecycle.
- `attachmentsStore.js` — path helpers for attachment files on disk;
  paths are built only from server-generated UUIDs, never client input.
- `jsonBody.js` — a minimal JSON body-parser middleware (no `express`
  runtime dependency — see §4), since the router the server hands the
  plugin is not guaranteed to be a full Express app.
- `routes/itemLog.js` — `GET /item-log` gains an optional `item_id` query
  parameter (item detail page, §2.3), composed with the existing
  `start`/`end` date-range filters as another `AND` clause; no schema or
  behavior change to the existing date-range-only callers (Store Log tab).

### 2.2 Frontend SPA (`public/js/`)

- `app.js` — top-level component: holds polled server state (`app.data`),
  exposes action creators (`app.updateItem`, `app.moveContainer`, etc.)
  that wrap a request + refetch + toast-on-error (`act()`), and renders
  the tab bar.
- `app-core.js` — shared hooks/components used across tabs (`useApp`
  context, `QuantityEditor`, `IconBtn`, `ChipActionsMenu`).
- `app-<tab>-tab.js` / `app-<thing>-modals.js` — one file per tab or modal
  group (inventory tree, floorplan + its two modals, categories, overview
  table/touch view, stock alerts, store log, item property/split/photo
  modals).
- `app-nodes.js` — the recursive location/item tree rendering shared by
  the Inventory tab and elsewhere.
- `helpers.js` — pure data-layer functions (breadcrumb paths, split-item
  resolution, markdown export builders, understocked/expiry checks) —
  deliberately DOM-free so they're unit-testable under plain `node --test`
  with no JSDOM.
- `svg-sanitizer.js` — allowlist-based sanitizer run on floorplan SVGs
  both at upload time and at render time (see §6).
- `api.js` — thin `fetch()` wrapper layer; `markdown.js`/`icons.js`/
  `theme.js` are small single-purpose helpers.

### 2.3 Item detail page

- `public/js/app-item-detail-view.js` (new) — the detail view component,
  rendered in place of a tab's content (parallel to `app-<tab>-tab.js`
  files) when an item is selected. Composes the five section components
  below in the order/visibility given by config.
- Section components live alongside it, each pulling from data the app
  already fetches or a small targeted request: a placements section
  reusing `QuantityEditor` (`app-core.js`) per placement — each row builds
  a shallow item view with `actual_quantity` overridden to that
  placement's own share (the same trick `resolvedItemsIn` uses in
  `helpers.js`), since `QuantityEditor` reads the passed item's
  `actual_quantity` directly and would otherwise show the item's total
  across every placement, not the one row's own quantity; a floorplan
  section (below); a history section calling the extended
  `GET /item-log?item_id=` (§2.1 addition below); a properties section
  reusing the read side of `ItemPropertiesModal`'s fields; an attachments
  section reusing the existing attachments list/upload UI already built
  for `ItemPropertiesModal`.
- **Floorplan section**: resolves the item's floorplan target(s) purely
  client-side via `helpers.js`'s `itemFloorplanTargets` (walks the same
  parent chain the backend's `locateFrom` does, no API round trip needed
  since the frontend already holds the full location tree), fetches that
  floorplan's content via the existing `getFloorplan` action, and renders
  it with the existing `FloorplanSvg` component (`app-floorplan-modals.js`)
  — the same one the Floorplan tab and Move modal already use. Blinks the
  matched area(s) on load via the same `inv-blinking` CSS class/timeout
  pattern `app-floorplan-tab.js` uses for click-to-locate. Reuses
  `app-floorplan-tab.js`'s documented `mappedIds`-stability trick (a
  joined-string key run through `useMemo`, so the array's *reference*
  only changes when its actual contents do) — without it, an unrelated
  re-render (e.g. the attachments-loading effect firing when the page
  first opens) gives `FloorplanSvg` a new-but-equal `mappedIds` array,
  retriggering its inject effect and wiping the freshly-added blink class
  almost immediately.
- The Placements section's "Locate on floorplan" button only renders when
  the Floorplan section is *not* also in the resolved section list — the
  view computes `floorplanSectionVisible` once and passes it down, so the
  two never show a redundant way to do the same thing at once.
- `app.js` gains `selectedItemId` state (parallel to `activeTab`) and a
  `selectItem`/`closeItemDetail` pair; selecting an item doesn't change
  `activeTab`, so "back" just clears `selectedItemId` and the previous tab
  reappears underneath, no navigation stack needed.
- The `?item=<id>` deep link is handled the same way `?location=<id>`
  already is: parsed once in `app.js`'s initial-load effect
  (`qr-label.js`'s `parseLocationParam` gets an item-id sibling), setting
  `selectedItemId` directly instead of expanding an Inventory node.
- Search results (`app-search.js`'s `SearchBox.pick`) call `selectItem`
  instead of unconditionally calling `app.locateItem` — the
  jump-to-Floorplan-tab-and-blink flow now only fires from the Placements
  section's button (§2.3) or the inline Floorplan section, not from
  search directly.
- **Section visibility/order config** (`detailPageSections`, §8 SPEC.md)
  flows through the existing `/webapp-config` polling path, the same way
  `autoTheme`/`dynamicQuantityScale`/`qrLabelBaseUrl` already do — no new
  transport.

### 2.4 QR label generation

No new backend component. Label rendering is entirely client-side:

- `public/vendor/qrcode-generator.mjs` (see §4) provides QR encoding.
- `public/js/qr-label.js` — pure logic (no DOM beyond string building), so
  it's unit-testable like `helpers.js`: builds the deep-link URL, parses
  it back out of the page's query string, and composites the label SVG
  (the vendored library's `createSvgTag()` output plus the centered
  app-icon overlay).
- `public/js/app-label-modals.js` — the UI: `LabelModal` (single label,
  opened from a location's actions menu) and `PrintLabelsModal` (the
  batch "Print Labels" page, opened from the Inventory toolbar), both
  built on a shared `Label` component.
- The Server URL config value flows through the existing `/webapp-config`
  polling path (`qrLabelBaseUrl`), the same way `autoTheme`/
  `dynamicQuantityScale` already do.
- The deep-link handler (`?location=<id>` → expand that node in the
  Inventory tab, via `helpers.js`'s `ancestorIds`) is a small addition to
  `app.js`'s initial-load effect, parallel to how `locateTarget` already
  drives floorplan blinking from search.

### 2.5 Live-filter Inventory/Overview

No new backend component; purely a rendering-layer addition on top of
`app.data` the app already holds:

- `helpers.js` gains a pure `filterQuery(items, locations, query)`-style
  helper (matching name/notes the same way `SearchBox`'s own dropdown
  matching already does) returning the set of matching item ids and the
  location ids needed to keep them visible (reusing `ancestorIds`) — kept
  DOM-free so it's unit-testable like the rest of `helpers.js`.
- `app-search.js`'s `SearchBox` lifts its query state up to `app.js` (a
  new `app.searchQuery`/`setSearchQuery`, polling-independent, alongside
  the existing dropdown-results behavior it keeps doing locally).
- `app-nodes.js`'s tree renderer and `app-overview-tab.js`'s table/touch
  rows both read `app.searchQuery`, run it through `filterQuery`, and
  hide non-matching branches/rows — no new fetch, no new state beyond the
  query string itself.
- Overview's own local search input is removed; its rows respond to the
  global query directly.

## 3. Data Models

See SPEC.md §3 for the conceptual model. Actual SQLite schema
(`plugin/db.js`): `floorplans`, `locations`, `items`, `categories`,
`item_categories` (join table), `item_placements`, `item_attachments`,
`item_log`, with indexes on every foreign key used in a hot lookup path
(`parent_id`, `location_id`, `item_id`, etc.). `item_log` is intentionally
untyped beyond a `CHECK` on `event` — it's an audit trail, not a
normalized model.

QR labels introduce no schema change. The item detail page introduces no
schema change either — it's a new read-composition over existing tables
plus one new indexed query path (`item_log.item_id`, already indexed per
§3's "every foreign key used in a hot lookup path").

## 4. Technology Stack

| Layer | Choice | Why |
|---|---|---|
| Backend runtime | Node.js ≥22.5.0 | Required for the built-in `node:sqlite` module |
| Storage | SQLite via `node:sqlite` | No native-module install step (unlike `better-sqlite3`, the original prototype's choice); zero runtime deps |
| Backend framework | None — the server's own router | Avoids an `express` runtime dependency; `express` is a devDependency only, used solely by the test harness |
| Frontend framework | Preact + htm, vendored standalone | Small enough to vendor as a single file with no build step, unlike React; keeps the "buildless" constraint (must run on Chromium 69+ MFDs) |
| Testing | `node --test` | Built-in, no extra devDependency beyond `express` for the backend test harness's HTTP layer |
| CI/Release | GitHub Actions (`plugin-ci.yml`, `cut-release.yml`) | `cut-release.yml` tags, releases, and publishes to npm via OIDC trusted publishing in one run (see AGENTS.md for the full history of why) |
| **QR encoding** | `qrcode-generator` (npm), vendored as a single `.mjs` file | MIT, zero dependencies, ~52KB single ES module; `createSvgTag()` outputs dependency-free vector SVG — matches the vendoring pattern already used for Preact/htm, and keeps the app usable offline |

## 5. Integration Points

- **Signal K server plugin API** — `registerWithRouter(router)` (routes
  mounted under `/plugins/signalk-stowage-mgmt/`, admin-gated when Signal
  K security is enabled — see §6), `app.getSelfPath('environment.sun' |
  'environment.mode')` for the optional auto-theme feature, standard
  `plugin.schema`/`plugin.start`/`plugin.stop` lifecycle.
- **`signalk-maintenance-tracker`** — the one known external consumer,
  calling this plugin's REST API directly (same-origin browser calls and
  backend lookups) — see README's "Known external consumers" for the
  exact endpoints/fields it depends on, and the admin-auth caveat that
  applies when Signal K security is enabled.
- **npm registry** — OIDC trusted publishing from `cut-release.yml`; no
  long-lived `NPM_TOKEN`.
- **QR labels** — no external integration; the "deep link" a QR
  code encodes is a URL back into this same webapp, not a third-party
  service. Deliberately not using an external QR-image API, to keep label
  generation working offline.
- **Item detail page** — the `?item=<id>` deep link (§2.3) is the second
  known integration point for `signalk-maintenance-tracker` (the first
  being the REST API calls above): the motivating use case for issue #44
  is that tracker linking straight to an item's detail page in this
  plugin.

## 6. Security Considerations

- **Admin-gating**: every route lives under `/plugins/<id>/*`, which Signal
  K itself gates when its security feature is enabled — this plugin adds
  no separate auth layer of its own (documented in README for the
  external-consumer case).
- **SVG floorplan uploads**: sanitized via an allowlist (`svg-sanitizer.js`)
  both at upload time and at render time, stripping script elements,
  event-handler attributes, and dangerous URL schemes — closes a stored-XSS
  vector that existed before this was added.
- **Attachment paths**: built only from server-generated UUIDs (item id
  looked up from the DB, attachment id from `randomUUID()`), never from
  client-supplied filenames — no path-traversal surface.
- **Input validation**: proportional to a single-user, typically
  security-disabled deployment (a boat's own local network) — quantities
  and enum-like fields (`type`, `event`) are validated; there's no
  multi-tenant isolation to enforce, by design (see README's Known
  Limitations).
- **QR labels**: the deep link (`?location=<id>`) only ever opens an
  existing read path in the webapp (expand a node in the Inventory tab) —
  it introduces no new write capability and no new auth boundary; a
  printed label is exactly as sensitive as physical access to the boat's
  own network already is.
- **Item detail page**: the `?item=<id>` deep link is the same kind of
  read-only navigation shortcut as `?location=<id>` — it opens the detail
  view, it doesn't perform any write. The `item_id` filter added to `GET
  /item-log` only narrows an existing read query (§2.1); it accepts any
  string and simply returns zero rows for an id that doesn't exist or
  isn't a valid UUID, matching how the existing `start`/`end` filters
  already behave for out-of-range input.

## 7. File Structure

```
plugin/
  index.js              plugin entrypoint, route registration, error middleware
  db.js                 schema + migrations (node:sqlite)
  tx.js                 transaction wrapper
  itemLog.js            audit-log write helper
  attachmentsStore.js   attachment file path helpers
  jsonBody.js           minimal JSON body parser (no express runtime dep)
  routes/
    locations.js items.js categories.js floorplans.js
    itemLog.js attachments.js backup.js config.js

public/
  index.html
  style.css
  js/
    app.js app-core.js app-nodes.js helpers.js api.js
    app-<tab>-tab.js / app-<thing>-modals.js  (per-tab/per-modal components)
    app-item-detail-view.js  (item detail page, §2.3)
    svg-sanitizer.js markdown.js icons.js theme.js
  vendor/
    preact-htm-standalone.js
    qrcode-generator.mjs
  assets/icons/

test/
  backend/    real HTTP requests against the mounted plugin (fresh temp SQLite db per test)
  frontend/   pure data-layer helper tests (no DOM/JSDOM)
test-helpers/
  server.js   boots a real plugin instance + Express test harness

docs/
  screenshots/   *.png, referenced from README.md and package.json's signalk.screenshots
```

Attachment file bytes live outside this tree, on disk under
`<dataDir>/attachments/<item_id>/<attachment_id>` — the plugin's runtime
data directory, not the source tree.

## 8. Deployment

Installed via the Signal K Admin UI's App Store, or `npm install
signalk-stowage-mgmt` in the server's data directory (`~/.signalk`),
followed by a server restart. Plugin config (including the new QR-labels
base-URL field) persists under
`~/.signalk/plugin-config-data/signalk-stowage-mgmt.json`, managed by
signalk-server itself, not by this plugin directly. The SQLite database
and attachment files live under the plugin's own data directory
(`app.getDataDirPath()`), separate from plugin config.

No separate deployment step for the webapp — it's served as static files
by the same plugin process (via the `signalk-webapp` package.json
keyword), mounted at `/signalk-stowage-mgmt/` — its own package-name
path at the server root, distinct from the `/plugins/signalk-stowage-mgmt/`
API mount (§5).

## 9. Future Considerations

See ROADMAP.md for longer-horizon ideas (e.g. per-batch/multiple
expiration dates) not designed against here. Nothing in the QR-labels MVP
(§9.2 in SPEC.md) forecloses those — labels are additive and don't touch
the items/expiration data model.

The item detail page's section-based layout (§2.3) is deliberately
composable — a future section (e.g. a "related items" or barcode section)
would just be a fifth entry in the same config array, not a redesign.
Live-filtering (§2.5) is independent of it — a future extension there
(e.g. filtering Stock Alerts too) wouldn't touch the detail page either.
