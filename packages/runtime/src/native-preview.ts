import { z } from "zod";
import type { NativeWorld } from "./world.js";

const id = z.string().min(1).max(200);
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
}).strict();
export type NativePreviewStop = z.infer<typeof NativePreviewStopSchema>;

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
