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
6. Build and approve the passage plan.

The passage-plan stage also contains bounded AI passage planning. It creates immutable, validated unit candidates, then consolidates them locally into reviewable stable-ID proposal groups. Generation and proposal creation do not alter the canonical passage plan. Only **Apply reviewed selection** writes new passage-plan entity versions; drafting, simulation, and publishing remain later checkpoints.

The route architecture is seeded locally from the approved brief and bible; creating it does not call OpenRouter. It allocates the project word target across shared and route-exclusive acts, then provides editable major routes, entry conditions, relationship trajectories, decision points, reconvergences, ending hooks, and unresolved questions. The budget summary always shows allocated, shared, route-exclusive, and remaining words. An imbalance may be saved as a draft but remains visibly flagged.

Every saved artifact is an immutable local version. Approving a version makes it canonical for the next stage. Editing or restoring upstream planning marks dependent work stale without deleting it. Open **Version history** above the active editor to compare any two versions or restore an older version as a new draft; restoration never erases the intervening history. Export any current planning artifact as readable Markdown or structured JSON.

The assistant follows an explicit visible scope: whole project or a selected section/entity inside the brief, bible, routes, endings, or mechanics. **Discuss only** can answer and brainstorm but cannot mutate project artifacts. **Propose change** returns small stable-ID operations grouped into reviewable changes, not a replacement copy of the artifact. Select independently safe groups and use **Apply selected** to create one transactional draft version. If the base entity changed, application stops rather than overwriting newer work. Hard cross-artifact reference errors block approval or application; warnings and informational findings remain visible for review. Sending a message is an OpenRouter request and may be billable, while direct editing, saving, approval, history, restore, validation, and export stay local.

For long discussions, the app maintains provider-free, deterministic conversation-summary versions in local SQLite. Each version records its stable identity, exact covered message range, scope, method, canonical version dependencies, and supersession. Summary work processes at most 48 older messages at a time, retains the newest 8 messages separately, and caps summary text at 12,000 UTF-8 bytes. A summary whose conversation scope or canonical dependency changed is labeled stale and is not sent. The conversation UI loads only its newest 200 messages and 100 proposals at once and labels truncated history.

Use **Context preview** to inspect the summary, recent messages, active decisions, and omission diagnostics before an assistant action. **Pinned decisions** are durable, immutable-history author memory scoped to the project, one artifact, or one entity. A decision is limited to 2,000 bytes and 40 related stable IDs; assistant context includes at most 24 relevant active decisions and 12,000 decision bytes in stable order. Superseding or withdrawing a decision creates a new version. Summaries and decisions are explicitly non-canonical: they do not approve, accept, or mutate anything and never satisfy an exact-version precondition. Inspecting them makes no provider call. Provider reasoning activity remains visible where supported, while raw private reasoning is not persisted as author memory.

The ending stage tracks route coverage, outcome types, requirements and exclusions, contributing decisions, thematic payoff, foreshadowing, character and relationship outcomes, persistent consequences, and smaller ending variants. Its prose target is explicitly a subset of the full project budget. Coverage warnings identify routes without outcomes, while readiness reporting distinguishes placeholder endings from endings with an actual payoff and earned access conditions. Route changes mark the ending plan stale without deleting its history.

The mechanics stage starts with candidate long-form stats and story-bible relationships, but does not pretend they matter automatically. Its influence summary shows which declared mechanics appear in a route or ending gate or a choice-effect plan. Every mechanics field is directly editable, including relationship bands, gate logic and conditions, effect plans, balancing rules, and unresolved questions. Mechanics approval is blocked while any tracked value is unused. Balancing rules explicitly discourage grinding, invisible consequences, and a single universally optimal stat.

The passage-plan stage is also fully local and does not call OpenRouter. It starts from the approved route and ending structure, then lets you add and edit acts, sequences, passage plans, choices, state conditions and effects, and narrative threads. The outline is the primary editor; the filtered graph is a secondary structural view. Search, stable-ID jump, filters, passage selection, local batch status/tag edits, and stable-ID reordering are designed for several hundred passages.

After approving a passage-plan snapshot, open **Bounded AI passage planning** to choose an act, sequence, or explicit route segment. **Preview plan** calculates deterministic units, exact snapshot and upstream dependencies, token estimates, validation stages, model identity, and the backend execution policy without contacting a provider. Saving the plan still makes no provider call. **Authorize exact plan** binds authorization to its immutable fingerprint; any changed scope, model, policy, estimate, or dependency requires a new plan and authorization.

