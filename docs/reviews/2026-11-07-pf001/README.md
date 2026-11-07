# PF-001: bounded collection creation in large foundations

This change lets an author append foundation records without selecting an oversized artifact root, then edit the created records through ordinary narrow targets. It includes the required child-choice identities for new route decisions. PF-001 is proposed for independent review, **not accepted**. PF-002 remains unchanged.

Base: `fd594612b3423fa9d81caee092aa52aac032c200`, branch `checkpoint/cp1-desktop-review`. The delivery message supplies the final full head, exact GitHub comparison and exact-head workflow URL/conclusion. This report and its evidence are committed with the implementation, before the release push; no subsequent report-only CI cycle is needed.

## Implementation

- A shared allowlist exposes **27** top-level ID-record collections: Bible ten, Routes six, Endings two, Mechanics eight and Creative Direction `scopedVariations`. Empty arrays are included. No new MCP tool or database migration is required.
- Keys use `collection:<owner>:<field>`, distinct from legacy `owner:<entity-id>` keys. Each target has a versioned collection discriminator and bounded descriptor: exact parent/schema identity, canonical item JSON schema, count, maximum and append-only authority. The array itself is not prompt context.
- Collection targets accept only `add-item` in their exact field. The server validates the descriptor against the full current/historical parent and translates it into the existing full-artifact planning operation. Existing entities, roots and stored plans retain their previous paths.
- Full candidate schemas, project/reference validation, identity collisions, lifecycle/lock protections, project-head/parent-version/instruction freshness and downstream staleness remain enforced. Global stable-ID collection and PF-003 semantic-key protections remain intact; existing keys still cannot be renamed.
- New identity declarations are limited to the new parent record and four explicit child fields: route decisions' `choices`, endings' `variants`, gates' `conditions`, and relationship mechanics' `bands`. All declarations require distinct fresh `$new:<logical-key>` IDs. Children are owned by the parent producer group; references require that group. Arbitrary nested strings and reference fields never declare identities.
- Reviews show complete added records, generated identities, parent/count information, findings and staleness while remaining bound to the full internal candidate. They do not return entire parent arrays or silently truncate additions. Existing-record edits in the same batch retain their own complete narrow reviews. `existingRecordsUnchanged` describes the collection across that whole reviewed batch; it can be false when other explicitly selected records in that collection are also edited.
- Pinned authoring settings/guide snapshots, custom instructions, approved scoped Direction, selected source evidence and existing author-memory diagnostics remain in context. Collection metadata is not treated as reference content or as an existing entity's scope. A regression specifically preserves artifact pins while preventing accidental inheritance of an entity-only pin from a legacy ID resembling a collection ID.
- Exact prepare/submit/Apply retries and historical validation remain transactional. Creator's scope/review controls and MCP instructions/tool descriptions explain creation authority, required references, generated children and separate foundation approval.

The limits remain **12 targets, 80 dependencies, 12 groups, 48 operations, 64,000 context bytes, 96,000 proposal bytes and 256,000 MCP result bytes**. No runtime, inventory, economy, world, save/player/export or illustrated-scene CSS implementation changed. The original illustrated-scenes assertion is unchanged.

## Before and after evidence

The [captured finding](before/captured-finding.md) supplies the original operation/version IDs. Its exact original project payloads were unavailable; the baseline reproduction used isolated neutral fixtures rather than the author's project. Both Bible (109,880 bytes) and Routes (84,845 bytes) failed through actual Creator browser and authenticated MCP with `edit_context_overflow_narrow_scope`. All **71 application tables** had equal logical row hashes/counts before/after each rejection, with zero provider calls and no plan/message/proposal/receipt writes. Identical MCP rejection retries remained unchanged. See [baseline reproduction](before/reproduction.json) and [small-root child-ID probe](before/nested-creation.json).

The implementation's browser fixture uses a **280,117-byte Bible and 275,013-byte route plan**, exceeding both the context limit and the MCP result limit. It is a coherent neutral research-station planning fixture: 20 characters, ten relationships, 12 settings, eight timeline entries, three routes, five acts, 13 decisions/39 choices and seven ending hooks. Notes cover attribution, evidence custody, consent, inspection and handover; the fixture is not one padded field. It is seeded using canonical Creator services/HTTP, never direct database writes.

The browser/SDK workflow:

1. Confirms oversized-root rejection through Creator HTTP and authenticated MCP, including the captured root/decision/seven-hook selection, with unchanged application rows and no provider generation.
2. Creates a witness through Creator's explicit generation/review/Apply controls, then edits it through MCP.
3. Prepares a relationship referencing the witness and an existing character, restarts Creator and the SDK connection, and retries the exact preparation. Submits, restarts again and retries the exact submission. Reviews/applies through Creator, then edits the new relationship through MCP.
4. Creates a route decision with two fresh child choices in Creator, then edits its question and a child choice through MCP. Creates another decision through MCP, restarts and retries its exact Apply, and edits its parent/child through Creator.
5. Rejects an invalid relationship reference without writes. Rejects a stale Creator Apply after an intervening MCP edit, then rejects the pending proposal without applying its content.
6. Deep-compares all unrelated foundation content and pre-existing siblings/order. Exercises desktop/mobile review plus keyboard activation of generation authorization and Apply.

Fixture generations use an injected deterministic offline provider, with **four scripted model invocations and zero paid provider calls**. The published capture contains the constructed requests and exact instruction snapshots; it does not claim real model quality or independently authenticated human consent. SDK HTTP verification is distinct from native desktop Codex tool discovery, which remains pending.

## Acceptance and validation

