# Story-to-CYOA MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a private local application that imports an AO3-downloaded work or ordinary text, collaboratively adapts it into a stat-driven branching story through OpenRouter, validates it, and exports editable Twee plus standalone SugarCube HTML.

**Architecture:** Use a pnpm TypeScript workspace with a React/Vite browser client, a Fastify localhost server, focused domain packages, and SQLite persistence. All AI operations run through a provider-neutral job interface; every structured result is validated with Zod and versioned before it can affect downstream artifacts.

**Tech Stack:** Node.js 22+, pnpm, TypeScript, React, Vite, Fastify, Zod, Drizzle ORM, better-sqlite3, React Flow, Vitest, Testing Library, Playwright, epub.js-compatible ZIP/XML parsing libraries, native Windows DPAPI adapter with environment-variable fallback, OpenRouter Chat Completions API, Twee 3, Tweego, and SugarCube 2.

## Global Constraints

- The application is private, local-first, account-free, and bound to loopback only.
- The user supplies an AO3 download or ordinary text; automated AO3 scraping is excluded.
- The player controls the existing protagonist in the MVP.
- Balanced divergence is the default; canon-centered and expansive modes are also available.
- Default output is 25–40 passages, 6–10 meaningful decision points, and 3–5 reachable endings.
- Randomness is disabled by default.
- Projects, source files, job history, and credentials remain local; only active prompt material is sent to OpenRouter.
- The OpenRouter key must never enter logs, project records, exports, or browser storage.
- Every upstream change must preserve old versions and mark affected downstream artifacts stale.
- AI narrative findings are advisory and are never silently applied.
- Live-provider tests are opt-in and must never run in the default test command.
- Use OpenRouter `GET /api/v1/models` for the model catalog and `/api/v1/chat/completions` with strict JSON Schema structured output where supported.
- Use Twee 3 as the editable source format and Tweego with `sugarcube-2` to compile standalone HTML.

---

## Planned file structure

```text
apps/
  server/
    src/
      app.ts                 Fastify construction and plugin registration
      main.ts                localhost launcher and browser opening
      config.ts              validated runtime configuration
      routes/                HTTP and SSE transport adapters
      services/              application orchestration
    test/
  web/
    src/
      api/                   typed server client and event stream
      app/                   shell, router, error boundary
      features/              setup, studio, passages, playtest, settings
      components/            reusable UI primitives
    test/
packages/
  domain/
    src/                     canonical schemas, graph rules, state evaluator
    test/
  persistence/
    src/                     SQLite schema, repositories, migrations
    test/
  importers/
    src/                     TXT, HTML, EPUB normalization
    test/fixtures/
  openrouter/
    src/                     catalog, chat client, cost calculations, redaction
    test/
  pipeline/
    src/                     jobs, stages, dependency invalidation, prompts
    test/
  export-twine/
    src/                     canonical project to Twee/SugarCube and Tweego runner
    test/
e2e/
  fixtures/
  story-to-cyoa.spec.ts
scripts/
  download-tweego.mjs
  launch.ps1
docs/
  user-guide.md
```

The domain package has no database, network, UI, or filesystem dependencies. Transport and persistence depend on domain types, never the reverse.

---

### Task 1: Repository foundation and executable vertical slice

