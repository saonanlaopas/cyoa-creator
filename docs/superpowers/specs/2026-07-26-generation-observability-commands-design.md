# Generation Observability, Persistent Commands, and Diagnostics

## Purpose

Improve the quick Story-to-CYOA workflow so a user can see useful live activity during long generations, inspect reasoning that OpenRouter actually supplies, understand failures, persist reusable instructions, and keep the OpenRouter API key securely across application restarts.

The most important defect to resolve is the current `OpenRouter returned invalid JSON` dead end. That message discards the response evidence needed to determine whether OpenRouter returned an empty body, a non-JSON error page, a typed provider error, malformed model content, or schema-invalid content.

## Goals

- Show elapsed time and real generation stages instead of a static disabled button.
- Display reasoning text or summaries returned by OpenRouter when the selected model and provider expose them.
- Never invent or imply access to reasoning that the provider did not return.
- Let users create editable commands that are always included in model generation and repair requests.
- Scope commands to one project by default, with an option to make a command global.
- Persist project commands, global commands, and the OpenRouter key across restarts.
- Protect the API key for the current Windows user and never expose it back to the browser.
- Replace generic failures with typed, actionable errors and optional full-response inspection.
- Preserve privacy by keeping activity, diagnostics, commands, source text, and credentials local.

## Non-goals

- Bypassing OpenRouter, model-provider, or application safety controls.
- Claiming that returned reasoning is a model's complete private chain of thought.
- Automatically retrying requests that may incur duplicate charges when completion state is unknown.
- Replacing the quick generator with the full multi-stage adaptation pipeline in this change.
- Persisting reasoning transcripts indefinitely.

## User experience

### Persistent commands

Add an **Always apply** command manager beneath the source-specific direction field. Each command contains:

- A user-defined name.
- Instruction text.
- An enabled switch.
- A scope of `This story` or `All stories`.

New commands default to `This story`. The user may promote a project command to a global command or copy a global command into the current project. Global and project commands remain independently editable; changing one does not silently modify the other.

Suggested presets such as `Preserve characterization`, `Stronger divergence`, `Mature tone`, and `Fewer creative restrictions` are templates for ordinary commands. They have no privileged behavior and cannot override provider safety rules. Users may edit or delete every preset-derived command.

Before generation, the UI shows the enabled commands that will be sent. The server combines global commands first and project commands second, preserving the visible order. The same combined command list is included in initial generation and model-driven repair requests.

### Draft-project creation

The quick workflow must acquire a stable local project identity before project-scoped commands can persist. On the first project-specific save or generation, the server creates a local draft project with a generated identifier and a temporary display name. The browser retains only the project identifier; source content and commands are stored by the local server. A successful generation updates the draft project's title from the validated generated project.

### Live activity

While a generation is active, replace the static `Designing and writing...` state with an activity card containing:

- Elapsed wall-clock time.
- Current stage.
- A chronological event list.
- An expandable model-reasoning section.
- A cancel control when cancellation remains safe.

Stages are based on real application boundaries:

1. Preparing source and commands.
2. Sending the OpenRouter request.
3. Waiting for the selected provider.
4. Receiving reasoning or generated content.
5. Parsing and validating structured output.
6. Repairing structured output, when required.
7. Validating the branch graph.
8. Repairing graph links, when required.
9. Building Twee and playable HTML.
10. Complete or failed.

The UI shows received byte or token counts whenever OpenRouter supplies them, but it does not display fabricated percentages when the total work is unknowable.

### Returned reasoning

Add a user-controlled **Show model reasoning** option. It defaults to enabled with OpenRouter's automatic reasoning allocation. When enabled, requests include OpenRouter's unified `reasoning` parameter with `enabled: true` and `exclude: false`; advanced settings may select a supported effort level. The control explains that reasoning tokens count toward usage and cost.

The activity panel labels the content **Model reasoning supplied by OpenRouter**. It handles four cases explicitly:

- Plain reasoning text: display incrementally.
- Provider-supplied reasoning summary: display incrementally and label it as a summary.
- Encrypted or redacted reasoning details: report that reasoning was returned but is not readable.
- No reasoning: report that the selected model/provider did not return displayable reasoning.

Reasoning is retained only in the current generation session by default. It is not written into the project, exported game, server logs, or copied diagnostics unless the user explicitly includes it.

### Error presentation

Every failure has two layers:

1. A concise explanation and suggested next action.
2. Expandable diagnostics for investigation.

The diagnostic view includes, when available:

- Application error category.
- HTTP status.
- OpenRouter typed error and provider code.
- Selected model and returned provider/model identifiers.
- Request or generation identifier.
- Response content type.
- Retry-after value.
- Schema-validation issues with paths.
- Graph-validation findings.
- A sanitized full response body.

Provider-generation failures include `Retry`, `Try another model`, `Copy diagnostics`, and `Download full response` actions. The full response is collapsed by default. Before copying or downloading content that appears to contain submitted source text, the UI warns the user.

Authorization headers and API keys are always removed. Diagnostic redaction also applies the existing secret-redaction rules to nested error metadata and response bodies.

## Architecture

### Local persistence

Extend local persistence with:

- Global command records.
- Project command records keyed by project ID.
- Stable ordering and enabled state.
- A draft-project association for the quick workflow.

Command writes are server-side. Browser storage contains no API key, source text, command bodies, reasoning transcripts, or provider response bodies.

### Windows-protected credentials

Wire `EnvironmentCredentialStore` to a concrete `WindowsCredentialStore` adapter in normal Windows launches. The adapter encrypts the key for the current Windows user through DPAPI and stores only the encrypted blob in the application's local data directory.

Credential lookup order remains:

1. Windows-protected credential.
2. Process-local key when secure storage is unavailable.
3. `OPENROUTER_API_KEY` environment fallback.

The settings API continues to return only `{ configured: boolean }`. It adds deletion support in the UI through a `Forget key` action. The plaintext key must never be returned, logged, persisted in SQLite, or included in diagnostics.

### Streamed generation protocol

Replace the blocking quick-generation response with a streamed POST response. The browser consumes a typed newline-delimited or SSE-compatible event stream using `fetch` and `ReadableStream`, allowing the source and instructions to remain in the POST body.

Server-to-browser event types:

- `status`: stage identifier, safe message, and timestamp.
- `reasoning`: displayable text or summary delta and reasoning kind.
- `usage`: token counts when supplied.
- `validation`: structured schema or graph findings.
- `repair`: repair-attempt state.
- `result`: the validated project, Twee, HTML, compiler, usage, and cost.
- `error`: typed safe error plus diagnostic metadata.

The server buffers generated JSON content until it is complete. Partial story JSON is not sent to the browser or rendered as progress. This keeps the streaming interface stable while allowing the server to validate and repair output before publishing a result.

### OpenRouter client

Add a streaming structured-generation path without removing the existing non-streaming client until callers are migrated. The streaming parser:

- Parses OpenRouter SSE chunks incrementally.
- Collects completion content for final JSON parsing.
- Emits displayable reasoning separately.
- Preserves returned identifiers, provider metadata, usage, and finish reason.
- Detects typed errors delivered in a successful HTTP stream.
- Detects an incomplete stream or missing completion.
- Supports cancellation through `AbortSignal`.

The structured-output request continues to set `provider.require_parameters: true`. It uses strict JSON Schema for endpoints that advertise support and JSON-object mode otherwise. One bounded model repair attempt remains available for malformed completion content or schema-invalid content.

## Error taxonomy and recovery

Use stable application error categories:

- `UNAUTHENTICATED`
- `INSUFFICIENT_CREDITS`
- `RATE_LIMITED`
- `PROVIDER_UNAVAILABLE`
- `CONTENT_REJECTED`
- `TIMEOUT`
- `CANCELLED`
- `OPENROUTER_ENVELOPE_INVALID`
- `STREAM_INTERRUPTED`
- `COMPLETION_EMPTY`
- `COMPLETION_JSON_INVALID`
- `SCHEMA_INVALID`
- `GRAPH_INVALID`
- `EXPORT_FAILED`

