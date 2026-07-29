import { z } from "zod";
import type { ProjectBrief } from "./project-brief.js";
import type { LongFormRoutePlan } from "./long-form-route-plan.js";
import type { LongFormEndingPlan } from "./long-form-ending-plan.js";

const Id = z.string().trim().min(1).max(200);
const Text = z.string().trim().max(20_000);
const ShortText = z.string().trim().max(1_000);
const WordTarget = z.number().int().min(0).max(2_000_000);

export const ConditionExpressionSchema: z.ZodType<ConditionExpression> = z.lazy(() => z.union([
  z.object({ kind: z.literal("all"), items: z.array(ConditionExpressionSchema).min(1).max(20) }),
  z.object({ kind: z.literal("any"), items: z.array(ConditionExpressionSchema).min(1).max(20) }),
  z.object({ kind: z.literal("not"), item: ConditionExpressionSchema }),
  z.object({
    kind: z.literal("compare"), mechanicKey: Id,
    operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte"]),
    value: z.union([z.number(), z.boolean(), z.string().max(500)]),
  }),
  z.object({
    kind: z.literal("visit-count"), passageId: Id,
    operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte"]),
    value: z.number().int().min(0),
  }),
]));

export type ConditionExpression =
  | { kind: "all"; items: ConditionExpression[] }
  | { kind: "any"; items: ConditionExpression[] }
  | { kind: "not"; item: ConditionExpression }
  | { kind: "compare"; mechanicKey: string; operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte"; value: number | boolean | string }
  | { kind: "visit-count"; passageId: string; operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte"; value: number };

export const StateEffectSchema = z.object({
  id: Id,
  mechanicKey: Id,
  operation: z.enum(["set", "add", "subtract", "clear"]),
  value: z.union([z.number(), z.boolean(), z.string().max(500)]).nullable(),
  feedback: ShortText.default(""),
  visibility: z.enum(["visible", "hidden"]).default("visible"),
});

export const ActPlanSchema = z.object({
  id: Id, label: z.string().trim().min(1).max(300), purpose: ShortText.default(""),
  summary: Text.default(""), wordTarget: WordTarget, routeIds: z.array(Id).max(30).default([]),
  sequenceIds: z.array(Id).max(500).default([]), position: z.number().int().min(0),
});

export const SequencePlanSchema = z.object({
  id: Id, actId: Id, label: z.string().trim().min(1).max(300), purpose: ShortText.default(""),
  summary: Text.default(""), wordTarget: WordTarget, routeIds: z.array(Id).max(30).default([]),
  passageIds: z.array(Id).max(1_000).default([]), entryGoals: z.array(ShortText).max(100).default([]),
  exitGoals: z.array(ShortText).max(100).default([]), requiredDecisionIds: z.array(Id).max(100).default([]),
  endingHookIds: z.array(Id).max(100).default([]), position: z.number().int().min(0),
  planningStatus: z.enum(["outline", "planned", "reviewed", "locked"]).default("outline"),
});

export const PassagePlanSchema = z.object({
  id: Id, sequenceId: Id, title: z.string().trim().min(1).max(300),
  kind: z.enum(["scene", "transition", "hub", "climax", "epilogue"]),
  purpose: ShortText.default(""), summary: Text.default(""), wordTarget: WordTarget,
  routeIds: z.array(Id).max(30).default([]), tags: z.array(ShortText).max(100).default([]),
  characterIds: z.array(Id).max(100).default([]), relationshipIds: z.array(Id).max(100).default([]),
  locationIds: z.array(Id).max(100).default([]), requiredFactIds: z.array(Id).max(100).default([]),
  revealedFactIds: z.array(Id).max(100).default([]), setupThreadIds: z.array(Id).max(100).default([]),
  payoffThreadIds: z.array(Id).max(100).default([]), preservedDifferenceIds: z.array(Id).max(100).default([]),
  choiceIds: z.array(Id).max(100).default([]), terminal: z.boolean().default(false),
  endingId: Id.nullable().default(null), draftingNotes: z.array(Text).max(100).default([]),
  unresolvedQuestions: z.array(Text).max(100).default([]),
  planningStatus: z.enum(["outline", "planned", "reviewed", "locked"]).default("outline"),
  position: z.number().int().min(0).default(0),
});

export const ChoicePlanSchema = z.object({
  id: Id, sourcePassageId: Id, label: z.string().trim().min(1).max(500),
  destinationPassageId: Id, narrativeIntent: Text.default(""), consequencePreview: Text.default(""),
  condition: ConditionExpressionSchema.nullable().default(null),
  unavailableBehavior: z.enum(["hidden", "disabled"]).default("disabled"),
  unavailableExplanation: Text.default(""), effects: z.array(StateEffectSchema).max(50).default([]),
  sourceDecisionIds: z.array(Id).max(100).default([]), position: z.number().int().min(0),
});

export const NarrativeThreadSchema = z.object({
  id: Id, label: z.string().trim().min(1).max(300), description: Text.default(""),
  setupPassageIds: z.array(Id).max(500).default([]), payoffPassageIds: z.array(Id).max(500).default([]),
  routeIds: z.array(Id).max(30).default([]), required: z.boolean().default(false),
  status: z.enum(["planned", "partially-covered", "covered", "waived"]).default("planned"),
  waiverRationale: Text.default(""),
});

export const PassageStructureSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  title: z.string().trim().min(1).max(300),
  projectWordTarget: z.number().int().min(1_000).max(2_000_000),
  typicalPathWordTarget: z.number().int().min(1_000).max(2_000_000),
  startPassageId: Id.nullable().default(null),
  acts: z.array(ActPlanSchema).max(200).default([]),
  sequences: z.array(SequencePlanSchema).max(2_000).default([]),
  characterAvailability: z.array(z.object({
    characterId: Id, actIds: z.array(Id).max(200).default([]), routeIds: z.array(Id).max(30).default([]),
  })).max(500).default([]),
});

