import { z } from "zod";
import type { ProjectBrief } from "./project-brief.js";

const Id = z.string().trim().min(1).max(200);
const ShortText = z.string().trim().max(1_000);
const LongText = z.string().trim().max(20_000);
const WordTarget = z.number().int().min(0).max(2_000_000);

export const RouteActSchema = z.object({
  id: Id,
  routeId: Id.nullable(),
  label: z.string().trim().min(1).max(300),
  purpose: ShortText.default(""),
  summary: LongText.default(""),
  wordTarget: WordTarget,
});

export const MajorRouteSchema = z.object({
  id: Id,
  name: z.string().trim().min(1).max(300),
  promise: ShortText.default(""),
  summary: LongText.default(""),
  entryConditions: z.array(ShortText).max(50).default([]),
  relationshipArcs: z.array(z.object({
    relationshipId: Id,
    trajectory: LongText.default(""),
    keyMoments: z.array(ShortText).max(50).default([]),
  })).max(100).default([]),
  endingHookIds: z.array(Id).max(50).default([]),
});

export const RouteDecisionPointSchema = z.object({
  id: Id,
  label: z.string().trim().min(1).max(300),
  actId: Id,
  question: LongText.default(""),
  choices: z.array(z.object({
    id: Id,
    label: z.string().trim().min(1).max(500),
    destinationActId: Id,
    routeId: Id.nullable(),
    conditions: z.array(ShortText).max(50).default([]),
    consequences: z.array(ShortText).max(50).default([]),
  })).min(2).max(20),
});

export const RouteReconvergenceSchema = z.object({
  id: Id,
  label: z.string().trim().min(1).max(300),
  fromActIds: z.array(Id).min(2).max(30),
  toActId: Id,
  requirements: z.array(ShortText).max(50).default([]),
  preservedDifferences: z.array(ShortText).max(100).default([]),
});

export const RouteEndingHookSchema = z.object({
  id: Id,
  label: z.string().trim().min(1).max(300),
  routeId: Id,
  type: z.enum(["success", "partial", "failure", "special"]),
  summary: LongText.default(""),
});

export const LongFormRoutePlanSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  title: z.string().trim().min(1).max(300),
  overview: LongText.default(""),
  totalWordTarget: z.number().int().min(50_000).max(2_000_000),
  acts: z.array(RouteActSchema).min(1).max(200),
  routes: z.array(MajorRouteSchema).min(1).max(20),
  decisionPoints: z.array(RouteDecisionPointSchema).max(200).default([]),
  reconvergences: z.array(RouteReconvergenceSchema).max(100).default([]),
  endingHooks: z.array(RouteEndingHookSchema).max(100).default([]),
  unresolvedQuestions: z.array(z.object({
    id: Id,
    question: z.string().trim().min(1).max(2_000),
    answer: LongText.default(""),
  })).max(300).default([]),
}).superRefine((plan, context) => {
  const routeIds = new Set(plan.routes.map((route) => route.id));
  const actIds = new Set(plan.acts.map((act) => act.id));
  const endingIds = new Set(plan.endingHooks.map((ending) => ending.id));
  const allIds = [
    ...plan.routes.map((item) => item.id),
    ...plan.acts.map((item) => item.id),
    ...plan.decisionPoints.flatMap((item) => [item.id, ...item.choices.map((choice) => choice.id)]),
    ...plan.reconvergences.map((item) => item.id),
    ...plan.endingHooks.map((item) => item.id),
    ...plan.unresolvedQuestions.map((item) => item.id),
  ];
  const seen = new Set<string>();
  for (const id of allIds) {
    if (seen.has(id)) context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["id"],
      message: `Route-plan IDs must be unique: ${id}`,
    });
    seen.add(id);
  }

  plan.acts.forEach((act, index) => {
    if (act.routeId && !routeIds.has(act.routeId)) context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["acts", index, "routeId"],
      message: "Route-exclusive acts must reference a route in this plan",
    });
  });
  plan.routes.forEach((route, index) => {
    if (route.endingHookIds.some((endingId) => !endingIds.has(endingId))) context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["routes", index, "endingHookIds"],
      message: "Ending hooks must reference endings in this plan",
    });
  });
  plan.decisionPoints.forEach((decision, index) => {
    if (!actIds.has(decision.actId)) context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["decisionPoints", index, "actId"],
      message: "Decision points must belong to an act in this plan",
    });
    decision.choices.forEach((choice, choiceIndex) => {
      if (!actIds.has(choice.destinationActId)) context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["decisionPoints", index, "choices", choiceIndex, "destinationActId"],
        message: "Choice destinations must reference acts in this plan",
      });
      if (choice.routeId && !routeIds.has(choice.routeId)) context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["decisionPoints", index, "choices", choiceIndex, "routeId"],
        message: "Choice routes must reference routes in this plan",
      });
    });
  });
  plan.reconvergences.forEach((item, index) => {
    if (!actIds.has(item.toActId) || item.fromActIds.some((actId) => !actIds.has(actId))) context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["reconvergences", index],
      message: "Reconvergences must reference acts in this plan",
    });
  });
  plan.endingHooks.forEach((ending, index) => {
    if (!routeIds.has(ending.routeId)) context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endingHooks", index, "routeId"],
      message: "Ending hooks must reference a route in this plan",
    });
  });
});

