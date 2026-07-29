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

The next objective is to turn that planning prototype into a safe production workspace for a configurable 150,000-200,000-word interactive novel with hundreds of passages.

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

### Production 1: bounded AI passage planning

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

### Production 2: passage drafting

#### Goal

Draft prose in bounded batches while keeping passage specifications and accepted prose independently versioned.

#### Work

1. Add passage-draft versions linked to exact passage-plan versions.
2. Generate one scene or approximately 3-8 connected passages per unit.
3. Build drafting context from:
   - exact passage specifications;
   - incoming/outgoing state requirements;
   - relevant bible records;
   - nearby accepted prose;
   - style guidance;
   - route and ending obligations.
4. Add individual and batch acceptance.
5. Add accepted-text locking.
6. Mark drafts stale when their passage plan or required upstream context changes.
7. Add prose word-count and completion reporting.
8. Add scoped revision proposals rather than complete-corpus rewrites.

#### Acceptance gate

- One complete act can be drafted and played.
- Accepted prose is never silently replaced.
- Regeneration of one passage does not rewrite unrelated passages.
- Drafted and remaining word counts reconcile against planning budgets.

### Production 3: simulation and narrative review

#### Goal

Evaluate both the executable state model and the quality of the authored experience.

#### Work

1. Add deterministic test paths.
2. Add seeded sampled playthroughs.
3. Record state and relationship trajectories.
4. Report ending eligibility and route coverage.
5. Add continuity and knowledge-state checks.
6. Add playtest findings linked to passages and snapshots.
7. Add pacing, choice-density, and route-exclusive-content reports.
8. Add AI narrative-review jobs that produce findings and proposals, never automatic rewrites.

#### Acceptance gate

- Major intended routes have reproducible test paths.
- Sampled paths do not expose hard runtime failures.
- Important stats and relationships display observable consequences.
- Findings are traceable to the snapshot and entities reviewed.

### Production 4: native player and publishing exports

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

### Production 5: scale, recovery, and authoring polish

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
