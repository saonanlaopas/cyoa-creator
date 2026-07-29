# Passage plan and native runtime design

## Purpose

Define the canonical data, versioning, proposal, validation, authoring, and runtime model for a long-form interactive novel containing hundreds of passages and approximately 150,000-200,000 total words.

This specification extends the completed brief, bible, route, ending, mechanics, chat, versioning, and approval features. It does not replace those artifacts.

## Design goals

1. Plan the whole branching work before bulk prose generation.
2. Keep stable references while acts, sequences, and passages are reordered.
3. Make stats and relationships executable rather than descriptive decoration.
4. Support frequent scoped chat without transmitting or replacing the entire project.
5. Make large proposals reviewable and partially applicable only when safe.
6. Version passages independently while preserving immutable project-wide snapshots.
7. Use the same state semantics in validation, preview, simulation, and exported native builds.
8. Remain playable and exportable without an AI provider or authoring server.
9. Preserve compatibility paths through canonical JSON, Markdown, and Twee 3/SugarCube.

## Architectural boundary

The system has four distinct layers:

```text
Planning artifacts
  Brief, bible, routes, endings, mechanics
                  |
                  v
Executable passage plan
  Acts, sequences, passages, choices, conditions, effects
                  |
                  v
Draft corpus
  Versioned prose attached to passage-plan versions
                  |
                  v
Compiled game build
  Immutable data consumed by preview, simulation, and native player
```

Chat and AI jobs interact through proposals. They do not bypass these layers.

## Canonical identity rules

- Every durable entity has an opaque stable ID.
- IDs are never derived from names, display order, array position, or generated prose.
- Renaming or reordering does not change an ID.
- Deleting an entity creates a recoverable version/tombstone and requires reference validation.
- External exports may add format-specific names, but retain the canonical ID in metadata where possible.
- References always target canonical IDs.
- Human-readable labels are presentation, not identity.

Recommended ID prefixes improve diagnostics but carry no semantics:

```text
act-
seq-
passage-
choice-
thread-
condition-
effect-
```

## Structural hierarchy

### Project

The project defines:

- Configurable total word target
- Typical playthrough target
- Start passage
- Ordered acts
- Routes and endings from approved upstream artifacts
- Build and schema versions

### Act

An act is the largest passage-planning budget and pacing unit.

```ts
interface ActPlan {
  id: string;
  label: string;
  purpose: string;
  summary: string;
  wordTarget: number;
  routeIds: string[];
  sequenceIds: string[];
  position: number;
}
```

`routeIds` is empty when the act is shared across the project. An act may serve multiple routes.

### Sequence

A sequence is the normal AI planning and drafting unit. It represents a scene, encounter, investigation segment, or other coherent group of passages.

```ts
interface SequencePlan {
  id: string;
  actId: string;
  label: string;
  purpose: string;
  summary: string;
  wordTarget: number;
  routeIds: string[];
  passageIds: string[];
  entryGoals: string[];
  exitGoals: string[];
  requiredDecisionIds: string[];
  endingHookIds: string[];
  position: number;
  planningStatus: "outline" | "planned" | "reviewed" | "locked";
}
```

The intended generation unit is normally one sequence or 10-25 passage plans, whichever is smaller.

For all structural entities, an empty `routeIds` array means shared across all routes. A nonempty array restricts the entity to the listed routes. Drafting progress is derived from linked draft versions rather than duplicated in the sequence record.

### Passage plan

A passage plan describes what must happen. It does not contain the authoritative prose draft.

```ts
interface PassagePlan {
  id: string;
  sequenceId: string;
  title: string;
  kind: "scene" | "transition" | "hub" | "climax" | "epilogue";
  purpose: string;
  summary: string;
  wordTarget: number;
  routeIds: string[];
  tags: string[];

  characterIds: string[];
  relationshipIds: string[];
  locationIds: string[];

  requiredFactIds: string[];
  revealedFactIds: string[];
  setupThreadIds: string[];
  payoffThreadIds: string[];
  preservedDifferenceIds: string[];

  choiceIds: string[];
  terminal: boolean;
  endingId: string | null;

  draftingNotes: string[];
  unresolvedQuestions: string[];
  planningStatus: "outline" | "planned" | "reviewed" | "locked";
}
```

