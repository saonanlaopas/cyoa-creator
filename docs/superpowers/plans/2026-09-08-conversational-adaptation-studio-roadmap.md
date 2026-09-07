# Conversational Adaptation Studio roadmap

## Status

This is a planning-only post-foundation product roadmap. It starts from the accepted closed-roadmap base `62ecd1d5ea9e3d9bc0d047633f4dc13b6370e905`.

The long-form production foundation roadmap remains closed. Foundation 8 is closed, and there is no Foundation 9. This document defines a separate product expansion named **Conversational Adaptation Studio**. It does not reopen, replace, or renumber the accepted foundations.

No checkpoint in this roadmap has begun. A1 may begin only after this planning checkpoint is committed, pushed, CI-verified, externally reviewed, and assigned an accepted SHA.

## Product outcome

Authors can talk naturally about the story they want to make, or upload an existing story, while Studio translates that intent into reviewable structured project state.

The governing interaction is:

```text
human story language
  -> AI interpretation
  -> explicit structured proposal
  -> preview and review
  -> deliberate application
  -> existing hardened Studio pipeline
```

Conversational Adaptation Studio is a new control surface over the accepted Long-form Studio. It reduces the amount of system terminology an author must learn before making useful creative decisions, without weakening immutable history, stable identity, exact-version dependencies, validation, approval, staleness, transactional application, recovery, privacy, or provider-cost controls.

## Product principles

### 1. Talk in story language

An author may begin with language such as:

> I want a slow-burn BL between two men in their twenties. Warm, intimate, long prose, not short visual-novel dialogue.

Studio interprets the creative intent and asks focused questions. The author does not have to populate every Brief, Bible, route, ending, mechanics, or prose field before receiving useful help.

### 2. Progressive disclosure

The first experience exposes only the next meaningful creative decision. Brief, Bible, routes, endings, mechanics, passage planning, validation, drafting, simulation, and repair remain available when needed, but are not presented as one initial wall of configuration.

The interface explains creative consequences first. Internal concepts such as immutable artifact streams, snapshot lineage, job units, repair applications, and exact dependency fingerprints remain inspectable in Advanced Mode.

### 3. One canonical project model

Director Mode, Review Mode, and Advanced Mode operate on the same Long-form project and the same authoritative artifact/entity versions. There are no separate easy-mode projects, translated shadow projects, or conversational-only canonical stores.

### 4. Conversation is not canonical authority

Conversation may interpret, suggest, explain, compare, and propose. It never silently changes canonical project state.

Every durable AI-assisted structural change follows:

```text
conversation -> proposal -> preview -> deliberate apply
```

Application uses the accepted authority, stable-ID, exact-base, validation, staleness, history, and transaction semantics. Generation and application are separate actions. Generated content is never approved merely because it was generated.

### 5. Explainability without private reasoning

AI-configured fields support **Why is this set?** using durable provenance: the exact user message, accepted source evidence, exact approved structured state, explicit author override, or manual edit that supports the value.

Studio does not expose or persist private chain-of-thought. Provider reasoning activity may continue to appear in the accepted bounded, scrollable session UI when supplied, but it is not project memory or field provenance.

### 6. Adaptation evidence remains separated

Existing-story projects visibly distinguish:

- source canon;
- inference;
- author override;
- adaptation-only invention.

An override does not rewrite the source fact. Studio retains the source-supported record, the explicit override, and the resulting adaptation effect.

### 7. No prose too early

Source analysis, adaptation intent, and foundation bootstrap do not generate passage prose. They create evidence and draft structured planning artifacts. The accepted passage-plan and passage-drafting pipeline remains solely responsible for production prose.

### 8. Preserve advanced control

The existing detailed Long-form workspace remains available. Conversational UX is an additional way to understand and propose changes to the same state, not a replacement for direct structured editing.

### 9. Local-first and explicit provider use

Reading, manual configuration, proposal review/application, history, validation, import inspection, and export remain provider-independent where possible. Every AI action is explicit, bounded, cancellable, retryable, provenance-captured, and testable with deterministic offline providers.

### 10. Large inputs are planned work

Serious adaptation never assumes that an entire manuscript fits in one request. Source analysis and foundation generation use immutable inputs, deterministic bounded units, persisted attempts, exact fingerprints, and resumable consolidation.

## Existing Studio contracts to reuse

Repository inspection at the accepted base found these relevant foundations:

- `ProjectBriefSchema`, `LongFormStoryBibleSchema`, `LongFormRoutePlanSchema`, `LongFormEndingPlanSchema`, and `LongFormMechanicsPlanSchema` already define the first five Long-form artifacts.
- `LongFormProjectService` owns stage prerequisites, approval, validation, dependency invalidation, restore, and application of stable-ID planning operations.
- `ArtifactRepository`, workflow state, passage entity versions, draft versions, snapshots, and accepted heads preserve immutable history and exact approved versions.
- Scoped Long-form chat already records project/artifact/section scope, current version context, separate `discuss` and `propose` intents, bounded referenced records, and reviewable stable-ID operation groups.
- Foundation 8C conversation summaries are bounded, versioned, scoped, dependency-aware, and explicitly non-canonical. Pinned decisions are bounded, scoped, versioned author memory with message/change-set provenance.
- The importer already normalizes TXT, HTML/AO3-style HTML, and EPUB into ordered chapters and blocks with stable excerpt IDs. The server already stores immutable `source` and `source-scope` artifact versions.
- Quick Prototype is a separate one-shot source-to-playable path with an explicit 250,000-character ceiling and 8-40 passage target.
- Hardened passage planning, drafting, narrative review, and repair workflows already establish immutable plans, exact fingerprints, explicit authorization, bounded units, attempts, retry, cancellation, restart recovery, strict structured outputs, bounded repair, atomic completion, and post-provider freshness checks.
- The current application has `quick` and `long-form` project modes. Conversational creation must produce ordinary `long-form` projects rather than adding another project mode.
- The current Long-form creation screen asks for a working title and immediately exposes the full workflow. Conversational creation will progressively reveal this existing workspace rather than permanently adding every entry point to top-level navigation.

Earlier deterministic prototype analysis and adaptation routes are useful fixtures and terminology references, but their skeletal Bible/adaptation contracts and generic job runner are not sufficient for serious adaptation. New work must use the hardened post-foundation patterns.

## Authoritative artifact and dependency model

The target dependency shape is:

```text
Original project
  persisted conversation (non-canonical evidence)
    -> reviewed proposal
    -> Project Brief + Creative Direction
    -> Story Bible
    -> Routes -> Endings -> Mechanics
    -> accepted passage planning, drafting, review, simulation, repair, and publication

Adapted project
  immutable source + source scope
    -> approved Source Dossier
    -> approved Adaptation Intent
    -> reviewed bootstrap proposal
    -> Project Brief + Creative Direction + Story Bible + Routes + Endings + Mechanics
    -> accepted passage planning, drafting, review, simulation, repair, and publication
```

Project Brief and Creative Direction are peer foundation artifacts: the Brief owns story/project shape, while Creative Direction owns presentation. For new projects created after A1, both must be explicitly approved before new Bible generation or downstream AI-assisted production. In adapted projects, the approved Source Dossier is the exact prerequisite for A4 Adaptation Intent; the approved Source Dossier and approved Adaptation Intent are the exact required inputs to A5 bootstrap. Creative Direction is an output of A5, not a prerequisite for A4 or a required pre-existing input to A5.

An author may manually create Creative Direction before A4/A5. That artifact remains optional during A4. If it exists when A5 is planned, bootstrap binds its exact current base and must either preserve it unchanged or propose an explicit reviewed update. If it does not exist, A5 may propose its creation with a `must-not-exist` precondition. A5 never claims to depend on a Creative Direction version that the same bootstrap is creating.

Existing pre-A1 projects without Creative Direction remain readable, playable, exportable, recoverable, and historically valid. Studio must not silently infer and approve new direction for them. Provider-assisted work that requires Creative Direction instead presents a bounded migration/adoption review; after the author explicitly approves the artifact, current downstream work follows normal material-equivalence and staleness rules. Historical approvals and prose are never rewritten.

