# Interface design

## Primary workspace

The desktop web workspace uses three coordinated regions:

```text
Workflow and project     Active artifact or manuscript       Assistant
navigation               editor/review surface                conversation
```

The assistant panel is resizable, collapsible, and optionally full-screen. Its conversation history scrolls independently from the center workspace. Width is remembered locally per device.

On narrow screens, the regions become switchable tabs rather than compressed columns.

## Project home

Creating a project begins with three cards:

- **Start with a premise**
- **Import and mend a story**
- **Import and continue a story**

The next screen asks only for essentials. Optional details are collapsed. A writer with one sentence can continue immediately.

For a premise project, the primary actions are:

- Create first planning pass
- Suggest story directions
- Discuss with assistant
- Plan manually

For an imported project, the primary action is **Analyze manuscript**, with a preview of segmentation, units, model, context, cost, and privacy.

## Workflow navigation

The navigation shows each stage and status:

- Brief
- Bible
- Characters & relationships
- Plot & arcs
- Acts
- Chapters & scenes
- Manuscript
- Review
- Export

Statuses are Not started, Draft, Review, Approved, Stale, or Complete. Selecting a stale stage explains which upstream version changed.

The navigation also shows active jobs, blocked actions, and the next recommended step without forcing it.

## Structured artifact editors

Every structured editor supports:

- direct editing;
- search and stable-ID jump;
- section and entity selection;
- Suggest options;
- Draft selected section;
- Discuss selected scope;
- validation findings linked to exact fields;
- current/approved version labels;
- history, comparison, and restore;
- Markdown and structured export.

Large entity collections use list/detail layouts. Graphs and timelines are secondary views, not the only editor.

## Planning-pass review

The Create first planning pass result opens a digest containing:

- one-page story direction summary;
- major invented decisions;
- unresolved questions;
- characters and relationships;
- arc and act summaries;
- chapter and scene counts;
- word-budget reconciliation;
- validation findings;
- groups safe to accept independently.

The writer can expand into full artifacts, accept coherent groups, request alternatives, or continue the conversation with the whole pass selected.

## Manuscript editor

The manuscript workspace uses an outline plus focused editor:

- chapter and scene tree;
- status, point of view, word count, findings, and stale indicators;
- one selected scene in the primary editor;
- optional neighboring-scene preview;
- source comparison for imported scenes;
- version history and accepted/locked state;
- comments, drafting notes, and linked plan obligations.

The first release may use a reliable textarea-based editor. Rich-text formatting is less important than preserving stable structure, selection, and versions.

## Mend controls

When text is selected, the interface offers:

- Discuss selection
- Suggest improvement
- Mend selection
- Expand scope to scene/chapter/arc

The mend dialog shows:

- exact visible scope;
- requested outcome;
- repair category;
- constraints to preserve;
- related canon and arcs;
- estimated changed words and cost;
- whether planning artifacts may also change.

The writer can manually change scope before sending.

## Assistant panel

### Header

- conversation selector and title;
- intent selector;
- model selector;
- exact scope selector;
- base version or snapshot;
- collapse, resize, and full-screen controls.

### Conversation

- persistent user and assistant messages;
- clear distinction between discussion and proposed changes;
- links to mentioned entities, scenes, findings, and versions;
- bounded scrollable provider-activity panel during requests;
- token/cost summary after requests;
- pinned decisions and conversation-summary controls.

### Composer

- message field;
- visible scope sentence;
- optional reusable project instructions;
- Send to assistant, Request suggestions, or Request proposal action;
- warning when the selected action will call OpenRouter.

Changing scope never happens merely because the writer mentioned another topic. The assistant may suggest a scope change, but the UI remains authoritative.

## Proposal review

Small structured changes appear as readable field-level cards. Prose changes use unified or side-by-side diffs with unchanged context collapsed.

For large proposals, review happens at three levels:

1. **Digest:** intent, affected chapters/scenes, words changed, canon impact, and warnings.
2. **Groups:** independently safe changes with checkboxes and dependency indicators.
3. **Details:** exact operations and prose diffs.

Apply controls are disabled when:

- the base version is stale;
- a hard validation error exists;
- a required dependent group is deselected;
- the writer has not selected any group.

After application, the UI shows created versions, stale downstream work, and a one-click comparison or restore path.

## Job progress

Long jobs display real units and stages rather than fictional percentages:

- current unit and completed unit count;
- elapsed time;
- provider activity;
- actual usage and estimated remaining cost;
- validation and bounded repair attempts;
- cancel and safe-resume behavior;
- completed outputs available for review.

Closing the browser or restarting the application does not erase persisted job progress.

## Review dashboard

Findings are filterable by:

- severity;
- deterministic versus AI-assisted origin;
- artifact, character, arc, act, chapter, or scene;
- continuity, chronology, pacing, repetition, voice, or structure;
- unresolved, acknowledged, proposed, or resolved state.

Every finding links to exact evidence and the snapshot reviewed. Conservative or subjective findings may be acknowledged with rationale. Hard data-integrity findings cannot be waived.

## Export surface

The export screen distinguishes:

- manuscript export: Markdown, plain text, DOCX, and later EPUB;
- planning export: readable Markdown;
- canonical portable project bundle;
- privacy options for source text, conversations, and usage history.

Before export, the application reports stale accepted prose, unresolved hard findings, missing chapters, and approximate word totals without necessarily blocking a deliberate draft export.

## Accessibility and usability

- keyboard navigation for stage, outline, editor, and assistant;
- visible focus and semantic labels;
- no color-only status communication;
- resizable text areas and assistant panel;
- scroll containment for conversation, provider activity, diffs, and large lists;
- responsive layouts;
- reduced-motion support;
- large-list virtualization only when measured performance requires it.