Rules:

- Exactly one current start passage exists for a compilable plan.
- A nonterminal passage has at least one choice.
- A terminal passage has no outgoing choices.
- A passage linked to an ending is terminal.
- An empty `routeIds` array means shared across all routes. A nonempty array restricts the passage to exactly those routes.
- Word targets may be zero only for intentionally non-prose utility nodes, which are excluded from reader builds unless compiled into another passage.
- Drafting status and word count are derived from linked passage-draft heads rather than duplicated in the passage plan.

### Choice

Choices are independent entities so they can be scoped, versioned, reordered, analyzed, and changed without replacing an entire passage.

```ts
interface ChoicePlan {
  id: string;
  sourcePassageId: string;
  label: string;
  destinationPassageId: string;
  narrativeIntent: string;
  consequencePreview: string;
  condition: ConditionExpression | null;
  unavailableBehavior: "hidden" | "disabled";
  unavailableExplanation: string;
  effects: StateEffect[];
  sourceDecisionIds: string[];
  position: number;
}
```

Default behavior:

- Important choices remain visible but disabled when an unavailable explanation is narratively useful.
- Secret, discovery, or spoiler-sensitive choices may be hidden.
- A gate should have a fallback path unless the passage intentionally terminates.
- Consequence previews may be exact, thematic, or omitted according to project settings.

## State model

### Mechanic registry

The approved mechanics artifact defines the registry for:

- Numeric visible stats
- Numeric relationships
- Boolean flags
- Numeric counters/currency
- Inventory-like resources

Every executable condition/effect references a registry key. Display labels may change without changing the key.

### Condition expression

Conditions use a typed expression tree rather than free-form strings:

```ts
type ConditionExpression =
  | { kind: "all"; items: ConditionExpression[] }
  | { kind: "any"; items: ConditionExpression[] }
  | { kind: "not"; item: ConditionExpression }
  | {
      kind: "compare";
      mechanicKey: string;
      operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
      value: number | boolean | string;
    }
  | {
      kind: "visit-count";
      passageId: string;
      operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
      value: number;
    };
```

Constraints:

- `all` and `any` contain at least one child.
- Nesting depth is bounded.
- Comparator and value types must match the referenced mechanic type.
- Passage references must exist.
- Runtime conditions cannot contain arbitrary JavaScript or provider-generated code.

### State effects

Effects use typed operations:

```ts
interface StateEffect {
  id: string;
  mechanicKey: string;
  operation: "set" | "add" | "subtract" | "clear";
  value: number | boolean | string | null;
  feedback: string;
  visibility: "visible" | "hidden";
}
```

Validation constrains operations by mechanic kind:

- Numeric values allow `set`, `add`, and `subtract`.
- Boolean flags allow `set` and `clear`.
- Inventory resources use validated `set`/quantity changes in schema version 1; richer item operations may be introduced in a later schema version.
- Values respect declared bounds unless the mechanic explicitly permits overflow.

Choice effects apply atomically before entering the destination passage. The player sees any configured feedback after the choice and before or with the destination prose according to player settings.

### Runtime state

```ts
interface GameState {
  gameBuildId: string;
  currentPassageId: string;
  values: Record<string, number | boolean | string>;
  visitCounts: Record<string, number>;
  choiceHistory: Array<{
    choiceId: string;
    sourcePassageId: string;
    destinationPassageId: string;
    selectedAtTurn: number;
  }>;
  turn: number;
}
```

The runtime does not infer state from prose. All executable state changes are explicit effects.

## Narrative continuity model

Executable state and narrative continuity are related but separate.

### Facts

`requiredFactIds` and `revealedFactIds` refer to stable bible fact IDs or later project fact records.