The Source Dossier is analytical canonical evidence about a particular source version and scope. Adaptation Intent is canonical author policy for using that evidence. Conversation summaries, inferred setup understanding, and assistant statements remain non-canonical even when they helped produce either artifact.

## Product entry points

The **Create** experience offers four choices within project creation or the Long-form entry surface:

1. **Talk through an original idea** - natural conversation leading to project-foundation proposals.
2. **Adapt an existing story** - supplied AO3 HTML, TXT, EPUB, or other supported manuscript input leading to bounded source analysis and adaptation-foundation proposals.
3. **Quick Prototype** - the existing fast source-to-playable workflow, unchanged.
4. **Advanced setup** - direct creation and editing through the existing structured Long-form workspace.

These choices need not become four permanent top-level tabs. After creation, original and adapted serious projects are ordinary Long-form projects. The project may remember its creation origin for provenance and onboarding, but origin is not a new project mode or a downstream fork.

## Interaction layers

### Director Mode

Director Mode is conversation-first. The author can begin messily, revise their intent, answer one or a few high-value questions at a time, and ask Studio to explain implications in creative language.

Studio reflects its current understanding, labels uncertainty, and avoids asking for low-value schema details prematurely. It may state, "Studio has enough to propose a draft foundation," but that is a non-canonical readiness assessment, not an approval or write.

Typing and saving a local message do not themselves generate or apply artifacts. An explicit assistant action may call a provider. A separate explicit proposal action creates immutable structured candidates.

### Review Mode

Review Mode presents proposed structured state in understandable groups, including:

- Project Brief;
- Creative Direction;
- Story Bible changes;
- relationship and character direction;
- route and ending implications;
- mechanics implications;
- source-evidence and override classifications;
- downstream staleness and work affected.

The author can apply all dependency-safe groups, apply selected groups, edit the proposal, reject it, or continue discussing. Preview is write-free. Apply is transactional and creates ordinary draft versions; it does not approve them.

### Advanced Mode

Advanced Mode is the existing detailed Studio: direct editors, histories, comparisons, restore, stable-ID navigation, validators, passage planning, drafting, review/accept/lock, simulation, repair, compilation, publishing, backup, Health, and recovery.

Mode changes alter presentation, not authority. All three modes resolve the same stable IDs, current heads, approved versions, locks, and stale state. A change made in Advanced Mode is immediately reflected in Director and Review views through current authoritative state.

## Shared Creative Direction model

### Ownership

`creative-direction` becomes a first-class versioned planning artifact shared by original projects, adapted projects, later conversational editing, and later separately planned world/visual systems.

The Project Brief continues to own premise, source mode, protagonist/project framing, size targets, route and ending targets, branching structure, content boundaries, and constraints. Creative Direction owns desired presentation: tone, pacing, prose treatment, and optional relationship-presentation direction.

New schema versions must remove ambiguous dual ownership. Legacy Brief `tone`/`pointOfView` and Bible `proseGuidance` remain readable in immutable historical versions, but current editing and new provider contexts must resolve one authoritative value. A deterministic compatibility projection may seed a Creative Direction draft from legacy current values; it must identify its exact source versions and may not fabricate author intent.

### Proposed version-1 contract

The exact TypeScript/Zod shape belongs to A1, but the durable concepts are fixed here.

**Identity and lifecycle**

- schema ID and version;
- stable artifact ID `creative-direction`;
- immutable artifact versions and one explicit current head;
- workflow status and exact approved version;
- exact dependencies/provenance;
- material-content fingerprint used by context and staleness checks.

**Tone**

- controlled descriptors such as intimate, wistful, warm, restrained, sensual, comedic, tense, bleak, hopeful, or uncanny;
- custom descriptors as bounded text;
- desired tonal range and tonal exclusions;
- optional act/route/relationship-specific variations by stable ID.

The controlled vocabulary is assistive, not exhaustive. Custom descriptors are first-class and survive round trips.

**Pacing**

- burn/development pace, including slow-burn when relevant;
- scene focus versus summary focus;
- action intensity;
- narrative density;
- transition density;
- quiet-scene allowance;
- escalation shape;
- custom pacing guidance.

**Prose**

- descriptiveness;
- long-form versus compact treatment;
- point of view and tense;
- interiority;
- dialogue integration rather than dialogue-only scripting;
- scene-transition density;
- passage/scene length preference distinct from the Brief's numeric word budget;
- voice/style descriptors;
- avoid list;
- custom prose guidance.

**Relationship presentation**

Relationship presentation is optional and supports romance, friendship, family, rivalry, partnership, ensemble relationships, and custom relationship kinds. It is not a romance-only schema.

The model supports a project default plus optional stable-ID-scoped profiles. Applicable profiles may include:

- relationship kind and participants/relationship IDs;
- escalation or development style;
- emotional tension;
- melodrama level;
- sensuality where relevant;
- physical-intimacy handling where relevant;
- visibility of relationship mechanics;
- custom guidance and content boundaries.

Romance-specific fields are absent or explicitly not applicable when a project/profile does not use them. A mystery, horror, adventure, drama, gen-fiction, friendship, or ensemble project must validate without romance configuration.

### Field provenance

Field provenance is durable evidence attached to an exact Creative Direction or generated artifact version, a stable entity when applicable, and a normalized field path. It is not freeform model reasoning.

Supported provenance references include:

- `user-message`: exact persisted message ID and bounded quoted excerpt or digest;
- `source-evidence`: source artifact version, chapter ID, excerpt ID, and optional reliable normalized range;
- `source-observation`: exact source-dossier observation version/ID;
- `approved-artifact`: artifact ID and exact approved version ID;
- `author-override`: exact adaptation-intent override ID/version;
- `manual-edit`: author action plus previous/new version IDs;
- `proposal`: proposal/group/operation and application audit IDs;
- `migration-derived`: deterministic compatibility source versions and rule version.

Within a live full-fidelity project, every reference must resolve inside the same project and survive history, backup, restore, and duplication. Portable privacy-redacted exports may intentionally omit source bodies, but every affected reference then carries an explicit unavailable/redacted state and expected source fingerprint; Studio never presents it as resolved or invents an explanation.

### Dependency and staleness semantics

- New Long-form planning/drafting/review contexts include the exact approved Creative Direction version relevant to their scope.
- Material Creative Direction changes mark dependent current planning/drafting/review work stale through the existing dependency system.
- No-op saves, lifecycle-only copies, or provenance display changes that leave material creative content equivalent do not create false staleness.
- Old versions and accepted prose remain byte-for-byte unchanged.
- Locked prose is never replaced by a Creative Direction change; new work is proposed through the accepted candidate/review path.
- A provider result cannot commit after its Creative Direction or other exact context dependency becomes stale while the request is in flight.

### Bounded context integration

Providers receive only the Creative Direction fields relevant to the selected task and scope, plus exact version/fingerprint metadata. A prose unit may receive project-level prose guidance and a scoped route/relationship variation; it must not receive unrelated profiles by default.

Context preview reports included Creative Direction version, included scopes, omitted records, serialized bytes, estimated tokens, and hard limits using known/estimated/unknown semantics.

## Original-project conversational setup

An original project may begin with an incomplete premise, a mood, a relationship, a scene, a genre, or a character fragment.

The assistant behavior is:

1. Persist the user's message locally with explicit scope.
2. On explicit assistant invocation, reflect a concise current understanding.
3. Identify uncertainty without turning every schema field into a question.
4. Ask one or a few high-value questions whose answers materially change the project.
5. Reuse bounded recent messages, a current non-canonical summary, and relevant pinned decisions.
6. When sufficient, offer an explicit **Preview foundation proposal** action.
7. Produce structured proposal groups for only the supported artifacts and fields.
8. Require review and deliberate transactional application.
9. Leave every resulting artifact in draft state until separately approved through normal Studio workflow.