The generation kernel builds and persists a request-specific context pack for each unit from the exact approved snapshot and dependency versions. Expand **Context diagnostics** to inspect included stable IDs and immutable versions, excluded-record counts, token bounds, schema version, and context fingerprint before execution. **Start offline kernel** runs the deterministic test provider and stores each successful response as a separate immutable candidate with validation, usage, and repair provenance. Malformed structured output receives at most one bounded repair inside an execution attempt. Completed candidates survive reload and restart; failed or interrupted units remain independently retryable within the fixed three-attempt ceiling. No browser request can raise backend limits.

After a job completes, select **Create proposal set**. Consolidation is deterministic, local, and provider-free. Each proposal retains the exact job, plan fingerprint, approved snapshot, candidates, attempts, unit fingerprints, and immutable entity bases used during generation. Inspect coherent unit groups, dependencies, affected stable IDs, field-level before/after differences, findings, and technical operation detail. Independently safe groups are selected by default; selecting a dependent group also selects its prerequisites, while the server independently rejects an incomplete dependency selection.

Select **Refresh validation preview** before applying. Preview materializes the selected operations in memory against current passage-plan heads, runs the existing hard structural validation, leaves warnings visible, and stores a deterministic review fingerprint. If an affected entity changed after generation or review, application stops as stale instead of overwriting the newer version. **Apply reviewed selection** rechecks the preview and every base inside one SQLite transaction, creates ordinary recoverable passage/choice/thread versions, records an immutable application audit, and marks only the selected groups applied. A real change returns the current plan to draft while retaining the previously approved snapshot; a no-op creates no entity versions and does not demote approval. **Reject selected** changes proposal lifecycle only and never changes canonical passage data. Proposal creation, listing, preview, rejection, application, reload, and audit inspection make no provider request.

For a selected passage, **Review prose** shows the passage specification, readable candidate and accepted prose, deterministic before/after comparison, word counts, source, staleness, and expandable technical provenance. Candidate Markdown is displayed as untrusted text; embedded HTML and scripts are not executed. **Save new candidate version** and **Restore as candidate** always create new immutable candidates and never replace, accept, or unlock existing prose.

Material passage, choice, approved-upstream, and accepted-neighbor changes mark affected drafts stale without deleting or modifying their prose. Cosmetic passage edits and unrelated stable-ID changes retain the accepted relevance rules. A stale candidate cannot be accepted. Use **Preview exact acceptance** before **Accept exact candidate**; preview is provider-free and write-free, and application rechecks the fingerprint inside one SQLite transaction. Accepted prose advances explicitly through **Mark reviewed** and **Lock accepted text**. Locked prose can have separate new candidates, but replacement requires **Unlock accepted text** followed by a separate preview and accept action.

The **Draft review queue** loads compact metadata rather than every prose body, supports stable-ID navigation and status/source filtering, and reports candidate, accepted, reviewed, locked, and stale corpus progress. Select exact candidate IDs to preview a dependency-safe batch. The server rejects stale, locked, duplicate, outdated, or post-batch neighbor-incompatible selections and applies a valid batch atomically with immutable acceptance audit records.

Open **Regenerate through bounded drafting** to prepare a new Foundation 4B-2 plan for the selected passage. Preparing and authorizing remain provider-free; only explicit **Start generation** calls the configured provider. Regeneration retains all prior candidates and accepted prose, and its new generated candidate still requires the ordinary review and acceptance pipeline. The backend limits remain 8 passages per unit, 100 units per plan, 48,000 estimated input tokens per unit, 2,500 output tokens per passage, 12,000 output tokens per unit, 3 attempts per unit, and 96,000 serialized candidate bytes.

Word totals are shown for the project, acts, routes, sequences, individual passages, and estimated complete paths. Saving writes immutable versions only for changed entities; saving an unchanged approved plan keeps it approved. **Approve snapshot** first saves the current work, creates an immutable snapshot tied to the exact approved upstream versions, validates against those same versions, and then approves that snapshot. Hard structural errors block approval; warnings remain visible. Restoring a passage version or a project snapshot creates recoverable current versions and keeps intervening history.

Open **Coverage & findings** to review the executable graph before prose drafting. It checks start and destination references, ownership links, reachability, dead ends, terminal passages, cycles, route and ending coverage, mechanic reads and writes, condition/effect types, apparently unavailable choices, fact revelation order, narrative-thread setup and payoff, preserved differences, character availability, and path-length estimates. Finding links return to the exact passage, choice, act, sequence, thread, route, ending, or mechanic scope. Static continuity and state analysis is intentionally conservative: warnings identify work to inspect and do not claim to prove every possible runtime state.

