# Configurable Fiction Craft and format-only repair — review package

Date: 2026-11-05 (UTC). Implementation for independent review; **not acceptance**. This is Creator product work. The Sea Keeps His Name content, manuscript and artwork remain parked. Native desktop MCP verification remains a separate **pending** gate.

Branch: `checkpoint/cp1-desktop-review`.
Base: `b5c0ca2736412430c32907a1e7a7411849f1627d`.
The checkout was clean before implementation. The user subsequently authorized a normal commit and push of this scoped implementation and evidence to the existing review branch. The containing commit is the review head; its SHA and exact-head CI result are reported separately after push. No merge, force-push or PR is authorized. Pushing does not establish acceptance. The delivery-state JSON records the original precommit evidence snapshot.

The reviewed November 4 r3 settings/migration plan and its format-only enforcement requirement govern this work; the November 5 instruction removes story implementation from scope. Existing W1–W6 behavior, the illustrated-scene CSS/assertion and CP1 save synchronization are preserved.

## Implementation

- One editable [Fiction Craft Guide](../../writing/FICTION_CRAFT.md), unchanged supplied v0.1 bytes: **8,248 UTF-8 bytes**, SHA-256 `c42b4cd0239c26d1541615dd62ddc115281311d1f838e980468ca65631323e96`. The release catalog and generated runtime module are checked during lint/build. Projects retain verified immutable edition snapshots; released identities cannot silently change. A bounded cache recognizes only previously verified identical released bytes.
- New Quick, Long-form, setup/adaptation and MCP fiction projects record default **on** in their creation transaction. An absent legacy setting resolves **off**, with explicit `legacy-preserved` origin and no write on read. Import/restore/duplication preserve the source setting/edition. No bulk opt-in, timestamp inference or rewriting of existing prose occurs.
- Creator provides a reviewed preference toggle in Quick and a dedicated Long-form **Authoring preferences** view. Disabling retains the edition and editable commands/project direction. Settings use a shared browser/MCP service with exact-base review, explicit consent, transactional receipts, UUID conflict detection, identical retry recovery and restart persistence. Settings do not approve foundations, prose, assets or compilation.
- Frozen contexts capture settings version/on-off state/selected edition, full applied guide only when enabled, and effective command IDs/scope/order/exact text/digests. Existing task, canon and approved scoped Creative Direction remain separate. Pending authoring contexts become stale after relevant settings/command changes. Historical snapshots remain readable.
- Provider assembly uses one full enabled guide in a dedicated instruction message, identity metadata in quoted context, fixed application contracts first, and approved project/task requirements above craft defaults. Source/imported fiction remains evidence. Guide off omits applied guide text. Repository agents and MCP initialization explicitly honor that off switch.
- Full serialized message bounds include the guide, commands, system/identity overhead and repair input. Existing ceilings remain. Draft/plan previews reserve a maximum durable-ID envelope before job IDs exist. Setup retains its original prompt-byte diagnostic and adds a separate full-request-byte diagnostic. Repair-proposal storage retains its existing context-estimate contract, with full-request preflight checked separately.
- MCP adds four operations to the shared allowlist (51 total): `read_authoring_settings`, `review_authoring_settings`, `apply_authoring_settings`, and bounded `read_authoring_context` (`draft`, `planning`, `world`, `scene`). New external prose submissions explicitly use **contextVersion 2**, the same exact author request and the retrieved context fingerprint. Candidate, instruction binding and receipt commit atomically. New unbound/stale submissions fail; completed legacy receipts replay before the new-mutation requirement. Provenance remains connected-assistant/manual-input, without an internal model-generation claim.
- Format-only repair independently recovers the original complete decoded values and compares the entire repaired result before success is persisted. Schema-valid changes to prose, whitespace, negation, IDs, choices, costs, conditions or operations fail. Fences, explicit trailing commas and missing final container closers may be repaired; duplicate keys, incomplete strings/values, ambiguous content or missing required substantive content cannot be inferred. A fresh substantive revision needs its own authorization. Guide on/off does not alter this guard.

The [integration and migration documentation](../../writing/README.md), repository instructions and desktop allowlist describe the behavior and remaining gate.

## Delivery-path evidence

