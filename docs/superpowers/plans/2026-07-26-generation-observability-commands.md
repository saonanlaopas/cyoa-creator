# Generation Observability and Persistent Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make quick CYOA generation observable and diagnosable, persist project/global commands and the OpenRouter key, and replace the generic invalid-JSON failure with complete redacted evidence and actionable recovery.

**Architecture:** Extend the OpenRouter client with preserved diagnostics and typed streaming callbacks, then expose a POSTed NDJSON stream from the local Fastify server. Store commands in SQLite, protect the API key with Windows DPAPI, and split the current monolithic React generator into focused command, activity, reasoning, and error components.

**Tech Stack:** TypeScript, Node.js 22+, Node SQLite, Fastify 5, React 19, Vite 7, Zod 3, Vitest 3, Windows PowerShell DPAPI, OpenRouter Chat Completions streaming API.

## Global Constraints

- Keep the application loopback-only and account-free.
- Project commands default to `project`; global commands require explicit promotion.
- Enabled global commands precede enabled project commands in every generation and repair prompt.
- Reasoning is labeled as OpenRouter-supplied text or summary; never claim unavailable or encrypted reasoning is full private chain of thought.
- Reasoning defaults to enabled with automatic allocation and visibly notes that reasoning tokens affect cost.
- Never persist or return a plaintext API key.
- Never write source text, reasoning, response bodies, or credentials to logs.
- Full provider responses remain in memory only, are redacted before browser delivery, and are discarded on the next run or server exit.
- Do not automatically retry a request when its billing/completion state is uncertain.
- Every model-output or graph repair attempt is visible in the event stream.
- Do not add a general prompt-bypass mechanism; presets are editable ordinary instructions and cannot override provider rules.

---

## File map

**Create:**

- `packages/openrouter/src/diagnostics.ts` — bounded, redacted response evidence and error metadata.
- `packages/openrouter/src/stream.ts` — OpenRouter SSE parsing and reasoning normalization.
- `packages/openrouter/test/stream.test.ts` — deterministic stream, reasoning, interruption, and provider-error tests.
- `packages/persistence/src/command-repository.ts` — project/global command CRUD and effective ordering.
- `packages/persistence/test/commands.test.ts` — persistence and scoping tests.
- `packages/openrouter/src/powershell-dpapi-adapter.ts` — fixed-script, stdin-based Windows DPAPI adapter.
- `packages/openrouter/test/powershell-dpapi-adapter.test.ts` — adapter and secure-store wiring tests.
- `apps/server/src/routes/commands.ts` — global/project command API.
- `apps/server/src/routes/quick-drafts.ts` — stable draft-project creation.
- `apps/server/src/services/generation-diagnostic-store.ts` — one-run in-memory diagnostic retention.
- `apps/server/src/routes/quick-generation-events.ts` — NDJSON event types and writer.
- `apps/server/test/commands.test.ts` — command and draft endpoints.
- `apps/server/test/quick-generate.test.ts` — streamed orchestration and diagnostic endpoints.
- `apps/web/src/api/quick-generation.ts` — typed NDJSON stream consumer.
- `apps/web/src/features/generator/CommandManager.tsx` — scoped persistent-command editor.
- `apps/web/src/features/generator/GenerationActivity.tsx` — elapsed time, stage history, and reasoning.
- `apps/web/src/features/generator/GenerationErrorPanel.tsx` — explanation, full-response inspection, copy/download actions.
- `apps/web/src/features/generator/QuickGenerator.tsx` — generation screen orchestration.
- `apps/web/src/features/generator/Player.tsx` — extracted existing player.
- `apps/web/test/quick-generation-api.test.ts` — stream parser tests.
- `apps/web/test/quick-generator.test.tsx` — command, activity, reasoning, and error UI tests.
- `apps/server/src/services/fake-model-provider.ts` — deterministic offline streamed success and failure fixtures.

**Modify:**

- `packages/openrouter/src/errors.ts`
- `packages/openrouter/src/client.ts`
- `packages/openrouter/src/index.ts`
- `packages/openrouter/src/windows-credential-store.ts`
- `packages/openrouter/test/client.test.ts`
- `packages/openrouter/test/redact.test.ts`
- `packages/persistence/src/schema.ts`
- `packages/persistence/src/index.ts`
- `apps/server/src/app.ts`
- `apps/server/src/routes/quick-generate.ts`
- `apps/server/src/routes/settings.ts`
- `apps/server/test/settings.test.ts`
- `apps/web/src/app/routes.tsx`
- `apps/web/src/app/app.css`
- `apps/web/package.json`
- `package.json`
- `pnpm-lock.yaml`
- `packages/*/package.json`
- `apps/server/package.json`
- `scripts/launch.ps1`
- `docs/user-guide.md`

---

### Task 1: Preserve and classify OpenRouter response evidence

**Files:**

- Create: `packages/openrouter/src/diagnostics.ts`
- Modify: `packages/openrouter/src/errors.ts`
- Modify: `packages/openrouter/src/client.ts`
- Modify: `packages/openrouter/src/index.ts`
- Modify: `packages/openrouter/test/client.test.ts`
- Modify: `packages/openrouter/test/redact.test.ts`

**Interfaces:**

- Consumes: `redactSecret(value: string): string`, `redactValue(value: unknown): unknown`.
- Produces:
  - `OpenRouterDiagnostic`
  - `boundedDiagnosticBody(body: string, maxBytes?: number): BoundedBody`
  - `parseJsonResponse<T>(response: Response): Promise<{ data: T; diagnostic: OpenRouterDiagnostic }>`
  - `OpenRouterError(code, message, options?: { status?: number; diagnostic?: OpenRouterDiagnostic; cause?: unknown })`

Extend the code union exactly to:

```ts
export type OpenRouterErrorCode =
  | "UNAUTHENTICATED"
  | "INSUFFICIENT_CREDITS"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "CONTENT_REJECTED"
  | "PROVIDER_FAILURE"
  | "TIMEOUT"
  | "CANCELLED"
  | "OPENROUTER_ENVELOPE_INVALID"
  | "STREAM_INTERRUPTED"
  | "COMPLETION_EMPTY"
  | "COMPLETION_JSON_INVALID"
  | "SCHEMA_INVALID";

export interface OpenRouterErrorOptions {
  status?: number;
  diagnostic?: OpenRouterDiagnostic;
  cause?: unknown;
}
```

- [ ] **Step 1: Add failing tests for empty, HTML, typed, and redacted responses**

