import { z } from "zod";
import { ProjectBriefSchema } from "./project-brief.js";

export const ProjectBriefAssistantResponseSchema = z.object({
  message: z.string().trim().min(1).max(20_000),
  proposal: z.object({
    summary: z.string().trim().min(1).max(1_000),
    rationale: z.string().trim().min(1).max(5_000),
    candidate: ProjectBriefSchema,
  }).nullable(),
});

export type ProjectBriefAssistantResponse = z.infer<typeof ProjectBriefAssistantResponseSchema>;
