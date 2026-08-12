# SignalK Stowage Management

> ⚠️ **Warning:** this is 100% vibecoded AI slop, install and use at your own risk, and always remember: only you can prevent grey goo! never release nanobot assemblers without replication limiting code.

Inventory manager for Signal K Server. Organize items into containers and
storage spaces (nested to any depth), track actual vs. target quantities,
attach photos and markdown notes, upload an SVG floorplan of your boat, map
areas on the floorplan to storage spaces, and make the matching area blink
(or pop open a contents list) when you search for an item.

## Installation

**Requires Node.js 22.5.0 or newer** (uses the built-in `node:sqlite` module —
no native dependencies to compile, so installation is simple on any platform,
including the Signal K App Store's script-free install process).

**Not compatible with Victron Cerbo GX / Venus OS**, at least as of this
writing — those ship Node.js 20, which predates `node:sqlite`. This plugin
won't run there until Venus OS bundles a newer Node.js version.

**Via the Signal K App Store (recommended):** open the Signal K Admin UI,
go to **Server → App Store**, search for "Stowage Management", and click
**Install**. Restart the server when prompted, then enable the plugin under
**Server → Plugin Config**.

**Manual installation**, if you'd rather not use the App Store:

1. Copy the folder into your Signal K directory, e.g.
   `$HOME/.signalk/node_modules/signalk-stowage-mgmt` — or develop locally and
   link it in with `npm link` (see the Signal K plugin docs).
2. Install dependencies:
   ```
   cd signalk-stowage-mgmt
   npm install
   ```
3. Restart the Signal K server.
4. In the Admin UI, enable the plugin under **Server → Plugin Config**
   ("Stowage Management").
5. The webapp is then available at:
   `http://{skserver}:3000/signalk-stowage-mgmt/`
   (also linked from the Webapps list in the Admin UI, as "Stowage
   Management").

## Configuration

Set in the plugin's config page in the SignalK Admin UI
(Server → Plugin Config → Stowage Management):

- **Automatically switch light/dark theme based on sun position**
  (off by default). When on, the webapp's theme follows
  `vessels.self.environment.sun` (preferred — one of dawn, sunrise, day,
  sunset, dusk, or night; published by a plugin like
  `signalk-derived-data`) or, if that's not available,
  `vessels.self.environment.mode` (a simpler day/night fallback some
  setups use instead). Everything except "day" is treated as dark, to
  protect night vision from dusk through dawn rather than only once it's
  fully dark. Overrides the manual light/dark toggle in the header (see
  "Header controls" below) while it's on; if neither path has a
  recognized value yet, the manual/OS-preference theme is left alone.

- **Dynamic +/- scale for touch interface** (off by default). When on,
  the Overview tab's Touch view shows up to four quick-adjust buttons per
  chip instead of two: a coarse step and a fine step on each side (e.g.
  −1000 / −100 / +100 / +1000 for a quantity in the thousands), scaled to
  the quantity being adjusted based on digit count (so a round number
  like 5000 doesn't get an oversized step just for being round). For
  single-digit quantities the coarse and fine steps are the same, so only
  one +/- pair is shown. Useful once you're tracking bulk goods by weight
  or volume (e.g. grams) rather than by piece.

- **Server URL for QR labels** (blank by default). The absolute base URL
  (e.g. `http://192.168.1.50:3000`) a printed location QR label's link
  points at. Signal K plugins can't reliably auto-detect the right LAN
  address/hostname, so the Print Labels UI pre-fills a working guess from
  the browser's own address when you open it — only set this if that
  guess would be wrong (e.g. labels generated from a device other than
  the boat's own display).

- **Item detail page sections** (all five shown, in this order, by
  default: Placements, Floorplan, History, Properties, Attachments).
  Remove a section from the list to hide it on the item detail page, or
  reorder the list to change where it appears. Removing all five still
  leaves the page's header (name, photo, quantity). When Floorplan is
  hidden, Placements shows a "Locate on floorplan" button instead.

## Usage

**Header controls (present on every tab):** a search box (see "Search"
below); an **Edit mode** toggle; and a light/dark theme toggle (see
"Configuration" above for automatically switching this based on sun
position instead).

Edit mode is off by default. While it's off, each item/container/storage-
space chip's action buttons (edit, photo, split, move, delete, add
category — or add-storage-space/add-container/add-item/rename/delete/
move for a location) are collapsed behind a single "..." button, to keep
the tree uncluttered — click it to temporarily reveal that one chip's
buttons (only one chip's menu stays open at a time; opening another one,
or flipping the global toggle, collapses it back). Turning Edit mode on
shows every chip's buttons everywhere, all the time, with no "..." at
all. This is unrelated to the Floorplan tab's own "Edit"/"Save" toggle
(for assigning floorplan areas — see below); the two don't interact.

**Inventory (tab):**

![Inventory tab](docs/screenshots/inventory.png)

- "+ Storage Space" (toolbar) creates a new top-level storage space (e.g.
  "Lazarette"). Every node also has its own "+ Storage Space", for nesting
  one inside another (e.g. "Port Locker" inside "Aft Cabin") — storage
  spaces can be mapped to a floorplan area at any depth, not just at the
  top level.
- Every node (storage space or container, at any depth) is collapsible
  (expanded by default) — click the ▾/▸ arrow next to the name to fold it
  up. Collapsed, it shows a summary instead of its contents: "*n* spaces,
  *n* containers, *n* items" (nested storage spaces/containers at any
  depth, and items anywhere in the subtree — a split item counts once
  even if only some of its placements fall inside). "Collapse All"/
  "Expand All" in the toolbar toggles every node at once.
- Per node: "+ Container" (nestable to any depth), "+ Item", plus icon
  buttons on each item: edit (properties), photo, split, move, delete,
  add category (collapsed behind "..." unless Edit mode is on — see
  "Header controls" above).
- Containers can be dragged directly onto another container or storage
  space to move them (or dragged onto the floating "Not Stored" panel to
  detach them to the top level). Items can likewise be dragged onto any
  storage space/container, or dragged straight onto an assigned floorplan
  area to stow them there. Storage spaces aren't draggable — once placed,
  re-parenting one takes deleting and recreating it under the new parent.
- Items show actual quantity (click to edit inline, with +/- steppers) and
  target quantity, if set, as "×3 / 6".
- "Export as Markdown" renders the whole inventory tree — every storage
  space and container (marked `*S*`/`*C*` after its name, so the type
  survives being flattened into plain headings), including empty ones,
  nested to any depth, with items with quantities/targets, plus a "Not
  Stored" section for orphans — into a copyable markdown document. Doesn't
  include categories, notes, expiration dates, photos, or attachments;
  use "Export to JSON" for a complete, lossless snapshot instead.
- "Export to JSON" downloads a full snapshot (see the API table below for
  exactly what's in it); "Import from JSON" **replaces** the current
  inventory with a previously exported file, after a confirmation dialog —
  it's a restore, not a merge, so export a fresh backup first if you're
  not sure.
- "Print Labels" (toolbar) opens a page to select any storage space or
  container (any depth) — or "Select All"/"Select None" to toggle every
  one at once — and print a QR-coded label for each. Scanning one opens
  this webapp with that location expanded in the Inventory tab, so a
  locker/bin can carry a label that jumps straight to what's supposed to
  be inside it. Each node also has its own single-label "Print QR label"
  action, for printing just one without the batch page. See "Server URL
  for QR labels" under Configuration if labels end up
  pointing at the wrong address.
- The floating "Not Stored" panel (bottom/top-right of the screen,
  depending on context) lists any containers with no parent and any items
  with no location — normally hidden, it appears automatically whenever
  something is orphaned or while a drag is in progress, and doubles as a
  drop target to detach things.
- **Splitting an item's stock across locations:** click "Split" on any
  item chip (works whether the item is already split or not), choose a
  destination and quantity, and it appears at both places. A split item
  renders as one chip per location, each showing that location's own
  quantity — editable inline just like a normal item's (setting it to 0
  removes that placement; if only one location is left, the item
  automatically reverts to being a plain, unsplit item); drag a specific
  chip to move just that portion; use "Split" again to redistribute
  further. The item's overall quantity is always the sum of its
  placements, and is read-only in the Item Properties dialog (and on the
  Understocked page, since there's no single location to attribute a
  change to) — edit it via a placement chip or the Split dialog instead;
  name, notes, target quantity, photo, and categories stay item-level and
  editable as normal regardless. While dragging any item, a floating
  "Drop here to split" panel appears (alongside "Not Stored") — dropping
  onto it opens the Split dialog for whatever you were carrying,
  defaulting the source to wherever it was just dragged from. Searching
  for or locating a split item blinks every one of its mapped areas on
  the floorplan at once.

**Item properties (edit icon on any item):**
- Name, actual quantity, target quantity (leave blank for "no target").
- **Default Storage Location** (split items only, optional): pick one of
  the item's current placement locations — listed by full breadcrumb path
  (e.g. "Aft Cabin → Locker"), not just the bare name, since nested
  storage spaces can share a name at different depths — e.g. beans mostly
  live in the galley, but there are a few extra cans in the bilge too, so
  "Galley" is
  the default. The quick +/− quantity editors elsewhere (Overview,
  Categories, the Touch view's big buttons) act on the stock at this
  location specifically, showing its quantity rather than the total
  across all locations (a tooltip on the quantity gives the total).
  Without a default set, those quick editors stay disabled for a split
  item — same as always, use Split instead. Automatically cleared if that
  placement is later fully drained, merged into a different location via
  a move, or the item collapses back to a single (plain) location
  entirely — the "use Split instead" quick editors just go back to being
  disabled in that case, nothing is lost.
- Notes: a small dependency-free markdown editor with **Show** (rendered
  preview, default) and **Edit** (raw markdown) tabs. Supports headings,
  **bold**, _italic_, `code`, links, and lists.
- Photo (separate camera icon): upload an image, drag to pan and use the
  slider to zoom, then save a square-cropped thumbnail. Shown on the item
  row, the Overview table, and the Stock Alerts tab.
- Attachments: upload any file (manuals, spec sheets, receipts — no size
  limit or type restriction). Click one to open/download it via the
  browser's native handling. Stored on disk, not in the database.

**Floorplan (tab):**

![Floorplan tab](docs/screenshots/floorplan.png)

- Don't have an SVG floorplan of your boat yet? [ClearShip's free Boat
  Floor Plan Editor](https://clearship.app/tools/floor-plan) is a nice
  way to make one — draw your layout in the browser with predefined
  hull/berth/galley/engine symbols, or trace over a photo of your
  manual's deck plan, then export straight to SVG. No signup, nothing
  leaves your browser, and the exported file drops right into the
  upload step below.
- Only the single most recently uploaded SVG is shown. Uploading a new one
  replaces it. If the new SVG has elements with the **same id** as ones your
  storage spaces were already mapped to, those assignments carry over
  automatically — no need to re-map anything just because you touched up
  the file in your SVG editor. Only storage spaces whose matching area is
  genuinely gone (a different or removed id) will lose their assignment,
  and you'll get a confirmation warning naming exactly those, since that
  part can't be undone.
- **Important:** only SVG elements (`path`, `polygon`, `rect`, `circle`,
  `ellipse`) that already have a **custom** `id` attribute in the SVG
  source can be clicked and assigned. Auto-generated IDs from your SVG
  editor (e.g. Inkscape's default `path10340`, `rect4821-3`, etc.) are
  ignored, so tracing a floorplan without renaming anything won't turn
  every single shape into a storage area. Give the shapes you want to use
  a custom ID, e.g. in Inkscape's "Object Properties" panel, or by editing
  the SVG source directly.
- **Display mode** (default): click an area to pop open a panel showing
  everything stored in the matching storage space (fully interactive —
  same container/item rendering as the Inventory tab).
- **Edit mode** (toggle via the "Edit"/"Save" button): unassigned areas are
  highlighted light blue. Click an area to open the assignment dialog,
  where you can pick an existing storage space, or type a name and click
  "+ Storage" to create a new one on the spot and assign it in one step —
  the field is pre-filled with a name guessed from the area's SVG id
  (e.g. `area-navtable` → "Navtable"), which clears on first click so you
  can type your own. Existing storage spaces are listed by their full path
  (e.g. "Aft Cabin → Port Locker"), not just their bare name, since nested
  storage spaces can share a name at different depths (e.g. a "Port
  Locker" under both Aft Cabin and Fwd Cabin).
- If two areas visually overlap on the floorplan (e.g. a locker drawn
  above a berth, with storage space behind/below it), only the topmost one
  is clickable. For the one underneath, use the **"ID"** button on
  that storage space (in the Inventory tree) to type its SVG element id
  directly instead — no click required. Leave the field blank to remove
  the mapping.

**Categories (tab):**

![Categories tab](docs/screenshots/categories.png)

- "+ Category" creates a new category. Four defaults are seeded on first
  start: "food", "spare part", "equipment", "tools".
- Each category is a collapsible fold-down; click its header to expand and
  see every item that carries it (with location and the full item row,
  fully interactive). Rename or delete from the header; the count shown is
  how many items currently carry that category. Clicking an item (its
  location text or thumbnail/name — not one of its own action buttons)
  jumps to the Floorplan tab and makes the matching area blink, same as
  clicking a row on the Overview tab or picking a search result.
- Deleting a category removes it from every item that had it — the items
  themselves are untouched.

**On each item:**
- Category badges are shown under the item; click the "×" on a badge to
  remove that category, or use the category dialog to toggle several at
  once by clicking chips (green = assigned).
- An item can carry any number of categories at once.

**Overview (tab):**

![Overview tab](docs/screenshots/overview.png)

- Table of all items with thumbnail, actual quantity (click to edit
  inline, same as everywhere else — except for a split item, which shows
  a tooltip pointing you at Split instead), target quantity, direct
  location, full path (e.g. "Lazarette → Tool box"), categories, and
  whether the location is mapped on the floorplan.
- Click column headers to sort, use the text field to filter by item name,
  direct location, and path.
- Clicking a row jumps to the Floorplan tab and makes the area blink, same
  as search (if it's mapped).
- **Touch view** (toggle next to "Table" in the toolbar):

  ![Overview tab, Touch view](docs/screenshots/overview-touch.png)

  A touchscreen-friendly alternative — every item as a big square chip
  (thumbnail, name, direct location) with its own always-visible −/+
  buttons for quick stock adjustment, no click-to-reveal step (a split
  item's buttons are disabled, same "use Split instead" reasoning as the
  table view). Sort by **Recent Activity** (default — items with the most
  actual-quantity changes in the last 30 days first, ties broken
  alphabetically) or **Alphabetical**. A location dropdown filters to only
  items stored at or below a chosen storage space/container, at any
  depth. Tapping a chip's body (not its −/+ buttons) locates it on the
  floorplan, same as the table view.

**Stock Alerts (tab):**

![Stock Alerts tab](docs/screenshots/stock-alerts.png)

- Lists every item that's understocked (target quantity set and actual
  below it), expiring (already expired, or expiring within 14 days — a
  fixed window for now), or both — most urgent first (expiring items
  soonest/most-overdue first, then understocked-only items alphabetically).
  Each shown as a large-thumbnail chip with name, an "Understocked" and/or
  "Expiring" badge, editable actual quantity, target quantity, and an edit
  button.
- Set an optional expiration date on an item via the Item Properties
  dialog. One date per item — if you buy the same thing at different
  times with different expiration dates, there's currently no way to
  track those as separate batches on a single item (create separate items
  if you need that today; see `ROADMAP.md`).
- Its "Export as Markdown" button produces a shopping list grouped by
  shop, covering both understocked and expiring items — an expiring item
  is treated as if it had 0 in stock (so it's listed at its full target
  quantity, or its current on-hand quantity if no target is set), with
  an "expires \<date\>" note appended. To assign an item to a shop, put a
  line reading `source: <shop name>` anywhere in that item's notes (e.g.
  `source: West Marine`) — it can be on its own line alongside other
  notes text, and matching is case-insensitive. Items without a `source:`
  line are grouped under "No Shop Specified". Within each shop's group,
  items are sorted by category.
- Expiration status isn't tracked in the Store Log.

**Store Log (tab):**

![Store Log tab](docs/screenshots/store-log.png)

- An audit trail of item creation, actual/target quantity changes,
  deletion, and splits — useful for questions like "how many rolls of
  toilet paper did we use last month?" Moving an item (or one placement
  of a split item) between locations is not logged.
- Preset buttons (Last Week/Month/Quarter/6 Months/Year) or manual date
  pickers set the range shown, shared across all five sections below.
- **Individual Movements**: one row per movement event (item creation,
  quantity increase/decrease, or deletion), newest first — item, Added or
  Used amount, the location it was added to or used from (the specific
  placement's location for a split item; blank for events before this
  was added), timestamp, and note.
- **Aggregate Movements**: Added/Used totals per item across the whole
  date range, sorted by Used, descending. No location column — it's a
  per-item summary, not a per-event one.
- **Target Adjustments**: a plain chronological list (target quantity is a
  goal, not a consumed resource, so it isn't aggregated) — From, To, date,
  and the note if one was left.
- **Splits**: a chronological list of split actions — Item, From, To,
  Quantity, date, and the note if one was left. Ordinary moves (including
  moving a single placement of a split item) aren't split actions and
  don't appear here.
- **Predicted Runway**: for items with at least 3 separate consumption
  events within the selected date range, projects a consumption rate
  (total consumed ÷ days in range) and estimates days remaining and an
  approximate run-out date from the item's current stock. Items with
  fewer than 3 qualifying events in the range aren't shown — not enough
  data to estimate a rate. Sorted soonest-to-run-out first. Restocking
  doesn't affect the rate, only the current-stock starting point.
- Adding a note to a quantity change: only available from the Item
  Properties dialog's Save action, not the quick inline quantity editor.
- Each section has its own "Export as Markdown" button, producing just
  that section's table as its own document.

**Search:**
- Type into the search box at the top; it does two things at once:
  - Live-filters the Inventory tab's tree and the Overview tab's table/
    touch rows down to matching items as you type (matching either the
    item's name/notes, or the name of a location — a location match
    reveals its whole contents, not just the matching item). Clearing the
    box restores the full view. Overview no longer has its own separate
    filter field — this one box drives both tabs.
  - Shows a dropdown of matching results (name/notes match, with a short
    snippet of surrounding text when the match is only in notes);
    clicking one opens that item's detail page (see "Item detail page"
    below).

**Item detail page:**
- Opened by clicking a search result, an item chip's "View details"
  action, or an Overview row/chip.
- Shows the item's placements (with large +/- quantity editors), the
  mapped floorplan area(s) inline (blinking, the same way search used to
  jump to the Floorplan tab and blink — or, if that Floorplan section is
  hidden via config, a "Locate on floorplan" button in Placements does the
  jump instead), its log history, properties (photo, categories,
  expiration, notes), and attachments — each section independently
  configurable, see "Configuration" above.
- Deep-linkable: `<server-url>/signalk-stowage-mgmt/?item=<item-id>`
  opens the page directly, the same way a QR label's `?location=<id>` link
  opens the Inventory tab (see "Known external consumers" below). Note this
  is the webapp's own static mount (the plugin's package name, served at
  the server root) — not `/plugins/signalk-stowage-mgmt/`, which is the
  separate JSON API mount and has no page to serve at `/`.

## Data model

SQLite database stored under the Signal K data directory (`inventory.db`).
All primary keys are UUIDs (`TEXT`), all tables have `created_at` (or
`uploaded_at`) defaulting to the current timestamp.

**`floorplans`**

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT, PK | |
| `name` | TEXT | Filename the SVG was uploaded as (extension stripped) |
| `svg_content` | TEXT | Raw SVG markup, stored as-is |
| `uploaded_at` | TEXT | Used to determine "most recent" for display |

Only the most recently uploaded floorplan is ever shown in the UI; older
rows are deleted (after their area mappings are cleared) when a new one is
uploaded, so in practice this table normally holds at most one row.

**`locations`** — storage spaces and containers share one table

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT, PK | |
| `name` | TEXT | |
| `type` | TEXT | `storage_space` or `container` (CHECK constraint) |
| `parent_id` | TEXT, FK → `locations.id` | `ON DELETE SET NULL`. Nesting: containers can nest inside containers or storage spaces to any depth; storage spaces can likewise nest inside another storage space or container to any depth (or have `parent_id = NULL` for top-level) — a storage space maps to a floorplan area independently of its own nesting depth |
| `floorplan_id` | TEXT, FK → `floorplans.id` | `ON DELETE SET NULL`. Only meaningful on `storage_space` rows |
| `svg_element_id` | TEXT | The `id` attribute of the matched SVG shape. Only meaningful on `storage_space` rows |

**`items`**

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT, PK | |
| `name` | TEXT | |
| `actual_quantity` | INTEGER, default 1 | How many you actually have. For a split item (see `item_placements` below), this is the sum of its placements' quantities and can only change via `POST /items/:id/split` (reallocating between locations) or `PATCH /items/:id/placements/:placementId` (changing one placement's quantity directly) |
| `target_quantity` | INTEGER, nullable | Desired stock level; `NULL` means "no target set" and excludes the item from the Stock Alerts tab's understocked check regardless of `actual_quantity` |
| `notes` | TEXT, nullable | Free-text, rendered as markdown in the UI. (Earlier versions had a separate `description` column; it was merged into `notes` and dropped.) |
| `location_id` | TEXT, FK → `locations.id` | `ON DELETE SET NULL`. `NULL` means "not stored anywhere" **or** "this item is split across locations" — check `item_placements` to tell which |
| `thumbnail` | TEXT, nullable | Square-cropped photo as a `data:` URI (JPEG), or `NULL` |
| `expires_at` | TEXT, nullable | Optional expiration date (`YYYY-MM-DD`). Not tracked in `item_log` |
| `default_location_id` | TEXT, FK → `locations.id`, nullable | `ON DELETE SET NULL`. Only meaningful for a split item — must match one of its current `item_placements`' `location_id` (enforced on write). The quick +/− quantity editors (Overview, Categories, the Touch view) act on this placement's quantity when set, instead of staying disabled. Automatically cleared back to `NULL` whenever that placement is drained to 0, merged elsewhere via a move, or the item collapses back to a single (plain) location |

**`item_placements`**

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT, PK | |
| `item_id` | TEXT, FK → `items.id` | `ON DELETE CASCADE` |
| `location_id` | TEXT, FK → `locations.id`, nullable | `ON DELETE SET NULL`. `NULL` means this portion is unassigned ("no location") |
| `quantity` | INTEGER | |

An item has **no** rows here in the normal case — its stock lives entirely
in `items.location_id`/`actual_quantity`. Rows only appear once an item has
been split across two or more locations via `POST /items/:id/split`, at
which point `items.location_id` becomes `NULL` and `items.actual_quantity`
tracks the sum. If a split later collapses back down to a single location
(e.g. moving everything back together), the placement rows are removed and
the item reverts to the plain representation automatically.

**`item_log`**

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT, PK | |
| `item_id` | TEXT | Not a foreign key — rows survive item deletion |
| `item_name` | TEXT | Snapshotted at the time of the event, so history reads correctly after renames |
| `event` | TEXT | `created`, `actual_quantity`, `target_quantity`, `deleted`, or `split` |
| `old_value` / `new_value` | INTEGER, nullable | The quantity before/after. `NULL` for a target quantity that was unset, or for a `split` event (see `from_location_id` etc. below instead) |
| `delta` | INTEGER | `new_value - old_value`. Always `0` for a `split` event, since splitting reallocates existing stock rather than adding or removing it |
| `note` | TEXT, nullable | Optional, set via the Item Properties dialog (quantity changes) or the Split dialog (splits) |
| `from_location_id` / `from_location_name` | TEXT, nullable | The location for a "used from" movement: the `from` side of a `split` event, or the item's (or specific placement's) location for an `actual_quantity` decrease or a `deleted` event. `NULL` for an `actual_quantity` increase, a `created` event, an unlocated item, or a row written before this was added. Deleting a *split* item sets `from_location_name` to a descriptive `"Split (N locations)"` with `from_location_id` left `NULL`, since there's no single location to point at. Name is snapshotted, same reasoning as `item_name` |
| `to_location_id` / `to_location_name` | TEXT, nullable | The location for an "added to" movement: the `to` side of a `split` event, or the item's (or specific placement's) location for an `actual_quantity` increase or a `created` event. Same nullability/snapshotting conventions as `from_location_id` |
| `quantity` | INTEGER, nullable | Set only for `split` events — how many units moved |
| `created_at` | TEXT | |

