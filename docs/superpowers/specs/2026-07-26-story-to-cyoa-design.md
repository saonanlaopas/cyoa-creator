# Story-to-CYOA Local App — Design Specification

## Purpose

Build a private, local browser application that turns an AO3-downloaded work or other supplied text into an editable, stat-driven interactive story. The application collaborates with the user during adaptation, uses models accessed through the user's OpenRouter account, and exports a playable Twine/SugarCube game.

The application is intended for private adaptations. It prioritizes preservation of the source's characters, setting, plot logic, and protagonist voice. It does not include publishing, collaboration, accounts, cloud storage, or automated AO3 scraping in the first version.

## MVP success criteria

The MVP succeeds when a user can:

1. Import an AO3-downloaded file or ordinary text.
2. Select the entire work or a chapter range.
3. Generate and review a source-grounded story bible.
4. Collaboratively approve an adaptation plan, mechanics, routes, and endings.
5. Generate and selectively revise a 25–40-passage game.
6. Playtest the game and see deterministic and AI-assisted validation findings.
7. Export editable Twee source and standalone SugarCube HTML.

The generated game should normally contain 6–10 meaningful decision points and 3–5 reachable endings. These are defaults, not hard format limits.

## Product principles

- **Structure before prose:** analyze and design the game before drafting passages.
- **Existing protagonist first:** preserve the source protagonist's established voice and motivations while allowing choices to change them gradually.
- **Consequential without uncontrolled growth:** support substantial divergence with planned reconvergence.
- **Story-specific mechanics:** propose stats that fit the source instead of imposing generic RPG attributes.
- **Collaborative by default:** let the user inspect and revise each stage, with an automatic shortcut for accepting sensible defaults.
- **Local and recoverable:** keep projects and credentials local, checkpoint work, version revisions, and never silently overwrite content.
- **Model-independent:** treat OpenRouter models as configurable providers behind validated structured interfaces.

## Supported inputs

The first version accepts:

- Pasted plain text
- TXT
- HTML, including AO3-downloaded HTML
- EPUB, including AO3-downloaded EPUB

The importer removes navigation and presentation noise while preserving headings and chapter boundaries. It records source offsets or excerpt identifiers so extracted facts can cite their origin.

The user may adapt the complete work or choose a chapter range. For a source that is too large for the selected model or desired game size, the app recommends arc-by-arc adaptation and explains why.

Automated AO3 URL fetching and scraping are outside the MVP. The user supplies a downloaded copy.

## Adaptation model

### Player role

The player controls the source's existing protagonist. Choices should remain plausible for that character at the point where they occur. More extreme behavior becomes available only when prior choices have established a corresponding personality change or when the fiction clearly motivates it.

Reader-insert and alternate-character modes are possible future extensions, not MVP requirements.

### Divergence

Each project has a divergence setting:

- **Canon-centered:** deviations tend to return to the source's major events.
- **Balanced:** meaningful alternate routes with planned reconvergence.
- **Expansive:** larger changes to relationships, events, and endings.

Balanced is the default. Divergence may be adjusted per project before route generation. Changing it afterward invalidates route design and downstream drafts, but does not invalidate source analysis.

### Game size

The default target is 25–40 passages, 6–10 meaningful decision points, and 3–5 endings. The route designer enforces a branch budget and identifies planned reconvergence points before drafting.

## Application architecture

The application is a TypeScript-based local server with a browser interface. It binds to `localhost` only and requires no user account or cloud backend. SQLite stores project metadata and structured artifacts. Large imported source files may be stored as project files referenced from SQLite rather than duplicated in database rows.

The application consists of four bounded layers:

1. **Project workspace**
   - Create, open, rename, duplicate, archive, autosave, and export projects.
   - Store source material, stage artifacts, versions, settings, job history, and usage.

2. **Adaptation pipeline**
   - Execute ingestion, analysis, interview, route design, drafting, validation, and export as discrete resumable stages.
   - Track dependencies and mark downstream stages stale when an upstream artifact changes.

