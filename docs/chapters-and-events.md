# Chapters and events (W2)

Creator's **Locations and time** workspace includes **Chapters and events**. Browser and MCP share `read_world`, `review_world` and `apply_world`; `preview_chapter_transition` is an additional read-only MCP tool. Authoring, exact review, consent, Apply, compilation and export remain separate. No provider generation is involved.

## Definitions and authoring

An enabled W1 world may include `progression`, an optional `cyoa.world-progression` v1 definition. Omit it to keep W1 behavior. Enabling it in Creator starts with one named chapter; authors can remove chapters for chapter-free play. Leave `chapters` empty, `initialChapterId` null and transitions empty for chapter-free events. A single playable location is sufficient; maps are optional. Progression needs an enabled world because its conditions and costs use world location/game minutes. Existing text games and W1 worlds remain supported.

The definition supports 20 chapters, 100 named milestones, 100 events, 60 explicit chapter transitions and 20 prerequisites per event/transition, within the existing 48,000-byte world budget. Chapters have an authored initial chapter and a final-chapter marker; a final chapter cannot have an outgoing transition. The marker does not automatically end the story: authored passage endings still do that.

Prerequisites are bounded conjunctions (**all** must hold):

- Chapter is/is not the current chapter.
- Named milestone is/is not achieved.
- Current playable location is/is not an exact location ID. Grouping/map areas are not playable locations.
- Absolute integer game-minute interval, inclusive `from`, exclusive `until`; null is an open bound. Minute 0 is Day 1 at 00:00. No wall-clock/timezone or recurring schedule evaluation is involved.

W2 prerequisites gate events and chapter transitions. Existing story-choice mechanic conditions retain their current contract. New inventory/relationship predicates, schedules, automatic encounter arbitration and mandatory-event priorities are later checkpoints.

Events have an authored label/result, visibility, optional exact-version destination passage, minute cost and granted milestone IDs. They are explicitly selected and confirmed by the player. Repeat rules are once per playthrough, repeatable with a 0–1,440 minute cooldown, once per integer game day, or once per named chapter. Repeat timing is measured from the event's start minute. Returning to a previously visited chapter does not reset once-per-chapter events. Cooldown 0 allows another confirmed action, but each action still consumes a turn and obeys the runtime turn limit.

An event's destination is narrative entry, like an existing story choice, rather than inferred travel: its authored minute cost and prerequisites govern it. A mapped destination updates location; an unmapped passage retains the last location. Opening hours continue to gate W1 travel at arrival. Events/transitions do not invent travel paths or charges. A null destination stays in the passage without fabricating a visit. Existing terminal passages disable world actions, including events/transitions.

Transitions explicitly select **carried milestone IDs** and **expired event IDs**. Other achieved milestones expire. Selected events expire permanently, regardless of repeat rule. Event completion history, discovered opportunities, game time, location and existing text-game mechanics carry forward; the transition's authored minute cost/destination can change time/location. No implicit chapter change happens when a calendar boundary passes.

All passage destinations bind exact passage-plan versions. **Rebind current passages** includes location, event and transition bindings; absent/deleted references are not silently repaired. Changing a field clears review/consent. Apply retains immutable history, rejects stale reviews and uses the existing retry-safe operation UUID/receipt transaction, including after restart/restore. Disabling progression removes only that optional definition from the newly applied world; historical builds remain playable.

Creator blocks removal of a referenced milestone until its event grants, prerequisites and transition carry rules are cleared. Event removal similarly requires clearing transition expiry rules. The disabled Remove control names the affected events/transitions and explains which controls to clear. Removing an unreferenced milestone also clears its initial-achievement selection. Removing map artwork keeps the area preview available with its text fallback.

## Transition preview and player state

Opening the confirmation shows carried/expiring named milestones and known opportunities affected by the transition. Authored expiry is distinguished from a repeat rule or prerequisite becoming unavailable (which may be recoverable through authored return paths). Already-completed once-only events are not presented as lost opportunities.

