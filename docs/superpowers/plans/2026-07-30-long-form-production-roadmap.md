# Long-form CYOA production roadmap

## Status

This roadmap begins from the committed application at `aec8c73`. It does not restart the project or replace the working quick generator.

Completed long-form stages:

1. Persistent project brief
2. Story bible
3. Route architecture
4. Ending architecture
5. Mechanics planning
6. Scoped project chat with reviewable proposals

Implementation checkpoints:

- Foundation 1 is complete.
- Foundation 2 is complete: the manual passage-plan workspace, entity history, immutable snapshots, stable-ID editing/reordering, budgets, search/filtering, exports, and a 300-passage offline acceptance test are implemented.
- Foundation 3 is complete: structural, state, continuity, budget, and path analysis feed a linked coverage dashboard with persisted warning rationales and hard-error approval blocking.
- The post-Foundation cleanup gate is complete: passage-plan validation now uses exact approved dependencies, unchanged saves preserve approval state, and a browser-level 300-passage fixture verifies rendering, filtering, and stable-ID jump behavior offline.
- Foundation 4A is complete and externally accepted: approved snapshots can be planned in bounded units, executed into immutable validated candidates, consolidated into deterministic stable-ID proposal groups, previewed against current heads, selectively applied in one transaction, audited, reloaded, and restored without a provider call during proposal work.
- Foundation 4B is complete and externally accepted: durable versioned prose, bounded offline-testable drafting, exact provenance and staleness, explicit review and acceptance, locking, history, comparison, restore, and corpus reporting are implemented.
- Foundation 4 is **CLOSED** at accepted head `1cf2b003375851a27999036e0935d54ff6a894a6`.
- Foundation 5A is complete and externally accepted at `218166b32990cf70d858d2c876ce3be542f7768a`: immutable simulation inputs, deterministic runtime execution, exact replay, bounded traces, and offline inspection are implemented.
- Foundation 5B is complete and externally accepted at `b69ed9b15542fb39eebd55309141e7b13fbae373`: deterministic seeded campaigns, compact durable evidence, exact sample replay, structural and experience analysis, and metadata-first review UI are implemented.
- Foundation 5C is complete and externally accepted at `949fe10e353c20ae05397a55d7c6e48a5fba732c`: exact immutable review inputs, bounded findings-only review units, explicit authorization, offline-testable provider execution, strict evidence grounding, immutable provenance, recovery, and metadata-first review UI are implemented.
- Foundation 5 is **CLOSED** at accepted head `949fe10e353c20ae05397a55d7c6e48a5fba732c`.
- Foundation 6A is complete and externally accepted at `e8d1e9832dc90dcf6904af9448579e00e9e5a915`.
- Foundation 6B is complete and externally accepted at `eb800c173640b231bf890d0a65e67bf6ed3f6c18`.
- Foundation 6C is implementation-complete on `checkpoint/foundation-6c-repair-application`; external acceptance is pending.

The next objective is external review of Foundation 6C. Foundation 6 is not closed until that review passes.

The detailed passage, versioning, and runtime contracts are defined in:

- `docs/superpowers/specs/2026-07-30-passage-plan-and-runtime-design.md`

## Product decisions

These decisions are settled unless later evidence justifies revisiting them:

1. Structured project data is canonical. Chat is a discussion and change-request interface over that data.
2. The application guides the workflow; the model does not infer or control the workflow from an unbounded transcript.
3. Discussion cannot mutate project state. AI changes are explicit proposals.
4. Scope is always visible and manually adjustable.
5. Large changes are divided into coherent, dependency-safe groups.
6. The default total word target is 175,000 within an editable 150,000-200,000 range. Larger projects remain supported.
7. Planning proceeds from acts to sequences to passages before bulk prose drafting.
8. The native structured engine and custom browser player are primary.
9. Twee 3 targeting SugarCube is the first interoperability export, not the canonical authoring format.
10. Ink may be added as a later export target.
11. Hosted Games is not a target while its current policy excludes AI-generated work.
12. Provider reasoning activity may be shown in a bounded, scrollable session panel. Raw reasoning is not persisted or treated as project memory.
13. Tests and normal verification remain offline. A live or paid OpenRouter call always requires explicit approval and a spending boundary.
14. Development remains sequential in this checkout without multi-agent work by default.

## Current-state review

### Working foundations

- Long-form projects and planning artifacts survive restart in local SQLite.
- Artifact versions are immutable.
- Workflow approval references a specific version.
- Upstream edits can mark downstream artifacts stale.
- Conversations, messages, scopes, and proposal base versions are persisted.
- Proposal application rejects a stale whole-artifact candidate.
- Direct editing and local exports do not require a provider call.
- The quick generator remains separate from the long-form workflow.

### Gaps to close before passage planning

1. Assistant context is currently assembled from whole planning artifacts.
2. AI proposals currently return complete replacement artifacts.
3. Assistant scope supports an artifact but not a stable section or entity ID.
4. Version list, comparison, and restore APIs exist but are not fully exposed in the long-form interface.
5. Cross-artifact validation is incomplete:
   - Relationship references are not consistently checked against the bible.
   - Ending character, relationship, and contributing-decision references are not all checked.
   - Mechanic gate targets and choice-effect decision references are not all checked.
   - Route ending-hook ownership can become inconsistent after manual edits.
