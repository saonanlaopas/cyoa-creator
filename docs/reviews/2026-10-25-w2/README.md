# W2 — Chapters and Events: review package

Accepted starting base: `7e977089cea561bbe4e69a8ec80731414b8339b0` on `codex/w1-locations-time`; the checkout started clean. The review target is the commit containing this report. The delivery message pins its full SHA and exact-head CI run. Implementation, successful checks and a normal push do not constitute checkpoint acceptance.

## Delivered behavior

- Optional, explicitly versioned progression (chapter-led by default when newly enabled in Creator) inside the existing world definition, published native world and playthrough state. Chapter-free events work; worlds without progression and existing text games retain their prior contracts/fingerprints.
- Named chapters and milestones; player-triggered events with conjunctions of current/not-current chapter, achieved/not-achieved milestone, exact playable location and inclusive/exclusive absolute game-minute prerequisites.
- Once, cooldown, once-per-day and once-per-chapter repeat rules. Repeat timing uses event start minutes; revisiting a chapter does not reset its event history.
- Explicit chapter transitions select carried milestones and permanently expired events. Other achieved milestones expire; time/location and existing mechanics carry unless an authored destination/minute cost changes them.
- A free, state-bound confirmation preview names carried/expired milestones and known lost opportunities. Discovery persists in saves. Never-known hidden events remain hidden; repeat restrictions on chapter return are included. Preview/cancel leaves time, turns and storage unchanged.
- Contradictory prerequisites and invalid references are rejected. Bounded potential-trap diagnostics appear in review and publication, explicitly without exhaustive-proof claims.
- Structured Creator controls; shared `read_world`, `review_world`, `apply_world` operations and a read-only MCP `preview_chapter_transition`. Exact-version binding, stale review rejection, consent, retry-safe receipts and transactional rollback reuse the existing world workflow.
- Native compilation, standalone/static exports, saves, rewind/restart, full/privacy archives, historical builds, verified backup/restore and duplication retain the rules and play state. Markdown/Twee report unsupported world capabilities.

See [the author/runtime contract](../../chapters-and-events.md) and [the scoped implementation plan](../../superpowers/plans/2026-10-25-w2-chapters-events.md). No dependencies, lockfile changes or SQLite migration were required. No W3 schedules, inventory/relationship extensions, paid provider calls or subagents were used.

## Validation

Results below come from the final sequential `complete-*` validation run; earlier attempts are retained separately. Commands use Node 24.19.0, pinned pnpm 11.9.0, Playwright 1.62.0 and its matching Chromium/Headless Shell 151.0.7922.34 (revision 1234), without a system-browser override.

| Check | Result |
| --- | --- |
| `pnpm lint` | Passed |
| `pnpm typecheck` | Passed |
| `pnpm build` | Passed; existing non-fatal Vite chunk-size warning |
| `pnpm test` | Passed: 150 files / 1,391 tests |
| `pnpm test:e2e --workers=1 --trace=on` | Passed: all 46 tests, zero skipped (4.3 minutes) |
| Accepted illustrated CSS and original e2e assertion/tolerance | Byte-identical to accepted base |
| `git diff --check` | Passed |

The 43 new tests (28 runtime, 9 server, 6 web), plus the updated existing MCP discovery contract test, cover deterministic prerequisites/repeats/time boundaries, carry/expiry, discovery, stale previews, atomic rejection, chapter-free play, save integrity, checkpoint isolation, historical compilation, shared MCP/browser authoring, an installed MCP SDK client, concurrency, lost Apply response/retry, failed receipt rollback, autosave failure/retry, archives, backup/restore and duplication.

The W2 browser scenario authors through authenticated MCP and actual Creator controls, exercises concurrent/lost Apply, compiles chapter-led and chapter-free games, verifies a backup, **stops Creator**, and plays standalone `file://` HTML and a static package under a nested HTTP path. It checks both 1280×900 and 390×844 viewports, no horizontal overflow, keyboard confirmation, midnight, repeat restrictions, free preview/cancel, carry/expiry, save/reload/manual load, rewind/restart and absence of provider/API requests during offline chapter-led play. The unchanged W1 and illustrated-scenes scenarios remain in the full suite.