3. **Conversation layer**
   - Scope each conversation to the active project and pipeline stage.
   - Convert approved requests into explicit structured changes.
   - Show the proposed change and affected downstream artifacts before applying broad invalidations.

4. **OpenRouter layer**
   - Manage model discovery and selection, presets, request construction, structured response validation, retries, cancellation, usage accounting, and spending limits.
   - Expose stable internal operations so model changes do not affect the rest of the application.

Narrative prose is stored separately from mechanics. A passage contains text plus structured choices, destinations, conditions, effects, relationships, inventory changes, and story flags. Exporters translate this canonical project model into Twee and SugarCube.

## Pipeline and data flow

### 1. Import

Parse the source, retain chapter boundaries, normalize text, and build stable source excerpt identifiers. The user confirms the selected scope before analysis.

### 2. Source analysis

Process long works in bounded chunks, then consolidate the results into a story bible containing:

- Characters, motivations, voice traits, and relationships
- Locations
- Timeline and plot beats
- Important objects
- Established knowledge by character and point in time
- Unresolved threads
- Tone and prose characteristics
- Sensitive-content markers

Facts cite source excerpts. Contradictory or low-confidence facts are flagged for user review instead of silently resolved.

### 3. Adaptation interview

The assistant proposes:

- Starting and ending scope
- Divergence level
- Sensitive-content boundaries
- Game size and branch budget
- Visible stats and relationship presentation
- Hidden state
- Inventory needs
- Candidate divergence points, reconvergence points, and endings

The user may edit proposals conversationally or accept automatic defaults.

### 4. Route design

Create a passage graph before prose generation. Each node defines its dramatic purpose, participants, required knowledge, incoming state assumptions, outgoing choices, state changes, and route role.

The route validator rejects missing destinations, dead ends, unreachable passages, impossible requirements, unreachable endings, and branch counts beyond the approved budget.

### 5. Drafting

Draft related passages in batches based on route and scene context. Prompts include only the relevant source excerpts, story-bible entries, incoming state, and adjacent passage summaries.

The user can approve, edit, or regenerate a passage, scene cluster, or branch. Regeneration creates a version and does not replace unaffected content.

### 6. Playtest and repair

Deterministic simulation traverses the graph and checks mechanics. AI-assisted review checks narrative qualities separately and produces cited findings. Repairs require user approval unless the user explicitly invokes an automatic repair action.

### 7. Export

Generate:

- Editable Twee source
- SugarCube-compatible Twine project content
- Standalone playable HTML

Exports contain no OpenRouter key, imported source file, hidden prompts, or project history.

## Gameplay system

### Visible state

The assistant proposes three to five story-specific visible stats. A project may use fewer when the source does not justify more.

Relationships use descriptive labels such as `Wary`, `Trusting`, or `Devoted`; hidden numeric values support calculations and transitions. The project editor shows both the label mapping and underlying values.

Inventory is enabled only when objects meaningfully affect future events.

### Hidden state

Hidden variables may track:

- Discoveries and character knowledge
- Promises and obligations
- Alliances and betrayals
- Prior decisions
- Personality tendencies
- Ending eligibility

### Choice behavior

Randomness is disabled by default. Most choices remain visible and selectable; state changes the resulting scene or consequence. Hard-gated choices are used only when the story provides a clear fictional reason.

Effects may be immediate or delayed. The editor exposes their mechanical meaning and later consumers in readable language. The playable game gives narrative hints rather than revealing hidden ending formulas.

Difficulty changes resource thresholds and forgiveness, not arbitrary success at routine actions.

## User experience

### Setup

New projects use a guided, one-question-at-a-time flow. The user imports the source, chooses scope, reviews analysis, and approves adaptation settings without needing to understand the internal schema.

### Main workspace

After setup, the app uses a three-pane studio layout:

- **Left:** project and pipeline navigation with stage status
- **Center:** the active artifact, such as story bible, route map, passage editor, or playtest
- **Right:** the stage-aware assistant, findings, and proposed changes

The story map can expand into a full-screen structural view. Reading and passage editing remain center-focused rather than graph-dominated.

### Model and cost controls

The default interface offers three presets:

- **Economy:** lower-cost models for analysis and drafting
- **Balanced:** economical analysis with a stronger prose model
- **Quality:** stronger models throughout

An advanced panel exposes per-operation model selection and relevant generation parameters. Model identifiers are discovered through OpenRouter rather than hard-coded as permanent choices.

Before a costly run, the app displays selected models, estimated input and output tokens, an approximate cost range, and the artifacts that will be created or invalidated. Users can define per-run and per-project spending caps.

## Persistence and versioning

Every pipeline job records:

- Inputs and input artifact versions
- Operation and model identifier
- Generation settings
- Start and completion state
- Token usage and reported cost when available
- Raw provider error metadata
- Validated output artifact

Stages checkpoint at safe units such as a source chunk, route batch, or passage batch. Cancellation retains completed units.

Edits create artifact versions. The user can compare and restore versions. Changing an upstream artifact marks dependent artifacts stale; stale artifacts remain readable and recoverable.

## Credentials and privacy

The Settings screen accepts an OpenRouter API key. On Windows, the application stores the secret using operating-system credential protection when available. An environment-variable or `.env` fallback is supported for advanced use. The key is never written to project data, logs, exported games, or prompts.

Source text, generated projects, and job history stay on the user's machine. Only the minimum material required for an active generation request is sent to OpenRouter and the selected model provider. The UI communicates this boundary clearly.

The local server listens only on loopback by default. External binding is not an MVP feature.

## Error handling

Failures are categorized as authentication, rate limit, provider availability, context limit, malformed structured output, cancellation, budget limit, import failure, validation failure, or export failure.

The UI shows a plain-language explanation and an actionable next step. Provider details remain available in an expandable diagnostic view, with secrets redacted.

Transient failures use bounded retries with backoff. Structured-output failures may receive one repair attempt before asking the user to retry or select another model. Resuming a job does not repeat completed, valid units.

## Validation

### Deterministic validation

Check for:

- Broken, missing, orphaned, or unreachable passages
- Dead ends without an ending classification
- Unreachable endings
- Conditions that can never be satisfied
- Variables read before initialization
- Invalid or inconsistent stat effects
- Story flags and inventory items that are written but never consumed
- Invalid Twee or SugarCube syntax
- Browser runtime errors in the exported game

### Automated route simulation

Traverse representative and boundary routes to summarize:

- Reachable endings
- Route and playthrough length
- Choice frequency
- Stat ranges
- Repeated states or loops
- Branches that reconverge without meaningful differentiation

### AI-assisted narrative review

Review:

- Character voice and behavioral plausibility
- Source fidelity at the configured divergence level
- Timeline, knowledge, inventory, and relationship continuity
- Forgotten consequences
- Repetitive prose
- Pacing
- Choices with indistinguishable outcomes

Findings cite relevant source excerpts and generated passages. AI findings are advisory and are not silently applied.

## Test strategy

- Unit-test source normalization, state transitions, dependency invalidation, route validation, cost-cap enforcement, and export transforms.
- Integration-test the staged pipeline with deterministic fake model responses.
- Contract-test OpenRouter request/response handling without relying on a particular model's prose.
- Fixture-test TXT, AO3 HTML, and EPUB imports.
- Browser-test the guided setup, studio workflow, selective regeneration, playtest, and export.
- Open exported HTML in a browser test, traverse representative routes, and assert that no runtime errors occur.
- Keep live-provider tests opt-in because they incur cost and depend on external availability.

## Out of scope for the MVP

- Automated AO3 scraping or authenticated fetching
- Publishing or hosting generated games
- Multi-user collaboration or accounts
- Mobile or native desktop packaging
- Reader-insert and alternate-character adaptations
- Image generation, soundtracks, or multimedia asset pipelines
- Cloud synchronization
- A general Twine visual editor unrelated to generated adaptations

## Future extensions

Possible later additions include AO3 URL assistance where permitted, reader-insert and alternate-POV modes, native desktop packaging, project sharing, additional Twine story formats, and media generation. These should not complicate the MVP's canonical project model or local-first behavior.
