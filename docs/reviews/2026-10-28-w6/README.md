# W6 — Complete Visual Game review package

Base: `9111866558accd3679921859a688d6831e318a67`, independently accepted W5, on `codex/w1-locations-time`. The initial checkout matched and was clean. The containing commit is the proposed W6 head. Passing checks, compilation and normal push do not establish independent W6 acceptance.

## Delivered game

[The Last Harbor Signal: download/play/reproduction guide](../../../demos/last-harbor-signal/README.md) links the actual verified standalone/static games, chapter-led/chapter-free world definitions, source backups, restored/duplicate exports and artwork provenance.

Mira explores an illustrated harbor, buys Tea, meets Mara during a recurring cafe visit, offers a gift, hears a required encounter, carries the warning to the station, prepares a signal and chooses an ending. The gift raises canonical Trust with Mara to 2; shared preparation raises it to 3 and unlocks the narrative resolutions. An authored W3 override places Mara at the station when she accompanies the warning, and preparation requires her actual presence. The optional tide activity records a remembered journal entry and carries forward without blocking the main route if skipped. The shared-repair alternative is directly available at the prepared station; a backtracking cafe choice explicitly returns the crew to the actual station before that resolution.

The chapter-led configuration explicitly moves from **I · A cup before the storm** to **II · An honest light**. The chapter-free configuration has no chapter records, initial chapter or chapter transitions; an explicit departure event carries the story forward instead. The suggested full route ends at minute 448 (07:28), with 3 Coins, Tea quantity 0, Trust 3, three completed objectives, four journal entries and an eligible `ending-1`. A deliberate early handover reaches an alternate eligible ending without claiming those objectives were completed.

All additions are demo content, reproduction tooling, tests, documentation and review artifacts. Accepted production code, schemas, compiler/runtime behavior, UI, illustrated CSS, the original layout test and tolerance remain unchanged. No existing workspace manifest, dependency or lockfile changed. A private demo-only package marker enables ES-module reproduction scripts and adds no dependencies.

## Authoring and verification

- **Real MCP SDK:** the new server integration authors the demo through authenticated Streamable HTTP using the installed SDK. It exercises existing proposal/review/apply/approval, accepted prose, approved assets, world definitions and compilation. It verifies both modes × optional activity on/off × first/next-day encounter, all three eligible endings, actual station/crew routing, exact deterministic replay and saves before/after completion. A provider spy is configured to throw and is never called.
- **Actual Creator:** browser integration discards a scratch authoring edit, reviews and approves each exact world in Creator, compiles it, and opens its real player preview. MCP then compiles/exports the exact authored source through shared services.
- **Actual portability:** verified source backups are restored into a different database. Recompilation produces a bundle exactly equal to the original chapter-led bundle. An independent duplicate recompiles with the same final runtime state, preserving the world, journal, mechanics and artwork.
- **Ten offline plays:** both modes × standalone/static × 1280×900/390×844, plus restored and duplicate static packages on mobile. Both disposable Creator hosts are stopped before play. Requests are recorded; API/provider/external HTTP dependencies and page errors are rejected. Selected mobile plays in both modes additionally finish the shared-repair and early-handover endings, checking actual station location and incomplete early objectives. The unrelated Playwright harness server holds no demo project and supplies none of the exported play resources.
- **Gameplay checks:** actual images/fonts ready, portrait artwork/caption geometry inside the unchanged stage, packaged bytes matching approved asset hashes, map destination inspection, keyboard Tab/Space/Escape and focus return, contextual secondary views, absent/present schedule boundary, purchase stock exhaustion, gift relationship consequence, required encounter blocking, free cancellation, remembered optional activity, chapter/departure, objectives and an eligible main ending.
- **Persistence/replay:** actual IndexedDB autosaves equal the expected complete runtime state; named save/load, reload, rewind and replay return the same prepared/final states. Explicit outcome assertions independently establish currency, time, relationship, objective and discovery results.

The package ZIP manifests verify hashes of game/config/JS/CSS/HTML. The demo manifest records every published export hash, approved/source artwork hashes and actual play evidence. Published source images are unmodified approved bytes extracted from the tested package. UUIDs and immutable source versions vary on regeneration; deterministic replay is asserted against each exact bundle rather than claiming byte-identical regenerated projects.

## Decisions and limits

The initial all-gated narrative design was rejected by the existing passage validator: its plausible-state checks do not establish world-only progress through a relationship gate. The demo now authors an explicit early handover path using existing choice/route contracts. A handover scene enters the ending's required route before completion. Review targets and generated outputs are split into the existing bounded batches. Choice-effect identities are preserved. No validator or contract was relaxed.

