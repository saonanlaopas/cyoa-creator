import { z } from "zod";
import { WorldPrerequisiteSchema } from "./world-progression.js";
const id = z.string().min(1).max(200);
export const WorldPeopleSchema = z.object({
  schemaId: z.literal("cyoa.world-people"), schemaVersion: z.literal(1),
  characters: z.array(z.object({ id, name: z.string().trim().min(1).max(200) }).strict()).max(30),
  schedules: z.array(z.object({ id, characterId: id, locationId: id,
    days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    from: z.number().int().min(0).max(1439), until: z.number().int().min(0).max(1440),
  }).strict()).max(200),
  overrides: z.array(z.object({ id, characterId: id, locationId: id.nullable(), priority: z.number().int().min(-1000).max(1000),
    prerequisites: z.array(WorldPrerequisiteSchema).max(20) }).strict()).max(100),
  events: z.array(z.object({ eventId: id, priority: z.number().int().min(-1000).max(1000), mandatory: z.boolean(), characterIds: z.array(id).max(30) }).strict()).max(100),
}).strict();
export type WorldPeople = z.infer<typeof WorldPeopleSchema>;
export const emptyWorldPeople = (): WorldPeople => ({ schemaId: "cyoa.world-people", schemaVersion: 1, characters: [], schedules: [], overrides: [], events: [] });
