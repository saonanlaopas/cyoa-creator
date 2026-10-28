# The Last Harbor Signal — W6 demonstration

A short, complete coastal story using the accepted W1–W5 systems. Play as Mira: explore an illustrated harbor, buy a warm cup, find Mara on her recurring morning visit, share tea, hear her warning, and prepare an honest signal together. The chapter-led version has **I · A cup before the storm** and **II · An honest light**. The chapter-free version tells the same story through an explicit departure event.

## Play the published game

The `artifacts/` directory contains the **actual exports verified in the release browser run**:

- `chapter-led.html` — download and open in a modern browser. All scripts, styles, prose and artwork are embedded.
- `chapter-free.html` — the equivalent game with no chapter records or transitions.
- `chapter-led.zip` and `chapter-free.zip` — extract and serve with any ordinary static web server. For example, run `python3 -m http.server --directory extracted-game 8080` and open its `index.html` through that server. A static ZIP needs HTTP; the standalone HTML supports `file://`.
- `chapter-led.cyoa-backup.zip` and `chapter-free.cyoa-backup.zip` — verified source backups for Creator's **Backup & recovery → Restore**. They contain only the disposable fictional demo project and its immutable authoring history.
- `restored.zip` and `duplicate.zip` — exports from an actual restored source project and an independent duplicate, also played offline during verification.
- `manifest.json` — hashes, source bindings, asset provenance and actual offline play results. World-definition JSON accompanies each main configuration for inspection/re-application to its restored source project. `artwork/` contains the five unmodified approved images extracted from the verified package.

The two source backups are versions of the same disposable project. Restore one into a fresh Creator database; a second restore with the same project identity is expected to conflict. Duplicate a restored project to make an independent copy. The supplied world JSON binds to the exact owning source project and must be reviewed before application; its immutable references are not portable to an arbitrary duplicate or regenerated project.

There is no provider key, API requirement or generated narration during play. Creator was shut down before exported gameplay verification. The static package's images are embedded in `game.json`; player JavaScript/CSS are packaged under `assets/`. Source definitions, future prose, conditions and schedules remain inspectable in offline files. Player-facing views reveal the authored information according to accepted discovery rules.

## Suggested full playthrough

The Journal's **A note for the morning** gives the same directions inside the game. You start at the keeper's house at **07:00**, with 6 Coins and no Tea.

1. In **Explore**, choose **Listen to the tide (optional)**. This costs 3 minutes and records a remembered entry. Skipping it never blocks the story.
2. Travel to **Quay cafe** (7 minutes). **Shops here → Buy 1 Tea** costs 3 Coins and 2 minutes. The cafe counter is open daily 06:00–22:00 and has one parcel reserved for this visit.
3. Return to **Explore** and wait 5 minutes. Mara now appears under **Here now**. Her visit recurs each morning; if you arrive late, you can wait for the following morning. The UI does not disclose her hidden timetable.
4. **Give a gift → Share a warm cup** (1 minute). Trust with Mara rises from 0 to 2. Return to **Explore** and complete the required **Hear Mara's warning** encounter (5 minutes).
5. Save if desired. **Begin II · An honest light** (chapter-led), or **Take the warning to the station** (chapter-free), costs 2 minutes and carries you to the station. An authored story override places Mara there with you; the preparation requires her actual presence.
6. **Prepare the honest signal** (3 minutes). Mara's help raises Trust to 3 and completes the disclosed objectives. Choose **Light the honest signal** below the scene to reach **The Honest Signal** ending at **07:28**, with 3 Coins, no Tea and the remembered tide entry.

Without the optional activity, take a 15-minute wait at the cafe instead; the rest of the path is unchanged. Secondary views are contextual: Explore, Character, Journal, Inventory, Shops here and Give a gift. Inspection, maps, reading, navigation and cancelling a confirmation are free. Only confirmed world activities advance game time. Keyboard users can Tab through native buttons, activate with Space/Enter, and use Escape to return from secondary views.

