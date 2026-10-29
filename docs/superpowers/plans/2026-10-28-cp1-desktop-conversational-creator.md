# CP1 — Desktop conversational Creator operation

Base: independently accepted W6 `fe3d9c0f0f4165ce251bd39775a778ee3631e427`, branch `codex/w1-locations-time`, initially clean. User scope: desktop Codex and Creator on one computer; Cloud development/verification; no remote bridge or chat attachment infrastructure. Final desktop verification remains pending until the author runs the native connection smoke test.

## Demonstrated gaps and scoped corrections

- Connected-editing setup enabled only 37 of 47 tools, omitting scene/world authoring. Supply one complete project-scoped template and verify its allowlist against actual SDK tool discovery.
- Setup named a nonexistent `GET /api/long-form/projects` listing route and described visual/world systems as unavailable. Correct the route/capability documentation.
- Existing environment placeholders and disposable W6 host did not provide a reproducible persistent desktop setup. Add an opt-in setup helper: explicit file-backed database, private credential file, restricted staging directory and configured project or creation slot; never overwrite existing settings or create/approve a project implicitly.
- Per-tool descriptions lacked cross-tool initialization guidance for a fresh connected assistant. Add MCP server instructions for discovery, creative review batches, separate consent, safe retries and default native standalone HTML. No authorization/operation contract changes.
- Desktop-native tool availability had not been demonstrated. Add a short manual native smoke test and distinguish it from Cloud SDK/config parsing tests. Do not claim a desktop pass from automation.

## Workflow

Use existing canonical services for foundations/characters/mechanics, passage planning/prose, assets/scenes and W1–W5 world definitions. Present related creative changes in bounded batches while preserving exact-version Apply/approval/acceptance/compile gates. Creator is optional for review/play/export. Retain exact operation envelopes and consent references privately; rediscover proposals/current state after reconnect. Unknown operation/plan IDs have no generic lookup: document the limitation rather than introduce an unproven recovery API.

Test narrative choice paths with existing simulation and world-action paths with actual native runtime/player tooling. Default export is native standalone HTML; retain supported world mechanics. Verify the existing complete visual demo/export paths rather than adding a new engine or fixed-content generator. No paid calls or subagents.

## Verification and delivery boundary

1. Run setup in an isolated directory, start the actual compiled production entry with its env file, connect an SDK client, discover the authorized slot, create a fixture, propose/review a title draft and Apply with scripted consent. Check Creator HTTP state, unchanged approval boundaries and stale/conflicting request rejection.
2. Restart the actual server process against the same file-backed database before submission and after Apply. Rediscover work from a fresh SDK client; replay exact envelopes; establish no duplicate versions. Retain a separate fixture/evidence when requested. This is SDK evidence only.
3. Check helper refusal to overwrite/rotate, existing-project creation disabled, invalid inputs, private credential permissions and paths with spaces. Compare the template with the live 47-tool catalogue and initialization guidance. Parse configuration with available Codex CLI if possible, without launching a model or modifying host settings; label it configuration parsing only.
4. Run pinned lint, typecheck, build and unit checks, relevant connected/visual-world browser verification and the unchanged illustrated-scene assertion. Record actual test scope/results and evidence. No gameplay/CSS/test-tolerance changes.
5. Provide a review report and user smoke test. Native desktop connection, GUI environment inheritance, real human batch consent and fresh-conversation recovery stay **pending**. No deployment, bridge, chat files, merge or automatic PR. Do not treat these setup corrections as desktop acceptance.
