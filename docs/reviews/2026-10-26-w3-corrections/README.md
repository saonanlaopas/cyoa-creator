# W3 independent review corrections

Reviewed starting head: `ca6f4c94fb1ddbcc558dea48818b6e58866b3e9d` on `codex/w1-locations-time`; checkout started clean. Accepted W2 base remains `5258223a156cb01a92a56fc02e96518f0e7e6a41`. W3 is unaccepted, W4 paused. Review target is the commit containing this report; the delivery message pins its full SHA and exact-head CI run. Earlier [W3 delivery evidence](../2026-10-26-w3/README.md) is preserved unchanged.

## Findings and scoped corrections

1. **Required encounter deadlock.** The boundary helper treated a newly eligible mandatory event as an instruction to stop a confirmed required event, while the latter blocked waiting. The caller now identifies the executing event. Only when it is the currently selected required event does the helper defer arbitration until completion. It still records real intermediate observations and applies the complete cost/effects atomically. Priorities choose the next action after completion; they do not interrupt an already confirmed event. Tests cover newly available lower and higher priorities so the same deadlock cannot persist with reversed priorities. Optional events, local actions and chapter transitions still reject skipped mandatory boundaries; waiting still stops at the first required boundary.
2. **Discovery before completion effects.** The helper revealed people/hidden encounters at the endpoint before milestone/chapter effects, then kept those discoveries forever. Non-wait endpoint observation now belongs to the existing post-effect completion path. Earlier intermediate observations remain remembered; actual people at completion are still discovered. Parameterized regressions cover milestone-driven and chapter-driven absence, positive event/chapter/local-action completion, source-state immutability, replay and save/resume.
3. **Priority blocking called a repeat-rule loss.** Transition previews used player action availability, which includes temporary mandatory-event blocking. They now compare each event's intrinsic availability. Authored expiry, prerequisite/presence changes and real repeat restrictions remain loss candidates. A regression verifies a known event is omitted from the loss list, temporarily blocked in the destination, and enabled after its required encounter completes. Existing W2 tests retain actual repeat-loss coverage.

Only production file changed: `packages/runtime/src/progression.ts` (+7/-5 lines). No authoring/schema/definition/save migration, dependency or W4 changes. [The contract](../../people-and-schedules.md) documents the corrected completion and preview semantics. [Source hashes](source-manifest.json) pin the validated source/test/docs snapshot. Accepted illustrated CSS and original assertion/tolerance are [byte-identical](protected-files.json).

## Reproduction and verification

The eight new runtime cases ran **before** production edits: [five failed, reproducing all three findings; three positive controls passed](regressions-before.log). After correction, all [102 focused W1/W2/W3 runtime tests passed](focused-runtime.log). The new browser scenario also passed against built production exports before full validation. Earlier logs are retained separately and are not reported as final passes. Published log copies omit trailing blank lines only; original complete logs are preserved in the evidence directory.

| Check | Result |
| --- | --- |
| `pnpm lint` | Passed |
| `pnpm typecheck` | Passed |
| `pnpm build` | Passed |
| `pnpm test` | 154 files / 1,451 tests passed |
| `pnpm test:e2e --workers=1 --trace=on` | 48 passed, no failures/skips (6.0 minutes) |
| Protected illustrated CSS and test | Unchanged |
| `git diff --check` | Passed |

[Validation metadata](validation.json) records command exits, counts and complete evidence-log hashes.

Environment: Node 24.19.0, pinned pnpm 11.9.0, Playwright 1.62.0, matching Chromium/Headless Shell 151.0.7922.34 revision 1234. Deterministic offline fixtures, one browser worker; no paid calls or subagents. Full evidence and earlier attempts are preserved in `/workspace/.setup/w3-corrections-20261026`. The existing nonfatal Vite size warning remains.

The new browser test authors through authenticated MCP, reviews/applies/compiles the world, verifies the shared MCP preview and presence inspection, exports standalone HTML/static ZIP, and then shuts Creator down. Both real exports are played at 1280×900 and 390×844. It confirms cancel is free; a required five-minute event crosses a newly mandatory boundary and completes; its completion-time absence prevents phantom discovery; autosave reload preserves the result; the chapter preview lists a real prerequisite loss but omits priority blocking; and the supposedly lost optional event becomes playable after the destination's required event. Manual load/replay and no API/provider requests are also verified.

Representative unedited screenshots from the final browser run are beside this report, with hashes/dimensions in `screenshots.json`:

- [Standalone completion at mobile width](w3-review-standalone-completion-390.png).
- [Static completion at desktop width](w3-review-static-completion-1280.png).
- [Standalone transition preview at desktop width](w3-review-standalone-preview-1280.png).
- [Static transition preview at mobile width](w3-review-static-preview-390.png).

## Limits and review boundary

A confirmed required event is atomic. Newly eligible events, including higher priorities, arbitrate after it finishes; windows can expire during that cost. This fixes the blocked-wait deadlock without promising every authored encounter can be played. Existing conservative tie validation, runtime conflict checks and nonexhaustive progression diagnostics remain.

No save migration erases previously remembered discoveries; clean-session/replay tests establish the corrected behavior. Previously downloaded standalone/static files contain their prior runtime and must be re-exported to receive corrections. Existing W3 definition/save formats and absent-extension compatibility remain. Runtime/editor behavior uses the corrected shared engine; the original full W3 browser scenario remains in the suite.

## Exact diff and delivery

```sh
git diff --binary ca6f4c94fb1ddbcc558dea48818b6e58866b3e9d HEAD
git diff --exit-code 5258223a156cb01a92a56fc02e96518f0e7e6a41 HEAD -- apps/web/src/features/player/illustrated-scene.css e2e/illustrated-scenes.spec.ts
```

The delivery message supplies commit-pinned diff/report and exact-head CI links. Normal commit/push and passing tests do not constitute independent W3 acceptance. Stop here; no W4 work.
