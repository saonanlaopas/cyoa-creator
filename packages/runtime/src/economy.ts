import { NativeEconomySchema, EconomyStateSchema, type NativeEconomy, type EconomyState } from "./economy-schema.js";
import { prerequisitesMet, prerequisiteContradictions, type ProgressionPrerequisite } from "./world-conditions.js";
import { assertProgressionState, advancePeopleTime, assertWorldActionAllowed, mandatoryEventStatus, revealProgressionEvents, type NativeProgression } from "./progression.js";
import { assertPeopleState, characterLocation, peopleTimeBoundaries, type NativePeople } from "./people.js";
import { cloneRuntimeState } from "./semantics.js";
import type { RuntimeState } from "./types.js";
import type { NativeWorld } from "./world.js";

export type EconomyCommand = { kind: "purchase"; id: string } | { kind: "gift"; id: string } | { kind: "use"; id: string };
type Effects = NativeEconomy["uses"][number]["effects"];
type Costs = NativeEconomy["eventEffects"][number]["costs"];
export const projectWorldEconomy = (value: Omit<NativeEconomy, "schemaId" | "relationships"> & { schemaId: "cyoa.world-economy" }, relationships: NativeEconomy["relationships"]): NativeEconomy => ({
  ...value, schemaId: "cyoa.native-economy", relationships: relationships.map(({ key, minimum, maximum, initial }) => ({ key, minimum, maximum, initial })),
});
const reserved = (id: string) => ["__proto__", "constructor", "prototype"].includes(id);
const distinct = (ids: string[]) => new Set(ids).size === ids.length;
const unique = (ids: string[]) => distinct(ids) && !ids.some(reserved);
export function economyConditions(e: NativeEconomy | undefined, p?: NativeProgression, people?: NativePeople): ProgressionPrerequisite[] {
  return [...(p?.events ?? []), ...(p?.transitions ?? []), ...(people?.overrides ?? []), ...(e?.shops.flatMap((s) => s.offers) ?? []), ...(e?.gifts ?? []), ...(e?.uses ?? [])].flatMap((r) => r.prerequisites);
}
export function validateEconomyReferences(value: NativeEconomy | undefined, p: NativeProgression | undefined, people: NativePeople | undefined, locations: Array<{ id: string; passageId: string | null }>): void {
  const conditions = economyConditions(value, p, people);
  if (!value) { if (conditions.some((c) => c.kind === "item" || c.kind === "relationship")) throw new Error("economy_extension_required"); return; }
  const e = NativeEconomySchema.parse(value), playable = new Set(locations.filter((l) => l.passageId).map((l) => l.id));
  const chapters = new Set(p?.chapters.map((c) => c.id)), milestones = new Set(p?.milestones.map((m) => m.id));
  if (!unique(e.items.map((i) => i.id)) || !unique(e.shops.map((s) => s.id)) || !distinct(e.relationships.map((r) => r.key))
    || !unique([...e.shops.flatMap((s) => s.offers), ...e.gifts, ...e.uses].map((r) => r.id)) || !unique(e.eventEffects.map((r) => r.eventId))) throw new Error("economy_ids_invalid_or_duplicate");
  if (e.currency.initial > e.currency.maximum || e.items.some((i) => i.initial > i.maximum)
    || e.relationships.some((r) => r.minimum > r.maximum || r.initial < r.minimum || r.initial > r.maximum)) throw new Error("economy_initial_or_bounds_invalid");
  const item = (id: string, quantity = 0) => { const i = e.items.find((i) => i.id === id); if (!i || quantity > i.maximum) throw new Error("economy_item_reference_or_quantity_invalid:" + id); return i; };
  for (const c of conditions) {
    if (c.kind === "item") { const i = item(c.itemId); if (c.minimum > i.maximum || c.maximum !== null && c.minimum > c.maximum) throw new Error("economy_item_condition_invalid"); }
    if (c.kind === "relationship") { const r = e.relationships.find((r) => r.key === c.key); if (!r || (c.minimum === null && c.maximum === null) || Math.max(c.minimum ?? -Infinity, r.minimum) > Math.min(c.maximum ?? Infinity, r.maximum)) throw new Error("economy_relationship_condition_invalid:" + c.key); }
  }
  const effects = (f: Effects) => {
    if (!unique(f.items.map((i) => i.itemId)) || !distinct(f.relationships.map((r) => r.key)) || !unique(f.milestoneIds)) throw new Error("economy_effect_duplicates");
    f.items.forEach((i) => item(i.itemId));
    if (f.relationships.some((r) => !e.relationships.some((d) => d.key === r.key)) || f.milestoneIds.some((id) => !milestones.has(id))) throw new Error("economy_effect_reference_invalid");
  };
  for (const s of e.shops) {
    if (!playable.has(s.locationId) || s.hours && s.hours.opens === s.hours.closes) throw new Error("economy_shop_location_or_hours_invalid");
    for (const o of s.offers) item(o.itemId, o.quantity);
  }
  for (const r of [...e.gifts, ...e.uses]) {
    const i = item(r.itemId, r.quantity); effects(r.effects);
    if ("characterId" in r ? !people?.characters.some((c) => c.id === r.characterId) : !i.consumable) throw new Error("economy_gift_or_consumable_invalid");
    if (r.repeat.kind === "once-per-chapter" && !chapters.size) throw new Error("economy_repeat_requires_chapters");
  }
  for (const r of e.eventEffects) {
    if (!p?.events.some((v) => v.id === r.eventId)) throw new Error("economy_event_reference_invalid");
    if (!unique(r.costs.items.map((i) => i.itemId))) throw new Error("economy_cost_duplicates");
    r.costs.items.forEach((i) => item(i.itemId, i.quantity)); effects(r.effects);
  }
  for (const r of [...e.shops.flatMap((s) => s.offers), ...e.gifts, ...e.uses]) {
    if (prerequisiteContradictions(r.prerequisites).length) throw new Error("economy_contradictory_prerequisites:" + r.id);
    for (const c of r.prerequisites) if (c.kind === "chapter" && !chapters.has(c.chapterId) || c.kind === "milestone" && !milestones.has(c.milestoneId) || c.kind === "location" && !playable.has(c.locationId)) throw new Error("economy_prerequisite_reference_invalid");
    if (chapters.size && [...chapters].every((id) => r.prerequisites.some((c) => c.kind === "chapter" && !c.current && c.chapterId === id))
      || [...playable].every((id) => r.prerequisites.some((c) => c.kind === "location" && !c.present && c.locationId === id))) throw new Error("economy_contradictory_prerequisites:" + r.id);
  }
}
export const initialEconomyState = (e: NativeEconomy): EconomyState => ({ schemaVersion: 1, currency: e.currency.initial, items: Object.fromEntries(e.items.map((i) => [i.id, i.initial])), receipts: {} });
const emptyEffects = (): Effects => ({ currency: 0, items: [], relationships: [], milestoneIds: [] });
function transaction(world: NativeWorld, state: RuntimeState, costs: Costs, effects: Effects): RuntimeState {
  const e = world.economy, v = state.world?.economy;
  if (!e || !v) throw new Error("economy_state_missing");
  if (v.currency < costs.currency || costs.items.some((i) => !Object.hasOwn(v.items, i.itemId) || v.items[i.itemId]! < i.quantity)) throw new Error("Insufficient funds or items");
  const next = cloneRuntimeState(state), target = next.world!.economy!;
  target.currency += effects.currency - costs.currency;
  if (!Number.isSafeInteger(target.currency) || target.currency < 0 || target.currency > e.currency.maximum) throw new Error("Currency result is outside authored bounds");
  for (const c of costs.items) target.items[c.itemId]! -= c.quantity;
  for (const i of effects.items) target.items[i.itemId]! += i.delta;
  if (e.items.some((i) => !Number.isSafeInteger(target.items[i.id]) || target.items[i.id]! < 0 || target.items[i.id]! > i.maximum)) throw new Error("Item result is outside authored bounds");
  for (const r of effects.relationships) {
    const d = e.relationships.find((d) => d.key === r.key), before = Object.hasOwn(next.relationships, r.key) ? next.relationships[r.key] : undefined;
    if (!d || before === undefined || !Number.isFinite(before + r.delta) || before + r.delta < d.minimum || before + r.delta > d.maximum) throw new Error("Relationship result is outside authored bounds");
    next.relationships[r.key] = before + r.delta;
  }
  if (effects.milestoneIds.length) {
    if (!next.world!.progression) throw new Error("economy_progression_required");
    next.world!.progression!.milestones = [...new Set([...next.world!.progression!.milestones, ...effects.milestoneIds])].sort();
  }
  return next;
}
export function economyEventReason(world: NativeWorld, state: RuntimeState, eventId: string): string | null {
  const r = world.economy?.eventEffects.find((r) => r.eventId === eventId);
  if (!r) return null;
  try { transaction(world, state, r.costs, r.effects); return null; } catch (e) { return (e as Error).message; }
}
export function applyEconomyEvent(world: NativeWorld, state: RuntimeState, eventId: string): RuntimeState {
  const r = world.economy?.eventEffects.find((r) => r.eventId === eventId);
  return r ? transaction(world, state, r.costs, r.effects) : state;
}
const previous = (state: RuntimeState, id: string) => state.world?.economy && Object.hasOwn(state.world.economy.receipts, id) ? state.world.economy.receipts[id] : undefined;
function ruleFor(world: NativeWorld, command: EconomyCommand) {
  const e = world.economy;
  const shop = command.kind === "purchase" ? e?.shops.find((s) => s.offers.some((o) => o.id === command.id)) : undefined;
  const rule = command.kind === "purchase" ? shop?.offers.find((o) => o.id === command.id) : command.kind === "gift" ? e?.gifts.find((r) => r.id === command.id) : e?.uses.find((r) => r.id === command.id);
  if (!rule) throw new Error("Economy action unavailable");
  return { shop, rule, costs: { currency: "price" in rule ? rule.price : 0, items: "price" in rule ? [] : [{ itemId: rule.itemId, quantity: rule.quantity }] },
    effects: "price" in rule ? { ...emptyEffects(), items: [{ itemId: rule.itemId, delta: rule.quantity }] } : rule.effects,
    message: "result" in rule ? rule.result : "Purchase completed." };
}
function open(hours: { opens: number; closes: number } | null, minute: number): boolean {
  if (!hours) return true; const t = minute % 1440;
  return hours.opens < hours.closes ? t >= hours.opens && t < hours.closes : t >= hours.opens || t < hours.closes;
}
function repeatReason(rule: NativeEconomy["uses"][number], state: RuntimeState): string | null {
  const old = previous(state, rule.id); if (!old) return null;
  if (rule.repeat.kind === "once") return "Already completed";
  if (rule.repeat.kind === "once-per-chapter" && old.chapterIds.includes(state.world!.progression!.chapterId!)) return "Already completed in this chapter";
  if (rule.repeat.kind === "once-per-day" && Math.floor(old.lastMinutes / 1440) === Math.floor(state.world!.minutes / 1440)) return "Already completed today";
  if (rule.repeat.kind === "repeatable" && state.world!.minutes - old.lastMinutes < rule.repeat.cooldownMinutes) return "Cooldown has not elapsed";
  return null;
}
function prepare(world: NativeWorld, state: RuntimeState, command: EconomyCommand): { state: RuntimeState; message: string } {
  assertWorldActionAllowed(world, state);
  const { shop, rule, costs, effects, message } = ruleFor(world, command), start = state.world!.minutes, end = start + rule.minutes;
  if (end > 52_560_000) throw new Error("world_time_limit_reached");
  if (!prerequisitesMet(rule.prerequisites, state)) throw new Error("Prerequisites not met");
  if ("repeat" in rule) { const reason = repeatReason(rule, state); if (reason) throw new Error(reason); }
  if ("stock" in rule && (previous(state, rule.id)?.count ?? 0) >= rule.stock) throw new Error("Out of stock");
  transaction(world, state, costs, effects); // Costs must exist before effects, including a refund/reward.
  const next = advancePeopleTime(world, state, end, false), times = new Set([start, end, ...peopleTimeBoundaries(world, state, end)]);
  const locations: NativeWorld["locations"] = [];
  if (shop) {
    if (shop.locationId !== state.world!.locationId) throw new Error("Shop is at another location");
    let l = world.locations.find((l) => l.id === shop.locationId);
    while (l) { locations.push(l); l = world.locations.find((v) => v.id === l!.parentId); }
    for (let day = Math.floor(start / 1440); day <= Math.floor(end / 1440); day++) for (const h of [shop.hours, ...locations.map((l) => l.hours)]) if (h) for (const t of [day * 1440 + h.opens, day * 1440 + h.closes]) if (t >= start && t <= end) times.add(t);
  }
  for (const minute of times) {
    const at = { ...state, world: { ...state.world!, minutes: minute } };
    if (shop && (!open(shop.hours, minute) || locations.some((l) => !open(l.hours, minute)))) throw new Error("Shop is closed during this purchase");
    if ("characterId" in rule && typeof rule.characterId === "string" && characterLocation(world, at, rule.characterId) !== state.world!.locationId) throw new Error("Recipient unavailable during this gift");
    if (!prerequisitesMet(rule.prerequisites, at)) throw new Error("Prerequisites do not hold throughout this action");
  }
  const result = transaction(world, next, costs, effects), old = previous(state, rule.id);
  result.world!.economy!.receipts[rule.id] = { count: (old?.count ?? 0) + 1, lastMinutes: start, chapterIds: [...new Set([...(old?.chapterIds ?? []), ...(state.world!.progression?.chapterId ? [state.world!.progression!.chapterId!] : [])])].sort() };
  if (result.world!.economy!.receipts[rule.id]!.count > 1_000_000) throw new Error("economy_receipt_limit");
  revealProgressionEvents(world, result);
  if (mandatoryEventStatus(world, result).conflict) throw new Error("people_mandatory_priority_conflict");
  return { state: result, message };
}
export function economyActionAvailability(world: NativeWorld, state: RuntimeState, command: EconomyCommand): { enabled: boolean; reason: string | null } {
  try { prepare(world, state, command); return { enabled: true, reason: null }; } catch (e) { const message = (e as Error).message; const reason = message.includes("boundary_use_wait") ? "Wait for the required encounter before this action" : message.startsWith("people_mandatory") ? "Complete the required encounter first" : message === "world_time_limit_reached" ? "Game time limit reached" : message; return { enabled: false, reason }; }
}
export function transitionEconomyWorld(world: NativeWorld, state: RuntimeState, command: EconomyCommand) { assertProgressionState(world, state); assertPeopleState(world, state); assertEconomyState(world, state); return prepare(world, state, command); }
export function assertEconomyState(world: NativeWorld, state: RuntimeState): void {
  const e = world.economy, value = state.world?.economy;
  if (Boolean(e) !== Boolean(value)) throw new Error("economy_state_presence_invalid");
  if (!e || !value) return;
  if (!world.locations.some((l) => l.id === state.world!.locationId && l.passageId) || !Number.isSafeInteger(state.world!.minutes)
    || state.world!.minutes < world.initialMinutes || state.world!.minutes > 52_560_000 || state.turn > 1_000_000) throw new Error("economy_world_state_invalid");
  const mapped = world.locations.find((l) => l.passageId === state.currentPassageId);
  if (mapped && mapped.id !== state.world!.locationId) throw new Error("economy_location_state_invalid");
  const v = EconomyStateSchema.parse(value), keys = Object.keys(v.items);
  if (keys.length !== e.items.length || keys.some((id) => !e.items.some((i) => i.id === id)) || v.currency > e.currency.maximum
    || Object.keys(state.relationships).length !== e.relationships.length || e.items.some((i) => v.items[i.id]! > i.maximum) || e.relationships.some((r) => !Object.hasOwn(state.relationships, r.key) || !Number.isFinite(state.relationships[r.key]) || state.relationships[r.key]! < r.minimum || state.relationships[r.key]! > r.maximum)) throw new Error("economy_state_bounds_invalid");
  let actions = 0, money = BigInt(e.currency.initial);
  const amounts = new Map(e.items.map((i) => [i.id, BigInt(i.initial)]));
  const add = (count: number, costs: Costs, effects: Effects) => { money += BigInt(count) * BigInt(effects.currency - costs.currency); for (const c of costs.items) amounts.set(c.itemId, amounts.get(c.itemId)! - BigInt(count) * BigInt(c.quantity)); for (const i of effects.items) amounts.set(i.itemId, amounts.get(i.itemId)! + BigInt(count) * BigInt(i.delta)); };
  const chapterIds = new Set(world.progression?.chapters.map((c) => c.id));
  const visited = new Set(world.progression?.initialChapterId ? [world.progression.initialChapterId] : []);
  for (const t of world.progression?.transitions ?? []) if (state.world?.progression && Object.hasOwn(state.world.progression.transitions, t.id)) { visited.add(t.fromChapterId); visited.add(t.toChapterId); }
  for (const [id, receipt] of Object.entries(v.receipts)) {
    const kind = e.shops.some((s) => s.offers.some((r) => r.id === id)) ? "purchase" : e.gifts.some((r) => r.id === id) ? "gift" : "use";
    const { rule, costs, effects } = ruleFor(world, { kind, id });
    if (receipt.lastMinutes < world.initialMinutes || receipt.lastMinutes + rule.minutes > state.world!.minutes || new Set(receipt.chapterIds).size !== receipt.chapterIds.length
      || receipt.chapterIds.some((id) => !chapterIds.has(id) || !visited.has(id)) || chapterIds.size && !receipt.chapterIds.length || receipt.chapterIds.length > receipt.count || "stock" in rule && receipt.count > rule.stock
      || "repeat" in rule && (rule.repeat.kind === "once" && receipt.count !== 1 || rule.repeat.kind === "once-per-chapter" && receipt.count !== receipt.chapterIds.length
        || rule.repeat.kind === "once-per-day" && receipt.count > Math.floor(receipt.lastMinutes / 1440) - Math.floor(world.initialMinutes / 1440) + 1
        || rule.repeat.kind === "repeatable" && rule.repeat.cooldownMinutes > 0 && receipt.count > Math.floor((receipt.lastMinutes - world.initialMinutes) / rule.repeat.cooldownMinutes) + 1)) throw new Error("economy_receipt_invalid");
    actions += receipt.count; add(receipt.count, costs, effects);
  }
  for (const r of e.eventEffects) { const progress = state.world?.progression; const count = progress && Object.hasOwn(progress.events, r.eventId) ? progress.events[r.eventId]!.count : 0; if (count) add(count, r.costs, r.effects); }
  const progress = state.world?.progression;
  if (progress) actions += Object.values(progress.events).reduce((n, r) => n + r.count, 0) + Object.values(progress.transitions).reduce((n, v) => n + v, 0);
  if (actions > state.turn || money !== BigInt(v.currency) || e.items.some((i) => amounts.get(i.id) !== BigInt(v.items[i.id]!))) throw new Error("economy_balance_history_invalid");
}
export function inspectWorldEconomy(world: NativeWorld, state: RuntimeState) {
  assertProgressionState(world, state); assertPeopleState(world, state); assertEconomyState(world, state);
  if (!world.economy || !state.world?.economy) throw new Error("economy_world_required");
  return { currency: { name: world.economy.currency.name, amount: state.world.economy.currency }, items: world.economy.items.filter((i) => state.world!.economy!.items[i.id]! > 0).map((i) => ({ id: i.id, name: i.name, quantity: state.world!.economy!.items[i.id]! })),
    shops: world.economy.shops.filter((s) => s.locationId === state.world!.locationId).map((s) => ({ id: s.id, name: s.name, offers: s.offers.map((r) => ({ id: r.id, itemId: r.itemId, quantity: r.quantity, price: r.price, stock: r.stock - (previous(state, r.id)?.count ?? 0), ...economyActionAvailability(world, state, { kind: "purchase", id: r.id }) })) })),
    gifts: world.economy.gifts.filter((r) => characterLocation(world, state, r.characterId) === state.world!.locationId).map((r) => ({ id: r.id, label: r.label, ...economyActionAvailability(world, state, { kind: "gift", id: r.id }) })),
    uses: world.economy.uses.filter((r) => state.world!.economy!.items[r.itemId]! > 0).map((r) => ({ id: r.id, label: r.label, ...economyActionAvailability(world, state, { kind: "use", id: r.id }) })) };
}
