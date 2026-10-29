# Conversational operation of Creator (CP1)

The author talks to local desktop Codex; the assistant operates the same persistent Long-form project as Creator through MCP. Creator is optional for inspection, play and export. Default publication is **native standalone HTML**, preserving supported locations/time, chapters/events, schedules, inventory/shops and journal behavior. No new game engine, remote bridge, chat attachments or provider generation is required.

First run the [desktop connection smoke test](desktop-codex.md#desktop-connection-smoke-test-pending). Until native tools have operated the persistent instance, report SDK verification and native connection as separate facts. Do not substitute Cloud/test projects for the author's project.

## Start or resume

1. Discover authorized projects/slots with `list_projects`. Ask which project only when selection is ambiguous. Create only an explicitly authorized empty slot; do not create a replacement because an existing project is unavailable.
2. Read `project_state`, paginated `list_edit_targets` and `game_state`, then exact `read_foundation`/`read_game_record` records. Read `read_world`, individual `read_scene` and asset catalogue/history as relevant. These are authoritative versions; chat recollections are not.
3. On reconnect, discover saved proposals with `list_edits`/`get_edit`; inspect current heads and blockers before continuing. Read narrow sections instead of requesting screenshots or manual JSON copying. Image quality and player layout still require actual images/player inspection.
4. Before each mutation retain the exact tool name, normalized arguments, UUID, review/version IDs and authorization reference in private ignored local continuation notes when the author permits them. Use `data/` for local notes, not Git; omit bearer tokens. A compact project note may point to these envelopes but is non-canonical and never grants approval.

## Creative batches and consent

Frame a proposal around a creative decision, not a schema field checklist. Examples: **Premise, cast and tone**; **Cafe encounter and relationship consequence**; **Opening scene prose**; **Harbor artwork and scene composition**. A creative topic can require several bounded reviews when dependencies or size limits require them.

Before asking to Apply/approve, show:

- What changes, the relevant before/after content or actual artwork, and what remains a proposal/draft.
- Effects on choices, relationships, schedules and known opportunities where relevant; validation blockers/warnings and downstream staleness.
- The exact reviewed selection and which action is being authorized now. Keep technical IDs in the receipt/details, not in every creative question.

`prepare_edit`/`submit_edit` preserve the author's request and assistant-authored provenance. Use `review_edit` before `apply_edit`, preserving dependency-safe groups. A draft Apply does not approve content. Review/approve foundations in dependency order (Brief, Creative Direction, Bible, routes, endings, mechanics), review/approve the passage plan, and review/accept exact prose candidates separately. Image approval is separate from import; scene/world Apply is separate from compilation. Later dependent content must actually exist and be reviewed before its approval; never approve unseen future output.

One chat reply may authorize the exact compatible selection the author just saw. It must not authorize all future changes. Declining or cancelling leaves protected actions unexecuted. Editing the selection/content or encountering staleness requires renewed review and consent. Preserve accepted prose locks; MCP has no automatic unlock route. Oversized foundation approval reviews may require Creator; disclose this instead of treating omitted content as reviewed.

The server checks exact versions, fingerprints, prerequisites, `approved: true` and access scope. The authenticated client asserts human consent; the server does not independently authenticate a chat reply. Tool annotations and server instructions are guidance, not authorization. Retain the user-authorization reference alongside the exact operation envelope; a previous success receipt never authorizes a new mutation.

## Authoring and artwork

Use shared proposals for foundations, character records, canonical stats/relationships, passage/choice/thread structure and effects. Use `submit_draft` for prose candidates, not planning-field edits. Read/review/apply complete bounded world definitions for W1–W5 rules; use scene tools for presentation. Resolve exact passage and approved asset versions instead of inventing IDs, approval flags or fingerprints.

Respect 12 edit targets, 12 groups/48 operations, 64KB context, 96KB proposal output, 256KB result and 48KB world-definition bounds. Collection maxima do not imply all content fits at once. Narrow/paginate context and batches; report omitted findings. Contradiction/trap diagnostics are bounded analysis, not exhaustive solvability proof.

Place only authorized supplied artwork in the configured local staging directory through the assistant's filesystem tools, or let the user upload through Creator. `list_staged_assets` supplies basenames/digests; `import_staged_asset` creates unapproved candidates. Inspect the actual normalized image, alt text, credit/license and retained approval with asset reads/review before seeking exact approval. Approved replacements do not silently retarget existing scenes/maps. No arbitrary filesystem/URL import or image-generation provider is exposed through MCP.

## Interruptions and failure

| Situation | Recovery |
| --- | --- |
| Lost response / duplicate request | Retry identical arguments with the original operation UUID; reread current state afterward |
| Changed arguments | Use a new UUID; if content/selection changed, obtain a fresh review/consent |
| Stale browser/MCP edit | Read current versions, prepare a revised proposal and review again; never overwrite |
| Failed transaction / invalid input | No successful receipt or partial canonical write should exist; inspect the error and correct it before retry |
| Interrupted image import | Exact completed retry survives source removal; a new import needs the real matching staged file |
| Server/client restart | Reuse the same database/configuration; rediscover state/proposals and replay retained envelopes |
| Unknown plan/operation ID | No general MCP operation-history lookup exists; do not guess or claim an outcome. Rediscover canonical work/proposals; abandon uncertain unsubmitted preparation and prepare anew from current state |
| Duplicate/privacy-redacted restore | Use fresh plans, operation IDs and approvals; full-fidelity backups preserve receipts but omit machine credentials |

There is no universal cancel/undo operation for a committed change. Reject unwanted pending edit proposals through `reject_edit`; cancellation does not undo already applied drafts. A later reversal is another reviewed change. Full history/restore, verified backups and duplication are available in Creator; no new MCP recovery tools are added unless a concrete workflow requires them.

## Validate, play and publish

Use shared plan/world/prose/publication checks before compilation. `simulate_game`/`read_simulation` cover explicit narrative choice paths, not world actions or full native-world simulation. Test actual native-player sequences for travel, time boundaries, encounters, purchases/gifts/use, chapter transitions and journal observations; inspect the resulting values/discoveries, not only an ending label. Use Creator play for author feedback and existing runtime/browser tooling for deterministic verification. Do not silently add an arbitrary-code execution tool to MCP.

Before calling `compile_game`, show readiness and obtain consent for that exact game head/fingerprint. In Creator, **Publication and play → Play current build** supports visual inspection. Use **Standalone HTML** as the default export, or `export_game` format `standalone` for its local link. This is the existing native player; do not select a text fallback or SugarCube for a world game. Markdown/Twee cannot silently discard world mechanics.

Export renders on fetch from captured input and current player configuration; the link is not immutable file bytes. Test the actual exported HTML with Creator stopped, including images, supported world mechanics, save/resume, deterministic replay and desktop/mobile keyboard usability. No chat download delivery is required. The finished player needs no Creator/API/provider; offline source remains inspectable and browser storage policies can limit persistence. Saves bind to compatible exact gameplay bundles; do not promise transfer across arbitrary revisions.

## Evidence boundary

Cloud can verify real SDK transport, production startup/configuration, file-backed persistence across process restarts, drafts/approval guards, retry/conflict behavior, shared Creator visibility and exported play. W6 already supplies broader illustrated-world coverage; rerun it when reporting current verification. A scripted `approved: true` fixture is not evidence of a human approval conversation.

Desktop native tool discovery, environment inheritance, actual human batch approval and fresh-conversation recovery must be recorded on the intended desktop client. Until then **CP1 desktop verification remains pending**, even if every automated check passes.
