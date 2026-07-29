import { z } from "zod";
import { LongFormRoutePlanSchema } from "./long-form-route-plan.js";

export const RoutePlanAssistantResponseSchema = z.object({
  message: z.string().trim().min(1).max(20_000),
  proposal: z.object({
    summary: z.string().trim().min(1).max(1_000),
    rationale: z.string().trim().min(1).max(5_000),
    candidate: LongFormRoutePlanSchema,
  }).nullable(),
});

export type RoutePlanAssistantResponse = z.infer<typeof RoutePlanAssistantResponseSchema>;