Conversation understanding remains non-canonical. It may be represented through the accepted Foundation 8C summary/pinned-decision architecture and a bounded derived setup-readiness view. It cannot satisfy artifact prerequisites, exact-version checks, or approval gates.

## Source analysis architecture

### Pipeline

```text
supplied source
  -> immutable normalized source artifact
  -> explicit source scope
  -> deterministic chunk/section plan
  -> bounded analysis units
  -> immutable extracted observations
  -> deterministic merge and conflict surfacing
  -> versioned source dossier
```

### Ingestion and source identity

- Reuse current TXT, HTML/AO3-style HTML, and EPUB importers and their normalized chapter/block structure.
- Preserve stable chapter and excerpt IDs. For HTML/AO3, retain useful chapter boundaries, headings, and source ranges where the importer can guarantee them.
- Evidence references use immutable source version + chapter ID + excerpt ID, with an optional normalized character range and content digest when a block must be subdivided.
- Do not claim fragile paragraph numbers or original DOM positions unless the import contract explicitly preserves them.
- Imported source bodies stay local except for exact bounded units explicitly sent for analysis.
- Changing source or source scope creates new immutable versions and stales dependent analysis; it does not rewrite historical dossiers.

### Deterministic unit planning

- Prefer chapter boundaries, then heading/block boundaries.
- Split oversized chapters into ordered contiguous groups of normalized blocks.
- If one normalized block exceeds the unit limit, subdivide by deterministic normalized character ranges and record range hashes.
- Unit IDs and order derive from source version, scope version, analysis-policy version, and exact included evidence ranges.
- Preview reports source bytes/characters, selected chapters, unit count, estimated input scale, selected provider/model, output limits, and expected dossier categories.
- If required evidence cannot fit within hard bounds, fail locally before a provider call rather than silently omit it.

### Analysis outputs

Each unit returns strict, versioned observations rather than a partial Bible. An observation includes:

- stable observation ID;
- category;
- concise claim;
- origin classification (`source-canon` or `inference` during A3);
- exact evidence references;
- confidence/uncertainty where useful;
- involved character/location/object/event IDs or provisional identity keys;
- temporal position where supported;
- contradiction/ambiguity links;
- unit, attempt, provider/model, schema, and context fingerprints.

Unit output is immutable. Malformed, oversized, ungrounded, or cross-source output fails validation and cannot enter dossier consolidation.

### Deterministic merge and reconciliation

Consolidation deterministically groups compatible observations, preserves evidence sets, and surfaces conflicts. It never silently resolves contradictions by choosing whichever provider statement arrived last.

Entity reconciliation uses normalized identity keys plus explicit evidence and produces reviewable uncertain matches. AI assistance may later propose a bounded reconciliation, but applying it remains explicit and its output is validated. Deterministic fixture input must always produce the same dossier fingerprint.

### Source dossier

The source dossier is a versioned analytical artifact, distinct from the adaptation Story Bible. At minimum it contains:

- premise and source scope;
- protagonist and point-of-view observations;
- major characters and identity aliases;
- relationships;
- locations and institutions;
- world facts and rules;
- timeline and chronology;
- major events;
- turning points;
- themes;
- tone and style;
- prose characteristics;
- important objects;
- character knowledge where relevant;
- ambiguities and contradictions;
- unresolved threads;
- exact source evidence and analysis provenance.

During A3, dossier records may be `source-canon` or `inference`. Adaptation-only invention and author overrides belong to later artifacts and must not be smuggled into source analysis.

### Source-analysis corrections

A source-analysis correction means Studio analyzed the supplied source incorrectly. It is part of A3 analytical review and is categorically different from an A4 author override.

Corrections cover at least:

- a wrong character identity;
- two characters incorrectly merged;
- one character incorrectly split;
- a wrong relationship;
- a canon fact unsupported by its evidence;
- an inference incorrectly labeled source canon;
- source canon incorrectly labeled inference;
- a wrong timeline, event, character, location, or object association.

The original extracted observation and provider provenance remain immutable and auditable. Review creates a new corrected analytical version linked to the observation/version it supersedes. Correction operations include field correction, identity merge, identity split, rejection as unsupported, evidence replacement/addition/removal, and explicit classification change. Every corrected claim must retain exact source evidence or be rejected/marked unsupported; a reviewer cannot turn an unsupported interpretation into source canon by assertion alone.

Merge and split operations preserve identity lineage. A merge records every prior analytical identity and the resulting stable dossier identity. A split records the source identity, each resulting identity, and the exact evidence assigned to each. Downstream dossier references are deterministically remapped or surfaced for review rather than silently orphaned.

The dossier's effective current view is the latest reviewed correction state over immutable extracted observations. Dossier approval applies to that corrected analytical version. The UI shows original observation, corrected state, evidence, classification change, reviewer action, and lineage together.

An A3 correction says, "Studio's account of the source was wrong." An A4 override says, "The source says X, but I intentionally want this adaptation to use Y." Corrections repair source analysis; overrides preserve the source analysis and layer adaptation policy over it. Their provenance types, controls, and history must never be interchangeable.

## Canon, inference, override, and adaptation-only semantics

### Source canon

A claim directly supported by one or more exact source evidence references. The claim remains tied to the source version analyzed. Example: "Haru works at the design office."

Source canon can be corrected through the explicit A3 source-analysis correction workflow, producing a new dossier version while retaining the original observation and lineage. It is never rewritten merely because the adaptation changes it.

### Inference

A bounded interpretation not explicitly stated by the source, with supporting evidence and visible uncertainty. Example: "Haru appears to notice Ren's anxiety before Ren acknowledges it."

Inference is never displayed as direct canon. An author may accept it as adaptation guidance without changing its source classification.

### Author override

An explicit author instruction that changes, narrows, expands, or reinterprets a source-derived fact for this adaptation. Example: "Keep Haru in the city on alternate routes."

An override records its target source/dossier facts, exact author message or manual edit, scope, rationale, and adaptation effect. It does not alter the original source-canon record.

### Adaptation-only

New material created for the interactive adaptation. Example: "Add a rooftop confession route."

Adaptation-only records may cite the author request, Creative Direction, or approved project state, but must not claim source support that does not exist.

### Conflict resolution

When source canon and an override differ, the UI shows both:

```text
Source fact -> explicit override -> adaptation consequence
```

Validators and provider contexts use the source fact for fidelity analysis and the active override for adaptation behavior. Removing an override reveals the unchanged source fact again and deterministically stales work that depended on the override.

## Adaptation fidelity model

The product does not use one vague "faithful" slider. Adaptation intent stores explicit policy across at least:

- character fidelity;
- world/canon fidelity;
- tonal fidelity;
- structural fidelity.

Each dimension uses bounded levels with plain-language consequences and scoped exceptions. The exact enum is fixed in A4, but must distinguish strict preservation, strong preservation with documented exceptions, flexible reinterpretation, and open invention.

Friendly presets expand deterministically into explicit policies:

- **Faithful** - strong character, world, tone, and structural preservation; documented condensation still allowed.
- **Faithful with meaningful divergence** - strong character/world/tone preservation with planned structural branches and consequences.
- **Loose adaptation** - recognizable source foundations with broader structural and tonal change, all exceptions explicit.
- **Inspired by source** - source influence remains attributable, but the adaptation may substantially reinterpret characters, world, tone, and structure.

The stored authoritative state is the expanded dimensional policy, not only the preset label. The author can override any dimension or stable-ID-scoped exception. Changing the preset later shows the exact field changes before application.

## Preserve-canon-route semantics

`preserveCanonRoute` is a first-class adaptation-intent policy, not a marketing promise.

### Requested canon preservation - A4

A4 records requested preservation before Routes, Endings, or a Passage Plan exist. Its authoritative contract includes:

- source-dossier major events and turning points selected as canon-route obligations have stable IDs;
- source-ending obligations have stable IDs and exact dossier evidence;
- required character, world, tone, and structural fidelity intent is explicit;
- allowed condensation or substitution policy is explicit;
- reviewed obligation-specific exceptions retain rationale and provenance.

