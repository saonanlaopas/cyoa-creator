# Connected Authoring (M1–W6 / desktop CP1)

Connected authoring is opt-in, local, and limited to explicitly configured Long-form projects. It uses Creator's shared foundation, passage/prose, artwork, illustrated-scene, world, validation and publication services, including chapters/events, people/schedules, inventory/shops and character/journal rules. Discover current commands and schemas through authenticated MCP `tools/list`; the [desktop allowlist](examples/codex-local-mcp.toml) names the configured tools. No provider generation, SQL, arbitrary filesystem access or unrestricted HTTP tools are exposed.

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
# Copy enabled_tools from docs/examples/codex-local-mcp.toml.
```

Merge the complete [desktop configuration](examples/codex-local-mcp.toml), including all scene/world operations; preserve other workspace settings. The token must reach the actual Codex process, not just Creator. Restart/reconnect the client after configuration changes and verify native tool calls; reading a TOML file or running an SDK script is insufficient.

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

### Creating keyed mechanics (PF-003)

Use `add-item` on an explicitly prepared `mechanics:root`, selecting `visibleStats`, `relationships`, `flags` or `resources`. The complete schema-shaped item supplies both a new `id: "$new:<logical-key>"` and a fresh semantic `key` matching `^[a-z][a-z0-9_-]*$` (at most 100 characters). Creator generates the entity ID and authorizes the exact ID/key/collection pair; it does not generate or rename the authored key. Conditions, effects and economy/relationship predicates use the semantic key. Stable entity references use the generated ID returned in the proposal.

Include the intended gate or `choiceEffectPlans` entry in the same reviewed batch. A bare unused mechanic still fails canonical coverage validation; authorization does not waive that policy. Semantic-key references across groups require selecting their creation group. Duplicate keys, collisions with existing identities or generated IDs, unknown references and keys injected through root replacement/other owners/nested records remain rejected. Exact retries use the original operation UUID and arguments; stale plans require fresh preparation. Apply creates draft versions and retains earlier approvals, never rebuilding or reapproving unrelated foundations.

Existing-key renaming is **unsupported**, including swaps or root-array replacements. Updating a label is supported. A future rename operation would need an independently reviewed design that updates and validates every condition/effect/world reference atomically. Use existing world time, economy/inventory and progression for those mechanics; a new counter does not implement a second clock, wallet or inventory system.

### Removing keyed mechanics (PF-006)

Prepare the exact current `mechanics:<record-id>` target and submit `remove-item` against it. This removes the record, its owned semantic key, and its own nested records (such as relationship bands). It does not remove other references, authorize key reuse, or permit replacing keyed arrays to achieve a deletion.

If a choice, gate, or effect plan still uses the key, include explicitly targeted, valid reference edits in the same selected batch and review them together. World and player configuration bindings must be updated separately through their normal review flows before preparing the removal. Creator reports remaining reference locations and rejects incomplete selections without writes. Removal makes a draft; historical approved versions and builds remain intact.

Reject unwanted revisions through `reject_edit`; rejection never changes canonical content. A revised proposal uses fresh preparation and new operation IDs; Apply preserves earlier approved versions and marks affected work draft/stale. Approval remains version-specific. All three M2 mutations (creation, initialization, approval) commit their outcome receipts atomically and support identical retry after concurrent requests or server restart. Operation receipts describe historical outcomes, not a promise that the project still has that state today; read `project_state` to resume current work.

MCP results are bounded to 256,000 bytes; use narrower scope when that limit is exceeded. Full-fidelity archives preserve conversation requests and receipts. Privacy-redacted archives intentionally omit them while retaining sealed canonical edit history. Reopening the same full database preserves retry recovery; duplicated/redacted projects should begin with new operation IDs and fresh plans rather than reuse old authorizations.

## Complete Text Game (M3)

1. After all six foundations have current, non-stale approvals, call `initialize_game_plan` with `game_state.headFingerprint`, consent and a new operation UUID. This creates the same default draft passage structure as Creator, never overwriting an existing plan.
2. `game_state` lists 50 passage/choice/thread heads per page, plan status and accepted/current draft IDs. `read_game_record` retrieves an exact structure, passage, choice, thread or draft version. Reads enforce project and entity ownership. Results remain subject to the 256,000-byte transport limit; narrow selections when necessary.
3. Author structure, choices and threads with the existing reviewed editing contract. New records use `add-entity`, `entityKind: passage|choice|thread`, and an `item` whose ID is `$new:<logical-key>`. The authorized target must be `passage-structure:root`; include edits linking the new record into the graph in the same dependency-safe batch. Existing `add-item` operations add collection entries such as choice effects. No operation may inject lifecycle flags, accepted prose, duplicate IDs or foreign scope. Apply creates draft planning versions, not approved plans or accepted prose.
4. `review_game_plan` returns the canonical validation report, exact head and review fingerprint. Findings are bounded with total/omitted counts. After review and author consent, `approve_game_plan` snapshots and approves exactly that state. Changed heads/fingerprints require fresh review; blockers do not become overrides.
5. First use `read_authoring_context` for the exact passage; new `submit_draft` calls bind `contextVersion: 2` and its `authoringContextFingerprint`. Completed legacy receipt replay is preserved. `submit_draft` takes the exact passage version, current game head, author request and assistant-authored Markdown. It creates an immutable **candidate only**, using Creator's manual-input storage path, with `connected-assistant` provenance and an automatic no-provider-generation author note. It does not generate internally, replace accepted prose, unlock text or approve anything. Creator displays the candidate beside accepted prose.
6. `review_drafts` compares up to 12 exact candidate selections with their current accepted versions and returns the shared acceptance fingerprint/issues. After explicit approval, `accept_drafts` accepts that exact batch transactionally. Stale candidates and locked accepted text remain protected. Historical candidates can be inspected; they are never implicitly promoted by submission or compilation.
7. `simulate_game` captures the canonical deterministic narrative simulation input and runs an explicit path of up to 100 choice IDs, optionally checking the expected ending. `read_simulation` revalidates stored runs and pages their trace steps. This does not capture the world definition or exercise travel, waiting, shops, gifts or chapter actions. Verify those in actual native-player/runtime playtests. Inspect state, visible consequences and ending results; revise through fresh reviewed operations/candidates and reapprove/reaccept as required.
8. `publication_readiness` uses Creator's complete canonical readiness policy. `compile_game` binds author consent to its exact head/fingerprint, captures the immutable accepted-prose input and compiles the native bundle. Missing/stale approval or accepted prose still blocks publication.
9. `export_game` validates the exact build and returns a local download path for `standalone`, `static` or `markdown`. **Follow the link to retrieve bytes**: this tool does not write a file or claim delivery has completed. The existing Creator endpoint renders on fetch from the exact compilation input and current player configuration. Historical content requires `allowHistorical: true`; read state/recompile for current content. Standalone/static players require no authoring server or AI provider after download. Play the delivered artifact, not just its build metadata.

Game mutations share the transactional operation-receipt mechanism. Identical retries survive server/client restart; changed arguments conflict. Failed writes roll back both content and receipt, allowing correction/retry. Backup/restore preserves canonical histories; duplicated/redacted projects require fresh authorization as above. No schema migration or second compilation/runtime engine is introduced.

### Reviewed partial playtests (PF-008)

1. Call `review_preview` with `selection: { passageIds, startPassageId, stopPassageId }`. Select up to 100 passages from the current approved plan. Each needs current accepted prose. The stop must be an included, non-ending passage with a structural path from the start. A text-only preview starts with normal initial mechanics, not a reconstructed history. An enabled World requires its canonical start.
2. Show the exact start, stop, selected passages, suppressed choices/destinations and suppressed World commands to the author. The list of World commands is static, not a prediction of which commands would be available at the stop. Every retained choice, including gated choices, and every World location, travel, event/encounter and chapter-transition destination must stay inside the selection. Include the destinations named in blockers or choose a different slice. Creator does not prune or retarget canonical World data. Player configuration is pinned; a configured rewind checkpoint outside the slice is a blocker.
3. After explicit consent, call `compile_preview` with the reviewed selection, head and review fingerprints, `approved: true`, and an operation UUID. The two immutable preview artifacts do not enter full publication history or change project content. Retry identical arguments after a lost response. After changes, re-review before compiling a new build.
4. `export_preview` returns an authenticated local download path for the exact build. Fetch it with the same MCP bearer authorization, never in the URL. The labeled standalone HTML contains its included artwork and World mechanics and runs offline. The entering action completes normally; after showing the stop's accepted prose, the player blocks every choice and World action. No ending or ending effects are synthesized. Save/load and configured rewind remain available, separate from full-game saves.

Preview is not publication readiness. Unfinished passages, approved foundations and accepted prose remain intact. Use the ordinary publication workflow for a complete game.

#### Bounded World playtests

The default selection mode is `faithful-slice` (the strict closure rules above). For an enabled World with unfinished future destinations, opt into `mode: "bounded-playtest"` and use the canonical start. Add `exclusions` to the same selection: for example, `{ kind: "travel", id: "road-to-station", presentation: "disabled" }`. Supported kinds are `choice`, `travel`, `action`, `wait`, `event` (including encounters), `chapter-transition`, `purchase`, `gift`, and `use`. For `wait`, the ID is the configured duration in minutes as a decimal string. Use canonical IDs, not labels.

Show the author each exact exclusion with its authored label and applicable source and destination, even for `hidden`. The player shows a generic **Outside this preview** disabled control or nothing, respectively. Neither presentation can execute. Excluded events do not trigger, become mandatory, or count as missed; an NPC scheduled at a projected-out location is absent there rather than rescheduled elsewhere.

Review lists off-slice locations and their local commands omitted by the projection. A choice or travel leaving an included source, or an event or chapter transition that can enter an excluded passage, must be included or explicitly excluded. Broken canonical references are errors, not exclusions. Retained rules whose dependencies cannot be preserved block the build. The projected graph must have a structural route to the stop using choices or World entries; this does not prove every state-dependent playthrough can finish.

Review and compilation bind the exact mode, exclusions, selected passages, stop, and current content, World, assets, and player configuration. The offline player and export are labeled **Bounded playtest**. Saves are isolated by the exact reviewed boundary. The canonical World and full publication rules do not change.

Use dedicated test projects and deterministic requests for verification. No provider credential or paid call is required. M3's narrative simulation remains available alongside the later native visual/world systems; it is not a substitute for their exported-game tests.

Connected draft context has a **96,000 UTF-8 byte** ceiling for the complete canonical result, including the task, head and context fingerprints, and omission count. This is not an HTTP body size: MCP sends both structured content and an escaped JSON text copy. The shared 256,000-byte structured-result guard and the 64,000-byte limit for planning, World and scene authoring context are unchanged.

Draft context retains the exact passage, applicable approved direction and full active instructions. It includes the passage's linked ending, outcome-linked character and relationship records, its hook and contributing decisions, and explicit sequence/choice references, rather than every ending, hook or decision sharing a route. Optional accepted neighboring prose is included whole only after required context fits; `omittedNeighborProseCount` reports budget omissions. If required context alone is too large, the read and submission fail without truncation. Re-read before submitting if an older context fingerprint no longer matches; completed receipts remain replayable.

### Bounded passage-plan additions (PF-005)

Discover and prepare `create:passage-plan:passage`, `create:passage-plan:choice`, or `create:passage-plan:thread` as needed. Each descriptor binds the exact current structure version and the schema for one kind, without loading the full structure. Use `add-entity` with matching `entityKind`, a complete item, and a fresh `$new:<logical-key>` ID.

For each new passage, also prepare `collection:sequence:<sequenceId>:passageIds` and submit `{ kind: "append-passage", targetKey, passageId: "$new:<logical-key>" }` against that target. It only appends a passage created in the same selected batch and owned by that sequence. The sequence's other fields and existing order are preserved. The descriptor reports membership count/capacity, not existing IDs. It does not authorize moves, reorders, removals, or changes to locked sequences. Do not combine sequence appends with other structure edits in the same selection.

Link new choices in their source passage and connect thread setup/payoff using new items or separately prepared existing records. Keep interdependent additions and links in one group, or declare dependencies between groups that can be selected together. Referencing a generated ID requires its producer. Review shows the complete new records and exact sequence append, with 50 draft impacts per page (`draftImpactOffset`). All pages bind the same full diff and impacts. If a saved proposal would exceed the tool response budget, `get_edit` reports `omittedDraftImpactCount` and leaves those details to paged review; the stored proposal and audit are unchanged. Apply creates draft versions only. Fitting legacy root plans remain supported.

### Creating passage choice effects (PF-004)

For an existing choice, prepare its exact `choice:<id>` target/version and submit `add-item` with `collection: "effects"`. For a new choice, include the effects in the complete `add-entity` item under `create:passage-plan:choice` (or a fitting legacy `passage-structure:root`). In either case, each new effect needs a distinct `id: "$new:<logical-key>"` and the canonical `mechanicKey`, `operation`, `value`, `feedback` and `visibility`. Do not introduce new IDs by replacing the effects array with `set-fields`; preserve existing IDs when revising values. Review the complete choice and effects before draft-only Apply. These are narrative choice effects, not replacements for canonical world time, economy/inventory or progression.

### Large foundation additions (PF-001)

`list_edit_targets` includes versioned append scopes such as `collection:bible:characters` and `collection:routes:decisionPoints`. Prepare those exact keys/versions and relevant existing references; the descriptor includes the canonical item schema/count/limit instead of the whole array. Submit `add-item` only in that scope's collection. The server reconstructs and validates the complete artifact/project, preserving collisions, references, exact freshness, locks, staleness and operation receipts. Review contains the complete added records and counts and remains bound to the full candidate; it never approves unseen foundation content.

New route decisions declare their own ID and required choice IDs using distinct `$new:<logical-key>` values. Ending variants, gate conditions and relationship bands have similarly explicit schema identity slots. Arbitrary nested strings/reference fields are not declarations. Generated children belong to their parent creation group; cross-group references require that producer. Once applied, use ordinary concrete entity targets for later edits. Existing fitting-root additions and historical root/entity plans remain supported; limits and key-renaming restrictions are unchanged. See [conversational operation](conversational-creator.md#authoring-and-artwork) for workflow and remaining bounds.

## Asset Library (V1)

The library provides image catalogue/history/usage reads, restricted staging import and exact candidate revision/review/approval/rejection. Creator uploads and MCP imports use the same image validation, content-addressed storage and lifecycle service. The server must explicitly configure `CYOA_ASSET_STAGING_DIR` for staging import; no arbitrary path or URL reader is exposed. Image candidates remain separate from approvals and scene assignment. See [Asset Library](asset-library.md) for consent, bounds and recovery, and [upload to offline export](illustrated-scenes.md#upload-to-offline-export) for the complete illustrated workflow.

## Illustrated scenes and world authoring (V2–W5)

`read_scene`/`review_scene`/`apply_scene` bind authored layout and exact approved image versions to passages. `read_world`/`review_world`/`apply_world` cover the accepted locations/time, optional chapters/events, schedules/priorities, economy and journal extensions. Read-only `preview_chapter_transition`, `inspect_world_presence`, `inspect_world_economy` and `inspect_world_journal` inspect supplied state; they do not advance a playthrough. Reviews and separately authorized Apply retain exact-version/staleness/retry protections.

See [illustrated scenes](illustrated-scenes.md), [locations/time](locations-and-time.md), [chapters/events](chapters-and-events.md), [people/schedules](people-and-schedules.md), [inventory/shops](inventory-and-shops.md) and [character/journal](character-and-journal.md). Default world-game output is native standalone HTML; static ZIP is also supported. Creator's Publication and play can inspect/play/export the same project. Backup/restore, duplication, build listing and player-config editing remain Creator HTTP/UI operations, not MCP tools.

Fiction Craft is configurable per project. Read the [shared guide integration and migration policy](writing/README.md) before authoring; disabling means no guide text is applied. Settings are a separate reviewed creative preference batch and never content approval. Native desktop verification remains pending until the user runs the smoke test.