export const PassagePlanBundleSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  structure: PassageStructureSchema,
  passages: z.array(PassagePlanSchema).max(10_000),
  choices: z.array(ChoicePlanSchema).max(30_000),
  threads: z.array(NarrativeThreadSchema).max(5_000),
});

export type StateEffect = z.infer<typeof StateEffectSchema>;
export type ActPlan = z.infer<typeof ActPlanSchema>;
export type SequencePlan = z.infer<typeof SequencePlanSchema>;
export type PassagePlan = z.infer<typeof PassagePlanSchema>;
export type ChoicePlan = z.infer<typeof ChoicePlanSchema>;
export type NarrativeThread = z.infer<typeof NarrativeThreadSchema>;
export type PassageStructure = z.infer<typeof PassageStructureSchema>;
export type PassagePlanBundle = z.infer<typeof PassagePlanBundleSchema>;

export function defaultPassagePlanBundle(
  brief: ProjectBrief,
  routes: LongFormRoutePlan,
  endings: LongFormEndingPlan,
): PassagePlanBundle {
  const acts: ActPlan[] = routes.acts.map((act, index) => ({
    id: `act-${act.id}`, label: act.label, purpose: act.purpose, summary: act.summary,
    wordTarget: act.wordTarget, routeIds: act.routeId ? [act.routeId] : [],
    sequenceIds: [`sequence-${act.id}`], position: index,
  }));
  const sequences: SequencePlan[] = routes.acts.map((act, index) => ({
    id: `sequence-${act.id}`, actId: `act-${act.id}`, label: `${act.label} outline`,
    purpose: act.purpose, summary: act.summary, wordTarget: act.wordTarget,
    routeIds: act.routeId ? [act.routeId] : [], passageIds: [`passage-${act.id}`],
    entryGoals: [], exitGoals: [], requiredDecisionIds: [], endingHookIds: [],
    position: index, planningStatus: "outline",
  }));
  const passages: PassagePlan[] = routes.acts.map((act, index) => ({
    id: `passage-${act.id}`, sequenceId: `sequence-${act.id}`, title: act.label,
    kind: index === 0 ? "scene" : "transition", purpose: act.purpose, summary: act.summary,
    wordTarget: act.wordTarget, routeIds: act.routeId ? [act.routeId] : [], tags: [],
    characterIds: [], relationshipIds: [], locationIds: [], requiredFactIds: [], revealedFactIds: [],
    setupThreadIds: [], payoffThreadIds: [], preservedDifferenceIds: [], choiceIds: [],
    terminal: false, endingId: null, draftingNotes: [], unresolvedQuestions: [],
    planningStatus: "outline", position: index,
  }));
  const routeFirstPassage = new Map<string, string>();
  routes.acts.forEach((act) => {
    if (act.routeId && !routeFirstPassage.has(act.routeId)) routeFirstPassage.set(act.routeId, `passage-${act.id}`);
  });
  const choices: ChoicePlan[] = [];
  passages.forEach((passage, index) => {
    const next = passages[index + 1];
    if (next) {
      const choiceId = `choice-${passage.id}-continue`;
      passage.choiceIds.push(choiceId);
      choices.push({
        id: choiceId, sourcePassageId: passage.id, destinationPassageId: next.id,
        label: "Continue", narrativeIntent: "", consequencePreview: "", condition: null,
        unavailableBehavior: "disabled", unavailableExplanation: "", effects: [],
        sourceDecisionIds: [], position: 0,
      });
    }
  });
  endings.endings.forEach((ending, index) => {
    const routePassageId = routeFirstPassage.get(ending.routeId) ?? passages.at(-1)?.id;
    if (!routePassageId) return;
    const sequence = sequences.find((item) => item.passageIds.includes(routePassageId))!;
    const terminal: PassagePlan = {
      id: `passage-${ending.id}`, sequenceId: sequence.id, title: ending.title, kind: "epilogue",
      purpose: ending.thematicPayoff, summary: ending.summary, wordTarget: ending.wordTarget,
      routeIds: [ending.routeId], tags: ["ending"], characterIds: ending.characterOutcomes.map((item) => item.characterId),
      relationshipIds: ending.relationshipOutcomes.map((item) => item.relationshipId), locationIds: [],
      requiredFactIds: [], revealedFactIds: [], setupThreadIds: [], payoffThreadIds: [],
      preservedDifferenceIds: [], choiceIds: [], terminal: true, endingId: ending.id,
      draftingNotes: [], unresolvedQuestions: [], planningStatus: "outline", position: passages.length + index,
    };
    passages.push(terminal);
    sequence.passageIds.push(terminal.id);
    const source = passages.find((item) => item.id === routePassageId)!;
    const choiceId = `choice-${source.id}-${ending.id}`;
    source.choiceIds.push(choiceId);
    choices.push({
      id: choiceId, sourcePassageId: source.id, destinationPassageId: terminal.id,
      label: `Reach ${ending.title}`, narrativeIntent: ending.thematicPayoff,
      consequencePreview: ending.summary, condition: null, unavailableBehavior: "disabled",
      unavailableExplanation: "", effects: [], sourceDecisionIds: ending.contributingDecisionIds, position: source.choiceIds.length - 1,
    });
  });
  return PassagePlanBundleSchema.parse({
    structure: {
      title: `${brief.workingTitle} passage plan`, projectWordTarget: brief.totalWordTarget,
      typicalPathWordTarget: brief.typicalPlaythroughWordTarget, startPassageId: passages[0]?.id ?? null,
      acts, sequences, characterAvailability: [],
    },
    passages, choices, threads: [],
  });
}
