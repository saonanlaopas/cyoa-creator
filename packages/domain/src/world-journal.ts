import { z } from "zod";
import { WorldPrerequisiteSchema } from "./world-progression.js";
const id = z.string().trim().min(1).max(200), label = z.string().trim().min(1).max(200);
const bound = z.number().finite().min(-1_000_000_000).max(1_000_000_000).nullable();
export const WorldJournalTriggerSchema = z.discriminatedUnion("kind", [
  ...WorldPrerequisiteSchema.options,
  z.object({ kind: z.literal("stat"), key: id, minimum: bound, maximum: bound }).strict(),
  z.object({ kind: z.literal("event"), eventId: id, minimum: z.number().int().min(1).max(1_000_000) }).strict(),
]);
const when = z.array(WorldJournalTriggerSchema).max(20);
export const WorldJournalSchema = z.object({
  schemaId: z.literal("cyoa.world-journal"), schemaVersion: z.literal(1),
  character: z.array(z.object({ category: z.enum(["stat", "relationship"]), key: id, when }).strict()).max(112),
  locations: z.array(z.object({ locationId: id, when }).strict()).max(60),
  entries: z.array(z.object({ id, title: label, text: z.string().trim().min(1).max(1000), when }).strict()).max(100),
  objectives: z.array(z.object({ id, title: label, description: z.string().trim().min(1).max(1000), when, completeWhen: when }).strict()).max(60),

}).strict();
export type WorldJournal = z.infer<typeof WorldJournalSchema>;
export type WorldJournalTrigger = z.infer<typeof WorldJournalTriggerSchema>;
export const emptyWorldJournal = (): WorldJournal => ({ schemaId: "cyoa.world-journal", schemaVersion: 1, character: [], locations: [], entries: [], objectives: [] });
