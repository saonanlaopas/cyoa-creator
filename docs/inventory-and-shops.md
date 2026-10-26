# Inventory and shops (W4)

An enabled world can opt into `economy`, the versioned `cyoa.world-economy` v1 definition. Creator's **Locations and time → Inventory and shops** and MCP's existing `read_world`, `review_world`, `apply_world` share the same authoring service, exact review fingerprint, author consent and retry-safe Apply receipts. Applying authoring content, approving foundations, compiling and exporting remain separate. No provider call is involved.

## Items, money and stock

The world defines up to 50 named items, with descriptions, integer starting quantities, integer capacity limits (1–10,000), and a consumable flag. Zero quantity means not held. A nonconsumable item can be purchased or gifted, but cannot have a consumable-use rule. There is no equipment slot, crafting recipe or combat behavior.

One named world currency uses whole authored units, not floating-point money, exchange rates or real payments. Starting balance and maximum are integers from 0 to 1,000,000,000. Quantities and balances must remain within their bounds; values are rejected rather than clamped.

Up to 20 shops bind playable locations. Each shop has optional daily hours and up to 30 offers. An offer defines its stable ID, item, quantity per purchase, whole-unit price, finite stock, game-minute cost and conjunctive prerequisites. **Stock counts purchases of that offer's bundle**, not individual item units. A bundle of three items with stock two can be bought twice, transferring six items total. Different offers for the same item retain separate stock. Price zero is allowed; finite stock and item capacity still apply. There is no automatic restock, selling or bulk-purchase dialog; each confirmation buys one authored bundle.

Shop opening is inclusive and closing exclusive. An opening later than closing crosses midnight; null hours mean no shop-specific restriction. Equal opening/closing minutes are rejected. The shop and all ancestor locations must remain open throughout the purchase, including completion. Thus a two-minute purchase starting one minute before closing is unavailable. A full-day cost cannot bypass a midday closure merely because its endpoints are open.

## Gifts, consumables and effects

Up to 60 gift rules select an item quantity and a W3 world person. That person must be at the player's location throughout the action, including relevant schedule/override boundaries and completion. Authored placements, not inferred NPC travel, determine presence. The Gifts view lists only rules for people currently here; a failure gives a generic availability explanation, not future whereabouts.

Up to 60 use rules consume authored quantities of consumable items. Gift and use rules each define a label, minute cost, prerequisites, repeat policy, effects and authored result. Repeat policies are once, once per game day, once per chapter, or repeatable with a 0–1440-minute cooldown. Day, chapter and cooldown accounting use the **action's start state/time**, matching W2 event semantics. Crossing midnight during a cost can permit another action beginning on the new day. Chapter repetition requires authored chapters. There is no implicit gift preference, automatic affection gain, decay or daily stock reset.

Effects can change currency and item quantities, change canonical relationships, and grant named milestones. Currency/item deltas are signed integers; relationship deltas are bounded finite numbers. Each effect set references an item/key at most once. Gift/use rules consume their required quantity before applying effects; effects can intentionally refund that item. The required item must already exist before a refund. All other effects and bounds must also succeed.

Optional `eventEffects` attach explicit currency/item costs and these effects to W2 events. The event keeps its existing prerequisites, presence requirements, repeat ledger, result, passage binding and milestone grants. Each successful execution repeats its economic transaction. A reward cannot fund that same execution's up-front cost. This also supports an authored currency donation/relationship consequence through a person-gated event without requiring an item-gift rule.

## Relationship semantics and predicates

W4 uses the existing canonical Mechanics relationship keys and `RuntimeState.relationships`; it does not introduce a second relationship score or W5 presentation. Relationships are defined through the existing foundation authoring/approval workflow. Gift/use/event effects explicitly select which key changes; a world person's name or portrait does not imply an automatic key mapping. Authors choose the intended association.

`read_world` returns bounded relationship options (key, label, minimum, maximum, initial) and the current mechanics version for Creator/MCP authoring. A W4 review binds that version, so a concurrent mechanics edit requires another review. Publication copies the canonical relationship bounds/initials into `cyoa.native-economy` v1 for pure world evaluation; bundle validation requires those copies to match the exact published canonical mechanics. Historical compilation uses its input's exact mechanics, not today's definitions. Effects reject an out-of-bounds result atomically, as existing narrative mechanics do.

Existing narrative choices and ending gates continue to read the same relationship values changed by gifts. World events/transitions, story overrides and economic rules can use the shared new predicates:

- `item`: stable item ID, inclusive integer `minimum` and optional inclusive `maximum`. Zero–zero means absent.
- `relationship`: canonical key with optional inclusive minimum/maximum; at least one bound is required. Thresholds are finite and bounded to ±1,000,000,000.

All predicates in a list must hold. Unknown references, empty ranges and contradictory intersections are rejected. W3 priority-conflict checks can use these intersections to prove two required events exclusive; runtime tie rejection remains. Missing state never counts as an absent item or a satisfied relationship condition.