**Files:**
- Create: `.gitignore`
- Create: `.npmrc`
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `vitest.workspace.ts`
- Create: `apps/server/package.json`
- Create: `apps/server/src/config.ts`
- Create: `apps/server/src/app.ts`
- Create: `apps/server/src/main.ts`
- Create: `apps/server/test/health.test.ts`
- Create: `apps/web/package.json`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/app/App.tsx`
- Create: `apps/web/src/app/app.css`
- Create: `scripts/launch.ps1`

**Interfaces:**
- Consumes: none.
- Produces: `buildApp(options?: { databasePath?: string }): FastifyInstance`; `RuntimeConfig`; `pnpm dev`, `pnpm test`, and `scripts/launch.ps1`.

- [ ] **Step 1: Initialize version control and workspace metadata**

Run:

```powershell
git init
pnpm init
```

Replace the generated root manifest with scripts for `dev`, `build`, `test`, `test:e2e`, `typecheck`, and `lint`. Configure workspaces for `apps/*` and `packages/*`. Ignore `node_modules/`, `dist/`, `.env`, `data/`, `exports/`, `tools/tweego/`, Playwright output, and `.superpowers/`.

- [ ] **Step 2: Write the failing health-route test**

```ts
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("GET /api/health", () => {
  it("reports the local service version", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, service: "story-to-cyoa" });
    await app.close();
  });
});
```

- [ ] **Step 3: Run the focused test and verify failure**

Run: `pnpm vitest apps/server/test/health.test.ts --run`

Expected: FAIL because `buildApp` does not exist.

- [ ] **Step 4: Implement the smallest server and browser shell**

Implement `buildApp` with Fastify, CORS disabled, and the health route. Validate `HOST` so only `127.0.0.1`, `localhost`, or `::1` are accepted. Add a React shell that displays “Create project” and verifies `/api/health`. `launch.ps1` starts the built server in a hidden process and opens the returned loopback URL.

- [ ] **Step 5: Install, typecheck, and test**

Run:

```powershell
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Expected: all commands exit 0 and the web build is served by the server in production mode.

- [ ] **Step 6: Commit the vertical slice**

```powershell
git add .gitignore .npmrc package.json pnpm-workspace.yaml tsconfig.base.json vitest.workspace.ts apps scripts
git commit -m "build: create local app foundation"
```

---

### Task 2: Canonical project, passage, mechanics, and graph domain

**Files:**
- Create: `packages/domain/package.json`
- Create: `packages/domain/src/project.ts`
- Create: `packages/domain/src/passage.ts`
- Create: `packages/domain/src/mechanics.ts`
- Create: `packages/domain/src/graph.ts`
- Create: `packages/domain/src/index.ts`
- Create: `packages/domain/test/graph.test.ts`
- Create: `packages/domain/test/state.test.ts`

**Interfaces:**
- Consumes: none.
- Produces: `ProjectSchema`, `PassageSchema`, `ChoiceSchema`, `MechanicsSchema`, `StoryStateSchema`; `validateGraph(project): GraphFinding[]`; `applyEffects(state, effects): StoryState`; `isConditionMet(state, condition): boolean`.

- [ ] **Step 1: Write failing graph and state tests**

Cover a missing destination, unreachable ending, variable read before initialization, relationship label transition, delayed flag effect, and a valid three-passage story.

```ts
expect(validateGraph(projectWithMissingDestination)).toContainEqual(
  expect.objectContaining({ code: "missing_destination", passageId: "start" }),
);
expect(applyEffects(emptyState, [{ op: "addStat", key: "resolve", value: 1 }]))
  .toMatchObject({ stats: { resolve: 1 } });
```

- [ ] **Step 2: Verify both tests fail**

Run: `pnpm vitest packages/domain/test --run`

Expected: FAIL because the schemas and evaluators are absent.

- [ ] **Step 3: Implement explicit Zod schemas**

Use branded string IDs and discriminated unions:

```ts
type Condition =
  | { kind: "statAtLeast"; key: string; value: number }
  | { kind: "flagEquals"; key: string; value: boolean | string | number }
  | { kind: "hasItem"; itemId: string };

type Effect =
  | { op: "addStat"; key: string; value: number }
  | { op: "setFlag"; key: string; value: boolean | string | number }
  | { op: "addItem"; itemId: string }
  | { op: "removeItem"; itemId: string };
```

Define passage purpose, participants, required knowledge, incoming assumptions, choices, ending classification, visible stats, relationship bands, hidden flags, inventory, protagonist tendencies, and divergence mode.

- [ ] **Step 4: Implement pure state evaluation and graph validation**

Make validation deterministic and side-effect free. Emit stable finding codes and severity values (`error`, `warning`, `info`) so UI and tests do not depend on prose wording.

- [ ] **Step 5: Run domain verification**

Run:

```powershell
pnpm vitest packages/domain/test --run
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the canonical model**

```powershell
git add packages/domain
git commit -m "feat: define canonical interactive story model"
```

---

### Task 3: SQLite schema, repositories, and version invalidation

**Files:**
- Create: `packages/persistence/package.json`
- Create: `packages/persistence/src/schema.ts`
- Create: `packages/persistence/src/database.ts`
- Create: `packages/persistence/src/migrate.ts`
- Create: `packages/persistence/src/project-repository.ts`
- Create: `packages/persistence/src/artifact-repository.ts`
- Create: `packages/persistence/src/job-repository.ts`
- Create: `packages/persistence/src/index.ts`
- Create: `packages/persistence/test/repositories.test.ts`
- Create: `packages/persistence/test/invalidation.test.ts`
- Create: `apps/server/src/routes/projects.ts`
- Create: `apps/server/test/projects.test.ts`

**Interfaces:**
- Consumes: domain schemas from Task 2.
- Produces: `ProjectRepository`, `ArtifactRepository`, `JobRepository`; `saveArtifact(input): ArtifactVersion`; `markDependentsStale(projectId, artifactId): string[]`; project CRUD and artifact-history HTTP endpoints.

- [ ] **Step 1: Write failing repository tests against a temporary SQLite file**

Verify project CRUD, immutable artifact versions, restoration, job checkpoints, usage totals, and the dependency chain `source → bible → adaptation → routes → drafts → review → export`.

- [ ] **Step 2: Verify repository tests fail**

Run: `pnpm vitest packages/persistence/test --run`

Expected: FAIL because repository classes do not exist.

- [ ] **Step 3: Implement migrations and repositories**

Create tables for projects, source manifests, artifact versions, artifact dependencies, jobs, job units, usage records, conversations, and messages. Store validated structured artifacts as JSON with schema version numbers. Store large normalized source bodies under a project data directory and keep their content hashes and paths in SQLite. Use transactions for version creation plus downstream invalidation.

- [ ] **Step 4: Add corruption and rollback tests**

Attempt to save an artifact that fails its Zod schema and simulate a transaction failure after version insertion. Assert that no partial version or stale marker remains.

- [ ] **Step 5: Add project and artifact-history routes**

Implement create, list, read, rename, duplicate, archive, artifact-version list, compare, and restore endpoints. The duplicate operation copies current artifacts into a new project identity without copying credentials or active jobs. Cover every endpoint in `apps/server/test/projects.test.ts`.

- [ ] **Step 6: Run persistence and domain tests**

Run: `pnpm vitest packages/domain/test packages/persistence/test apps/server/test/projects.test.ts --run`

Expected: PASS with no open database handles.

- [ ] **Step 7: Commit persistence**

```powershell
git add packages/persistence apps/server/src/routes/projects.ts apps/server/test/projects.test.ts
git commit -m "feat: persist versioned adaptation projects"
```

---

### Task 4: TXT, AO3 HTML, and EPUB ingestion

**Files:**
- Create: `packages/importers/package.json`
- Create: `packages/importers/src/types.ts`
- Create: `packages/importers/src/text.ts`
- Create: `packages/importers/src/html.ts`
- Create: `packages/importers/src/epub.ts`
- Create: `packages/importers/src/normalize.ts`
- Create: `packages/importers/src/index.ts`
- Create: `packages/importers/test/importers.test.ts`
- Create: `packages/importers/test/fixtures/plain.txt`
- Create: `packages/importers/test/fixtures/ao3-sample.html`
- Create: `packages/importers/test/fixtures/sample.epub`
- Create: `apps/server/src/routes/import.ts`
- Create: `apps/server/test/import.test.ts`

**Interfaces:**
- Consumes: `ProjectRepository` and `ArtifactRepository`.
- Produces: `importSource(input: ImportInput): Promise<NormalizedSource>` where `NormalizedSource` contains metadata, ordered chapters, normalized blocks, and stable excerpt IDs.

- [ ] **Step 1: Write fixture-based failing tests**

Assert that AO3 navigation, download links, and work-skin chrome are removed; chapter headings and emphasis text remain; EPUB spine order is honored; and every normalized block receives a stable excerpt ID across repeat imports.

- [ ] **Step 2: Verify importer tests fail**

Run: `pnpm vitest packages/importers/test --run`

Expected: FAIL because importers are absent.

- [ ] **Step 3: Implement format-specific parsing and shared normalization**

Treat source content as inert data. Never evaluate scripts, styles, event handlers, or embedded instructions. Limit file size through validated config, reject encrypted EPUBs, normalize Unicode and whitespace, and compute excerpt IDs from chapter identity plus normalized block position and content hash.

- [ ] **Step 4: Implement file and pasted-text import endpoints**

Add `POST /api/projects/:projectId/source` for multipart files and `POST /api/projects/:projectId/source/text` for pasted UTF-8 text. Detect files by validated MIME type plus extension, return chapter summaries, and require a separate `POST /scope` call before analysis.

- [ ] **Step 5: Run import security and transport tests**

Run:

```powershell
pnpm vitest packages/importers/test apps/server/test/import.test.ts --run
pnpm typecheck
```

Expected: PASS; a malicious `<script>` fixture never appears in normalized output.

- [ ] **Step 6: Commit import support**

```powershell
git add packages/importers apps/server/src/routes/import.ts apps/server/test/import.test.ts
git commit -m "feat: import text ao3 html and epub sources"
```

---

### Task 5: Credential storage, model catalog, cost estimation, and OpenRouter client

**Files:**
- Create: `packages/openrouter/package.json`
- Create: `packages/openrouter/src/credential-store.ts`
- Create: `packages/openrouter/src/windows-credential-store.ts`
- Create: `packages/openrouter/src/model-catalog.ts`
- Create: `packages/openrouter/src/cost.ts`
- Create: `packages/openrouter/src/client.ts`
- Create: `packages/openrouter/src/errors.ts`
- Create: `packages/openrouter/src/redact.ts`
- Create: `packages/openrouter/src/index.ts`
- Create: `packages/openrouter/test/catalog.test.ts`
- Create: `packages/openrouter/test/client.test.ts`
- Create: `packages/openrouter/test/redact.test.ts`
- Create: `apps/server/src/routes/settings.ts`
- Create: `apps/server/test/settings.test.ts`

**Interfaces:**
- Consumes: validated runtime config.
- Produces: `CredentialStore`; `OpenRouterClient.listModels()`; `OpenRouterClient.generateStructured<T>(request, schema): Promise<GenerationResult<T>>`; `estimateCost(model, tokenEstimate): CostRange`.

- [ ] **Step 1: Write failing tests with mocked HTTP**

Verify bearer authentication, catalog parsing, structured-output payloads, `provider.require_parameters: true`, usage parsing, timeout, cancellation, 401, 429, provider failure, schema failure, one bounded repair attempt, and secret redaction.

- [ ] **Step 2: Verify OpenRouter tests fail**

Run: `pnpm vitest packages/openrouter/test --run`

Expected: FAIL because the client does not exist.

- [ ] **Step 3: Implement credential abstraction**

Define:

```ts
interface CredentialStore {
  getOpenRouterKey(): Promise<string | null>;
  setOpenRouterKey(value: string): Promise<void>;
  deleteOpenRouterKey(): Promise<void>;
}
```

Use Windows DPAPI through a narrow adapter when available. Fall back to `OPENROUTER_API_KEY` or `.env` without persisting the value. The browser only receives `{ configured: boolean }`.

- [ ] **Step 4: Implement catalog, structured generation, and cost calculation**

Use `GET /api/v1/models`; retain model ID, context length, prompt/completion prices, and supported parameters. Use `/api/v1/chat/completions`, strict JSON Schema where the selected model supports it, and local Zod validation in every case. Calculate estimates from explicit input/output token estimates and model prices; replace estimates with response `usage` and reported cost when present.

- [ ] **Step 5: Implement settings endpoints and security assertions**

Add key set/delete/status, model refresh, preset selection, and spending-cap endpoints. Assert response bodies, SQLite, and captured logs never contain the test key.

- [ ] **Step 6: Run verification**

Run:

```powershell
pnpm vitest packages/openrouter/test apps/server/test/settings.test.ts --run
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit OpenRouter infrastructure**

```powershell
git add packages/openrouter apps/server/src/routes/settings.ts apps/server/test/settings.test.ts
git commit -m "feat: add secure OpenRouter model access"
```

---

### Task 6: Durable pipeline jobs and source analysis

**Files:**
- Create: `packages/pipeline/package.json`
- Create: `packages/pipeline/src/job-runner.ts`
- Create: `packages/pipeline/src/dependency-map.ts`
- Create: `packages/pipeline/src/prompt-envelope.ts`
- Create: `packages/pipeline/src/stages/analyze-source.ts`
- Create: `packages/pipeline/src/schemas/story-bible.ts`
- Create: `packages/pipeline/src/prompts/analyze-chunk.ts`
- Create: `packages/pipeline/src/prompts/consolidate-bible.ts`
- Create: `packages/pipeline/src/index.ts`
- Create: `packages/pipeline/test/job-runner.test.ts`
- Create: `packages/pipeline/test/analyze-source.test.ts`
- Create: `apps/server/src/routes/jobs.ts`
- Create: `apps/server/src/routes/analysis.ts`
- Create: `apps/server/test/analysis.test.ts`

**Interfaces:**
- Consumes: repositories, `NormalizedSource`, and `OpenRouterClient`.
- Produces: `JobRunner.enqueue(spec): JobId`; resumable `JobUnit`s; `analyzeSource(projectId, scope, options): JobId`; versioned `StoryBible`.

- [ ] **Step 1: Write failing checkpoint and budget tests**

Simulate three source chunks, fail the second once, resume, and assert the completed first chunk is not repeated. Assert cancellation preserves valid units and a projected cap breach stops before an HTTP request.

- [ ] **Step 2: Write failing story-bible tests**

Use deterministic fake model outputs to verify chunk analysis, consolidation, excerpt citations, low-confidence facts, contradictory knowledge claims, and preservation of chapter scope.

- [ ] **Step 3: Run pipeline tests and verify failure**

Run: `pnpm vitest packages/pipeline/test --run`

Expected: FAIL because runner and analysis stage are absent.

- [ ] **Step 4: Implement job runner and prompt boundary**

The runner claims pending units transactionally, records attempts and usage, supports `AbortSignal`, and emits progress events. `PromptEnvelope` separates trusted system instructions from untrusted source excerpts and labels source text as quoted data that must not issue instructions.

- [ ] **Step 5: Implement chunk analysis and consolidation**

Chunk on normalized block boundaries with overlap summaries, not raw duplicated prose. Produce characters, motivations, voice traits, relationships, locations, timeline, objects, knowledge, unresolved threads, tone, prose traits, and sensitivity markers. Reject any fact whose cited excerpt ID is outside project scope.

- [ ] **Step 6: Add job and analysis routes**

Expose start, status, cancel, resume, and SSE progress endpoints. Never send raw prompts or source excerpts in progress events.

- [ ] **Step 7: Run verification and commit**

Run: `pnpm vitest packages/pipeline/test apps/server/test/analysis.test.ts --run`

```powershell
git add packages/pipeline apps/server/src/routes/jobs.ts apps/server/src/routes/analysis.ts apps/server/test/analysis.test.ts
git commit -m "feat: analyze sources with resumable jobs"
```

---

### Task 7: Adaptation interview, story-specific mechanics, and route generation

**Files:**
- Create: `packages/pipeline/src/schemas/adaptation-plan.ts`
- Create: `packages/pipeline/src/stages/propose-adaptation.ts`
- Create: `packages/pipeline/src/stages/generate-routes.ts`
- Create: `packages/pipeline/src/prompts/propose-adaptation.ts`
- Create: `packages/pipeline/src/prompts/generate-routes.ts`
- Create: `packages/pipeline/test/adaptation.test.ts`
- Create: `packages/pipeline/test/routes.test.ts`
- Create: `apps/server/src/routes/adaptation.ts`
- Create: `apps/server/src/routes/routes.ts`
- Create: `apps/server/test/adaptation.test.ts`

**Interfaces:**
- Consumes: `StoryBible`, project scope, divergence mode, size targets, content boundaries, and domain graph validator.
- Produces: versioned `AdaptationPlan`; `proposeAdaptation`; `approveAdaptation`; `generateRouteGraph`; route findings.

- [ ] **Step 1: Write failing adaptation tests**

Assert the default plan uses the existing protagonist, balanced divergence, no randomness, 3–5 proposed visible stats, labeled relationships, explicit content boundaries, a branch budget, a difficulty setting that adjusts thresholds rather than routine-action success, candidate divergence/reconvergence points, and 3–5 endings.

- [ ] **Step 2: Write failing route tests**

Feed one invalid and one valid fake model response. Assert invalid graphs receive findings and are not promoted as approved artifacts; valid graphs stay within approved size and cite story-bible facts.

- [ ] **Step 3: Verify failures**

Run: `pnpm vitest packages/pipeline/test/adaptation.test.ts packages/pipeline/test/routes.test.ts --run`

Expected: FAIL because stages are absent.

- [ ] **Step 4: Implement proposal and approval**

Store AI proposals separately from user-approved plans. Automatic mode applies defaults through the same approval command so audit and invalidation behavior are identical.

- [ ] **Step 5: Implement route generation with bounded repair**

Generate node purposes and mechanics before prose. Validate deterministically. Permit one AI repair pass containing only finding codes and affected nodes; validate again and stop for user review if errors remain.

- [ ] **Step 6: Implement endpoints and rerun tests**

Add get/propose/update/approve routes for the adaptation plan and generate/validate routes for the graph.

Run: `pnpm vitest packages/pipeline/test apps/server/test/adaptation.test.ts --run`

Expected: PASS.

- [ ] **Step 7: Commit adaptation planning**

```powershell
git add packages/pipeline apps/server/src/routes/adaptation.ts apps/server/src/routes/routes.ts apps/server/test/adaptation.test.ts
git commit -m "feat: design mechanics and bounded story routes"
```

---

### Task 8: Passage drafting, selective regeneration, and conversational change proposals

**Files:**
- Create: `packages/pipeline/src/schemas/change-proposal.ts`
- Create: `packages/pipeline/src/stages/draft-passages.ts`
- Create: `packages/pipeline/src/stages/propose-change.ts`
- Create: `packages/pipeline/src/prompts/draft-scene-batch.ts`
- Create: `packages/pipeline/src/prompts/interpret-change.ts`
- Create: `packages/pipeline/test/drafting.test.ts`
- Create: `packages/pipeline/test/change-proposal.test.ts`
- Create: `apps/server/src/routes/passages.ts`
- Create: `apps/server/src/routes/conversation.ts`
- Create: `apps/server/test/passages.test.ts`

**Interfaces:**
- Consumes: approved route graph, story bible, incoming state, adjacent summaries, and user message.
- Produces: `draftPassageBatch`; `regenerateSelection`; `proposeChange(message): ChangeProposal`; `applyChangeProposal(id): ArtifactVersion[]`.

- [ ] **Step 1: Write failing selective-generation tests**

Verify batching by scene cluster, source excerpt minimization, incoming knowledge, adjacent summaries, immutable versions, and regeneration of one branch without changing unaffected passage version IDs.

- [ ] **Step 2: Write failing change-proposal tests**

For “make Mara distrust him longer,” assert the proposal identifies relationship thresholds, affected routes/passages, downstream invalidations, and a human-readable preview. Assert no artifact changes before explicit approval.

- [ ] **Step 3: Verify failures**

Run: `pnpm vitest packages/pipeline/test/drafting.test.ts packages/pipeline/test/change-proposal.test.ts --run`

Expected: FAIL.

- [ ] **Step 4: Implement drafting and version creation**

Keep prose separate from choices and effects. Require the model to return passage prose plus cited continuity inputs; strip citations from playable prose but retain them in metadata.

- [ ] **Step 5: Implement conversational proposals**

Persist conversation messages, but derive project state only from approved structured proposals. Broad changes must enumerate stale artifacts before approval.

- [ ] **Step 6: Implement passage and conversation endpoints**

Support list, read, manual edit, compare versions, restore, batch draft, regenerate selection, propose change, and apply/reject proposal.

- [ ] **Step 7: Verify and commit**

Run: `pnpm vitest packages/pipeline/test apps/server/test/passages.test.ts --run`

```powershell
git add packages/pipeline apps/server/src/routes/passages.ts apps/server/src/routes/conversation.ts apps/server/test/passages.test.ts
git commit -m "feat: draft and revise passages selectively"
```

---

### Task 9: Deterministic playtest and AI narrative review

**Files:**
- Create: `packages/domain/src/simulate.ts`
- Create: `packages/domain/test/simulate.test.ts`
- Create: `packages/pipeline/src/schemas/narrative-finding.ts`
- Create: `packages/pipeline/src/stages/review-narrative.ts`
- Create: `packages/pipeline/src/prompts/review-narrative.ts`
- Create: `packages/pipeline/test/review.test.ts`
- Create: `apps/server/src/routes/playtest.ts`
- Create: `apps/server/test/playtest.test.ts`

**Interfaces:**
- Consumes: drafted canonical project and story bible.
- Produces: `simulateProject(project, limits): SimulationReport`; `reviewNarrative(projectId): JobId`; versioned advisory findings.

- [ ] **Step 1: Write failing simulation tests**

Cover all endings reachable, an unreachable ending, an infinite loop bounded by visit limits, impossible stat threshold, representative path length, stat minima/maxima, and reconverged branches with identical state.

- [ ] **Step 2: Write failing narrative-review tests**

Use fake responses to verify findings for false knowledge, forgotten consequences, voice drift, repetitive prose, pacing, and indistinguishable choices. Every finding must cite source excerpts and generated passages.

- [ ] **Step 3: Verify failures**

Run: `pnpm vitest packages/domain/test/simulate.test.ts packages/pipeline/test/review.test.ts --run`

Expected: FAIL.

- [ ] **Step 4: Implement bounded state-space simulation**

Hash passage ID plus normalized story state to avoid repeated work. Enforce configurable path and state ceilings and report truncation honestly instead of claiming exhaustive coverage.

- [ ] **Step 5: Implement advisory narrative review**

Store findings separately from content. Applying a suggested repair must create a normal change proposal and require approval.

- [ ] **Step 6: Implement playtest endpoints and verify**

Run: `pnpm vitest packages/domain/test packages/pipeline/test apps/server/test/playtest.test.ts --run`

Expected: PASS.

- [ ] **Step 7: Commit validation**

```powershell
git add packages/domain packages/pipeline apps/server/src/routes/playtest.ts apps/server/test/playtest.test.ts
git commit -m "feat: simulate routes and review narrative continuity"
```

---

### Task 10: Twee 3 generation and standalone SugarCube export

**Files:**
- Create: `packages/export-twine/package.json`
- Create: `packages/export-twine/src/escape.ts`
- Create: `packages/export-twine/src/render-twee.ts`
- Create: `packages/export-twine/src/story-script.ts`
- Create: `packages/export-twine/src/tweego.ts`
- Create: `packages/export-twine/src/index.ts`
- Create: `packages/export-twine/test/render-twee.test.ts`
- Create: `packages/export-twine/test/compile.test.ts`
- Create: `scripts/download-tweego.mjs`
- Create: `apps/server/src/routes/export.ts`
- Create: `apps/server/test/export.test.ts`

**Interfaces:**
- Consumes: validated drafted canonical project.
- Produces: `renderTwee(project): string`; `compileSugarCube(twee, outputPath): Promise<ExportResult>`; export download endpoints.

- [ ] **Step 1: Write failing snapshot and escaping tests**

Assert Twee 3 `StoryData`, stable IFID, `StoryTitle`, `StoryInit`, passage tags, condition macros, effects, relationship label display, inventory, and escaping of passage names and untrusted prose.

- [ ] **Step 2: Verify render tests fail**

Run: `pnpm vitest packages/export-twine/test/render-twee.test.ts --run`

Expected: FAIL.

- [ ] **Step 3: Implement pure Twee rendering**

Generate SugarCube variables in `StoryInit`, convert conditions/effects to macros, and add a compact stat sidebar. Hidden state must not be printed. Preserve a mapping from canonical passage IDs to sanitized unique Twee passage names.

- [ ] **Step 4: Add pinned Tweego acquisition and checksum verification**

Pin Tweego 2.1.1 for Windows x64 at:

```text
https://github.com/tmedwards/tweego/releases/download/v2.1.1/tweego-2.1.1-windows-x64.zip
```

During the implementation task, download the archive once to a quarantined temporary directory, calculate its SHA-256 with `Get-FileHash -Algorithm SHA256`, record the resulting digest in a checked-in manifest, delete the temporary archive, then run the completed downloader. `download-tweego.mjs` must refuse any archive whose digest differs and extract only into `tools/tweego/`.

- [ ] **Step 5: Write and run the compile integration test**

Compile a five-passage fixture with:

```powershell
tweego -f sugarcube-2 -o output.html story.twee
```

Assert exit code 0, a non-empty HTML file, the expected story title, and absence of API keys, source excerpts, prompts, and project history.

- [ ] **Step 6: Implement export endpoint**

Validate the project immediately before export. Write through a temporary file and atomically rename on success. Return editable `.twee` and standalone `.html` downloads.

- [ ] **Step 7: Run verification and commit**

Run: `pnpm vitest packages/export-twine/test apps/server/test/export.test.ts --run`

```powershell
git add packages/export-twine scripts/download-tweego.mjs apps/server/src/routes/export.ts apps/server/test/export.test.ts
git commit -m "feat: export Twee and standalone SugarCube games"
```

---

### Task 11: Guided setup and hybrid studio interface

**Files:**
- Create: `apps/web/src/api/client.ts`
- Create: `apps/web/src/api/events.ts`
- Create: `apps/web/src/app/routes.tsx`
- Create: `apps/web/src/features/setup/SetupWizard.tsx`
- Create: `apps/web/src/features/setup/ImportStep.tsx`
- Create: `apps/web/src/features/setup/AnalysisStep.tsx`
- Create: `apps/web/src/features/setup/AdaptationStep.tsx`
- Create: `apps/web/src/features/studio/StudioLayout.tsx`
- Create: `apps/web/src/features/studio/PipelineNav.tsx`
- Create: `apps/web/src/features/studio/AssistantPanel.tsx`
- Create: `apps/web/src/features/studio/ArtifactWorkspace.tsx`
- Create: `apps/web/src/features/studio/StoryMap.tsx`
- Create: `apps/web/src/features/settings/SettingsPage.tsx`
- Create: `apps/web/src/features/jobs/JobProgress.tsx`
- Create: `apps/web/test/setup.test.tsx`
- Create: `apps/web/test/studio.test.tsx`
- Create: `apps/web/test/settings.test.tsx`

**Interfaces:**
- Consumes: typed server endpoints and SSE events from Tasks 3–10.
- Produces: guided project setup, three-pane studio, expandable full-screen story map, stage-aware assistant, settings, progress, cancellation, and stale-artifact indicators.

- [ ] **Step 1: Write failing guided-setup tests**

Test import, chapter selection, analysis progress, cited story-bible review, adaptation editing, automatic defaults, approval, and transition to the studio.

- [ ] **Step 2: Write failing studio and security tests**

Assert pipeline navigation, central artifact switching, assistant proposals, graph full-screen mode, version comparison, stale warnings, and that the key input is write-only and absent after submission.

- [ ] **Step 3: Verify UI tests fail**

Run: `pnpm vitest apps/web/test --run`

Expected: FAIL because feature components are absent.

- [ ] **Step 4: Implement typed API and setup wizard**

Make each step resumable from server state. Do not store project content or credentials in localStorage. Surface excerpt citations through a source-preview dialog.

- [ ] **Step 5: Implement the hybrid studio**

Desktop layout uses pipeline left, artifact center, assistant right. Narrow layouts stack navigation and assistant into drawers without horizontal clipping. Story map is a mode of the central workspace, not the app's permanent main surface.

- [ ] **Step 6: Implement model presets, advanced controls, and cost confirmation**

Show Economy, Balanced, and Quality first. Place per-operation model selection and generation parameters behind Advanced. Require confirmation for operations with a non-zero estimated cost and display the cap.

- [ ] **Step 7: Run accessibility and UI tests**

Run:

```powershell
pnpm vitest apps/web/test --run
pnpm typecheck
pnpm build
```

Expected: PASS with keyboard-accessible dialogs, controls, and graph node selection.

- [ ] **Step 8: Commit the application interface**

```powershell
git add apps/web
git commit -m "feat: add guided setup and studio workspace"
```

---

### Task 12: In-app playable preview and targeted repair workflow

**Files:**
- Create: `apps/web/src/features/play/PlayPreview.tsx`
- Create: `apps/web/src/features/play/StatSidebar.tsx`
- Create: `apps/web/src/features/play/FeedbackComposer.tsx`
- Create: `apps/web/src/features/playtest/FindingsPanel.tsx`
- Create: `apps/web/src/features/playtest/SimulationSummary.tsx`
- Create: `apps/web/test/play-preview.test.tsx`
- Create: `apps/web/test/findings.test.tsx`

**Interfaces:**
- Consumes: canonical passages, state evaluator semantics, simulation reports, narrative findings, and change proposals.
- Produces: playable preview, restart/backtrack controls, passage-scoped feedback, finding navigation, and explicit repair approval.

- [ ] **Step 1: Write failing play-preview tests**

Play through conditional outcomes, visible stats, relationship labels, inventory, delayed flags, endings, restart, and a hard-gated choice. Assert hidden state never renders.

- [ ] **Step 2: Write failing findings tests**

Click a finding, navigate to source and generated citations, request a repair, inspect affected artifacts, reject once, then approve and assert a new version appears.

- [ ] **Step 3: Verify failures**

Run: `pnpm vitest apps/web/test/play-preview.test.tsx apps/web/test/findings.test.tsx --run`

Expected: FAIL.

- [ ] **Step 4: Implement preview using the same domain semantics**

Expose a small serialized evaluator contract from the server or a browser-safe domain build. Do not duplicate condition/effect logic in ad hoc React code.

- [ ] **Step 5: Implement findings and feedback workflow**

Attach user feedback to the current passage ID and artifact version. Route all repair actions through `ChangeProposal`.

- [ ] **Step 6: Verify and commit**

Run: `pnpm vitest apps/web/test --run`

```powershell
git add apps/web/src/features/play apps/web/src/features/playtest apps/web/test
git commit -m "feat: add playable preview and targeted repairs"
```

---

### Task 13: End-to-end workflow, recovery, launcher, and documentation

**Files:**
- Create: `e2e/fixtures/private-sample.txt`
- Create: `e2e/fixtures/fake-model-responses.json`
- Create: `e2e/story-to-cyoa.spec.ts`
- Create: `apps/server/src/services/fake-model-provider.ts`
- Create: `docs/user-guide.md`
- Modify: `scripts/launch.ps1`
- Modify: root scripts and Playwright configuration

**Interfaces:**
- Consumes: the complete application.
- Produces: repeatable offline E2E coverage and a one-command Windows launch path.

- [ ] **Step 1: Write the failing offline E2E test**

Automate:

```text
launch → set fake provider → create project → import source → select chapters
→ analyze → approve mechanics → generate routes → draft → simulate
→ repair one passage → export Twee/HTML → play representative routes
```

Assert 25–40 passages, 3–5 reachable endings, persistence after server restart, no repeated completed job unit after injected failure, and no browser console errors.

- [ ] **Step 2: Verify the E2E test fails at the first missing integration**

Run: `pnpm test:e2e --grep "complete private adaptation"`

Expected: FAIL with the first unmet integration assertion, not a fixture or startup error.

- [ ] **Step 3: Implement a deterministic fake model provider**

Enable it only when `NODE_ENV=test` and an explicit test flag are both present. Reject startup if the flag is used in production. Feed schema-valid fixture responses through the real job, validation, persistence, and UI paths.

- [ ] **Step 4: Fix integration gaps without adding new product scope**

Wire existing modules until the end-to-end test passes. Any defect fix must first gain a focused regression test in the owning package.

- [ ] **Step 5: Add restart and redaction E2E cases**

Terminate the server during drafting, restart it, resume, and verify checkpoints. Search server logs, SQLite text fields, browser storage, Twee, and HTML for the sentinel API key and assert zero matches.

- [ ] **Step 6: Complete the launcher and user guide**

`launch.ps1` checks Node/pnpm, installs locked dependencies only when absent, verifies Tweego, starts the server hidden, waits for `/api/health`, and opens the app. Document key setup, AO3 download import, model presets, cost caps, project backups, adaptation workflow, export, and troubleshooting.

- [ ] **Step 7: Run the complete verification suite**

Run:

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Expected: all commands exit 0; live OpenRouter tests are skipped.

- [ ] **Step 8: Perform one opt-in live smoke test**

With a user-provided key and an explicit small spending cap, refresh the model catalog and run one tiny structured generation. Do not import a copyrighted story for this smoke test. Confirm usage is recorded and the cap is enforced.

- [ ] **Step 9: Commit the completed MVP**

```powershell
git add e2e apps/server/src/services/fake-model-provider.ts scripts/launch.ps1 docs/user-guide.md package.json
git commit -m "test: verify complete story to cyoa workflow"
```

---

## Final acceptance checklist

- [ ] TXT, AO3 HTML, and EPUB fixtures import with stable cited excerpts.
- [ ] Whole-work and chapter-range scopes work.
- [ ] Story analysis checkpoints and resumes.
- [ ] Existing-protagonist, divergence, content, size, stat, relationship, inventory, and hidden-state proposals are editable and approved.
- [ ] Route graphs meet the approved branch budget and pass deterministic validation.
- [ ] Passage batches can be regenerated without replacing unaffected versions.
- [ ] Conversational edits become previewed, explicitly approved structured changes.
- [ ] Simulation reports reachable endings, loops, lengths, state ranges, and identical reconvergence.
- [ ] Narrative findings cite both source and generated passages and remain advisory.
- [ ] Economy, Balanced, and Quality presets plus Advanced controls work.
- [ ] Estimates, caps, actual usage, retries, cancellation, and recovery work.
- [ ] Credentials and source excerpts are absent from logs, browser storage, project exports, and generated games.
- [ ] Guided setup transitions into the three-pane studio with a full-screen story-map option.
- [ ] Playable preview and exported HTML share condition/effect behavior.
- [ ] Twee 3 and standalone SugarCube HTML export successfully.
- [ ] Default unit, integration, browser, typecheck, lint, and build commands pass offline.
