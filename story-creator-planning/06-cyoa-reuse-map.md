# CYOA reuse map

Story Creator should begin in a fresh repository. Reuse selected, proven infrastructure from Story-to-CYOA, but do not fork the entire application and remove branching features afterward. The latter would preserve too many assumptions about passages, routes, mechanics, simulation, and play.

Paths below refer to the Story-to-CYOA repository at the time this package was written. Confirm them against the source commit before copying.

## Copy or closely adapt

| CYOA area | Story Creator use | Adaptation needed |
| --- | --- | --- |
| `packages/importers` | Text, Markdown, HTML, DOCX, and EPUB ingestion | Keep source text immutable; produce source documents and segments instead of immediate CYOA passages. |
| `packages/openrouter` | Provider client, request lifecycle, streaming, and usage metadata | Rename package scope and replace CYOA prompts/contracts with story artifact schemas. |
| Persistence repositories and migration patterns | Local projects, artifacts, versions, history, jobs, conversations, and proposals | Design a new schema around manuscripts and narrative plans; copy transaction and migration techniques, not tables wholesale. |
| `packages/pipeline/src/job-runner.ts` | Bounded, resumable background work | Generalize job/unit payloads and preserve checkpoint, retry, cancellation, and idempotency behavior. |
| `apps/server/src/services/fake-model-provider.ts` | Deterministic offline development and tests | Add fixtures for extraction, planning, chat proposals, drafting, mending, malformed output, and interrupted streams. |
| Provider settings and encrypted credential routes | Optional OpenRouter setup | Keep secrets server-side and out of project exports, logs, model context, and browser persistence. |
| `GenerationActivity` UI pattern | Visible provider and reasoning activity | Constrain it to a scrollable region; persist status/usage summaries, not raw hidden reasoning. |
| Assistant panel and scope controls | Persistent scoped story assistant | Replace CYOA scope types with story/project/artifact/manuscript scopes and make resizing a first-class behavior. |
| `ArtifactHistory` and comparison patterns | Versions, diffs, approval, and restore | Extend to source-derived evidence, prose ranges, and dependency snapshots. |
| Long-form service and change-operation patterns | Stable-ID proposals and transactional application | Define story-specific operations; retain conflict detection and atomic commits. |
| Launch, configuration, health, test, typecheck, and build setup | Development baseline | Remove prototype-only configuration and rename the product/package namespace. |

## Reuse the idea, rewrite the implementation

| Area | Why it needs a rewrite |
| --- | --- |
| Domain schemas | Story Creator has sources, chapters, scenes, prose ranges, continuity claims, and narrative arcs rather than a playable passage graph. |
| Prompt and context builders | Long-form prose needs evidence, recent-text windows, style samples, unresolved threads, and approved plan snapshots. |
| Validators | Replace reachability and choice checks with chronology, reference integrity, plan coverage, continuity, dependency, and manuscript-order checks. |
| Main workspace | The central surface is a manuscript and planning studio, not a route graph or passage table. |
| Exporters | Produce author-owned manuscript and project formats rather than playable HTML/Twine packages. |
| Review dashboards | Findings concern continuity, character, arcs, pacing, prose, setup/payoff, and plan drift. |

## Deliberately leave behind

- Branching passage, choice, route, ending, stat, relationship-stat, and flag domain models.
- Passage-plan generation and validation services.
- Automated playthrough and reachability simulation.
- Native CYOA player, play preview, stat sidebar, save-state runtime, and ending gallery.
- `packages/export-twine` and Twee/SugarCube output.
- Any UI whose main assumption is that the story is a directed choice graph.
- Prototype compatibility layers or unused alternate workflow implementations.

Character relationships still belong in Story Creator, but as narrative facts and arcs, not numerical player-state mechanics.

## Recommended extraction sequence

1. Create and commit the empty Story Creator workspace plus this planning package.
2. Establish the new package namespace and application names.
3. Copy the development, configuration, health, and test harness.
4. Adapt importer code and tests around immutable source documents.
5. Implement the new domain schema and persistence layer before bringing over UI components.
6. Adapt version/history and encrypted-settings patterns.
7. Bring over the provider client, fake provider, streaming activity, and resumable job runner when Foundation 2 begins.
8. Adapt assistant and proposal UI only when Foundation 3 begins.

Copy code in coherent slices and run tests immediately after each slice. Do not keep Story Creator linked to unpublished CYOA workspace packages initially; independent copies make product boundaries and migrations clearer.

## Important reuse risks

### Hidden graph assumptions

Types named generically may still assume passages, choices, routes, or project-wide regeneration. Inspect behavior and tests before copying.

### Schema coupling

Repositories and change operations may encode CYOA artifact names in migrations, event types, uniqueness rules, or dependency checks. Treat their transaction pattern as reusable, but create new story migrations.

### Stale prototype modules

Only copy code exercised by the current committed CYOA application and tests. Do not move abandoned implementations merely because they are present.

### Credentials and privacy

Retain encrypted-at-rest provider keys, server-side calls, redaction, and the policy that reasoning activity can be shown while raw private reasoning is neither revealed nor persisted as assistant memory.

### Provenance loss

Imported text must remain an immutable reference even after mending. Derived facts should retain source segment references, and generated prose should retain the approved artifact versions and user instructions that shaped it.

## Source record

This reuse review was made against:

- repository: `https://github.com/saonanlaopas/cyoa-creator.git`
- commit: `fb335bf57beeba0484f5d532f4e8b1ff479f056d`

When the new repository copies code, record each source commit in a migration note. Keep original copyright and license notices where applicable. This package does not choose a public license; make that decision explicitly before public distribution.
