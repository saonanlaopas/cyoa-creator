import { z } from "zod";

const id = z.string().min(1).max(200), name = z.string().trim().min(1).max(200);
const minutes = z.number().int().min(0).max(52_560_000);
export const WorldPrerequisiteSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("chapter"), chapterId: id, current: z.boolean() }).strict(),
  z.object({ kind: z.literal("milestone"), milestoneId: id, achieved: z.boolean() }).strict(),
  z.object({ kind: z.literal("location"), locationId: id, present: z.boolean() }).strict(),
  z.object({ kind: z.literal("time"), from: minutes.nullable(), until: minutes.nullable() }).strict(),
  z.object({ kind: z.literal("item"), itemId: id, minimum: z.number().int().min(0).max(10000), maximum: z.number().int().min(0).max(10000).nullable() }).strict(),
  z.object({ kind: z.literal("relationship"), key: id, minimum: z.number().finite().min(-1_000_000_000).max(1_000_000_000).nullable(), maximum: z.number().finite().min(-1_000_000_000).max(1_000_000_000).nullable() }).strict(),
]);
export const WorldEventRepeatSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("once") }).strict(),
  z.object({ kind: z.literal("repeatable"), cooldownMinutes: z.number().int().min(0).max(1440) }).strict(),
  z.object({ kind: z.literal("once-per-day") }).strict(),
  z.object({ kind: z.literal("once-per-chapter") }).strict(),
]);
const passage = z.object({ passageId: id, versionId: id }).strict().nullable();
export const WorldProgressionSchema = z.object({
  schemaId: z.literal("cyoa.world-progression"), schemaVersion: z.literal(1),
  chapters: z.array(z.object({ id, name, final: z.boolean() }).strict()).max(20),
  initialChapterId: id.nullable(),
  milestones: z.array(z.object({ id, name }).strict()).max(100),
  initialMilestoneIds: z.array(id).max(100),
  events: z.array(z.object({ id, label: name, prerequisites: z.array(WorldPrerequisiteSchema).max(20),
    repeat: WorldEventRepeatSchema, visibility: z.enum(["always", "when-available"]),
    passage, minutes: z.number().int().min(0).max(1440), milestoneIds: z.array(id).max(100),
    result: z.string().trim().min(1).max(1000),
  }).strict()).max(100),
  transitions: z.array(z.object({ id, label: name, fromChapterId: id, toChapterId: id,
    prerequisites: z.array(WorldPrerequisiteSchema).max(20), carryMilestoneIds: z.array(id).max(100), expireEventIds: z.array(id).max(100),
    passage, minutes: z.number().int().min(0).max(1440), result: z.string().trim().min(1).max(1000),
  }).strict()).max(60),
}).strict();
export type WorldProgression = z.infer<typeof WorldProgressionSchema>;
export const emptyWorldProgression = (): WorldProgression => ({ schemaId: "cyoa.world-progression", schemaVersion: 1,
  chapters: [], initialChapterId: null, milestones: [], initialMilestoneIds: [], events: [], transitions: [] });