6. Some schema-supported mechanics fields are not fully editable in the website.
7. Some direct write routes do not enforce the same stage prerequisites as creation and approval routes.
8. Conversation summaries are persisted but are not yet maintained as bounded context.
9. The current artifact-snapshot approach should not be used for every edit to a 150,000-word draft corpus.

These are foundation issues, not reasons to discard the current design.

## Post-Foundation review and cleanup gate

A focused review after Foundations 1-3 found that the overall architecture is sound, the repository is clean, and the relevant offline regression tests pass. This cleanup checkpoint was completed offline on 2026-08-01 before Foundation 4:

1. Passage-plan validation and snapshot creation must use the exact approved bible, route, ending, and mechanics versions recorded as snapshot dependencies. They must not validate against newer unapproved drafts while recording older approved version IDs.
2. Saving a passage-plan bundle that has no content changes must not demote an approved plan to draft status. A real content change may create a draft while retaining the last approved snapshot for recovery and comparison.
3. Add a browser-level large-fixture check for the 300-passage workspace. Existing tests prove persistence, reordering, validation, snapshots, exports, and restore, but do not measure interactive browser responsiveness.
4. Keep the existing provider-activity behavior: reasoning activity is visible in bounded, scrollable session UI, while raw reasoning is not persisted as project memory.

The first two items were correctness fixes covered by focused regressions. The large-fixture browser check closes the earlier evidence gap by loading, filtering, and stable-ID jumping in the actual browser workspace. This checkpoint remained fully offline and required no OpenRouter request.

## Target workflow

```text
Premise or source
  -> Project brief
  -> Story bible
  -> Route architecture
  -> Ending architecture
  -> Mechanics
  -> Acts and sequences
  -> Passage plan
  -> Passage drafts
  -> Structural and narrative review
  -> Native play build
  -> Portable and publishing exports
```

Chat remains available throughout. It can discuss the whole project or operate on a selected artifact, section, sequence, passage, choice, mechanic, route, or ending.

## Milestone sequence

### Remaining milestone naming

The canonical remaining roadmap uses Foundations 4-8. Earlier versions of this document called the implementation slices Production 1-5; those names map into the foundations as follows and do not represent a second body of work:

- **Foundation 4 — AI-assisted production:** Production 1 (bounded AI passage planning) followed by Production 2 (passage drafting).
- **Foundation 5 — Structural review and simulation:** Production 3's deterministic and AI-assisted review work.
- **Foundation 6 — Revision workflow:** scoped repairs arising from drafting, validation, simulation, and narrative review. This reuses the proposal, versioning, and transactional application systems rather than regenerating the whole project.
- **Foundation 7 — Runtime and export:** Production 4.
- **Foundation 8 — Large-project production hardening:** Production 5 plus final recovery and performance verification.

### Codex engineering model guidance

Model choice here concerns Codex implementing the application, not the OpenRouter model later used to author a CYOA. Use the least expensive model that reliably passes the checkpoint's tests and review:

- **Terra High is the default** for Foundations 4-8. It is appropriate for sustained full-stack implementation when the roadmap and acceptance criteria are already explicit.
- **Luna Max is acceptable** for bounded, well-specified slices such as UI work, export adapters, fixtures, documentation, and focused test implementation. Max reasoning does not make it identical to Terra or Sol, so keep tasks narrow and verify at the checkpoint boundary.
- **Sol High** is reserved for the highest-risk architectural work: resumable job semantics, transactional state changes, migrations, save compatibility, deterministic runtime behavior, and difficult failures spanning several packages.

Switching models between coherent slices is safe because the repository, roadmap, tests, and continuation notes are the persistent source of truth. No engineering model choice authorizes a paid or live OpenRouter request.

### Foundation 1: consistency, scope, and safe changes

#### Goal

Make the existing five planning stages safe and scalable enough to support hundreds of smaller entities.

#### Work

1. Introduce a long-form application service layer used by create, save, restore, proposal application, and approval routes.
2. Centralize stage prerequisites and downstream invalidation rules.
3. Build a project reference index over the approved/current brief, bible, routes, endings, and mechanics.
4. Add cross-artifact validation with stable finding codes and entity references.
5. Distinguish:
   - hard errors that block approval or application;
   - warnings that require review but may be acknowledged;
   - informational readiness findings.
6. Extend `AssistantScope` with `sectionId` and later `entityType`/`entityId`.
7. Replace whole-project context assembly with a bounded context-pack builder.
8. Replace complete-artifact AI candidates with stable-ID, domain-level operations.
9. Add proposal groups, preconditions, validation previews, and dependency-safe partial application.
10. Expose artifact version history, comparison, and restore in the long-form UI.
11. Complete missing direct-editor controls, especially mechanics relationships, bands, gates, conditions, and effect plans.
12. Update the user guide to reflect all five completed planning stages and the new proposal behavior.

#### Proposal operation principles

- An operation identifies an entity by stable ID, never by its current array position.
- Every changed existing entity carries its expected base entity version or content fingerprint.
- A proposal records the artifact/snapshot versions used to build its context.
- Selected groups apply in one SQLite transaction.
- All preconditions and hard validations run before any write.
- If one selected operation fails, the selected transaction does not partially apply.
- A successful application produces normal recoverable versions and a human-readable audit summary.

