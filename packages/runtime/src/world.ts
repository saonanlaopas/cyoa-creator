import { NativePeopleSchema, PeopleStateSchema, validatePeopleReferences, assertPeopleState } from "./people.js";
import { z } from "zod";
import { NativeProgressionSchema, ProgressionStateSchema, initialProgressionState, revealProgressionEvents, transitionProgressionWorld, type ProgressionCommand, assertWorldActionAllowed, advancePeopleTime, mandatoryEventStatus } from "./progression.js";
import { IllustratedPresentationSchema } from "./illustrated-scenes.js";
import { cloneRuntimeState } from "./semantics.js";
import type { RuntimeState } from "./types.js";

const id = z.string().min(1).max(200), label = z.string().min(1).max(200);
export const WorldStateSchema = z.object({ schemaVersion: z.literal(1), locationId: id,
  progression: ProgressionStateSchema.optional(), people: PeopleStateSchema.optional(),
  minutes: z.number().int().min(0).max(52_560_000), stationaryTurns: z.number().int().min(0).max(1_000_000).optional() }).strict();
export const NativeWorldSchema = z.object({
  schemaId: z.literal("cyoa.native-world"), schemaVersion: z.literal(1),
  progression: NativeProgressionSchema.optional(), people: NativePeopleSchema.optional(),
  startLocationId: id, initialMinutes: z.number().int().min(0).max(52_560_000),
  waitMinutes: z.array(z.number().int().min(1).max(1440)).min(1).max(6),
  locations: z.array(z.object({ id, name: label, parentId: id.nullable(), passageId: id.nullable(), mapImage: id.nullable(),
    marker: z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) }).strict().nullable(),
    hours: z.object({ opens: z.number().int().min(0).max(1439), closes: z.number().int().min(0).max(1439) }).strict().nullable(),
  }).strict()).min(1).max(60),
  connections: z.array(z.object({ id, from: id, to: id, minutes: z.number().int().min(0).max(1440) }).strict()).max(100),
  actions: z.array(z.object({ id, locationId: id, label, minutes: z.number().int().min(0).max(1440), result: z.string().min(1).max(1000) }).strict()).max(100),
  assets: IllustratedPresentationSchema.shape.assets,
}).strict().superRefine((world, ctx) => {
  if (world.people) { try { validatePeopleReferences(world.people, world.progression, world.locations); } catch (e) { ctx.addIssue({ code: "custom", message: (e as Error).message }); } }
  const fail = () => ctx.addIssue({ code: "custom", message: "world_definition_invalid" });
  const locations = new Map(world.locations.map((l) => [l.id, l]));
  for (const list of [world.locations, world.connections, world.actions, world.assets]) if (new Set(list.map((x) => x.id)).size !== list.length) fail();
  const passages = world.locations.flatMap((l) => l.passageId ? [l.passageId] : []);
  if (new Set(passages).size !== passages.length || new Set(world.waitMinutes).size !== world.waitMinutes.length || !locations.get(world.startLocationId)?.passageId) fail();
  const used = new Set<string>();
  for (const l of world.locations) {
    if (l.parentId && !locations.has(l.parentId) || l.marker && !l.parentId || l.hours && l.hours.opens === l.hours.closes) fail();
    const seen = new Set([l.id]); let parent = l.parentId;
    while (parent && locations.has(parent)) { if (seen.has(parent)) { fail(); break; } seen.add(parent); parent = locations.get(parent)!.parentId; }
    if (l.mapImage) { used.add(l.mapImage); if (!world.assets.some((a) => a.id === l.mapImage)) fail(); }
  }
  if (world.assets.some((a) => !used.has(a.id))) fail();
  for (const c of world.connections) if (c.from === c.to || !locations.get(c.from)?.passageId || !locations.get(c.to)?.passageId) fail();
  for (const a of world.actions) if (!locations.get(a.locationId)?.passageId) fail();
  for (const item of [...(world.progression?.events ?? []), ...(world.progression?.transitions ?? [])]) {
    for (const condition of item.prerequisites) if (condition.kind === "location" && !locations.get(condition.locationId)?.passageId) fail();
    if (world.locations.filter((l) => l.passageId).every((l) => item.prerequisites.some((c) => c.kind === "location" && !c.present && c.locationId === l.id))) ctx.addIssue({ code: "custom", message: `progression_contradictory_location:${item.id}` });
  }
});
export type NativeWorld = z.infer<typeof NativeWorldSchema>;
export type WorldCommand = ProgressionCommand | { kind: "travel"; id: string } | { kind: "action"; id: string } | { kind: "wait"; minutes: number };
export function initialWorldState(world: NativeWorld): NonNullable<RuntimeState["world"]> {
  const state: NonNullable<RuntimeState["world"]> = { schemaVersion: 1, locationId: world.startLocationId, minutes: world.initialMinutes, ...(world.progression ? { progression: initialProgressionState(world.progression) } : {}), ...(world.people ? { people: { schemaVersion: 1 as const, knownCharacterIds: [] } } : {}) };
  revealProgressionEvents(world, { world: state });
  return state;
}
export function worldClock(minutes: number): string {
  return `Day ${Math.floor(minutes / 1440) + 1} · ${String(Math.floor(minutes % 1440 / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
export function worldLocationOpen(world: NativeWorld, locationId: string, minutes: number): boolean {
  let location = world.locations.find((l) => l.id === locationId);
  const seen = new Set<string>();
  while (location) {
    if (seen.has(location.id)) return false;
    seen.add(location.id);
    const h = location.hours, t = minutes % 1440;
    if (h && !(h.opens < h.closes ? t >= h.opens && t < h.closes : t >= h.opens || t < h.closes)) return false;
    location = world.locations.find((l) => l.id === location!.parentId);
  }
  return true;
}
export function transitionWorld(world: NativeWorld, state: RuntimeState, command: WorldCommand): { state: RuntimeState; message: string; passageId?: string } {
  if (!state.world) throw new Error("world_state_missing");
  assertPeopleState(world, state);
  assertWorldActionAllowed(world, state, command.kind === "event" ? command.id : undefined);
  if (command.kind === "event" || command.kind === "chapter-transition") return transitionProgressionWorld(world, state, command);
  let destination = state.world.locationId, minutes: number, message: string;
  if (command.kind === "travel") {
    const connection = world.connections.find((c) => c.id === command.id && c.from === destination);
    if (!connection) throw new Error("world_connection_unavailable");
    destination = connection.to; minutes = connection.minutes;
    message = `Arrived at ${world.locations.find((l) => l.id === destination)!.name}.`;
  } else if (command.kind === "action") {
    const action = world.actions.find((a) => a.id === command.id && a.locationId === destination);
    if (!action) throw new Error("world_action_unavailable");
    minutes = action.minutes; message = action.result;
  } else if (command.kind === "wait") {
    if (!world.waitMinutes.includes(command.minutes)) throw new Error("world_wait_duration_unavailable");
    minutes = command.minutes; message = `Waited ${minutes} minutes.`;
  } else throw new Error("world_command_invalid");
  const nextMinutes = state.world.minutes + minutes;
  if (!Number.isSafeInteger(nextMinutes) || nextMinutes > 52_560_000) throw new Error("world_time_limit_reached");
  if (command.kind === "travel" && !worldLocationOpen(world, destination, nextMinutes)) throw new Error("world_destination_closed_at_arrival");
  const next = command.kind === "travel" ? cloneRuntimeState(state) : advancePeopleTime(world, state, nextMinutes, command.kind === "wait");
  next.world = { ...next.world!, locationId: destination, minutes: command.kind === "travel" ? nextMinutes : next.world!.minutes };
  if (command.kind === "wait" && next.world.minutes !== nextMinutes) message = `Waited ${next.world.minutes - state.world.minutes} minutes. A required encounter is available.`;
  revealProgressionEvents(world, next);
  if (mandatoryEventStatus(world, next).conflict) throw new Error("people_mandatory_priority_conflict");
  return { state: next, message, ...(command.kind === "travel" ? { passageId: world.locations.find((l) => l.id === destination)!.passageId! } : {}) };
}
