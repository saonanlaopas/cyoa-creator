import { assertEconomyState, economyEventReason, applyEconomyEvent } from "./economy.js";
import type { NativeEconomy } from "./economy-schema.js";
import { encounterPeoplePresent, revealPeople, assertPeopleState, peopleTimeBoundaries, presentCharacters } from "./people.js";
import { ProgressionPrerequisiteSchema, prerequisitesMet, prerequisiteContradictions, type ProgressionPrerequisite } from "./world-conditions.js";
export { ProgressionPrerequisiteSchema, prerequisitesMet, type ProgressionPrerequisite } from "./world-conditions.js";
import { z } from "zod";
import { stableFingerprint } from "./canonical.js";
import { cloneRuntimeState } from "./semantics.js";
import type { RuntimeState } from "./types.js";
import type { NativeWorld } from "./world.js";

const id = z.string().min(1).max(200), name = z.string().trim().min(1).max(200);
const minutes = z.number().int().min(0).max(52_560_000);
export const ProgressionRepeatSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("once") }).strict(),
  z.object({ kind: z.literal("repeatable"), cooldownMinutes: z.number().int().min(0).max(1440) }).strict(),
  z.object({ kind: z.literal("once-per-day") }).strict(),
  z.object({ kind: z.literal("once-per-chapter") }).strict(),
]);
const passageId = id.nullable();
export const NativeProgressionBaseSchema = z.object({
  schemaId: z.literal("cyoa.native-progression"), schemaVersion: z.literal(1),
  chapters: z.array(z.object({ id, name, final: z.boolean() }).strict()).max(20),
  initialChapterId: id.nullable(),
  milestones: z.array(z.object({ id, name }).strict()).max(100),
  initialMilestoneIds: z.array(id).max(100),
  events: z.array(z.object({ id, label: name, prerequisites: z.array(ProgressionPrerequisiteSchema).max(20),
    repeat: ProgressionRepeatSchema, visibility: z.enum(["always", "when-available"]),
    passageId, minutes: z.number().int().min(0).max(1440), milestoneIds: z.array(id).max(100),
    result: z.string().trim().min(1).max(1000),
  }).strict()).max(100),
  transitions: z.array(z.object({ id, label: name, fromChapterId: id, toChapterId: id,
    prerequisites: z.array(ProgressionPrerequisiteSchema).max(20), carryMilestoneIds: z.array(id).max(100), expireEventIds: z.array(id).max(100),
    passageId, minutes: z.number().int().min(0).max(1440), result: z.string().trim().min(1).max(1000),
  }).strict()).max(60),
}).strict();
export type NativeProgression = z.infer<typeof NativeProgressionBaseSchema>;


