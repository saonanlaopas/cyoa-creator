import { z } from "zod";
import { RepairEndingOutcomeSchema, RepairEndingVariantSchema } from "@story-to-cyoa/domain";
import type { LongFormRoutePlan } from "./long-form-route-plan.js";

const Id = z.string().trim().min(1).max(200);
const LongText = z.string().trim().max(20_000);

export const EndingVariantSchema = RepairEndingVariantSchema;
export const EndingOutcomeSchema = RepairEndingOutcomeSchema;

export const LongFormEndingPlanSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  title: z.string().trim().min(1).max(300),
  overview: LongText.default(""),
  projectWordTarget: z.number().int().min(50_000).max(2_000_000),
  endingWordTarget: z.number().int().min(1_000).max(500_000),
  endings: z.array(EndingOutcomeSchema).min(1).max(100),
  unresolvedQuestions: z.array(z.object({
    id: Id,
    question: z.string().trim().min(1).max(2_000),
    answer: LongText.default(""),
  })).max(300).default([]),
}).superRefine((plan, context) => {
  const ids = [
    ...plan.endings.flatMap((ending) => [ending.id, ...ending.variants.map((variant) => variant.id)]),
    ...plan.unresolvedQuestions.map((item) => item.id),
  ];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["id"],
      message: `Ending-plan IDs must be unique: ${id}`,
    });
    seen.add(id);
  }
  const hooks = new Set<string>();
  plan.endings.forEach((ending, index) => {
    if (hooks.has(ending.hookId)) context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endings", index, "hookId"],
      message: "Each route ending hook can map to only one detailed ending",
    });
    hooks.add(ending.hookId);
  });
});

export type LongFormEndingPlan = z.infer<typeof LongFormEndingPlanSchema>;

export function defaultLongFormEndingPlan(routes: LongFormRoutePlan): LongFormEndingPlan {
  const total = Math.max(1_000, routes.endingHooks.length * 100, Math.round(routes.totalWordTarget * 0.06));
  const base = Math.floor(total / routes.endingHooks.length);
  const remainder = total - base * routes.endingHooks.length;
  return LongFormEndingPlanSchema.parse({
    title: `${routes.title.replace(/ route architecture$/i, "")} endings`,
    overview: "Detailed outcomes that pay off route promises, accumulated choices, relationships, and project themes.",
    projectWordTarget: routes.totalWordTarget,
    endingWordTarget: total,
    endings: routes.endingHooks.map((hook, index) => ({
      id: `ending-${index + 1}`,
      hookId: hook.id,
      routeId: hook.routeId,
      title: hook.label,
      type: hook.type,
      summary: hook.summary,
      thematicPayoff: "",
      wordTarget: base + (index < remainder ? 1 : 0),
      requirements: [],
      exclusions: [],
      contributingDecisionIds: [],
      foreshadowing: [],
      characterOutcomes: [],
      relationshipOutcomes: [],
      stateConsequences: [],
      variants: [],
    })),
    unresolvedQuestions: [],
  });
}