A row is written whenever an item is created, its `actual_quantity` or
`target_quantity` changes, it's deleted (logged as using up whatever
quantity remained), or its stock is split across locations via
`POST /items/:id/split`. Moving an item (or one placement of a split item)
between locations is **not** logged — only the act of splitting is.


**`categories`**

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT, PK | |
| `name` | TEXT, UNIQUE | |

**`item_categories`** — many-to-many join table

| Column | Type | Notes |
|---|---|---|
| `item_id` | TEXT, FK → `items.id` | `ON DELETE CASCADE` |
| `category_id` | TEXT, FK → `categories.id` | `ON DELETE CASCADE` |

Composite primary key `(item_id, category_id)`.

**`item_attachments`**

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT, PK | Also used as the on-disk filename |
| `item_id` | TEXT, FK → `items.id` | `ON DELETE CASCADE` |
| `filename` | TEXT | Original filename as uploaded — display-only, never used to build a filesystem path |
| `mime_type` | TEXT | From the upload's `Content-Type` header |
| `size` | INTEGER | Bytes |
| `uploaded_at` | TEXT | |

Unlike `thumbnail` (a small `data:` URI stored inline), attachment files are
unbounded in size and count, so they're **not** stored in SQLite — only
this metadata row is. The file itself lives on disk at
`<dataDir>/attachments/<item_id>/<attachment_id>`, deleted individually via
`DELETE /items/:id/attachments/:attachmentId` or all at once (best-effort)
when the item itself is deleted.

