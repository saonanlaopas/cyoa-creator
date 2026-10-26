# People and schedules (W3)

An enabled world can opt into `people`, the versioned `cyoa.world-people` v1 definition. It contains world characters, recurring placements, condition-driven story overrides and one explicit encounter rule for every W2 event. Creator's **Locations and time → People and schedules** edits this definition through the same `read_world`, `review_world`, `apply_world` services and retry-safe receipts as MCP. Review, author consent, Apply, compilation and export remain separate. No generation/provider call is involved.

## Recurring presence

People have stable world IDs and authored display names, independent of relationship/stat mechanics or portrait speaker labels. Up to 30 people, 200 schedule slots, 100 overrides and 100 encounter rules fit within the existing aggregate 48,000-byte budget and RPC limits. No inventory, currency, shops, gifts or new relationship rules are added.

Each schedule selects a person, a playable location, repeating Day 1–7 positions and integer start/end minutes of day. Selecting all seven days means daily recurrence. Absolute game minute 0 anchors Day 1; weekdays repeat every 10,080 game minutes, with no wall clock, timezone, locale or real calendar. Starts are inclusive and ends exclusive. Start is 0–1439; end is 0–1440. An end earlier than the start crosses midnight; 1440 means the end of that day. Equal endpoints are rejected; use 0–1440 for a full day. Weekly wrap includes the tail of Day 7's overnight slot at the beginning of Day 1.

Outside placements a person is absent. Overlapping weekly slots for the same person are rejected, including overnight/week-wrap overlap and duplicate days. Location opening hours continue to govern W1 travel at arrival; they do not silently rewrite character schedules.

## Story overrides

An override selects a person, a location or **Absent**, an integer priority (-1000 to 1000), and up to 20 conjunctive W2 chapter/milestone/player-location/absolute-time prerequisites. A matching override replaces the recurring schedule. The highest priority wins; unresolved equal priorities for one person are rejected. Override conditions are evaluated against current committed story state, so event milestones, chapter carry/expiry and narrative-choice arrivals take effect immediately. Characters do not spend inferred travel time between authored placements.

Conflict checks conservatively use chapter/milestone/location/time contradiction analysis. They do not solve all combinations of schedules, negation, history or higher overrides; use distinct priorities when exclusivity cannot be established by those checks. Current-state resolution defensively rejects ties rather than selecting by storage order.

Creator blocks deleting a person until their schedules, overrides and encounter presence selections are cleared. New schedule/override location references, and chapter/milestone override references, also block deletion with visible repair information. Disabling progression requires clearing its story-override predicates first. Adding/removing a W2 event adds/removes its owned W3 rule; other rules retain their authored priorities and presence selections. Edits clear review and consent.

## Encounters and priorities

Every event in a W3 world has an explicit priority, required/optional flag and list of people who must all be present at the player's current location. An empty list needs no person. Existing event prerequisites, costs, repeat rules, results, passage bindings and milestone grants remain W2 contracts. Newly added rules default to priority 0, optional, with no required people; authors review those explicit values before Apply.

A hidden event becomes known only when its prerequisites and presence requirements hold at initialization or a committed observation. An always-shown W2 event still exposes its authored label by choice. Once discovered, an unavailable encounter can remain listed with a generic explanation; the player sees no future times or remote placements. The presence panel lists only people here now. Map/menu inspection, loss previews, manual saves and cancels are free and do not create observations or advance time.

Among eligible required events, the unique highest priority is selected. It blocks other confirmed events, chapter transitions, travel, local actions, waits and story choices until the player confirms it. Lower priorities can follow after completion. Optional ties use stable code-unit ID order for display and are never automatically selected. Required events with equal priorities are rejected unless their prerequisites are provably exclusive under the limited condition check; presence/repeat/history exclusivity alone is not used as proof. Runtime arbitration also rejects actual ties atomically.

Required repeatable events need a positive cooldown; a zero-gap required repeat is rejected. Review/publication warn when an event's cost can make its required repeat immediately eligible again. This is a potential-trap warning, not exhaustive proof of solvability. Authors remain responsible for sensible costs, windows and prerequisite/presence effects. Existing turn/time limits still apply.

## Arrival, time boundaries and atomicity

Presence is derived, never cached against wall time. It is evaluated initially, after narrative-choice arrival/effects, at travel/explicit narrative destinations, after event/chapter effects, and at relevant time boundaries while stationary. Boundaries include schedule starts/ends, midnight, absolute condition endpoints and cooldown expiry; each authored cost is bounded to one day. An overnight character who leaves before a long wait ends is still discovered during an observed window. Discovery at a past boundary reveals only the encounter experienced there, not a future timetable.

Waiting stops at the first newly available required encounter, consuming the actual elapsed minutes and one stationary turn. The encounter requires normal player confirmation; it is not auto-executed. Travel and narrative actions entering a different mapped location are journeys: only the destination/arrival is observed, not origin-side encounters during transit. Stationary authored costs are atomic. Optional events, local actions and chapter transitions that would cross a newly required encounter before completion reject unchanged with an instruction to wait instead. A confirmed required encounter is the action currently blocking waiting, so it finishes atomically before newly eligible encounters arbitrate, including encounters with a higher priority. Their windows can expire during that cost; this does not guarantee every encounter can be played. At exact completion, authored effects resolve before discovery and final required-event arbitration; intermediate observations before completion remain recorded.

Chapter-transition loss previews compare the encounter's own prerequisites, presence, authored expiry and repeat eligibility. Temporary blocking by another required encounter is not a loss or a repeat restriction. The destination's required encounter still blocks ordinary actions until completed.

Invalid/conflicting actions do not partially consume time, visits, milestones, discoveries or save history. Preview/cancel does not mutate state. Autosave failure retains the committed action and retries persistence rather than repeating effects. Rewind/restart/load restore the corresponding discoveries and integer game time; the same commands and definition reproduce the same state.

## Persistence, MCP and publication

Publication projects the extension into `cyoa.native-people` v1 inside the existing immutable native world. Player state adds optional `state.world.people` v1 with discovered character IDs; current presence is recomputed from the exact definition and state. Unknown/missing versions, missing/injected state, invalid/duplicate IDs and missing current discoveries are rejected. Discovery history is bounded logical validation, not cryptographic or exhaustive replay proof.

Absence retains accepted text/W1/W2 bundle/save shapes and fingerprints. Saves remain bound to an exact bundle; changes do not silently migrate old saves. World authoring/history, exact builds, full/privacy archives, verified backups/restores and duplication retain schedules/overrides/rules through existing world history paths; player saves remain separate from project archives. No SQLite migration or dependency was required. Markdown/Twee report unsupported world capabilities rather than dropping the extension. Standalone HTML and static ZIP embed the same native player and work after Creator shuts down, without providers.

The additional read-only MCP `inspect_world_presence` accepts project ID and a supplied runtime state, validates world/progression/discovery references against the current fresh world, and returns present people, discovered encounters, current required-event status, world version and providerCalls 0. It does not advance, discover, save, publish or certify an entire playthrough. It uses the existing authentication, configured-project access, same-origin/loopback and request/result bounds. Finished players derive their own projection from their immutable bundle.

Player UI and this inspection projection omit schedules, override predicates and future whereabouts. The offline bundle necessarily contains authored rules for local execution; this is controlled game presentation, not cryptographic secrecy against inspecting the exported source. Existing text-only simulation does not search all world journeys or prove schedule solvability; actual native-player replay and offline browser tests cover the delivered world behavior.