export interface ProgressionDiagnostic { code: string; severity: "warning"; entityId: string; message: string }
export const NativeProgressionSchema = NativeProgressionBaseSchema.superRefine((definition, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message: `progression_${message}` });
  const unique = (values: string[], valid?: Set<string>) => new Set(values).size === values.length && values.every((value) => !valid || valid.has(value));
  const chapters = new Set(definition.chapters.map((c) => c.id)), milestones = new Set(definition.milestones.map((m) => m.id)), events = new Set(definition.events.map((e) => e.id));
  for (const list of [definition.chapters, definition.milestones, definition.events, definition.transitions]) {
    if (!unique(list.map((item) => item.id)) || list.some((item) => ["__proto__", "constructor", "prototype"].includes(item.id))) fail("ids_invalid_or_duplicate");
  }
  if (definition.chapters.length ? !definition.initialChapterId || !chapters.has(definition.initialChapterId) : definition.initialChapterId !== null || definition.transitions.length) fail("initial_chapter_invalid");
  if (!unique(definition.initialMilestoneIds, milestones)) fail("initial_milestones_invalid");
  for (const item of [...definition.events, ...definition.transitions]) {
    for (const condition of item.prerequisites) {
      if (condition.kind === "chapter" && !chapters.has(condition.chapterId) || condition.kind === "milestone" && !milestones.has(condition.milestoneId)) fail(`prerequisite_reference_invalid:${item.id}`);
    }
    for (const error of prerequisiteContradictions(item.prerequisites, "fromChapterId" in item ? item.fromChapterId : undefined)) fail(`${error}:${item.id}`);
    if (definition.chapters.length && definition.chapters.every((chapter) => item.prerequisites.some((c) => c.kind === "chapter" && !c.current && c.chapterId === chapter.id))) fail(`contradictory_chapter:${item.id}`);
  }
  for (const event of definition.events) {
    if (!unique(event.milestoneIds, milestones)) fail(`event_milestones_invalid:${event.id}`);
    if (event.repeat.kind === "once-per-chapter" && !definition.chapters.length) fail(`chapter_repeat_requires_chapters:${event.id}`);
  }
  for (const transition of definition.transitions) {
    if (!chapters.has(transition.fromChapterId) || !chapters.has(transition.toChapterId) || transition.fromChapterId === transition.toChapterId
      || definition.chapters.find((c) => c.id === transition.fromChapterId)?.final) fail(`transition_chapters_invalid:${transition.id}`);
    if (!unique(transition.carryMilestoneIds, milestones) || !unique(transition.expireEventIds, events)) fail(`transition_policy_invalid:${transition.id}`);
  }
});

/** Projection intentionally drops exact authoring passage-version bindings, not gameplay rules. */
export function projectWorldProgression(value: Omit<NativeProgression, "schemaId" | "events" | "transitions"> & {
  schemaId: "cyoa.world-progression";
  events: Array<Omit<NativeProgression["events"][number], "passageId"> & { passage: { passageId: string; versionId: string } | null }>;
  transitions: Array<Omit<NativeProgression["transitions"][number], "passageId"> & { passage: { passageId: string; versionId: string } | null }>;
}): NativeProgression {
  return { ...value, schemaId: "cyoa.native-progression", events: value.events.map(({ passage, ...event }) => ({ ...event, passageId: passage?.passageId ?? null })),
    transitions: value.transitions.map(({ passage, ...transition }) => ({ ...transition, passageId: passage?.passageId ?? null })) };
}

export function progressionDiagnostics(definition: NativeProgression, initialMinutes: number, economy?: NativeEconomy): ProgressionDiagnostic[] {
  const findings: ProgressionDiagnostic[] = [];
  const add = (code: string, entityId: string, message: string) => findings.push({ code, severity: "warning", entityId, message });
  // Over-approximation: ignore negative, time and location constraints. Failure to reach is a warning, never a proof about all play paths.
  const chapters = new Set(definition.initialChapterId ? [definition.initialChapterId] : []), milestones = new Set(definition.initialMilestoneIds);
  const possible = (conditions: ProgressionPrerequisite[]) => conditions.every((c) => c.kind === "chapter" && c.current ? chapters.has(c.chapterId)
    : c.kind === "milestone" && c.achieved ? milestones.has(c.milestoneId) : true);
  let changed = true;
  while (changed) {
    const size = chapters.size + milestones.size;
    for (const event of definition.events) if (possible(event.prerequisites)) for (const id of event.milestoneIds) milestones.add(id);
    for (const event of definition.events) if (possible(event.prerequisites)) for (const id of economy?.eventEffects.find((r) => r.eventId === event.id)?.effects.milestoneIds ?? []) milestones.add(id);
    for (const rule of [...(economy?.gifts ?? []), ...(economy?.uses ?? [])]) if (possible(rule.prerequisites)) for (const id of rule.effects.milestoneIds) milestones.add(id);
    for (const transition of definition.transitions) if (chapters.has(transition.fromChapterId) && possible(transition.prerequisites)) chapters.add(transition.toChapterId);
    changed = size !== chapters.size + milestones.size;
  }
  for (const chapter of definition.chapters) {
    if (!chapters.has(chapter.id)) add("progression.chapter-may-be-unreachable", chapter.id, "No route to this chapter was found by limited prerequisite analysis.");
    if (!chapter.final && !definition.transitions.some((t) => t.fromChapterId === chapter.id && possible(t.prerequisites))) add("progression.potential-progression-trap", chapter.id, "This non-final chapter has no potentially satisfiable authored exit. Inspect its transition prerequisites.");
  }
  for (const milestone of definition.milestones) if (!milestones.has(milestone.id)) add("progression.milestone-may-be-unobtainable", milestone.id, "No reachable authored producer was found; prerequisite cycles can block progression.");
  for (const event of definition.events) if (event.prerequisites.some((c) => c.kind === "time" && c.until !== null && c.until <= initialMinutes)) add("progression.time-window-past", event.id, "This opportunity's time window ends at or before the initial game time.");
  for (const transition of definition.transitions) {
    const required = [...definition.events, ...definition.transitions].flatMap((item) => item.prerequisites.filter((c) => c.kind === "milestone" && c.achieved).map((c) => (c as Extract<ProgressionPrerequisite, { kind: "milestone" }>).milestoneId));
    if (required.some((id) => !transition.carryMilestoneIds.includes(id))) add("progression.transition-may-drop-prerequisite", transition.id, "This transition can expire milestones used by prerequisites. Check whether later opportunities can restore them.");
  }
  return findings.sort((a, b) => a.code.localeCompare(b.code) || a.entityId.localeCompare(b.entityId));
}