export type LongFormRoutePlan = z.infer<typeof LongFormRoutePlanSchema>;

export function defaultLongFormRoutePlan(brief: ProjectBrief): LongFormRoutePlan {
  const sharedWords = Math.round(brief.totalWordTarget * 0.3);
  const routeWords = brief.totalWordTarget - sharedWords;
  const sharedOpeningWords = Math.round(sharedWords * 0.6);
  const sharedPivotWords = sharedWords - sharedOpeningWords;
  const routeCount = Math.max(1, brief.routeTarget);
  const baseRouteWords = Math.floor(routeWords / routeCount);
  const routeRemainder = routeWords - baseRouteWords * routeCount;
  const routes = Array.from({ length: routeCount }, (_, index) => ({
    id: `route-${index + 1}`,
    name: `Major route ${index + 1}`,
    promise: "",
    summary: "",
    entryConditions: [],
    relationshipArcs: [],
    endingHookIds: [] as string[],
  }));
  const routeActs = routes.map((route, index) => ({
    id: `${route.id}-act`,
    routeId: route.id,
    label: `${route.name} — exclusive arc`,
    purpose: "Develop this route's distinct conflict, relationships, and consequences.",
    summary: "",
    wordTarget: baseRouteWords + (index < routeRemainder ? 1 : 0),
  }));
  const endingHooks = Array.from({ length: brief.endingTarget }, (_, index) => {
    const route = routes[index % routes.length]!;
    const hook = {
      id: `ending-hook-${index + 1}`,
      label: `Ending hook ${index + 1}`,
      routeId: route.id,
      type: "partial" as const,
      summary: "",
    };
    route.endingHookIds.push(hook.id);
    return hook;
  });

  return LongFormRoutePlanSchema.parse({
    title: `${brief.workingTitle} route architecture`,
    overview: "A braided structure with a shared setup, a clear route-selection pivot, and substantial route-exclusive development.",
    totalWordTarget: brief.totalWordTarget,
    acts: [
      {
        id: "shared-opening",
        routeId: null,
        label: "Shared opening",
        purpose: "Establish the protagonist, central conflict, cast, and meaningful early variables.",
        summary: "",
        wordTarget: sharedOpeningWords,
      },
      {
        id: "shared-route-pivot",
        routeId: null,
        label: "Route-selection pivot",
        purpose: "Turn accumulated decisions and relationships into legible route entry.",
        summary: "",
        wordTarget: sharedPivotWords,
      },
      ...routeActs,
    ],
    routes,
    decisionPoints: [{
      id: "decision-route-selection",
      label: "Major route selection",
      actId: "shared-route-pivot",
      question: "Which commitment defines the protagonist's main route?",
      choices: routes.map((route) => ({
        id: `choice-${route.id}`,
        label: `Enter ${route.name}`,
        destinationActId: `${route.id}-act`,
        routeId: route.id,
        conditions: [],
        consequences: [],
      })),
    }],
    endingHooks,
    reconvergences: [],
    unresolvedQuestions: [],
  });
}