```ts
const key = "sk-or-v1-test-secret-key-0123456789";
const jsonResponse = (value: unknown, init: ResponseInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(value), { ...init, headers });
};
const clientWithResponse = (response: Response) => new OpenRouterClient({
  credentialStore: new EnvironmentCredentialStore({ environment: { OPENROUTER_API_KEY: key } }),
  fetch: async () => response.clone(),
});
const rejectedError = async (client: OpenRouterClient): Promise<OpenRouterError> => {
  try {
    await client.listModels();
    throw new Error("Expected OpenRouterClient to reject");
  } catch (error) {
    if (!(error instanceof OpenRouterError)) throw error;
    return error;
  }
};

it.each([
  ["", "OPENROUTER_ENVELOPE_INVALID"],
  ["<html>bad gateway</html>", "OPENROUTER_ENVELOPE_INVALID"],
])("preserves a redacted non-JSON response", async (body, code) => {
  const client = clientWithResponse(new Response(body, {
    status: 200,
    headers: { "content-type": "text/html", "x-request-id": "req-123" },
  }));
  await expect(client.listModels()).rejects.toMatchObject({
    code,
    diagnostic: {
      status: 200,
      contentType: "text/html",
      requestId: "req-123",
    },
  });
});

it("maps a typed OpenRouter error returned with HTTP 200", async () => {
  const client = clientWithResponse(jsonResponse({
    error: { code: 402, message: "Insufficient credits", metadata: { error_type: "insufficient_credits" } },
  }));
  await expect(client.listModels()).rejects.toMatchObject({ code: "INSUFFICIENT_CREDITS" });
});

it("redacts secrets from full response evidence", async () => {
  const error = await rejectedError(clientWithResponse(new Response(`bad ${key}`, { status: 200 })));
  expect(JSON.stringify(error.diagnostic)).not.toContain(key);
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```powershell
pnpm vitest packages/openrouter/test/client.test.ts packages/openrouter/test/redact.test.ts --run
```

Expected: FAIL because diagnostics, typed codes, and the extended constructor do not exist.

- [ ] **Step 3: Add bounded diagnostic types and parsing**

```ts
export interface BoundedBody {
  text: string;
  originalBytes: number;
  truncated: boolean;
}

export interface OpenRouterDiagnostic {
  status: number;
  contentType: string | null;
  requestId: string | null;
  retryAfter: string | null;
  body: BoundedBody;
  providerError?: {
    code?: number;
    message?: string;
    errorType?: string;
    providerCode?: string;
  };
}

export function boundedDiagnosticBody(body: string, maxBytes = 1_000_000): BoundedBody {
  const safe = redactSecret(body);
  const bytes = Buffer.byteLength(safe);
  if (bytes <= maxBytes) return { text: safe, originalBytes: bytes, truncated: false };
  const half = Math.floor(maxBytes / 2);
  return {
    text: `${Buffer.from(safe).subarray(0, half).toString()}\n…[${bytes - maxBytes} bytes omitted]…\n${Buffer.from(safe).subarray(-half).toString()}`,
    originalBytes: bytes,
    truncated: true,
  };
}
```

Read `response.text()` exactly once, build the diagnostic from headers, parse the text with `JSON.parse`, and retain the diagnostic on every mapped error. Map OpenRouter `error.metadata.error_type` to stable application codes before falling back to HTTP status.

- [ ] **Step 4: Run tests and verify pass**

Run:

```powershell
pnpm vitest packages/openrouter/test/client.test.ts packages/openrouter/test/redact.test.ts --run
pnpm --filter @story-to-cyoa/openrouter typecheck
```

Expected: PASS with API keys absent from snapshots and thrown diagnostics.

- [ ] **Step 5: Commit**

```powershell
git add packages/openrouter
git commit -m "fix: preserve OpenRouter failure diagnostics"
```

---

### Task 2: Stream structured output and normalize returned reasoning

**Files:**

- Create: `packages/openrouter/src/stream.ts`
- Create: `packages/openrouter/test/stream.test.ts`
- Modify: `packages/openrouter/src/client.ts`
- Modify: `packages/openrouter/src/index.ts`

**Interfaces:**

- Consumes: `OpenRouterDiagnostic`, `OpenRouterError`, `GenerationUsage`.
- Produces:
  - `ReasoningKind = "text" | "summary" | "encrypted" | "unavailable"`
  - `OpenRouterStreamEvent`
  - `parseOpenRouterStream(response, callbacks, signal?): Promise<StreamedCompletion>`
  - `OpenRouterClient.generateStructuredStream<T>(request, schema, callbacks): Promise<GenerationResult<T>>`

- [ ] **Step 1: Write failing SSE parser tests**

```ts
const sseResponse = (values: Array<unknown | "[DONE]">) => new Response(
  values.map((value) => `data: ${value === "[DONE]" ? value : JSON.stringify(value)}\n\n`).join(""),
  { headers: { "content-type": "text/event-stream" } },
);

it("collects content and emits reasoning text", async () => {
  const response = sseResponse([
    { choices: [{ delta: { reasoning: "Considering routes. " } }] },
    { choices: [{ delta: { content: '{"title":' } }] },
    { choices: [{ delta: { content: '"ok"}' }, finish_reason: "stop" }], usage: { total_tokens: 12 } },
    "[DONE]",
  ]);
  const reasoning: string[] = [];
  const result = await parseOpenRouterStream(response, {
    onReasoning: (event) => reasoning.push(event.text ?? ""),
  });
  expect(result.content).toBe('{"title":"ok"}');
  expect(reasoning.join("")).toBe("Considering routes. ");
});

it("labels summaries and encrypted reasoning", async () => {
  const events: Array<{ kind: string; text?: string }> = [];
  await parseOpenRouterStream(sseResponse([
    { choices: [{ delta: { reasoning_details: [
      { type: "reasoning.summary", summary: "Outlined branches." },
      { type: "reasoning.encrypted", data: "opaque" },
    ] } }] },
    "[DONE]",
  ]), { onReasoning: (event) => events.push(event) });
  expect(events).toEqual([
    { kind: "summary", text: "Outlined branches." },
    { kind: "encrypted" },
  ]);
});

