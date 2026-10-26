import { z } from "zod";
import type { RuntimeState } from "./types.js";
const id = z.string().min(1).max(200), minutes = z.number().int().min(0).max(52_560_000);
export const ProgressionPrerequisiteSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("chapter"), chapterId: id, current: z.boolean() }).strict(),
  z.object({ kind: z.literal("milestone"), milestoneId: id, achieved: z.boolean() }).strict(),
  z.object({ kind: z.literal("location"), locationId: id, present: z.boolean() }).strict(),
  z.object({ kind: z.literal("time"), from: minutes.nullable(), until: minutes.nullable() }).strict(),
]);
export type ProgressionPrerequisite = z.infer<typeof ProgressionPrerequisiteSchema>;
export function prerequisiteContradictions(conditions: ProgressionPrerequisite[], chapter?: string): string[] {
  const errors: string[] = [], positive = new Map<string, string>(), negatives = new Map<string, Set<string>>();
  const milestones = new Map<string, boolean>();
  if (chapter) positive.set("chapter", chapter);
  let from = 0, until = 52_560_001;
  for (const condition of conditions) {
    if (condition.kind === "time") {
      if (condition.from === null && condition.until === null) errors.push("empty_time_condition");
      from = Math.max(from, condition.from ?? 0); until = Math.min(until, condition.until ?? 52_560_001);
    } else if (condition.kind === "milestone") {
      if (milestones.has(condition.milestoneId) && milestones.get(condition.milestoneId) !== condition.achieved) errors.push("contradictory_milestone");
      milestones.set(condition.milestoneId, condition.achieved);
    } else {
      const key = condition.kind, value = condition.kind === "chapter" ? condition.chapterId : condition.locationId;
      const required = condition.kind === "chapter" ? condition.current : condition.present;
      if (required) { if (positive.has(key) && positive.get(key) !== value) errors.push(`contradictory_${key}`); positive.set(key, value); }
      else { const set = negatives.get(key) ?? new Set(); set.add(value); negatives.set(key, set); }
    }
  }
  for (const [key, value] of positive) if (negatives.get(key)?.has(value)) errors.push(`contradictory_${key}`);
  if (from >= until) errors.push("contradictory_time_interval");
  return [...new Set(errors)];
}
export function prerequisitesMet(conditions: ProgressionPrerequisite[], state: Pick<RuntimeState, "world">): boolean {
  return conditions.every((condition) => {
    const world = state.world, progression = world?.progression;
    if (condition.kind === "chapter") return Boolean(progression) && (progression!.chapterId === condition.chapterId) === condition.current;
    if (condition.kind === "milestone") return Boolean(progression) && progression!.milestones.includes(condition.milestoneId) === condition.achieved;
    if (condition.kind === "location") return Boolean(world) && (world!.locationId === condition.locationId) === condition.present;
    return Boolean(world) && world!.minutes >= (condition.from ?? 0) && world!.minutes < (condition.until ?? 52_560_001);
  });
}
