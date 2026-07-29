# Story to CYOA user guide

## Start locally

From the project folder, run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/launch.ps1
```

The launcher uses Codex's bundled Node and pnpm when available; otherwise it requires Node.js 20+ and pnpm on `PATH`. It installs locked dependencies when needed, builds current sources, starts a loopback-only service, checks `/api/health`, and opens the app. The local service listens on `127.0.0.1` by default.

## Configure OpenRouter

Enter your OpenRouter API key and select **Save key**. On Windows, the application protects the key with DPAPI for your current Windows user and stores only the encrypted blob under `%LOCALAPPDATA%\StoryToCYOA\credentials`. The key remains available after a server restart, but is never returned to the browser, written to project data, logs, exports, or diagnostics.

Select **Forget key** to remove that stored encrypted key. `OPENROUTER_API_KEY` is only a fallback for advanced local setups; do not put a key in project files or browser storage.

## Generate an adaptation

1. Paste source text or load a TXT/HTML AO3 download. For long works, start with one arc under 250,000 characters.
2. Add optional source-specific direction, then choose `openrouter/auto` or a specific OpenRouter model ID.
3. Use **Always apply commands** for reusable instructions. New commands apply to this story only. Add a global command or promote a project command only when it should apply to every story; global and project copies remain independently editable. Enabled global commands run before enabled project commands, including one permitted repair request.
4. Choose 8–40 passages and select **Generate CYOA**.

Generation activity shows real server stages, elapsed time, received usage, validation, and bounded repair attempts; it does not show a made-up completion percentage. Select **Cancel generation** to stop the active local request when cancellation is still safe.

**Show provider reasoning activity** is on by default. Reasoning tokens can affect cost. The scrollable activity timeline displays provider-supplied reasoning text or summaries when OpenRouter makes them available. Encrypted or unavailable reasoning is labeled accurately rather than represented as displayable private reasoning. Reasoning activity is session-only and is not saved in projects, exports, logs, or diagnostics.

The generator requests an existing-protagonist adaptation with visible stats, relationship state, meaningful divergence, controlled reconvergence, and multiple endings. It validates the structured output and branch graph, exposing any repair attempt in the activity timeline.

## Plan a long-form project

Choose **Long-form workspace** for a persistent 150,000–200,000-word project. The default target is editable and may be increased. The current build supports these visible stages:

1. Write and approve the project brief.
2. Create, edit, and approve the story bible.
3. Create the route architecture.
4. Turn the approved route hooks into detailed endings.
5. Design the stats, relationships, flags, resources, gates, and choice effects.

The planned production workflow then continues by planning acts, sequences, passages, and executable choices; drafting and reviewing prose in bounded batches; simulating routes; and producing native and portable builds. Those later stages are documented plans rather than current controls.

The route architecture is seeded locally from the approved brief and bible; creating it does not call OpenRouter. It allocates the project word target across shared and route-exclusive acts, then provides editable major routes, entry conditions, relationship trajectories, decision points, reconvergences, ending hooks, and unresolved questions. The budget summary always shows allocated, shared, route-exclusive, and remaining words. An imbalance may be saved as a draft but remains visibly flagged.

Every saved artifact is an immutable local version. Approving a version makes it canonical for the next stage. Editing or restoring upstream planning marks dependent work stale without deleting it. Open **Version history** above the active editor to compare any two versions or restore an older version as a new draft; restoration never erases the intervening history. Export any current planning artifact as readable Markdown or structured JSON.

The assistant follows an explicit visible scope: whole project or a selected section/entity inside the brief, bible, routes, endings, or mechanics. **Discuss only** can answer and brainstorm but cannot mutate project artifacts. **Propose change** returns small stable-ID operations grouped into reviewable changes, not a replacement copy of the artifact. Select independently safe groups and use **Apply selected** to create one transactional draft version. If the base entity changed, application stops rather than overwriting newer work. Hard cross-artifact reference errors block approval or application; warnings and informational findings remain visible for review. Sending a message is an OpenRouter request and may be billable, while direct editing, saving, approval, history, restore, validation, and export stay local.

The ending stage tracks route coverage, outcome types, requirements and exclusions, contributing decisions, thematic payoff, foreshadowing, character and relationship outcomes, persistent consequences, and smaller ending variants. Its prose target is explicitly a subset of the full project budget. Coverage warnings identify routes without outcomes, while readiness reporting distinguishes placeholder endings from endings with an actual payoff and earned access conditions. Route changes mark the ending plan stale without deleting its history.

The mechanics stage starts with candidate long-form stats and story-bible relationships, but does not pretend they matter automatically. Its influence summary shows which declared mechanics appear in a route or ending gate or a choice-effect plan. Every mechanics field is directly editable, including relationship bands, gate logic and conditions, effect plans, balancing rules, and unresolved questions. Mechanics approval is blocked while any tracked value is unused. Balancing rules explicitly discourage grinding, invisible consequences, and a single universally optimal stat.

## Planned long-form runtime and exports

Long-form projects will use the application's structured project model and native browser player as their canonical runtime. Twee 3 targeting SugarCube will be an interoperability export rather than the source of truth. Ink may be added later when a concrete integration requires it. Hosted Games is not a target under its current policy excluding AI-generated work.

## Play and export the quick result

Play the result directly below the generator. The preview tracks visible stats and relationship labels. Download editable Twee source or a standalone playable HTML file. If Tweego is not installed, the app uses its built-in standalone HTML compiler.

## Failures and diagnostics

The older generic “OpenRouter returned invalid JSON” dead end is now a typed failure. For example, a non-JSON provider response appears as **OpenRouter returned a non-JSON response**. Other categories distinguish missing configuration, insufficient credits, rate limits, provider outages, cancellations, malformed completion JSON, schema problems, and graph-validation failures.

Use **Retry** only when you intend to make another potentially billable request. **Try another model** focuses the model field for a manual change. **View full response** opens the retained, redacted response evidence for the active generation. It includes status, content type, request ID when available, bounded response text, and schema or graph findings. The response stays only in server memory and is cleared on the next generation or server exit. If the diagnostic may contain submitted source text, the app warns before copying or downloading it.

## Troubleshooting

- If the key is not configured, save it again and confirm the Windows account running the app can access its DPAPI-protected key.
- If a model cannot produce valid structured JSON or a valid graph after the shown repair, choose another model, reduce the passage count, or retry deliberately.
- If a long source exceeds context limits, select a chapter or arc.
- Use only material you are permitted to import and adapt.