Hard errors cannot be waived and block snapshot approval. A conservative warning can be acknowledged only while it is still current, and requires a persisted rationale. The warning remains visible with that rationale. If the plan changes so the warning no longer exists, the old rationale does not suppress a different finding.

Use **Export Markdown** for a readable outline, **Export JSON** for the canonical current passage-plan data, and **Project bundle** for a recovery/interchange package containing project metadata, current and approved planning artifacts, passage-plan snapshots, entity versions, validation, and readable Markdown. Imported source bodies and conversations are excluded from this bundle by default for privacy.

## Run deterministic playtests

Open **Playtest & analysis** after the passage plan has an approved snapshot. Select **Capture approved input** to preserve the exact passage-plan, upstream, accepted-prose, and compiled-runtime versions used for simulation. Historical inputs and results remain tied to those immutable versions even after later authoring edits.

For a known path, enter stable choice IDs and select **Run deterministic path**. For broader evidence, choose an exact simulation input, set a campaign seed and bounded sample count, select **Preview bounded policy**, then **Run seeded campaign**. Preview and execution are local, deterministic, provider-free, and cannot change passages, choices, mechanics, routes, endings, or accepted prose.

The campaign report separates hard runtime failures from bounded observations. It includes passage and choice frequencies, route and ending coverage, mechanic and relationship trajectories, structured continuity and thread evidence, path-word and choice-density measures, route-exclusive content, and stable-ID finding links. A sampled absence is reported as an observation or coverage gap, not proof that content is unreachable.

Every sample retains its seed, index, exact stable-ID choice path, result, and trace fingerprint. Select a representative or filtered sample and use **Replay exact sample** to execute that path again through the same historical runtime and verify its fingerprint. Campaign lists load compact metadata; full trace detail is generated for one selected replay at a time. Reloading or restarting the app preserves immutable campaigns and reports.

## Review and apply repairs

Open **Repair planning** to turn an immutable static-validation, simulation, playtest, or narrative-review finding into a narrowly scoped repair. Select the finding, intent, and exact stable-ID targets, then save a repair plan. Historical evidence remains readable, but a plan whose source evidence, canonical base, accepted prose, or lock state changed cannot generate or apply a proposal.

Repair proposals are immutable. Manual deterministic proposals remain local; AI-assisted proposal generation uses the same explicit preview, save, fingerprint authorization, and start controls as other bounded jobs. Applying a proposal never calls a provider. Open a current proposal, select one or more coherent groups, and choose **Preview selected repair**. The preview automatically includes required dependency groups, recomputes the selected effective state, displays readable field differences, exact bases, generated IDs, expected staleness, validation, and targeted verification, and performs no writes.

Choose **Apply exact preview** only after reviewing that fingerprint. The server repeats every proposal, plan, base, dependency, generated-ID, prose-head, and lock check inside one SQLite transaction. Passage, choice, thread, planning-artifact, prose-candidate, staleness, result-lineage, and application-audit writes either commit together or all roll back. Prose repairs create ordinary candidate drafts: accepted and locked prose stays unchanged, no unlock or acceptance occurs, and the candidate must pass through the normal draft review flow.

Application history retains the selected groups, dependency closure, pre-apply and resulting version IDs, stale evidence, and finding disposition. Foundation 3 checks rerun deterministically. Relevant Foundation 5A paths are replayed with their original bounded path policy against the repaired effective state. Playtest campaigns remain immutable historical evidence and require a new bounded campaign when broader sampling is needed; qualitative narrative findings require a separate explicit re-review. A proposal can be applied successfully only once.

## Compile and play a long-form project

Open **Publication and play** after every passage has current accepted prose and the exact project state passes publication readiness. **Compile native bundle** records immutable build metadata. **Play current build** compiles and installs the exact current build in this browser, then opens the dedicated player. A historical build can be reopened from its build record; the application recompiles that build from its captured immutable input rather than substituting current authoring content.

Use **Browser player policy** to choose disabled, previous-step, bounded last-N, or designated-checkpoint rewind; select exact checkpoint passages; toggle autosave; set the bounded manual-slot limit; and choose among mechanics already declared as player-visible stats. **Save player policy** creates a new immutable project-owned configuration version without changing the gameplay bundle, source-input, or runtime fingerprint. Current and historical build launches use the current player-policy version. If a current checkpoint selection does not exist in the selected historical bundle, launch is rejected instead of silently changing the policy.

The native player runs the accepted Foundation 5A mechanics and choice semantics locally. Once play opens, choosing, autosaving, manually saving or loading, rewinding, restarting, reaching an ending, and reloading the page make no authoring API or model-provider requests. Ordinary play shows only mechanics selected by the player configuration; the current authoring control offers canonically declared visible stats. Flags, facts, route gates, internal counters, authoring metadata, and debug state stay hidden.

