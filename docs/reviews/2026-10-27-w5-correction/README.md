# W5 review correction: stationary progression journal boundaries

Base: `0a10ac7ebc11b8766ae85f01cf230c8ae7c99cac` on `codex/w1-locations-time`. Initial checkout matched and was clean. The containing commit is the proposed correction head; it is not independent W5 acceptance. W6 remains paused.

The single finding is reproduced: a journal-enabled game with neither people nor economy skips intermediate observations during stationary progression actions. A 15-minute event or chapter transition can cross an entire journal trigger window without recording it.

The only production change adds `|| world.journal` to the existing extension guard in `transitionProgressionWorld`. This sends stationary journal-only events and chapter transitions through the existing boundary helper. No schemas, saves, exported formats, UI, dependencies, assertions or tolerances change.

```diff
-  let next = (world.people || world.economy) && (!destination || destination.id === state.world.locationId) ? advancePeopleTime(world, state, minutes, false, command.kind === "event" ? command.id : undefined) : cloneRuntimeState(state);
+  let next = (world.people || world.economy || world.journal) && (!destination || destination.id === state.world.locationId) ? advancePeopleTime(world, state, minutes, false, command.kind === "event" ? command.id : undefined) : cloneRuntimeState(state);
```

The destination check is unchanged: journeys still observe only on arrival. The helper still skips final observation until completion effects have committed; mandatory encounter arbitration is unchanged. With all three extensions absent, the legacy clone path is unchanged. The accepted illustrated CSS and original layout test are byte-identical to the base (see `protected-files.json`).

## Regression coverage

`packages/runtime/test/journal-progression.test.ts` adds six tests. Both stationary event and transition cases exercise no passage and an explicit current-location passage. Each runs from minute 1430 to 1445: entry/reveal window `[1432,1434)`, objective completion window `[1433,1434)`. Both the entry and completed objective survive the end of the window. The tests assert unchanged input, exact deterministic replay, save/load before replay and after completion. Separate journey cases confirm that these transient opportunities remain undiscovered during travel, while completion/arrival information is recorded. Pre-effect chapter/milestone conditions remain hidden at completion. Legacy cases omit journal, people and economy entirely.

Before the production change, the new suite had two stationary failures and four passes. The failure received only `arrival`, missing `window`. After the correction, all six pass. Existing journal/progression/people focused suites also pass: 103 tests total. The original failure log is preserved alongside passing evidence.

`e2e/journal-progression.spec.ts` authors and compiles a real game via the shared MCP workflow, exports standalone HTML and static ZIP, then shuts down Creator before play. Both definitions and actual saves explicitly omit people/economy. Each surface is played at 1280×900 and 390×844:

- A stationary 15-minute event crosses midnight, recording the short event entry and completing its objective.
- A stationary 15-minute chapter transition crosses a second short window, recording the chapter entry and completing its objective before the chapter changes.
- Pre-effect entries remain hidden, records appear once, and cancellation is free.
- Autosave/reload, named manual save/load, rewind, restart and deterministic replay match the expected complete runtime state. Direct ID assertions establish the transient discoveries independently of the pure-runtime comparison.
- No API/provider requests occur during offline play. Horizontal document overflow is checked. Representative screenshots were visually inspected for readable text, wrapped mobile navigation and accessible game controls; no UI change was needed.

## Validation and evidence

Local full validation passed: lint, typecheck and build; **161 unit files / 1,568 unit tests**, and **51 browser tests** with one worker. No skipped tests or weakened assertions. Full results are recorded in `validation.json` and complete logs under `validation/`. Source hashes in `source-manifest.json` bind the three source/test files to the validated state. Pinned tooling: Node 24.19.0, pnpm 11.9.0, Playwright 1.62.0; Chromium and Headless Shell 151.0.7922.34 revision 1234. Local browser tests use one worker and traces. Original logs, full traces, all 16 screenshots per browser run and superseded evidence are retained in the saved environment; the representative evidence below is published in Git for remote reviewers.

## Representative full-suite browser evidence

- [Standalone desktop: event entry](w5-correction-standalone-1280-event-entries.png)
- [Standalone mobile: both completed objectives](w5-correction-standalone-390-chapter-objectives.png)
- [Static desktop: both completed objectives](w5-correction-static-1280-chapter-objectives.png)
- [Static mobile: both recorded entries](w5-correction-static-390-chapter-entries.png)

`browser-evidence.json` records unedited screenshot hashes/dimensions and hashes of the four actual final browser states. All four final state files are byte-identical: minute 1460, chapter `second`, both entries and both completed objectives, no people/economy state. Each state is captured after restart and deterministic replay of the event and transition. The PNGs above were inspected directly from the full-suite run.

## Limits

This correction changes only the missing journal-only guard. It does not add observation points during journeys, change completion ordering or mandatory-event policy, migrate older saves, or implement W6. Already-missed historical transient observations are not reconstructed when loading an old save. Offline source remains inspectable as documented for W5. Passing tests and normal push do not establish checkpoint acceptance; independent review is required.