- A required fact means the viewpoint/protagonist must know it before the passage.
- A revealed fact becomes known after the passage.
- Conservative static analysis reports a warning when a fact may be required before any reachable revelation.
- If knowledge must directly gate a choice, it also receives an executable flag or other mechanic.

### Narrative threads

```ts
interface NarrativeThread {
  id: string;
  label: string;
  description: string;
  setupPassageIds: string[];
  payoffPassageIds: string[];
  routeIds: string[];
  required: boolean;
  status: "planned" | "partially-covered" | "covered" | "waived";
  waiverRationale: string;
}
```

Threads support foreshadowing, mysteries, promises, relationship beats, and thematic setups. They are not automatically runtime mechanics.

### Preserved differences

A reconvergence may merge passage flow while preserving prior consequences. Each declared preserved difference must have at least one later:

- state read;
- prose variant obligation;
- route/ending contribution; or
- explicit waiver.

This prevents reconvergence from erasing choices merely because paths share a destination.

## Draft model

Prose is stored separately from the passage plan:

```ts
interface PassageDraft {
  passageId: string;
  basedOnPassagePlanVersionId: string;
  proseMarkdown: string;
  wordCount: number;
  status: "candidate" | "accepted" | "reviewed" | "locked" | "stale";
  generationJobId: string | null;
  authorNote: string;
}
```

Rules:

- Editing a passage plan does not overwrite prose.
- If a plan change affects purpose, required facts, characters, choices, terminal state, or word target materially, the current draft becomes stale.
- Cosmetic plan metadata changes need not stale prose.
- Accepted and locked prose remains recoverable through history.
- The compiled reader build selects one draft version for every included passage.
- A project can be structurally complete while prose remains incomplete.

## Text and encoding

- Canonical text is Unicode encoded as UTF-8.
- JSON, Markdown, Twee, and HTML exports declare UTF-8 explicitly.
- HTTP text responses include `charset=utf-8`.
- Draft prose uses a documented CommonMark-compatible Markdown subset.
- Arbitrary scripts and unsanitized HTML are not allowed in canonical prose.
- The compiler converts prose into a safe intermediate representation used by the native player and export adapters.
- Import never attempts broad character-replacement heuristics on already-valid Unicode.
- Regression fixtures include smart quotes, em/en dashes, `Fanawë Eterúna`, and non-Latin scripts so encoding failures are caught before release.

## Persistence and versioning

### Why planning artifacts and passage entities differ

Brief, bible, routes, endings, and mechanics are relatively small, infrequently changed documents. Whole-artifact immutable versions remain appropriate for them.

Hundreds of passage plans and a 150,000-200,000-word draft corpus require finer granularity. Copying the entire corpus for every small edit would inflate storage, comparisons, proposal payloads, and provider context.

### Entity-version pattern

Recommended conceptual tables:

```text
story_structure_versions
passage_plan_versions
passage_plan_heads
choice_plan_versions
choice_plan_heads
narrative_thread_versions
narrative_thread_heads
passage_draft_versions
passage_draft_heads
passage_plan_snapshots
passage_plan_snapshot_items
```

Each version record is immutable. A head identifies the current draft version for one stable entity.

An immutable `passage_plan_snapshot` records:

- Structure version
- Passage-plan version IDs
- Choice version IDs
- Narrative-thread version IDs
- Approved upstream artifact version IDs
- Validation report ID
- Creation metadata

Approval references a snapshot, not mutable heads.

Draft compilation similarly records exact selected draft versions.

### Transactions

The following operations are transactional:

- Applying one selected proposal group
- Applying multiple dependency-linked groups
- Reordering a structure and updating its affected ownership references
- Creating an immutable snapshot
- Approving a snapshot
- Restoring a snapshot into new current heads

SQLite remains appropriate for a personal local application. The service layer owns transactions; route handlers do not assemble multi-step writes themselves.

## Scope and context packs

### Scope

The long-form scope model expands to:

```ts
type AssistantScope =
  | { kind: "project"; projectId: string }
  | { kind: "artifact"; projectId: string; artifactId: string; versionId: string; sectionId?: string }
  | {
      kind: "entity";
      projectId: string;
      stage: "passage-plan" | "drafts" | "review";
      entityType: "act" | "sequence" | "passage" | "choice" | "thread" | "draft";
      entityId: string;
      versionId: string;
    };
```

The scope bar always shows a readable label plus IDs/version on demand. Scope changes are explicit and persisted with each message.

### Context-pack builder

A request receives the smallest sufficient context pack:

1. Trusted stage and intent instructions
2. Current scope and base versions
3. Selected entity/section
4. Direct parents and children
5. Referenced routes, endings, mechanics, characters, relationships, locations, facts, and threads
6. A limited local graph neighborhood
7. Relevant approved prose excerpts when drafting
8. Recent scoped messages
9. Rolling conversation summary
10. Pinned project decisions
11. User request
12. Strict response schema

It does not include all artifacts or the full transcript by default.

The context-pack builder produces diagnostics before a provider call:

- included records;
- excluded record counts;
- estimated input tokens;
- selected model capability requirements;
- expected output schema;
- maximum output tokens.

## Change proposal model

### Domain operations

The model proposes domain operations rather than complete replacement documents:

```ts
type ProposalOperation =
  | { kind: "add-entity"; entityType: string; entity: unknown }
  | {
      kind: "update-entity";
      entityType: string;
      entityId: string;
      baseVersionId: string;
      changes: Record<string, unknown>;
    }
  | {
      kind: "remove-entity";
      entityType: string;
      entityId: string;
      baseVersionId: string;
    }
  | {
      kind: "reorder-children";
      parentType: string;
      parentId: string;
      orderedChildIds: string[];
      baseVersionId: string;
    };
```

Actual schemas are discriminated, field-specific, and bounded. `unknown` above only abbreviates this design example.

Operations never accept arbitrary executable code.

### Proposal groups

```ts
interface ProposalGroup {
  id: string;
  label: string;
  summary: string;
  operationIds: string[];
  dependsOnGroupIds: string[];
  affectedEntityIds: string[];
  downstreamInvalidations: string[];
  validationFindingIds: string[];
  safeToApplyIndependently: boolean;
}
```

Review supports:

- Overall impact
- Group summaries
- Before/after field comparison
- Validation findings
- Representative prose or plan samples
- Full operation detail on demand

The default action selects only groups that are independently safe. The user may accept one group, several dependency-complete groups, or all safe groups.

### Application

1. Load current versions.
2. Check every base/precondition.
3. Materialize proposed results in memory.
4. Run schema and cross-project validation.
5. Calculate downstream staleness.
6. Present any changed impact if the proposal has not already been reviewed against it.
7. Apply selected groups in one transaction.
8. Create immutable versions and audit summary.
9. Mark affected downstream artifacts/entities stale.

## Validation

### Hard errors

Hard errors block application, snapshot creation, approval, or compilation as appropriate:

- Duplicate stable IDs
- Missing entity references
- Cross-project references
- Invalid mechanic condition/effect types
- Missing start passage
- Invalid terminal/outgoing-choice combination
- Nonterminal passage without choices
- Missing choice destination
- Ending passage linked to an unknown ending
- Structure ownership cycle
- Proposal base-version mismatch
- Compiled build without a selected draft for a required passage

### Warnings

Warnings require attention but may be acknowledged:

- Unreachable passage under conservative analysis
- Apparently impossible gate
- Mechanic with weak or one-sided influence
- Relationship with no meaningful downstream read
- Setup without payoff
- Payoff without setup
- Fact possibly used before revelation
- Excessive route reconvergence
- Dominant or redundant choice
- Sequence far outside its word budget
- Typical path outside the configured target
- Ending reached by too many or too few plausible states
- Draft significantly diverging from its passage purpose

Every warning has:

- Stable code
- Severity
- Entity references
- Human-readable explanation
- Evidence
- Suggested resolution
- Optional acknowledgment and rationale
- Snapshot/version against which it was computed

### Graph and path analysis

The validator computes:

- Reachability from the start passage
- Reverse reachability to endings
- Strongly connected components and cycle exits
- Minimum and maximum simple-path estimates where tractable
- Representative bounded paths for cyclic graphs
- Per-route and per-ending coverage
- Planned word counts over representative paths

State-space analysis is conservative. It may prove some paths impossible, but complex numeric state and loops can make complete proof impractical. The UI must label heuristic conclusions honestly.

## Authoring interface

### Primary view

The primary passage-plan UI is an outline/table:

```text
Act
  Sequence
    Passage
      Choice -> Passage
```

Columns and badges include:

- Planned/drafted word counts
- Route ownership
- Status
- Choice count
- Characters
- Mechanics affected/checked
- Ending contribution
- Validation severity
- Stale state

The list supports:

- Collapse/expand
- Search
- Filters
- Keyboard navigation
- Multi-select
- Jump to referenced entity
- Virtualized rendering if performance measurements require it

### Detail view

Selecting an entity opens a focused editor rather than hundreds of expanded forms.

Passage details show:

- Purpose and summary
- Budget and status
- Story references
- Continuity obligations
- Ordered choices
- Incoming/outgoing graph neighborhood
- Current draft summary
- Version history
- Findings
- Scoped chat

### Graph view

The graph is secondary and filtered by:

- Act
- Sequence
- Route
- Ending
- Selected entity neighborhood
- Validation issue

It is for understanding and diagnostics, not the only way to edit the project.

## AI job design

### Passage planning

1. User selects scope.
2. Application creates a generation plan.
3. User reviews model, units, context estimate, output limit, and estimated cost.
4. User authorizes paid work.
5. Job executes bounded units.
6. Every unit validates independently.
7. Consolidation resolves new IDs and cross-unit references.
8. Full affected-scope validation runs.
9. Results become proposal groups.
10. User applies selected groups.

### Drafting

Drafting units normally contain 3-8 connected passages. Accepted nearby prose may be included, but entire route prose is not sent by default.

### Failure and retry

- Completed units remain completed.
- Retry targets failed units only.
- Repair attempts are bounded.
- Cancellation stops scheduling new units and preserves completed candidates.
- Provider failure never mutates canonical project state.
- Usage and cost are recorded per job and unit.

## Native compilation and runtime

### Compiled game bundle

The compiler consumes:

- Approved planning artifact versions
- Approved passage-plan snapshot
- Selected passage draft versions
- Project player settings
- Optional assets

It emits a deterministic bundle:

```ts
interface CompiledGame {
  schemaVersion: number;
  gameBuildId: string;
  title: string;
  startPassageId: string;
  mechanics: CompiledMechanic[];
  passages: Record<string, CompiledPassage>;
  endings: Record<string, CompiledEnding>;
  playerSettings: CompiledPlayerSettings;
}
```

The `gameBuildId` is derived from selected immutable inputs, not the current time. Identical inputs produce identical content and build identity.

### Runtime engine

The runtime engine is a pure TypeScript package with no React dependency.

Responsibilities:

- Initialize validated state
- Evaluate conditions
- Return visible/disabled choices
- Apply effects atomically
- Enter destination passages
- Record history
- Detect endings
- Serialize and validate saves

The web authoring preview, simulator, tests, native player, and standalone HTML use this same package.

### Native player

The native browser player provides:

- Passage prose and choices
- Visible stat/relationship display according to project settings
- Autosave
- Manual save slots
- Restart
- Configurable rewind
- Font size, line width, theme, and motion preferences
- Keyboard and screen-reader support
- Optional debug state inspector in author/test builds

It can be emitted as:

- Static web directory
- Standalone offline HTML where practical
- Later desktop/mobile wrappers without changing story semantics

### Save compatibility

A save records `gameBuildId` and save schema version.