const ledger = z.object({ count: z.number().int().min(1).max(1_000_000), lastMinutes: minutes,
  chapterIds: z.array(id).max(20) }).strict();
export const ProgressionStateSchema = z.object({ schemaVersion: z.literal(1), chapterId: id.nullable(), milestones: z.array(id).max(100),
  knownEventIds: z.array(id).max(100), events: z.record(ledger).refine((r) => Object.keys(r).length <= 100), expiredEventIds: z.array(id).max(100),
  transitions: z.record(z.number().int().min(1).max(1_000_000)).refine((r) => Object.keys(r).length <= 60),
}).strict();
export type ProgressionState = z.infer<typeof ProgressionStateSchema>;
export const initialProgressionState = (definition: NativeProgression): ProgressionState => ({ schemaVersion: 1,
  chapterId: definition.initialChapterId, milestones: [...definition.initialMilestoneIds].sort(), knownEventIds: [], events: {}, expiredEventIds: [], transitions: {} });

/** Call only on an owned/new state. Discovery is remembered on initialization and committed actions, never by preview. */
export function revealProgressionEvents(world: NativeWorld, state: Pick<RuntimeState, "world"> & Partial<Pick<RuntimeState, "relationships">>): void {
  revealPeople(world, state);
  const progression = state.world?.progression;
  if (!world.progression || !progression) return;
  progression.knownEventIds = [...new Set([...progression.knownEventIds, ...world.progression.events.filter((event) => event.visibility === "always" || !progression.expiredEventIds.includes(event.id) && prerequisitesMet(event.prerequisites, state) && encounterPeoplePresent(world, state, event.id)).map((event) => event.id)])].sort();
}
function baseEventAvailability(world: NativeWorld, state: RuntimeState, eventId: string): { visible: boolean; enabled: boolean; reason: string | null } {
  const event = world.progression?.events.find((e) => e.id === eventId), progress = state.world?.progression;
  if (!event || !progress || !state.world) return { visible: false, enabled: false, reason: "Progression unavailable" };
  const previous = Object.hasOwn(progress.events, event.id) ? progress.events[event.id] : undefined;
  let reason: string | null = null;
  if (progress.expiredEventIds.includes(event.id)) reason = "Expired";
  else if (event.repeat.kind === "once" && previous) reason = "Completed";
  else if (!prerequisitesMet(event.prerequisites, state)) reason = "Prerequisites not met";
  else if (!encounterPeoplePresent(world, state, event.id)) reason = "Encounter unavailable";
  else if (event.repeat.kind === "once-per-chapter" && previous?.chapterIds.includes(progress.chapterId!)) reason = "Already played in this chapter";
  else if (event.repeat.kind === "once-per-day" && previous && Math.floor(previous.lastMinutes / 1440) === Math.floor(state.world.minutes / 1440)) reason = "Already played today";
  else if (event.repeat.kind === "repeatable" && previous && state.world.minutes - previous.lastMinutes < event.repeat.cooldownMinutes) reason = "Cooldown has not elapsed";
  else if (world.economy) reason = economyEventReason(world, state, event.id);
  return { visible: progress.knownEventIds.includes(event.id) || event.visibility === "always" || reason === null || Boolean(previous), enabled: reason === null, reason };
}
export function assertProgressionState(world: NativeWorld, state: RuntimeState): void {
  const definition = world.progression, progress = state.world?.progression;
  if (Boolean(definition) !== Boolean(progress)) throw new Error("progression_state_presence_invalid");
  if (!definition || !progress || !state.world) return;
  ProgressionStateSchema.parse(progress);
  if (!world.locations.some((l) => l.id === state.world!.locationId && l.passageId) || !Number.isSafeInteger(state.world.minutes) || state.world.minutes < world.initialMinutes || state.world.minutes > 52_560_000 || state.turn > 1_000_000) throw new Error("progression_world_state_invalid");
  const mapped = world.locations.find((l) => l.passageId === state.currentPassageId);
  if (mapped && mapped.id !== state.world.locationId) throw new Error("progression_location_state_invalid");
  const chapterIds = new Set(definition.chapters.map((c) => c.id)), milestoneIds = new Set(definition.milestones.map((m) => m.id)), eventIds = new Set(definition.events.map((e) => e.id));
  const validSet = (values: string[], allowed: Set<string>) => new Set(values).size === values.length && values.every((id) => allowed.has(id));
  if (chapterIds.size ? !progress.chapterId || !chapterIds.has(progress.chapterId) : progress.chapterId !== null) throw new Error("progression_chapter_state_invalid");
  if (!validSet(progress.milestones, milestoneIds) || !validSet(progress.expiredEventIds, eventIds) || !validSet(progress.knownEventIds, eventIds)) throw new Error("progression_state_reference_invalid");
  if (definition.events.some((event) => (event.visibility === "always" || !progress.expiredEventIds.includes(event.id) && prerequisitesMet(event.prerequisites, state) && encounterPeoplePresent(world, state, event.id) || Object.hasOwn(progress.events, event.id)) && !progress.knownEventIds.includes(event.id))) throw new Error("progression_discovery_state_invalid");
  let actions = 0;
  const possibleMilestones = new Set(definition.initialMilestoneIds), expired = new Set<string>();
  const balance = new Map(definition.chapters.map((c) => [c.id, c.id === definition.initialChapterId ? 1 : 0]));
  for (const [id, count] of Object.entries(progress.transitions)) {
    const transition = definition.transitions.find((t) => t.id === id);
    if (!transition) throw new Error("progression_transition_state_invalid");
    actions += count;
    balance.set(transition.fromChapterId, balance.get(transition.fromChapterId)! - count);
    balance.set(transition.toChapterId, balance.get(transition.toChapterId)! + count);
    for (const eventId of transition.expireEventIds) expired.add(eventId);
  }
  for (const [id, value] of balance) if (value !== (id === progress.chapterId ? 1 : 0)) throw new Error("progression_chapter_history_invalid");
  const visitedChapters = new Set(definition.initialChapterId ? [definition.initialChapterId] : []);
  for (let pass = 0; pass < definition.chapters.length; pass++) for (const transition of definition.transitions) if (Object.hasOwn(progress.transitions, transition.id) && visitedChapters.has(transition.fromChapterId)) visitedChapters.add(transition.toChapterId);
  if (definition.transitions.some((t) => Object.hasOwn(progress.transitions, t.id) && !visitedChapters.has(t.fromChapterId))) throw new Error("progression_chapter_history_invalid");
  if (expired.size !== progress.expiredEventIds.length || progress.expiredEventIds.some((id) => !expired.has(id))) throw new Error("progression_expiry_history_invalid");
  for (const [id, record] of Object.entries(progress.events)) {
    const event = definition.events.find((e) => e.id === id);
    if (!event || record.lastMinutes < world.initialMinutes || record.lastMinutes > state.world.minutes || !validSet(record.chapterIds, chapterIds)
      || record.chapterIds.some((id) => !visitedChapters.has(id)) || record.chapterIds.length > record.count || event.repeat.kind === "once" && record.count !== 1
      || event.repeat.kind === "once-per-chapter" && record.count !== record.chapterIds.length
      || event.repeat.kind === "once-per-day" && record.count > Math.floor(state.world.minutes / 1440) - Math.floor(world.initialMinutes / 1440) + 1) throw new Error("progression_event_history_invalid");
    actions += record.count;
    for (const id of event.milestoneIds) possibleMilestones.add(id);
  }
  for (const r of [...(world.economy?.gifts ?? []), ...(world.economy?.uses ?? [])]) if (state.world.economy && Object.hasOwn(state.world.economy.receipts, r.id)) for (const id of r.effects.milestoneIds) possibleMilestones.add(id);
  for (const r of world.economy?.eventEffects ?? []) if (Object.hasOwn(progress.events, r.eventId)) for (const id of r.effects.milestoneIds) possibleMilestones.add(id);
  if (actions > state.turn || progress.milestones.some((id) => !possibleMilestones.has(id))) throw new Error("progression_history_invalid");
}
export interface ChapterTransitionPreview {
  transitionId: string; fromChapter: string; toChapter: string;
  carriedMilestones: Array<{ id: string; name: string }>;
  expiredMilestones: Array<{ id: string; name: string }>;
  lostOpportunities: Array<{ id: string; label: string; reason: string; permanent: boolean }>;
  fingerprint: string;
}
export function previewChapterTransition(world: NativeWorld, state: RuntimeState, transitionId: string): ChapterTransitionPreview {
  assertProgressionState(world, state);
  assertPeopleState(world, state);
  assertEconomyState(world, state);
  const definition = world.progression, progress = state.world?.progression;
  const transition = definition?.transitions.find((t) => t.id === transitionId);
  if (!definition || !progress || !state.world || !transition || progress.chapterId !== transition.fromChapterId || !prerequisitesMet(transition.prerequisites, state)) throw new Error("chapter_transition_unavailable");
  const minutes = state.world.minutes + transition.minutes;
  if (minutes > 52_560_000) throw new Error("world_time_limit_reached");
  const next = cloneRuntimeState(state), nextProgress = next.world!.progression!;
  next.world!.minutes = minutes; nextProgress.chapterId = transition.toChapterId;
  nextProgress.milestones = progress.milestones.filter((id) => transition.carryMilestoneIds.includes(id));
  nextProgress.expiredEventIds = [...new Set([...progress.expiredEventIds, ...transition.expireEventIds])].sort();
  // An authored transition passage may enter a mapped location; preview that same location before evaluating losses.
  const location = world.locations.find((l) => l.passageId && l.passageId === transition.passageId);
  if (location) next.world!.locationId = location.id;
  const lostOpportunities: ChapterTransitionPreview["lostOpportunities"] = [];
  for (const event of definition.events) {
    const record = Object.hasOwn(progress.events, event.id) ? progress.events[event.id] : undefined;
    if (progress.expiredEventIds.includes(event.id) || event.repeat.kind === "once" && record) continue;
    const known = progress.knownEventIds.includes(event.id);
    if (!known) continue;
    if (transition.expireEventIds.includes(event.id)) lostOpportunities.push({ id: event.id, label: event.label, reason: "Authored expiry at this transition", permanent: true });
    else if (event.prerequisites.some((condition) => prerequisitesMet([condition], state) && !prerequisitesMet([condition], next))) lostOpportunities.push({ id: event.id, label: event.label, reason: "A prerequisite is lost at this transition", permanent: false });
    else if (baseEventAvailability(world, state, event.id).enabled && !baseEventAvailability(world, next, event.id).enabled) lostOpportunities.push({ id: event.id, label: event.label, reason: encounterPeoplePresent(world, next, event.id) ? "Repeat rule prevents replay in the destination chapter" : "Encounter is no longer available", permanent: false });
  }
  const preview = { transitionId, fromChapter: definition.chapters.find((c) => c.id === transition.fromChapterId)!.name,
    toChapter: definition.chapters.find((c) => c.id === transition.toChapterId)!.name,
    carriedMilestones: definition.milestones.filter((m) => progress.milestones.includes(m.id) && transition.carryMilestoneIds.includes(m.id)),
    expiredMilestones: definition.milestones.filter((m) => progress.milestones.includes(m.id) && !transition.carryMilestoneIds.includes(m.id)), lostOpportunities };
  return { ...preview, fingerprint: stableFingerprint({ definition, ...(world.people ? { people: world.people } : {}), ...(world.economy ? { economy: world.economy } : {}), state, preview }) };
}
export type ProgressionCommand = { kind: "event"; id: string } | { kind: "chapter-transition"; id: string; previewFingerprint: string };
export function transitionProgressionWorld(world: NativeWorld, state: RuntimeState, command: ProgressionCommand): { state: RuntimeState; message: string; passageId?: string } {
  assertProgressionState(world, state);
  assertPeopleState(world, state);
  assertEconomyState(world, state);
  assertWorldActionAllowed(world, state, command.kind === "event" ? command.id : undefined);
  const definition = world.progression, progress = state.world?.progression;
  if (!definition || !progress || !state.world) throw new Error("progression_unavailable");
  const item = command.kind === "event" ? definition.events.find((e) => e.id === command.id) : definition.transitions.find((t) => t.id === command.id);
  if (!item) throw new Error("progression_action_unavailable");
  if (command.kind === "event") {
    if (!progressionEventAvailability(world, state, command.id).enabled) throw new Error("progression_event_unavailable");
  } else if (previewChapterTransition(world, state, command.id).fingerprint !== command.previewFingerprint) throw new Error("chapter_transition_preview_stale");
  const minutes = state.world.minutes + item.minutes;
  if (!Number.isSafeInteger(minutes) || minutes > 52_560_000) throw new Error("world_time_limit_reached");
  const destination = world.locations.find((l) => l.passageId && l.passageId === item.passageId);
  let next = (world.people || world.economy) && (!destination || destination.id === state.world.locationId) ? advancePeopleTime(world, state, minutes, false, command.kind === "event" ? command.id : undefined) : cloneRuntimeState(state);
  const nextProgress = next.world!.progression!;
  next.world!.minutes = minutes;
  if (command.kind === "event") {
    const event = item as NativeProgression["events"][number], old = Object.hasOwn(progress.events, event.id) ? progress.events[event.id] : undefined;
    nextProgress.events[event.id] = { count: (old?.count ?? 0) + 1, lastMinutes: state.world.minutes,
      chapterIds: [...new Set([...(old?.chapterIds ?? []), ...(progress.chapterId ? [progress.chapterId] : [])])].sort() };
    nextProgress.milestones = [...new Set([...progress.milestones, ...event.milestoneIds])].sort();
  } else {
    const transition = item as NativeProgression["transitions"][number];
    nextProgress.chapterId = transition.toChapterId;
    nextProgress.milestones = progress.milestones.filter((id) => transition.carryMilestoneIds.includes(id));
    nextProgress.expiredEventIds = [...new Set([...progress.expiredEventIds, ...transition.expireEventIds])].sort();
    nextProgress.transitions[transition.id] = (Object.hasOwn(progress.transitions, transition.id) ? progress.transitions[transition.id]! : 0) + 1;
  }
  const location = world.locations.find((l) => l.passageId && l.passageId === item.passageId);
  if (location) next.world!.locationId = location.id;
  if (command.kind === "event") next = applyEconomyEvent(world, next, command.id);
  revealProgressionEvents(world, next);
  if (mandatoryEventStatus(world, next).conflict) throw new Error("people_mandatory_priority_conflict");
  return { state: next, message: item.result, ...(item.passageId ? { passageId: item.passageId } : {}) };
}