At this stage the UI may say **Canon route requested**. It must not say **Canon route preserved**, because no generated route graph exists yet and reachability cannot be proven.

### Achieved canon preservation - A5 and downstream

A5 maps requested obligations to exact generated route, act, and ending IDs and reports each as `represented`, `condensed`, `intentionally-changed`, `blocked`, or `pending-passage-validation`. It validates structural ordering and coverage available at the foundation level, but does not claim runtime reachability before a Passage Plan exists.

After Routes, Endings, and the Passage Plan exist, downstream validation extends the mapping to exact sequence, passage, and choice IDs and must:

- validate obligation order and coverage;
- demonstrate at least one legal path through the approved graph;
- demonstrate source-ending reachability where structurally possible;
- keep the source-ending path distinguishable from adaptation-only alternatives;
- show where alternate branches diverge, reconverge, or intentionally replace an obligation;
- report missing, reordered, condensed, intentionally changed, or blocked obligations;
- prevent publication/readiness UI from claiming preservation when required mapping or reachability is absent.

Preservation does not require exact scene-by-scene replication when source and target scales differ. Requested intent remains visible beside achieved evidence so the author can distinguish what was asked for from what the current structure has actually proven.

## Planned expansion, not prose inflation

Adaptation planning records source size and target interactive size as known or estimated values. A 10,000-word source becoming a 25,000-word adaptation requires a structural expansion plan, not repeated description.

Expansion opportunities may include:

- missing setup and payoff;
- skipped time periods;
- relationship-development beats;
- side-character interactions;
- route-exclusive scenes;
- consequences of alternate decisions;
- optional quieter scenes;
- investigation or exploration consequences;
- alternate endings and epilogues.

Each accepted expansion item has a stable ID, rationale, target scope, estimated word allocation, dependency, and origin classification. It is `adaptation-only` unless source evidence supports a canon/inference classification. Route, act, ending, passage, and typical-playthrough budgets must reconcile before passage drafting.

## Foundation bootstrap behavior

Bootstrap consumes an exact approved source dossier plus exact approved adaptation intent for adapted projects, or exact conversational setup inputs for original projects. It produces a multi-artifact proposal bundle containing draft candidates for:

- Project Brief;
- Creative Direction;
- Story Bible;
- Routes;
- Detailed Endings;
- Mechanics.

It does not produce a passage plan or prose.

Each candidate records exact source/dossier/intent/message/approved-artifact dependencies, schema versions, context fingerprints, provider attempts, and field provenance. New artifact creation uses a `must-not-exist` precondition; replacement uses an exact current base version. Creative Direction is normally one of the bootstrap outputs. If a current Creative Direction already exists, bootstrap binds that exact base and either preserves it or proposes a reviewed replacement; otherwise no Creative Direction input dependency exists.

Bootstrap also creates the first achieved-canon-preservation assessment when requested. It maps obligations to generated route/act/ending stable IDs and reports foundation-level coverage honestly, including `pending-passage-validation` where graph proof must wait for the Passage Plan. It cannot label the canon route preserved solely from A5 output.

Review groups may be applied selectively only when their dependency closure is complete. A selected multi-artifact application runs validation and staleness preview against the full effective state, then creates all selected ordinary draft versions and application audits in one SQLite transaction. If any candidate, base, schema, reference, provenance link, or workflow update fails, none of the selected artifacts change.

Nothing is approved automatically. After application, the ordinary Long-form workflow guides the author through explicit review and approval. Existing advanced editors can immediately open and edit every resulting draft.

## Conversational editing behavior

Requests such as these are supported:

- "Make Haru more prideful."
- "Reduce the comedy."
- "Make the middle warmer."
- "Preserve the canon ending but add a happier route."
- "Make relationship mechanics less visible."

The system:

1. resolves explicit visible scope and candidate authoritative stable IDs;
2. asks a focused clarification when material ambiguity remains;
3. builds bounded context from exact current/approved state, relevant source evidence, Creative Direction, active overrides, and relevant non-canonical author memory;
4. proposes exact domain operations using the existing mutation vocabulary or a compatible extension of it;
5. explains each group's durable evidence and expected effect;
6. materializes the effective selected state without writes;
7. runs current cross-artifact, passage-plan, prose-lock, and publication constraints as relevant;
8. displays downstream staleness and work affected;
9. permits dependency-safe selection;
10. applies all selected operations atomically through the shared canonical application service.

A6 must generalize the accepted planning/repair application machinery where necessary; it must not implement a second mutation engine. Application never invokes a provider. Accepted or locked prose is protected: a prose-affecting request creates or routes to an ordinary candidate draft and review flow.

## Provider, context, and cost boundaries

### Explicit actions

- Typing, reading history, editing fields manually, inspecting source evidence, and reviewing/applying an existing proposal are local.
- Sending a message to an AI assistant is an explicit provider action and is labeled as such.
- Expensive source analysis and foundation bootstrap require separate preview, persisted plan, exact fingerprint authorization, and explicit start.
- A conversational message never implicitly starts foundation generation merely because the author submitted it.

### Bounded execution

All conversational interpretation, source analysis, dossier reconciliation when AI-assisted, bootstrap, and editing generation must have:

- versioned request and output schemas;
- exact immutable input versions and fingerprints;
- deterministic context construction;
- hard input/output/serialized-byte limits;
- bounded unit counts and attempt counts;
- cancellation and restart recovery;
- at most the explicitly configured bounded structural repair;
- a post-provider freshness check inside or immediately adjacent to the atomic completion transaction;
- no candidate or completion record after a stale or cancelled response;
- deterministic offline providers for unit, integration, and browser tests.

Credentials remain server-side. No CI or acceptance test makes a live or paid call.

### Preview and cost semantics

Before source analysis or bootstrap, show:

- source size and selected scope;
- deterministic unit count;
- estimated input/output scale;
- provider and model;
- context/output hard limits;
- retry/repair ceiling;
- expected artifacts and evidence;
- candidate downstream impact;
- cost as known, estimated range, or unknown.

Provider-reported historical usage is exact when recorded. Prospective token and cost calculations are estimates. Missing price or usage information remains unknown; partial totals are labeled partial. Studio never invents exact cost or silently fetches/reprices historical work.

## Source-evidence portability and privacy

Adapted projects have two explicit portable archive modes. The selected mode and the evidence availability of every source-grounded reference are part of the archive manifest; omission is never represented as successful evidence resolution.

### Full-fidelity archive

- Includes the immutable source artifact and selected scope, dossier and correction history, adaptation intent, evidence ranges, and all provenance required to resolve exact source-grounded claims.
- Import validates source identity, normalized-content fingerprint, chapter/excerpt/range identity, and project-owned references before making the imported project available.
- Normal verified backup/restore remains full fidelity. It must not silently become privacy-redacted or lose source evidence; a redacted share archive is not a substitute for a recoverable backup unless the author explicitly accepts that limitation.

### Privacy-redacted archive

- May omit source bodies only through an explicit privacy choice. The manifest records each omission, the expected source fingerprint and normalization contract, and evidence state as `redacted` or `unavailable` rather than resolved.
- Dossier, intent, and other selected metadata may remain readable, but the UI identifies source-grounded evidence as unavailable and does not display it as verified against an included source.
- Source-grounded provider work, correction, re-analysis, and evidence-dependent bootstrap/editing are blocked until the exact source is reattached and its normalized-content fingerprint is verified. A mismatch imports as a distinct source and cannot silently relink historical evidence.
- Reattachment restores availability without rewriting immutable historical artifacts or evidence references.

### Duplication and identity

- A full project duplicate copies the source and remaps project-owned source artifact/version IDs and every dependent provenance reference transactionally. Content-derived chapter/excerpt/range identities may remain stable when their source fingerprint is unchanged; the duplicate records the complete old-to-new identity map.
- A duplicate made from privacy-redacted data retains explicit unavailable/redacted evidence descriptors and expected fingerprints. It must not create dangling references that appear valid or invent replacement evidence.
- Export, import, duplication, backup, and restore preserve the distinction between source present, source redacted, and source missing.

