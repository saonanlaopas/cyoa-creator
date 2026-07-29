import { z } from "zod";
import { LongFormStoryBibleSchema } from "./long-form-story-bible.js";

export const BibleAssistantResponseSchema = z.object({
  message: z.string().trim().min(1).max(20_000),
  proposal: z.object({
    summary: z.string().trim().min(1).max(1_000),
    rationale: z.string().trim().min(1).max(5_000),
    candidate: LongFormStoryBibleSchema,
  }).nullable(),
});

export type BibleAssistantResponse = z.infer<typeof BibleAssistantResponseSchema>;
