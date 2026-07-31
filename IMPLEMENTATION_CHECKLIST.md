# Implementation Checklist - Quick Reference

**Before implementing a feature, work through this in order:**

## Phase 1: Explore
- [ ] Read the relevant GitHub issue fully
- [ ] Read the relevant sections of `SPEC.md`
- [ ] Read the relevant sections of `ARCHITECTURE.md`
- [ ] Explore existing code before writing anything — this codebase
      reuses patterns heavily (e.g. `act()`-wrapped action creators,
      `registerXRoutes(router, getDb, ...)` route modules); check for an
      existing pattern before inventing a new one

## Phase 2: Plan
- [ ] Think through the approach and alternatives
- [ ] Write a short implementation plan (see `docs/plans/plan-template.md`)
      for anything bigger than a one-file fix
- [ ] Identify test scenarios up front

## Phase 3: Implement & Test
<!-- This project isn't strict-TDD (see AGENTS.md's testing note: don't
run the full suite after every small change, just keep tests updated) —
tests and implementation land together rather than tests-first. -->
- [ ] Write the code
- [ ] Add/update tests alongside it: `test/backend/` for route changes
      (real HTTP requests against the mounted plugin, via
      `test-helpers/server.js`), `test/frontend/` for pure `helpers.js`
      logic (no DOM/JSDOM)
- [ ] Run tests frequently while working, not just at the end
- [ ] If a test seems wrong, fix the test deliberately — don't loosen it
      just to get to green

## Phase 4: Verify
- [ ] Check edge cases, not just the happy path
- [ ] Confirm the change matches `SPEC.md`
- [ ] Confirm the change follows `ARCHITECTURE.md`
- [ ] Run the full suite for real (`node --test`) before considering the
      change done — per AGENTS.md, this is one of the two times it's
      required (the other being right before cutting a release)

## Phase 5: Document & Commit
- [ ] Update `SPEC.md`/`ARCHITECTURE.md` if this change altered what they
      describe
- [ ] Update `CHANGELOG.md`'s `[Unreleased]` section (or add one) if this
      is user-visible
- [ ] Remove any temporal language from comments ("new", "recently
      added") — comments should read correctly a year from now
- [ ] All tests pass
- [ ] Commit with a message that explains *why*, referencing the issue

---

## Common Mistakes to Avoid

**Don't:**
- Jump straight to coding before reading SPEC/ARCHITECTURE
- Loosen a test to make it pass instead of fixing the real issue
- Leave SPEC.md/ARCHITECTURE.md stale after a change that contradicts them
- Add a runtime dependency (npm package, CDN script) when vendoring a
  single file would do — this project deliberately stays buildless and
  works offline

**Do:**
- Explore before planning, plan before coding
- Write down the plan somewhere reviewable, even briefly, for anything
  non-trivial
- Verify against the docs, not just against your own memory of the task
