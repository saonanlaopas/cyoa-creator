import { z } from "zod";
import { LongFormMechanicsPlanSchema } from "./long-form-mechanics-plan.js";
export const MechanicsPlanAssistantResponseSchema = z.object({
  message: z.string().trim().min(1).max(20_000),
  proposal: z.object({
    summary: z.string().trim().min(1).max(1_000),
    rationale: z.string().trim().min(1).max(5_000),
    candidate: LongFormMechanicsPlanSchema,
  }).nullable(),
});
