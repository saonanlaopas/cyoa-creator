import { z } from "zod";
import { ConditionSchema, EffectSchema } from "./mechanics.js";

export const PassageIdSchema = z.string().min(1).brand<"PassageId">();
export const ChoiceIdSchema = z.string().min(1).brand<"ChoiceId">();

export const ChoiceSchema = z.object({
  id: ChoiceIdSchema,
  label: z.string().min(1),
  destinationId: PassageIdSchema,
  conditions: z.array(ConditionSchema).default([]),
  effects: z.array(EffectSchema).default([]),
  hardGate: z.boolean().default(false),
});

export const PassageSchema = z.object({
  id: PassageIdSchema,
  title: z.string().min(1),
  purpose: z.string().default(""),
  prose: z.string().default(""),
  participants: z.array(z.string()).default([]),
  requiredKnowledge: z.array(z.string()).default([]),
  incomingAssumptions: z.array(z.string()).default([]),
  choices: z.array(ChoiceSchema).default([]),
  ending: z.enum(["success", "partial", "failure", "other"]).nullable().optional(),
  endingClassification: z.enum(["success", "partial", "failure", "other"]).nullable().optional(),
});

export type Choice = z.infer<typeof ChoiceSchema>;
export type Passage = z.infer<typeof PassageSchema>;
export type PassageId = z.infer<typeof PassageIdSchema>;