Indexes exist on `locations.parent_id`, `locations.floorplan_id`,
`items.location_id`, `item_categories.category_id`, and
`item_attachments.item_id`.

## API (under `/plugins/signalk-stowage-mgmt`)

Also published as an OpenAPI 3.0 spec (`openApi.json`), which renders in
the Signal K Admin UI under **Documentation → OpenAPI** once the plugin is
enabled.

All request/response bodies are JSON. Errors are `{ "error": "..." }` with
an appropriate HTTP status code.

**Known external consumers**

`signalk-maintenance-tracker`'s `inventory-interaction` feature calls this
API directly — the first (and so far only) external consumer. It depends on:

- `GET /items` — called same-origin, straight from its browser frontend
  (parts picker, stock badges), not proxied through its own backend.
- `GET /items/:id` — backend lookup before decrementing stock.
- `PATCH /items/:id` — decrements `actual_quantity` for non-split items.
- `PATCH /items/:id/placements/:placementId` — same, per-placement, for
  split items.
- The `Item` shape's `id`, `name`, `actual_quantity`, `target_quantity`,
  and `placements` (each `{ id, location_id, quantity }`).
- The `{ "error": "..." }` error shape, to distinguish "no such item" from
  "route doesn't exist" on `GET /items/:id`'s 404.
