# PF-003 — keyed-mechanic creation, independent review

Base: `96a0033f3f5bf6a7425b90e6c54c009da8b61456`. Branch: `checkpoint/cp1-desktop-review`. Initial checkout was clean. The containing commit, when published, is the implementation head; exact-head CI is reported separately. This is a scoped product correction, not story-content implementation or checkpoint acceptance.

## Reproduction and cause

The reported minimal `add-item` resource (`$new:resource-clock`, semantic key `clock_minutes`) reproduced `edit_generated_id_invalid`. Canonical foundations/workflow were unchanged and no provider was called. The label-only control changed `stat-resolve`'s label to `Authority`, retaining its `resolve` key. See [baseline log](baseline.log), [minimal failure](minimal-before.json) and [label control](label-control.json).

The shared stable-identity collector includes both `id` and `key`. Conversational creation generated/authorized the new entity ID, but its ordinary semantic key remained an unauthorized second identity. The collector is **unchanged**. Removing `key` globally would bypass protections rather than authorize the requested creation.

After this correction, the bare item passes identity authorization and reaches the existing unused-mechanic diagnostic. This guard is intentionally preserved: authors must include the intended gate or choice-effect plan in the same valid batch. The successful fixtures append that explicit usage, rather than inventing consequences in the service or weakening validation ([post-fix minimal diagnostic](minimal-after.json)). The `clock_minutes` record is a reproduction probe only; the playable fixture does not substitute a counter for canonical world time.

## Change

