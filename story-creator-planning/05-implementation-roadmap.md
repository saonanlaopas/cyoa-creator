# Implementation roadmap

## Delivery approach

Build Story Creator as a separate application and repository. The planning package should be committed there before implementation begins so every later checkpoint has a stable product contract.

Use a light, sequential workflow:

1. Implement one foundation.
2. Run its focused offline tests.
3. Update the user guide and relevant planning documents.
4. Review the finished foundation once.
5. Commit it before starting the next foundation.

Do not use live or paid OpenRouter requests for routine engineering. Deterministic fake providers and fixtures must cover generation, streaming, malformed output, interruption, retry, and recovery. A live-provider smoke test is optional and requires explicit approval at the time it is proposed.

## Foundation 1 — Local authoring core

Create the application shell and the trustworthy local data layer.

### Scope

- New repository, workspace, development scripts, tests, and production build.
- Project creation with the three entry intentions: premise, mend an import, and continue an import.
- Immutable source-document import for plain text, Markdown, HTML, DOCX, and EPUB where practical.
- Manual editors for story brief, bible, characters, relationships, arcs, acts, chapters, scenes, and manuscript units.
- Stable IDs for every editable entity and reference.
- Artifact versions, approval state, history, comparison, and restore.
- Transactional persistence with schema migration and recoverable backups.
- Basic project archive export and import.
- Settings and encrypted provider-credential storage, without requiring a provider to use the app.

### Acceptance gate

A user can create a project, import a source or enter a premise, edit every core artifact manually, approve versions, close and reopen the app without data loss, inspect history, restore an older version, and move a project archive between installations. Tests prove failed writes do not partially mutate canonical data.

## Foundation 2 — AI-assisted understanding and planning

Add the bounded workflows that turn a premise or imported manuscript into reviewable structured plans.

### Scope

- Provider abstraction, streaming activity UI, cancellation, timeout, and deterministic fake provider.
- Source segmentation and hierarchical analysis for long imports.
- Evidence-linked extraction of characters, relationships, facts, setting, timeline, unresolved threads, style observations, and plot structure.
- Suggest actions on each artifact editor.
- `Create first planning pass` from a premise or imported story.
- Candidate output review before any artifact is changed.
- Resumable job units and durable checkpoints.
- Dependency snapshots so generated candidates identify the exact approved inputs used.
- Clear handling of malformed, partial, duplicated, or stale model output.

### Acceptance gate

From a short premise, the offline provider can produce a complete candidate planning pass through scene planning. From a large fixture manuscript, extraction runs in bounded units and produces evidence-linked artifacts. Cancelling, crashing, or returning malformed output leaves canonical artifacts unchanged; the job can resume from its last valid checkpoint.

## Foundation 3 — Persistent scoped assistant

Make chat the frequent, convenient control surface without allowing conversational ambiguity to corrupt the project.

### Scope

- Persistent project conversations and messages.
- Resizable, collapsible, and full-screen assistant panel.
- Always-visible, manually adjustable scope: project, workflow stage, artifact, section, chapter, scene, character, relationship, or selected text.
- Stage-aware assistant instructions and bounded context assembly.
- Separate discuss, inspect, suggest, and propose behaviors.
- Structured proposal operations over stable IDs.
- Grouped change review, selective acceptance where dependencies permit it, all-or-nothing application, and conflict detection.
- Conversation summaries and durable decisions; raw provider reasoning is not assistant memory.
- Visible reasoning activity in a bounded, scrollable component while a request is running. Raw hidden reasoning text remains undisclosed.

### Acceptance gate

A user can discuss any artifact, change scope explicitly, ask for alternatives, and request a revision proposal. The assistant cannot mutate canonical state directly. Accepted proposals apply transactionally, rejected proposals change nothing, stale proposals report conflicts, and conversation plus accepted decisions survive restart.

## Foundation 4 — Manuscript drafting and mending

Turn plans and imported prose into controlled, reviewable manuscript work.

### Scope