RFC 6902 is a useful model for ordered operations and precondition tests, but raw JSON Pointer array indices are not the application contract. The application uses domain operations over stable entities.

#### Acceptance gate

- A request to change one route, ending, or mechanic does not transmit or replace unrelated complete artifacts.
- Scope identifies the exact selected section/entity and base version.
- A stale operation cannot overwrite a newer entity.
- Known broken cross-artifact references are caught before approval.
- Version history, comparison, and restore are usable from the website.
- All current planning fields are directly editable.
- Existing quick and long-form tests remain green.

### Foundation 2: manual passage-plan workspace

**Implementation status:** Complete and acceptance-tested offline on 2026-07-30.

#### Goal

Allow a full several-hundred-passage project to be planned manually, persisted, versioned, searched, and reviewed without any provider call.

#### Work

1. Add act, sequence, passage-plan, choice, and narrative-thread entities.
2. Add per-entity versions and immutable passage-plan snapshots.
3. Add project, act, route, sequence, and passage word budgets.
4. Add outline/table navigation with filters for act, route, status, character, mechanic, ending, and unresolved findings.
5. Add a passage detail editor and compact choice editor.
6. Add fast search and jump-to-ID behavior.
7. Add batch selection and safe manual bulk edits.
8. Add passage-plan approval against a specific immutable snapshot.
9. Add Markdown and canonical project-bundle exports for the passage plan.
10. Keep the graph as a filtered secondary view rather than the primary editor.

#### Acceptance gate

- A project with at least 300 passage plans remains responsive.
- Reload restores exact structure, selection-safe IDs, versions, and stage state.
- Reordering acts, sequences, or passages does not invalidate references.
- Word budgets reconcile at project, act, route, and sequence levels.
- The stage can be completed without OpenRouter.

### Foundation 3: structural validator and coverage dashboard

**Implementation status:** Complete and acceptance-tested offline on 2026-07-30.

#### Goal

Demonstrate that routes, choices, mechanics, relationships, and endings materially function before prose is generated.

#### Work

1. Build graph validation for:
   - missing destinations;
   - unreachable passages;
   - accidental dead ends;
   - invalid terminal passages;
   - uncontrolled cycles;
   - route and ending coverage;
   - start-passage validity.
2. Build state analysis for:
   - mechanics written but never read;
   - mechanics read but never changed;
   - apparently unreachable thresholds;
   - incompatible condition/effect types;
   - choices that are always hidden or disabled;
   - endings with no feasible incoming path.
3. Build continuity analysis for:
   - facts used before revelation;
   - setup without payoff;
   - payoff without setup;
   - route-preserved differences that disappear at reconvergence;
   - characters appearing outside declared availability.
4. Estimate minimum, maximum, and representative path word counts.
5. Add a dashboard that links every finding to its exact entity.
6. Add explicit overrides for conservative warnings, with rationale.

#### Acceptance gate

- Every declared mechanic has at least one meaningful write and read.
- Every approved ending has at least one plausible incoming path.
- Every nonterminal passage has an available outgoing choice under at least one plausible state.
- Hard graph/reference errors block passage-plan approval.
- Warnings remain visible and reviewable without pretending heuristic analysis is proof.

### Foundation 4A: bounded AI passage planning (formerly Production 1)

**Implementation status:** Complete, externally accepted, and acceptance-tested offline on 2026-08-10 at `9a3316a8efbbd758f6a9d46e1ce0d5fecbf82713`. Checkpoint 4A-1 added immutable generation plans, authorization, bounded jobs, retry, cancellation, and recovery. Checkpoint 4A-2 added exact persisted context packs, structured candidates, bounded repair, relational validation, and immutable provenance. Checkpoint 4A-3 added deterministic consolidation, exact-base stable-ID operations, dependency-safe proposal groups, local validation previews, explicit review, transactional selective application, ordinary passage-plan versions, and immutable audit history. No 4A-3 operation calls a provider.

#### Goal

Use AI to propose passage-plan work in small, resumable, inspectable units.

#### Work

1. Add generation-plan preview showing:
   - selected scope;
   - unit count;
   - model;
   - estimated input/output size;
   - estimated cost;
   - validation steps.
2. Generate by act, sequence, or selected route segment, normally 10-25 passage plans per unit.
3. Build request-specific context packs from approved dependencies and selected neighboring entities.
4. Require provider-supported structured output when available and validate locally in all cases.
5. Persist jobs and unit checkpoints.
6. Permit bounded repair of malformed output without an unbounded retry loop.
7. Convert generated output into normal proposal groups.
8. Validate and preview before application.
9. Resume incomplete jobs without repeating completed units.

#### Acceptance gate

- One sequence can be planned, interrupted, resumed, reviewed, and applied.
- No generation request sends the whole project by default.
- Generated IDs and references are deterministic or safely remapped.
- Failed units do not mutate project artifacts.
- No paid call occurs without explicit user action.

### Foundation 4B: passage drafting (formerly Production 2)

