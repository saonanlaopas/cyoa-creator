import { NativeJournalSchema, JournalStateSchema, type NativeJournal, type JournalTrigger, type JournalState } from "./journal-schema.js";
import { prerequisitesMet, prerequisiteContradictions, type ProgressionPrerequisite } from "./world-conditions.js";
import type { RuntimeState } from "./types.js";
import type { NativeWorld } from "./world.js";

type Observation = Pick<RuntimeState, "world"> & Partial<Pick<RuntimeState, "stats" | "relationships">>;
export type JournalMechanics = { visibleStats: Array<{ key: string; label: string; minimum: number; maximum: number; initial: number }>; relationships: Array<{ key: string; label: string; minimum: number; maximum: number; initial: number }> };
export const projectWorldJournal = (value: Omit<NativeJournal, "schemaId" | "mechanics"> & { schemaId: "cyoa.world-journal" }, mechanics: JournalMechanics): NativeJournal => ({
  ...value, schemaId: "cyoa.native-journal", mechanics: [
    ...mechanics.visibleStats.map(({ key, label, minimum, maximum, initial }) => ({ category: "stat" as const, key, label, minimum, maximum, initial })),
    ...mechanics.relationships.map(({ key, label, minimum, maximum, initial }) => ({ category: "relationship" as const, key, label, minimum, maximum, initial })),
  ],
});
export const journalConditionLists = (j: NativeJournal | undefined): JournalTrigger[][] => j ? [...j.character, ...j.locations, ...j.entries, ...j.objectives].map((r) => r.when).concat(j.objectives.map((r) => r.completeWhen)) : [];
export function journalTriggersMet(conditions: JournalTrigger[], state: Observation): boolean {
  return conditions.every((c) => {
    if (c.kind === "stat") { const v = state.stats && Object.hasOwn(state.stats, c.key) ? state.stats[c.key] : undefined; return v !== undefined && v >= (c.minimum ?? -Infinity) && v <= (c.maximum ?? Infinity); }
    if (c.kind === "event") { const events = state.world?.progression?.events; return Boolean(events && Object.hasOwn(events, c.eventId) && events[c.eventId]!.count >= c.minimum); }
    return prerequisitesMet([c], state);
  });
}
export function validateJournalReferences(world: Pick<NativeWorld, "journal" | "progression" | "economy"> & { locations: Array<{ id: string; passageId: string | null }> }): void {
  if (!world.journal) return;
  const j = NativeJournalSchema.parse(world.journal), p = world.progression;
  const unique = (ids: string[]) => new Set(ids).size === ids.length;
  if (!unique(j.mechanics.map((m) => m.category + ":" + m.key)) || !unique(j.character.map((m) => m.category + ":" + m.key)) || !unique(j.locations.map((l) => l.locationId))) throw new Error("journal_duplicate_reference");
  for (const list of [j.entries, j.objectives]) if (!unique(list.map((r) => r.id)) || list.some((r) => ["__proto__", "constructor", "prototype"].includes(r.id))) throw new Error("journal_ids_invalid_or_duplicate");
  for (const m of j.mechanics) if (m.minimum > m.maximum || m.initial < m.minimum || m.initial > m.maximum) throw new Error("journal_mechanic_bounds_invalid");
  for (const c of j.character) if (!j.mechanics.some((m) => m.key === c.key && m.category === c.category)) throw new Error("journal_character_reference_invalid:" + c.key);
  for (const r of j.locations) if (!world.locations.some((l) => l.id === r.locationId)) throw new Error("journal_location_reference_invalid:" + r.locationId);
  for (const conditions of journalConditionLists(j)) {
    const common = conditions.filter((c): c is ProgressionPrerequisite => c.kind !== "stat" && c.kind !== "event");
    if (prerequisiteContradictions(common).length) throw new Error("journal_contradictory_conditions");
    if (p?.chapters.length && p.chapters.every((v) => common.some((c) => c.kind === "chapter" && !c.current && c.chapterId === v.id)) || world.locations.filter((l) => l.passageId).every((l) => common.some((c) => c.kind === "location" && !c.present && c.locationId === l.id))) throw new Error("journal_contradictory_conditions");
    const statRanges = new Map<string, [number, number]>();
    for (const c of conditions) {
      if (c.kind === "chapter" && !p?.chapters.some((v) => v.id === c.chapterId) || c.kind === "milestone" && !p?.milestones.some((v) => v.id === c.milestoneId) || c.kind === "event" && !p?.events.some((v) => v.id === c.eventId)) throw new Error("journal_progression_reference_invalid");
      if (c.kind === "location" && !world.locations.some((l) => l.id === c.locationId && l.passageId)) throw new Error("journal_location_condition_invalid");
      if (c.kind === "item") { const i = world.economy?.items.find((i) => i.id === c.itemId); if (!i || c.minimum > i.maximum) throw new Error("journal_item_reference_invalid"); }
      if (c.kind === "stat" || c.kind === "relationship") {
        const m = j.mechanics.find((m) => m.category === c.kind && m.key === c.key);
        if (!m || c.minimum === null && c.maximum === null || Math.max(c.minimum ?? -Infinity, m.minimum) > Math.min(c.maximum ?? Infinity, m.maximum)) throw new Error("journal_mechanic_condition_invalid:" + c.key);
        if (c.kind === "stat") { const old = statRanges.get(c.key) ?? [m.minimum, m.maximum]; const range: [number, number] = [Math.max(old[0], c.minimum ?? -Infinity), Math.min(old[1], c.maximum ?? Infinity)]; if (range[0] > range[1]) throw new Error("journal_contradictory_stat"); statRanges.set(c.key, range); }
      }
    }
  }
}
/** Only call on owned state at committed observations; reads never reveal information. */
export function observeJournal(world: NativeWorld, state: Observation): void {
  const j = world.journal, s = state.world?.journal;
  if (!j || !s || !state.world) return;
  const locations = new Set(s.knownLocationIds); locations.add(state.world.locationId);
  for (const r of j.locations) if (journalTriggersMet(r.when, state)) locations.add(r.locationId);
  for (const id of [...locations]) { let l = world.locations.find((l) => l.id === id); const seen = new Set<string>(); while (l?.parentId && !seen.has(l.parentId)) { seen.add(l.parentId); locations.add(l.parentId); l = world.locations.find((p) => p.id === l!.parentId); } }
  s.knownLocationIds = [...locations].sort();
  s.entryIds = [...new Set([...s.entryIds, ...j.entries.filter((e) => journalTriggersMet(e.when, state)).map((e) => e.id)])].sort();
  s.revealedObjectiveIds = [...new Set([...s.revealedObjectiveIds, ...j.objectives.filter((o) => journalTriggersMet(o.when, state)).map((o) => o.id)])].sort();
  s.completedObjectiveIds = [...new Set([...s.completedObjectiveIds, ...j.objectives.filter((o) => s.revealedObjectiveIds.includes(o.id) && journalTriggersMet(o.completeWhen, state)).map((o) => o.id)])].sort();
}
export function assertJournalState(world: NativeWorld, state: RuntimeState): void {
  const j = world.journal, s = state.world?.journal;
  if (Boolean(j) !== Boolean(s)) throw new Error("journal_state_presence_invalid");
  if (!j || !s || !state.world) return;
  JournalStateSchema.parse(s);
  const valid = (values: string[], ids: string[]) => new Set(values).size === values.length && values.every((id) => ids.includes(id));
  if (!valid(s.knownLocationIds, world.locations.map((l) => l.id)) || !valid(s.entryIds, j.entries.map((e) => e.id)) || !valid(s.revealedObjectiveIds, j.objectives.map((o) => o.id)) || !valid(s.completedObjectiveIds, s.revealedObjectiveIds)) throw new Error("journal_state_reference_invalid");
  const mapped = world.locations.find((l) => l.passageId === state.currentPassageId);
  if (mapped && mapped.id !== state.world.locationId || !Number.isSafeInteger(state.world.minutes) || state.world.minutes > 52_560_000 || Object.keys(state.stats).length !== j.mechanics.filter((m) => m.category === "stat").length || Object.keys(state.relationships).length !== j.mechanics.filter((m) => m.category === "relationship").length || state.world.minutes < world.initialMinutes || !world.locations.some((l) => l.id === state.world!.locationId && l.passageId) || j.mechanics.some((m) => { const v = m.category === "stat" ? state.stats : state.relationships; return !Object.hasOwn(v, m.key) || !Number.isFinite(v[m.key]) || v[m.key]! < m.minimum || v[m.key]! > m.maximum; })) throw new Error("journal_state_bounds_invalid");
  const expected: JournalState = { ...s, knownLocationIds: [...s.knownLocationIds], entryIds: [...s.entryIds], revealedObjectiveIds: [...s.revealedObjectiveIds], completedObjectiveIds: [...s.completedObjectiveIds] };
  observeJournal(world, { ...state, world: { ...state.world, journal: expected } });
  if (JSON.stringify(s) !== JSON.stringify(expected)) throw new Error("journal_observation_missing");
}
/** Player-safe data only: no hidden names, conditions, future schedules, unpublished prose or values. */
export function inspectWorldJournal(world: NativeWorld, state: RuntimeState) {
  assertJournalState(world, state);
  const j = world.journal, s = state.world?.journal;
  if (!j || !s || !state.world) throw new Error("journal_world_required");
  return {
    character: j.character.filter((r) => journalTriggersMet(r.when, state)).map((r) => { const m = j.mechanics.find((m) => m.category === r.category && m.key === r.key)!; return { category: r.category, key: r.key, label: m.label, value: (r.category === "stat" ? state.stats : state.relationships)[r.key]! }; }),
    locations: world.locations.filter((l) => s.knownLocationIds.includes(l.id)).map((l) => ({ id: l.id, name: l.name })),
    entries: j.entries.filter((e) => s.entryIds.includes(e.id)).map(({ id, title, text }) => ({ id, title, text })),
    objectives: j.objectives.filter((o) => s.revealedObjectiveIds.includes(o.id) && !s.completedObjectiveIds.includes(o.id)).map(({ id, title, description }) => ({ id, title, description })),
    completedObjectives: j.objectives.filter((o) => s.completedObjectiveIds.includes(o.id)).map(({ id, title }) => ({ id, title })),
    events: (world.progression?.events ?? []).flatMap((e) => { const ledger = state.world?.progression?.events; const r = ledger && Object.hasOwn(ledger, e.id) ? ledger[e.id] : undefined; return r ? [{ id: e.id, label: e.label, result: e.result, count: r.count, lastMinutes: r.lastMinutes }] : []; }),
  };
}