it("throws the typed in-band provider error", async () => {
  const response = sseResponse([{ error: {
    code: 429,
    message: "Rate limit",
    metadata: { error_type: "rate_limit_exceeded" },
  } }]);
  await expect(parseOpenRouterStream(response, {})).rejects.toMatchObject({ code: "RATE_LIMITED" });
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```powershell
pnpm vitest packages/openrouter/test/stream.test.ts --run
```

Expected: FAIL because the stream parser and reasoning types do not exist.

- [ ] **Step 3: Implement incremental SSE parsing**

```ts
export type ReasoningKind = "text" | "summary" | "encrypted" | "unavailable";

export type OpenRouterStreamEvent =
  | { type: "content"; text: string }
  | { type: "reasoning"; kind: ReasoningKind; text?: string }
  | { type: "usage"; usage: GenerationUsage };

export interface StreamCallbacks {
  onContent?: (text: string) => void;
  onReasoning?: (event: Extract<OpenRouterStreamEvent, { type: "reasoning" }>) => void;
  onUsage?: (usage: GenerationUsage) => void;
}

export interface StreamedCompletion {
  content: string;
  usage: GenerationUsage;
  provider: string | null;
  model: string | null;
  generationId: string | null;
  reportedCost: unknown;
  diagnostic: OpenRouterDiagnostic;
}
```

Use `response.body.getReader()` and `TextDecoder` to process complete `data:` lines while retaining an incomplete trailing buffer. Recognize `[DONE]`, top-level `error`, `choices[].delta.content`, `reasoning`, `reasoning_content`, and `reasoning_details`. Throw `STREAM_INTERRUPTED` when the stream ends without `[DONE]` or an explicit terminal finish reason.

- [ ] **Step 4: Add `generateStructuredStream` with one visible repair**

```ts
public async generateStructuredStream<T>(
  request: StructuredGenerationRequest,
  schema: ZodType<T>,
  callbacks: StreamCallbacks & { onRepair?: (attempt: number) => void } = {},
): Promise<GenerationResult<T>> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt === 1) callbacks.onRepair?.(1);
    const messages = attempt === 0 ? request.messages : [
      ...request.messages,
      { role: "system" as const, content: "Return only repaired JSON matching the requested schema." },
    ];
    const response = await this.request("/chat/completions", {
      method: "POST",
      signal: request.signal,
      body: JSON.stringify({
        model: request.model,
        messages,
        stream: true,
        provider: { require_parameters: true },
        response_format: supportsStrictJsonSchema(request.modelCapabilities)
          ? {
              type: "json_schema",
              json_schema: { name: "structured_response", strict: true, schema: zodToJsonSchema(schema) },
            }
          : { type: "json_object" },
        ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        reasoning: request.reasoning?.enabled
          ? { enabled: true, exclude: false, ...(request.reasoning.effort ? { effort: request.reasoning.effort } : {}) }
          : { enabled: false },
      }),
    });
    const completion = await parseOpenRouterStream(response, callbacks, request.signal);
    try {
      return {
        data: schema.parse(JSON.parse(completion.content)),
        usage: completion.usage,
        cost: request.modelCapabilities
          ? actualCost(request.modelCapabilities, { ...completion.usage, cost: completion.reportedCost })
          : null,
        repaired: attempt === 1,
      };
    } catch (error) {
      if (attempt === 1) throw schemaError(error, completion.diagnostic);
    }
  }
  throw new OpenRouterError("SCHEMA_INVALID", "Structured repair failed");
}

function schemaError(error: unknown, diagnostic: OpenRouterDiagnostic): OpenRouterError {
  return new OpenRouterError(
    "SCHEMA_INVALID",
    `OpenRouter returned invalid structured data: ${error instanceof Error ? error.message : "unknown validation error"}`,
    { diagnostic, cause: error },
  );
}
```

Extend `StructuredGenerationRequest` with:

```ts
reasoning?: { enabled: boolean; effort?: "minimal" | "low" | "medium" | "high" };
```

Do not automatically retry `OPENROUTER_ENVELOPE_INVALID`, `STREAM_INTERRUPTED`, or provider errors.

- [ ] **Step 5: Run tests and verify pass**

Run:

```powershell
pnpm vitest packages/openrouter/test --run
pnpm --filter @story-to-cyoa/openrouter typecheck
```

Expected: PASS for plain, summary, encrypted, unavailable, malformed JSON repair, cancellation, and mid-stream error cases.

- [ ] **Step 6: Commit**

```powershell
git add packages/openrouter
git commit -m "feat: stream OpenRouter reasoning and structured output"
```

---

### Task 3: Persist project and global commands

**Files:**

- Create: `packages/persistence/src/command-repository.ts`
- Create: `packages/persistence/test/commands.test.ts`
- Modify: `packages/persistence/src/schema.ts`
- Modify: `packages/persistence/src/index.ts`

**Interfaces:**

- Consumes: `StoryDatabase`, existing `projects` table.
- Produces:
  - `CommandScope = "global" | "project"`
  - `InstructionCommand`
  - `CommandRepository.create/list/update/delete/listEffective`

- [ ] **Step 1: Write failing persistence tests**

```ts
it("keeps project commands isolated and orders globals first", () => {
  const database = openDatabase();
  const projects = new ProjectRepository(database);
  const commands = new CommandRepository(database);
  const first = projects.create("First", "project-1");
  const second = projects.create("Second", "project-2");
  commands.create({ name: "Canon", instruction: "Preserve characterization.", scope: "global" });
  commands.create({ name: "Dark", instruction: "Use a mature tone.", scope: "project", projectId: first.id });
  expect(commands.listEffective(first.id).map((item) => item.name)).toEqual(["Canon", "Dark"]);
  expect(commands.listEffective(second.id).map((item) => item.name)).toEqual(["Canon"]);
});

it("persists enabled state, ordering, edits, and deletion", () => {
  const database = openDatabase();
  const projects = new ProjectRepository(database);
  const commands = new CommandRepository(database);
  const projectId = projects.create("Persistent", "persistent-project").id;
  const command = commands.create({ name: "Routes", instruction: "Use four endings.", scope: "project", projectId });
  expect(commands.update(command.id, { enabled: false, position: 4 }).enabled).toBe(false);
  expect(commands.listEffective(projectId)).toEqual([]);
  commands.delete(command.id);
  expect(commands.list({ scope: "project", projectId })).toEqual([]);
  database.close();
});

it("survives closing and reopening the SQLite file", () => {
  const directory = mkdtempSync(join(tmpdir(), "cyoa-commands-"));
  const path = join(directory, "commands.sqlite");
  const first = openDatabase(path);
  new CommandRepository(first).create({ name: "Canon", instruction: "Preserve voice.", scope: "global" });
  first.close();
  const second = openDatabase(path);
  expect(new CommandRepository(second).list({ scope: "global" })).toHaveLength(1);
  second.close();
});
```

Import `mkdtempSync` from `node:fs`, `tmpdir` from `node:os`, and `join` from `node:path` for the reopen test.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```powershell
pnpm vitest packages/persistence/test/commands.test.ts --run
```

Expected: FAIL because command tables and repository are absent.

- [ ] **Step 3: Add command tables**

```sql
CREATE TABLE IF NOT EXISTS instruction_commands (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK(scope IN ('global', 'project')),
  name TEXT NOT NULL,
  instruction TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((scope = 'global' AND project_id IS NULL) OR (scope = 'project' AND project_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS instruction_commands_scope_order
  ON instruction_commands(scope, project_id, position, created_at);
```

- [ ] **Step 4: Implement validated CRUD and effective ordering**

```ts
export interface InstructionCommand {
  id: string;
  scope: "global" | "project";
  projectId: string | null;
  name: string;
  instruction: string;
  enabled: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export class CommandRepository {
  create(input: {
    scope: "global" | "project";
    projectId?: string;
    name: string;
    instruction: string;
    enabled?: boolean;
    position?: number;
  }): InstructionCommand;
  list(filter: { scope: "global" } | { scope: "project"; projectId: string }): InstructionCommand[];
  listEffective(projectId: string): InstructionCommand[];
  update(id: string, patch: Partial<Pick<InstructionCommand, "name" | "instruction" | "enabled" | "position">>): InstructionCommand;
  delete(id: string): void;
}
```

Reject blank names/instructions, unknown projects, project scope without `projectId`, and global scope with `projectId`.

- [ ] **Step 5: Run tests and verify pass**

Run:

```powershell
pnpm vitest packages/persistence/test --run
pnpm --filter @story-to-cyoa/persistence typecheck
```

Expected: PASS, including cascade deletion and reopen-from-file persistence.

- [ ] **Step 6: Commit**

```powershell
git add packages/persistence
git commit -m "feat: persist scoped generation commands"
```

---

### Task 4: Protect and persist the OpenRouter key on Windows

**Files:**

- Create: `packages/openrouter/src/powershell-dpapi-adapter.ts`
- Create: `packages/openrouter/test/powershell-dpapi-adapter.test.ts`
- Modify: `packages/openrouter/src/windows-credential-store.ts`
- Modify: `packages/openrouter/src/index.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/test/settings.test.ts`

**Interfaces:**

- Consumes: `WindowsDpapiAdapter`, `WindowsCredentialStore`, `EnvironmentCredentialStore`.
- Produces:
  - `PowerShellDpapiAdapter`
  - `createDefaultCredentialStore(options?): CredentialStore`
  - injectable `BuildAppOptions.credentials`

- [ ] **Step 1: Write failing adapter and wiring tests**

```ts
it("passes plaintext through stdin rather than command arguments", async () => {
  const invocations: Array<{ args: string[]; stdin: string }> = [];
  const adapter = new PowerShellDpapiAdapter({
    encryptedPath: "C:\\temp\\openrouter.dpapi",
    runner: async (args, stdin) => {
      invocations.push({ args, stdin });
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  });
  await adapter.set("story-to-cyoa/openrouter", key);
  expect(invocations[0].args.join(" ")).not.toContain(key);
  expect(invocations[0].stdin).toBe(key);
});

it("uses the secure store across app rebuilds", async () => {
  const secureStore = new MemoryCredentialStore();
  const first = buildApp({ credentials: secureStore });
  await first.inject({ method: "PUT", url: "/api/settings/openrouter", payload: { apiKey: key } });
  await first.close();
  const second = buildApp({ credentials: secureStore });
  expect((await second.inject({ method: "GET", url: "/api/settings/openrouter" })).json())
    .toEqual({ configured: true });
  await second.close();
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```powershell
pnpm vitest packages/openrouter/test/powershell-dpapi-adapter.test.ts apps/server/test/settings.test.ts --run
```

Expected: FAIL because the adapter and injectable app option do not exist.

- [ ] **Step 3: Implement the fixed-script DPAPI adapter**

Use `powershell.exe -NoProfile -NonInteractive -Command <fixed script>`. Send the plaintext key only through stdin. The fixed `set` script reads stdin, calls:

```powershell
[Security.Cryptography.ProtectedData]::Protect(
  [Text.Encoding]::UTF8.GetBytes($inputText),
  $null,
  [Security.Cryptography.DataProtectionScope]::CurrentUser
)
```

and writes Base64 ciphertext to `%LOCALAPPDATA%\StoryToCYOA\credentials\openrouter.dpapi`. The `get` script reverses the operation and writes plaintext only to captured stdout. The `delete` operation removes only the resolved credential file after verifying it remains under the configured credential directory.

Inject this narrow runner so tests never invoke PowerShell:

```ts
export type PowerShellRunner = (
  args: string[],
  stdin: string,
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
```

- [ ] **Step 4: Add secure-store selection and dependency injection**

```ts
export function createDefaultCredentialStore(options: {
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  localAppData?: string;
} = {}): CredentialStore {
  const platform = options.platform ?? process.platform;
  const secureStore = platform === "win32"
    ? new WindowsCredentialStore(new PowerShellDpapiAdapter({ localAppData: options.localAppData }))
    : undefined;
  return new EnvironmentCredentialStore({ environment: options.environment, secureStore });
}
```

Extend:

```ts
export interface BuildAppOptions {
  databasePath?: string;
  maxImportBytes?: number;
  credentials?: CredentialStore;
  openRouterClient?: OpenRouterClient;
}
```

Use injected instances in tests and secure defaults in production.

- [ ] **Step 5: Run focused tests and Windows smoke test**

Run:

```powershell
pnpm vitest packages/openrouter/test/powershell-dpapi-adapter.test.ts apps/server/test/settings.test.ts --run
pnpm --filter @story-to-cyoa/openrouter typecheck
pnpm --filter @story-to-cyoa/server typecheck
```

Expected: PASS. On Windows, an opt-in adapter smoke test writes ciphertext, reads the same sentinel through DPAPI, deletes it, and confirms the ciphertext never contains the sentinel.

- [ ] **Step 6: Commit**

```powershell
git add packages/openrouter apps/server/src/app.ts apps/server/test/settings.test.ts
git commit -m "feat: protect OpenRouter credentials across restarts"
```

---

### Task 5: Expose command and draft-project APIs

**Files:**

- Create: `apps/server/src/routes/commands.ts`
- Create: `apps/server/src/routes/quick-drafts.ts`
- Create: `apps/server/test/commands.test.ts`
- Modify: `apps/server/src/app.ts`

**Interfaces:**

- Consumes: `ProjectRepository`, `CommandRepository`, `InstructionCommand`.
- Produces:
  - `POST /api/quick/drafts`
  - CRUD `/api/commands/global`
  - CRUD `/api/projects/:projectId/commands`
  - `GET /api/projects/:projectId/commands/effective`

- [ ] **Step 1: Write failing route tests**

```ts
it("creates a stable local draft and project-scoped command", async () => {
  const draft = await app.inject({ method: "POST", url: "/api/quick/drafts", payload: {} });
  expect(draft.statusCode).toBe(201);
  const projectId = draft.json().projectId;
  const created = await app.inject({
    method: "POST",
    url: `/api/projects/${projectId}/commands`,
    payload: { name: "Tone", instruction: "Use a mature tone." },
  });
  expect(created.json()).toMatchObject({ scope: "project", projectId, enabled: true });
});

it("promotes a project command by copying it globally", async () => {
  const draft = await app.inject({ method: "POST", url: "/api/quick/drafts", payload: {} });
  const projectId = draft.json().projectId as string;
  const created = await app.inject({
    method: "POST",
    url: `/api/projects/${projectId}/commands`,
    payload: { name: "Tone", instruction: "Use a mature tone." },
  });
  const commandId = created.json().id as string;
  const promoted = await app.inject({
    method: "POST",
    url: `/api/projects/${projectId}/commands/${commandId}/promote`,
  });
  expect(promoted.statusCode).toBe(201);
  expect(promoted.json()).toMatchObject({ scope: "global", projectId: null });
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```powershell
pnpm vitest apps/server/test/commands.test.ts --run
```

Expected: FAIL with route-not-found responses.

- [ ] **Step 3: Implement validated routes**

```ts
export function registerCommandRoutes(
  app: FastifyInstance,
  projects: ProjectRepository,
  commands: CommandRepository,
): void;

export function registerQuickDraftRoutes(
  app: FastifyInstance,
  projects: ProjectRepository,
): void;
```

`POST /api/quick/drafts` returns `{ projectId, name: "Untitled adaptation" }`. Reject missing projects with 404, invalid command bodies with 400, and cross-project command IDs with 404. Promotion creates an independent global copy and leaves the original unchanged.

- [ ] **Step 4: Run tests and verify pass**

Run:

```powershell
pnpm vitest apps/server/test/commands.test.ts apps/server/test/projects.test.ts --run
pnpm --filter @story-to-cyoa/server typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/server/src/routes/commands.ts apps/server/src/routes/quick-drafts.ts apps/server/test/commands.test.ts apps/server/src/app.ts
git commit -m "feat: add persistent command APIs"
```

---

### Task 6: Stream quick generation, repairs, and full diagnostics

**Files:**

- Create: `apps/server/src/services/generation-diagnostic-store.ts`
- Create: `apps/server/src/routes/quick-generation-events.ts`
- Create: `apps/server/test/quick-generate.test.ts`
- Modify: `apps/server/src/routes/quick-generate.ts`
- Modify: `apps/server/src/app.ts`

**Interfaces:**

- Consumes:
  - `OpenRouterClient.generateStructuredStream`
  - `CommandRepository.listEffective(projectId)`
  - `ProjectRepository`
  - `ArtifactRepository`
  - `importSource`
  - `OpenRouterDiagnostic`
- Produces:
  - `QuickGenerationEvent`
  - streamed `POST /api/quick/generate`
  - `GET /api/quick/diagnostics/:diagnosticId`

- [ ] **Step 1: Write failing orchestration tests**

```ts
it("streams stages, reasoning, repair, and a final result", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/api/quick/generate",
    payload: { projectId, source, model: "test/model", targetPassages: 8, showReasoning: true },
  });
  const events = parseNdjson(response.body);
  expect(events.map((event) => event.type)).toEqual(expect.arrayContaining([
    "status", "reasoning", "validation", "repair", "result",
  ]));
  expect(fakeClient.requests.at(-1)?.messages.map((message) => message.content).join("\n"))
    .toContain("Preserve characterization.");
  expect(response.headers["content-type"]).toContain("application/x-ndjson");
});

it("replaces invalid JSON with a typed diagnostic reference", async () => {
  fakeClient.rejectWith(new OpenRouterError("OPENROUTER_ENVELOPE_INVALID", "Non-JSON response", {
    diagnostic: htmlDiagnostic,
  }));
  const events = parseNdjson((await generate()).body);
  const failure = events.at(-1);
  expect(failure).toMatchObject({
    type: "error",
    error: { code: "OPENROUTER_ENVELOPE_INVALID" },
  });
  const diagnostic = await app.inject({ method: "GET", url: `/api/quick/diagnostics/${failure.diagnosticId}` });
  expect(diagnostic.json().body.text).toContain("bad gateway");
  expect(diagnostic.body).not.toContain(apiKey);
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```powershell
pnpm vitest apps/server/test/quick-generate.test.ts --run
```

Expected: FAIL because the endpoint returns one JSON object and no diagnostic store exists.

- [ ] **Step 3: Define the browser-safe event union**

```ts
export type QuickGenerationEvent =
  | { type: "status"; stage: GenerationStage; message: string; at: string }
  | { type: "reasoning"; kind: "text" | "summary" | "encrypted" | "unavailable"; text?: string; at: string }
  | { type: "usage"; inputTokens: number; outputTokens: number; totalTokens: number; at: string }
  | { type: "validation"; phase: "schema" | "graph"; findings: unknown[]; at: string }
  | { type: "repair"; phase: "structured-output" | "graph"; attempt: 1; at: string }
  | { type: "result"; generation: QuickGenerationResult; at: string }
  | { type: "error"; error: PublicGenerationError; diagnosticId?: string; at: string };

export type GenerationStage =
  | "preparing"
  | "request"
  | "receiving"
  | "schema-validation"
  | "structured-repair"
  | "graph-validation"
  | "graph-repair"
  | "export"
  | "complete"
  | "failed";

export interface PublicGenerationError {
  code: OpenRouterErrorCode | "GRAPH_INVALID" | "EXPORT_FAILED" | "LOCAL_STREAM_INVALID";
  message: string;
  retryable: boolean;
  retryAfterSeconds?: number;
}

export interface QuickGenerationResult {
  project: Project;
  twee: string;
  html: string;
  compiler: string;
  findings: GraphFinding[];
  usage: GenerationUsage;
  cost: CostRange | null;
}
```

Use `writeNdjson(raw, event)` to write one `JSON.stringify(event) + "\n"` record and never write raw model content to the stream.

- [ ] **Step 4: Implement one-run diagnostic retention**

```ts
export class GenerationDiagnosticStore {
  replace(value: StoredGenerationDiagnostic): string;
  get(id: string): StoredGenerationDiagnostic | undefined;
  clear(): void;
}

export interface StoredGenerationDiagnostic {
  model: string;
  provider: string | null;
  generationId: string | null;
  containsSourceText: boolean;
  response: OpenRouterDiagnostic;
  schemaIssues?: Array<{ path: Array<string | number>; message: string }>;
  graphFindings?: GraphFinding[];
}
```

`replace` clears the prior record, redacts nested data, applies the maximum body size, creates a random ID, and records `containsSourceText` by comparing normalized source excerpts of at least 40 characters. The GET route returns 404 after a later run replaces the record.

- [ ] **Step 5: Convert quick generation to streamed orchestration**

Require `projectId`, normalize and save the submitted source as the project's current `source` artifact, load enabled effective commands, append them under a dedicated trusted instruction section, and keep source text inside the existing untrusted `<source>` boundary. Emit explicit events before/after OpenRouter, schema validation, graph validation, repair, and export.

Create an abort controller tied to the client connection, then call:

```ts
const controller = new AbortController();
request.raw.once("aborted", () => controller.abort("request aborted"));
reply.raw.once("close", () => {
  if (!reply.raw.writableEnded) controller.abort("client disconnected");
});

await client.generateStructuredStream(
  {
    model,
    messages,
    maxTokens: 24_000,
    temperature: 0.7,
    reasoning: showReasoning ? { enabled: true, effort: reasoningEffort } : { enabled: false },
    signal: controller.signal,
  },
  ProjectSchema,
  {
    onReasoning: (event) => send({ type: "reasoning", ...event, at: now() }),
    onUsage: (usage) => send({ type: "usage", ...usage, at: now() }),
    onRepair: () => send({ type: "repair", phase: "structured-output", attempt: 1, at: now() }),
  },
);
```

On error, send a safe explanation and store full diagnostic evidence. Do not rethrow after the stream has started.

- [ ] **Step 6: Run tests and verify pass**

Run:

```powershell
pnpm vitest apps/server/test/quick-generate.test.ts apps/server/test/commands.test.ts --run
pnpm --filter @story-to-cyoa/server typecheck
```

Expected: PASS with event order, effective commands, repair visibility, diagnostic replacement, source warning, and secret redaction covered.

- [ ] **Step 7: Commit**

```powershell
git add apps/server/src/routes/quick-generate.ts apps/server/src/routes/quick-generation-events.ts apps/server/src/services/generation-diagnostic-store.ts apps/server/src/app.ts apps/server/test/quick-generate.test.ts
git commit -m "feat: stream observable quick generation"
```

---

### Task 7: Build the command manager and streamed browser client

**Files:**

- Create: `apps/web/src/api/quick-generation.ts`
- Create: `apps/web/src/features/generator/CommandManager.tsx`
- Create: `apps/web/src/features/generator/QuickGenerator.tsx`
- Create: `apps/web/src/features/generator/Player.tsx`
- Create: `apps/web/test/quick-generation-api.test.ts`
- Modify: `apps/web/src/app/routes.tsx`
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: command REST routes and `QuickGenerationEvent` JSON shape.
- Produces:
  - `streamQuickGeneration(input, handlers, signal): Promise<void>`
  - `CommandManager`
  - `QuickGenerator`

- [ ] **Step 1: Write failing NDJSON parser tests**

```ts
it("parses records split across arbitrary chunks", async () => {
  const events: QuickGenerationEvent[] = [];
  await consumeNdjson(streamOf(
    '{"type":"status","stage":"request","message":"Sending","at":"t"}\n{"type":"reason',
    'ing","kind":"summary","text":"Outline","at":"t"}\n',
  ), (event) => events.push(event));
  expect(events.map((event) => event.type)).toEqual(["status", "reasoning"]);
});

it("rejects a malformed terminal record with its raw line", async () => {
  await expect(consumeNdjson(streamOf('{"type":bad}\n'), () => {}))
    .rejects.toMatchObject({ code: "LOCAL_STREAM_INVALID" });
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```powershell
pnpm vitest apps/web/test/quick-generation-api.test.ts --run
```

Expected: FAIL because the stream consumer does not exist.

- [ ] **Step 3: Implement the browser stream client**

```ts
export async function streamQuickGeneration(
  input: QuickGenerationInput,
  onEvent: (event: QuickGenerationEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch("/api/quick/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok || !response.body) throw await httpError(response);
  await consumeNdjson(response.body, onEvent);
}
```

Decode chunks incrementally, parse only newline-terminated records, and parse one final non-empty buffer at EOF.

Define the browser `QuickGenerationEvent`, `GenerationStage`, `PublicGenerationError`, and `QuickGenerationResult` shapes exactly as specified in Task 6. Add a contract test that parses one fixture containing every event variant so server and browser field names cannot drift silently.

- [ ] **Step 4: Extract the player and create the command manager**

Move `Player`, `download`, and gameplay types from `routes.tsx` without behavior changes. Implement `CommandManager` with:

```ts
export interface CommandManagerProps {
  projectId: string;
  globalCommands: InstructionCommand[];
  projectCommands: InstructionCommand[];
  onChanged(): Promise<void>;
}
```

The manager supports add, edit, enable/disable, delete, reorder, and promote-to-global. Preset buttons populate an editable form and do not save until confirmed.

- [ ] **Step 5: Add component tests for project/global scope**

Add `@testing-library/react`, `@testing-library/user-event`, and `jsdom` as web dev dependencies, and configure the test file with `// @vitest-environment jsdom`.

```tsx
it("creates project commands by default and explicitly promotes globally", async () => {
  render(<CommandManager projectId="p1" globalCommands={[]} projectCommands={[]} onChanged={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: "Add command" }));
  await userEvent.type(screen.getByLabelText("Command name"), "Tone");
  await userEvent.type(screen.getByLabelText("Instruction"), "Use a mature tone.");
  await userEvent.click(screen.getByRole("button", { name: "Save for this story" }));
  expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/commands", expect.objectContaining({ method: "POST" }));
});
```

- [ ] **Step 6: Run focused tests and verify pass**

Run:

```powershell
pnpm vitest apps/web/test/quick-generation-api.test.ts apps/web/test/quick-generator.test.tsx --run
pnpm --filter @story-to-cyoa/web typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add apps/web/src/api/quick-generation.ts apps/web/src/features/generator apps/web/src/app/routes.tsx apps/web/test apps/web/package.json pnpm-lock.yaml
git commit -m "feat: add persistent generation commands"
```

---

### Task 8: Render live activity, returned reasoning, and full errors

**Files:**

- Create: `apps/web/src/features/generator/GenerationActivity.tsx`
- Create: `apps/web/src/features/generator/GenerationErrorPanel.tsx`
- Modify: `apps/web/src/features/generator/QuickGenerator.tsx`
- Modify: `apps/web/test/quick-generator.test.tsx`
- Modify: `apps/web/src/app/app.css`

**Interfaces:**

- Consumes: `QuickGenerationEvent[]`, diagnostic GET endpoint.
- Produces: accessible activity timeline, reasoning disclosure, error details, copy/download controls.

- [ ] **Step 1: Write failing UI behavior tests**

```tsx
it("shows real stages, elapsed time, and provider-supplied reasoning", async () => {
  render(<GenerationActivity startedAt={0} now={65_000} events={[
    { type: "status", stage: "request", message: "Sending request", at: "t" },
    { type: "reasoning", kind: "summary", text: "Mapped three endings.", at: "t" },
  ]} />);
  expect(screen.getByText("1:05 elapsed")).toBeVisible();
  expect(screen.getByText("Sending request")).toBeVisible();
  expect(screen.getByText("Model reasoning supplied by OpenRouter")).toBeVisible();
  expect(screen.getByText("Provider summary")).toBeVisible();
});

it("shows a full redacted response and source warning", async () => {
  render(<GenerationErrorPanel error={{
    code: "OPENROUTER_ENVELOPE_INVALID",
    message: "OpenRouter returned a non-JSON response.",
    retryable: true,
    diagnosticId: "diag-1",
  }} loadDiagnostic={async () => ({
    containsSourceText: true,
    body: { text: "<html>bad gateway</html>", truncated: false, originalBytes: 24 },
  })} />);
  await userEvent.click(screen.getByRole("button", { name: "View full response" }));
  expect(screen.getByText(/may contain submitted source text/i)).toBeVisible();
  expect(screen.getByText("<html>bad gateway</html>")).toBeVisible();
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```powershell
pnpm vitest apps/web/test/quick-generator.test.tsx --run
```

Expected: FAIL because activity and diagnostic components do not exist.

- [ ] **Step 3: Implement activity and reasoning rendering**

```tsx
export function GenerationActivity(props: {
  startedAt: number;
  now: number;
  events: QuickGenerationEvent[];
  onCancel?(): void;
}) {
  const statuses = props.events.filter((event) => event.type === "status");
  const reasoning = props.events.filter((event) => event.type === "reasoning");
  return <section aria-live="polite" aria-label="Generation activity">
    <p>{formatElapsed(props.now - props.startedAt)} elapsed</p>
    <ol>{statuses.map((event, index) => <li key={`${event.at}-${index}`}>{event.message}</li>)}</ol>
    <details open={reasoning.some((event) => Boolean(event.text))}>
      <summary>Model reasoning supplied by OpenRouter</summary>
      {reasoning.map((event, index) =>
        <p key={`${event.at}-${index}`}><strong>{reasoningLabel(event.kind)}</strong>{event.text ? `: ${event.text}` : ""}</p>)}
    </details>
    {props.onCancel && <button onClick={props.onCancel}>Cancel generation</button>}
  </section>;
}

const formatElapsed = (milliseconds: number) => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

const reasoningLabel = (kind: "text" | "summary" | "encrypted" | "unavailable") => ({
  text: "Reasoning",
  summary: "Provider summary",
  encrypted: "Encrypted reasoning",
  unavailable: "No displayable reasoning",
}[kind]);
```

Use a one-second timer owned by `QuickGenerator`; clear it on result, error, cancel, and unmount. Append reasoning deltas without replacing earlier text. Keep the reasoning disclosure expanded by default when reasoning is enabled and displayable.

- [ ] **Step 4: Implement actionable full diagnostics**

```tsx
export function GenerationErrorPanel(props: {
  error: PublicGenerationError & { diagnosticId?: string };
  loadDiagnostic(id: string): Promise<GenerationDiagnostic>;
  onRetry(): void;
  onChangeModel(): void;
}) {
  const [diagnostic, setDiagnostic] = useState<GenerationDiagnostic | null>(null);
  const show = async () => {
    if (props.error.diagnosticId) setDiagnostic(await props.loadDiagnostic(props.error.diagnosticId));
  };
  return <section role="alert">
    <p>{props.error.message}</p>
    <button onClick={props.onRetry}>Retry</button>
    <button onClick={props.onChangeModel}>Try another model</button>
    {props.error.diagnosticId && <button onClick={show}>View full response</button>}
    {diagnostic?.containsSourceText && <p>The response may contain submitted source text.</p>}
    {diagnostic && <pre>{diagnostic.body.text}</pre>}
  </section>;
}

export interface GenerationDiagnostic {
  containsSourceText: boolean;
  status?: number;
  contentType?: string | null;
  requestId?: string | null;
  body: { text: string; originalBytes: number; truncated: boolean };
}
```

`Copy diagnostics` copies redacted JSON. `Download full response` saves the redacted body with `originalBytes` and `truncated` metadata. Both actions require confirmation when `containsSourceText` is true. Never render request headers containing authorization.

- [ ] **Step 5: Integrate generation state**

`QuickGenerator` must:

- Create a draft project before the first project command save or generation.
- Persist only `story-to-cyoa.active-project-id` in browser local storage, then reload the draft and commands from the server after restart.
- Load persisted commands and key-configured status on mount.
- Provide `Forget key`, call `DELETE /api/settings/openrouter`, and immediately update configured state without ever retrieving the key.
- Default `showReasoning` to true and show the cost note.
- Send `projectId`, reasoning setting, source, model, passage target, and one-off direction.
- Append stream events in order.
- Abort the active fetch when cancel is clicked.
- Display `result` with the extracted `Player`.
- Keep failure diagnostics available until the next generation starts.

- [ ] **Step 6: Run focused tests and accessibility checks**

Run:

```powershell
pnpm vitest apps/web/test/quick-generator.test.tsx apps/web/test/quick-generation-api.test.ts --run
pnpm --filter @story-to-cyoa/web typecheck
pnpm --filter @story-to-cyoa/web build
```

Expected: PASS with no React act warnings, unhandled promise rejections, or missing accessible names.

- [ ] **Step 7: Commit**

```powershell
git add apps/web/src/features/generator apps/web/src/app apps/web/test
git commit -m "feat: show generation activity and full diagnostics"
```

---

### Task 9: Make production resolve builds while development resolves source

**Files:**

- Modify: `packages/domain/package.json`
- Modify: `packages/importers/package.json`
- Modify: `packages/openrouter/package.json`
- Modify: `packages/persistence/package.json`
- Modify: `packages/pipeline/package.json`
- Modify: `packages/export-twine/package.json`
- Modify: `apps/server/package.json`
- Modify: `scripts/launch.ps1`
- Create: `apps/server/test/production-entry.test.ts`

**Interfaces:**

- Consumes: compiled `dist/index.js` outputs.
- Produces: conditional package exports that resolve source during development/typechecking and compiled files in production, plus a launcher that always builds current sources and starts `apps/server/dist/main.js`.

- [ ] **Step 1: Add a production-entry smoke assertion**

```ts
it("loads the compiled server entry with Node package exports", async () => {
  const entry = pathToFileURL(resolve("apps/server/dist/app.js")).href;
  const result = spawnSync(process.execPath, [
    "--input-type=module",
    "--eval",
    `await import(${JSON.stringify(entry)})`,
  ], { encoding: "utf8" });
  expect(result.status).toBe(0);
  expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
});
```

Import `spawnSync` from `node:child_process`, `resolve` from `node:path`, and `pathToFileURL` from `node:url`. Run the test only after `pnpm build` and keep it separate from in-process Fastify health assertions.

- [ ] **Step 2: Run build and smoke test to verify current failure**

Run:

```powershell
pnpm build
pnpm vitest apps/server/test/production-entry.test.ts --run
```

Expected before the fix: FAIL because workspace package exports resolve `src/index.ts` and raw Node cannot find source-relative `.js` files.

- [ ] **Step 3: Add conditional source/development and compiled/production exports**

For each workspace library package, replace:

```json
"exports": "./src/index.ts"
```

with:

```json
"main": "./dist/index.js",
"types": "./src/index.ts",
"exports": {
  ".": {
    "development": "./src/index.ts",
    "types": "./src/index.ts",
    "import": "./dist/index.js",
    "default": "./dist/index.js"
  }
}
```

TypeScript resolves the `types` source entry, Vite development resolves the `development` entry, and raw production Node resolves the compiled `import` entry. Update the server development script to activate the development condition:

```json
"dev": "tsx --conditions=development watch src/main.ts"
```

The web Vite dev server already includes the `development` condition. Verify both dev entry points resolve workspace source before accepting the change.

- [ ] **Step 4: Make launcher builds freshness-safe**

Update `scripts/launch.ps1` to run the locked build on every launch after dependency installation:

```powershell
& $pnpmPath build
if ($LASTEXITCODE) { throw "Build failed." }
```

Do not use the existence of `apps/server/dist/main.js` as a freshness check.

- [ ] **Step 5: Verify production start**

Run:

```powershell
pnpm build
pnpm vitest apps/server/test/production-entry.test.ts apps/server/test/health.test.ts --run
pnpm --filter @story-to-cyoa/server typecheck
pnpm --filter @story-to-cyoa/web typecheck
powershell -ExecutionPolicy Bypass -File scripts/launch.ps1 -Port 3010
```

Expected: build, source-resolving typechecks, and health smoke pass; the launcher reports a process ID and `http://127.0.0.1:3010`; `/api/health` returns `{ "ok": true, "service": "story-to-cyoa" }`.

- [ ] **Step 6: Commit**

```powershell
git add packages/*/package.json apps/server/package.json scripts/launch.ps1 apps/server/test/production-entry.test.ts
git commit -m "fix: launch compiled workspace packages"
```

---

### Task 10: Document, verify, and perform an opt-in live smoke test

**Files:**

- Modify: `docs/user-guide.md`
- Modify: `e2e/story-to-cyoa.spec.ts`
- Create: `apps/server/src/services/fake-model-provider.ts`
- Modify: `e2e/fixtures/fake-model-responses.json`

**Interfaces:**

- Consumes: completed command, reasoning, diagnostic, credential, and launcher behavior.
- Produces: user documentation and offline end-to-end regression coverage.

- [ ] **Step 1: Add failing offline E2E assertions**

```ts
await expect(page.getByText("Always apply")).toBeVisible();
await page.getByRole("button", { name: "Generate CYOA" }).click();
await expect(page.getByText("Model reasoning supplied by OpenRouter")).toBeVisible();
await expect(page.getByText("Validating branch graph")).toBeVisible();
await expect(page.getByText("Generated game")).toBeVisible();
```

Add a fake-provider failure scenario that emits an HTML body and assert the UI shows `OpenRouter returned a non-JSON response`, `View full response`, and the redacted body.

- [ ] **Step 2: Run E2E tests and verify failure**

Run:

```powershell
pnpm test:e2e --grep "observable quick generation"
```

Expected: FAIL until the fake model stream and selectors are wired.

- [ ] **Step 3: Extend the fake provider and user guide**

Document:

- Persistent Windows-protected key behavior and `Forget key`.
- Project versus global commands.
- Reasoning availability, summaries/encrypted reasoning, and token cost.
- Generation activity and cancellation.
- Error categories, full-response inspection, source warnings, and manual retry.
- The screenshot's former invalid-JSON message and its replacement diagnostics.

Make the fake provider emit deterministic reasoning, content, usage, one repair event, and a typed failure fixture through the real streaming path.

- [ ] **Step 4: Run complete offline verification**

Run:

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Expected: all commands exit 0; live OpenRouter calls remain excluded.

- [ ] **Step 5: Run secret and response-retention audit**

Run:

```powershell
rg -n "sk-or-v1-|OPENROUTER_API_KEY" data exports apps packages docs -g '!**/test/**' -g '!**/*.md'
```

Expected: no persisted key values; only intentional variable names or redaction patterns are allowed. Restart the server and verify the API reports the key configured while the prior diagnostic endpoint returns 404.

- [ ] **Step 6: Offer, then run, a live smoke test only with explicit approval**

Use a tiny original source over 100 characters, target 8 passages, the user's selected model, reasoning enabled, and a user-approved spending cap. Verify:

- At least one real activity event is visible before completion.
- Returned reasoning is displayed or accurately reported unavailable.
- The final project passes schema and graph validation.
- Usage and cost are shown.
- A deliberately selected failing provider/model path yields typed diagnostics.

Do not run this step without explicit user approval because it can incur OpenRouter charges.

- [ ] **Step 7: Commit**

```powershell
git add docs/user-guide.md e2e/story-to-cyoa.spec.ts apps/server/src/services/fake-model-provider.ts e2e/fixtures/fake-model-responses.json
git commit -m "test: verify observable generation workflow"
```

---

## Final acceptance checklist

- [ ] The API key survives a server restart and never appears in browser storage, SQLite, logs, diagnostics, or exports.
- [ ] Project commands survive restart and remain isolated from other projects.
- [ ] Global commands apply to every project only after explicit promotion.
- [ ] Initial generation and all repair prompts receive the same enabled effective commands.
- [ ] The UI shows elapsed time and real stage events without fabricated percentages.
- [ ] Displayable OpenRouter reasoning streams live and is accurately labeled.
- [ ] Encrypted, summarized, or absent reasoning is described accurately.
- [ ] Empty, HTML, malformed, typed, and mid-stream OpenRouter errors remain distinguishable.
- [ ] The former `OpenRouter returned invalid JSON` dead end is replaced by an actionable typed failure.
- [ ] The full redacted response is viewable, copyable, and downloadable with truncation/source warnings.
- [ ] Potentially billable retries require explicit user action.
- [ ] Structured-output and graph repairs are bounded to one attempt each and visible.
- [ ] The production launcher builds fresh sources and starts raw Node without module-resolution errors.
- [ ] Lint, typecheck, unit/integration tests, build, and offline E2E all pass.
