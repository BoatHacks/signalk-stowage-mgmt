# signalk-stowage-mgmt Specification

## 1. Introduction

### 1.1 Purpose

`signalk-stowage-mgmt` is a Signal K server plugin for tracking what's
stowed where on a boat. It lets a crew organize items into nested storage
spaces and containers, track actual vs. target quantities, locate an item
via a clickable SVG floorplan, and keep a history of consumption. It's
built to work entirely offline (no internet dependency) and to be usable
from touchscreen MFDs as well as phones/laptops.

The core problem it solves: on a boat, "where did we put the spare fuel
filters" and "are we low on flares" are questions people currently answer
by opening lockers, not by checking a system — this gives them a system
that's fast enough (and durable enough, running on the boat's own Signal K
server) to actually replace that.

### 1.2 Background

Originally scaffolded as `signalk-quartermaster` (a vanilla-JS/Express/
better-sqlite3 prototype), rewritten and renamed to `signalk-stowage-mgmt`
starting at v0.2.3. It runs as a standard Signal K server plugin —
installed via the Signal K App Store or `npm install`, configured via the
Admin UI's Plugin Config page, and serving its own webapp under
`/plugins/signalk-stowage-mgmt/`.

One other Signal K plugin, `signalk-maintenance-tracker`, integrates
directly against this plugin's REST API (see §5 and README's "Known
external consumers" section) rather than through any Signal K delta/data
model — there's no shared standard this plugin has to conform to beyond
being a well-behaved Signal K plugin (`registerWithRouter`, plugin
schema, `getSelfPath`).

### 1.3 Terminology

- **Storage space** — a named location that can contain containers, items,
  and other storage spaces (nested to any depth). Can be mapped to an area
  on a floorplan.
- **Container** — a named location that holds items (and can itself be
  nested inside a storage space or another container), but is never
  floorplan-mappable itself.
- **Location** — either a storage space or a container; used generically
  when the distinction doesn't matter.
- **Split item** — an item whose stock is divided across more than one
  location. Represented by one or more **placements** instead of a single
  `location_id`.
- **Placement** — one (location, quantity) pair for a split item.
- **Default storage location** — an optional placement a split item's
  quick +/- editors act on directly, instead of staying disabled the way
  a split item's quantity normally does everywhere outside the Split
  dialog.
- **Actual quantity** vs. **target quantity** — how much of an item there
  currently is, vs. how much there's supposed to be (used for the
  Understocked/Stock Alerts view).
- **Floorplan mapping** — the association between a storage space and one
  clickable SVG element (`svg_element_id`) on an uploaded floorplan.

## 2. Inventory & Location Rules

- A storage space or container can be nested inside another storage space
  or container, to any depth. The location graph must stay acyclic —
  re-parenting a location to one of its own descendants is rejected.
- A location cannot be deleted while it still has child locations or
  items.
- Only storage spaces can be mapped to a floorplan SVG element; containers
  cannot.
- A split item's placements' quantities must sum to its `actual_quantity`
  at all times — this invariant is enforced on every write path that
  touches placements (split, move, quantity edit, JSON import).
- A category name is unique; creating or renaming to a name that already
  exists is rejected (409).
- `actual_quantity` must be a non-negative integer everywhere it's
  accepted.

## 3. Data Model

- **Location** — `id`, `name`, `type` (`storage_space` | `container`),
  `parent_id`, `floorplan_id` + `svg_element_id` (storage spaces only),
  `created_at`.
- **Item** — `id`, `name`, `actual_quantity`, `target_quantity`, `notes`,
  `location_id` (null if split or unlocated), `default_location_id`,
  `thumbnail` (a `data:` URI), `expires_at`, `created_at`. Many-to-many
  with **Category** via `item_categories`.
