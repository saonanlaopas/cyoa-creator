import { z } from "zod";
import { ProgressionPrerequisiteSchema } from "./world-conditions.js";
const id = z.string().trim().min(1).max(200), label = z.string().trim().min(1).max(200);
const bound = z.number().finite().min(-1_000_000_000).max(1_000_000_000).nullable();
export const JournalTriggerSchema = z.discriminatedUnion("kind", [
  ...ProgressionPrerequisiteSchema.options,
  z.object({ kind: z.literal("stat"), key: id, minimum: bound, maximum: bound }).strict(),
  z.object({ kind: z.literal("event"), eventId: id, minimum: z.number().int().min(1).max(1_000_000) }).strict(),
]);
const when = z.array(JournalTriggerSchema).max(20);
export const NativeJournalSchema = z.object({
  schemaId: z.literal("cyoa.native-journal"), schemaVersion: z.literal(1),
  character: z.array(z.object({ category: z.enum(["stat", "relationship"]), key: id, when }).strict()).max(112),
  locations: z.array(z.object({ locationId: id, when }).strict()).max(60),
  entries: z.array(z.object({ id, title: label, text: z.string().trim().min(1).max(1000), when }).strict()).max(100),
  objectives: z.array(z.object({ id, title: label, description: z.string().trim().min(1).max(1000), when, completeWhen: when }).strict()).max(60),
  mechanics: z.array(z.object({ category: z.enum(["stat", "relationship"]), key: id, label, minimum: z.number().finite(), maximum: z.number().finite(), initial: z.number().finite() }).strict()).max(112),
}).strict();
export type NativeJournal = z.infer<typeof NativeJournalSchema>;
export type JournalTrigger = z.infer<typeof JournalTriggerSchema>;
export const JournalStateSchema = z.object({ schemaVersion: z.literal(1), knownLocationIds: z.array(id).max(60), entryIds: z.array(id).max(100), revealedObjectiveIds: z.array(id).max(60), completedObjectiveIds: z.array(id).max(60) }).strict();
export type JournalState = z.infer<typeof JournalStateSchema>;
export const initialJournalState = (): JournalState => ({ schemaVersion: 1, knownLocationIds: [], entryIds: [], revealedObjectiveIds: [], completedObjectiveIds: [] });