## Browser evidence

Representative PNGs beside this report are unedited screenshots from the final full browser run. Full-page player captures can be taller than the viewport; the filenames identify viewport width. Evidence filenames and hashes are recorded in [screenshots.json](screenshots.json). [validation.json](validation.json) records commands, results and local log hashes; [validated-source-manifest.json](validated-source-manifest.json) identifies the exact implementation/test sources; [protected-files.json](protected-files.json) records the unchanged illustrated file blobs.

- Creator controls: [desktop](w2-editor-controls-1280.png) / [mobile](w2-editor-controls-390.png).
- Standalone transition confirmation: [desktop](w2-standalone-transition-preview-1280.png) / [mobile](w2-standalone-transition-preview-390.png).
- [Static player after transition and reload: mobile](w2-static-second-chapter-390.png).
- [Chapter-free static player after save/reload: mobile](w2-static-free-390.png).

## Investigation history and preserved evidence

Earlier attempts are retained separately under `/workspace/.setup/w2-review-20261025`; they are not presented as final passes. Initial typechecking caught a callback type annotation, and one early test had an incorrect warning expectation. Review/tests also found and corrected W2 discovery sharing a previous world checkpoint, Creator preview validation rejecting editor asset URLs, and a new Playwright textarea-label locator assumption. The first focused browser run timed out in W2 and W1; W1 passed after fixing preview validation, and W2 passed after using the textbox's accessible name. One added map test initially used an invalid asset UUID; its fixture was corrected. The first full unit run had 1390 passing tests and one existing MCP discovery-count failure (43 expected tools, 44 with the new preview tool); the count was updated along with an explicit read-only annotation check. A local runner rewrite at that completion boundary prevented its usual exit-file recording; the full Vitest failure log and separate outcome record are retained. The final checks use a stable runner and separate complete-* logs. These changes did not alter the illustrated-scenes assertion or accepted CSS.

Local full traces/screenshots/logs, including failed attempts and prior task evidence, remain preserved. Ephemeral local test credentials inside traces are not published in this review package. The final delivery also identifies the independently inspectable GitHub Actions run for the exact pushed SHA.

## Limits for review

- Progression requires an enabled W1 world (one playable location suffices; maps are optional). Chapters themselves are optional.
- Prerequisites are bounded conjunctions, not a general Boolean scripting language. They gate events/transitions; existing story-choice conditions retain their current contract.
- Events are explicitly chosen by players. Automatic schedules, presence, priorities and mandatory-event conflict arbitration belong to W3.
- Milestone carry lists and permanent event expiry are explicit. Existing character mechanics carry; no new inventory/relationship behavior was added.
- Trap analysis over-approximates positive chapter/milestone reachability and does not prove all navigation, negative/time conditions, ordering or expiry interactions. Transition loss previews cover known authored effects, not every unknown future opportunity.
- Save validation checks structure/references and bounded logical history; it is not cryptographic or exhaustive replay proof. Saves remain bound to an exact immutable bundle and are not silently migrated to changed rules.
- Events/transitions enter authored passages like narrative choices; they do not infer travel routes or costs. Opening hours continue to gate W1 travel at arrival.
- A final-chapter marker prevents outgoing chapter transitions but does not itself end a story; authored passage endings retain that role.
- Vite's existing bundle-size warning remains non-fatal. Further UI composition/performance work is outside this checkpoint.

## Exact diff

From a checkout of the review commit:

```sh
git diff --binary 7e977089cea561bbe4e69a8ec80731414b8339b0 HEAD
git diff --exit-code 7e977089cea561bbe4e69a8ec80731414b8339b0 HEAD -- apps/web/src/features/player/illustrated-scene.css e2e/illustrated-scenes.spec.ts
```

The delivery message supplies a commit-pinned GitHub comparison and `.diff` URL. This directory publishes the report and representative evidence through the normal authorized Git push so reviewers do not need environment-local links.
