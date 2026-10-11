# CYOA Creator: Conversational Authoring and Visual World Expansion

Status: roadmap approved by the author on 2026-10-12; implementation has not started.

Accepted A7 base: `bbc7ca154dfc6b030b5273f14df6d3c0ad9129b9`.

This is a planning-only change. Its commit SHA becomes the proposed starting base for M1, subject to the author's exact checkpoint instruction. Do not implement multiple checkpoints from this document without their individual approval and acceptance gates.

## Product Direction

Build an entirely authored, illustrated, click-to-explore narrative game system. AI helps create and test games; finished games require no AI service.

Codex chat and Creator are two interfaces to the same project. The connected assistant supplies proposed content directly, without triggering a second model call. Related changes are reviewed in batches; applying drafts, approving content, and publishing remain separate actions.

The player supports free exploration inside author-defined story boundaries. Chapters are optional; chapter-led play is the default. Target responsive browser play, with desktop-first composition inspired by the author's supplied references.

## Architecture and Contracts

- **Shared operations:** MCP and the browser use the same validated application services. Add external proposal submission alongside existing generation, preserving version checks, provenance, review, and lifecycle protections. Never expose SQL, arbitrary filesystem access, or unrestricted HTTP tools.
- **Local MCP first:** an opt-in, authenticated Streamable HTTP endpoint in the existing server, restricted to loopback and configured project access. Use project-scoped client configuration; keep credentials outside Git. Codex supports this transport. See the [official MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).
- **Durable authoring:** store submitted requests, proposals, selected changes, version bindings, and operation outcomes in the project. Do not require the original chat transcript or claim imported content came from an internal provider.
- **Safe operations:** separate reads, proposal submission, application, approval, and export. Mutations bind to exact reviewed versions and support retry-safe operation identifiers. Stale requests return actionable conflicts rather than overwriting newer work. Server authorization remains mandatory; tool annotations are not authorization. See the [MCP server guidance](https://developers.openai.com/plugins/build/mcp-server).
- **Separate definitions and saves:** immutable published game definitions describe locations, scenes, events, schedules, and items. Playthrough saves hold current location, game time, possessions, relationships, and completed milestones.
- **Compatibility:** extend the existing compiler/runtime rather than creating a separate engine. Version new contracts explicitly; retain existing text-game and save support. Unsupported exports must report missing capabilities, not silently discard world mechanics.

## Sequential Checkpoints

Each checkpoint includes its relevant browser controls, MCP operations, persistence, validation, and compatibility tests. Stop for independent review after each one.

| Checkpoint | Deliverable and Acceptance Boundary |
| --- | --- |
| **M1 - Connected Editing** | Connect Codex to a disposable project. Discover project state and editable targets; read bounded context; submit an assistant-authored edit; review its diff; apply an explicitly approved batch. Changes appear in Creator. Prove stale-write rejection, unauthorized-access rejection, and safe retry without provider calls. |
| **M2 - Original Game Foundations** | Create a project through MCP and submit coherent foundation proposals. Reuse existing schemas and approval dependencies for brief, Creative Direction, bible, routes, endings, and mechanics. Support revision, rejection, and explicit version-specific approval. Resume the project from a fresh conversation. |
| **M3 - Complete Text Game** | Author passage structure, choices, and prose through reviewed operations; accept drafts; validate, simulate, inspect results, revise, compile, and export. Acceptance: create and play a small original branching game entirely through conversational authoring, while inspecting it in Creator. No visual/world implementation begins before this gate. |
| **V1 - Asset Library** | Upload images through Creator or import assistant-generated files through a restricted staging mechanism. Store immutable, content-addressed files with type/dimension validation, thumbnails, descriptions, and provenance. Support candidate review, approval, replacement, and usage inspection. Include assets in backup, restore, duplication, and portable archives immediately. |
| **V2 - Illustrated Scenes** | Add approved backgrounds, character portraits/expressions, speaker dialogue, and authored choices to the existing player. Separate scene layout from image content; never bake functional controls into artwork. Provide text fallback, readable dialogue, keyboard controls, and responsive layouts. Export a playable illustrated story with packaged assets. |
| **W1 - Locations and Time** | Author hierarchical locations, map artwork/markers, travel connections, travel durations, and local actions. Add deterministic integer game minutes, waiting, and day/time display. Inspecting maps or menus is free; confirmed actions advance time. Acceptance: travel among home, cafe, and station, save, reload, and continue consistently. |
| **W2 - Chapters and Events** | Add optional chapters, named milestones, event prerequisites, repeat rules, and explicit chapter transitions. Conditions support chapter, milestone, location, and time, then extend to inventory/relationships as those arrive. Authors choose what carries forward or expires; transitions preview known lost opportunities. Detect contradictory conditions and report potential progression traps without claiming exhaustive proof. |
| **W3 - People and Schedules** | Place characters through authored recurring schedules and story overrides. Evaluate presence at arrival and relevant time boundaries. Events have explicit priorities; reject unresolved competing mandatory events rather than depending on storage order. Support discovering encounters without exposing hidden schedule information to players. |
| **W4 - Inventory and Shops** | Define items, quantities, currency, shop stock/hours, purchases, gifts, and consumable use. Costs and effects resolve atomically through authored rules. Add item/relationship predicates to events. No crafting, equipment simulation, or combat in this expansion. |
| **W5 - Character and Journal** | Present existing character stats and relationships with author-controlled visibility, plus discovered locations, recorded events, and active objectives. Journal entries reveal authored information only when triggered; no generated narration during play. Integrate these views with contextual navigation rather than showing every panel simultaneously. |
| **W6 - Complete Visual Game** | Complete a two-chapter demonstration with exploration, a scheduled encounter, purchase/gift, relationship consequence, optional activity, and an ending. Validate save/resume, deterministic replay, static export, asset packaging, backup/restore, and duplication. Test both chapter-led and chapter-free configurations. |

## Visual and Gameplay Defaults

- Use the second reference's immersive map/scene composition; treat the first as separate inventory, shop, and character views, not one simultaneous dashboard. The portable design intent is full-screen illustrated environments, a compact persistent status/navigation layer, contextual destination information, and dedicated secondary screens.
- Locations use backgrounds and clickable destinations/actions. No walking controls, pathfinding, or 3D environment.
- Artwork is generated using available assistant tools or supplied by the author, then imported and reviewed. Creator supports direct uploads from V1; an in-app image-generation provider is deferred.
- Start with static backgrounds and portraits; add expressions and time-of-day variants through explicit asset assignments. Missing optional artwork must not block play.
- Time changes only through authored actions. A scene does not consume time merely because the player reads slowly. Chapter transitions occur through authored triggers, not automatic calendar assumptions.
- Publish self-contained browser packages with required approved assets and no provider credentials, authoring conversations, private prompts, or dependence on Creator being online.
- Remote ChatGPT access, in-game phones, audio/voice, animation systems, cloud collaboration, and desktop installers are later work. Keep the operation interfaces reusable without building those integrations now.

## Verification and Delivery

- Start from accepted A7 SHA `bbc7ca154dfc6b030b5273f14df6d3c0ad9129b9`. First record this roadmap in a separate planning-only change; implementation proceeds only through individually accepted checkpoint requests.
- Every checkpoint runs lint, typecheck, unit tests, build, relevant focused suites, and browser verification. Use offline fixtures and deterministic assets; no paid provider calls without separate authorization.
- Exercise concurrent browser/MCP edits, duplicate requests, lost responses, interrupted imports, invalid assets, missing dependencies, cancellation, restart, stale proposals, and atomic rollback.
- Validate actual MCP client operation as well as protocol tests. Verify browser usability independently; MCP success does not establish visual quality.
- For world play, test time boundaries, midnight, closed destinations, schedule conflicts, chapter expiry, insufficient funds, repeated gifts/events, save compatibility, and offline exported play.
- Preserve unrelated work; commit as repository-local `Codex <codex@local>`, push normally, verify local equals remote, wait for exact-head CI, and report base/head SHAs. No automatic merges or PRs. Do not use subagents unless separately authorized by the author.
- Acceptance of this roadmap authorizes the direction, not simultaneous implementation of all checkpoints. Each accepted checkpoint SHA becomes the next checkpoint's explicit base.