| Path | Instruction delivery and boundary | Evidence |
|---|---|---|
| Quick generation and graph repair | Frozen policy/commands plus original task; graph repair remains distinct from format-only repair | Quick request captures on/off; existing graph/source-boundary tests |
| Quick structured repair | Same pinned instructions; schema-valid prose rewriting rejected before export | Actual client with mocked streaming HTTP, captured initial and repair requests on/off |
| Long-form planning chat | Exact policy snapshot plus existing selected/approved scoped project context | Captured on/off provider-bound requests; scoped chat regressions |
| A2 Ask / setup proposals | Same shared assembly; exact full request bytes checked against preview | Mocked HTTP captures on/off, setup lifecycle tests |
| A5 foundation bootstrap | Pinned snapshot added before context fingerprint; source/provenance/schema protections retained | Actual mocked HTTP captures and existing source/bootstrap lifecycle/portability tests; shared on/off assembler tests |
| A6 scoped editing | Pinned policy/commands and separately identified applicable approved direction; ordinary review/apply | Captured on/off requests; stale/edit/archive tests |
| 4A passage planning | Snapshot inside bounded context before fingerprint/budget; inherited by structural repair | Captured generate/repair requests on/off, generation regressions |
| Draft / re-draft / continuation | Snapshot in each exact drafting unit; same policy on repair; accepted prose/locks preserved | Captured generate/repair requests on/off; adversarial repair service tests |
| Findings review / finding-driven revision | Snapshot in bounded review/revision context; findings stay evidence, repair cannot expand content | Captured review/revision generate/repair requests on/off, review and repair lifecycle tests |
| External MCP prose | Retrieved exact draft context, task and v2 binding; ordinary candidate and separate acceptance | Installed SDK transport/restart tests; stale/new-unbound rejection, transactional retries and legacy-receipt probe |
| External world/scene copy | Explicit bounded context read supplies policy/project direction and existing exact state; original review/apply remains | Shared MCP catalog/workflow instructions plus accepted world/scene regressions; no internal generation added |
| Source analysis / adaptation intent | No craft-writing guide; evidence-only extraction retains its contract | Existing mocked provider tests; format-only comparison added to their structural repair paths |
| Manual edits, deterministic transforms, runtime/exports | No new model call or guide application | Persistence/recovery tests and real exported-player browser suite |

Captured requests contain deterministic test data and mocked credentials are never included in headers/files. These captures prove delivery and enforcement, not literary quality or assistant compliance with every creative preference.

## Validation

| Check | Result | Evidence |
|---|---|---|
| Lint / typecheck / build | All passed | [lint](validation/lint.log), [typecheck](validation/typecheck.log), [build](validation/build.log) |
| Full unit suite | **1,624 passed**, 167 files | [full unit log](validation/unit.log) |
| Final focused suite | **197 passed**, 8 files, after the final instruction-precedence/context-scope refinements | [focused log](validation/final-focused.log) |
| Full browser suite | **56 passed**, matching Chromium, one worker | [browser log](validation/browser.log) |
| Preference desktop/mobile evidence | **4 passed**, Quick/Long-form at 1280px and 390px, keyboard/review/cancel/apply/reload | [control log](validation/browser-controls.log), [screenshots](screenshots), [traces](traces) |
| Guard browser regression | **1 passed**, no candidate or project mutation after unverifiable repair | [guard log](validation/browser-guard.log), [trace](traces) |
| Provider instruction delivery | **30 captured requests**: 16 enabled with exactly one full-guide message; 14 disabled with none | [request manifest](requests/request-delivery-manifest.json), [raw captures](requests) |
| Protected files | Base/current hashes match for illustrated assertion/CSS, global CSS, W6 browser test and progression runtime | [hash comparison](validation/protected-files.json) |
| Native desktop tools | **Pending**; none registered in this conversation | [gate record](validation/native-desktop-gate.json) |

Tooling: Node 24.19.0, pnpm 11.9.0, Playwright 1.62.0, Chromium **151.0.7922.34 / revision 1234**, no system-browser override ([toolchain](validation/toolchain.log), [browser proof](validation/chromium.json)). All provider traffic used neutral offline/mock fixtures; no paid calls.

