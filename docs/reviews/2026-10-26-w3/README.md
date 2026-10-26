# W3 — People and Schedules: review package

Accepted base: `5258223a156cb01a92a56fc02e96518f0e7e6a41` on `codex/w1-locations-time`; the checkout started clean. The user's W3 instruction supersedes older saved acceptance notes. Review target: the commit containing this report. The delivery message pins its full head SHA and exact-head CI run. W3 is delivered for independent review; passing checks and pushing are not acceptance. W4/inventory/shop work is excluded.

## Delivered behavior

- Optional versioned people definitions in the existing world aggregate/native world and discovered-character save extension. Absence preserves accepted text/W1/W2 shapes and fingerprints.
- World cast names, weekly/daily recurring slots with inclusive/exclusive integer-time windows, overnight and week wrap, and prioritized chapter/milestone/player-location/time story overrides, including explicit absence.
- Explicit priorities, required flags and all-selected-people-present requirements for every existing W2 event in a W3 world. Hidden encounters are discovered at actual observations; the player sees current people and known encounters without future schedules or off-site placements.
- Deterministic highest-priority required encounters block other confirmed actions, including story choices. Unresolved mandatory/override ties and overlapping character schedules are rejected; runtime checks also reject conflicts without storage-order selection. Optional ties use code-unit ID ordering for display.
- Waiting stops at the first newly required encounter, consuming actual elapsed minutes. Presence/discovery is evaluated at relevant schedule, midnight, condition and cooldown boundaries. Travel/narrative journeys observe arrival only. Stationary authored costs that would skip a newly required boundary reject atomically, with no partial effects; exact-completion effects precede final arbitration.
- Creator controls and exact review summaries; deletion/reference guards; shared MCP/browser read/review/apply and read-only `inspect_world_presence`. Existing version-specific consent, concurrency checks, retry receipts and transaction rollback remain in use.
- Native compilation/player, save/resume, trace discovery deltas, deterministic replay, autosave recovery, rewind/restart, full/privacy project history, verified backup/restore, duplication and offline standalone/static exports. No new SQLite migration or dependency.

See [the contract and limits](../../people-and-schedules.md) and [the implementation plan](../../superpowers/plans/2026-10-26-w3-people-schedules.md).

## Verification

Offline fixtures only; no paid provider calls or subagents. Environment: Node 24.19.0, pinned pnpm 11.9.0, Playwright 1.62.0, matching Chromium/Headless Shell 151.0.7922.34 revision 1234. Heavy checks run sequentially.

| Check | Result |
| --- | --- |
| `pnpm lint` | Passed |
| `pnpm typecheck` | Passed |
| `pnpm build` | Passed |
| `pnpm test` | 153 files / 1,443 tests passed |
| `pnpm test:e2e --workers=1 --trace=on` | 47 passed, no failures or skips (5.1 minutes) |
| Accepted illustrated CSS and original assertion/tolerance | Unchanged |
| `git diff --check` | Passed |

[Validation metadata](validation.json) records command exits, environment and evidence-log hashes; [the source manifest](source-manifest.json) pins the verified source/test snapshot.

The added runtime tests cover slot boundaries, midnight/week wrap, transient discovery, travel and narrative arrival, choice-trace deltas, legacy known-choice lookup compatibility, override precedence/absence, priority reordering and conflicts, cooldown boundaries, atomic stationary rejection, deterministic replay, save validation, absence compatibility and bounded time ranges. Server tests exercise direct persistence, actual installed MCP SDK transport/authorization, concurrency/retry/rollback, historical builds, full/privacy archives, verified backups, duplication and publication warnings. UI tests cover structured authoring, owned event-rule synchronization, dependency deletion guards, exact-review invalidation, player-safe presence, required-action blocking and autosave recovery.

The browser scenario authors through authenticated MCP and actual Creator controls, rejects an authored mandatory tie, exercises stale browser/MCP review and a lost Apply response, compiles chapter-led and chapter-free packages and verifies a backup. It then **stops Creator** and plays real `file://` standalone and nested-HTTP static packages at 1280×900 and 390×844. It checks free inspection/cancel, midnight wait interruption, required-event order, hidden/transient discovery, milestone-driven movement, chapter carry/expiry, override presence after base hours, timed absence/restoration, save/reload/manual load, rewind/restart, keyboard confirmation and no API/provider requests from offline players.

Full logs/traces and early attempts are retained under `/workspace/.setup/w3-review-20261026`. The first new runtime fixture retained an expiry reference to a replaced event and was corrected; a first UI test used the wrong fixture choice label (`Continue` versus `Continue 1`) and was corrected. Subsequent focused runtime/server/UI tests and the actual offline browser scenario passed. A first full verification run was interrupted after a final choice-lookup compatibility correction so its previously built assets would not be used as final evidence. The rebuilt full run then found one incorrect new test expectation: accepted known-choice lookup evaluates conditions even outside the current passage, so its availability is enabled in this fixture. Only that expectation changed; production sources and built outputs were unchanged. The complete unit suite was rerun, followed by the complete browser suite. These earlier attempts are retained separately and are not represented as final passes. Vite's existing nonfatal chunk-size warning remains.

## Representative browser evidence

Unedited screenshots from the final full browser run are beside this report; hashes and dimensions are recorded in `screenshots.json`.

- Creator people controls: [desktop](w3-creator-people-1280.png) / [mobile](w3-creator-people-390.png).
- [Creator encounter priorities](w3-creator-priorities-1280.png) and [rejected competing priorities](w3-creator-priority-conflict-390.png).
- Required encounter at midnight: [desktop standalone](w3-standalone-midnight-1280.png) / [mobile standalone](w3-standalone-midnight-390.png).
- [Timed story absence in static player](w3-static-override-absence-390.png).
- [Chapter-free static player at the required boundary](w3-static-free-midnight-390.png).

## Limits and review boundaries

- Recurrence is a seven-day integer-game-time cycle, not a real calendar. Character placement changes are authored, not pathfinding or simulated NPC travel. Overrides and encounter gates use bounded W2 conjunctions; inventory/relationships are not extended.
- Static tie rejection conservatively checks chapter/milestone/location/time exclusivity, not every schedule/history/presence combination or the masking effect of a higher override. Assign distinct priorities where those checks cannot prove exclusivity. Actual runtime conflicts reject atomically. Potential self-repeat warnings are not exhaustive progression proofs.
- Required events remain player-confirmed. A high-priority action may defer already eligible lower priorities; their windows can expire. Authored journeys observe destination arrival, not origin-side encounters during transit. Stationary authored costs are not partially executed; use waiting to reach a required boundary.
- Player presentation hides future whereabouts; the offline bundle necessarily contains rules for local execution and is inspectable as source. Project archives retain authoring/build history; player saves are separate, exact-bundle-bound records. Discovery-state validation is structural/logical, not cryptographic or exhaustive replay proof.
- Existing text-only simulation does not search all world journeys or prove schedule solvability. The actual native-player/offline-browser verification covers delivered world behavior. Further UI composition/performance work and W4 mechanics are outside scope.

## Exact diff

```sh
git diff --binary 5258223a156cb01a92a56fc02e96518f0e7e6a41 HEAD
git diff --exit-code 5258223a156cb01a92a56fc02e96518f0e7e6a41 HEAD -- apps/web/src/features/player/illustrated-scene.css e2e/illustrated-scenes.spec.ts
```

The delivery message supplies commit-pinned diff/report/CI links. The report/screenshots are published through the authorized normal Git push for reviewer access without environment-local links.
