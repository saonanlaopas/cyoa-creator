import { z } from "zod";
import { MechanicsSchema } from "./mechanics.js";
import { PassageIdSchema, PassageSchema } from "./passage.js";

export const ProjectIdSchema = z.string().min(1).brand<"ProjectId">();

export const ProjectSchema = z.object({
  id: ProjectIdSchema,
  name: z.string().min(1),
  schemaVersion: z.number().int().positive().default(1),
  startPassageId: PassageIdSchema,
  passages: z.array(PassageSchema),
  mechanics: MechanicsSchema,
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type Project = z.infer<typeof ProjectSchema>;
export type ProjectId = z.infer<typeof ProjectIdSchema>;