export function mandatoryEventStatus(world: NativeWorld, state: RuntimeState, ignore: Set<string> = new Set()): { eventId: string | null; conflict: boolean } {
  const candidates = world.people?.events.filter((r) => r.mandatory && !ignore.has(r.eventId) && baseEventAvailability(world, state, r.eventId).enabled).sort((a, b) => b.priority - a.priority || (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0)) ?? [];
  if (!candidates.length) return { eventId: null, conflict: false };
  const conflict = candidates[1]?.priority === candidates[0]!.priority;
  return { eventId: conflict ? null : candidates[0]!.eventId, conflict };
}
export function assertWorldActionAllowed(world: NativeWorld, state: RuntimeState, eventId?: string): void {
  const pending = mandatoryEventStatus(world, state);
  if (pending.conflict) throw new Error("people_mandatory_priority_conflict");
  if (pending.eventId && pending.eventId !== eventId) throw new Error("people_mandatory_event_pending");
}
export function progressionEventAvailability(world: NativeWorld, state: RuntimeState, eventId: string) {
  const availability = baseEventAvailability(world, state, eventId);
  if (!availability.enabled || !world.people) return availability;
  const pending = mandatoryEventStatus(world, state);
  return pending.conflict ? { ...availability, enabled: false, reason: "Competing required encounters; author must resolve priorities" }
    : pending.eventId && pending.eventId !== eventId ? { ...availability, enabled: false, reason: "Complete the required encounter first" } : availability;
}
/** Confirmed required encounters finish atomically; only waits may stop partway. */
export function advancePeopleTime(world: NativeWorld, state: RuntimeState, end: number, waiting: boolean, completingEventId?: string): RuntimeState {
  const next = cloneRuntimeState(state);
  if (!world.people && !world.economy) { next.world!.minutes = end; return next; }
  const alreadyAvailable = new Set((world.people?.events ?? []).filter((r) => r.mandatory && baseEventAvailability(world, state, r.eventId).enabled).map((r) => r.eventId));
  const completingMandatory = !waiting && completingEventId !== undefined && mandatoryEventStatus(world, state).eventId === completingEventId;
  for (const minute of peopleTimeBoundaries(world, state, end)) {
    next.world!.minutes = minute;
    if (minute === end && !waiting) continue; // Effects commit at completion before final arbitration.
    revealProgressionEvents(world, next);
    if (completingMandatory) continue; // New encounters arbitrate after this confirmed encounter's effects.
    const pending = mandatoryEventStatus(world, next, alreadyAvailable);
    if (pending.conflict) throw new Error("people_mandatory_priority_conflict");
    if (pending.eventId) {
      if (waiting) return next;
      throw new Error("people_required_encounter_boundary_use_wait");
    }
  }
  return next;
}
export function inspectWorldPresence(world: NativeWorld, state: RuntimeState) {
  assertProgressionState(world, state); assertPeopleState(world, state); assertEconomyState(world, state);
  const pending = mandatoryEventStatus(world, state);
  return { present: presentCharacters(world, state), encounters: (world.progression?.events ?? [])
    .map((e) => ({ id: e.id, label: e.label, ...progressionEventAvailability(world, state, e.id) })).filter((e) => e.visible), mandatory: pending };
}