- The `?item=<item-id>` deep link (see "Item detail page" above) — the
  intended way for `signalk-maintenance-tracker` to link straight into
  this plugin's item detail page, e.g. from its own parts-picker UI.

**A note on auth for this integration:** every route above lives under
`/plugins/signalk-stowage-mgmt/*`, the same prefix every SignalK plugin's
routes are mounted under — and, like any other plugin route, it's covered
by Signal K's own security layer, not by anything this plugin adds itself.
With security **disabled** (the common case for a private, on-boat
server), all of the above works with no auth from any origin. With
security **enabled**, a same-origin browser call from another plugin's
frontend — such as `signalk-maintenance-tracker`'s `GET /items` and
`PATCH /items/:id` above — needs a session already authenticated with
sufficient permission, exactly as if it were calling any of this plugin's
own admin-UI-driven routes. There's no separate read-only/anonymous access
tier for this API the way there is for Signal K's own resource-provider
endpoints (which stay readable under `allow_readonly` regardless of the
security setting) — with security on and no authenticated session, callers
get a 401/403, not degraded read-only access. Keep this in mind before
relying on a same-origin fetch from another plugin's frontend on a
security-enabled server.

There's no version negotiation between the two plugins, so a breaking
change to any of the above won't fail loudly on either side — it'll just
silently break the integration. **Call this out explicitly in the
CHANGELOG** when it happens, even if the change doesn't touch this
plugin's own frontend at all. (See issue #18 for the fuller discussion —
no versioning/deprecation process beyond this is planned for now.)

