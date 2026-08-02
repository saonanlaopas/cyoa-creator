# Domain and versioning design

## Canonical layers

Story Creator separates immutable source evidence, structured planning, and editable manuscript prose.

```text
Immutable source
  -> source observations and provenance
  -> structured planning artifacts
  -> manuscript plans
  -> manuscript prose
  -> review findings and revision proposals
```

Chat messages and provider activity are not canonical layers.

## Core records

### Project

- `id`
- `name`
- `entryMode`: `premise`, `import-mend`, or `import-continue`
- `status`
- target length and optional continuation length
- content boundaries
- created and updated timestamps

### SourceDocument

- stable ID and project ID
- original filename, media type, encoding, and content hash
- immutable normalized text
- import warnings
- chapter/scene segmentation version
- whether source text is included in each export

Imported bytes may be retained separately from normalized text when the format supports round-trip preservation. The source is never edited in place.

### SourceSegment

- stable segment ID
- source document ID
- kind: chapter, scene, paragraph, front matter, or unknown
- parent ID and order
- normalized text span or immutable content
- source location metadata
- content fingerprint

Stable segment IDs anchor evidence even when the editable manuscript diverges later.

### StoryBrief

- premise and central dramatic question
- genre, audience, tone, point of view, and tense
- target length range
- desired ending direction when known
- themes and emotional promise
- content boundaries
- project constraints
- unresolved decisions

### StoryBible

The bible contains stable-ID collections:

- characters;
- relationships;
- locations;
- organizations and institutions;
- world rules;
- objects and resources;
- canon facts;
- timeline events;
- terminology and naming rules;
- style guidance;
- unresolved contradictions.

### EvidenceClaim

Extracted information from an imported story carries provenance:

- stable claim ID;
- subject entity ID;
- claim text or structured value;
- status: `confirmed`, `inferred`, `contradicted`, `writer-added`, or `superseded`;
- confidence;
- source segment IDs;
- optional bounded excerpts;
- extraction job and model metadata;
- writer confirmation state.

Source-backed facts and new creative decisions must remain distinguishable.

### NarrativePlan

- plot threads with setup, escalation, payoff, and status;
- character arcs with starting state, pressure, turning points, and intended resolution;
- relationship arcs;
- act records;
- chapter records;
- scene records;
- causality and dependency edges;
- foreshadowing and payoff links;
- continuation obligations;
- unresolved planning questions.

This is a linear narrative flow. Alternative directions exist as proposals or named variants until one is accepted; they are not encoded as a gameplay graph.

### ScenePlan

- stable scene ID, chapter ID, and order;
- purpose and dramatic question;
- point-of-view character;
- location and time;
- participating characters;
- entry state and exit state;
- events and turning point;
- facts revealed or required;
- plot and arc obligations;
- setup and payoff IDs;
- target words;
- drafting guidance;
- status and lock state.

### ManuscriptUnit

The editable manuscript is stored by chapter, scene, and optionally paragraph:

- stable unit ID and parent ID;
- current accepted version ID;
- source segment IDs when imported;
- planned scene version ID;
- title and prose;
- word count;
- status: `source`, `draft`, `review`, `accepted`, `locked`, or `stale`;
- content fingerprint;
- created and updated timestamps.

Scene versions are the normal prose boundary. Paragraph IDs may be used inside a scene for precise diffs, but the database does not create a full artifact snapshot for every keystroke.

### Finding

- stable code and severity;
- project and snapshot IDs;
- entity type and stable entity ID;
- message, evidence, and suggested action;
- deterministic or AI-assisted origin;
- acknowledgement or resolution state;
- superseding finding ID when re-evaluated.

### Conversation and Message

- persistent conversation ID;
- visible assistant scope;
- bounded summary;
- pinned decisions;
- message records and usage metadata;
- no raw provider reasoning stored as memory.

### Proposal

- stable proposal ID;
- conversation and job IDs;
- visible scope;
- exact base artifact and manuscript version IDs;
- context snapshot IDs;
- summary and rationale;
- operation groups;
- validation preview;
- affected and stale downstream entities;
- status: proposed, partially applied, applied, rejected, stale, or superseded.

### Job and JobUnit

- job kind and selected scope;
- provider and model;
- estimated and actual usage/cost;
- ordered deterministic unit keys;
- context snapshot and prompt version;
- per-unit status, attempts, output, error, and checkpoint;
- cancellation and resume state.

## Artifact workflow states

Structured artifacts and manuscript plans use:

- `empty`
- `draft`
- `review`
- `approved`
- `stale`

Manuscript prose additionally uses `accepted` and `locked`. A newer draft does not erase the last approved or accepted version.

## Version rules

1. Every accepted structured change creates an immutable version.
2. Approval references one exact version, never “latest.”
3. Restoring creates a new version linked to its source version.
4. Accepted prose is independently versioned per scene.
5. A no-op save creates no version and does not change approval state.
6. Upstream changes mark affected downstream entities stale through explicit dependency records.
7. Staleness preserves content and explains which dependency changed.
8. Project snapshots reference exact artifact and manuscript-unit versions.
9. Portable exports include schema versions and migration metadata.

## Scope contract

Every assistant request displays a scope with stable IDs:

- whole project;
- source document or source range;
- planning artifact or artifact section;
- character, relationship, location, fact, thread, or arc;
- act, chapter, or scene;
- selected manuscript paragraphs;
- continuation boundary;
- finding or proposal.

Scope also includes an operation intent:

- `discuss`
- `suggest`
- `extract`
- `plan`
- `mend`
- `continue`
- `draft`
- `review`

The UI must show both scope and intent before a provider request.

## Proposal operations

Operations identify entities by stable ID and carry expected base versions or fingerprints. Initial domain operations include:

- add, update, archive, or restore a structured entity;
- reorder stable child IDs;
- split or merge a scene plan;
- replace a bounded prose unit;
- insert or remove paragraphs inside one scene;
- move a scene between chapters;
- add or resolve a finding;
- pin or supersede a project decision.

Raw array-index JSON patches and arbitrary whole-project replacements are not the application contract.

## Transaction and conflict rules

1. Validate every selected group and precondition before writing.
2. Apply selected groups in one SQLite transaction when they form one coherent change.
3. If a selected operation fails, that transaction writes nothing.
4. Reject stale base versions instead of attempting an invisible merge.
5. Permit partial acceptance only for groups explicitly marked independently safe.
6. Produce a human-readable audit summary after application.
7. Preserve rejected and superseded proposals for history without treating them as context by default.

## Storage direction

Use local SQLite for metadata, artifacts, versions, jobs, conversations, findings, and proposal operations. Large source bodies and manuscript text may begin in SQLite, but the repository layer must permit moving large immutable blobs to project-local files later without changing domain contracts.

Use explicit migrations. Backups must include the database, project-local blobs, and a manifest that can be verified before restore.
