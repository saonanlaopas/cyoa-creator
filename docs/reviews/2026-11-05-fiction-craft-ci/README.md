# Fiction Craft CI fixture correction — independent review

Base: `0efb5d1d9ecc07c45f5d433dc27e5ad2a4b2dc89`. Branch: `checkpoint/cp1-desktop-review`. The containing commit is the correction head; post-push SHA and exact-head CI result are reported separately. The first correction changed only fixture setup; the follow-up adds one scoped source-panel grid declaration and one font regression. Approval contracts, guide content, illustrated CSS/assertion, timeouts and tolerances remain unchanged.

## Failure and demonstrated cause

[Original CI](https://github.com/saonanlaopas/cyoa-creator/actions/runs/42051159222) passed lint, typecheck, build and 1,624 unit tests, then passed 55 browser tests and failed the Quick 390px preference test. Its existing assertion could not find “1 custom instructions retained.” The [job log](original-ci-job.log) and [artifact metadata](original-ci-artifacts.json) are preserved. Downloading the failure ZIP into this Cloud environment returned HTTP 403, so the original error-context snapshot has **not** been inspected; this report does not claim to have read it.

The fixture opened `/` with empty browser storage before selecting its API-created project. Quick starts a draft-creation request on that first visit. The response stores its new project ID. If that response arrives after the test writes the fixture ID but before the next navigation, it overwrites the test selection. The browser subsequently reviews an empty draft while API assertions refer to the intended fixture.

A controlled response latch demonstrates this ordering against the unchanged application and real local HTTP routes; no provider is used:

| Measurement at 390px | Original setup, response released after selection | Corrected setup |
|---|---|---|
| Selected project | Bootstrap draft, different from fixture | Intended fixture |
| Initial browser draft-creation requests | 1 | 0 |
| Intended fixture custom instructions | 1 | 1 |
| Displayed project custom instructions | 0 | 1 |
| Review text | 0 custom instructions retained. | 1 custom instructions retained. |

See [before JSON](controlled-before.json), [after JSON](controlled-after.json), [before screenshot](controlled-before.png), [after screenshot](controlled-after.png), and both traces. This proves the fixture race and reproduces the CI assertion symptom. Without the original snapshot, that reproduction is the evidence for the diagnosis rather than a direct reading of the exact CI response.

## Fixture correction

The test now establishes its browser origin through `/api/health`, which serves JSON and does not mount Creator. It writes the intended project ID before the first application navigation. It also asserts that the selected ID matches the fixture and that no browser bootstrap draft was created. Existing keyboard, guide state, retained instruction, cancellation, Apply, save/reload, bounds and workflow assertions remain. The original assertion text and all timeouts remain unchanged.

## Follow-up: real overflow under a wider fallback font

[CI for the fixture correction](https://github.com/saonanlaopas/cyoa-creator/actions/runs/42056359243) at `f10d4d17cb41ca6c333534ca4ca511dcaf936652` passed the original retained-instruction assertion, lint/typecheck/build and all 1,624 units. It failed a later existing saved-panel bounds assertion: 55 browser passes, one failure. Its [log](first-correction-ci-job.log) and [summary](first-correction-ci-summary.json) are preserved. All 56 tests passed locally on that same test-only correction ([log](full-browser.log)).

The geometry failure is reproducible as **persistent actual overflow**, not a missing wait: with DejaVu Sans at 390px, the native file picker is intrinsically 373px wide and the source panel's implicit auto-minimum grid column expands. The nested authoring panel inherits that oversized track. Measurements remain the same before and after delayed command responses complete ([font and readiness probe](reload-geometry-probe.json)).

| Geometry, 390px / DejaVu Sans | Previous CSS | Scoped constrained source column |
|---|---:|---:|
| Document width | 430 | 390 |
| Source-panel column | 373 | 322.4375 |
| Preference-panel left | 33.78125 | 33.78125 |
| Preference-panel right | 406.78125 | 356.21875 |
| File-picker right | 406.78125 | 356.21875 |

See [isolated geometry comparison](source-grid-hypothesis.json), [before screenshot](font-overflow-before.png) and [after screenshot](font-overflow-after.png). Runner-specific font metrics explain why the default-font local suite did not expose this layout defect. The original CI artifact snapshot remains unavailable, so the exact CI font/rectangles are not asserted from an unseen artifact; the wider-font regression demonstrates the unsupported layout assumption.

The production correction is exactly one declaration in the existing preference stylesheet:

```css
.generator > .panel:has(.authoring-settings) { grid-template-columns: minmax(0, 1fr); }
```

It constrains the source panel containing the new preferences, allowing its file picker and preference view to share the available width. There is no global CSS, illustrated-scene change, overflow clipping or tolerance increase. The existing saved-panel bounds assertion is unchanged. A new 390px regression deliberately selects the wider local fallback font and verifies both panel and file-picker bounds; it captures geometry/screenshot before assertions for inspectable failures. It [fails against the previous built CSS](font-regression-before.log), with a [preserved trace](font-regression-before-trace.zip).

## Validation

| Check | Result | Evidence |
|---|---|---|
| Controlled before/after, real local browser/server | Both assertions passed: original setup selects an empty bootstrap draft; corrected setup retains the intended project with one command | [portable proof log](controlled-reproduction-portable.log), JSON, screenshots and traces above |
| Corrected preference controls | **40 passed**, 10 repetitions of four desktop/mobile variants with two workers and matching Chromium | [focused log](corrected-focused.log) |
| Lint | Passed | [lint log](lint.log) |
| Typecheck | Passed | [typecheck log](typecheck.log) |
| Full local browser suite, first correction | **56 passed**, two workers | [log](full-browser.log) |
| New-head CI | Checked after normal push; final exact SHA/run result reported separately | Do not substitute the failed base run or local focused tests for this gate |

The failed base and first-correction CI runs both passed all 1,624 unit tests. Final lint, typecheck and build passed after the single CSS declaration ([lint](final-lint.log), [typecheck](final-typecheck.log), [build](final-build.log)). **25 final focused runs passed**, including all four original workflows and the new wider-font regression, repeated five times with two workers ([log](final-focused.log), [actual rebuilt geometry](font-regression-after-geometry.json), [screenshot](font-regression-after.png), [trace](font-regression-after-trace.zip)). The full final local browser suite is running separately and its final result will accompany exact-head CI; it is not replaced by the earlier 56-test result. Fresh exact-head CI repeats lint, typecheck, build, units and browsers on the correction tree. Results after commit are reported separately, without rewriting this historical evidence.

The unchanged baseline completed 20 preference tests with two workers successfully; naturally repeated passes alone do not disprove the timing race. The controlled latch exposes it deterministically.

Native desktop MCP discovery/consent/reconnect remains a separate **pending** gate. This correction provides no desktop verification or independent acceptance claim.

## Reproduce

Use the saved environment activation, Node 24.19.0, pnpm 11.9.0, Playwright 1.62.0 and matching Chromium 151.0.7922.34, revision 1234. The application source and built outputs are the same as the original pushed implementation.

```sh
pnpm lint
pnpm typecheck
pnpm test:e2e e2e/fiction-craft.spec.ts --workers=2 --repeat-each=10 --trace=on
pnpm test:e2e --workers=2
```

To reproduce the controlled before/after ordering, start an isolated offline server on port 3103 with an in-memory database and `E2E_FAKE_MODEL_PROVIDER=1`, then, from the repository root:

```sh
mkdir -p /tmp/craft-ci-proof
PROBE_BASE_URL=http://127.0.0.1:3103 PROBE_OUTPUT_DIR=/tmp/craft-ci-proof node docs/reviews/2026-11-05-fiction-craft-ci/controlled-reproduction.mjs
```

The proof creates only neutral temporary projects, archives them afterward, and writes screenshots, traces and request-path metadata into the specified directory. No model/provider calls are needed. The before case intentionally holds a startup response until after the manual storage write; the after case prevents that request by initializing storage before mounting the app.
