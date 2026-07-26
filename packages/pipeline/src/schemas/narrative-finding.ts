import { z } from "zod";

export const NarrativeFindingKindSchema = z.enum([
  "false_knowledge",
  "forgotten_consequence",
  "voice_drift",
  "repetitive_prose",
  "pacing",
  "indistinguishable_choices",
]);

export const NarrativeFindingSchema = z.object({
  id: z.string().min(1),
  kind: NarrativeFindingKindSchema,
  severity: z.enum(["error", "warning", "info"]),
  message: z.string().min(1),
  passageIds: z.array(z.string().min(1)).min(1),
  sourceExcerptIds: z.array(z.string().min(1)).min(1),
  suggestion: z.string().min(1).optional(),
});

export const NarrativeReviewSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  findings: z.array(NarrativeFindingSchema),
});

export type NarrativeFinding = z.infer<typeof NarrativeFindingSchema>;
export type NarrativeReview = z.infer<typeof NarrativeReviewSchema>;
