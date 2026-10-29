# Connected Authoring (M1–W6 / desktop CP1)

Connected authoring is opt-in, local, and limited to explicitly configured Long-form projects. It uses Creator's shared foundation, passage/prose, artwork, illustrated-scene, world, validation and publication services. The 47 tools cover accepted M1–W6 systems, including chapters/events, people/schedules, inventory/shops and character/journal rules. No provider generation, SQL, arbitrary filesystem access or unrestricted HTTP tools are exposed.

For desktop Codex setup, persistent startup and the short native connection smoke test, start with [Desktop Codex + persistent Creator](desktop-codex.md). Follow [Conversational operation of Creator](conversational-creator.md) for understandable creative approval batches, recovery and native-player verification. Cloud SDK verification is separate from native tool availability in a desktop conversation; final desktop verification remains pending until recorded there. Chat attachments and remote bridges are outside CP1.

## Server

Keep the credential in your shell environment or an untracked secret store, never in Git. Generate at least 32 random URL-safe characters, for example `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.

```sh
export CYOA_MCP_ENABLED=1
export CYOA_MCP_TOKEN='<random secret>'
export CYOA_MCP_PROJECT_IDS='<existing project UUID>'
export HOST=127.0.0.1
export PORT=3000
export DATABASE_PATH='<local database path>'
node apps/server/dist/main.js
```

Existing project IDs are visible in Creator's project API (`GET /api/projects`, select Long-form projects). Supply comma-separated UUIDs to allow more than one project (maximum 50). Other projects are not discoverable or accessible through MCP. A missing token or empty/invalid allow-list prevents startup when enabled; without the opt-in, `/mcp` does not exist. Restart the server to rotate credentials or change project access. Use an absolute persistent database path and the same configuration on restart; `:memory:` and W6's disposable test host do not preserve authoring work. The built server serves Creator and MCP together. Do not expose it through a proxy or tunnel.

To allow M2 creation, generate a fresh UUID with `node -e "console.log(require('node:crypto').randomUUID())"`, include it in `CYOA_MCP_PROJECT_IDS`, and explicitly set `CYOA_MCP_ALLOW_PROJECT_CREATION=1` before starting the server. It is an empty, preauthorized creation slot, not access to all projects. Creation is disabled by default, requires `approved: true`, and never replaces an occupied slot. Each configured slot can hold one project, surviving restarts. The new project uses `sourceMode: original-premise`; brief and Creative Direction start as unapproved defaults. No source dossier or adaptation intent is required for original work.

## Project-Scoped Codex Client

Put the following in the connected workspace's local `.codex/config.toml`, not your global configuration. The workspace must be trusted in Codex. Adjust the port to the server's actual port. Pass `CYOA_MCP_TOKEN` to the Codex process environment; no secret belongs in the configuration.

```toml
[mcp_servers.cyoa_creator]
url = "http://127.0.0.1:3000/mcp"
bearer_token_env_var = "CYOA_MCP_TOKEN"
# Copy enabled_tools from docs/examples/codex-local-mcp.toml (all 47 tools).
```

Merge the complete [47-tool configuration](examples/codex-local-mcp.toml), including all scene/world operations; preserve other workspace settings. The token must reach the actual Codex process, not just Creator. Restart/reconnect the client after configuration changes and verify native tool calls; reading a TOML file or running an SDK script is insufficient.

See [official Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli). The endpoint uses the [official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk), stateless Streamable HTTP JSON responses, authenticated POST requests, and no persistent transport session. Initialization supplies cross-tool workflow instructions without changing authorization. Browser Origin requests and non-loopback clients/Host headers are rejected, with no CORS grant.

## Editing Contract

1. `list_projects`, `project_state`, and `list_edit_targets` discover allowed state and paginated target metadata (50 records per page).
2. `prepare_edit` captures an author request, exact target keys/version IDs, and the observed project head fingerprint. It returns durable plan identity, fingerprint and bounded context (64,000 bytes, including prompt overhead). Scope is at most 12 targets. It changes no canonical content.
3. `submit_edit` accepts assistant-authored `response` groups against that exact plan/fingerprint. The model writes existing field edits, not derived hashes or lifecycle state. New IDs use `$new:<logical-key>`. Output is limited to 96,000 bytes, 12 groups and 48 operations. No second model call occurs. Provenance is `connected-assistant` / `assistant-authored`, never an internal provider generation.
4. `review_edit` presents the selected effective diff, group dependencies, validation and downstream staleness. Show it to the author. `list_edits` discovers saved proposal IDs/status through bounded metadata pages; `get_edit` recovers exact proposals after reconnect without the original chat. Creator's Conversational editing view also opens, reviews, rejects and applies these saved proposals; reload the view to discover newly submitted external work.
5. Only after the author approves that exact reviewed batch, call `apply_edit` with the review fingerprint, identical group IDs, `approved: true`, and a fresh operation UUID. This creates draft versions only. Approval, prose acceptance and publication remain separate actions. Alternatively, the author can Apply in Creator.

Each mutating tool requires a UUID `operationId`. Save it and retry **identical arguments with the same ID** after an interrupted connection or lost response. Completed outcomes persist transactionally in project conversation metadata, together with the proposal/application. Concurrent duplicates and server restarts return the original result, not another write. Reusing the UUID with different arguments conflicts. A plan can be submitted only once. Rejection is also retry-safe.

Stale project state, target versions, author decisions, review fingerprints, or selections fail rather than overwrite. Fetch current state, prepare a new plan with a new UUID, submit a revised proposal, and obtain a new author review. Invalid submissions and failed Apply transactions leave no partial proposal, canonical version, or success receipt and can be corrected/retried. Failed operations have no success receipt. Tool annotations describe behavior; bearer authentication and server project checks enforce access.

## Original Foundations (M2)

1. `list_projects` discovers existing authorized projects and, only when creation is enabled, empty `creationSlots`. Call `create_project` with a configured UUID, project name, new operation UUID and explicit author consent. Retry identical arguments with the same operation UUID after a lost response.
2. `read_foundation` returns current content, exact version ID, staleness and project head for one of `brief`, `creative-direction`, `bible`, `routes`, `endings`, or `mechanics`. Content is bounded to 64,000 bytes. For large bibles/routes, use `sectionId` with an existing stable entity ID or object section such as `section:tone`; otherwise use Creator to inspect content that cannot fit. `project_state` and `list_edit_targets` recover state without the original assistant conversation.
3. Propose substantive original content with the existing `prepare_edit` / `submit_edit` / `review_edit` / `apply_edit` sequence. All six foundation types use their existing schemas, stable IDs and cross-artifact validation. Creative Direction hashes/provenance are calculated locally; do not ask the assistant to invent them. Content stays a proposal until Apply, then becomes a draft, not approved content.
4. Separately call `review_foundation_approval` for the exact current version. Show the author its content and canonical findings. Only after explicit approval call `approve_foundation` with that version, the exact returned fingerprint, `approved: true`, and a fresh operation UUID. A change in version or project/dependency/workflow state invalidates this review. Historical/stale versions and non-current prerequisite approvals cannot be used to bypass review. A stale artifact requires a revised draft before approval; a failed approval writes neither approval state nor success receipt.
5. Use `initialize_foundation` to create each missing default draft once, after its prerequisites have current approvals, using the observed project head and explicit author consent. This is the same skeleton creation as Creator, not assistant-generated content. Author its substantive fields through reviewed proposals before requesting content approval. Existing artifacts cannot be overwritten by initialization.

The existing approval dependency order is brief, then bible, then routes, then endings, then mechanics. Creative Direction has no approval prerequisite of its own; author and approve it after the brief and before the bible to avoid invalidating subsequent work. Default mechanics intentionally fail approval until their tracked values influence valid choice effects or gates. Placeholder ending warnings remain visible; warnings are not silently treated as errors or proof of content quality.

Reject unwanted revisions through `reject_edit`; rejection never changes canonical content. A revised proposal uses fresh preparation and new operation IDs; Apply preserves earlier approved versions and marks affected work draft/stale. Approval remains version-specific. All three M2 mutations (creation, initialization, approval) commit their outcome receipts atomically and support identical retry after concurrent requests or server restart. Operation receipts describe historical outcomes, not a promise that the project still has that state today; read `project_state` to resume current work.

MCP results are bounded to 256,000 bytes; use narrower scope when that limit is exceeded. Full-fidelity archives preserve conversation requests and receipts. Privacy-redacted archives intentionally omit them while retaining sealed canonical edit history. Reopening the same full database preserves retry recovery; duplicated/redacted projects should begin with new operation IDs and fresh plans rather than reuse old authorizations.

## Complete Text Game (M3)

1. After all six foundations have current, non-stale approvals, call `initialize_game_plan` with `game_state.headFingerprint`, consent and a new operation UUID. This creates the same default draft passage structure as Creator, never overwriting an existing plan.
2. `game_state` lists 50 passage/choice/thread heads per page, plan status and accepted/current draft IDs. `read_game_record` retrieves an exact structure, passage, choice, thread or draft version. Reads enforce project and entity ownership. Results remain subject to the 256,000-byte transport limit; narrow selections when necessary.
3. Author structure, choices and threads with the existing reviewed editing contract. New records use `add-entity`, `entityKind: passage|choice|thread`, and an `item` whose ID is `$new:<logical-key>`. The authorized target must be `passage-structure:root`; include edits linking the new record into the graph in the same dependency-safe batch. Existing `add-item` operations add collection entries such as choice effects. No operation may inject lifecycle flags, accepted prose, duplicate IDs or foreign scope. Apply creates draft planning versions, not approved plans or accepted prose.
4. `review_game_plan` returns the canonical validation report, exact head and review fingerprint. Findings are bounded with total/omitted counts. After review and author consent, `approve_game_plan` snapshots and approves exactly that state. Changed heads/fingerprints require fresh review; blockers do not become overrides.
5. `submit_draft` takes the exact passage version, current game head, author request and assistant-authored Markdown. It creates an immutable **candidate only**, using Creator's manual-input storage path, with `connected-assistant` provenance and an automatic no-provider-generation author note. It does not generate internally, replace accepted prose, unlock text or approve anything. Creator displays the candidate beside accepted prose.
6. `review_drafts` compares up to 12 exact candidate selections with their current accepted versions and returns the shared acceptance fingerprint/issues. After explicit approval, `accept_drafts` accepts that exact batch transactionally. Stale candidates and locked accepted text remain protected. Historical candidates can be inspected; they are never implicitly promoted by submission or compilation.
7. `simulate_game` captures the canonical deterministic narrative simulation input and runs an explicit path of up to 100 choice IDs, optionally checking the expected ending. `read_simulation` revalidates stored runs and pages their trace steps. This does not capture the world definition or exercise travel, waiting, shops, gifts or chapter actions. Verify those in actual native-player/runtime playtests. Inspect state, visible consequences and ending results; revise through fresh reviewed operations/candidates and reapprove/reaccept as required.
8. `publication_readiness` uses Creator's complete canonical readiness policy. `compile_game` binds author consent to its exact head/fingerprint, captures the immutable accepted-prose input and compiles the native bundle. Missing/stale approval or accepted prose still blocks publication.
9. `export_game` validates the exact build and returns a local download path for `standalone`, `static` or `markdown`. **Follow the link to retrieve bytes**: this tool does not write a file or claim delivery has completed. The existing Creator endpoint renders on fetch from the exact compilation input and current player configuration. Historical content requires `allowHistorical: true`; read state/recompile for current content. Standalone/static players require no authoring server or AI provider after download. Play the delivered artifact, not just its build metadata.

All six new mutations (initialize/approve plan, submit/accept drafts, simulate, compile) share the transactional operation-receipt mechanism. Identical retries survive server/client restart; changed arguments conflict. Failed writes roll back both content and receipt, allowing correction/retry. Backup/restore preserves canonical histories; duplicated/redacted projects require fresh authorization as above. No schema migration or second compilation/runtime engine is introduced.

Use dedicated test projects and deterministic requests for verification. No provider credential or paid call is required. M3's narrative simulation remains available alongside the later native visual/world systems; it is not a substitute for their exported-game tests.

## Asset Library (V1)

V1 adds nine scoped tools for image catalogue/history/usage reads, restricted staging import and exact candidate revision/review/approval/rejection. Creator uploads and MCP imports use the same image validation, content-addressed storage and lifecycle service. The server must explicitly configure `CYOA_ASSET_STAGING_DIR` for staging import; no arbitrary path or URL reader is exposed. Image candidates remain separate from approvals and scene assignment. See [Asset Library](asset-library.md) for bounds, retry/recovery and backup/restore/duplication support.

## Illustrated scenes and world authoring (V2–W5)

`read_scene`/`review_scene`/`apply_scene` bind authored layout and exact approved image versions to passages. `read_world`/`review_world`/`apply_world` cover the accepted locations/time, optional chapters/events, schedules/priorities, economy and journal extensions. Read-only `preview_chapter_transition`, `inspect_world_presence`, `inspect_world_economy` and `inspect_world_journal` inspect supplied state; they do not advance a playthrough. Reviews and separately authorized Apply retain exact-version/staleness/retry protections.

See [illustrated scenes](illustrated-scenes.md), [locations/time](locations-and-time.md), [chapters/events](chapters-and-events.md), [people/schedules](people-and-schedules.md), [inventory/shops](inventory-and-shops.md) and [character/journal](character-and-journal.md). Default world-game output is native standalone HTML; static ZIP is also supported. Creator's Publication and play can inspect/play/export the same project. Backup/restore, duplication, build listing and player-config editing remain Creator HTTP/UI operations, not MCP tools.