Autosaves and up to 20 named manual slots are stored in this browser's IndexedDB, not in project SQLite or OpenRouter. Clearing site data removes them. Manual saves remain available after restart and are listed even when a later gameplay bundle makes them incompatible; incompatible or malformed saves are identified and cannot partially replace the active session. Save compatibility is based on stable game identity, the semantic gameplay-bundle fingerprint, and runtime/bundle contracts. A source-provenance-only rebuild with the same gameplay fingerprint can therefore resume the existing save.

The default rewind policy restores the previous validated runtime checkpoint. A save from the same gameplay bundle remains loadable after policy changes; its retained history is deterministically constrained by the current policy, and unavailable older history is never invented. Restart replaces the autosaved session with the exact initial state but does not delete manual saves. If an autosave fails because browser storage is unavailable or full, the successful gameplay transition remains visible and the player clearly warns that progress is not saved.

**Debug current build** is a separate, explicit launch. It exposes a bounded diagnostic summary without changing runtime behavior. Normal play cannot reveal that panel. Passage prose is rendered as text rather than executable HTML, and the responsive player retains keyboard-accessible choices, status announcements, dialogs, and focus movement after passage changes.

### Portable and publishing exports

The Publication workspace exports five bounded formats. **Portable project ZIP** (`cyoa.portable-project/v1`) is the re-importable authoring archive. It preserves stable project/game identity, immutable planning and artifact versions (including project-owned review evidence stored there), passage-plan structures/entities/snapshots, draft versions and heads, exact draft-generation/upstream/neighbor provenance, staleness and acceptance history, repair-application links, and player configuration. Its frozen manifest explicitly excludes credentials, machine paths, browser saves, chat and source bodies (including conversation summaries and pinned decisions), passage-planning jobs/candidates, and provider raw responses, so it is not represented as a whole-database backup.

**Markdown** is a deterministic readable manuscript, not an import format. **Static web ZIP** packages relative-path player assets, the exact native bundle and exact player config for ordinary static hosting, including subdirectories. **Standalone HTML** embeds the same accepted player and exact inputs as inert base64 data and plays from `file://`; if IndexedDB is unavailable, it warns and continues with session-only saves. **Twee 3 + SugarCube ZIP** includes deterministic source and HTML compiled with the pinned real Tweego/SugarCube toolchain. SugarCube saves and native-player saves are intentionally separate.

Portable import treats every archive as hostile. Preview is write-free. Confirmed import validates archive paths and size limits, file hashes, schema, relationships, lineage, and semantic fingerprint before one atomic SQLite transaction. Version 1 preserves the source project/game ID only when unused; an existing-ID collision is shown and rejected rather than overwriting content or silently changing save identity. These local exports and imports make no provider calls.

### Verified backup and recovery

Open **Backup & recovery** from any long-form project. **Create, verify & download backup** first captures the exact `cyoa.portable-project/v1` bytes, then treats those bytes as hostile input, reconstructs them in a unique temporary SQLite database through the normal bootstrap/import path, runs domain validation and SQLite `quick_check`, canonically exports the reconstruction, and compares its semantic fingerprint and bytes. Only after every step succeeds does the app record a bounded immutable `cyoa.project-backup-record/v1` entry and start the browser download. The app cannot prove that your browser retained, moved, synchronized, or can later reopen the downloaded file, so place it in storage you control.

Backup status is factual rather than age-based: **never backed up**, **current**, **changes since backup**, **schema/application upgrade since backup**, or **backup verification failed**. Reading, opening the UI, and exporting without a semantic change do not make a backup stale. Snooze and dismissal affect only the reminder; they do not change backup history or protection status. Permanent deletion displays the current state, creates no automatic backup, and requires the exact stable project ID in a keyboard-accessible confirmation dialog.

To perform an offline restore drill, choose a `.cyoa-backup.zip`, then select **Verify & preview**. Preview reconstructs and validates the supplied bytes without writing project data and shows stable identity, fingerprint, history mode, row counts, exclusions, and collisions. Restore reparses and independently verifies the authoritative file again, then imports the project and its promised history in one transaction. The stable project/game ID is preserved. If that ID already exists, restore is blocked: the app never overwrites it and never rewrites all stable IDs. Resolve the collision deliberately (for example, retain the existing project or permanently delete it after making the backup decision), preview again, confirm, and restore. A restored project is an ordinary project that can be edited, validated, drafted, simulated, repaired, compiled, played, exported, and backed up.