The first full browser run passed 55 tests and exposed one obsolete expected failure message: the strengthened guard now reports an unverifiable original before the former candidate-validation error. The test retains its original no-mutation checks, expects the new diagnostic, and additionally checks the error code and null candidates. An intermediate overstrict per-unit diagnostic assertion was corrected to account for the fixture's separate initial provider failure. The successful guard rerun and full 56-test run are linked above. Initial failure artifacts remain preserved in `/workspace/.setup/fiction-craft-implementation-20261105`; no illustrated assertion, timeout or tolerance was changed.

Full units and browser runs preceded the final precedence/context-scope refinements. Lint, typecheck and build were then repeated, and the 197 relevant focused tests passed. The settled control screenshots/traces were also recaptured. This timing is explicit rather than claiming the complete browser run occurred after every final wording change.

## Review artifacts

- [Exact implementation source patch](source.patch) and [SHA-256](source.patch.sha256). It covers all implementation files relative to the base, including new files; the review directory itself is excluded to avoid recursive evidence.
- [Quick desktop](screenshots/craft-quick-1280-review.png), [Quick mobile](screenshots/craft-quick-390-review.png), [Long-form desktop panel](screenshots/craft-long-form-1280-panel.png), [Long-form mobile panel](screenshots/craft-long-form-390-panel.png). Additional saved-state screenshots and five positive traces accompany them.
- [Request manifest](requests/request-delivery-manifest.json). Foundation-bootstrap filename flags describe existing Creative Direction presence, **not** guide enablement; both are enabled.
- A portable ZIP accompanies this report. Its file manifest hashes every packaged report, diff, screenshot, capture and validation log.

## Browser and recovery observations

The new preference workflow is exercised at 1280px and 390px in both Quick and Long-form, using keyboard activation, review, cancellation, explicit Apply and reload. The Long-form control has a dedicated view because placing it inside the existing expanded navigation made it clip on mobile.

An existing Quick-page width issue is outside this change: in a 390px viewport the document measures 395px both with and without the new control. The control itself measures left 33.78125 / right 371.78125 and fits. `quick-mobile-geometry.json` records the comparison. No global CSS or layout tolerance was changed to hide it.

## Limitations and pending gates

- **Native desktop Codex connection/tool discovery is pending.** No native Creator MCP tools are registered in this Cloud conversation. The installed SDK tests use separate local clients and do not satisfy that gate. Use the documented desktop smoke test after updating the allowlist/restarting the local host and Codex; additionally read settings, cancel a preference review and read a narrow authoring context without mutating content.
- Exact-head CI must be checked after the authorized push; the local logs below do not establish CI success. Independent review remains required.
- The current released edition is v0.1. Projects retain selected editions; there is no automatic upgrade or broad legacy opt-in.
- Required instruction/context overflow fails closed and asks for narrower work. World/scene context reads are bounded; they do not introduce new model generation or unrestricted project mutation. External assistant creative compliance cannot be proved by server validation.
- Existing project-specific commands remain editable in their existing command system; immutable snapshots preserve the text used in historical requests, including after a command changes. Existing archive privacy/command-transfer policy is not replaced by a new shadow instruction store.
- Exported games keep their accepted mechanics and run without Creator/providers. Offline story source remains inspectable; authoring-guide integration is not a secrecy feature.
- Neutral fixtures and existing compatibility fixtures are tests, not the user's story or complete comparative story-playthrough acceptance. No game-content or later-roadmap work was implemented.

## Reproduce

Use Node 24.19.0, pinned pnpm 11.9.0 and the lockfile's Playwright 1.62.0 / Chromium 151.0.7922.34 (revision 1234). In this Cloud environment, activate `/workspace/.setup/w6-review-20261028/activate.sh`. A fresh checkout uses the saved setup instructions and matching Playwright browser installation.

```sh
pnpm lint
pnpm typecheck
pnpm build
mkdir -p /tmp/craft-evidence
CYOA_CRAFT_EVIDENCE=/tmp/craft-evidence pnpm test
pnpm test:e2e --workers=1 --trace=on
```

Tests use mocked providers or deterministic offline clients. No provider key or paid generation is needed. SDK/browser checks need permission to bind local loopback ports. To inspect only the added controls, run `pnpm test:e2e e2e/fiction-craft.spec.ts --workers=1 --trace=on`. The desktop connection smoke test is intentionally not replaced by those commands.
