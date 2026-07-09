# SignalK Stowage Management

> ⚠️ **Warning:** this is 100% vibecoded AI slop, install and use at your own risk, and always remember: only you can prevent grey goo! never release nanobot assemblers without replication limiting code.

> 🧪 **Frontend architecture:** the frontend is a buildless Preact +
> [htm](https://github.com/developit/htm) SPA — no bundler, no transpile
> step, targeting old embedded browsers (tested against Chromium 69, as
> found on some Navico/B&G MFD displays). Preact/htm are vendored locally
> (`public/vendor/preact-htm-standalone.js`, a single self-contained ES
> module) so the app works fully offline with no CDN dependency. Includes a
> light/dark theme toggle and live polling (the UI refreshes from the
> server every 5s, so multiple simultaneous viewers stay in sync). The
> backend (`plugin/`) is a standard Signal K plugin — same REST API, same
> SQLite schema, unaffected by the frontend's architecture.

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

## Usage

**Inventory (tab):**
- "+ Storage Space" creates a new top-level storage space (e.g. "Lazarette").
- Per node: "+ Container" (nestable to any depth), "+ Item", plus icon
  buttons on each item: edit (properties), photo, move, delete.
- Containers can be dragged directly onto another container or storage
  space to move them (or dragged onto the floating "Not Stored" panel to
  detach them to the top level). Items can likewise be dragged onto any
  storage space/container, or dragged straight onto an assigned floorplan
  area to stow them there.
- Items show actual quantity (click to edit inline, with +/- steppers) and
  target quantity, if set, as "×3 / 6".
- "Export as Markdown" renders the whole inventory tree (storage spaces,
  nested containers, items with quantities/targets/categories, plus a "Not
  Stored" section for orphans) into a copyable markdown document.
- The floating "Not Stored" panel (bottom/top-right of the screen,
  depending on context) lists any containers with no parent and any items
  with no location — normally hidden, it appears automatically whenever
  something is orphaned or while a drag is in progress, and doubles as a
  drop target to detach things.

**Item properties (edit icon on any item):**
- Name, actual quantity, target quantity (leave blank for "no target").
- Notes: a small dependency-free markdown editor with **Show** (rendered
  preview, default) and **Edit** (raw markdown) tabs. Supports headings,
  **bold**, _italic_, `code`, links, and lists.
- Photo (separate camera icon): upload an image, drag to pan and use the
  slider to zoom, then save a square-cropped thumbnail. Shown on the item
  row, the Overview table, and the Understocked page.

**Floorplan (tab):**
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
  can type your own.

**Categories (tab):**
- "+ Category" creates a new category. Four defaults are seeded on first
  start: "food", "spare part", "equipment", "tools".
- Each category is a collapsible fold-down; click its header to expand and
  see every item that carries it (with location and the full item row,
  fully interactive). Rename or delete from the header; the count shown is
  how many items currently carry that category.
- Deleting a category removes it from every item that had it — the items
  themselves are untouched.

**On each item:**
- Category badges are shown under the item; click the "×" on a badge to
  remove that category, or use the category dialog to toggle several at
  once by clicking chips (green = assigned).
- An item can carry any number of categories at once.

**Overview (tab):**
- Table of all items with thumbnail, actual quantity, direct location,
  full path (e.g. "Lazarette → Tool box"), categories, and whether the
  location is mapped on the floorplan.
- Click column headers to sort, use the text field to filter by item name,
  direct location, and path.
- Clicking a row jumps to the Floorplan tab and makes the area blink, same
  as search (if it's mapped).

**Understocked (tab):**
- Lists every item whose target quantity is set and whose actual quantity
  is below it. Each shown as a large-thumbnail chip with name, editable
  actual quantity, target quantity, and an edit button — nothing else, to
  keep restocking runs focused.

**Search:**
- Type an item name into the search box at the top, click a result.
- The app automatically switches to the Floorplan tab, loads the matching
  plan, and makes the corresponding area blink for 6 seconds — even if the
  item is nested several containers deep (the app walks up the parent
  chain until it finds a mapped storage space).

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
| `parent_id` | TEXT, FK → `locations.id` | `ON DELETE SET NULL`. Nesting: containers can nest inside containers or storage spaces to any depth; storage spaces may also have `parent_id = NULL` (top-level) — a non-null `parent_id` on a `storage_space` row is possible via the API but the UI always creates them at the top level |
| `floorplan_id` | TEXT, FK → `floorplans.id` | `ON DELETE SET NULL`. Only meaningful on `storage_space` rows |
| `svg_element_id` | TEXT | The `id` attribute of the matched SVG shape. Only meaningful on `storage_space` rows |

**`items`**

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT, PK | |
| `name` | TEXT | |
| `actual_quantity` | INTEGER, default 1 | How many you actually have |
| `target_quantity` | INTEGER, nullable | Desired stock level; `NULL` means "no target set" and excludes the item from the Understocked page regardless of `actual_quantity` |
| `notes` | TEXT, nullable | Free-text, rendered as markdown in the UI. (Earlier versions had a separate `description` column; it was merged into `notes` and dropped.) |
| `location_id` | TEXT, FK → `locations.id` | `ON DELETE SET NULL`. `NULL` means "not stored anywhere" |
| `thumbnail` | TEXT, nullable | Square-cropped photo as a `data:` URI (JPEG), or `NULL` |

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

Indexes exist on `locations.parent_id`, `locations.floorplan_id`,
`items.location_id`, and `item_categories.category_id`.

## API (under `/plugins/signalk-stowage-mgmt`)

Also published as an OpenAPI 3.0 spec (`openApi.json`), which renders in
the Signal K Admin UI under **Documentation → OpenAPI** once the plugin is
enabled.

All request/response bodies are JSON. Errors are `{ "error": "..." }` with
an appropriate HTTP status code.

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
| `GET /items` | List all items, each with a `categories` array (`[{ id, name }]`) |
| `POST /items` | Create. Body: `{ name, actual_quantity?, target_quantity?, notes?, location_id?, category_ids? }` |
| `PATCH /items/:id` | Partial update. Body: any of `{ name, actual_quantity, target_quantity, notes }`. `target_quantity`/`notes` support explicit `null` to clear them (distinct from omitting the key, which leaves them unchanged) |
| `PATCH /items/:id/thumbnail` | Set/clear the photo. Body: `{ thumbnail }` — a `data:` URI string, or `null`/omitted to remove it |
| `PATCH /items/:id/move` | Move to a different location. Body: `{ location_id }` (omit/null to unassign) |
| `POST /items/:id/categories` | Add a category. Body: `{ category_id }` |
| `DELETE /items/:id/categories/:categoryId` | Remove a category |
| `DELETE /items/:id` | Delete the item |
| `GET /items/:id/locate` | Walks the parent chain upward until it finds a mapped storage space; returns `{ item_id, path, floorplan_id, svg_element_id, storage_space }`, or 404 with the (unmapped) `path` if none is found |

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
