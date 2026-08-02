# AI and chat workflows

## Common provider contract

All AI-assisted work follows the same lifecycle:

```text
Select intent and scope
  -> preview context, model, units, output, and maximum cost
  -> create persisted job
  -> run bounded units
  -> validate structured output locally
  -> bounded repair when permitted
  -> store candidate output
  -> present proposal and findings
  -> writer accepts, rejects, edits, or asks follow-up
  -> transactional application creates normal versions
```

Provider output never writes directly to canonical artifacts or accepted prose.

## Assistant chat

Chat is a primary application surface. It should feel like a persistent project-aware co-author while remaining constrained by the workflow.

### Chat behaviors

- **Discuss:** answer, brainstorm, compare options, and explain consequences. Cannot mutate artifacts.
- **Suggest:** return two or three alternatives with tradeoffs. The writer may turn one into a proposal.
- **Propose change:** create stable-ID operations and prose diffs against exact base versions.
- **Run workflow action:** prepare a generation plan for extraction, planning, mending, continuation, drafting, or review. Starting a paid job still requires explicit confirmation.

### Stage-aware guidance

The assistant receives a small workflow harness describing:

- project entry mode;
- current stage and status;
- approved dependencies;
- stale or blocked downstream work;
- selected scope and neighboring entities;
- pinned decisions and content boundaries;
- allowed response schema and operation types;
- next valid workflow actions.

It may recommend the next action but cannot silently advance or approve a stage.

### Conversation memory

Persistent memory consists of:

- canonical project artifacts;
- approved and pinned decisions;
- a bounded conversation summary;
- specifically selected recent messages;
- selected findings and proposals.

The full transcript is available for the writer to read but is not automatically sent on every request. Raw provider reasoning is never used as memory.

### Scope resolution

When the writer says “change the ending” or “make the forgiveness slower,” the assistant must not guess silently. It should either:

- use the currently visible scope and restate it;
- identify one unambiguous stable entity from context;
- or ask a short clarifying question while presenting likely scopes.

Before sending, the composer displays a scope chip such as:

> Mend · Relationship arc `arc-mara-elin` · Act 2 · based on v7

## Premise-to-planning workflow

### Suggest at any stage

Every editable artifact and major section has:

- **Suggest options**
- **Draft this section**
- **Discuss**
- **Edit manually**

Suggestions should be meaningfully different, not superficial rewordings. They include likely consequences for tone, length, arcs, and later stages.

### Create first planning pass

The job is divided into deterministic units:

1. normalize premise and constraints;
2. propose the story brief;
3. propose initial bible entities;
4. propose characters and relationships;
5. propose plot threads and character arcs;
6. propose act structure;
7. propose chapter structure;
8. propose scene plans in bounded chapter batches;
9. reconcile budgets, references, setups, and payoffs;
10. create a planning review digest.

Each unit consumes only approved input or earlier candidate output from the same job. Candidate dependencies are explicit. Completed units are checkpointed. Resume skips completed valid units.

The job may produce a coherent multi-artifact proposal, but application still honors base versions and dependency-safe groups. Nothing is automatically approved.

## Imported-story extraction

### Deterministic preparation

Before calling a model:

1. normalize encoding and line endings;
2. remove format noise without deleting prose;
3. detect headings and likely chapter boundaries;
4. segment chapters into bounded scene or paragraph groups;
5. assign stable source IDs and hashes;
6. estimate tokens, units, and cost.

### Hierarchical extraction

Extraction operates in resumable layers:

1. **Segment pass:** characters, locations, events, facts, relationships, point of view, style observations, and open questions with source evidence.
2. **Entity consolidation:** merge aliases and duplicate observations without discarding provenance.
3. **Timeline and causality pass:** order events, flag uncertainty, and connect cause to consequence.
4. **Arc and flow reconstruction:** infer plot threads, character arcs, acts, chapters, and scene purposes.
5. **Contradiction pass:** surface conflicting claims instead of choosing invisibly.
6. **Review digest:** distinguish confirmed source facts, inferences, contradictions, and proposed creative interpretations.

Bounded source excerpts may be retained as evidence. The application must avoid copying an entire imported manuscript into every request.

## Mending workflow

### Repair categories

- copyediting and clarity;
- style, tone, voice, point of view, or tense;
- dialogue and characterization;
- pacing and repetition;
- continuity and timeline;
- motivation and emotional causality;
- setup, foreshadowing, and payoff;
- chapter or scene structure;
- canon change or deliberate retcon.

### Mend plan

Before prose generation, the application prepares:

- exact manuscript scope;
- user instruction and preserved constraints;
- selected repair category;
- affected facts, arcs, and neighboring scenes;
- estimated rewrite size and cost;
- whether structural artifacts also need proposals;
- validation steps.

Small repairs may draft one candidate directly. Large repairs first produce a repair outline and grouped impact preview.

### Prose proposal

A prose proposal contains:

- before/after text or an inline diff;
- summary of the intended improvement;
- facts and stylistic constraints preserved;
- intentional canon changes;
- affected scene, plan, and arc IDs;
- possible downstream stale entities;
- warnings when the requested change conflicts with accepted canon.

Accepted prose outside the selected scope is not regenerated.

## Continue workflow

1. Select the last canonical scene or imported boundary.
2. Show unresolved threads, current character states, timeline position, and style profile.
3. Ask the writer to preserve, resolve, defer, or abandon important obligations.
4. Suggest several continuation directions when requested.
5. Turn the selected direction into arc, act, chapter, and scene candidates.
6. Review and approve the continuation plan.
7. Draft one scene or a small connected batch.
8. Validate state transitions, knowledge, voice, timeline, and required setups/payoffs.
9. Accept, revise, or reject each batch.

Continuation must not rewrite the existing manuscript unless the writer separately requests a mend proposal.

## Drafting workflow

Drafting context is assembled per scene or connected batch from:

- exact scene-plan versions;
- relevant bible records and evidence claims;
- current plot, character, and relationship arc obligations;
- timeline and knowledge state;
- nearby accepted prose;
- style guidance and content boundaries;
- required entry and exit states;
- pinned project decisions.

Do not send the entire manuscript by default. Use summaries and only the necessary neighboring prose.

Draft batches normally contain one scene or up to three tightly connected scenes. Each draft records its prompt/context version and actual usage. Accepted prose is locked against silent regeneration.

## Narrative review

Deterministic checks run before optional AI review:

- missing or duplicate IDs;
- invalid chronology references;
- character or location references that do not exist;
- facts used before establishment;
- setup without payoff and payoff without setup;
- unresolved thread obligations;
- chapter/scene word-budget drift;
- point-of-view or tense violations where structurally declared;
- stale drafts based on older plans.

AI review can assess pacing, repetition, clarity, emotional progression, voice drift, and thematic coherence. Its findings remain subjective, traceable, and reviewable. AI review produces findings and optional repair proposals, never automatic rewrites.

## Failure, privacy, and cost rules

1. All normal tests use deterministic fake providers.
2. The application validates every structured response locally.
3. At most one bounded repair request is made unless the writer explicitly retries.
4. Malformed, partial, timed-out, cancelled, or interrupted output cannot mutate canonical state.
5. Jobs persist enough context metadata and unit checkpoints to resume safely.
6. Every paid action shows model, scope, estimated token range, and maximum spend before starting.
7. Provider reasoning activity is visible when available in a bounded, scrollable session component.
8. Provider reasoning is not stored in projects, exports, diagnostics, summaries, or memory.
9. API keys are encrypted locally and never returned to the browser or included in project exports.
10. Source and manuscript text are excluded from diagnostics unless the writer explicitly exports a warned diagnostic package.
