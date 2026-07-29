# Long-form CYOA workspace design

> Status on 2026-07-30: implemented through mechanics planning. The next-stage
> roadmap and passage/runtime contracts are defined in
> `docs/superpowers/plans/2026-07-30-long-form-production-roadmap.md` and
> `docs/superpowers/specs/2026-07-30-passage-plan-and-runtime-design.md`.

## Purpose

Extend Story to CYOA from a useful one-shot prototype into a persistent workspace for designing a 150,000–200,000-word branching project over many guided, conversational sessions.

The quick text-to-CYOA generator remains available. Long-form projects use a separate guided workflow built on the repository's existing projects, immutable artifact versions, dependency tracking, jobs, provider client, and local SQLite storage.

## Product principles

1. **Artifacts are the source of truth.** Chat helps discuss and change the project, but chat history is never the canonical design.
2. **The application owns the workflow.** The model receives a stage-specific role, schema, approved context, selected scope, and explicit task. It does not decide the workflow from an unstructured transcript.
3. **Meaningful checkpoints require approval.** The app stops for review at the brief, bible, routes, endings, mechanics, and passage-plan stages.
4. **AI changes are proposals.** Discussion does not mutate artifacts. Proposed changes become candidate versions and are applied only after confirmation.
5. **Large work is resumable and inspectable.** Analysis, planning, and later drafting run in bounded job units with checkpoints, usage, and cost reporting.
6. **Scope is always visible.** Every assistant request identifies the project, artifact, section, and base version it can discuss or propose changing.
7. **Project work is portable.** Structured JSON is canonical; readable Markdown exports make the design understandable outside the app.

## Long-form target

The initial preset is:

- 150,000–200,000 total words, configurable upward rather than enforced as a hard maximum.
- Approximately 280–380 passages.
- Approximately 400–650 words per passage on average, with shorter transitions and longer full scenes.
- Approximately 40,000–60,000 words in a typical playthrough.
- Four to six substantial routes.
- Eight to twelve endings.
- Braided branching: shared setup, substantial route-exclusive material, controlled reconvergence, and route-specific late acts.

These values are planning budgets, not promises of exact output. The workspace reports planned, drafted, and remaining words by project, route, act, and passage.

## Guided workflow

The full workflow is:

1. Project brief
2. Source and story bible
3. Routes
4. Endings
5. Mechanics
6. Passage plan
7. Drafted passages
8. Review and simulation
9. Play and export

The first milestone implements the reusable workspace through story-bible approval. Later stages reuse the same artifact, chat, proposal, version, and approval components.

Each stage has one of these states:

- `empty`: no artifact exists.
- `draft`: editable work exists but has not been reviewed.
- `reviewed`: the user has reviewed the current version but has not approved it for downstream use.
- `approved`: one explicit version is canonical for downstream work.
- `stale`: an approved upstream dependency changed and this stage requires review.

Approval references an immutable artifact version. Editing an approved artifact creates a new draft version; it does not silently alter the approved version. Applying or restoring an upstream version marks dependent current artifacts stale through the existing dependency graph.

## Workspace layout

Desktop uses three coordinated regions:

- **Stage navigation:** project stages, status, unresolved items, and the recommended next action.
- **Artifact workspace:** readable structured content, direct editing, version comparison, approval, and exports.
- **Assistant:** persistent scoped conversation, candidate change proposals, and linked artifact references.

The assistant panel supports:

- Collapsed mode.
- A default width around 400 pixels.
- Bounded drag resizing without reducing the artifact workspace below its usable minimum.
- Full-screen discussion mode.
- A remembered local width preference.

On small screens, assistant and artifact workspace are separate views rather than a draggable split.

The assistant header remains visible and shows:

- Project.
- Scope kind and label.
- Artifact ID and section when applicable.
- Referenced artifact version.
- Context versions for approved dependencies.

The composer remains pinned at the bottom while conversation history scrolls independently.

## Scope model

Assistant scope is explicit structured data:

```ts
type AssistantScope =
  | { kind: "project"; projectId: string }
  | { kind: "stage"; projectId: string; stage: WorkflowStage }
  | {
      kind: "artifact";
      projectId: string;
      stage: WorkflowStage;
      artifactId: string;
      versionId: string;
      sectionId?: string;
    };
```

The UI updates scope when the user selects a stage or section, but the user can broaden or narrow it manually. Every persisted message records the scope and referenced versions used for that message. Old messages therefore continue to point to the material they originally discussed.

When a request remains ambiguous despite visible scope, the assistant asks for clarification instead of selecting a wider target.

## Conversation behavior

The assistant supports two explicit response intents:

- `discuss`: answer, analyze, compare, brainstorm, or explain without changing project state.
- `propose`: return a structured change proposal based on explicit requested changes.

The server chooses a stage-specific harness. For a story-bible request, it assembles:

1. Trusted role and workflow instructions.
2. The approved project brief.
3. The selected story-bible version and section.
4. Relevant normalized source excerpts with stable citations.
5. Enabled global and project commands.
6. A bounded recent conversation window.
7. A maintained thread summary and pinned project decisions.
8. The current user message.
9. A strict response schema.

The model does not receive the whole source or unbounded chat history on every request. Source analysis remains chunked and cited. Long conversations use recent messages plus a persisted summary; important decisions are promoted into artifacts or project instructions.

Provider-supplied reasoning remains session-only in the existing bounded activity panel. It is not part of project memory or canonical context.