**Implementation status:** Complete, externally accepted, and acceptance-tested offline. Foundation 4 is closed at `1cf2b003375851a27999036e0935d54ff6a894a6`.

#### Goal

Draft prose in bounded batches while keeping passage specifications and accepted prose independently versioned.

#### Checkpoint 4B-1: draft architecture and lifecycle

**Implementation status:** Complete and externally accepted.

This checkpoint establishes the durable corpus and job architecture only. It does not generate prose.

1. Add passage-draft entities, immutable draft versions, and current heads.
2. Link each draft version to its exact `basedOnPassagePlanVersionId` and exact approved upstream dependency provenance.
3. Add explicit draft statuses and lifecycle transitions for candidate, accepted, reviewed, locked, and stale drafts.
4. Define deterministic staleness rules for passage-plan changes and required upstream-context changes.
5. Add bounded drafting plans, jobs, and units with unit/context budgets and diagnostics.
6. Define retry, cancellation, restart, and recovery behavior for interrupted drafting work.
7. Add word-count bookkeeping for the durable draft corpus.

**Recommended engineering model:** Sol High.

#### Checkpoint 4B-2: bounded prose generation

**Implementation status:** Complete, externally accepted, and acceptance-tested offline at `825d039f7b035d4c2e4f01c1cb591821d6abf0a6`.

1. Generate one passage or approximately 3-8 connected passages per unit.
2. Build bounded drafting context from:
   - exact passage specifications;
   - incoming/outgoing state requirements;
   - relevant story-bible records;
   - route and ending obligations;
   - nearby accepted prose;
   - style and prose guidance.
3. Bound provider input and output, and persist generated prose as immutable draft candidates.
4. Add a deterministic offline prose provider and a stubbed real-provider/OpenRouter HTTP boundary.
5. Add bounded retry and repair where appropriate, plus cancellation and recovery.
6. Never silently replace accepted prose with generated prose.

No live or paid provider calls are required for engineering or testing.

**Recommended engineering model:** Sol High or Terra High.

#### Checkpoint 4B-3: draft review and acceptance

**Implementation status:** Complete, externally accepted, and acceptance-tested offline at `1cf2b003375851a27999036e0935d54ff6a894a6`.

1. Add a readable prose-review interface.
2. Support individual passage acceptance and dependency-safe batch acceptance where appropriate.
3. Produce immutable accepted draft versions and support accepted-text locking.
4. Add draft history, comparison, and restore.
5. Show stale drafts and accepted, drafted, and remaining word counts, plus completion reporting.
6. Support explicit regeneration or replacement of unaccepted draft candidates.
7. Support drafting-specific scoped replacement only through explicit review.

Foundation 4B-3 does not include the generalized Foundation 6 revision workflow. Foundation 6 remains responsible for repairs generated from validation, simulation, playtesting, or narrative-review findings across passages, choices, mechanics, routes, endings, and other project artifacts.

**Recommended engineering model:** Sol High.

#### Implementation sequence

Implement the checkpoints sequentially: `4B-1 -> 4B-2 -> 4B-3`. Each checkpoint must be committed, pushed, verified in CI, externally reviewed, fixed if needed, and recorded at an accepted SHA before the next checkpoint begins.

Do not implement all of Foundation 4B in one commit.

#### Acceptance gate

- One complete act can be drafted and played.
- Accepted prose is never silently replaced.
- Regeneration of one passage does not rewrite unrelated passages.
- Drafted and remaining word counts reconcile against planning budgets.

### Foundation 5: simulation and narrative review (formerly Production 3)

#### Goal

Evaluate both the executable state model and the quality of the authored experience without mutating canonical authoring data.

#### Shared principles

1. Every simulation run, playtest run, and narrative review is tied to an exact immutable project, passage-plan, and accepted-draft snapshot. Results never silently drift to newer canonical state.
2. The same snapshot, seed or explicit path, and execution policy produce the same simulation result and reproducible path trace.
3. Seeded sampled playthroughs are replayable, bounded, and do not require enumeration of every possible route.
4. Findings retain exact evidence, snapshot provenance, and stable entity references.
5. Foundation 5 reads, analyzes, and reviews. It never directly mutates canonical passages, prose, choices, mechanics, routes, endings, or other authoring data.
6. Normal tests and CI remain completely offline. No live OpenRouter call is required for any Foundation 5 checkpoint acceptance gate.
7. The representative 300-passage project remains a required scale fixture.
8. Reuse the accepted stable-ID, immutable snapshot, version/provenance, job/unit/attempt lifecycle, provider-authorization, and bounded-context conventions.
9. Deterministic execution semantics must be reusable by Foundation 7's native player wherever architecture permits. Do not create a second incompatible validator-only mechanics interpretation.

#### Checkpoint 5A: deterministic simulation kernel

Build the provider-free deterministic execution foundation that later playtesting, narrative review, and the native runtime can trust.

