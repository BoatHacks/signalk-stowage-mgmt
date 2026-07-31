# Implementation Plan: Issue #14 — QR labels for storage spaces/containers

## Overview

Let a crew member print a QR-coded label for any storage space or
container (single label, or a batch "Print Labels" page), so scanning it
on the physical locker jumps straight to that location in the app.

## Relevant SPEC/ARCHITECTURE Sections

- SPEC.md §5.1 (deep-link contract), §6.1 (UI), §9.2 (MVP scope), §11
  (design decisions — SVG output, error-correction level `H`, "always
  Inventory tab," Plugin Config field with auto-fill).
- ARCHITECTURE.md §2.3 (component sketch), §4 (tech stack —
  `qrcode-generator`), §6 (security — deep link is read-only, no new auth
  surface), §7 (file structure — `public/vendor/qrcode-generator.mjs`).

## Approach

Entirely client-side; no new backend endpoints or schema changes (see
SPEC §11 for why). Three pieces:

1. Vendor `qrcode-generator`'s `dist/qrcode.mjs` (npm `qrcode-generator@2.0.4`,
   MIT, zero deps) as `public/vendor/qrcode-generator.mjs`, matching the
   existing `preact-htm-standalone.js` vendoring pattern.
2. A new frontend module building label markup: `qrcode(0, 'H')` →
   `addData(deepLink)` → `make()` → `createSvgTag({cellSize, margin,
   scalable: true})`, then composite the app-icon overlay (centered
   `<image>`/`<use>` inside the returned SVG string) and the
   name/breadcrumb text alongside it.
3. A "Print Labels" page (multi-select locations + print grid) and a
   single-label action on each location's actions menu, both building on
   the same label-rendering module. Printing uses `window.print()` +
   print-specific CSS, no generated PDF.

Plus: a new "Server URL for QR labels" Plugin Config field (schema entry
in `plugin/index.js`, surfaced through `/webapp-config` the same way
`autoTheme`/`dynamicQuantityScale` already are), and a deep-link handler
on initial page load (`?location=<id>` → expand that node in the
Inventory tab).

## Test Strategy

- **Backend**: a `test/backend/config.test.js` addition (or new test)
  covering the new config field showing up in `GET /webapp-config`.
- **Frontend (`test/frontend/helpers.test.mjs`)**: any new pure helper
  (e.g. building the deep-link URL from a location id + configured base
  URL, or parsing the `location` query param) — no DOM needed for these.
- **Manual, in-browser** (per this project's testing conventions — no
  JSDOM, no Preact-render test harness exists yet): generate a label,
  scan it with a phone, confirm it opens the deep link and expands the
  right node; print-preview the batch page; confirm the logo overlay
  doesn't break scannability at a couple of physical print sizes.

## Implementation Steps

- [ ] Vendor `qrcode-generator`'s `dist/qrcode.mjs` under
      `public/vendor/qrcode-generator.mjs`
- [ ] Add the "Server URL for QR labels" field to `plugin.schema` in
      `plugin/index.js`; surface it via `plugin/routes/config.js`'s
      `/webapp-config` response
- [ ] Build the label-rendering module (QR SVG + logo overlay + name/path
      text)
- [ ] Add the single-label action to each location's actions menu
- [ ] Build the batch "Print Labels" page (multi-select + print grid +
      print CSS)
- [ ] Add the `?location=<id>` deep-link handler on initial load →
      expand that node in the Inventory tab
- [ ] Add/update tests (see Test Strategy)
- [ ] Manual scan/print verification
- [ ] Update README.md's Usage section and endpoint/config tables;
      update CHANGELOG.md

## Files to Create/Modify

- `public/vendor/qrcode-generator.mjs` (new)
- `public/js/app-labels.js` or similar (new — label rendering + Print
  Labels page; exact name/placement TBD when starting)
- `plugin/index.js` (schema addition)
- `plugin/routes/config.js` (`/webapp-config` response)
- `public/js/app.js` (initial-load deep-link handling)
- Wherever each location's actions menu is rendered (`app-nodes.js`) —
  add the single-label action
- `test/backend/config.test.js`, `test/frontend/helpers.test.mjs`
- `README.md`, `CHANGELOG.md`