`OPENROUTER_ENVELOPE_INVALID` is the replacement for the screenshot's generic error. Before parsing, the client reads the response body in a way that preserves the original text for diagnostics. If the body is empty or cannot be parsed according to its declared protocol, the error retains status, content type, relevant headers, identifiers, and a redacted response body.

The system does not automatically retry envelope failures, interrupted streams, timeouts after generation begins, or unknown provider failures because the request may have been billed. The UI offers an explicit retry. For a known pre-generation rate-limit or availability failure, it displays the server's `Retry-After` countdown and enables manual retry when the interval expires.

Malformed completion JSON and schema-invalid content receive one repair attempt using the same model. Graph errors receive one graph-repair attempt. Each attempt is visible in the activity stream. If repair fails, the original and repair diagnostics remain separately inspectable.

## Full-response inspection

Diagnostics retain the complete provider response for the active generation in server memory, subject to a defensive maximum size. The UI can request:

- A redacted full body for local viewing.
- A redacted JSON diagnostic bundle for copying.
- A redacted response download.

If a provider response exceeds the in-memory ceiling, retain the beginning and end plus exact byte counts and mark the omitted region. The implementation must not silently label a truncated body as complete.

Full responses are not persisted. Starting another generation or stopping the local server discards them. This prevents large or sensitive provider bodies from accumulating in project storage.

## Testing

### OpenRouter client tests

Use deterministic fetch and SSE fixtures for:

- Successful structured streaming with reasoning text.
- Successful streaming with reasoning summaries.
- Encrypted reasoning details.
- No reasoning.
- Empty `200` response.
- HTML or plain-text `200` response.
- Standard JSON error envelope.
- Typed provider error embedded in a `200` response.
- Pre-stream and mid-stream rate limits.
- Truncated SSE and truncated completion JSON.
- Valid JSON that fails the project schema.
- Successful structured repair.
- Cancellation and timeout.
- API-key and source-text redaction.

### Server and persistence tests

Verify:

- Draft projects receive stable identifiers.
- Project commands survive restart and remain project-scoped.
- Global commands apply to all projects.
- Command ordering and enabled state are preserved.
- Generation and repair requests receive the same effective commands.
- Credential routes never return the key.
- The Windows credential adapter round-trips a key for the same test identity and fails closed when decryption is unavailable.
- Diagnostic bodies are bounded and redacted.

### Web tests

Verify:

- Activity stages render in event order with elapsed time.
- Returned reasoning is labeled accurately.
- Missing or encrypted reasoning is explained.
- Command scope and promotion controls behave correctly.
- The key can be saved and forgotten without being rendered.
- Error summaries map to the correct actions.
- Full-response viewing, copying, and downloading require the expected warning when source-like content is detected.

### Verification

Run the focused package and route tests, then the complete typecheck, unit/integration suite, and production build. After offline verification, offer an opt-in live smoke test using the configured key, a tiny non-copyrighted source, a low passage count, and an explicit spending cap. The live test must verify the actual OpenRouter event and error paths without logging the key or source.

## Acceptance criteria

- The static busy button is replaced by real stage and elapsed-time feedback.
- Displayable OpenRouter reasoning appears live when supplied.
- The UI never claims that unavailable, encrypted, or summarized reasoning is full private reasoning.
- Project commands persist across restarts and do not affect other projects unless made global.
- Global commands are automatically included in every initial generation and repair request.
- The API key survives restart through Windows user-level protection and never enters browser storage or project data.
- The screenshot's `OpenRouter returned invalid JSON` dead end is replaced by a typed explanation with inspectable response evidence.
- Users can view, copy, or download the redacted full response when needed.
- Potentially billable retries require explicit user action when completion state is uncertain.
- Default exports contain no commands, reasoning, credentials, diagnostics, or imported source.