1. Define an exact immutable simulation input snapshot over the approved project, passage plan, required upstream versions, and selected accepted draft versions.
2. Add deterministic initialization, start-passage entry, choice traversal, and normalized runtime/simulation failures.
3. Execute the canonical mechanics, stat, relationship, flag, resource, visit-count, choice-condition, and atomic choice-effect semantics.
4. Respect `sourceDecisionIds` and applicable route and ending requirements without inventing prose-derived state.
5. Resolve terminal passages, ending eligibility, and ending outcomes deterministically.
6. Support explicit deterministic test paths and reproducible path traces.
7. Record state, relationship, visit, and choice-history trajectories plus route and ending coverage.
8. Persist simulation inputs, results, and findings where useful for exact reopen and inspection; every finding references its immutable snapshot and exact entity IDs.
9. Add sufficient local inspection/debug UI to exercise a path, inspect transitions and trajectories, and navigate normalized failures.
10. Prove the kernel against fixed path vectors and the 300-passage offline fixture.

5A contains no AI narrative review, repair proposals, or Foundation 6 work.

**Recommended engineering model:** Sol High, because deterministic execution semantics and future runtime compatibility are high-risk architectural work.

#### Checkpoint 5B: seeded playtesting and experience analysis

Use the accepted 5A kernel to exercise the game at scale and produce human-reviewable structural and playtest evidence.

1. Add seeded sampled playthroughs with recorded seeds, policies, bounded path/sample counts, deterministic replay, and normalized hard-failure reporting.
2. Accumulate route, ending, passage, and choice coverage plus visit frequencies without requiring exhaustive route enumeration.
3. Summarize stat and relationship trajectories and whether important mechanic changes have visible downstream consequences.
4. Run continuity and knowledge-state checks against the exact simulated path.
5. Report pacing, choice density, route-exclusive content, and representative/minimum/maximum path behavior where useful.
6. Link every playtest finding to the exact simulation snapshot, run, seed/path, evidence, and relevant passages, choices, mechanics, routes, and endings.
7. Keep playtest run records durable or exactly reproducible, with review, filtering, replay, and stable-ID navigation UI.
8. Define and enforce a bounded sampling policy, including the 300-passage representative fixture and fixed-seed regressions.

5B findings are evidence only. They do not mutate passages, prose, choices, mechanics, routes, or endings, and they do not create Foundation 6 repair operations.

**Recommended engineering model:** Sol High or Terra High.

#### Checkpoint 5C: bounded AI narrative review

Add optional AI-assisted qualitative review over exact, bounded evidence from the accepted project and deterministic simulation/playtest results.

1. Add review-plan preview and authorization against an exact immutable review input snapshot.
2. Divide review into bounded units with exact context packs for selected passages or route sections rather than sending the whole project by default.
3. Include only relevant accepted prose, passage specifications, route/ending/mechanics obligations, simulation traces/findings, and continuity/state evidence.
4. Persist provider/model identity, plans, jobs, units, attempts, authorization, cancellation, retry, and restart recovery using the accepted lifecycle conventions.
5. Provide a deterministic offline review provider and a stubbed OpenRouter boundary; no live or paid request is needed for engineering or acceptance.
6. Require strict structured findings, local validation, bounded structural repair of malformed provider output, and immutable review provenance.
7. Link every finding to exact evidence and stable entity IDs, and expose readable review/filter/navigation UI.
8. Support qualitative categories such as pacing, repetition, weak or unclear choices, abrupt transitions, character consistency, emotional continuity, route differentiation, setup/payoff quality, ending buildup, and prose continuity around branching or reconvergence.

AI output in 5C is findings only. It cannot rewrite prose or project data, regenerate passages, or create generalized repair operations.

**Recommended engineering model:** Sol High or Terra High.

#### Foundation 5 / Foundation 6 boundary

Foundation 5 answers: **“What is happening in the authored experience, and what appears wrong or worth reviewing?”** It may create simulation evidence, playtest runs, deterministic findings, and AI narrative-review findings.

Foundation 6 answers: **“What exact changes should be proposed to repair an accepted finding?”** It consumes selected Foundation 5 findings and uses the existing versioning, proposal, review, and transactional application architecture to produce bounded repairs.

Foundation 5 must not rewrite prose, regenerate passages, mutate choices or mechanics, change routes or endings, automatically apply fixes, or create generalized repair operations.

#### Implementation sequence

Implement the checkpoints sequentially:

`5A -> commit/push/CI -> external review -> fixes if needed -> accepted SHA`

then `5B -> commit/push/CI -> external review -> fixes if needed -> accepted SHA`

then `5C -> commit/push/CI -> external review -> fixes if needed -> accepted SHA`.

Do not begin a checkpoint until the previous checkpoint has an externally accepted SHA. Foundation 5 is closed only after 5C passes external review. Do not implement all of Foundation 5 in one checkpoint.

#### Acceptance gate

- Major intended routes have reproducible deterministic test paths.
- Seeded sampled playthroughs are replayable from their exact snapshot, seed/path, and policy.
- Sampled paths do not expose unresolved hard runtime failures.
- Important stats and relationships show observable consequences in recorded trajectories.
- Route and ending coverage are reportable.
- Pacing, choice-density, and route-exclusive-content analysis is inspectable.
- Findings are linked to the exact snapshot, evidence, and entity IDs reviewed.
- Optional AI narrative review produces bounded, locally validated findings only.
- No Foundation 5 action silently rewrites canonical project content.
- No live provider is required for acceptance.

### Foundation 6: revision workflow

#### Goal

