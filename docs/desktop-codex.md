# Desktop Codex + persistent Creator (CP1)

Target: a local Codex conversation and Creator on the **same computer**. Cloud develops/tests the integration; it does not connect to your desktop. Native desktop tool discovery and reconnect remain **pending until you run the smoke test below**. A local SDK test or `codex mcp get` configuration read is not that proof.

## One-time setup

Use a local checkout, Node 24 (Cloud verifies 24.19.0) and repository-pinned pnpm 11.9.0. From the checkout root:

```sh
pnpm install --frozen-lockfile
pnpm build
node scripts/configure-local-creator.mjs
```

The helper writes ignored `data/creator-mcp.env` with a random token, one reserved creation UUID, an absolute persistent SQLite path, loopback port 3000 and an absolute artwork staging directory. It prints non-secret paths/UUID only, starts nothing and creates no project. It refuses to overwrite an existing env file: rerunning must not silently rotate credentials or authorize another project. POSIX permissions are 0600; on Windows also restrict the file with your user-account ACL. Do not commit or paste its contents into chat.

The default database is `data/story-to-cyoa.sqlite`, also used by normal built startup. For a different existing database/project or a separate smoke project:

```sh
node scripts/configure-local-creator.mjs --database /absolute/path/to/creator.sqlite --project-id YOUR_EXISTING_UUID --port 3000
```

Use this alternative **instead of** the first setup command. An explicit project ID disables creation; it does not create or search for that project. Existing IDs are visible in Creator's `GET /api/projects` response (select a Long-form project). Without `--project-id`, the reserved empty slot permits separately approved `create_project`; it does not grant access to other existing projects. Use a smoke project before editing accepted work. Make a verified backup through Creator before substantial changes to an existing project.

Merge [the complete 47-tool example](examples/codex-local-mcp.toml) into the workspace's ignored `.codex/config.toml`. Preserve other configuration and update an existing `cyoa_creator` table rather than defining it twice. Match the port to the setup output. Trust/open this exact local workspace in Codex; run the conversation locally, not as a Cloud task or in a container with a different loopback network. Do not broaden the server listener or expose a tunnel.

## Start and stop

Start Creator from the checkout root in its own terminal:

```sh
node --env-file=data/creator-mcp.env apps/server/dist/main.js
```

The built server serves both the Creator UI and MCP; a Vite process is unnecessary. Open `http://127.0.0.1:3000` locally if you want visual inspection. `GET /api/health` should return `{"ok":true,"service":"story-to-cyoa"}`. Use Ctrl+C to stop this process. Restart using **the same command, env file and database**. A busy port means find your existing process or deliberately choose another port in both settings; do not silently kill unrelated processes.

The database is independent of the server process and Codex conversation. Do not use `:memory:`, W6's temporary demo host, or Playwright's test database as your authoring instance. Do not delete SQLite/WAL files to fix startup errors. Preserve recovery diagnostics and use Creator's Backup & recovery. Verified project backups preserve full-fidelity authoring history/receipts, but not these machine settings, tokens, browser saves or staged source files. Copy secrets and source artwork separately using your own private backup policy. Duplicate/redacted projects need fresh operation IDs and approvals.

## Supply the token to Codex

`bearer_token_env_var` reads the token from the **Codex process**, not Creator's process. An env file supplied to Creator does not configure an already-running desktop app. Never paste the token into the model, put it in tracked TOML, or run OAuth login for this bearer-only endpoint.

For a local Codex CLI conversation, this Node launcher passes the env file without evaluating it as shell code:

```sh
node --env-file=data/creator-mcp.env --input-type=module -e 'import {spawn} from "node:child_process"; const child=spawn("codex",[],{stdio:"inherit",env:process.env}); child.on("error",()=>{console.error("Could not start codex; check PATH");process.exitCode=1}); child.on("exit",code=>{process.exitCode=code??1});'
```

Node's `--env-file` does not override variables already exported by the parent process. Remove stale Creator variables from that launch environment or explicitly reconcile them first. A different token in the parent can cause a 401 even when both commands mention the same file.

For the desktop GUI, fully quit the app first, then use the same Node launcher with `"codex"` replaced by the **actual application executable path**, not `open`, a desktop shortcut or a Cloud command. For example, if your macOS installation has `/Applications/Codex.app/Contents/MacOS/Codex`, use that string as the first argument to `spawn` above; confirm the path on your machine. The child inherits the token without placing it in command arguments. Open/trust the local checkout in that app and reconnect its MCP server. An already-running app/daemon may retain its previous environment: opening a window from a terminal does not establish inheritance.

Exact GUI setup varies by installed client/OS and is not verified in Cloud. The local CLI command above is the reproducible reference setup. If the GUI cannot resolve the variable, stop at that connection failure and report it; do not bypass bearer authentication. See [official Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) for project trust, bearer environment settings and client restart.

`codex mcp get cyoa_creator` from the trusted workspace can check loaded configuration. This does **not** prove the conversation can call tools. Check the client's MCP status/tool list (`/mcp` where supported), then perform the native calls below. A freshly edited config file does not inject tools into an existing Cloud conversation.

## Desktop connection smoke test (pending)

1. Start Creator and a **local** Codex conversation using the setup above. Ask:

   > Use the registered cyoa_creator MCP tools directly, not a shell/SDK fallback. List authorized projects and creation slots. Report the actual tool used and selected UUID. Do not change anything yet. Read docs/conversational-creator.md before proposing work.

   If the slot is empty, explicitly authorize creation of `CP1 connection smoke` in that slot; creation leaves unapproved defaults. If no native tool is available, record **FAIL: native discovery** and stop. A successful Python/Node request does not pass this step.

2. Ask:

   > In this smoke project, propose only changing the Brief working title to `CP1 desktop connection verified`. Read the current state and target version, submit a draft proposal and show its before/after review. Wait before Apply. Do not approve foundations, accept prose or compile. Preserve exact retry arguments and IDs in private ignored continuation notes without credentials.

   Confirm canonical content has not changed. After reviewing the actual diff, reply: **Apply this exact title batch as a draft only.** Record project, proposal, operation and resulting version IDs. Creator's Brief should show the new working title; its approval state must remain draft. The project-list name is a separate field and need not change.

3. Stop/restart Creator using the same env file/database. Reconnect Codex and preferably open a fresh local conversation. Ask it to rediscover this project through native MCP, use `list_edits`/`get_edit` to find the applied proposal and read the resulting Brief version without copying the old transcript. Retry Apply using the preserved identical envelope: it must return the original outcome and add no version. Re-read current state, since a replay receipt is historical evidence.

4. Record **PASS/FAIL** for native discovery, authorized project, reviewed draft-only change, Creator visibility, server restart/fresh-conversation recovery and identical retry. Include Codex client version/OS and non-secret IDs. Leave final desktop verification **pending** until this record exists. No implementation or SDK result can self-certify it.

After this gate, use [the conversational workflow](conversational-creator.md). Native standalone HTML is the default playable output; inspect/play/export it in Creator's **Publication and play**. Chat attachments and remote bridges are not part of CP1.