Relationship numeric presentation and authored visibility, character profiles and journals remain W5 work. Player confirmation shows currency/item costs and visible currency/item effects. Numeric relationship deltas are not added to a new player character panel; authored results and prerequisite changes can communicate their consequences. Offline source necessarily contains local rules and can be inspected.

Legacy abstract narrative resources are preserved independently. They are not automatically mapped into W4's typed item quantities or named currency. Use world-event item predicates for typed-item gates; canonical relationship gates already interoperate with narrative choices.

## Atomic time and failure

Inspection, trade-view navigation, previews, cancellation and saving do not advance time, discover encounters, buy items or consume stock. Confirmed purchases/gifts/use each advance one player turn and their authored integer game-minute cost. Costs may be zero; each confirmation is still a distinct action.

The engine checks the source state's funds/items, stock, repeat rule, prerequisites, capacity, relationship bounds, hours and recipient presence. It computes the complete result on owned state. A failure changes no balance, stock receipt, quantity, relationship, milestone, discovery, time, passage visit or save history. Additional negative effects cannot partially consume an item when another effect fails. A successful transaction applies costs/effects, records one receipt, then observes completion and arbitrates required events.

Accepted W3 rules still apply: waiting stops at the first required boundary; optional stationary actions that would skip a newly required encounter reject with an instruction to wait. Pending required encounters block trade. A required event already confirmed finishes atomically before newly eligible priorities arbitrate. Completion discovery follows effects; genuine earlier observations remain remembered. An event with unpayable economic costs or impossible effects is not eligible to block the player as a required encounter.

Prerequisites, shop hours and gift presence must hold throughout an economic action, evaluated at endpoints and relevant deterministic boundaries. Effects apply at completion; they need not preserve their own preconditions afterward. There is no wall-clock scheduling or provider simulation.

## Authoring, persistence and saves

Creator supplies structured controls and readable review summaries for the complete definition, plus item/relationship predicate selectors. New reference guards explain which offer/rule/effect/prerequisite must be cleared before deleting an item, person, location, chapter, milestone or referenced event. Disabling inventory is blocked while external item/relationship predicates remain; disabling people/progression is blocked while economic rules depend on them. Edits invalidate review and consent. Missing current canonical references require explicit repair; definitions are not silently retargeted.

The extension uses existing immutable world history, compilation inputs, archives, verified backups and duplication; no SQLite migration or dependency was added. Current world writes validate canonical references against current mechanics. Retained world history may use retained canonical versions; actual historical builds validate their own exact input binding. Full-fidelity history preserves exact builds and receipts. Privacy-redacted archives preserve gameplay while intentionally changing provenance fingerprints.

The optional player save extension `state.world.economy` v1 stores currency, all item quantities (including zero), and bounded receipt counts/start times/visited chapter sets. Shop stock is derived from initial stock minus purchase counts. Validation checks versions, references, bounds, repeat/stock limits, feasible receipt timing, chapter membership and action counts. It reconstructs exact currency/item balances from initial values, economic receipts and W2 event counts using integer arithmetic with BigInt; resealing a changed balance does not bypass that check. This is logical validation, not cryptographic or exhaustive playthrough proof.

Items, money, stock and relationship values carry through chapter transitions unchanged unless an explicit event/economic effect changes them. Existing W2 milestone carry/expiry remains authored separately. Rewind, restart, autosave, manual load and deterministic replay restore their corresponding quantities and receipts. Retrying failed persistence writes the already committed session, not another purchase/gift/use.

Absent `economy` preserves accepted W1–W3/text bundle and save shapes/fingerprints. Saves remain exact-bundle-bound; changed definitions do not silently migrate older saves. Previously downloaded offline files contain their original runtime and must be re-exported to receive changes.

## MCP and publication

Use existing world read → review → separately authorized Apply for authoring. Apply binds current world/structure/mechanics, rejects stale edits and retries an identical approved operation UUID exactly once through existing transaction/receipt protections. Mutated payloads cannot reuse an old UUID.

New read-only `inspect_world_economy` accepts project ID and a supplied runtime state against the fresh current world. It validates state and returns held items, balance, local offers/remaining stock and currently applicable gift/use availability, world version and providerCalls 0. It neither executes gameplay nor changes a save. It uses existing authentication, configured-project, loopback/same-origin and request/result bounds. Changing a current definition can make an older supplied play state incompatible; inspection is not migration or certification of a whole playthrough.

Standalone HTML and static ZIP embed the same validated native runtime and definition and run after Creator shuts down, without API/provider requests. Markdown/Twee report unsupported world capabilities instead of dropping inventory rules. Authoring dialogue, approval credentials and private provider configuration are not embedded.

Limited progression diagnostics recognize economic milestone producers while over-approximating costs, presence, item/relationship gates and repeat histories. Contradictory predicates are rejected; diagnostics do not prove that all items, shops, milestones or endings can be reached. No W5/W6, crafting, equipment or combat implementation is included.
