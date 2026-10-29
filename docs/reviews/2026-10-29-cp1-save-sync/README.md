# CP1 review correction — wait for manual-save completion

Correction base: `3c5292ab2e9df40c3879f7dc80436c212118005d`, initially clean on `checkpoint/cp1-desktop-review`. CP1 acceptance remains pending. Independently accepted W6 remains `fe3d9c0f0f4165ce251bd39775a778ee3631e427`.

## Change

The W6 browser test clicked **Create save**, then immediately reloaded. A Playwright click completes before the asynchronous player save necessarily completes. The test now waits for the existing exact **Saved “Mara's warning”.** status before the same reload. The player emits that status after awaiting the manual-slot transaction and refreshing slots.

This adds one completion assertion; all original test assertions and timeouts remain intact. Removing the added assertion and rejoining the split save line restores the entire previous test file byte-for-byte. No fixed sleep, retry, tolerance increase, assertion weakening, production player/storage edit or gameplay change is included. Player/storage code, illustrated CSS and the original illustrated-scene assertion match accepted W6 exactly. See [invariants](invariants.json) and [protected hashes](protected-files.json).

## Independent controlled-delay probe

An isolated probe uses the committed chapter-led standalone HTML and two fresh browser contexts. It delays delivery of the next IndexedDB open success by 750 ms during manual-save creation, leaving production files unchanged:

| Navigation | Reloaded load dialog |
| --- | --- |
| Reload immediately after Create save | **No manual saves yet.**, zero Load buttons |
| Wait for the saved confirmation, then reload | Saved slot present, one Load button |

The observed result independently reproduces the reviewer's mechanism. [Probe result](storage-delay-proof.json), [probe source](storage-delay-probe.cjs), [immediate reload screenshot](storage-delay-immediate-reload.png), and [waited screenshot](storage-delay-waited.png) are preserved. Both screenshots were inspected directly and are unedited. The diagnostic source uses Cloud workspace paths and is not installed into Creator or the player.

## Exact CI failure evidence

The prior exact-head [CI run 40810417317](https://github.com/saonanlaopas/cyoa-creator/actions/runs/40810417317) passed 1,571 unit tests and 51 browser tests; W6 failed with a 15-second wait for the exact **Load** button at the old line 119. The state comparison was not reached. This test and the player save implementation were unchanged by CP1.

The connector retrieved [failure artifact 12870945681](https://github.com/saonanlaopas/cyoa-creator/actions/runs/40810417317/artifacts/12870945681), but downloading its bytes into Cloud is currently blocked by the enforced proxy policy: `sdmntprseasia.oaiusercontent.com`, CONNECT 403. The author has been asked to allow the host. **Exact snapshot inspection and the exact CI cause remain pending; the controlled probe alone does not establish the CI transaction timeline.** Raw prior CI logs and the artifact reference remain preserved outside Git.

## Validation and delivery

Build, lint and typecheck passed. Focused corrected W6 plus unchanged illustrated-scenes browser tests passed: **2 tests**, 2.4 minutes, matching Chromium revision 1234, one worker. Full browser verification passed: **52 tests**, 6.3 minutes, **two workers**, matching the failed CI run's concurrency. W6 completed all ten offline plays with the existing save/load, rewind and exact-state checks. No source timeout was changed. [Validation metadata](validation.json) and the accompanying logs identify these checks. No production change requires a new unit regression; the unchanged full unit suite will also run in exact-head CI.

The containing review commit contains this scoped test correction and evidence. It is pushed normally and its exact-head CI result is reported separately with delivery, avoiding a self-referential follow-up commit just to record CI. Passing CI or pushing does not establish CP1 acceptance. No merge, force-push, PR, provider call, subagent or remote bridge is part of this correction. The [test-only patch](test-only.diff) has zero context (`git apply --unidiff-zero`).

## Desktop connection gate

After passing exact-head CI, run the [desktop native connection smoke test](../../desktop-codex.md#desktop-connection-smoke-test-pending) on desktop Codex beside the persistent Creator instance. This Cloud conversation has no registered native Creator tools and cannot certify desktop GUI credential inheritance, human batch approval or fresh-conversation recovery. SDK/configuration checks remain separate evidence. **Native desktop verification stays pending until the actual desktop record exists.**