- Chapter and scene manuscript editor with status, word targets, notes, and dependency context.
- Draft a scene, continue a scene, rewrite a selection, and draft small connected batches.
- Mend operations such as preserve voice, repair continuity, tighten pacing, deepen a character, alter tone, or implement a specified plot change.
- Range-aware proposals with before/after comparison and surrounding context.
- Preserve-user-text controls and explicit replacement boundaries.
- Batch drafting queues that never overwrite approved prose silently.
- Provenance linking prose candidates to plan versions and instructions.

### Acceptance gate

A user can draft from an approved scene plan and mend an imported chapter while seeing exact proposed prose changes. Large replacements are chunked and reviewable. Interrupted generation cannot alter the manuscript, and accepted changes create restorable versions with provenance.

## Foundation 5 — Continuation and from-scratch production

Support sustained long-form writing rather than isolated demonstrations.

### Scope

- Continue from an imported endpoint using approved continuity and plan constraints.
- Draft sequentially from a premise-built plan.
- Context packets containing only the relevant bible facts, arcs, recent prose, unresolved threads, scene requirements, and style evidence.
- Word-count and pacing targets at project, act, chapter, and scene levels.
- Queue management, pause, resume, retry, cancellation, and dependency invalidation.
- Checkpoints between every bounded generation unit.
- Project-level progress and estimated provider usage before live execution.

### Acceptance gate

A long fixture project can draft or continue many scenes through resumable batches. Each unit uses bounded context, reports its dependencies, and can be individually reviewed or regenerated. Restarting the app preserves queue state and completed candidates without duplicating or skipping work.

## Foundation 6 — Continuity review and revision

Make quality findings actionable without encouraging whole-story regeneration.

### Scope

- Deterministic checks for broken references, ordering issues, missing plan coverage, duplicate IDs, word-target drift, and stale dependencies.
- AI-assisted review for continuity, characterization, relationship progression, plot logic, pacing, theme, prose consistency, setup/payoff, and unresolved threads.
- Evidence-linked findings with severity, confidence, scope, and affected stable IDs.
- Findings-to-proposal workflow for scoped repairs.
- Review status, dismissal rationale, recheck, and before/after comparison.
- Reports at scene, chapter, act, character, arc, and project levels.

### Acceptance gate

Offline fixtures produce reproducible structural findings and fake AI findings. A user can inspect evidence, create a narrowly scoped repair, accept it transactionally, rerun relevant checks, and verify that unrelated prose and plans remain untouched.

## Foundation 7 — Export, scale, recovery, and polish

Prepare the application for real 100k–200k+ word projects and dependable ownership of the work.

### Scope

- Manuscript export to Markdown, DOCX, EPUB-ready structure, and clean plain text.
- Structured project export containing artifacts, versions, conversations, proposals, jobs, and provenance.
- Incremental indexes and virtualized interfaces for large manuscripts and plans.
- Context and cost inspection before provider work.
- Backup rotation, integrity checks, migration tests, crash recovery, and archive validation.
- Search, filters, keyboard navigation, accessibility, and authoring ergonomics.
- Project diagnostics and a privacy/data-retention explanation.

### Acceptance gate

A representative 200k-word fixture remains responsive, searchable, resumable, exportable, and recoverable. Exported manuscripts have correct ordering and content; a full project archive round-trips into a clean installation with history and approved state intact.

## Verification strategy

Every foundation should include focused unit and integration tests. Foundations with user workflows should add a small number of high-value browser tests. At the end of every committed checkpoint, run:

- focused tests for changed behavior;
- repository typecheck;
- production build;
- one relevant browser workflow when UI behavior changed.

Before a tagged release, run the complete offline suite and a large-project fixture pass. Live-provider tests are separate, manually authorized checks; they are not a prerequisite for implementing or validating the engineering foundations.

## Recommended first usable release

Foundations 1–4 form the first genuinely useful release: a user can import or begin a story, construct a planning system with AI help, collaborate through scoped chat, and draft or mend prose safely. Foundations 5–7 turn that vertical slice into a dependable long-form production environment.