## Quick Prototype boundary

Quick Prototype remains:

```text
source -> fast playable prototype
```

It keeps its existing 250,000-character ceiling, 8-40-passage shape, one-shot structured generation, and direct playable/Twee output unless separately changed by a future accepted plan.

The serious adaptation path is **Adapt an existing story** because it analyzes evidence first, captures intent, and creates draft Long-form foundations without premature prose.

A future **Continue in Long-form Studio** bridge may be investigated after A7. It must convert through explicit reviewable artifacts and cannot treat Quick output as automatically approved production state. The bridge is not required by this roadmap.

## World, visual, audio, and operator boundary

This roadmap explicitly defers:

- explorable locations and hub navigation;
- inventory, items, shops, and broader world systems;
- time and NPC schedules;
- sprites, backgrounds, CGs, and other visual assets;
- image generation or image search;
- audio and game-style presentation;
- MCP/Codex operator integration.

Those belong to a later separately approved **World & Visual Game Expansion** roadmap. Creative Direction and conversational scope/provenance must remain general enough to configure those future systems, but A1-A7 do not implement them.

## Checkpoint protocol

The roadmap is strictly sequential:

```text
A1 -> commit -> push -> CI -> external review -> scoped fixes -> accepted SHA
   -> A2 -> same gate
   -> A3 -> same gate
   -> A4 -> same gate
   -> A5 -> same gate
   -> A6 -> same gate
   -> A7 -> same gate
```

Do not begin a checkpoint until the immediately preceding checkpoint has an externally accepted SHA. Do not combine multiple checkpoints into one implementation commit. Every checkpoint uses deterministic offline providers and the repository's normal lint, typecheck, test, build, and browser verification unless its accepted implementation request narrows or expands that gate.

## A1 - Creative Direction Core

### Outcome

Studio has one shared authoritative Creative Direction artifact with field provenance, exact dependency semantics, validation, direct editing, history, approval, and bounded context integration for both original and adapted Long-form projects.

### In scope

- Versioned Creative Direction schema and defaults that do not assume romance.
- Tone, pacing, prose, optional relationship-presentation, custom guidance, and scoped variations.
- Exact field-provenance records and **Why is this set?** data contract.
- Current/approved workflow state, history, compare, restore, export, and stable-ID sections.
- Material-equivalence and deterministic staleness rules.
- Bounded context integration into relevant existing assistant, passage planning/drafting, narrative review, and repair inputs.
- Clear ownership/migration of legacy Brief tone/POV and Bible prose guidance.
- Direct Advanced Mode editor plus a compact friendly summary suitable for Director/Review views.

### Out of scope

- Source-analysis jobs or source dossiers.
- Conversational project bootstrap.
- Adaptation-intent policies.
- Passage generation or new prose-generation behavior.
- World, visual, audio, or MCP fields.

### Durable contracts

- `creative-direction` is an ordinary immutable planning artifact with an exact approved version.
- Field provenance is linked to exact output version and resolvable evidence; it is not private reasoning.
- New material dependencies reference exact Creative Direction versions.
- Stable IDs and normalized field paths survive reordering, export/import, backup/restore, and duplication.
- Material content and provenance metadata have separate fingerprints so explanation-only maintenance does not create false narrative staleness.

### Provider boundary

Manual creation/editing, history, approval, provenance inspection, and context preview are provider-free. Existing AI workflows may consume Creative Direction, but A1 adds no source-analysis provider and makes no automatic call.

### UI

- Friendly Creative Direction summary and progressive sections.
- Full Advanced editor.
- Optional relationship controls appear only when applicable.
- **Why is this set?** opens durable evidence without exposing chain-of-thought.
- Legacy-derived fields are clearly labeled for review.

### Migration/schema expectation

An additive SQLite migration is likely for field-provenance/application lineage; generic artifact storage may carry Creative Direction itself. Freeze the immediately preceding schema fixture, migrate copies only, and preserve all existing projects and immutable history. Existing projects receive no invented AI content and are never auto-approved because of inferred intent. If deterministic legacy projection is used, it creates explicitly `migration-derived` reviewable state tied to exact old versions.

### Tests

- Schema and cross-field validation across romance and non-romance genres.
- Exact provenance resolution and invalid cross-project evidence rejection.
- Material/no-op staleness behavior.
- Artifact lifecycle, history, comparison, restore, export/import, backup/restore, and duplication.
- Bounded context inclusion/omission diagnostics.
- Browser flows for friendly and advanced editing plus **Why is this set?**.
- Frozen-schema migration, rollback, corruption, and future-version behavior.

### Large-source behavior

A1 sends no source corpus. Creative Direction context is scope-filtered and bounded regardless of project size.

### Failure modes

Reject invalid provenance, ambiguous ownership, stale bases, cross-project links, oversized custom guidance, unsupported schema versions, and partial multi-record saves transactionally. Preserve old versions and downstream prose.

### Compatibility

Quick Prototype remains unchanged. Existing Long-form projects remain readable/playable/exportable. Legacy presentation fields remain readable in historical versions while the UI guides explicit adoption of the shared artifact.

### External acceptance criteria

- One canonical Creative Direction model works for original, adapted, romance, friendship, mystery, horror, adventure, drama, and gen projects.
- Exact approval/version/provenance survives reload, export/import, backup/restore, and duplication.
- Relevant provider contexts include only the exact approved scoped direction.
- Material changes stale the correct work; no-op/provenance-only changes do not.
- No source analysis or prose is generated.

### Recommended model

**Sol High**, because schema ownership, compatibility, provenance lineage, migration, and cross-workflow staleness are correctness-sensitive.

## A2 - Conversational Project Setup

### Outcome

An author can turn a messy original idea into reviewable draft Long-form foundation proposals through focused conversation, without learning the internal artifact model first.

### In scope

- Director Mode setup conversation for original projects.
- Bounded non-canonical understanding using Foundation 8C summaries and pinned decisions.
- Focused question selection, uncertainty display, and readiness messaging.
- Structured proposals for Project Brief, Creative Direction, Bible/character/relationship seeds, high-level goals, and optional early ending/mechanics intent when justified.
- Review Mode with apply-all, dependency-safe selective apply, edit, reject, and continue-discussing actions.
- Provider/context preview and explicit invocation.

### Out of scope

- Source upload analysis.
- Adaptation fidelity, canon preservation, or source evidence.
- Full route/ending/mechanics generation when the conversation does not support it.
- Passage planning or prose.
- Automatic approval.

### Durable contracts

- Understanding/readiness state is explicitly non-canonical.
- Every proposal records exact message range, summary/decision versions, current artifact bases or `must-not-exist`, schema versions, context fingerprint, provider attempts, and field provenance.
- Proposal groups use the accepted stable-ID operation and dependency model.
- Application creates normal draft versions through the shared transaction boundary.

### Provider boundary

Messages are stored/read locally. An explicit **Ask Studio** action may call a provider. **Preview foundation proposal**, plan authorization, and start are distinct for multi-artifact generation. Review and apply are local.

### UI

- Creation entry **Talk through an original idea**.
- Director conversation with one/few questions and concise reflected understanding.
- Visible uncertainty and **Studio has enough to propose a draft foundation** readiness state.
- Review Mode cards organized by creative consequence, with Advanced details on demand.

### Migration/schema expectation

Likely additive records for setup proposal plans, candidates, application audit, and message-to-field provenance. Reuse conversations, author memory, artifacts, workflow, and change operations. Do not add a new project mode.

### Tests

- Messy/minimal premise, genre-only, character-only, and conflicting-message flows.
- Non-romance and optional-romance direction.
- No provider call from typing, reading, or applying.
- Deterministic offline interpretation and proposal fixtures.
- Stale message/artifact base, malformed output, cancellation, retry, repair, restart recovery, and late-response race.
- Atomic multi-artifact apply and rollback.
- Browser journey that creates a sophisticated draft project without exposing internal lineage terminology.