Visual inspection of an earlier passing browser run found a story-data mismatch: Mara remained at the cafe while the station ending described her help. The final world uses the accepted story override and adds explicit presence assertions. This is an authored-content correction; no engine fix was required. A final route audit also found a shared-repair location inconsistency: the cafe narrative choice could enter station prose without moving the world location. The revised demo redirects that choice to the actual mapped station, adds a prepared-station Share the watch choice, and verifies the third ending through the SDK and actual offline play in both modes. The earlier complete passing validation is retained; all required checks were repeated after this authored revision.

Artwork is intentionally schematic CC0 repository bitmap imagery. This is a compact nine-scene demonstration with three authored endings, not a full-length novel; the reused long-form scaffold retains its planning targets and earlier immutable history. Explore can require scrolling when its map is expanded; other views are dedicated and the map is collapsible. No generated narration occurs in play.

Offline source remains inspectable. Saves bind to exact bundles and do not transfer automatically across modes, regenerated projects or duplicates. Browser `file://` storage policies can limit persistence; accepted session-only fallback remains available. The two source backups share a project identity, so restore one in a fresh Creator database; immutable world JSON references belong to its exact restored source project. The demo guide documents these constraints and reproduction commands.

No later-roadmap feature, paid provider call, subagent, merge or automatic PR is part of this delivery. Stop for independent W6 review.

## Representative final-run screenshots

- [Creator schedule controls, desktop](w6-chapter-led-creator-1280.png) and [mobile](w6-chapter-free-creator-390.png)
- [Actual Creator player preview](w6-chapter-led-creator-preview.png)
- [Illustrated map and exploration, desktop standalone](w6-chapter-led-standalone-1280-explore.png)
- [Required scheduled encounter, mobile static](w6-chapter-led-static-390-encounter.png)
- [Chapter-led ending, mobile standalone](w6-chapter-led-standalone-390-ending.png)
- [Chapter-free completed journal, desktop static](w6-chapter-free-static-1280-journal.png)
- [Chapter-free ending, mobile standalone](w6-chapter-free-standalone-390-ending.png)
- [Restored ending](w6-restored-static-390-ending.png) and [independent duplicate ending](w6-duplicate-static-390-ending.png)

All fourteen published images were visually reviewed: five changed/new frames were inspected directly from the final run, and nine matched the SHA-256 of previously directly inspected images; their unedited hashes and dimensions are recorded in `screenshots.json`. Text and native controls are readable, navigation wraps within the mobile viewport, actual Mara presence agrees with the station prose, and artwork/captions remain visible. Expanded Explore content scrolls vertically. Restored and duplicate ending screenshots are byte-identical. Ten actual primary-route ending runtime-state files and their hashes accompany `published-artifacts.json`; chapter-led/restored/duplicate main-route states are identical, and chapter-free states are identical across both surfaces and widths.

- [Shared-repair ending, chapter-led mobile](w6-chapter-led-static-390-shared-ending.png) and [chapter-free mobile](w6-chapter-free-standalone-390-shared-ending.png)
- [Purchase view, desktop](w6-chapter-led-standalone-1280-shop.png) and [gift view, mobile](w6-chapter-free-static-390-gift.png)

The final purchase/gift views show readable amounts, time costs, stock and wrapping controls. Both shared-repair screenshots show actual Mara presence at the signal station and an eligible completed ending. The published packages and all fourteen PNGs are unmodified final-run outputs; the first passing release and earlier attempts remain preserved separately.

## Final validation

Local pinned-tooling validation passed: reproduction CLI, strict demo TypeScript check, repository lint, typecheck, build, **162 unit files / 1,569 unit tests**, and **52 browser tests** with one worker and traces. No tests were skipped and no assertion or tolerance was weakened. `validation.json` records exact results and captured/published log hashes; complete readable logs are in `validation/`. Only trailing whitespace and surplus EOF blank lines were normalized for publication; original logs, earlier attempts and full traces remain preserved in the saved environment.

Node 24.19.0, pnpm 11.9.0, Playwright 1.62.0, Chromium and Headless Shell 151.0.7922.34 revision 1234 were verified. The 13 frozen source/test/guide hashes match `source-manifest.json`; the protected illustrated files match `protected-files.json`. All files that existed at the accepted base remain unchanged. Exact-head CI and final local/remote equality are reported with the delivered commit SHA, avoiding a follow-up commit solely to record CI status.
