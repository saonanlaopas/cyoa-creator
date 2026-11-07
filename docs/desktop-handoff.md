# Return to desktop Creator

This handoff moves development context, not project data. Use the existing local checkout and persistent Creator project; do not replace them with Cloud test fixtures.

## Current state

- Branch: `checkpoint/cp1-desktop-review`.
- Independently accepted PF-001 implementation: **`3c3841a773653acf0f5d6e662c75a16b1f4ebec1`**. Later documentation-only handoff commits on this branch do not change that accepted implementation.
- [Exact implementation diff](https://github.com/saonanlaopas/cyoa-creator/compare/fd594612b3423fa9d81caee092aa52aac032c200...3c3841a773653acf0f5d6e662c75a16b1f4ebec1), [report/evidence](reviews/2026-11-07-pf001/README.md), and [passing exact-head CI](https://github.com/saonanlaopas/cyoa-creator/actions/runs/42348706160): lint, typecheck, build, 1,697 unit tests and 59 browser tests.
- PF-001 provides bounded top-level collection additions and schema-aware new child IDs, including route-decision choices. Existing limits, validation, review/Apply, approval and retry protections remain.
- PF-002 is deferred: the historical Bible prose-guidance target remains misleadingly editable until submission rejects it. Use Creative Direction for current prose presentation. No PF-002 implementation is authorized by this handoff.
- Native desktop Codex MCP discovery, real consent and reconnect verification are **still pending**. Cloud browser/SDK results do not pass that gate.
- The Sea Keeps His Name's content was parked in Cloud. Its local manuscript, artwork, cast, approved foundations and current Creator state remain authoritative. Do not substitute the research-station/test fixtures for the author's game.

## Update without losing local state

First report branch, full HEAD and working-tree status. Inspect local changes before switching/updating. Fetch the review branch and fast-forward only where possible; do not reset, force-push, merge unrelated work or discard local changes. If reconciliation is needed, explain it before modifying that work. Verify that accepted commit `3c3841a773653acf0f5d6e662c75a16b1f4ebec1` is an ancestor of the updated checkout and inspect any later changes.

Git does **not** transfer ignored project databases, artwork staging, `data/creator-mcp.env`, `.codex/config.toml`, private credentials or browser saves. Preserve the existing laptop copies and resolved absolute paths. Do not point the laptop at `/workspace/.setup`, a temporary smoke/demo database or `:memory:`. Do not create a replacement project because the intended project is missing from a connection. Verify the configured database and authorized project scope first. Use Creator's verified backup/recovery before substantial project changes; secrets, source artwork and browser saves need their separate private backups.

Use Node 24 (Cloud validation: 24.19.0) and pinned pnpm 11.9.0. From the updated checkout:

```sh
pnpm install --frozen-lockfile
pnpm build
node --env-file=data/creator-mcp.env apps/server/dist/main.js
```

The final command assumes the existing local env file is present and correct. Reuse it; do not rerun the configuration helper as a credential-rotation or project-replacement workaround. If this is genuinely first-time MCP setup, follow [desktop setup](desktop-codex.md) with the intended existing database/project or an explicitly chosen smoke slot.

For MCP, use the documented env-file startup. The older `scripts/launch.ps1` does not itself load `data/creator-mcp.env`; it only inherits variables already present in its launch environment. The same env file must also reach the **Codex process**: Creator receiving it does not configure an already-running Codex GUI. Follow the CLI/GUI launch instructions in [desktop setup](desktop-codex.md#supply-the-token-to-codex), fully quit/relaunch where necessary, and never print or paste the token. Match the local port and merge the [complete tool allowlist](examples/codex-local-mcp.toml) without replacing unrelated Codex settings.

## First desktop task

1. Read [AGENTS.md](../AGENTS.md), [desktop setup](desktop-codex.md) and [conversational workflow](conversational-creator.md).
2. Use the actual registered `cyoa_creator` tools in the local conversation to list authorized projects/slots and inspect the selected project read-only. Record the tool names and non-secret project ID. If native tools are absent or authentication fails, report the actual failure; a shell/SDK request is not a substitute.
3. Follow the [desktop smoke test](desktop-codex.md#desktop-connection-smoke-test-pending) using a separately authorized smoke project. Propose/show the exact title-only draft change, wait for Apply consent, then verify restart/fresh-conversation recovery and an identical retry. Do not broaden project authorization or use the real story as a smoke fixture without explicit consent.
4. Record OS/client version and each gate's PASS/FAIL. Only then mark the actual desktop gate verified. Keep the intended game unchanged until the author requests work, then read its pinned authoring context, guide setting/custom instructions and approved direction before writing.

## Pasteable continuation prompt

> Continue CYOA Creator locally. Read AGENTS.md, docs/desktop-handoff.md, docs/desktop-codex.md and docs/conversational-creator.md. PF-001 was independently accepted at 3c3841a773653acf0f5d6e662c75a16b1f4ebec1 on checkpoint/cp1-desktop-review; later documentation-only descendants are fine. Report branch/full HEAD/status and preserve local changes. Update only by a safe fast-forward where needed. Reuse my existing persistent Creator database, project authorization, env file, artwork and Codex config; do not initialize or replace my project. First prove this conversation has the native cyoa_creator tools and can discover/read the intended authorized project, without an SDK/shell substitute or exposing credentials. Report connection failures accurately. Propose the separate desktop smoke test before any writes. Do not edit/approve my story or implement PF-002 unless I ask. Native desktop verification remains pending until actually demonstrated.