Turn selected validation, simulation, playtest, and narrative-review findings into bounded reviewable repairs without regenerating unrelated work. Foundation 6, not Foundation 5, owns repair proposal creation and application.

#### Shared principles

1. Findings are immutable evidence, not commands. No repair occurs without explicit human selection and review.
2. Repair scope is explicit and stable-ID based. Finding evidence and authorized mutation targets are separate: a finding may cite many entities while authorizing a change to only one.
3. Every proposed mutation carries an exact expected base. Proposals never mean "edit whatever is current" and never silently rebase.
4. Provider output is always a bounded candidate or proposal, never direct canonical mutation.
5. Selected dependency-complete groups apply transactionally; unrelated canonical content remains untouched.
6. Accepted and locked prose remains protected by the Foundation 4B lifecycle, acceptance, history, and restore rules.
7. Repair evidence, proposal provenance, applications, and resulting verification remain immutable and inspectable.
8. Foundation 5 evidence remains immutable historical evidence even when later content makes it stale or supersedes it.
9. Reuse the accepted Foundation 1 and 4A-3 stable-ID operation, proposal grouping, preview, dependency, transactional application, and audit architecture rather than creating a second mutation language.
10. Normal verification remains offline. No live OpenRouter call is required for Foundation 6 acceptance.

#### Checkpoint 6A: Repair architecture and finding intake

**Purpose:** Establish the durable, deterministic repair domain before any model can generate repair content. This checkpoint answers: **"What exact finding are we attempting to repair, against what immutable state, with what authorized scope and dependency impact?"** It is primarily provider-free.

1. Define a typed repair-finding reference union over the accepted sources rather than flattening findings into an untyped payload:
   - Foundation 3 static validation findings, retaining stable code, severity, entity references, evidence, override state, and the exact validation snapshot/version;
   - Foundation 5A runtime/simulation findings, retaining finding ID/code, simulation-input artifact version and fingerprint, runtime fingerprint, run version, step, passage, choice, mechanic, and ending evidence;
   - Foundation 5B playtest findings, retaining finding ID/fingerprint, campaign artifact version, simulation-input lineage, seed/policy, sample ID/index, trace fingerprint, evidence level, and stable entity IDs;
   - Foundation 5C narrative-review findings, retaining finding ID/fingerprint, review input/plan/job/unit/attempt lineage, context fingerprint, evidence references, accepted-draft versions, and passage, choice, route, ending, mechanic, fact, and thread IDs.
2. Reject unknown finding kinds, cross-project references, corrupted fingerprints or lineage, mismatched artifact versions, and evidence that cannot resolve against its exact immutable source. Preserve stale evidence as history, but surface it explicitly and reject it as a current repair base.
3. Keep human selection repair-plan-local. A repair plan records explicitly selected findings; Foundation 6A does not create a generic issue tracker or mutate source findings. Resolution/disposition evidence is recorded by 6C against the immutable source reference.
4. Define repair intent/category, eligibility, lifecycle, and an explicit mutation allowlist over stable targets such as passage-plan passages, choices, narrative threads, accepted passage prose, mechanics, relationships, route sections/entities, endings, and relevant approved planning-artifact sections/entities.
5. Capture exact expected bases for every allowed target. Use immutable per-entity version IDs where available; for whole-artifact planning records, use the exact artifact version plus deterministic section/entity content fingerprint where needed.
6. Calculate a deterministic impact graph before generation. Classify directly affected entities, deterministically discoverable possible dependents, and historical evidence that would become stale. Do not claim semantic impact that cannot be derived from references, version lineage, or accepted staleness rules.
7. Include known dependency paths such as passage structure to choices, neighbors, drafts, simulation inputs, campaigns, and reviews; mechanics to conditions, effects, runtime paths, and endings; routes to passages, decisions, and ending eligibility; and accepted prose to drafts that used it as neighbor context.
8. Add a provider-free repair-plan preview showing selected findings and source evidence, exact immutable bases, authorized mutation targets, affected dependencies, expected staleness, repair category, context/evidence availability, whether 6B AI assistance would be required, and a deterministic plan fingerprint.
9. Preview performs zero provider calls and zero canonical mutation. It produces no replacement prose, edit operations, mechanic/route/ending changes, or proposal groups.
10. Keep the legacy `proposeNarrativeRepair` helper isolated from this contract. Its shallow legacy output is not accepted Foundation 6 intake, provenance, scope, or authorization.

**Acceptance gate:** A finding from every supported source resolves to exact immutable evidence; corrupted, mismatched, or cross-project evidence is rejected; stale input is visible and rejected from generation while its historical evidence remains inspectable; exact bases and authorized mutation scope are inspectable; dependency impact is deterministic; preview is provider-free; and no canonical content changes.

**Recommended engineering model:** Sol High, because repair-base, provenance, staleness, and dependency semantics form a high-risk architecture boundary.

#### Checkpoint 6B: Bounded repair proposal generation

**Purpose:** Turn one exact authorized 6A repair input into bounded, validated, stable-ID repair proposals. This checkpoint answers: **"What exact changes are proposed to repair this selected finding?"** It does not apply them.

