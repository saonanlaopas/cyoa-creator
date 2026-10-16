# Connected Authoring (M1-M2)

Connected authoring is opt-in, local, and limited to explicitly configured Long-form projects. It uses the same editing and foundation lifecycle services as Creator. M2 adds separately enabled original-project creation and exact foundation approval. It does not expose provider generation, passage/prose creation, publication, SQL, file access, or arbitrary HTTP requests.

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

Existing project IDs are visible in Creator's project API (`GET /api/long-form/projects`). Supply comma-separated UUIDs to allow more than one project (maximum 50). Other projects are not discoverable or accessible through MCP. A missing token or empty/invalid allow-list prevents startup when enabled; without the opt-in, `/mcp` does not exist. Restart the server to rotate credentials or change project access. Do not expose this server through a proxy or tunnel.

To allow M2 creation, generate a fresh UUID with `node -e "console.log(require('node:crypto').randomUUID())"`, include it in `CYOA_MCP_PROJECT_IDS`, and explicitly set `CYOA_MCP_ALLOW_PROJECT_CREATION=1` before starting the server. It is an empty, preauthorized creation slot, not access to all projects. Creation is disabled by default, requires `approved: true`, and never replaces an occupied slot. Each configured slot can hold one project, surviving restarts. The new project uses `sourceMode: original-premise`; brief and Creative Direction start as unapproved defaults. No source dossier or adaptation intent is required for original work.

## Project-Scoped Codex Client

Put the following in the connected workspace's local `.codex/config.toml`, not your global configuration. The workspace must be trusted in Codex. Adjust the port to the server's actual port. Pass `CYOA_MCP_TOKEN` to the Codex process environment; no secret belongs in the configuration.

```toml
[mcp_servers.cyoa_creator]
url = "http://127.0.0.1:3000/mcp"
bearer_token_env_var = "CYOA_MCP_TOKEN"
enabled_tools = ["list_projects", "create_project", "project_state", "initialize_foundation", "read_foundation", "review_foundation_approval", "approve_foundation", "list_edit_targets", "list_edits", "prepare_edit", "submit_edit", "get_edit", "review_edit", "apply_edit", "reject_edit"]
```

See [official Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli). The endpoint uses the [official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk), stateless Streamable HTTP JSON responses, authenticated POST requests, and no persistent transport session. Browser Origin requests and non-loopback clients/Host headers are rejected, with no CORS grant.

## Editing Contract

1. `list_projects`, `project_state`, and `list_edit_targets` discover allowed state and paginated target metadata (50 records per page).
2. `prepare_edit` captures an author request, exact target keys/version IDs, and the observed project head fingerprint. It returns durable plan identity, fingerprint and bounded context (64,000 bytes, including prompt overhead). Scope is at most 12 targets. It changes no canonical content.
3. `submit_edit` accepts assistant-authored `response` groups against that exact plan/fingerprint. The model writes existing field edits, not derived hashes or lifecycle state. New IDs use `$new:<logical-key>`. Output is limited to 96,000 bytes, 12 groups and 48 operations. No second model call occurs. Provenance is `connected-assistant` / `assistant-authored`, never an internal provider generation.
4. `review_edit` presents the selected effective diff, group dependencies, validation and downstream staleness. Show it to the author. `list_edits` discovers saved proposal IDs/status through bounded metadata pages; `get_edit` recovers exact proposals after reconnect without the original chat. Creator's Conversational editing view also opens, reviews, rejects and applies these saved proposals; reload the view to discover newly submitted external work.
5. Only after the author approves that exact reviewed batch, call `apply_edit` with the review fingerprint, identical group IDs, `approved: true`, and a fresh operation UUID. This creates draft versions only. Artifact approval and publication remain separate browser workflows. Alternatively, the author can Apply in Creator.

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

Use disposable projects and deterministic requests for verification. No provider credential or paid call is required. M3 passage/prose authoring, full-game validation/export operations, and visual/world mechanics are deliberately absent.