An opportunity becomes known when it is always-visible or first satisfies its prerequisites at initialization or a committed action. Discovery is remembered after travel, time changes and chapter changes, and persists in saves. Hidden opportunities that have never become known are not revealed by a loss preview. This is a preview of known effects, not a guarantee about every possible future opportunity.

Preview/cancel does not mutate state, advance time, add a turn/visit or autosave. Confirmation carries a fingerprint of the definition, full current runtime state and preview; another action invalidates it. Costs, milestones, permanent expiry, chapter/history and destination entry commit atomically. Rejected actions preserve the original state. Rewind and restart use the same cloned state/checkpoint path as W1. An autosave failure retains the already committed transition and retries the save rather than applying it twice.

Saves add a versioned `state.world.progression`: current chapter, achieved/known/expired ID sets, per-event count/start-minute/chapter history and transition counts. Validation rejects unknown IDs/versions, duplicates, invalid time/counts, missing/injected progression, impossible chapter-flow accounting, disconnected history cycles, unearned milestones and inconsistent expiry/discovery. It is structural/logical state validation, not cryptographic proof or exhaustive replay of every possible gameplay history. W1 stationary-turn accounting continues to distinguish stationary actions from passage entry.

## Diagnostics and delivery compatibility

Contradictory conjunctive chapter, milestone, location and time requirements are rejected, including exclusion of every chapter/playable location and a transition contradicting its own source chapter. Missing references and unsupported contracts are rejected at persistence/native loading boundaries.

Review reports potential unreachable chapters, missing/cyclic milestone producers, non-final chapters without a potentially satisfiable exit, past time windows and transitions that may drop required milestones. The analysis over-approximates positive chapter/milestone reachability and does not solve all negative conditions, time/location navigation, ordering or expiry interactions. Findings are **potential traps**, not exhaustive proof of solvability or impossibility. Review returns at most 50 findings with total/omitted counts and `exhaustive:false`; publication also reports warnings. Warnings do not silently become hard blockers.

`preview_chapter_transition` accepts a project ID, transition ID and supplied runtime state. It validates the progression/world state and previews against the current fresh world; it does not certify an entire playthrough, store a save, apply the transition or call a provider. It shares MCP's existing request/result size limits. The returned world version identifies the authoring definition used. Finished players compute their own previews against their immutable published bundle.

Compilation pins the exact world/progression and all destination versions, projects `cyoa.native-progression` v1 into `cyoa.native-world`, and includes it in bundle identity. Public exports contain passage IDs and gameplay rules rather than authoring version IDs, requests or receipts. Absence preserves old world/bundle/save shapes and fingerprints; existing v1 text-save fixtures remain valid. Unsupported readers reject unfamiliar extension fields/versions rather than silently dropping them.

Standalone HTML and static ZIP package the same native player and run without Creator or an AI provider. Markdown and Twee reject enabled worlds with capability diagnostics instead of discarding chapter/event mechanics. Full/privacy portable archives, verified backup/restore and duplication retain progression history and correctly rebind captured passage versions/build references. Player saves stay bound to their exact published bundle; recompiling different rules does not silently migrate an old save.

## Verification

`packages/runtime/test/progression.test.ts` covers deterministic prerequisites, repeats, midnight, carry/expiry, known-opportunity previews, stale fingerprints, atomic rejection, save integrity, choice/location integration, rewind/restart and chapter-free play. Server tests cover shared operations, contradictions, warnings, concurrency, receipts, rollback, direct persistence, historical compilation, full/privacy archives, backup/restore, duplication and an installed MCP SDK client. Web tests cover structured authoring, consent/retry behavior, free previews, actual player confirmation and autosave recovery. `e2e/progression.spec.ts` authors through MCP and Creator, exercises stale/lost Apply, then shuts Creator down and plays chapter-led and chapter-free standalone/static packages at desktop/mobile widths with save/reload/load, repeats, expiry and explicit transition preview/cancel/confirmation.

The full lint, typecheck, build, unit and matching-browser suites, exact-head CI and independent review remain required for checkpoint delivery/acceptance. Passing validation or pushing a commit is not checkpoint acceptance.