1. Reuse and deliberately extend the accepted stable-ID proposal operation types, expected bases, proposal groups, group dependencies, validation previews, and immutable provenance. Do not introduce whole-project replacement artifacts or an incompatible mutation language.
2. Support narrowly authorized structural or deterministic repairs to passage properties, choices, thread references, mechanics, relationships/facts, route or ending metadata, plus prose repairs limited to exact selected passage-draft candidates.
3. Preserve accepted prose unless its exact passage is authorized. Generated prose remains a Foundation 4B draft candidate and cannot silently replace an accepted or locked head.
4. Keep provider-free plan/proposal preview separate from execution. Manual and deterministic repairs need no provider. AI-assisted work follows `Preview -> Save -> Authorize exact fingerprint -> explicit Start -> bounded provider work -> strict structured candidate -> local validation`.
5. Bound context to selected finding evidence, authorized targets and bases, relevant neighbors and accepted prose, upstream obligations, and relevant simulation, playtest, or 5C evidence. Do not send the whole project by default; evidence remains untrusted quoted data.
6. Require strict versioned output. Every operation identifies its stable target and entity type, exact expected base version/fingerprint, operation kind, bounded payload, finding/source lineage, repair-plan lineage, and dependency group.
7. Reject invented or cross-project IDs, out-of-scope targets, wrong bases, unrelated operations, unsupported operation kinds, and whole-project replacements before persistence as a proposal.
8. Split proposals into coherent independently reviewable groups, such as one prose repair, one mechanic plus directly dependent choices, one route segment, or one ending plus exact buildup references. Dependencies are explicit so one safe group can be selected without unrelated groups.
9. Define backend hard ceilings for targets, serialized context, output, operations, groups, attempts, and at most one structural-output repair. A single finding must not become an unbounded generation job.
10. Use deterministic offline providers and stubbed OpenRouter boundaries for tests. Proposal generation mutates no canonical authoring state, and proposals are immutable and reopenable.

**Acceptance gate:** A selected exact finding produces a bounded proposal over exact stable IDs and bases; unrelated entities are absent; provider-free preview works; AI execution requires exact authorization; malformed output cannot become a proposal; prose remains reviewable through 4B; and canonical state is unchanged.

**Recommended engineering model:** Sol High or Terra High.

#### Checkpoint 6C: Review, application, and targeted revalidation

**Implementation status:** Complete on `checkpoint/foundation-6c-repair-application`; external acceptance is pending.

**Purpose:** Review exact repair proposals, apply selected dependency-safe groups transactionally, then prove the repaired state with targeted deterministic verification. This checkpoint answers: **"Should these exact repairs be applied, and what became stale or newly valid after application?"**

1. Provide readable group review showing source finding and rationale, exact stable IDs and bases, before/after values, prose diffs where relevant, dependencies, expected invalidation/staleness, validation preview, and deterministically known simulation impact. Raw JSON is not the primary review interface.
2. Before Apply, revalidate finding/evidence identity, exact entity and whole-artifact bases, accepted prose heads and locks, approved upstream dependencies, proposal-group dependencies, and expected impact. If anything relevant changed, mark the proposal stale and require refresh or regeneration; never silently rebase.
3. Apply selected dependency-complete groups through the existing service/proposal architecture in one transaction. If any precondition, operation, validation, or audit write fails, roll back the entire selected application.
4. Preserve ordinary immutable versions, history, comparison, restore, audit lineage, project ownership, and accepted-prose locking. Prose repairs create or reference normal draft candidates; explicit 4B review/acceptance remains required, and locked prose requires explicit unlock before replacement.
5. Determine affected deterministic checks after application and rerun only relevant Foundation 3 validation, Foundation 5A paths, and Foundation 5B campaigns or selected coverage checks where invalidated. Complete the repair batch with the milestone-level offline verification gate.
6. Do not automatically invoke 5C AI narrative review. A new qualitative review remains separate explicit provider-authorized work.
7. Link resulting validation evidence to the repair application and classify the source finding as resolved, still present, superseded, invalidated by changed base, or requiring re-review. Applying an edit alone never proves a finding fixed; qualitative 5C findings normally become `repair applied -> requires re-review or author acknowledgement` unless deterministic evidence proves resolution.
8. Keep restored and superseded repair, simulation, campaign, and review evidence as immutable historical records. Restoring pre-repair content may make later evidence stale again but never deletes it.

**Acceptance gate:** Exact proposals are readable; stale proposals cannot overwrite newer state; selected groups apply atomically; one passage, route section, mechanic, or ending repair leaves unrelated content untouched; applied changes remain versioned, comparable, and restorable; locked prose cannot be bypassed; affected deterministic checks can rerun without regenerating unaffected evidence; and canonical state remains recoverable.

**Recommended engineering model:** Sol High.

#### Foundation 6 / Foundation 7 boundary

Foundation 6 owns `finding -> repair intent -> repair proposal -> review -> application -> targeted verification`.

Foundation 7 owns `approved project -> compiled native game -> browser player -> save/runtime UX -> portable and publishing exports`.

Foundation 6 does not implement the native player, save files, rewind, native static builds, standalone HTML, Twee export, or publishing/export compatibility.

#### Implementation sequence

Implement the checkpoints sequentially:

`6A -> commit/push/CI -> external review -> fixes if needed -> accepted SHA`

then `6B`, through the same commit/push/CI/review/fix/accepted-SHA gate,

then `6C`, through the same gate.

Do not begin a checkpoint until the previous checkpoint has an externally accepted SHA. Do not implement all of Foundation 6 in one checkpoint. Foundation 6 closes only after 6C passes external review.

#### Acceptance gate

- Findings from every supported accepted source resolve through typed immutable provenance.
- A selected finding can produce a reviewable repair proposal linked to its exact evidence, snapshot/input, and authorized mutation scope.
- Repairing one passage, route section, mechanic, or ending does not rewrite unrelated content.
- Stale repair proposals cannot overwrite newer entity or artifact versions.
- Selected dependency-safe groups apply atomically and preserve Foundation 4B prose locks.
- Applied repairs remain versioned, comparable, restorable, and linked to targeted verification evidence.
- Unaffected evidence is not needlessly regenerated, and qualitative findings are not declared resolved merely because an edit was applied.

### Foundation 7: native player and publishing exports (formerly Production 4)

#### Goal

Play and distribute the project without depending on Twine, ChoiceScript, or a hosted service.

#### Work

1. Compile an approved project snapshot into a deterministic native game bundle.
2. Implement a pure TypeScript state engine shared by preview, tests, and the player.
3. Build a responsive, accessible browser player.
4. Add autosave, manual save slots, restart, and configurable rewind.
5. Add player-facing stat and relationship presentation.
6. Add debug play mode with current state and route information.
7. Export:
   - canonical portable project bundle;
   - readable Markdown;
   - native static web build;
   - standalone offline HTML;
   - Twee 3 targeting SugarCube.
8. Add export/import round-trip verification for the canonical bundle.
9. Treat Ink as a later adapter if demanded by a concrete integration.

#### Acceptance gate

- The same deterministic engine runs preview and exported native builds.
- A native static build works without the authoring server.
- Save data detects incompatible game builds and fails clearly.
- Canonical project export round-trips without content loss.
- Twee export compiles and passes representative route tests.

### Foundation 8: scale, recovery, and authoring polish (formerly Production 5)

#### Goal

Make long sessions and large projects comfortable and recoverable.

#### Work

1. Add backup reminders and verified restore.
2. Add project health and storage diagnostics.
3. Add keyboard navigation, accessibility review, and responsive polish.
4. Add large-list virtualization where measured performance requires it.
5. Add conversation summarization and pinned decision management.
6. Add usage and cost reporting by project, stage, job, and model.
7. Add schema migrations and compatibility tests for portable bundles and saves.
8. Add performance budgets and large-fixture regression tests.

#### Acceptance gate

- The representative large fixture opens, searches, edits, validates, plays, exports, and restores within documented performance budgets.
- No authoring or publishing path depends on provider availability.

## Verification strategy

### During a task

- Run the smallest relevant schema, repository, route, or component tests.
- Use fake providers for assistant and generation behavior.
- Add a regression test for every concrete failure discovered.

### At each milestone boundary

Run one complete offline pass:

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Then perform one focused review of:

- data loss and migration risk;
- stale-version overwrite risk;
- unbounded provider work;
- unintended context/privacy exposure;
- inaccessible or unusable large-workflow UI;
- divergence between validator, preview, and exported runtime.

Avoid repeated review/fix loops unless a concrete failure requires another pass.

## Live-provider policy

No milestone requires a live OpenRouter call to pass.

When a live smoke test becomes useful:

1. Finish offline verification first.
2. State the exact request, model, context scope, output limit, and maximum spend.
3. Ask for explicit approval.
4. Perform one bounded call.
5. Record usage and result without persisting raw provider reasoning.

## External technical basis

- OpenAI model-selection guidance for Sol, Terra, Luna, and reasoning levels: <https://developers.openai.com/api/docs/guides/latest-model>
- Ordered patch operations and preconditions: <https://www.rfc-editor.org/info/rfc6902/>
- JSON Pointer semantics: <https://www.rfc-editor.org/info/rfc6901/>
- SQLite transactions: <https://www.sqlite.org/lang_transaction.html>
- OpenRouter structured outputs: <https://openrouter.ai/docs/guides/features/structured-outputs>
- OpenRouter reasoning behavior: <https://openrouter.ai/docs/guides/best-practices/reasoning-tokens>
- Hierarchical long-form generation: <https://arxiv.org/abs/2210.06774>
- Dynamic hierarchical outlining and memory: <https://arxiv.org/abs/2412.13575>
- Twee source format: <https://www.twinery.org/cookbook/terms/terms_twee.html>
- Ink language/runtime: <https://github.com/inkle/ink>
- Hosted Games AI policy: <https://www.choiceofgames.com/make-your-own-games/we-dont-use-ai/>

## Explicit non-goals

- One autonomous request that generates a finished 150,000-200,000-word game.
- Cloud collaboration or multiplayer editing.
- Treating chat history or provider reasoning as canonical memory.
- Making Twine, Ink, or ChoiceScript the internal source of truth.
- Supporting arbitrary round-trip import of hand-written SugarCube macros in the first export milestone.
- Publishing through Hosted Games under its current AI policy.