A verified project backup contains the same authoring scope and exclusions declared by portable v1 plus strict recovery metadata; large ZIP bodies are not stored in SQLite. Portable v1 and therefore verified backup v1 exclude chat and source bodies, including conversation summaries and pinned decisions, even though summaries and decisions persist in the working SQLite database. Browser-native player saves remain separate `cyoa.native-player-save/v1` records in that browser's IndexedDB and are not inside project backups. Credentials, environment settings, raw reasoning, machine paths, temporary files, browser saves, and active SQLite WAL/journal files are also excluded. Recovery is local and provider-independent; it is not automatic cloud backup or sync. Preserve the working database if author-memory history matters in addition to the portable project's declared canonical authoring scope.

Database startup distinguishes a missing/new database from corrupt bytes, an unsupported future schema, migration failure, permission or read-only failure, and write/storage failure. It refuses to replace a non-empty unreadable or future database with an empty one. Recovery errors say what failed, confirm that original data was not overwritten, and give a bounded safe next action rather than leading with a stack trace. **Run database quick_check** is an explicit bounded storage-integrity diagnostic; it complements, but does not replace, application-domain validation. Supported frozen schemas v4 through v16 migrate transactionally to v17. A raw operational SQLite copy is intentionally not offered because copying only an active `.sqlite` file can omit WAL state; use the verified portable recovery flow instead of making an unsafe live file copy.

### Project health, storage, and recorded usage

Open **Project health** for compact, read-only operational facts: passage/choice/thread scale, draft and word totals, staleness, passage-plan validation counts, recent simulation/playtest/narrative-review/build metadata, repair history, verified-backup metadata, and links to the responsible workflow. Passage-plan validation is labeled current, historical from the last approved snapshot, not evaluated, or invalid; malformed validation metadata is never presented as zero findings. Health does not load passage prose, author notes, prompts, provider responses, credentials, raw reasoning, simulation traces, or playtest findings. It also deliberately does not rerun publication readiness or current backup freshness; open **Publication and play** or **Backup & recovery** when you want those authoritative, potentially heavier checks.

Storage diagnostics show SQLite and WAL byte sizes only when the local filesystem can report them, plus immutable record counts by category. An in-memory database or unavailable filesystem is labeled as such. The app does not guess free space or browser quota, expose paths, collect third-party analytics, or automatically delete history.

Recorded AI usage is read from persisted attempts and immutable aggregate review/proposal records without contacting a provider. Filter it by recorded workflow, provider, model, and bounded date range. Attempts and provider requests are reported separately because one attempt can make an initial generation request plus a structural-repair request. When durable repair evidence proves the call count, it is exact; incomplete historical evidence is labeled **partial** or **unknown**, never guessed as zero. Token and cost facts remain the exact persisted aggregates by workflow/provider/model, excluding rollups and candidate mirrors so totals are not double-counted. A recorded cost is shown only when the historical record contains one. Missing cost remains **unknown**; a total with both known and unknown components is labeled **partial**. The app never silently estimates old costs or reprices old usage with current model prices.

### Resume work, navigation, and accessibility

Open **Resume work** for a provider-free, read-only summary of persisted interrupted or failed jobs, pending proposals and draft review, stale work, and verified-backup facts. Its suggested links come from bounded database facts. The “On this browser” line is only a non-canonical hint to the prior workspace and stable entity; opening or refreshing Resume changes no project data.

The workflow navigation always displays the current project, workspace, and remembered stable ID. Use **Jump** or **Copy ID**, and **Back to previous workspace** during the current session. Project, stage, entity, and scroll hints survive reload in browser storage, but they never become project workflow truth. Search and review screens continue to use stable IDs so a jump reopens the intended entity after large-list filtering.

Authoring and player views provide a main landmark and keyboard skip link, visible focus, labeled status and error regions, dialog names, destructive confirmation, and deterministic dialog focus return. The permanent-deletion dialog traps Tab focus and Escape cancels it without deleting data. Reduced-motion preference disables smooth navigation, and narrow layouts reflow workspace columns, review tables, forms, chat/context, and dialogs without page-wide horizontal scrolling. Desktop remains the primary large-project surface, but tablet and narrow-window inspection and recovery actions remain reachable.

All inspection, editing, history/restore, validation, candidate review, simulation/playtesting, existing repair review/application, compile/play/save, import/export, backup/restore, Health, usage, author-memory inspection, and Resume work remain available without OpenRouter. Only an explicitly started AI action needs a configured provider; engineering and acceptance use deterministic offline providers.

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
