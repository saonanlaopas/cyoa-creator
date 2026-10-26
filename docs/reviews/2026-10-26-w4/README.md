# W4 — Inventory and Shops: review package

Accepted W3 starting base: `6dfe8957626dcdc3c093e86cf7eca1d69e772507`, branch `codex/w1-locations-time`, initially clean and reported before editing. The user's W4 instruction supersedes older handoff paused/unaccepted notes. Review target: the commit containing this report; delivery pins its full head SHA and exact-head CI URL. W4 is delivered for independent review, not accepted by passing tests or pushing. No W5/W6, crafting, equipment, combat, subagents or paid calls.

## Delivered behavior

- Optional versioned `WorldDefinition.economy`, native economy and player save extension. Existing aggregate/history/compiler/player/export paths are extended; no new engine, dependency or SQLite migration. Absence preserves accepted W1–W3/text bundle/save shapes and fingerprints.
- Counted items and capacities, one integer currency and balance limit, finite shop stock/pack quantities/prices, daily and overnight shop hours, ancestor-location hours, and authored minute costs. Purchases check the whole interval, including exclusive closing and completion, rather than endpoints alone.
- Authored item gifts to currently present W3 people, consumable use and explicit once/day/chapter/cooldown repeat rules. Presence and prerequisites hold throughout the action; there is no future schedule disclosure. Optional W2 event costs/effects permit item/currency rewards and canonical relationship/milestone consequences.
- Owned-state transactions require up-front funds/items before rewards and validate all currency/item/relationship bounds. Failure leaves money, items, stock receipts, relationships, milestones, discoveries, time, visits and saves unchanged. Accepted W3 required-event completion, boundary rejection/waiting, post-effect discovery and intrinsic transition-loss semantics remain.
- Item quantity and canonical relationship range predicates in shared world conditions; contradictory intersections and invalid references are rejected. Relationship changes use existing canonical Mechanics state, not separate scores. Native limits/initials must match the exact published mechanics; old builds use their historical mechanics, not today's bounds.
- Structured Creator item/currency/shop/offer/gift/use/event-transaction controls, readable exact summaries and dependency cleanup guards. Player Inventory, Shops and Gifts views open one at a time, with free navigation/cancellation and explicit visible costs/effects. W5 character/journal presentation is deferred.
- Shared MCP/browser world review/Apply, mechanics-version binding for W4 review, stale-write rejection, transaction rollback and identical-UUID recovery. Read-only `inspect_world_economy` validates a supplied state against the fresh current world and returns held items, balance, local stock and applicable trade availability without executing gameplay.
- Exact integer currency/item balance reconstruction from initial values, receipts and W2 event counts; receipt bounds/timing/visited chapters, canonical relationship bounds and world state checks. Autosave, manual save/load, rewind/restart and deterministic replay preserve quantities and receipts. Existing project history, full/privacy archives, verified backup/restore, duplication and offline packages retain definitions.

See [the W4 contract and relationship semantics](../../inventory-and-shops.md) and [implementation/verification plan](../../superpowers/plans/2026-10-26-w4-inventory-shops.md).

## Verification

Deterministic offline fixtures only. Environment: Node 24.19.0, repository-pinned pnpm 11.9.0, Playwright 1.62.0, matching Chromium/Headless Shell 151.0.7922.34 revision 1234. Heavy checks run sequentially; browser checks use one worker with traces.

| Check | Result |
| --- | --- |
| `pnpm lint` | Passed |
| `pnpm typecheck` | Passed |
| `pnpm build` | Passed |
| `pnpm test` | **1,514 passed**, 157 files, 392.55 s |
| `pnpm test:e2e --workers=1 --trace=on` | **49 passed**, 6.4 min |
| Accepted illustrated CSS and unchanged layout assertion/tolerance | Byte-identical |
| `git diff --check` | Passed |

Final-source results and log hashes are recorded in [validation.json](validation.json), with [source hashes](source-manifest.json) and [protected accepted blobs](protected-files.json).

The focused runtime run passed **150 tests**, including **48 new W4 cases** and 102 accepted W1–W3 cases. The new tests cover funds/stock, capacity, multi-item bundles, shop/ancestor hours, overnight/full-day closure and exclusive closing, repeated gifts/use and repeat policies, recipient intermediate absence, atomic failures, unpayable versus funded required encounters, canonical narrative-choice interoperation, predicate contradictions, economic milestone producers, inherited-name receipts, no-chapter/no-people worlds, deterministic replay, save/resume/rewind/restart and resealed-invalid save rejection.

Eight new server tests pass, including actual installed MCP SDK transport, unauthorized-project rejection, direct persistence invalid-reference checks, exact canonical version review, old-build preservation, transaction rollback/lost-response retry, full/privacy archive import, duplication and verified backup/restore. Sixty-two accepted W1–W3/MCP service tests also passed. Seven new UI tests plus 17 accepted UI tests passed; they exercise structured controls, dependency cleanup/disable guards, review invalidation, identical retries, free navigation/cancellation, actual gameplay and failed-autosave retry without double charging.

The focused built-browser scenario passed in **42.0 seconds**. It authors a canonical relationship through the real MCP foundation workflow, then authors/reviews/applies W4 world content while inspecting Creator. It rejects a concurrent stale browser Apply, invalidates consent on a local edit, and replays a successful Apply whose response was lost using the identical UUID/payload without creating another world version.