### Large-source behavior

No source corpus is involved. Conversation context obeys accepted summary/message/decision limits and fails before provider execution if required context exceeds hard bounds.

### Failure modes

Insufficient information remains discussion, not invented project state. Ambiguous scope triggers clarification. Malformed, oversized, stale, cancelled, or late provider output creates no candidate/application. Failed application creates no partial artifacts.

### Compatibility

Advanced setup remains available. Projects created conversationally are ordinary Long-form projects and can immediately use all existing direct editors and histories.

### External acceptance criteria

- A new author can reach a coherent draft Brief + Creative Direction + useful Bible seeds through a short browser conversation.
- No artifact changes before explicit reviewed application.
- Resulting drafts and provenance are identical when opened in Review or Advanced Mode.
- No passages or prose are generated.

### Recommended model

**Terra High**, because this is primarily bounded product UX and full-stack proposal integration over contracts established in A1; use Sol High if the implementation substantially changes the shared transaction boundary.

## A3 - Source Analysis

### Outcome

Studio can analyze a large supplied story in bounded resumable units and produce an immutable, evidence-grounded source dossier without adaptation invention.

### In scope

- Serious-adaptation import and explicit source-scope selection.
- Immutable source artifact and deterministic chunk/section plan.
- Bounded analysis plans, jobs, units, attempts, cancellation, retry, restart recovery, and progress.
- Strict observation schema with exact evidence references.
- Deterministic merge, identity reconciliation, ambiguity, and contradiction surfacing.
- Explicit source-analysis correction operations for field correction, merge, split, rejection, evidence repair, and canon/inference reclassification.
- Source dossier lifecycle, review UI, history, comparison, restore, and export.
- Deterministic offline analysis provider and stubbed real-provider/OpenRouter boundary.

### Out of scope

- Author overrides, adaptation-only invention, fidelity policy, or canon-route design.
- Foundation bootstrap.
- Passage planning or prose.
- Automatic approval of dossier interpretations.

### Durable contracts

- Source, scope, chunk plan, contexts, unit outputs, observations, dossier versions, and provenance are immutable and fingerprinted.
- Evidence references resolve to exact source version + chapter/excerpt/range identity.
- Dossier facts distinguish source canon from inference.
- Original observations remain immutable; corrected analytical versions retain supersession, evidence, classification, and merge/split identity lineage.
- Dossier approval binds the reviewed corrected analytical state, never an unreviewed provider aggregate.
- Consolidation is deterministic and preserves conflicts.
- No provider output becomes canonical source evidence without local schema and evidence validation.

### Provider boundary

Import, scope selection, unit preview, dossier browsing, consolidation, and review are local. Analysis starts only after exact plan authorization. Requests use server-side credentials and bounded source excerpts. CI uses deterministic offline providers only.

### UI

- **Adapt an existing story** entry and source/import summary.
- Chapter/scope selection with source size and unit preview.
- Progress by unit without fabricated percentage.
- Evidence inspector that opens the exact source excerpt.
- Dossier review organized by character, relationship, location, timeline, event, theme, prose, object, ambiguity, and contradiction.
- Correction review showing original observation beside corrected state, evidence changes, classification changes, rejection status, and identity lineage.
- Distinct labels and controls for **Correct analysis** in A3 versus **Override for adaptation** in A4.

### Migration/schema expectation

Additive schema work is expected for analysis plans/jobs/units/attempts/observations, source-dossier heads, and evidence indexes. Preserve current `source` and `source-scope` artifacts and existing importer IDs. Freeze schema fixtures and test transactional migration rejection.

### Tests

- TXT, AO3-like HTML, generic HTML, and EPUB fixtures, including Unicode.
- Stable chapter/excerpt identity and reliable subdivision ranges.
- Oversized chapter/block unit planning and local hard-bound failure.
- Exact evidence grounding, cross-source rejection, ambiguity, and contradiction retention.
- Wrong identity, merge, split, relationship, timeline/event association, unsupported claim, and canon/inference reclassification corrections.
- Immutable original-observation audit, corrected-version history, identity-reference remapping, unsupported-observation rejection, and approval of the corrected effective dossier.
- Deterministic merge/fingerprint under retries and different completion order.
- Cancellation, restart recovery, attempt ceilings, malformed/oversized output, stale source/scope, and in-flight mutation race.
- Large-manuscript browser flow with metadata-first lists and one selected evidence body at a time.

### Large-source behavior

No whole-work prompt. Unit planning is bounded by source blocks/ranges and provider context limits. Completed valid units survive interruption; retry never repeats completed immutable work unnecessarily. Consolidation uses bounded metadata passes and explicit conflict groups rather than loading every full excerpt into one provider request.

### Failure modes

Unsupported/encrypted input, invalid UTF-8, oversized import, unstable evidence range, context overflow, provider failure, ungrounded observation, duplicate/conflicting identity, invalid merge/split lineage, evidence-free correction, stale source/scope, cancellation, and migration failure all preserve source and completed evidence without partial dossier publication.

### Compatibility

Current imports continue to load. Quick Prototype remains unchanged. Historical source artifacts remain immutable. A source dossier is a new Long-form artifact, not a rewrite of the existing Story Bible.

### External acceptance criteria

- A representative large multi-chapter source can be imported, previewed, interrupted, resumed, consolidated, and inspected with exact evidence.
- Canon and inference are visibly distinct; contradiction is preserved.
- Incorrect analysis can be corrected, merged, split, rejected, or reclassified while the original observation and exact evidence remain auditable.
- Dossier approval uses the reviewed corrected analytical state, and no correction is represented as an adaptation override.
- No adaptation-only proposal or passage prose is produced.
- Every non-provider inspection/review operation works offline.

### Recommended model

**Sol High**, because large-source partitioning, evidence integrity, resumable job lineage, migration, and no-late-commit behavior are high-risk architectural work.

## A4 - Adaptation Intent

### Outcome

The author can explicitly define how the adaptation may preserve, reinterpret, diverge from, and expand the source, with source canon, inference, overrides, and invention kept distinct.

### In scope

- Adaptation-intent artifact and direct/conversational editing.
- Dimensional fidelity policies and friendly preset expansion.
- Explicit author overrides linked to source dossier records.
- Adaptation-only invention records.
- Requested-canon-preservation policy, source/source-ending obligations, allowed condensation/substitution, and reviewed exceptions.
- Source-to-target expansion plan and allocation rationale.
- Validation, provenance, history, comparison, restore, and approval.

### Out of scope

- Generation of Brief/Bible/routes/endings/mechanics from the intent.
- Passage planning or prose.
- Guaranteeing exact scene replication.
- Quick Prototype conversion.

### Durable contracts

- Exact approved source dossier dependency. Creative Direction is optional and is not an A4 prerequisite.
- Separate immutable source fact, inference, override, and adaptation-only records.
- Presets expand to stored explicit dimensional policy.
- Requested canon-route obligations and exceptions have stable IDs and evidence, without claiming achieved graph reachability.
- Expansion items have origin, scope, rationale, budget, and dependency.

### Provider boundary

Manual configuration and validation are local. Conversational suggestions require explicit provider invocation and return reviewable operations. Apply and approval are provider-free.

### UI

- Friendly fidelity preset with visible dimension summary.
- Manual per-dimension and stable-ID exception controls.
- Side-by-side source fact, override, and adaptation effect.
- Requested-canon-preservation obligation matrix labeled **Canon route requested**, never **Canon route preserved** at A4.
- Source/target length and structural expansion review.

### Migration/schema expectation

Use ordinary artifact versions plus additive provenance/index records if A1/A3 storage is insufficient. No rewrite of historical source dossier contents. Existing Brief `adaptationFidelity` becomes a legacy compatibility input, not a second authoritative slider.

### Tests

