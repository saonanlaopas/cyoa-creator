# Product design

## Product statement

Story Creator is an assistant-led fiction studio for planning, repairing, continuing, and drafting long-form stories. It combines a guided workflow with a persistent project assistant. The workflow holds the durable source of truth; chat makes that workflow easy to discuss and change.

The central promise is:

> Start with as little as a premise or as much as a complete manuscript, then develop the story without losing control of canon, scope, or accepted prose.

## Entry modes

### 1. Start from a premise

The minimum input is a premise. The writer can immediately choose one of four working styles:

- **Suggest options:** present two or three meaningfully different directions for the selected stage or field.
- **Create first planning pass:** draft the brief, bible, characters, relationships, plot and character arcs, act structure, and chapter/scene plan as a bounded sequence of candidate artifacts.
- **Discuss first:** use chat to explore uncertainties before requesting changes.
- **Manual:** edit structured artifacts directly, with AI suggestions available on demand.

The writer is not required to author every form manually. Every stage provides **Suggest**, **Draft this section**, and **Discuss** actions.

### 2. Import and mend

The writer imports TXT, Markdown, HTML, EPUB, or DOCX content they are permitted to edit. The application:

1. preserves an immutable normalized source;
2. segments it into chapters, scenes, and paragraphs with stable IDs;
3. extracts source-backed planning artifacts;
4. reports contradictions, continuity risks, pacing issues, and open threads;
5. accepts natural-language repair requests at an explicit scope;
6. presents prose and structural changes for review before application.

Examples:

- “Make chapters 5–7 less repetitive without changing the events.”
- “Repair Mara’s motivation between the argument and the station scene.”
- “Foreshadow the betrayal twice before chapter 12.”
- “Change the narration to close third person in this scene only.”
- “Strengthen the forgiveness arc across the second act.”

### 3. Import and continue

The extraction process is the same as Import and mend. The writer then selects a continuation boundary and decides what is fixed versus open:

- canon that must remain true;
- unresolved plot threads to continue;
- character and relationship trajectories;
- desired ending or direction;
- style and point-of-view constraints;
- content boundaries;
- approximate additional length.

The assistant proposes continuation options, then develops the chosen option into acts, chapters, and scenes before prose is drafted.

## Guided workflow

```text
Premise or imported manuscript
  -> source analysis or story brief
  -> story bible
  -> characters and relationships
  -> plot threads and character arcs
  -> act structure
  -> chapter and scene plan
  -> manuscript drafting or scoped mending
  -> continuity and narrative review
  -> revision
  -> export
```

The stages are visible but not bureaucratic. The writer can move backward, discuss future stages, and revise approved artifacts. Downstream work becomes stale when a material dependency changes; it is never silently deleted.

## Create first planning pass

This is the primary low-effort experience for a premise-only project.

Before starting, the application shows:

- premise and any optional direction;
- target length range;
- selected OpenRouter model;
- planned stages and job units;
- estimated input, output, and maximum cost;
- what will remain draft versus what could become canonical;
- the validation and review steps.

The job generates candidates sequentially because later stages depend on earlier ones. Each completed unit is checkpointed. If generation stops, the writer can resume without repeating completed work.

The result is a planning review packet, not an automatically approved project. The writer can:

- accept the full coherent pass;
- accept selected independent groups;
- ask for alternatives;
- edit directly;
- discuss one decision;
- reject the pass without altering canonical artifacts.

## Assistant role

The assistant is available throughout the application and serves three roles:

1. **Thinking partner:** brainstorm, explain consequences, compare options, and answer questions without changing artifacts.
2. **Project-aware guide:** identify the current stage, missing decisions, stale dependencies, and sensible next action.
3. **Change author:** create scoped, reviewable proposals tied to exact base versions.

The assistant does not use an unbounded chat transcript as project memory. Canonical artifacts, approved decisions, pinned notes, bounded summaries, and selected neighboring prose form its context.

## Mending principles

1. The original imported source remains recoverable and unchanged.
2. Accepted prose is never silently replaced.
3. A repair request must name or resolve to a visible scope before generation.
4. The application distinguishes prose edits from structural edits and canon changes.
5. A proposal shows direct text changes and downstream consequences.
6. Large repairs are grouped by coherent intent, chapter, scene, or dependency.
7. The writer may accept, reject, or defer groups independently when safe.
8. A stale proposal cannot overwrite a newer manuscript or artifact version.

## Continuation principles

1. The continuation boundary is explicit.
2. Existing source facts are treated as constraints unless the writer approves a retcon.
3. Open threads are categorized as continue, resolve, defer, or abandon with rationale.
4. New prose is planned in chapters and scenes before bulk drafting.
5. Drafting happens one scene or a small connected batch at a time.
6. Each batch records the exact plan, canon, neighboring prose, and style context it used.

## Quality characteristics

The product should favor:

- continuity over improvisational novelty;
- explicit scope over guessed intent;
- useful suggestions over mandatory form filling;
- recoverable versions over destructive rewriting;
- source-backed facts over confident invention;
- coherent batches over one enormous request;
- readable summaries over raw JSON;
- local operation when a provider is unnecessary.

## Initial non-goals

- Fully autonomous generation of a finished novel from one request.
- Real-time multi-user collaboration.
- Publishing marketplace integration.
- Screenwriting, comics, or interactive fiction-specific runtimes.
- Treating provider reasoning or chat logs as canon.
- Automatic plagiarism or legal-rights adjudication.
- Perfect literary-quality scoring presented as objective truth.

## Success criteria

A successful first release lets a writer:

1. create a project from a premise or import a substantial manuscript;
2. obtain a reviewable source-backed or invented planning foundation;
3. navigate the bible, arcs, chapters, scenes, and manuscript through stable IDs;
4. discuss the project with a persistent scoped assistant;
5. accept a bounded prose repair without changing unrelated text;
6. continue the story through a reviewed plan and small drafting batches;
7. run continuity checks linked to exact evidence;
8. restore an earlier accepted state;
9. export the resulting manuscript and a portable project bundle.
