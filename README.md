# SignalK Stowage Management

Inventory manager for Signal K Server. Organize items into containers and
storage spaces (nested to any depth), upload an SVG floorplan of your boat,
map areas on the floorplan to storage spaces, and make the matching area
blink when you search for an item.

## Installation

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
   ("Inventory manager").
5. The webapp is then available at:
   `http://{skserver}:3000/signalk-stowage-mgmt/`
   (also linked from the Webapps list in the Admin UI).

## Usage

**Inventory (tab):**
- "+ Storage space" creates a new top-level storage space (e.g. "Lazarette").
- Per node: "+ Container" (can be nested), "+ Item", "Move", "Delete".
- Containers can be moved into other containers or into storage spaces;
  storage spaces themselves always stay at the top level.

**Floorplan (tab):**
- Upload an SVG file (`example-floorplan.svg` is included as a test file).
- **Important:** only SVG elements (`path`, `polygon`, `rect`, `circle`,
  `ellipse`) that already have an `id` attribute in the SVG source can be
  clicked and assigned. Add IDs e.g. in Inkscape's "Object Properties"
  panel, or edit the SVG source directly.
- Click an area → pick a storage space from the list → the mapping is
  saved.

**Categories (tab):**
- "+ Category" creates a new category. Four defaults are seeded on first
  start: "food", "spare part", "equipment", "tools".
- Rename or delete any category from this tab; the item count shown is how
  many items currently carry that category.
- Deleting a category removes it from every item that had it — the items
  themselves are untouched.

**On each item (Inventory tab):**
- Category badges are shown under the item; click the "×" on a badge to
  remove that category from the item.
- "+ Category" next to the badges adds one of the existing categories to
  the item. An item can carry any number of categories at once.
- When creating a new item you can optionally assign one or more
  categories right away.

**Overview (tab):**
- Table of all items with quantity, direct location, full path (e.g.
  "Lazarette → Tool box") and whether the location is mapped on the
  floorplan.
- Click column headers to sort, use the text field to filter by item name,
  direct location, and path.
- Clicking a row jumps to the Floorplan tab and makes the area blink, same
  as search (if it's mapped).

**Search:**
- Type an item name into the search box at the top, click a result.
- The app automatically switches to the Floorplan tab, loads the matching
  plan, and makes the corresponding area blink for 6 seconds — even if the
  item is nested several containers deep (the app walks up the parent
  chain until it finds a mapped storage space).

## Data model

SQLite database stored under the Signal K data directory (`inventory.db`):

- `locations` — storage spaces and containers in a single table
  (`type`, `parent_id` for arbitrary nesting, `floorplan_id` +
  `svg_element_id` set only on storage spaces).
- `items` — `location_id` points to a container or storage space.
- `categories` — user-defined tags like "food" or "tools".
- `item_categories` — many-to-many join table between items and
  categories (an item can have any number of categories).
- `floorplans` — uploaded SVG files stored as raw text.

## API (under `/plugins/signalk-stowage-mgmt`)

| Method & path | Purpose |
|---|---|
| `GET/POST /locations` | Read/create storage spaces & containers |
| `PATCH /locations/:id/move` | Re-parent (new `parent_id`) |
| `PATCH /locations/:id/svg-mapping` | Assign a floorplan area |
| `DELETE /locations/:id` | Delete (only if empty) |
| `GET/POST /items` | Read/create items (each includes a `categories` array; `POST` accepts an optional `category_ids` array) |
| `PATCH /items/:id/move` | Move an item |
| `POST /items/:id/categories` | Add a category to an item (`{ category_id }`) |
| `DELETE /items/:id/categories/:categoryId` | Remove a category from an item |
| `GET /items/:id/locate` | Walks the parent chain, returns `floorplan_id` + `svg_element_id` to blink |
| `GET/POST /categories` | Read/create categories |
| `PATCH /categories/:id` | Rename a category |
| `DELETE /categories/:id` | Delete a category (also removes it from any items) |
| `GET/POST /floorplans` | Read/upload floorplans |

## Known limitations / possible next steps

- Assigning SVG areas currently uses `prompt()` dialogs instead of a
  dedicated UI overlay — functional, but could be improved.
- No multi-user permissions; relies on Signal K's built-in security if
  enabled.
- No undo for deletions.
- SVG upload only does a superficial check (`<svg` in the text) — no
  server-side sanitizing. Fine for private, on-boat use; worth hardening
  if the server is exposed publicly.

