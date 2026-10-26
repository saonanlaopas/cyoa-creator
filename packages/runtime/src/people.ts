import { z } from "zod";
import { ProgressionPrerequisiteSchema, prerequisiteContradictions, prerequisitesMet } from "./world-conditions.js";
import type { RuntimeState } from "./types.js";
import type { NativeWorld } from "./world.js";
import type { NativeProgression } from "./progression.js";
const id = z.string().min(1).max(200);
export const NativePeopleSchema = z.object({
  schemaId: z.literal("cyoa.native-people"), schemaVersion: z.literal(1),
  characters: z.array(z.object({ id, name: z.string().trim().min(1).max(200) }).strict()).max(30),
  schedules: z.array(z.object({ id, characterId: id, locationId: id, days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    from: z.number().int().min(0).max(1439), until: z.number().int().min(0).max(1440) }).strict()).max(200),
  overrides: z.array(z.object({ id, characterId: id, locationId: id.nullable(), priority: z.number().int().min(-1000).max(1000), prerequisites: z.array(ProgressionPrerequisiteSchema).max(20) }).strict()).max(100),
  events: z.array(z.object({ eventId: id, priority: z.number().int().min(-1000).max(1000), mandatory: z.boolean(), characterIds: z.array(id).max(30) }).strict()).max(100),
}).strict();
export type NativePeople = z.infer<typeof NativePeopleSchema>;
export const PeopleStateSchema = z.object({ schemaVersion: z.literal(1), knownCharacterIds: z.array(id).max(30) }).strict();
export type PeopleState = z.infer<typeof PeopleStateSchema>;
export const projectWorldPeople = (value: Omit<NativePeople, "schemaId"> & { schemaId: "cyoa.world-people" }): NativePeople => ({ ...value, schemaId: "cyoa.native-people" });
const weekday = (day: number) => (day % 7 + 7) % 7;
function intervals(slot: NativePeople["schedules"][number]) {
  return slot.days.flatMap((day) => {
    const start = day * 1440 + slot.from, end = day * 1440 + slot.until + (slot.until <= slot.from ? 1440 : 0);
    return end > 10080 ? [[start, 10080], [0, end - 10080]] : [[start, end]];
  });
}
/** Shared by direct persistence and published-world validation; ties are conservatively rejected. */
export function validatePeopleReferences(peopleValue: NativePeople, progression: NativeProgression | undefined, locations: Array<{ id: string; passageId: string | null }>): void {
  const p = NativePeopleSchema.parse(peopleValue), characters = new Set(p.characters.map((c) => c.id)), playable = new Set(locations.filter((l) => l.passageId).map((l) => l.id));
  const chapters = new Set(progression?.chapters.map((c) => c.id)), milestones = new Set(progression?.milestones.map((m) => m.id));
  for (const values of [p.characters.map((c) => c.id), p.schedules.map((s) => s.id), p.overrides.map((o) => o.id), p.events.map((e) => e.eventId)]) {
    if (new Set(values).size !== values.length || values.some((v) => ["__proto__", "constructor", "prototype"].includes(v))) throw new Error("people_ids_invalid_or_duplicate");
  }
  for (const slot of p.schedules) if (!characters.has(slot.characterId) || !playable.has(slot.locationId) || slot.from === slot.until || new Set(slot.days).size !== slot.days.length) throw new Error(`people_schedule_invalid:${slot.id}`);
  for (let i = 0; i < p.schedules.length; i++) for (const other of p.schedules.slice(i + 1)) {
    const slot = p.schedules[i]!;
    if (slot.characterId === other.characterId && intervals(slot).some(([a, b]) => intervals(other).some(([c, d]) => a! < d! && c! < b!))) throw new Error(`people_schedule_overlap:${slot.id}:${other.id}`);
  }
  for (const override of p.overrides) {
    if (!characters.has(override.characterId) || override.locationId !== null && !playable.has(override.locationId)) throw new Error(`people_override_reference_invalid:${override.id}`);
    if (prerequisiteContradictions(override.prerequisites).length) throw new Error(`people_override_contradictory:${override.id}`);
    for (const c of override.prerequisites) if (c.kind === "chapter" && !chapters.has(c.chapterId) || c.kind === "milestone" && !milestones.has(c.milestoneId) || c.kind === "location" && !playable.has(c.locationId)) throw new Error(`people_override_condition_reference_invalid:${override.id}`);
    if (chapters.size && [...chapters].every((id) => override.prerequisites.some((c) => c.kind === "chapter" && !c.current && c.chapterId === id)) || [...playable].every((id) => override.prerequisites.some((c) => c.kind === "location" && !c.present && c.locationId === id))) throw new Error(`people_override_contradictory:${override.id}`);
  }
  for (let i = 0; i < p.overrides.length; i++) for (const other of p.overrides.slice(i + 1)) {
    const o = p.overrides[i]!;
    if (o.characterId === other.characterId && o.priority === other.priority && !prerequisiteContradictions([...o.prerequisites, ...other.prerequisites]).length) throw new Error(`people_override_priority_conflict:${o.id}:${other.id}`);
  }
  const events = progression?.events ?? [];
  if (events.length !== p.events.length || p.events.some((r) => !events.some((e) => e.id === r.eventId))) throw new Error("people_event_rules_must_cover_events");
  for (const rule of p.events) {
    if (new Set(rule.characterIds).size !== rule.characterIds.length || rule.characterIds.some((id) => !characters.has(id))) throw new Error(`people_encounter_character_invalid:${rule.eventId}`);
    const event = events.find((e) => e.id === rule.eventId)!;
    if (rule.mandatory && event.repeat.kind === "repeatable" && event.repeat.cooldownMinutes === 0) throw new Error(`people_mandatory_requires_repeat_gap:${rule.eventId}`);
  }
  for (let i = 0; i < p.events.length; i++) for (const other of p.events.slice(i + 1)) {
    const r = p.events[i]!;
    if (r.mandatory && other.mandatory && r.priority === other.priority && !prerequisiteContradictions([...events.find((e) => e.id === r.eventId)!.prerequisites, ...events.find((e) => e.id === other.eventId)!.prerequisites]).length) throw new Error(`people_mandatory_priority_conflict:${r.eventId}:${other.eventId}`);
  }
}
export function characterLocation(world: NativeWorld, state: Pick<RuntimeState, "world">, characterId: string): string | null {
  const p = world.people, w = state.world;
  if (!p || !w) return null;
  const overrides = p.overrides.filter((o) => o.characterId === characterId && prerequisitesMet(o.prerequisites, state)).sort((a, b) => b.priority - a.priority);
  if (overrides.length) {
    if (overrides[1]?.priority === overrides[0]!.priority) throw new Error("people_override_priority_conflict");
    return overrides[0]!.locationId;
  }
  const day = Math.floor(w.minutes / 1440);
  const active = p.schedules.filter((s) => s.characterId === characterId && [day - 1, day].some((d) => s.days.includes(weekday(d)) && w.minutes >= d * 1440 + s.from && w.minutes < d * 1440 + s.until + (s.until <= s.from ? 1440 : 0)));
  if (active.length > 1) throw new Error("people_schedule_overlap");
  return active[0]?.locationId ?? null;
}
/** Player-safe projection: no off-site people, future destinations, override conditions or timetable. */
export function presentCharacters(world: NativeWorld, state: Pick<RuntimeState, "world">): Array<{ id: string; name: string }> {
  return world.people?.characters.filter((c) => characterLocation(world, state, c.id) === state.world?.locationId).map(({ id, name }) => ({ id, name })) ?? [];
}
export function encounterPeoplePresent(world: NativeWorld, state: Pick<RuntimeState, "world">, eventId: string): boolean {
  return world.people?.events.find((r) => r.eventId === eventId)?.characterIds.every((id) => characterLocation(world, state, id) === state.world?.locationId) ?? true;
}
export function revealPeople(world: NativeWorld, state: Pick<RuntimeState, "world">): void {
  if (state.world?.people) state.world.people.knownCharacterIds = [...new Set([...state.world.people.knownCharacterIds, ...presentCharacters(world, state).map((c) => c.id)])].sort();
}
export function assertPeopleState(world: NativeWorld, state: RuntimeState): void {
  if (Boolean(world.people) !== Boolean(state.world?.people)) throw new Error("people_state_presence_invalid");
  if (!world.people || !state.world?.people) return;
  if (!world.locations.some((l) => l.id === state.world!.locationId && l.passageId) || !Number.isSafeInteger(state.world.minutes) || state.world.minutes < world.initialMinutes || state.world.minutes > 52_560_000 || state.turn > 1_000_000) throw new Error("people_world_state_invalid");
  const p = PeopleStateSchema.parse(state.world.people), ids = new Set(world.people.characters.map((c) => c.id));
  if (new Set(p.knownCharacterIds).size !== p.knownCharacterIds.length || p.knownCharacterIds.some((id) => !ids.has(id)) || presentCharacters(world, state).some((c) => !p.knownCharacterIds.includes(c.id))) throw new Error("people_discovery_state_invalid");
}
/** Costs are bounded to a day. Include recurring windows, midnight, conditions and cooldown expiry. */
export function peopleTimeBoundaries(world: NativeWorld, state: RuntimeState, end: number): number[] {
  if (!state.world || !Number.isSafeInteger(end) || end < state.world.minutes || end > 52_560_000 || end - state.world.minutes > 1440) throw new Error("people_time_range_invalid");
  const start = state.world!.minutes, times = new Set<number>([end]);
  const add = (value: number) => { if (value > start && value <= end) times.add(value); };
  for (let day = Math.floor(start / 1440) - 1; day <= Math.floor(end / 1440); day++) {
    add((day + 1) * 1440);
    for (const slot of world.people?.schedules ?? []) if (slot.days.includes(weekday(day))) { add(day * 1440 + slot.from); add(day * 1440 + slot.until + (slot.until <= slot.from ? 1440 : 0)); }
  }
  for (const item of [...(world.people?.overrides ?? []), ...(world.progression?.events ?? [])]) for (const c of item.prerequisites) if (c.kind === "time") { if (c.from !== null) add(c.from); if (c.until !== null) add(c.until); }
  for (const event of world.progression?.events ?? []) if (event.repeat.kind === "repeatable" && state.world?.progression && Object.hasOwn(state.world.progression.events, event.id)) add(state.world.progression.events[event.id]!.lastMinutes + event.repeat.cooldownMinutes);
  return [...times].sort((a, b) => a - b);
}

export function peopleDiagnostics(people: NativePeople, progression?: NativeProgression) {
  return people.events.flatMap((rule) => {
    const event = progression?.events.find((e) => e.id === rule.eventId);
    const immediate = event?.repeat.kind === "repeatable" ? event.minutes >= event.repeat.cooldownMinutes : event?.repeat.kind === "once-per-day" && event.minutes >= 1440;
    return rule.mandatory && immediate ? [{ code: "people.mandatory-may-repeat-immediately", severity: "warning" as const, entityId: rule.eventId,
      message: "This required encounter can become repeatable again during its own cost. Inspect prerequisites and presence effects for a possible progression trap; this check is not exhaustive." }] : [];
  });
}
