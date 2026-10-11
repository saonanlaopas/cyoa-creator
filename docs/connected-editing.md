# Connected Editing (M1)

Connected editing is opt-in, local, and limited to explicitly configured existing Long-form projects. It uses the same conversational editing service as Creator. It does not expose project creation, provider generation, artifact approval, publication, SQL, file access, or arbitrary HTTP requests.

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

Project IDs are visible in Creator's project API (`GET /api/long-form/projects`). Supply comma-separated UUIDs to allow more than one project (maximum 50). Other projects are not discoverable or accessible through MCP. A missing token or empty/invalid allow-list prevents startup when enabled; without the opt-in, `/mcp` does not exist. Restart the server to rotate credentials or change project access. Do not expose this server through a proxy or tunnel.

## Project-Scoped Codex Client

Put the following in the connected workspace's local `.codex/config.toml`, not your global configuration. The workspace must be trusted in Codex. Adjust the port to the server's actual port. Pass `CYOA_MCP_TOKEN` to the Codex process environment; no secret belongs in the configuration.

```toml
[mcp_servers.cyoa_creator]
url = "http://127.0.0.1:3000/mcp"
bearer_token_env_var = "CYOA_MCP_TOKEN"
enabled_tools = ["list_projects", "project_state", "list_edit_targets", "list_edits", "prepare_edit", "submit_edit", "get_edit", "review_edit", "apply_edit", "reject_edit"]
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

MCP results are bounded to 256,000 bytes; use narrower scope when that limit is exceeded. Full-fidelity archives preserve conversation requests and receipts. Privacy-redacted archives intentionally omit them while retaining sealed canonical edit history. Reopening the same full database preserves retry recovery; duplicated/redacted projects should begin with new operation IDs and fresh plans rather than reuse old authorizations.

Use disposable projects and deterministic requests for verification. No provider credential or paid call is required. M2 foundation creation and M3 full-game authoring operations are deliberately absent.
