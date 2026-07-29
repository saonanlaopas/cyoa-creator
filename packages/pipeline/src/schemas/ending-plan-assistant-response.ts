import { z } from "zod";
import { LongFormEndingPlanSchema } from "./long-form-ending-plan.js";

export const EndingPlanAssistantResponseSchema = z.object({
  message: z.string().trim().min(1).max(20_000),
  proposal: z.object({
    summary: z.string().trim().min(1).max(1_000),
    rationale: z.string().trim().min(1).max(5_000),
    candidate: LongFormEndingPlanSchema,
  }).nullable(),
});

export type EndingPlanAssistantResponse = z.infer<typeof EndingPlanAssistantResponseSchema>;