- Only schema-valid `add-item` operations against the explicitly prepared `mechanics:root` can authorize a fresh semantic key, in `visibleStats`, `relationships`, `flags` or `resources`. Each authorization binds the generated **entity ID + exact authored key + collection + creation group**. Whole-array replacements, other owners, nested records and unrelated generated IDs do not gain this authority.
- Key syntax, exact closed values, duplicate keys, global existing-identity collisions and generated-ID collisions remain enforced. Final foundation/passages validation still rejects unknown/incompatible references. New semantic references require their creation group, using actual `mechanicKey`/`mechanicKeys` fields; incidental words in labels do not create dependencies.
- In conversational operations, existing mechanic keys stay bound to their original IDs. Direct renames, root-array renames and key swaps are explicitly rejected with `edit_mechanic_key_rename_unsupported`; label edits still work. A reference-safe rename migration is **not implemented** and needs separate review.
- Creator and MCP use the same shared service and existing exact-version review/Apply/receipt transactions. Application creates a new draft version, retains the prior approval, and uses existing downstream staleness. No automatic content approval, foundation reinitialization, schema migration, save-format change or alternate runtime is introduced.
- Browser provider and MCP initialization instructions now describe the supported creation shape, references and rename boundary. [Connected authoring documentation](../../connected-editing.md#creating-keyed-mechanics-pf-003) gives the same contract and calls for canonical world time, economy/inventory and progression where appropriate.

## Author-project preservation

The author's persistent desktop project was not connected to, opened or modified. Reproductions use fresh in-memory databases; the browser test uses a uniquely created temporary SQLite database and an MCP allowlist containing only its random fixture project. No operations use the project ID from the supplied findings. No author manuscript/artwork or approved foundations are rebuilt or replaced.

Within the fixture, the test captures existing approved foundation versions before creation and compares Brief, Creative Direction, Bible, routes and endings afterward. Existing mechanic records remain equal; only requested additions and their explicit usage plans are appended. The mechanics foundation becomes draft and retains its prior approval. Upstream-approved records remain unchanged. [Protected-file hashes](protected-files.json) also verify unchanged global identity collection, canonical schemas/validators, runtime/save/progression code and illustrated CSS/assertion/W6 save synchronization.

## Scoped diff

[Source patch](source.patch) and [SHA-256](source.patch.sha256) cover every implementation file relative to the base, including newly added source/tests, and exclude this evidence directory to avoid recursive artifacts. No dependencies, canonical schemas, database/runtime formats, global identity collector, illustrated CSS/assertion or author content files changed.

## Automated coverage

[Keyed-mechanic unit tests](../../../apps/server/test/keyed-mechanics.test.ts) cover all four collections, invalid/noncanonical keys, existing and generated collisions, duplicate keys across collections, exact ID/key/collection binding, root/foreign/nested injection attempts, renames/swaps, subsequent references and unknown references, group selection, label-only independence, stale submit/Apply, exact prepare/submit/Apply retries, receipt rollback/retry, unchanged unrelated records, archive import and independent duplication. Providers throw if invoked in these service tests.

The [browser/MCP test](../../../e2e/keyed-mechanics.spec.ts) uses real authenticated local MCP `tools/call` requests for prepare/submit/review/Apply, normal approvals, drafting, compilation and export. Creator displays the MCP proposal's concrete diff and applies it; a deterministic offline provider then creates another flag through the actual browser preview/authorization/generation/review/Apply workflow. This is a fixture provider, with no paid generation. Scripted fixture consent is not proof of a human approval conversation or native desktop Codex discovery.

## Actual exported gameplay

The test downloads [this native standalone HTML](neutral-mechanics.html), shuts down Creator, opens the file and executes its authored choices. No HTTP/API/provider request occurs during play. It uses canonical numeric/boolean mechanics, not prose-only promises or a second state engine.

| State/action | Focus | Cooperation | Inspected flag | Calibration flag | Charge | Calibrated option |
|---|---:|---:|---|---|---:|---|
| Inspect panel | 1 | 2 | true | true | 1 | Enabled |
| Leave panel untouched | 0 | 0 | false | false | 2 | Disabled; explains inspection prerequisite |
| Save/resume inspection | 1 | 2 | true | true | 1 | Enabled |
| Rewind, then replay inspection | 1 | 2 | true | true | 1 | Enabled; state exactly matches first inspection |

The standard-check alternative remains available when the gate is unmet. See [actual saved-state comparison](pf003-runtime-state.json), [desktop player](pf003-export-1280.png), [mobile player](pf003-export-390.png), [desktop Creator review](pf003-review-1280.png), [mobile Creator review](pf003-review-390.png), and the [authoring/export trace](authoring-and-export-trace.zip).

The legacy Status configuration permits author-visible stats. The fixture shows Focus there and checks relationship/flag/resource values through the actual saved runtime state and compound gate; it does not expand that presentation contract. For richer character/journal, time, money or inventory behavior use the accepted canonical extensions. Adding mechanics changes the gameplay bundle; this correction does not promise arbitrary cross-revision save migration. New-bundle save/resume uses the unchanged exact-bundle policy.

## Validation and reproduce

| Check | Result | Evidence |
|---|---|---|
| Lint | Passed | [log](lint.log) |
| Typecheck | Passed | [log](typecheck.log) |
| Build | Passed | [log](build-release.log) |
| Full unit suite | **1,656 passed**, 168 files, including 32 new PF-003 cases | [log](unit-release.log), [PF-003 cases](keyed-release.log) |
| Full browser suite | **58 passed**, two workers, after unit suite completed | [log](browser-verified.log) |
| Focused browser/MCP/export | Passed, actual file player with Creator shut down | [log](browser-seventh.log), trace and state above |
| Toolchain | Node 24.19.0, pnpm 11.9.0, Playwright 1.62.0, Chromium 151.0.7922.34 / revision 1234 | [proof](toolchain.json) |
| Protected contracts/files | All listed base/working hashes match | [hashes](protected-files.json) |

The first full browser run, concurrent with the CPU-heavy unit suite, recorded **56 passes and two failures** ([preserved log](browser-release.log)). The new PF-003 test selected a checkbox before search filtering finished and matched 45 records; its selector now names the exact mechanics root. The unchanged W6 test reached its 300-second total timeout. The subsequent full run, after units completed, passed all 58 tests without changing W6, timeouts or assertions. This records the observed sequence; it does not claim exhaustive proof of timeout causation. Initial error snapshots accompany the report.

Exact-head CI is checked separately after publication; local results are not represented as CI or acceptance. The final workflow URL/result is reported with the pushed head without rewriting the commit solely to add its own CI status.

Use the saved activation instructions, Node 24.19.0, pnpm 11.9.0 and matching Playwright 1.62.0 / Chromium 151.0.7922.34, revision 1234. Builds must precede production-entry/browser tests.

```sh
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm test:e2e --workers=2
```

Focused checks:

```sh
CYOA_PF003_EVIDENCE=/tmp/pf003 pnpm test apps/server/test/keyed-mechanics.test.ts apps/server/test/conversational-edit.test.ts apps/server/test/connected-editing.test.ts
pnpm test:e2e e2e/keyed-mechanics.spec.ts --workers=1 --trace=on
```

Existing evidence and development-iteration failures remain preserved under `/workspace/.setup/pf003-20261106`. Fixture corrections respected the existing minimum project targets, current-approval freshness, 12-candidate acceptance cap and author-visible stat policy; no production contracts were relaxed to get a demo through.

PF-001 root-context growth and PF-002 historical prose-guidance target affordance remain outside this correction. Existing context/output budgets stay intact; creation still needs an authorized root whose context fits. Native desktop MCP verification remains a separate pending gate. This report proves a scoped mechanism workflow, not literary/game-content acceptance or exhaustive safety of every authored game.
