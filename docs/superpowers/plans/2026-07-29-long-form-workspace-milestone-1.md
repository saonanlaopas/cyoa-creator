# Long-form workspace milestone 1 implementation plan

## Goal

Deliver the reusable long-form workspace through approved story-bible planning: persistent project brief, artifact workflow, scoped chat, structured proposals, version-safe application, and Markdown/JSON export.

This plan extends the current checkout. It does not replace the quick generator or rebuild completed project, artifact, job, credential, import, or provider infrastructure.

## Working approach

- Work directly in the existing checkout.
- Keep the implementation sequential and local; do not use multi-agent development by default.
- Use fake provider responses for tests.
- Never make a live OpenRouter request without explicit approval.
- Run focused tests during each task and one complete offline verification pass at the end.
- Review the completed milestone once at the end unless a concrete failure requires correction.

## Existing code to reuse

- `ProjectRepository` and project routes.
- `ArtifactRepository`, immutable versions, compare/restore, and dependency staleness.
- `JobRepository` and `JobRunner`.
- Normalized source import and stable excerpt IDs.
- OpenRouter streaming client, usage, cost, errors, reasoning activity, and diagnostics.
- `CommandRepository` for global and project instructions.
- Existing `conversations` and `messages` tables as migration inputs.
- Placeholder studio components as replacement targets, not production behavior.

---

## Task 1: Add incremental migrations and long-form persistence

**Primary files**

- Modify `packages/persistence/src/schema.ts`
- Modify `packages/persistence/src/migrate.ts`
- Modify `packages/persistence/src/database.ts`
- Modify `packages/persistence/src/project-repository.ts`
- Create `packages/persistence/src/workflow-repository.ts`
- Create `packages/persistence/src/conversation-repository.ts`
- Create `packages/persistence/src/change-set-repository.ts`
- Modify `packages/persistence/src/index.ts`
- Add focused persistence tests

**Work**

1. Introduce a migration ledger and ordered, transactional migrations that upgrade existing databases without deleting data.
2. Add `projects.mode` with `quick` and `long-form`, preserving existing projects as `quick`.
3. Add artifact workflow state keyed by project and artifact, including current status and approved version ID.
4. Extend conversations/messages with title, structured scope, referenced version context, rolling summary, and message metadata.
5. Add change sets and candidate items with lifecycle, base versions, impact, invalidations, and candidate content.
6. Implement transactional promotion of dependency-safe candidate groups with current-version checks.
7. Ensure duplicate/archive behavior remains correct.

**Focused verification**

- Existing database upgrade preserves projects and artifact history.
- Approval can reference only a version of the same project/artifact.
- Editing an approved upstream artifact marks dependent current artifacts stale.
- Candidate application fails atomically when a base version is no longer current.
- Conversation scopes and message version references survive restart.

---

## Task 2: Define long-form planning schemas and dependency rules

**Primary files**

- Create `packages/pipeline/src/schemas/project-brief.ts`
- Replace or version `packages/pipeline/src/schemas/story-bible.ts`
- Create `packages/pipeline/src/schemas/workflow.ts`
- Expand `packages/pipeline/src/schemas/change-proposal.ts`
- Modify `packages/pipeline/src/dependency-map.ts`
- Modify `packages/pipeline/src/index.ts`
- Add focused pipeline schema tests

**Work**

1. Define `ProjectBriefSchema` with the agreed 150,000–200,000 default range and editable planning budgets.
2. Add stable section IDs and structured long-form character, relationship, setting, timeline, rule, theme, citation, contradiction, and open-question records to the bible.
3. Define workflow stages, statuses, assistant scopes, version references, proposal operations, and impact summaries.
4. Define dependencies for milestone 1: `source` and `brief` feed `bible`; changes to either stale the bible.
5. Version schemas so current quick-generation artifacts continue to parse.

**Focused verification**

- Default brief reflects the agreed long-form preset.
- Invalid word/playthrough budgets and missing IDs fail clearly.
- Source facts require citations; adaptation opportunities are distinguishable from facts.
- Scope and proposal schemas reject cross-project or missing-version shapes at service boundaries.

---

## Task 3: Expose long-form project, artifact workflow, and conversation APIs

**Primary files**

- Modify `apps/server/src/routes/projects.ts`
- Create `apps/server/src/routes/workflow.ts`
- Replace `apps/server/src/routes/conversation.ts`
- Modify `apps/server/src/app.ts`
- Add server route tests

**Work**

1. Create/list/read projects with mode and return a workflow summary for long-form projects.
2. Add current artifact read/save endpoints that validate the appropriate schema and create immutable versions.
3. Add review, approve, reopen, compare, and restore operations with impact responses.
4. Add conversation/thread CRUD, scoped message persistence, scope updates, and thread summaries.
5. Add proposal read, authorize, reject, candidate-preview, apply, and supersede endpoints.
6. Return typed conflicts when proposal base versions no longer match current artifacts.

**Focused verification**

- Quick endpoints remain backward compatible.
- Discussion messages cannot write artifacts.
- Approval and proposal application use server-side project/version authorization.
- Restoring or replacing an approved brief reports and marks the bible stale.

---

## Task 4: Build the long-form workspace shell

**Primary files**