**Locations** (storage spaces & containers)

| Method & path | Purpose |
|---|---|
| `GET /locations` | List all locations |
| `POST /locations` | Create. Body: `{ name, type, parent_id? }` (`type` is `storage_space` or `container`) |
| `PATCH /locations/:id` | Rename. Body: `{ name }` |
| `PATCH /locations/:id/move` | Re-parent. Body: `{ parent_id }` (omit/null for top-level). Rejects cycles |
| `PATCH /locations/:id/svg-mapping` | Assign/clear a floorplan area. Body: `{ floorplan_id, svg_element_id }` (storage spaces only) |
| `DELETE /locations/:id` | Delete (only if it has no child locations or items) |

**Items**

| Method & path | Purpose |
|---|---|
| `GET /items` | List all items, each with a `categories` array (`[{ id, name }]`) and a `placements` array (empty unless split — see below). Optional `?q=<text>` filters to items whose **name** contains the text (case-insensitive substring match; notes aren't searched). Returns every match, unbounded |
| `GET /items/:id` | Get a single item, same shape as an entry in the list above |
| `POST /items` | Create. Body: `{ name, actual_quantity?, target_quantity?, notes?, location_id?, category_ids?, note?, expires_at? }`. `note` is recorded in the item log for the initial quantity, not stored on the item itself |
| `PATCH /items/:id` | Partial update. Body: any of `{ name, actual_quantity, target_quantity, notes, note, expires_at, default_location_id }`. `target_quantity`/`notes`/`expires_at`/`default_location_id` support explicit `null` to clear them (distinct from omitting the key, which leaves them unchanged). `note` is logged against whichever of `actual_quantity`/`target_quantity` changed in this request (both, if both changed) — it isn't a field on the item itself. `expires_at` and `default_location_id` changes are not logged. **`actual_quantity` is rejected with 400 if the item is split** — use `PATCH /items/:id/placements/:placementId` (change one placement's quantity) or `POST /items/:id/split` (reallocate between locations) instead. **`default_location_id` is rejected with 400 unless it's `null`/omitted or matches one of the item's current placement locations** |
| `PATCH /items/:id/thumbnail` | Set/clear the photo. Body: `{ thumbnail }` — a `data:` URI string, or `null`/omitted to remove it |
| `PATCH /items/:id/move` | Move a whole (unsplit) item to a different location. Body: `{ location_id }` (omit/null to unassign). Not logged. **Rejected with 400 if the item is split** — move a specific placement via the endpoint below instead |
| `GET /items/:id/placements` | List an item's placements (`[{ id, location_id, location_name, quantity }]`). Empty array means it isn't split |
| `PATCH /items/:id/placements/:placementId/move` | Move one placement of a split item to a different location. Body: `{ location_id }` (omit/null for "no location"). Not logged, same as an ordinary move |
| `PATCH /items/:id/placements/:placementId` | Set one placement's quantity directly — the split-item equivalent of editing `actual_quantity`. Body: `{ quantity, note? }`. Logged as an ordinary `actual_quantity` event (not `split`), since this is a real stock change, not a reallocation. Setting a placement to `0` removes it; if that leaves only one placement, the item automatically reverts to the plain (unsplit) representation |
| `POST /items/:id/split` | Move `quantity` units of an item from `from_location_id` to `to_location_id` (both nullable, for "no location"), splitting the item across locations if it wasn't already. If not yet split, `from_location_id` must match the item's current `location_id`. If a split collapses everything back into one location, the item automatically reverts to the plain (unsplit) representation. Body: `{ from_location_id?, to_location_id?, quantity, note? }`. Always logged as a `split` event |
| `POST /items/:id/categories` | Add a category. Body: `{ category_id }` |
| `DELETE /items/:id/categories/:categoryId` | Remove a category |
| `DELETE /items/:id` | Delete the item. Logs a `deleted` event using up whatever quantity remained |
| `GET /items/:id/locate` | For a normal item: walks the parent chain upward until it finds a mapped storage space; returns `{ item_id, path, floorplan_id, svg_element_id, storage_space }`, or 404 with the (unmapped) `path` if none is found. For a **split** item: returns `{ item_id, split: true, matches: [...] }` — one entry per placement that resolves to a mapped storage space (placements with no mapped area are silently skipped; 404 only if none resolve) |
| `GET /items/:id/attachments` | List an item's attachments (`[{ id, item_id, filename, mime_type, size, uploaded_at }]`) |
| `POST /items/:id/attachments` | Upload a file. **Body is the raw file bytes**, not JSON — set `Content-Type` to the file's MIME type, and pass the original filename URI-encoded in the `X-Filename` header. No size limit, no file-type restriction |
| `GET /items/:id/attachments/:attachmentId` | Download/view the raw file, with its original `Content-Type` and a `Content-Disposition` set from `filename` — the browser handles it natively (inline for PDFs/images, download for anything else) |
| `DELETE /items/:id/attachments/:attachmentId` | Delete an attachment (row + file on disk) |