- **Item Placement** — `id`, `item_id`, `location_id` (nullable — "not
  stored anywhere"), `quantity`. Only exists for split items; a plain
  item has zero placement rows.
- **Category** — `id`, `name` (unique), `created_at`.
- **Floorplan** — `id`, `name`, `svg_content` (the raw SVG markup, stored
  as text — sanitized before being rendered, see ARCHITECTURE §6),
  `uploaded_at`.
- **Item Attachment** — `id`, `item_id`, `filename`, `mime_type`, `size`,
  `uploaded_at`. File bytes live on disk, not in the database (see
  ARCHITECTURE §7).
- **Item Log entry** — an append-only audit trail: `event`
  (`created` | `actual_quantity` | `target_quantity` | `deleted` |
  `split`), `old_value`/`new_value`/`delta`, `note`, `from_location_*` /
  `to_location_*`, `created_at`. Never modified or deleted once written,
  except that it's excluded (not migrated) by a JSON import/restore.

QR labels (§9.2) introduce no new persisted entity — a label is generated
on demand from a Location's existing `id`/`name`/breadcrumb path. The only
new persisted state is the base-URL config value (§8).

## 4. Sources / Inputs

All inventory data originates from direct user action in the webapp —
there's no sensor or telemetry input. The one external Signal K data
dependency is optional: if present, `vessels.self.environment.sun` (or the
simpler `environment.mode` fallback) drives the auto light/dark theme
option. If neither path exists or has a recognized value, the plugin
degrades to the manual theme toggle with no error.

## 5. API Specification

The full endpoint reference (request/response shapes, status codes) lives
in README.md's API section — this is a contract summary, grouped by
resource, not a duplicate of it.

| Resource | Endpoints |
|---|---|
| Locations | CRUD, move (re-parent, cycle-checked), SVG-mapping assign/clear |
| Items | CRUD, thumbnail, move, split/placements, categories, attachments, locate |
| Item Log | list with optional date range |
| Categories | CRUD (name-unique) |
| Floorplans | CRUD (SVG content) |
| Backup | `GET /export` (full snapshot), `POST /import` (full replace) |
| Config | `GET /webapp-config` (theme recommendation, feature flags) |

All responses are JSON; errors are the flat shape `{ "error": "..." }`,
never nested — a documented gotcha for external consumers (see
`signalk-maintenance-tracker`'s docs, which got this wrong once).

### 5.1 QR Labels (new — see §9.2)

No new backend endpoints are required for MVP: a label is rendered
entirely client-side from data the webapp already has (a Location's id,
name, and breadcrumb path) plus the configured base URL (§8). The only new
contract is the **deep link** a QR code encodes:

```
<base-url>/plugins/signalk-stowage-mgmt/?location=<location-id>
```

On load, if a `location` query param is present, the webapp jumps straight
to the Inventory tab with that location's node expanded (see §6, §9.2) —
this is the only new "API" surface, and it's a client-side URL contract,
not a server endpoint.

## 6. User Interface

Tabs: Inventory, Floorplan, Categories, Overview (Table + Touch views),
Stock Alerts, Store Log. Design constraints:

- Buildless Preact + htm SPA — no bundler, no build step, everything
  vendored as plain `<script type="module">` files.
- Must run on Chromium 69+ (embedded MFD browsers), which rules out
  relying on very recent JS/DOM APIs.
- Touch-target sizing and layout must hold up on both MFD touchscreens and
  phones (several past issues — #19, #20, #22 — were narrow-screen/touch
  regressions found after the fact; new UI should be checked against both
  form factors up front).

### 6.1 QR Labels UI (new)

- A batch **"Print Labels"** page: multi-select any storage space or
  container (any depth), lay out selected labels on a print-ready grid,
  and use the browser's native print dialog (`window.print()` +
  print-specific CSS) — no generated PDF file.
- A **single-label** action available from each location's own actions
  menu, for the common case of just wanting one label right now.
- Each label: QR code (SVG), the location's name, its breadcrumb path
  (e.g. "Galley → Spice Rack"), and the stowage-mgmt app icon centered in
  the QR code itself.
- Scanning a label's QR code opens the deep link from §5.1, which jumps to
  the Inventory tab with that location's node expanded — the same
  behavior regardless of whether the location happens to be
  floorplan-mapped, for consistency and simplicity.

## 7. Persistence

Everything in §3 except attachment file bytes lives in one SQLite database
(`inventory.db`, via `node:sqlite`) in the plugin's data directory.
Attachment file contents live on disk under
`<dataDir>/attachments/<item_id>/<attachment_id>`, since they're unbounded
in size and count. The QR-labels base-URL value (§8) is Signal K plugin
config, not a database row.

## 8. Configuration

Existing plugin options (Signal K Admin UI → Plugin Config):

- **Automatically switch light/dark theme based on sun position** (off by
  default).
- **Dynamic +/- scale for touch interface** (off by default).

New, for QR labels:

- **Server URL for QR labels** (text field, default empty). The Print
  Labels UI pre-fills a working default from `window.location.origin` at
  generation time, so most boats never need to touch this — the field
  exists as an override for setups where that default would be wrong
  (e.g. labels generated from a device other than the boat's own display,
  behind a reverse proxy with a different public hostname).

## 9. MVP Scope

### 9.1 Already Shipped

See CHANGELOG.md for the full version-by-version history. In brief: split
items across locations, expiration tracking, consumption-rate prediction,
file attachments, nested storage spaces, an automated test suite, edit
mode, auto theme, JSON export/import (full-replace), a touch-optimized
Overview view, and (as of the current cycle) floorplan-SVG sanitization
and several backend hardening fixes.

### 9.2 QR Labels MVP

- Single-label generation from any location's actions menu.
- Batch "Print Labels" page: multi-select (any location, any depth) +
  print-ready grid via the native print dialog.
- Each label: SVG QR code (error-correction level `H`, to tolerate the
  logo overlay) + name + breadcrumb path + centered app-icon overlay.
- Scanning always opens the Inventory tab with the location's node
  expanded.
- New Plugin Config field: Server URL for QR labels, pre-filled with
  `window.location.origin` by the UI.
- Vendored `qrcode-generator` (MIT, zero deps, single ES module) for
  encoding — see ARCHITECTURE §4.

### 9.3 Post-MVP / Deferred

- **Merge/append JSON import mode** (issue #26) — deferred because it
  needs a real ID-remapping and name-collision policy, not yet designed.
- **Touch drag-and-drop** (issue #23) — deferred because it needs either a
  touch-compatible drag library or non-drag fallback affordances added
  throughout the app; the existing non-drag fallbacks (e.g. the Move
  dialog's target-chip list) cover the most-used paths already.
- **Photo crop/pan touch support** (issue #24) — low priority, minor
  feature.
- **Search-result tap hardening on touch** (issue #25) — needs real-device
  testing before a fix can be verified.
- **Per-batch/multiple expiration dates per item** (ROADMAP.md, targeted
  "v2.0.0") — a bigger data-model change than the initial single-date
  implementation, deferred for the same reason split-items work was scoped
  carefully.

## 10. References

- README.md — full API reference, Usage section (screenshots), Known
  external consumers.
- CHANGELOG.md — complete version history.
- ROADMAP.md — longer-horizon ideas not yet scheduled.
- GitHub issues #14 (QR labels — the issue this MVP scope resolves), #26,
  #25, #24, #23 (deferred items above).

## 11. Design Decisions

- **SVG output for QR labels, not raster.** Print quality matters more
  than generation simplicity here — an SVG stays crisp at any print DPI,
  and `qrcode-generator`'s `createSvgTag()` produces plain vector markup
  with no canvas/DOM dependency, so it's no harder to use than the raster
  path would have been.
- **Error-correction level `H`.** Needed specifically because the label
  overlays a logo in the middle of the code; `H` (~30% redundancy)
  tolerates that obstruction. A plain QR code with no overlay wouldn't
  need this.
- **"Always Inventory tab" over floorplan-aware scan target.** The
  floorplan-if-mapped behavior (matching click-to-locate elsewhere in the
  app) was considered and rejected for QR scans specifically, to keep the
  scan behavior simple and predictable — one target, not two branches
  depending on mapping state.
- **Plugin Config field (with a pre-filled default) over pure
  auto-detection.** `window.location.origin` is right for the common case
  (someone on the boat's own display generating labels), but Signal K
  plugins can't reliably know the LAN IP/hostname/reverse-proxy setup in
  general, so a manual override stays available rather than trusting
  auto-detection unconditionally.
- **No new backend endpoints for QR labels.** Everything needed (location
  id, name, breadcrumb path) is already in data the webapp holds; adding a
  server-side label-rendering endpoint would just be extra surface for no
  benefit, since the client can render the SVG itself.
- **Vendored `qrcode-generator` over a CDN or bundler-installed
  dependency.** Matches how Preact/htm are already vendored, and keeps the
  "works with no internet" principle intact — a CDN dependency would
  break offline use, and this project has no build step to run an
  npm-installed dependency through.

## 12. Open Questions

None outstanding for QR labels — all of the original issue's open
questions were resolved during this spec's brainstorm (see §11 for the
resolutions and reasoning).