- Exact-build saves load directly.
- Compatible content-only updates may use explicit migrations later.
- Incompatible saves fail with a clear explanation and remain exportable.
- The system never silently resets a save because a build changed.

## Export model

### Portable project bundle

The recovery/interchange bundle contains:

- Manifest and schema versions
- Project metadata
- Current and approved planning artifacts
- Passage-plan snapshots and selected entity versions
- Draft versions according to export options
- Validation reports
- Readable Markdown
- Optional conversations/summaries
- Optional imported source bodies

Original source bodies and conversations are opt-in because they may be private.

Import validates the bundle before creating or modifying a project. Round-trip tests compare canonical content.

### Native publishing build

The primary publishing output is the custom static player and compiled game bundle.

### Twee 3/SugarCube

Twee is an export adapter:

- Passage IDs are retained in metadata/tags.
- Choices compile to SugarCube links/macros.
- Conditions and effects compile from the typed state model.
- Start passage and story metadata are emitted.
- Save behavior uses SugarCube capabilities.

The first version is one-way. Arbitrary SugarCube edits are not guaranteed to import back into the canonical structured model.

### Ink

Ink is a possible later adapter when a concrete Unity, Inky, or inkjs integration is needed. It is not part of the initial native-runtime milestone.

### ChoiceScript and Hosted Games

ChoiceScript may be evaluated as a noncanonical export only if there is a concrete need and compatible licensing. Hosted Games is not a publishing target under its current prohibition on AI-generated work.

## Privacy and reasoning

- Credentials remain server-side.
- Only context-pack records selected for a user-triggered request leave the local application.
- Context diagnostics are inspectable before paid generation.
- Provider reasoning activity remains bounded, scrollable, and session-only.
- Raw reasoning is not required for application behavior.
- Reasoning, source bodies, conversations, and drafts are excluded from exports unless explicitly included by the relevant export option.

## Migration sequence

1. Harden current artifact/reference services without changing visible passage behavior.
2. Add schema migrations for entity versions and snapshots.
3. Add manual passage-plan APIs and UI.
4. Add validation and snapshot approval.
5. Add bounded AI planning.
6. Add draft versions and drafting jobs.
7. Add the shared runtime compiler/engine.
8. Add native player and exports.

Each migration is additive and transactional. Existing quick projects and completed long-form artifacts remain readable.

## Testing strategy

### Schema and service tests

- Condition/effect compatibility
- Stable reference validation
- Snapshot immutability
- Proposal preconditions
- Transaction rollback
- Dependency staleness
- Export determinism

### Graph fixtures

Maintain small named fixtures for:

- Healthy braided story
- Dangling choice
- Unreachable passage
- Loop with exit
- Loop without exit
- Impossible ending gate
- Setup without payoff
- Relationship written but never read
- Reconvergence that loses preserved state

### Large fixture

Generate a deterministic offline fixture with at least:

- 5 routes
- 10 endings
- 300 passage plans
- 750 choices
- 12 mechanics/relationships
- 175,000 planned words

Use it for repository, API, rendering, search, validation, compilation, and export performance tests. It contains synthetic placeholder prose and never calls a provider.

### Runtime conformance

The same test vectors run against:

- Pure runtime engine
- Authoring preview
- Native static build
- Standalone HTML build
- Twee/SugarCube export where supported

For a given initial state and choice sequence, observable state and destination passage must agree.

## Completion criteria

The design is successfully implemented when:

- A user can plan, draft, revise, validate, play, back up, and export a 150,000-200,000-word project.
- Hundreds of passages remain individually scoped and versioned.
- Frequent chat produces bounded proposals rather than dangerous complete-project replacements.
- Every executable condition and effect uses one validated state model.
- Stats and relationships have traceable writes, reads, and narrative consequences.
- Approved snapshots and accepted prose cannot be silently overwritten.
- Native preview and exported play use the same runtime semantics.
- Project recovery does not depend on the application database alone.
- Provider availability is never required to open, edit, validate, play, or export existing work.