**Item Log**

| Method & path | Purpose |
|---|---|
| `GET /item-log` | List log entries, oldest first. Optional `?start=` / `?end=` query params (inclusive dates, e.g. `2026-06-01`) filter the range; optional `?item_id=` scopes to one item (used by the item detail page's History section); omit all three for the full history |

**Categories**

| Method & path | Purpose |
|---|---|
| `GET /categories` | List all categories |
| `POST /categories` | Create. Body: `{ name }` (409 if the name already exists) |
| `PATCH /categories/:id` | Rename. Body: `{ name }` (409 on name clash) |
| `DELETE /categories/:id` | Delete (also removes it from every item that had it, via `ON DELETE CASCADE`) |

**Floorplans**

| Method & path | Purpose |
|---|---|
| `GET /floorplans` | List floorplans (id/name/uploaded_at only), newest first |
| `GET /floorplans/:id` | Get one floorplan including its full `svg_content` |
| `POST /floorplans` | Upload. Body: `{ name, svg_content }` (raw SVG markup as text) |
| `DELETE /floorplans/:id` | Delete (400 if any storage space is still mapped to it — clear those mappings first) |

**Backup / restore**

| Method & path | Purpose |
|---|---|
| `GET /export` | Full inventory snapshot as JSON: categories, locations (with hierarchy and floorplan mappings), items (with their categories, placements, and attachment *metadata*), and the `id`/`name`/`svg_content` of every floorplan actually referenced by a location mapping. Deliberately excludes attachment file contents and Store Log history — see below |
| `POST /import` | **Replaces** categories/locations/items entirely with the given snapshot (same shape `GET /export` returns) — a restore, not a merge. Floorplans (including any in the snapshot) are never created or modified by import, nor are attachment files or Store Log history. Returns `{ restored: { categories, locations, items }, dropped_floorplan_mappings, remapped_floorplan_mappings }` |

Import never creates or overwrites a floorplan itself — it only tries to
reconnect each location's floorplan *mapping* (`floorplan_id` +
`svg_element_id`) to a floorplan already sitting in the target database,
first by matching `floorplan_id` directly (the same-instance restore case),
then, if that id isn't present, by an exact `svg_content` match against the
floorplan data the snapshot carries (the cross-instance migration case —
upload the same floorplan SVG to the new server yourself first, then
import; the mapping finds its way back to the newly-uploaded floorplan's
id even though the id itself differs from the export, and this is counted
in `remapped_floorplan_mappings`). A mapping that matches neither way is
silently dropped (not a fatal error) and counted in
`dropped_floorplan_mappings`. Original ids are preserved on restore, so
anything depending on stable item/location ids (see "Known external
consumers" above) keeps working after a restore. `/import` is a full
replace of everything in scope — there's currently no merge/append mode
(see issue #26).

**Config**

| Method & path | Purpose |
|---|---|
| `GET /webapp-config` | `{ autoTheme, themeRecommendation, dynamicQuantityScale, qrLabelBaseUrl, detailPageSections }` — the current value of the "Automatically switch light/dark theme" plugin option, the theme it currently recommends ("light", "dark", or `null` if the option is off or neither `environment.sun` nor `environment.mode` has a recognized value yet), the current value of the "Dynamic +/- scale for touch interface" plugin option, the configured "Server URL for QR labels" (empty string if unset), and the ordered list of item detail page sections to show (`["placements","floorplan","history","properties","attachments"]` by default; see "Configuration" above). Polled by the webapp alongside its regular data refresh. (Named `/webapp-config` rather than `/config` to avoid colliding with signalk-server's own reserved `GET /plugins/{id}/config` endpoint.) |

## Known limitations / possible next steps

- No multi-user permissions; relies on Signal K's built-in security if
  enabled.
- No undo for deletions.
- SVG upload only does a superficial check (`<svg` in the text) — no
  server-side sanitizing. Fine for private, on-boat use; worth hardening
  if the server is exposed publicly.
- The markdown renderer for notes is a small hand-rolled subset (headings,
  bold/italic, inline code, links, lists) — not a full CommonMark
  implementation.
