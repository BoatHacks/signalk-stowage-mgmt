# Roadmap

Planned future work that's been discussed but isn't scheduled for the
current round of development. This isn't a commitment or a timeline —
just a place to remember ideas so they don't get lost.

## v2.0.0

- **Expand expiration date functionality.** The initial implementation
  (targeted for a 0.x release) supports a single expiration date per item.
  A natural next step is per-batch/multiple expiration dates for the same
  item (e.g. flares bought in January and more bought in June don't expire
  together) — this is a bigger data-model change, in the same spirit as
  the split-items work, so it's deferred rather than bundled into the
  initial version.