## Change proposals

A proposal records:

- User request.
- Scope.
- Base artifact version IDs.
- Human-readable rationale and summary.
- Structured operations against candidate artifacts.
- Affected artifacts and sections.
- Downstream invalidations.
- Estimated job units and provider cost when generation is required.
- Validation requirements.

Proposal lifecycle:

1. `proposed`: discussion produced a plan; no project artifacts changed.
2. `authorized`: the user approved scope and any estimated paid work.
3. `generating`: candidate changes are being produced in resumable units.
4. `ready`: candidate versions and impact summaries are available.
5. `applied`: selected coherent groups were promoted atomically.
6. `rejected`, `superseded`, or `failed`.

The first milestone supports proposals affecting the project brief and story bible. The model may suggest changes, but only the application can create and promote candidate versions.

### Large proposals

Large proposals are grouped by coherent artifact sections rather than hundreds of unrelated checkboxes. Review proceeds from:

1. Overall impact.
2. Artifact and section summaries.
3. Validation findings.
4. Representative samples.
5. Full item-level comparison when requested.

Partial application is allowed only for dependency-safe groups. Otherwise the app explains the dependency or regenerates a narrower proposal.

Application is transactional. All selected candidate versions and workflow-state updates succeed together or none do. Before application, base version IDs are compared with current versions. A stale proposal cannot overwrite newer work; it must be reviewed or regenerated.

Restore remains available through immutable version history.

## Confirmation policy

- Discussion and brainstorming: no confirmation.
- Direct user edits: autosave as a draft artifact version after an explicit save action or short debounce.
- AI change proposal: explicit **Apply changes**.
- Proposal requiring provider generation: **Approve plan** after scope and estimated cost are shown.
- Stage approval: explicit **Approve artifact**.
- Upstream change with downstream effects: show affected artifacts before application.
- Destructive replacement or deletion: explicit confirmation with recoverable version history.

These are distinct actions. Approving a plan does not approve the resulting artifact.

## Persistence

Existing reusable foundations:

- `projects`
- immutable `artifact_versions`
- `artifact_dependencies`
- `jobs`, `job_units`, and `usage_records`
- basic `conversations` and `messages`
- project/global instruction commands

Required additions:

- Incremental schema migrations instead of relying only on idempotent `CREATE TABLE`.
- Project mode (`quick` or `long-form`).
- Artifact workflow state with an approved version reference.
- Conversation title, scope, artifact-version context, and rolling summary.
- Message scope/version metadata.
- Change sets, candidate items, lifecycle state, and base versions.

The project brief and bible remain normal versioned artifacts. Workflow metadata references versions rather than being embedded into artifact content.

## First-milestone artifacts

### Project brief

The brief includes:

- Working title and premise.
- Source mode and selected source scope.
- Existing protagonist and point of view.
- Adaptation fidelity.
- Tone and content boundaries.
- Total-word target, typical-playthrough target, route count, ending count, and passage-length guidance.
- Branching style.
- Priority characters and relationships.
- User constraints and unresolved design questions.

Default total-word range is 150,000–200,000 but remains editable.

### Story bible

The existing `StoryBibleSchema` is too skeletal for long-form planning. The long-form schema adds structured:

- Characters, motivations, knowledge, relationships, and arcs.
- Setting and institutions.
- Timeline and causality.
- Rules of the setting.
- Themes, tone, and prose guidance.
- Canon facts with source citations and confidence.
- Contradictions and unresolved questions.
- Adaptation opportunities that are clearly labeled as proposals rather than source facts.

Bible sections have stable IDs so chat scope, comparisons, proposals, and citations survive reordering.

## Export

The first milestone provides:

- Project brief Markdown.
- Story bible Markdown.
- Structured JSON containing schema versions and artifact version metadata.
- A combined planning export.

A later project bundle will be an importable ZIP containing a manifest, structured artifacts, readable Markdown, conversations or summaries when requested, drafts, and final exports. Including original source bodies is opt-in.

## Privacy and cost

- Credentials remain server-side under the existing DPAPI/environment abstraction.
- Project data, chat, candidate changes, and exports remain local.
- Only request-specific context is sent to OpenRouter.
- Provider calls occur only after a user action.
- Potentially large or multi-batch calls show model, estimated units, and estimated cost before authorization.
- Tests and E2E use fake providers; no live request is part of normal verification.

## First-milestone non-goals

- Full route generation or visualization.
- Ending, mechanics, or passage-plan generation.
- Bulk prose drafting.
- Multiplayer or cloud synchronization.
- Automated source scraping.
- A single autonomous run from source to finished 200,000-word story.

## Acceptance criteria

- A long-form project survives restart with its brief, bible, workflow state, conversations, scopes, and versions intact.
- The default brief targets 150,000–200,000 total words and is editable.
- The app clearly distinguishes quick and long-form projects.
- The stage sidebar and artifact workspace are usable without chat.
- Chat scope is always visible and manually adjustable.
- Discussion cannot mutate artifacts.
- A proposal records exact base versions, impact, and invalidations.
- Candidate changes cannot overwrite newer artifact versions.
- Applying a proposal is transactional and recoverable through version history.
- Bible approval references one immutable version.
- Editing an approved brief makes the dependent bible stale without destroying either approved version.
- Assistant width, collapse, and full-screen modes work on desktop; mobile uses separate views.
- Brief and bible export as readable Markdown and structured JSON.
- All default verification remains offline.