- Deterministic preset expansion and manual override.
- Round-trip history/export/import/backup of every origin category.
- Override removal revealing unchanged source fact.
- Requested canon-route obligation/evidence validation and reviewed exceptions, with zero claims of achieved route or ending reachability.
- Expansion budget reconciliation and non-inflation browser scenarios.
- Stale dossier/proposal bases and atomic rollback; an absent Creative Direction must not block A4.

### Large-source behavior

Intent references dossier IDs and bounded evidence previews; it never resends the whole source. Large obligation and expansion lists use metadata-first pagination/filtering and stable-ID navigation.

### Failure modes

Reject orphaned evidence, override targets from another project/version, contradictory active overrides without explicit resolution, unsupported requested obligations, unknown cost/length represented as exact, and partial application. A4 must reject any output that claims achieved route/graph preservation before structure exists.

### Compatibility

Existing Long-form projects can adopt intent explicitly. Historical Brief fidelity fields remain readable. Original projects may omit source-specific adaptation intent entirely.

### External acceptance criteria

- Presets are transparent expanded policies, not opaque labels.
- Source canon remains unchanged when overrides are added or removed.
- Requested canon preservation is explicit, evidence-linked, and visibly distinct from later achieved preservation.
- A4 works without any Creative Direction artifact and never claims route/ending reachability.
- Expansion is represented as planned structure with origin and budget.
- No foundation artifacts or prose are generated.

### Recommended model

**Terra High**, because the main work is contract-backed product configuration and review UX; use Sol High for any migration or cross-artifact authority changes uncovered during implementation.

## A5 - Long-form Foundation Bootstrap

### Outcome

An adapted project's approved dossier and approved adaptation intent can produce one reviewable, provenance-complete bundle of draft Long-form foundations that enters the accepted workflow without bypassing approvals.

### In scope

- Exact bootstrap input snapshot and deterministic scope/context planning.
- Bounded generation plans/jobs/units/attempts with preview, authorization, cancellation, retry, recovery, and no-late-commit.
- Strict candidates for Brief, Creative Direction, Bible, Routes, Detailed Endings, and Mechanics.
- Optional binding to an exact pre-existing Creative Direction base, with explicit preservation or a reviewable proposed update; absence is a valid bootstrap precondition.
- Initial achieved-canon assessment mapped to exact proposed route, act, and ending IDs, with passage-level reachability left pending until the required graph exists.
- Cross-artifact identity/reference reconciliation.
- Multi-artifact Review Mode with dependency groups, diffs, provenance, validation, and staleness impact.
- Atomic application to ordinary draft versions and immutable audit.
- Deterministic offline bootstrap provider and stubbed OpenRouter boundary.

### Out of scope

- Passage plan or passage prose.
- Automatic approval or automatic continuation into drafting.
- A special AO3 downstream pipeline.
- General conversational editing of arbitrary established projects; that is A6.

### Durable contracts

- Bootstrap binds the exact approved dossier, exact approved intent, message/decision, schema, policy, provider/model, and context fingerprints.
- Creative Direction is an A5 output: when none exists, its candidate uses an exact `must-not-exist` precondition; when one already exists, A5 binds that exact optional base and either preserves it or proposes an explicit reviewed update. Bootstrap never requires the Creative Direction version it is creating.
- Requested A4 canon obligations map to exact proposed route, act, and ending IDs with explicit represented, condensed, intentionally changed, blocked, or pending-passage-validation status. A5 cannot label a canon route preserved before passage/choice reachability is validated downstream.
- Absent/current artifact preconditions are exact.
- Candidate IDs and cross-artifact references are deterministic or explicitly remapped before review.
- Selected dependency closure validates as one effective project state.
- Transactional apply creates all selected drafts and audit or none.

### Provider boundary

Preview, plan persistence, review, validation, and apply are local. Explicit authorization and start precede provider use. CI uses deterministic offline providers. No provider is called during application.

### UI

- Cost/context preview before generation.
- Unit/job progress and retry-safe recovery.
- Foundation overview followed by artifact/group/detail drill-down.
- Source/override/adaptation-only provenance on affected fields.
- Clear statement that resulting artifacts are drafts and require ordinary approval.

### Migration/schema expectation

Additive bootstrap plan/job/unit/attempt/candidate/application records are expected, preferably modeled after hardened drafting/review/repair aggregates. No destructive rebuild. Preserve all current project, source, dossier, intent, planning, passage, prose, and operational history.

### Tests

- Complete deterministic adapted-project bootstrap.
- Exact candidate references and provenance.
- Requested obligations mapped to exact proposed route/act/ending IDs, honest pending-passage-validation status, and no premature **Canon route preserved** claim.
- Malformed, oversized, ungrounded, duplicate-ID, and invalid-reference outputs.
- Cancellation/retry/recovery and provider race after dossier/intent mutation and, only when bound as an optional base, pre-existing Creative Direction mutation.
- Stale absent/current preconditions.
- Dependency-safe selection and full rollback after simulated failure late in application.
- Browser review proving nothing is approved and no prose exists afterward.

### Large-source behavior

Bootstrap consumes the bounded dossier and selected evidence summaries, not the complete source. Required evidence that cannot fit causes local replanning/failure rather than silent omission. Units split by artifact or coherent dependency group under fixed bounds.

### Failure modes

Any stale dependency, stale bound optional Creative Direction base, invalid evidence, unresolved required identity, schema failure, context overflow, provider interruption, cancellation, or application error leaves canonical artifacts unchanged and the job in a deterministic resumable or terminal state.

### Compatibility

Applied artifacts are ordinary Long-form artifacts opened by existing Advanced Mode editors. Existing manual projects are unaffected. Quick Prototype remains separate.

### External acceptance criteria

- An approved source dossier and approved adaptation intent can produce all six draft foundation artifacts through bounded offline-tested work, whether or not Creative Direction existed beforehand.
- Review shows exact provenance and downstream effects.
- Canon obligations have exact proposed structural mappings and honest achieved-status reporting; passage-level preservation remains pending until the graph can prove it.
- One forced late failure proves no partial artifact application.
- Resulting project proceeds through normal approvals and existing passage planning.
- No passage plan or prose is generated.

### Recommended model

**Sol High**, because cross-artifact generation lineage, exact preconditions, transactional application, and recovery are data-integrity-sensitive.

## A6 - Conversational Editing

### Outcome

Authors can request scoped natural-language changes anywhere in an established Long-form project's supported structured planning state and receive exact reviewable operations through the existing authority boundaries.

### In scope

- Intent/scope resolver over visible project, artifact, section, and stable entity IDs.
- Bounded impact discovery across Brief, Creative Direction, Bible, Routes, Endings, Mechanics, and passage-plan entities.
- Exact structured proposal groups with durable explanations.
- Effective-state preview, current validation, downstream staleness, and lock protection.
- Dependency-safe selective application through the shared mutation engine.
- Explicit routing of prose-related requests to ordinary candidate draft workflows.
- Conversation continuity using bounded summaries and relevant pinned decisions.

### Out of scope

- Automatic repair from validation/simulation findings beyond accepted Foundation 6.
- Silent accepted/locked prose replacement.
- Unbounded whole-project rewriting.
- New world/visual/MCP entities.

### Durable contracts

- Resolved targets, exact bases, generated IDs, dependencies, evidence, and expected staleness are immutable proposal data.
- Operations reuse/generalize accepted planning and repair contracts; there is one canonical application service.
- Apply is provider-free, revalidates inside one transaction, and writes normal versions/audits.
- Discussion and non-canonical understanding never count as applied changes.

### Provider boundary

Discuss/propose generation is explicitly user-triggered and bounded. Scope preview precedes broad or costly work. Apply, reject, history, compare, restore, and validation are local. Offline providers cover all engineering tests.

### UI

- Director language with always-visible adjustable scope.
- Impact confirmation when a phrase such as "change the ending" could refer to one ending, one route, or the project.
- Review cards with before/after, evidence, affected stable IDs, dependencies, validation, staleness, and protected prose/lock notices.
- Advanced technical detail on demand.

### Migration/schema expectation

Prefer extending existing proposal/application records and indexes. Add schema only for genuinely missing multi-artifact lineage, not a parallel conversational change store. Preserve Foundation 6 repair histories and semantics.