- Modify `apps/web/src/app/routes.tsx`
- Replace `apps/web/src/features/studio/StudioLayout.tsx`
- Replace `apps/web/src/features/studio/PipelineNav.tsx`
- Replace `apps/web/src/features/studio/ArtifactWorkspace.tsx`
- Replace `apps/web/src/features/studio/AssistantPanel.tsx`
- Create focused API/state/components under `apps/web/src/features/workspace`
- Modify `apps/web/src/app/app.css`
- Add component tests

**Work**

1. Add project selection/creation and a route into long-form workspace while retaining quick generation.
2. Render stage status, approved/stale state, unresolved counts, and recommended next action.
3. Build a reusable artifact header with version, compare, restore, review, approve, export, and stale-impact controls.
4. Build the assistant shell with pinned scope bar and composer, independent scrolling, collapse, bounded resizing, default-width restore, and full-screen mode.
5. Persist panel width locally; use separate artifact/chat views on small screens.
6. Make scope selection explicit and manually adjustable.

**Focused verification**

- Reload restores project and local panel preference.
- Resizing cannot collapse the artifact workspace below its minimum.
- Scope remains visible while chat history scrolls.
- Mobile rendering does not depend on a drag handle.
- Quick generator still loads.

---

## Task 5: Implement the project brief experience

**Primary files**

- Create `apps/web/src/features/workspace/brief/*`
- Add brief API methods and server tests
- Add Markdown rendering/export support

**Work**

1. Create a guided brief editor for premise, source mode, protagonist, fidelity, tone, boundaries, planning budgets, route shape, relationships, constraints, and unresolved questions.
2. Seed long-form defaults without preventing custom larger targets.
3. Save validated draft versions and display version history.
4. Support review, approval, reopening, and downstream impact preview.
5. Export brief JSON and readable Markdown.

**Focused verification**

- A new long-form project opens with the agreed defaults.
- Invalid budgets have accessible validation.
- Approved versions remain immutable when the draft is edited.
- Brief survives server restart and exports deterministically.

---

## Task 6: Add the scoped assistant harness and structured proposals

**Primary files**

- Create `apps/server/src/services/project-assistant.ts`
- Create stage-specific prompt/context builders in `packages/pipeline`
- Add typed assistant streaming events
- Connect `AssistantPanel` to persisted threads
- Add fake-provider fixtures and tests

**Work**

1. Build trusted prompt envelopes for `discuss` and `propose`.
2. Assemble approved brief, selected artifact/section, source excerpts, commands, recent messages, summary, and exact version context.
3. Persist user and assistant messages with scope/version metadata.
4. Stream status, provider-supplied reasoning, response text, proposal cards, usage, and typed errors.
5. Ensure `discuss` has no artifact mutation capability.
6. Validate proposed operations and save a `proposed` change set only.
7. Show base versions, impact, invalidations, estimated work, and confirmation controls.

**Focused verification**

- The fake assistant receives only scope-relevant context.
- Ambiguous or stale scope produces a typed clarification/conflict.
- Discussion cannot create artifact versions.
- Proposal generation creates a change set but does not apply it.
- Conversation and scope survive restart.

---

## Task 7: Generate, revise, and approve the long-form story bible

**Primary files**

- Replace the skeletal long-form path in `packages/pipeline/src/stages/analyze-source.ts`
- Add long-form bible prompt builders and consolidation
- Add bible reader/editor components
- Add candidate comparison and application UI
- Add tests with deterministic source fixtures

**Work**

1. Analyze normalized source in bounded cited chunks.
2. Consolidate a structured bible without mixing source facts and adaptation ideas.
3. Present sections in a readable outline with direct editing and unresolved questions.
4. Let scoped chat discuss a section or produce a version-based change proposal.
5. Authorize generation when required, build candidate sections in resumable units, and validate the complete candidate bible.
6. Review high-level impact, section summaries, and item-level comparison.
7. Apply selected coherent groups transactionally.
8. Review and approve one immutable bible version.

**Focused verification**

- Citations resolve to imported excerpt IDs.
- Conflicting facts remain visible.
- Candidate generation resumes without repeating completed units.
- A proposal based on an older bible version cannot overwrite a newer edit.
- Approved bible and conversations survive restart.

---

## Task 8: Add milestone exports and offline end-to-end coverage

**Primary files**

- Create long-form planning export service/routes
- Add brief/bible Markdown renderers
- Update `docs/user-guide.md`
- Extend offline Playwright fixtures and tests

**Work**

1. Export brief and bible individually as Markdown and structured JSON.
2. Export a combined planning snapshot with project, schema, version, approval, and dependency metadata.
3. Keep original source bodies excluded by default.
4. Cover create project, edit/approve brief, generate bible with fake provider, scoped discussion, proposal preview/application, approval, restart persistence, and export.
5. Document guided workflow, chat scope, proposal confirmations, version recovery, privacy, and cost boundaries.

**Final offline verification**

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

No live provider smoke is included. Offer it separately only after the milestone passes offline and only with explicit user approval and an agreed spending cap.

## Milestone completion criteria

- The first-milestone acceptance criteria in the design document pass.
- Existing quick generation remains functional.
- Existing project and artifact history upgrade without data loss.
- No credentials, reasoning history, source bodies, or conversation content leak into unintended exports or logs.
- The final review finds no unbounded provider loop, silent mutation path, stale-version overwrite, or non-transactional candidate application.
