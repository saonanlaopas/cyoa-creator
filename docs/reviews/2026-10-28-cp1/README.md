# CP1 desktop conversational Creator — implementation review

Base: independently accepted W6 `fe3d9c0f0f4165ce251bd39775a778ee3631e427`, initially clean on `codex/w1-locations-time`. Review branch: `checkpoint/cp1-desktop-review`; the containing commit is the proposed CP1 head. The user authorized this scoped local desktop Codex + Creator change and evidence to be committed and pushed normally for review. Pushing and CI do not establish CP1 acceptance. No merge, force-push, deployment, remote bridge, chat attachment service, paid provider call or subagent is part of this delivery.

**Final native desktop verification: PENDING.** Cloud SDK checks and Codex CLI configuration parsing are distinct from tools available in the intended desktop conversation. Do not mark CP1 accepted until the author records the [desktop smoke test](../../desktop-codex.md#desktop-connection-smoke-test-pending).

## Corrections

| Demonstrated gap | Scoped change |
| --- | --- |
| Setup enabled only 37 of 47 MCP tools, excluding scene/world operations | Complete project-scoped TOML example; live SDK catalogue checked against every configured tool |
| Setup referred to nonexistent project-list route and said world/visual mechanics were unavailable | Correct capabilities, `GET /api/projects`, accepted world/scene tools and runtime/export boundaries |
| Placeholder startup and disposable W6 host could be mistaken for persistent authoring | Local setup helper produces a private env file, stable project slot/existing-project binding, absolute SQLite path and restricted staging directory; never overwrites settings or implicitly creates a project |
| Fresh MCP clients received no cross-tool initialization workflow | MCP initialization instructions explain discovery, understandable creative reviews, separate consent, retry envelopes and native standalone HTML |
| SDK success could be mistaken for native desktop integration | Explicit desktop connection gate, same-machine/network requirements, token inheritance instructions, short native smoke test and evidence labels |

The only existing production-source change supplies initialization instructions to `McpServer`. No mutation schema, service authorization, approval/fingerprint/lock guard, runtime, player UI, compiler, dependency or lockfile changed. The illustrated CSS and original layout assertion remain byte-identical to the accepted base; hashes are in [protected-files.json](protected-files.json).

The [exact scoped source/setup/guide diff](exact-source.diff) uses zero context (`git apply --unidiff-zero`); the [ten-file source manifest](source-manifest.json) identifies the implementation separately from this report's generated evidence. The original context-bearing patch is retained in the saved Cloud evidence.

## Guides

- [Desktop setup/startup/persistence and native smoke test](../../desktop-codex.md)
- [Conversational authoring, bounded creative approvals, artwork, recovery and playtesting](../../conversational-creator.md)
- [Complete local MCP configuration](../../examples/codex-local-mcp.toml)
- [Updated operation reference](../../connected-editing.md)
- [Scoped implementation plan](../../superpowers/plans/2026-10-28-cp1-desktop-conversational-creator.md)

The default finished game is the existing **native standalone HTML** player with supported world mechanics. Creator is optional for inspection, play and export. No chat-file delivery is required.

## What Cloud proved

The new integration starts the actual compiled `apps/server/dist/main.js` with Node's env-file mechanism, using the setup helper's isolated file-backed SQLite fixture and staging directory. It uses the real installed MCP SDK over authenticated Streamable HTTP. The server process starts three times against the same database: before a draft proposal, after preparation/before submission, and after draft Apply.

It verifies all 47 configured tools and server initialization instructions; authorized slot/project discovery; creation with scripted explicit consent; unauthorized-project and missing-consent rejection; exact current target reads; unchanged canonical content while a proposal awaits Apply; draft-only application visible through Creator's HTTP state; stale preparation and changed-argument retry rejection; fresh-client rediscovery of current project/proposal/version; exact creation/submission/application retries without additional Brief versions. The existing-project setup path disables creation. Setup refuses invalid UUIDs, nonpersistent database and invalid ports, protects the env file from replacement, keeps its token out of output, uses paths with spaces, and creates POSIX credentials with mode 0600.

The retained Cloud fixture is an isolated verification project, not the author's desktop database. [sdk-proof.json](sdk-proof.json) records non-secret identities and outcomes. Private credential/env/database files stay outside Git under `/workspace/.setup/cp1-review-20261028`; no credentials or traces are published here. Scripted `approved: true` fixtures do not prove human chat consent.

Installed `codex-cli 0.163.0` parsed the TOML settings through command-line overrides and `mcp get`, recognizing all 47 enabled tools and the bearer environment variable. [codex-config-check.log](codex-config-check.log) is configuration evidence only: no model ran and no native conversation acquired tools. This command does not validate GUI environment inheritance, trusted-project loading or native tool discovery. The first attempted `--strict-config` variation was unsupported for `codex mcp`; the supported command passed, and both raw attempts remain in saved evidence.

## Validation

| Check | Result |
| --- | --- |
| Build | Passed |
| Lint | Passed |
| Typecheck | Passed |
| Strict typecheck of the new SDK test | Passed |
| Focused setup/production-process SDK checks | 2 passed |
| Full unit rerun | **163 files / 1,571 tests passed**, 413.83 seconds |
| Full browser rerun | **52 passed**, 9.6 minutes, one worker |
| Native desktop conversation | **Pending author smoke test** |

Pinned tooling: Node 24.19.0, pnpm 11.9.0, Playwright 1.62.0 and matching Chromium revision 1234. No tests were skipped and no assertions, tolerances or test timeouts changed. [Validation metadata and captured/published hashes](validation.json), [full unit log](validation/final-unit.log) and [full browser log](validation/final-browser.log) accompany the report. Other build/check logs are in `validation/`. Publication strips ANSI formatting/trailing whitespace only; original logs remain in the saved evidence directory.

The initial overlapping validation hit an existing persistence test's 15-second timeout (1,570 passed / 1 failed) and the W6 browser test's 300-second timeout. I intentionally stopped the remaining browser run: 7 passed, 1 failed, 1 interrupted and 43 did not run. Those logs/traces are preserved; initial logs are published as [unit.log](validation/unit.log) and [browser.log](validation/browser.log). Repeating the unchanged full suites separately passed. No production correction, assertion weakening or timeout increase was made in response.

The passing full browser run includes Creator/MCP proposal review/Apply, stale-edit and safe-retry behavior, foundations/text/asset/scene/world authoring, the unchanged illustrated layout assertion, and actual standalone/static gameplay. W6 again verifies ten offline plays across both chapter modes, desktop/mobile, restored and duplicated projects, with Creator stopped before play, save/resume and deterministic replay. [Offline-player evidence](offline-player-proof.json) is from the existing W6 fixture, not native Codex or the author's desktop project.

Representative unedited final-run images: [connected proposal review](m1-desktop-review.png), [Creator schedule editor](w6-chapter-led-creator-1280.png), and [native standalone mobile ending](w6-chapter-led-standalone-390-ending.png). These are existing connected-editing/W6 browser fixtures; the new CP1 SDK fixture's matching canonical state was checked through Creator HTTP. The proposal image was inspected directly from the final run; both W6 images are byte-identical to directly inspected initial-run images. Text, controls and artwork/captions remain visible; mobile navigation wraps and the page scrolls vertically. [Screenshot hashes and inspection record](screenshots.json) identify the exact images.

## Limits and pending acceptance

- Desktop native tool discovery, actual GUI/daemon credential inheritance, human batch approval and fresh-conversation recovery require the author's smoke test. Local Codex CLI is the reproducible launch reference; GUI executable location and environment handling must be verified on the actual OS/client.
- Native Codex project trust/config loading can differ from SDK access. A successful HTTP request, `/api/health` or CLI configuration read cannot satisfy the desktop gate.
- No general MCP operation-history lookup was added. Exact retained envelopes support prepared-work/receipt replay; proposals/current state are discoverable. Unknown operations cannot be claimed recovered. Duplicate/redacted projects require fresh authorizations.
- Existing byte/batch limits remain. Oversized foundation reviews may require Creator. Narrative simulation does not exercise world actions; use the actual native runtime/player.
- Artwork still requires authorized local staging or Creator upload and separately reviewed image approval. No generator/downloader was added to MCP.
- Default export uses captured input/current player settings and renders on fetch. Actual downloaded bytes must be tested; offline source remains inspectable, saves bind to compatible bundles, and browser storage rules can limit persistence.
- Tokens, env settings, source staging and browser saves need their own private backup policy; project backup/restore does not restore desktop credentials. No changes to accepted game contracts or later roadmap work are included.