### Tests

- Representative natural-language edits for character, tone, route, ending, mechanics visibility, and passage-plan scope.
- Ambiguous scope requiring clarification and zero mutation.
- Multi-artifact dependency selection and atomic rollback.
- Current/base drift before preview, during provider execution, and before apply.
- Accepted/locked prose protection and candidate routing.
- No-op/lifecycle-only behavior without false staleness.
- Large-project browser flows with bounded context and metadata-first impact lists.

### Large-source behavior

Editing resolves dossier/authoritative stable IDs and retrieves only relevant evidence. It does not send the source corpus or entire project by default. If every required direct dependency cannot fit, execution fails locally or requires narrower scope.

### Failure modes

Unresolved ambiguity, no valid target, stale bases, protected locks, incomplete dependency selection, invalid generated IDs, cross-project evidence, context overflow, malformed provider output, cancellation, and transactional failure all leave canonical state unchanged.

### Compatibility

Direct Advanced editing and accepted Foundation 6 repair remain available. A6 is a conversational front end to shared operations, not a replacement for either.

### External acceptance criteria

- Each example request resolves to exact stable IDs and understandable impact.
- No mutation occurs until explicit apply.
- Cross-artifact application and rollback preserve all accepted invariants.
- Locked prose cannot be silently changed.
- Large project context remains bounded and inspectable.

### Recommended model

**Sol High**, because ambiguous scope resolution meets cross-artifact mutation, staleness, protected prose, and transactional correctness.

## A7 - Studio Handoff / Unified Workflow

### Outcome

Projects created through original conversation or source adaptation are indistinguishable downstream from ordinary Long-form projects and complete the accepted production, review, play, publishing, health, and recovery workflows.

### In scope

- Unified creation/resume navigation across Director, Review, and Advanced layers.
- Exact handoff from setup/bootstrap drafts into normal workflow approvals.
- Compatibility validation across passage planning, static validation, drafting, review/accept/lock, deterministic simulation, seeded playtesting, narrative review, repair, compilation, player, publishing, backup, Health, usage, resume, and recovery.
- Full-fidelity and explicitly privacy-redacted portable export/import of Creative Direction, source dossier, adaptation intent, provenance, conversational proposal history, job state, and source-evidence availability.
- Full-fidelity verified backup/restore plus transactional project duplication with exact source/provenance identity remapping.
- Final cognitive-load and accessibility browser journeys.
- Documentation for conversational/original/adapted use.

### Out of scope

- A special AO3 passage generator.
- Expansion of Quick Prototype.
- World simulation, visual/audio assets, or MCP/Codex operation.
- New production foundations or Foundation 9.

### Durable contracts

- Project mode remains `long-form`; creation origin is metadata/provenance only.
- Existing downstream stages consume exact approved canonical artifacts regardless of which UI created them.
- Portable archive manifests version and validate all new artifacts/evidence and distinguish source present, redacted, and missing. Redacted evidence is never presented as resolved.
- Full-fidelity archives and verified backups contain the source material needed to resolve evidence. Privacy-redacted archives retain expected source fingerprints, block source-grounded provider work until exact verified reattachment, and do not weaken normal backup guarantees.
- Duplication remaps project-owned source artifact/version IDs and dependent provenance references atomically while preserving content-derived evidence identity only when the source fingerprint is unchanged.
- Handoff does not auto-approve, auto-generate passages, or bypass readiness.

### Provider boundary

Handoff, existing workflow use, import/export, play, Health, backup, and recovery are provider-independent. Only the already-explicit AI actions call configured providers. Full acceptance uses offline fixtures.

### UI

- Creation choices remain concise and do not create permanent navigation clutter.
- A conversationally created project opens at the next ordinary review/approval step.
- Director/Review/Advanced switching preserves current project, stage, scope, stable ID, focus, and scroll behavior.
- Resume work explains the next action in user language with technical detail available on demand.
- Export makes full-fidelity versus privacy-redacted mode explicit, warns that redaction limits recovery and evidence-grounded work, and previews what will be omitted.
- Imported or duplicated redacted projects show unavailable evidence and offer exact-source reattachment with fingerprint verification; mismatches are explained and never silently relinked.

### Migration/schema expectation

Only compatibility-format version increments required to serialize/restore A1-A6 records and the archive evidence-availability manifest. Migrations preserve all historical Long-form and Quick projects and the full-fidelity behavior of existing verified backups. Unknown future formats fail safely without partial import or restore.

### Tests

- End-to-end original idea -> reviewed drafts -> approval -> passage plan -> draft -> review -> playtest -> repair -> compile/play/export.
- End-to-end large source -> dossier -> intent -> bootstrap -> the same downstream workflow.
- Full-fidelity backup/restore and portable export/import with every evidence reference resolvable after round trip.
- Privacy-redacted export/import with explicit unavailable evidence, retained expected fingerprints, blocked source-grounded provider work, successful exact reattachment, and rejected mismatch without silent relinking.
- Full and redacted duplicate behavior, including complete project-owned identity remapping, no falsely valid dangling evidence, and transactional rollback on invalid provenance.
- Regression proving historical/full verified backup behavior is not downgraded by the redacted archive option.
- Archive/delete confirmation, Health, usage, and resume.
- Privacy assertions for source bodies, conversations, provider content, credentials, and reasoning.
- Accessibility, keyboard, narrow-layout, and cognitive-load browser flows.
- Regression proving Quick Prototype remains separate and unchanged.

### Large-source behavior

Handoff uses immutable dossier/foundation artifacts and metadata; it does not reload or resend the whole source. Large lists remain metadata-first, paginated/bounded, and stable-ID navigable under Foundation 8 budgets.

### Failure modes

Missing approvals, stale dossiers/intent/foundations, incompatible portable data, corrupt backup, unsupported schema, interrupted job, absent provider, unavailable/redacted source evidence, fingerprint mismatch, invalid duplicate identity mapping, and downstream readiness errors produce actionable recovery without hidden mutation or data loss.

### Compatibility

All existing Long-form projects remain valid. Projects created by Director, adapted bootstrap, or Advanced setup share one downstream pipeline. Quick projects remain quick projects.

### External acceptance criteria

- Both original and adapted browser journeys enter and complete the accepted Long-form pipeline without conversion-specific downstream code.
- New artifacts and provenance survive reload, export/import, backup/restore, and history inspection.
- Full-fidelity archives keep evidence resolvable; privacy-redacted archives honestly mark it unavailable and cannot perform source-grounded work until exact source reattachment succeeds.
- Duplication preserves or remaps every source/evidence identity according to the declared contract without weakening verified backups.
- A new user can create a sophisticated project without understanding internal persistence terminology.
- Advanced users retain every existing control.
- No non-AI workflow depends on provider availability.

### Recommended model

**Terra High** for the integration and user-flow work, with **Sol High** for final compatibility, backup/restore, and cross-system correctness review if those dominate the checkpoint.

## Cognitive-load acceptance strategy

Cognitive-load reduction is a formal product criterion, not cosmetic polish.

At A2, A4, A5, A6, and A7, browser acceptance must demonstrate that a new user can:

- start from incomplete story language;
- understand what Studio currently believes and what remains uncertain;
- answer only the next meaningful question;
- distinguish discussion from proposed and applied state;
- review effects in creative terms before technical details;
- locate and change an AI-configured value;
- understand why the value exists;
- recover from a stale or failed proposal;
- enter the normal Long-form workflow without learning implementation terminology.

Tests should assert progressive disclosure, labels, focus order, status announcements, and user-visible decisions. Schema and repository tests remain necessary but are not sufficient evidence of usability.

## Roadmap completion boundary

Conversational Adaptation Studio closes only when A1 through A7 each have an externally accepted SHA and A7 proves unified handoff through the accepted Long-form pipeline.

Closing this roadmap will not create Foundation 9. World, visual, audio, simulation-expansion, and MCP/Codex operator work remains separately planned future product expansion.
