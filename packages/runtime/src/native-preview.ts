import { z } from "zod";
import type { NativeWorld, WorldCommand } from "./world.js";
import type { RuntimeState } from "./types.js";

const id = z.string().min(1).max(200);
export const PlaytestExclusionSchema = z.object({
  kind: z.enum(["choice", "travel", "action", "wait", "event", "chapter-transition", "purchase", "gift", "use"]),
  id,
  presentation: z.enum(["disabled", "hidden"]),
}).strict();
export type PlaytestExclusion = z.infer<typeof PlaytestExclusionSchema>;
export const PlaytestRestrictionSchema = PlaytestExclusionSchema.extend({
  sourcePassageId: id.optional(),
  sourceLocationId: id.optional(),
  sourceChapterId: id.optional(),
}).strict();
export type PlaytestRestriction = z.infer<typeof PlaytestRestrictionSchema>;
export const playtestActionKey = (command: Pick<PlaytestExclusion, "kind" | "id">) => `${command.kind}:${command.id}`;
export const OUTSIDE_PLAYTEST = "Outside this preview";
const worldCommand = z.object({
  kind: z.enum(["travel", "action", "event", "chapter-transition", "purchase", "gift", "use"]),
  id,
  destinationPassageId: id.nullable(),
}).strict();
export const NativePreviewStopSchema = z.object({
  stopPassageId: id,
  suppressedChoices: z.array(z.object({ id, destinationPassageId: id }).strict()).max(100),
  suppressedWorldCommands: z.array(z.union([
    worldCommand, z.object({ kind: z.literal("wait"), minutes: z.number().int().min(1).max(1440) }).strict(),
  ])).max(10_000),
  playtest: z.object({
    boundaryFingerprint: z.string().regex(/^[a-f0-9]{32}$/),
    restrictions: z.array(PlaytestRestrictionSchema).max(100),
  }).strict().optional(),
}).strict();
export type NativePreviewStop = z.infer<typeof NativePreviewStopSchema>;

export function assertPlaytestCommand(preview: NativePreviewStop | undefined, command: WorldCommand | { kind: "choice"; id: string }): void {
  const id = command.kind === "wait" ? String(command.minutes) : command.id;
  if (preview?.playtest?.restrictions.some(item => item.kind === command.kind && item.id === id)) throw new Error(OUTSIDE_PLAYTEST);
}

export function visiblePlaytestRestrictions(preview: NativePreviewStop | undefined, state: RuntimeState, choices: boolean) {
  return (preview?.playtest?.restrictions ?? []).filter(item => item.presentation === "disabled" && (item.kind === "choice") === choices
    && (!item.sourcePassageId || item.sourcePassageId === state.currentPassageId)
    && (!item.sourceLocationId || item.sourceLocationId === state.world?.locationId)
    && (!item.sourceChapterId || item.sourceChapterId === state.world?.progression?.chapterId));
}

// This is a static list of blocked dispatches, not a claim about conditional availability.
export function previewWorldSuppressions(world?: NativeWorld): NativePreviewStop["suppressedWorldCommands"] {
  if (!world) return [];
  const locations = new Map(world.locations.map(location => [location.id, location.passageId]));
  return [
    ...world.connections.map(item => ({ kind: "travel" as const, id: item.id, destinationPassageId: locations.get(item.to) ?? null })),
    ...world.actions.map(item => ({ kind: "action" as const, id: item.id, destinationPassageId: null })),
    ...world.waitMinutes.map(minutes => ({ kind: "wait" as const, minutes })),
    ...(world.progression?.events ?? []).map(item => ({ kind: "event" as const, id: item.id, destinationPassageId: item.passageId })),
    ...(world.progression?.transitions ?? []).map(item => ({ kind: "chapter-transition" as const, id: item.id, destinationPassageId: item.passageId })),
    ...(world.economy?.shops ?? []).flatMap(shop => shop.offers.map(item => ({ kind: "purchase" as const, id: item.id, destinationPassageId: null }))),
    ...(world.economy?.gifts ?? []).map(item => ({ kind: "gift" as const, id: item.id, destinationPassageId: null })),
    ...(world.economy?.uses ?? []).map(item => ({ kind: "use" as const, id: item.id, destinationPassageId: null })),
  ];
}