It compiles actual standalone HTML/static ZIP and verifies a project backup, then **shuts Creator down**. Four offline playthroughs (both surfaces at 1280×900 and 390×844) exercise closed/open shops, free inspection/cancel, three purchases crossing midnight, exhausted stock, insufficient funds, gift daily repetition, consumable cooldown/use, item/relationship-gated event costs/rewards, exclusive closing during a purchase, next-day gift reuse, autosave reload, manual save/load and replay. Actual browser IndexedDB native-save states are compared in full with deterministic pure-runtime expected states after trade and after replay; no API/provider requests are allowed. Desktop/mobile screenshots are inspected for readable controls and horizontal fit.

## Browser evidence

Representative unedited PNGs from the final full browser run are beside this report, with hashes/dimensions in `screenshots.json`:

- Creator item quantities: [desktop](w4-creator-quantities-1280.png) / [mobile](w4-creator-quantities-390.png).
- Creator shop controls: [desktop](w4-creator-shop-1280.png) / [mobile](w4-creator-shop-390.png).
- Finite stock/funds in offline players: [desktop standalone](w4-standalone-stock-1280.png) / [mobile static](w4-static-stock-390.png).
- [Mobile standalone Gift view at its daily limit](w4-standalone-gift-limit-390.png).
- [Desktop static Inventory view after trade](w4-static-inventory-1280.png).

Complete logs, traces, all captured screenshots and earlier attempts remain under `/workspace/.setup/w4-review-20261026`. The initial new server fixture omitted its added relationship from the authored mechanics effect plan; that fixture declaration was repaired. Later test expectations were corrected for array matching, established privacy-provenance redaction and complete reference cleanup in a simulated mechanics deletion. The first browser attempt used a wrapped-select label locator; the unchanged canonical-key assertion passed after using its actual combobox accessible name. No production defect was inferred from those fixture/assertion issues. They are retained separately and not counted as final passes. Source review then added economy-only save location/time and receipt logical checks; final checks rebuild the final implementation. A complete first verification passed 1,513 units and 49 browser tests. Final source review then reproduced an interoperability defect: a valid inherited-name canonical relationship key (`constructor`) loaded in a legacy bundle but was rejected by the W4 reserved-ID filter. Canonical keys now retain their existing contract; reserved-ID restrictions still apply to new world-owned definitions. Added runtime gift/save regression and service review/history coverage; the complete `release-*` checks rebuild and verify the final sources. The original final-source unit session ended without a completion result when the execution environment changed; its partial log is preserved. `release-unit-complete` reruns the full unit suite, followed by `release-browser`; earlier lint/typecheck/build completed successfully and their source hashes still match. Earlier passes are retained separately. Staging then detected one surplus blank line at EOF in the new server test; only that whitespace was removed, recorded with before/after hashes in `validation.json`. No TypeScript tokens changed; exact-head CI verifies the committed bytes. The existing nonfatal Vite chunk-size warning remains.

## Limits and compatibility

- The existing 48,000-byte UTF-8 world budget and RPC/save limits still apply; per-collection maxima are not a promise that all maxima fit simultaneously. Currency is one integer denomination; stock is finite per offer with no implicit restocking, exchange, selling or bulk dialog. Each confirmed purchase buys one authored bundle.
- Canonical relationship keys/scales are authored through existing Mechanics approval. Effects explicitly choose a key; world people do not imply automatic relationship mappings/preferences/decay. W5 relationship visibility/profile/journal presentation is excluded. Legacy abstract narrative resources remain separate from W4 typed items/currency; world-event predicates gate typed items.
- Costs start from the committed source state, and receipt day/chapter/cooldown accounting uses action start. Shop/presence/prerequisite constraints include completion. Pending required events block trade; an already confirmed required event finishes atomically before newly eligible priorities arbitrate, and windows can expire during that cost.
- Currency/item receipt conservation and logical validation are stronger than shape checking, but do not prove an entire playthrough or provide cryptographic anti-tampering. Relationship values retain canonical validation and shared narrative semantics. Limited progression analysis recognizes economic milestone producers but over-approximates funds, stock, presence, item/relationship gates and repeat histories; it is not exhaustive solvability proof.
- Items, currency, stock and relationship values carry through chapter transitions; explicit economic effects can change them. W2 milestone carry/expiry remains separate. Saves are bound to exact bundles; there is no automatic migration or erasure of previously remembered discoveries. Previously downloaded offline players require re-exporting for runtime changes.
- Current writes validate current canonical references; retained authoring history can use retained mechanics versions. Actual historical builds bind their exact inputs. Privacy exports intentionally alter provenance fingerprints while preserving gameplay. Player saves and project archives remain separate.
- Presentation hides future whereabouts but offline source necessarily contains executable authored rules. This fixture verifies W4 behavior rather than delivering the W6 demonstration or claiming complete UI/performance proof for every maximum-size definition.

## Exact diff and delivery

```sh
git diff --binary 6dfe8957626dcdc3c093e86cf7eca1d69e772507 HEAD
git diff --exit-code 6dfe8957626dcdc3c093e86cf7eca1d69e772507 HEAD -- apps/web/src/features/player/illustrated-scene.css e2e/illustrated-scenes.spec.ts
```

The delivery message supplies commit-pinned diff/report and exact-head workflow-run links. Report/screenshots are published through the authorized normal Git push for review outside this environment. Local/remote equality, a clean tree and passing CI are delivery checks, not independent W4 acceptance. Stop here; no W5 work.