After preparation, **Share the watch** at the station reaches **A Shared Repair**; inspecting the damaged lamp offers the handover resolution instead. Backtracking to the cafe and choosing to bring the crew returns you to the actual station before those resolutions. There are authored alternatives after the shared preparation. **Hand over the watch (early ending)** offers a deliberate shorter ending before preparation: it leads through a handover scene, then **Finish the handover**. It does not claim the main objectives were completed. Restart to follow the full path. This explicit exit also respects the existing passage validator's requirement for a plausible narrative exit; the validator has not been relaxed for world-only gates.

## Reproduce from source

Use Node **24.19.0**, repository-pinned pnpm **11.9.0**, and the saved environment activation instructions. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @story-to-cyoa/server exec tsx ../../demos/last-harbor-signal/generate.ts /absolute/path/to/an-empty-output-directory
pnpm exec tsc -p demos/last-harbor-signal/tsconfig.json
pnpm exec vitest run apps/server/test/w6-demo.test.ts
pnpm test:e2e e2e/complete-visual-game.spec.ts --workers=1 --trace=on
```

The generator uses a fresh temporary SQLite database, an authenticated loopback MCP endpoint and explicit proposal/review/apply/approval operations. It imports/reviews/approves five staged assets, accepts authored prose, applies each world, compiles exact builds, downloads both export formats, and creates verified backups. It refuses a nonempty output directory and removes its temporary server/database afterward. Its ephemeral authentication token is never written to published artifacts. No existing project is opened or modified.

`author.ts` reuses the accepted coastal foundation/graph authoring helpers, then proposes the demo's exact scenes and choices through bounded shared operations. `world.ts` owns both world definitions; `play.ts` provides deterministic public-runtime replay. `host.ts` and `artifacts.ts` use existing local Creator/MCP services, with no direct persistence writes. The demo-only `package.json` marks these scripts as ES modules; it adds no dependencies and changes no workspace package or lockfile.

The SDK test authors the game using the real MCP SDK, proves all three endings, station/crew routing and eight combinations of chapter mode, optional activity and first/next-day encounter, then verifies exact save/load/replay. Browser integration additionally uses actual Creator controls, compilation and preview, verified backup restore into another database, independent duplication, packaged-asset hash checks, and ten desktop/mobile offline plays after Creator stops.

New authoring runs allocate fresh immutable IDs, so regenerated bundle/backup bytes can differ. The authored content and bitmap generators are deterministic; replay and save comparisons bind to each exact published bundle. Static ZIP manifests and the demo manifest bind the reviewed release artifacts by SHA-256.

## Asset provenance and limits

All artwork is **CC0, original deterministic repository bitmap fixtures**, reused from the independently accepted base `9111866558accd3679921859a688d6831e318a67`:

| File | Generator | Use |
| --- | --- | --- |
| `harbor-map.png` | `e2e/helpers/world.ts:townMap` | District map and separate DOM navigation markers |
| `harbor.png` | `e2e/helpers/image-assets.ts:fixtureImage` | Harbor/station background |
| `cafe.png` | Same generator, alternate palette | Warm quay/cafe background |
| `mira.png` | `e2e/helpers/illustrated-assets.ts:portraitImage` | Concerned Mira |
| `mira-relieved.png` | Same generator, smiling variant | Relieved Mira at endings |

`assets.ts` repeats the accepted portrait pixel generator with a relative encoder import so both the SDK and reproduction CLI can use it. The manifest records original source hashes and hashes of the approved bytes actually embedded in the packages. These are deliberately simple schematic illustrations, not new commissioned art. Scene portraits are authored static presentation; Mara's actual presence is conveyed through the accepted schedule/presence and encounter UI, so the artwork does not falsely place her at the cafe before arrival.

This is a compact nine-scene demonstration, not a 50,000-word novel. The underlying long-form scaffold retains its planning targets and historical versions; current accepted prose is the demo. Three authored endings are retained. Source backups include the scaffold's earlier immutable authoring history. Saves bind to exact bundles and do not transfer automatically between modes, regenerated projects or duplicates. File-browser storage policies can limit persistence; the accepted session-only fallback still allows play. No new engine behavior, inventory system, schedule policy, UI framework or later-roadmap feature is introduced. W6 requires independent acceptance after delivery.
