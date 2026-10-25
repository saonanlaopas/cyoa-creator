# W2 review corrections

Correction base: `20061db1a899801d2a0bdbb16a2946c884b5c34b` on `codex/w1-locations-time`; the checkout started clean. This was the previous W2 delivery, **not an accepted checkpoint**. The accepted W1/illustrated base remains `7e977089cea561bbe4e69a8ec80731414b8339b0`. The correction target is the commit containing this report; its full head SHA and exact-head CI URL are pinned in the delivery message. W2 awaits independent review and W3 remains paused.

## Findings and scoped corrections

1. **Hidden invalid references after deletion.** The old removal callbacks deleted the named item but left event milestone grants and transition milestone carry/event expiry entries. Their checkboxes then disappeared. Creator now blocks referenced milestone/event removal and displays affected event/transition names and indices, reference roles, and repair instructions beside the disabled control. Milestone dependencies include both event/transition prerequisites as well as grants/carry. Clearing those visible controls enables removal; no dependent authored rule is silently discarded. An unreferenced milestone's initial-achievement flag is removed with the milestone.
2. **Map-free preview disappears.** The projection included every cached image, including artwork no longer assigned to a location. Native validation correctly rejects unused projected assets. The projection now includes only image versions referenced by current locations. Shared images remain available until the last reference is removed; cached images can be reassigned without another fetch. Native validation remains unchanged.
3. **Valid transition IDs collide with inherited properties.** Nullish fallback read `Object.prototype.toString` from an empty ordinary ledger; adding 1 produced a nonnumeric count. The transition counter now checks `Object.hasOwn`, matching the existing event-history pattern. Valid IDs are preserved. Their first count is 1 and their own count increments normally on later executions.

Production changes are limited to `ProgressionEditor.tsx`, one scoped dependency-description CSS rule, the editor asset projection, and the transition counter read. No schema, dependency, migration, provider, W3 or illustrated-scene changes were introduced.

## Regression evidence

Before production edits, seven added regression cases failed against the prior code while 34 existing cases passed. The preserved log is `regression-before.log` under `/workspace/.setup/w2-corrections-20261025`; source snapshots are retained in `before/`. The seven cases cover milestone removal, event removal, removal of shared cached map artwork, and four inherited-name transition IDs: `toString`, `valueOf`, `hasOwnProperty`, `__defineGetter__`.

After the corrections, all 41 runtime/web cases passed; the focused runtime/server/web run passed all 50 tests. Tests cover named dependency descriptions, blocked no-op deletion, explicit reference clearing, valid remaining definitions, shared/removed/reassigned maps, unchanged prior checkpoints, repeated transition counts and save/load. The map test checks that reassignment adds no fetches relative to its initial shared-image reads.

The browser scenario uses an actual Creator/MCP-authored world with transition ID `toString`. It removes and restores map artwork, inspects dependency guards at 1280×900 and 390×844, clears dependencies, deletes both referenced kinds and successfully reviews the edited definition, then reloads the original definition. Creator is stopped before playing chapter-led/chapter-free standalone/static packages, including transition, save/reload/manual load, repeats, carry/expiry, rewind/restart and offline operation. The initial new browser attempt used an exact label lookup for a select; its trace showed the correctly named combobox, so the new locator was corrected to that accessible role/name. Its failure evidence remains separate from the passing rerun.

## Final validation

Commands use Node 24.19.0, pinned pnpm 11.9.0, Playwright 1.62.0 and matching Chromium/Headless Shell 151.0.7922.34, revision 1234. Heavy checks run sequentially. Final results and log hashes are recorded in `validation.json`.

| Check | Result |
| --- | --- |
| `pnpm lint` | Passed |
| `pnpm typecheck` | Passed |
| `pnpm build` | Passed; existing non-fatal Vite chunk-size warning |
| `pnpm test` | Passed: 150 files / 1,398 tests |
| `pnpm test:e2e --workers=1 --trace=on` | Passed: all 46 tests, zero skipped (4.5 minutes) |
| Accepted illustrated CSS, original assertion/tolerance | Unchanged |
| `git diff --check` | Passed |

The existing Vite bundle-size warning remains non-fatal. The authoring/runtime scope and limited, non-exhaustive progression diagnostics are otherwise unchanged; see [the contract](../../chapters-and-events.md). No paid provider calls or subagents were used.

## Representative browser evidence

Unedited screenshots from the final full browser run are published beside this report, with file hashes and dimensions in `screenshots.json`:

- Milestone dependency guards: [desktop](w2-deletion-dependencies-1280.png) / [mobile](w2-deletion-dependencies-390.png).
- [Event expiry dependency guard: mobile](w2-event-expiry-reference-390.png).
- Map-free preview: [desktop](w2-map-removed-1280.png) / [mobile](w2-map-removed-390.png).
- [Static player after `toString` transition and save/reload: mobile](w2-static-second-chapter-390.png).

Prior review evidence remains unchanged in [the original W2 package](https://github.com/saonanlaopas/cyoa-creator/blob/20061db1a899801d2a0bdbb16a2946c884b5c34b/docs/reviews/2026-10-25-w2/README.md). Full local traces/logs and failed attempts remain preserved separately; ephemeral offline-test credentials in traces are not published here. These GitHub-hosted report/screenshot links can be forwarded to the independent reviewer without environment-local access.

## Exact diff

```sh
git diff --binary 20061db1a899801d2a0bdbb16a2946c884b5c34b HEAD
git diff --exit-code 7e977089cea561bbe4e69a8ec80731414b8339b0 HEAD -- apps/web/src/features/player/illustrated-scene.css e2e/illustrated-scenes.spec.ts
```

The delivery message supplies the immutable correction head and diff URL. Successful validation and pushing do not constitute W2 acceptance.
