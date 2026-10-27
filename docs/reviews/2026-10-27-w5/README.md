# W5 — Character and Journal: review package

Accepted W4 base: `098b4e7d269164628cbb23eb8364a0e0f7555794`, branch `codex/w1-locations-time`, initially clean and reported before editing. The user's W5 authorization supersedes older handoff acceptance notes. Review target: the commit containing this report; delivery pins its full head SHA and exact-head CI URL. W5 awaits independent review; tests and pushing do not constitute acceptance. W6 remains paused. No subagents, paid calls, merges or automatic PRs.

## Delivered behavior

- Optional explicitly versioned world/native/save journal extension. No new engine, dependency or database migration. Existing W1–W4/native text definitions, saves, player configuration and fingerprints retain their absent-extension behavior.
- Canonical stats and relationships selected by the author, with dynamic AND-list visibility. Omitted values remain hidden; old unconditional Status configuration cannot bypass W5. Exact current mechanics version binds review; historical compilation uses its original canonical labels/scales. Runtime native validation checks canonical keys/categories/bounds/initials; labels are checked by the exact compilation projection because native mechanic records do not themselves contain display labels.
- Places discovered through actual arrivals or authored reveal triggers, including containing areas. W5 map area selectors, markers, destination details and travel buttons filter undiscovered places. Direct travel to an undiscovered destination rejects; authored narrative/event/chapter arrivals can discover destinations.
- Authored journal title/text and objective reveal/completion triggers use accepted chapter/milestone/location/time/item/relationship predicates plus canonical stat ranges and completed-event count. Character visibility follows current state; entry/place discovery and objective progress are remembered on committed observations. Relevant intermediate time boundaries are observed during waits/stationary actions, and completion follows effects. Reads, menu navigation, previews, cancellation and saves do not reveal information or advance gameplay.
- Active and completed objectives, authored entries and actual completed-event records are dedicated Journal sections. Event records reuse W2 counts/last action-start time rather than creating a second ledger. Hidden titles, values, conditions, schedules, instructions and prose are omitted from the player projection; entries and records do not duplicate on repeated observations/actions. No narration is generated during play.
- One contextual player navigation layer selects Explore, Character, Journal or W4 Inventory/Shops/Gifts. Secondary views hide exploration, scene/prose/outcome and narrative choices while retaining location, clock and game controls. Native buttons support Tab, Enter and Space; selecting focuses a heading, and Back/Escape restores Explore focus. Journal cards have explicit contrasting styles isolated from Creator's global article styling.
- Structured Creator controls, human-readable review and actionable journal reference guards. Shared MCP/browser review/Apply preserves consent invalidation, version conflicts and identical-operation retries. New read-only `inspect_world_journal` validates supplied state against the fresh current world and returns only disclosed information, world version and providerCalls 0.
- Save/history cloning, current observation/reference/bounds checks, autosave/manual load, rewind/restart and deterministic replay. Full/privacy archives, verified backup/restore, duplication, historical builds and actual standalone/static offline exports retain W5 through existing aggregate paths.

See the [contract and limits](../../character-and-journal.md), [implementation plan](../../superpowers/plans/2026-10-27-w5-character-journal.md), [source hashes](source-manifest.json) and [protected accepted blobs](protected-files.json). Final results/log hashes are recorded in [validation.json](validation.json); complete final check logs are published in [validation/](validation/). Published logs normalize only surplus blank lines at EOF; metadata retains both captured and published hashes. PNGs are unedited.

## Validation

Deterministic offline fixtures only. Node 24.19.0, pinned pnpm 11.9.0, Playwright 1.62.0, matching Chromium and Headless Shell 151.0.7922.34 revision 1234. [Actual installed tooling versions](validation/tooling.log) are recorded. Heavy checks run sequentially. Final browser validation uses one worker and traces; no system-browser override.

| Check | Final result |
| --- | --- |
| `pnpm lint` | [Passed](validation/release-lint.log) |
| `pnpm typecheck` | [Passed](validation/release-typecheck.log) |
| `pnpm build` | [Passed](validation/release-build.log) |
| `pnpm test` | [**1562 passed**, 160 files, 332.70 s](validation/release-unit.log) |
| `pnpm test:e2e --workers=1 --trace=on` | [**50 passed**, 6.3m](validation/release-browser.log) |
| Illustrated CSS and original assertion/tolerance | Byte-identical to accepted W4 |
| Staged diff whitespace check | Passed |

Focused verification passed **174 runtime/UI tests**: 32 new W5 runtime cases, eight new W5 UI cases, and 134 accepted W2–W4 cases. It covers hidden values/names/prose, free inspection/cancellation, transient and midnight windows, exclusive upper boundaries, post-effect discovery, chapter expiry, explicit arrivals, prerequisites, failed actions, repeated-event/entry deduplication, objectives completed before reveal, bounds/references/current observation validation, deterministic replay, save/load/rewind/restart and absent-extension compatibility. UI tests cover structured authoring, named reference guards, lost-response retries, consent invalidation, dedicated views, free navigation while a required encounter blocks trade, keyboard entry/Escape and focus return.

**Eight new service tests** and 70 accepted W1–W4/MCP tests passed. They exercise actual authenticated installed MCP SDK transport and project guards, invalid shared/direct-persistence writes, mechanics-version staleness, exact historical labels/bounds, atomic failed Apply and identical retry, full/privacy archive restoration, duplication and verified backup/restore, with no provider calls.