| Area | Evidence |
| --- | --- |
| All collection scopes and empty arrays | New unit suite verifies 27 scopes, schemas/counts, protected/primitive-array exclusions and canonical maxima. |
| Namespace and identity safety | Legacy IDs remain concrete targets; forged/version-mismatched descriptors fail. Entity-only pins do not leak into collection scope. Literal/duplicate/unknown child IDs and unknown extra objects fail atomically. |
| Large-parent creation/edit | Unit and actual browser/SDK tests create/edit characters, relationships, decisions and decision children on parents larger than 256,000 bytes. |
| Captured creative batch | Unit test prepares the new decision collection plus existing route-selection decision and all seven hooks, applies a valid nine-target batch and verifies unrelated records. Oversized roots themselves remain rejected. |
| Full validation | Unknown people/acts, invalid/duplicate semantic keys, cardinality violations, forbidden collection operations and dependency-incomplete selections fail without partial writes. Existing PF-003 reference/collision tests remain in the focused/full checks. |
| Review and approval | No canonical Apply during preparation/submission; complete additions are reviewed. Pending rejection leaves content unchanged. Foundation approval and accepted prose remain separate. Existing generation cancellation/lock regressions remain intact. |
| Freshness | Parent, unrelated head and instruction changes invalidate submission. Stale review/Apply and independently stale head/version preparation fail. Browser stale Apply is exercised after a second client changes the project. |
| Recovery and atomicity | Exact preparation, submission and Apply are replayed across actual server/SDK restarts. Same-session retries do not duplicate data. A forced audit failure after a canonical write rolls the whole transaction back; the original envelope can then succeed. |
| Instructions | Enabled, disabled and absent-setting legacy cases preserve exact custom instructions. A separately approved scoped Direction override is present in later context. Oversized required instructions fail rather than being dropped. The source-lineage test verifies a collection plus a concrete source target retains the exact grounded excerpts. |
| History | Full-fidelity/privacy-redacted export/import, duplication and verified backup/restore preserve collection history. Existing legacy root/entity history tests remain unchanged. |
| Presentation | Representative before/after desktop/mobile captures and an actual workflow trace; existing full browser coverage includes the unchanged illustrated-scene geometry assertion and offline-player exports. |

Local validation is recorded under [validation](validation/). The full local run passed **1,697 unit tests / 169 files**. It preceded the final entity-pin discriminator hardening; afterward the affected **109** collection/conversational regressions passed, and server lint/typecheck/build were repeated before browser validation. The final exact-head CI performs all checks afresh. The SDK files separately passed **36** tests with loopback networking enabled. The first broader focused attempt had two existing SDK tests blocked by sandbox socket binding; no assertions/timeouts were changed to address that environment restriction.

The full local browser run on the final production sources passed **59 tests**, using matching Chromium with two workers, in **5.4 minutes**. Final server lint/typecheck/build also passed after the pin fix. Exact-head CI is reported separately in delivery; no earlier commit's run is presented as evidence for this head. Development logs retain initial fixture-only argument/fault-injection mistakes and the namespace-pin regression before its fix; passing checks do not erase those observations.

The source/documentation diff passes `git diff --check`. Captured logs and the embedded standard unified patch retain their original terminal blank lines/context-line whitespace as evidence; that artifact whitespace is excluded from the source-only whitespace check.

See [acceptance summary](acceptance-summary.json), [complete SDK plans and results](after/acceptance.json), [mock provider request captures](after/mock-provider-requests.json), [workflow trace](after/collection-workflow.zip) and [evidence manifest](evidence-manifest.json). Complete constructed mock requests measured 17,440–27,353 UTF-8 bytes, retaining the pinned enabled guide. Representative captures:

| Before | After |
| --- | --- |
| [Bible desktop rejection](before/bible-desktop.png) | [Bible desktop review](after/bible-review-1280.png) |
| [Routes mobile rejection](before/routes-mobile.png) | [Routes mobile review](after/routes-review-390.png) |

The remaining desktop/mobile captures are in [after](after/). Screenshot review confirms the new records are available in the bounded review; existing scrollable detail panes still require scrolling to inspect long JSON. Keyboard activation was tested for generation authorization and Apply; this is not an exhaustive accessibility audit.

## Reproduce

Use the pinned pnpm/Node setup and matching Playwright browser from the repository/environment instructions. Local verification used Node 24.19.0, pnpm 11.9.0, Playwright 1.62.0 and Chromium/Headless Shell 151.0.7922.34, revision 1234.

```sh
pnpm build
pnpm test apps/server/test/collection-editing.test.ts apps/server/test/conversational-edit.test.ts apps/server/test/keyed-mechanics.test.ts
pnpm test:e2e e2e/collection-editing.spec.ts --workers=1
```

The test host and fixture databases are disposable and author-provider credentials are not needed. Do not point reproduction commands at the author's project. The full required lint/typecheck/build/unit/browser checks remain unchanged in CI. The implementation patch and manifest included here identify the source changes separately from review artifacts; the final delivery links the exact base/head diff.

## Remaining bounds and review status

Primitive arrays, protected provenance, oversized scalar/root edits and oversized individual records are not newly supported. Required references/instructions that cannot fit still require a smaller batch or rejection; no hidden context compaction is performed. A descriptor does not assert knowledge of unselected sibling contents. Existing author-memory selection budgets/omission diagnostics remain in effect. Whole-foundation approval may still require Creator if its MCP review is oversized; a bounded append diff never approves unseen foundation content.

Collection scope version 1 binds its canonical descriptor/item-schema representation. Future incompatible schema/descriptor changes must preserve historical version-1 interpretation rather than silently reinterpreting saved targets. No data migration is performed here.

No author project/manuscript/artwork was read or changed, no paid provider calls or subagents were used, and PF-002 remains out of scope. Native desktop MCP verification and independent PF-001 acceptance remain separate gates. A successful push/CI result does not establish acceptance.