The focused built-browser flow passed in **33.3 seconds** after screenshot review and the scoped contrast correction. It authors canonical foundations through existing MCP, then tests actual Creator/MCP concurrent stale Apply, local edit invalidating consent, and a successful Apply whose response is aborted before the identical UUID/payload is retried without another world version.

It compiles real standalone HTML and static ZIP, verifies a backup, then **shuts Creator down**. Four offline plays cover both surfaces at 1280×900 and 390×844, with keyboard Tab/Space/Enter/Escape and focus return. Hidden character values, remote places, objective titles and journal prose stay out of rendered views. Inspection and action cancellation leave time/autosave unchanged. A wait crosses a transient reveal window; a purchase/gift reveals canonical trust, remembers an entry and changes active/completed objectives. Manual save/reload, completed-event records, one record per event, newly known places, rewind/redo, manual load/replay, reload, restart cancellation and actual restart all verify full browser IndexedDB save states against deterministic pure-runtime expected initial/after-gift/final states. No API/provider requests occur during offline play. Screenshots are inspected for layout/readability and visible journal-card text must have at least 4.5:1 contrast.

Earlier evidence remains separate. Initial typechecks identified a mistaken assumption that native mechanic records contain labels and an overly broad validation location parameter; those were corrected to canonical label projection and a minimal reference shape. The first browser attempt stopped on an implicit textarea-label locator; its accessibility snapshot contained the correct textbox and updated value, and the unchanged assertion passed using the textbox role/name. The next functional pass produced screenshots with unreadable light text on white journal cards inherited from Creator's global article style. Screenshot review caught this; a W5-scoped background/text style and actual browser contrast guard corrected it. The subsequent focused flow passed. A complete first run then passed lint/typecheck/build, 1,561 units and 50 browser tests. Source review found that removed canonical stat/relationship definitions could leave stored visibility rules without a Creator cleanup control. An isolated failing UI probe confirmed the gap. The editor now retains a missing-binding warning and explicit removal controls, preserving the rest of the journal. The repaired final UI suite passed 29 tests, including eight new W5 cases; the complete `release-*` sequence verifies the new source snapshot. Earlier passes are superseded. No earlier failures or partial checks are counted as final passes. The existing nonfatal Vite chunk-size warning remains. Complete logs, screenshots and traces remain under `/workspace/.setup/w5-review-20261027`.

## Browser evidence

Representative **unedited final-run** PNGs are beside this report, with dimensions and SHA-256 hashes in `screenshots.json`:

- Creator canonical visibility: [desktop](w5-creator-character-1280.png), [mobile](w5-creator-character-390.png).
- Creator authored entries/triggers: [desktop](w5-creator-entries-1280.png), [mobile](w5-creator-entries-390.png).
- [Creator objective controls on mobile](w5-creator-objectives-390.png).
- Character: [desktop standalone](w5-standalone-character-1280.png), [mobile static](w5-static-character-390.png).
- [Mobile standalone active/completed objectives](w5-standalone-objectives-390.png).
- [Desktop static authored entries](w5-static-entries-1280.png).
- [Mobile static completed-event record](w5-static-events-390.png).

## Limits and compatibility

- All trigger lists are AND; empty means always. Character visibility is dynamic; remembered entries/places/objectives do not disappear when conditions lapse. An objective completes only after reveal when completion conditions are observed. Past transient completion before reveal is not reconstructed. There is no automatic objective chapter expiry, failure or cancellation state; revealed objectives stay active until completion. Entries use authored order, not a timestamped chronology.
- Authors must reveal intended travel destinations or provide authored arrivals. Static map artwork and authored prose/choice feedback are not automatically redacted. Travel observes arrival, not an unauthored route's intermediate encounters. These controls are not exhaustive exploration/solvability proof.
- Canonical stats/relationships remain the existing Mechanics state. There are no generated profiles, separate relationship scores, implicit gift preferences or new abstract-resource character panel. W4 inventory/currency views remain separate. Canonical reference edits require fresh author review.
- Save validation checks bounded valid references, current observations, values and completion membership; remembered historical flags do not prove an entire past playthrough or resist local package modification. Offline source necessarily remains inspectable. Saves bind exact bundles, with no automatic migration; old downloads require re-exporting for runtime changes.
- The 48,000-byte world and RPC/save limits still apply. Collection maxima are not a guarantee every maximum-size combination fits. Visibility hides undiscovered data in ordinary player projections; author/debug/export inspection is different from playing. This fixture verifies W5 behavior, not every possible authored world or maximum-size UI/performance case.
- No W6 demonstration, crafting, equipment, combat, remote deployment, new dependencies or database migrations are included.

## Exact diff and delivery

```sh
git diff --binary 098b4e7d269164628cbb23eb8364a0e0f7555794 HEAD
git diff --exit-code 098b4e7d269164628cbb23eb8364a0e0f7555794 HEAD -- apps/web/src/features/player/illustrated-scene.css e2e/illustrated-scenes.spec.ts
```

Delivery supplies the full base/head, immutable report/diff links and exact-head CI run URL. Report/screenshots are published through the authorized normal Git push. A clean tree, local/remote equality and successful CI verify delivery; they do not independently accept W5. Stop here for review; W6 remains paused.
