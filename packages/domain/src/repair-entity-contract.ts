import { z } from "zod";

const Id = z.string().trim().min(1).max(200);
const PassageId = z.string().trim().min(1).max(200);
const PassageText = z.string().trim().max(20_000);
const PassageShortText = z.string().trim().max(1_000);
const WordTarget = z.number().int().min(0).max(2_000_000);

export const RepairConditionExpressionSchema: z.ZodType<RepairConditionExpression> = z.lazy(() => z.union([
  z.object({ kind: z.literal("all"), items: z.array(RepairConditionExpressionSchema).min(1).max(20) }),
  z.object({ kind: z.literal("any"), items: z.array(RepairConditionExpressionSchema).min(1).max(20) }),
  z.object({ kind: z.literal("not"), item: RepairConditionExpressionSchema }),
  z.object({
    kind: z.literal("compare"), mechanicKey: PassageId,
    operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte"]),
    value: z.union([z.number(), z.boolean(), z.string().max(500)]),
  }),
  z.object({
    kind: z.literal("visit-count"), passageId: PassageId,
    operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte"]),
    value: z.number().int().min(0),
  }),
]));

export type RepairConditionExpression =
  | { kind: "all"; items: RepairConditionExpression[] }
  | { kind: "any"; items: RepairConditionExpression[] }
  | { kind: "not"; item: RepairConditionExpression }
  | { kind: "compare"; mechanicKey: string; operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte"; value: number | boolean | string }
  | { kind: "visit-count"; passageId: string; operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte"; value: number };

export const RepairStateEffectSchema = z.object({
  id: PassageId,
  mechanicKey: PassageId,
  operation: z.enum(["set", "add", "subtract", "clear"]),
  value: z.union([z.number(), z.boolean(), z.string().max(500)]).nullable(),
  feedback: PassageShortText.default(""),
  visibility: z.enum(["visible", "hidden"]).default("visible"),
});

export const RepairPassagePlanSchema = z.object({
  id: PassageId, sequenceId: PassageId, title: z.string().trim().min(1).max(300),
  kind: z.enum(["scene", "transition", "hub", "climax", "epilogue"]),
  purpose: PassageShortText.default(""), summary: PassageText.default(""), wordTarget: WordTarget,
  routeIds: z.array(PassageId).max(30).default([]), tags: z.array(PassageShortText).max(100).default([]),
  characterIds: z.array(PassageId).max(100).default([]), relationshipIds: z.array(PassageId).max(100).default([]),
  locationIds: z.array(PassageId).max(100).default([]), requiredFactIds: z.array(PassageId).max(100).default([]),
  revealedFactIds: z.array(PassageId).max(100).default([]), setupThreadIds: z.array(PassageId).max(100).default([]),
  payoffThreadIds: z.array(PassageId).max(100).default([]), preservedDifferenceIds: z.array(PassageId).max(100).default([]),
  choiceIds: z.array(PassageId).max(100).default([]), terminal: z.boolean().default(false),
  endingId: PassageId.nullable().default(null), draftingNotes: z.array(PassageText).max(100).default([]),
  unresolvedQuestions: z.array(PassageText).max(100).default([]),
  planningStatus: z.enum(["outline", "planned", "reviewed", "locked"]).default("outline"),
  position: z.number().int().min(0).default(0),
});

export const RepairChoicePlanSchema = z.object({
  id: PassageId, sourcePassageId: PassageId, label: z.string().trim().min(1).max(500),
  destinationPassageId: PassageId, narrativeIntent: PassageText.default(""), consequencePreview: PassageText.default(""),
  condition: RepairConditionExpressionSchema.nullable().default(null),
  unavailableBehavior: z.enum(["hidden", "disabled"]).default("disabled"),
  unavailableExplanation: PassageText.default(""), effects: z.array(RepairStateEffectSchema).max(50).default([]),
  sourceDecisionIds: z.array(PassageId).max(100).default([]), position: z.number().int().min(0),
});

export const RepairNarrativeThreadSchema = z.object({
  id: PassageId, label: z.string().trim().min(1).max(300), description: PassageText.default(""),
  setupPassageIds: z.array(PassageId).max(500).default([]), payoffPassageIds: z.array(PassageId).max(500).default([]),
  routeIds: z.array(PassageId).max(30).default([]), required: z.boolean().default(false),
  status: z.enum(["planned", "partially-covered", "covered", "waived"]).default("planned"),
  waiverRationale: PassageText.default(""),
});

const BibleShortText = z.string().trim().max(500);
const BibleLongText = z.string().trim().max(10_000);

export const RepairBibleRelationshipSchema = z.object({
  id: Id,
  characterIds: z.array(Id).min(2).max(6),
  label: BibleShortText.default(""),
  currentState: BibleLongText.default(""),
  plannedArc: BibleLongText.default(""),
});

export const RepairBibleCanonFactSchema = z.object({
  id: Id,
  statement: z.string().trim().min(1).max(5_000),
  sourceExcerptIds: z.array(Id).max(50).default([]),
  confidence: z.enum(["confirmed", "likely", "uncertain"]).default("confirmed"),
});

const RouteShortText = z.string().trim().max(1_000);
const RouteLongText = z.string().trim().max(20_000);

export const RepairRouteActSchema = z.object({
  id: Id, routeId: Id.nullable(), label: z.string().trim().min(1).max(300),
  purpose: RouteShortText.default(""), summary: RouteLongText.default(""), wordTarget: WordTarget,
});

export const RepairMajorRouteSchema = z.object({
  id: Id, name: z.string().trim().min(1).max(300), promise: RouteShortText.default(""), summary: RouteLongText.default(""),
  entryConditions: z.array(RouteShortText).max(50).default([]),
  relationshipArcs: z.array(z.object({
    relationshipId: Id, trajectory: RouteLongText.default(""), keyMoments: z.array(RouteShortText).max(50).default([]),
  })).max(100).default([]),
  endingHookIds: z.array(Id).max(50).default([]),
});

export const RepairRouteDecisionPointSchema = z.object({
  id: Id, label: z.string().trim().min(1).max(300), actId: Id, question: RouteLongText.default(""),
  choices: z.array(z.object({
    id: Id, label: z.string().trim().min(1).max(500), destinationActId: Id, routeId: Id.nullable(),
    conditions: z.array(RouteShortText).max(50).default([]), consequences: z.array(RouteShortText).max(50).default([]),
  })).min(2).max(20),
});

export const RepairRouteReconvergenceSchema = z.object({
  id: Id, label: z.string().trim().min(1).max(300), fromActIds: z.array(Id).min(2).max(30), toActId: Id,
  requirements: z.array(RouteShortText).max(50).default([]), preservedDifferences: z.array(RouteShortText).max(100).default([]),
});

export const RepairRouteEndingHookSchema = z.object({
  id: Id, label: z.string().trim().min(1).max(300), routeId: Id,
  type: z.enum(["success", "partial", "failure", "special"]), summary: RouteLongText.default(""),
});

export const RepairEndingVariantSchema = z.object({
  id: Id, label: z.string().trim().min(1).max(300),
  requirements: z.array(RouteShortText).max(100).default([]), differences: z.array(RouteShortText).max(100).default([]),
});

export const RepairEndingOutcomeSchema = z.object({
  id: Id, hookId: Id, routeId: Id, title: z.string().trim().min(1).max(300),
  type: z.enum(["success", "partial", "failure", "special"]), summary: RouteLongText.default(""),
  thematicPayoff: RouteLongText.default(""), wordTarget: z.number().int().min(100).max(20_000),
  requirements: z.array(RouteShortText).max(150).default([]), exclusions: z.array(RouteShortText).max(100).default([]),
  contributingDecisionIds: z.array(Id).max(100).default([]), foreshadowing: z.array(RouteShortText).max(100).default([]),
  characterOutcomes: z.array(z.object({ characterId: Id, outcome: RouteLongText.default("") })).max(200).default([]),
  relationshipOutcomes: z.array(z.object({ relationshipId: Id, outcome: RouteLongText.default("") })).max(200).default([]),
  stateConsequences: z.array(RouteShortText).max(150).default([]),
  variants: z.array(RepairEndingVariantSchema).max(30).default([]),
});

const MechanicKey = z.string().trim().regex(/^[a-z][a-z0-9_-]*$/).max(100);
const MechanicText = z.string().trim().max(10_000);
const ScaleFields = {
  id: Id, key: MechanicKey, label: z.string().trim().min(1).max(200), description: MechanicText.default(""),
  minimum: z.number().int(), maximum: z.number().int(), initial: z.number().int(),
  increaseSignals: z.array(MechanicText).max(50).default([]), decreaseSignals: z.array(MechanicText).max(50).default([]),
};

export const RepairVisibleStatMechanicSchema = z.object(ScaleFields);
export const RepairRelationshipMechanicSchema = z.object(ScaleFields).extend({
  relationshipId: Id,
  bands: z.array(z.object({
    id: Id, minimum: z.number().int(), label: z.string().trim().min(1).max(200), meaning: MechanicText.default(""),
  })).max(20).default([]),
});
export const RepairFlagMechanicSchema = z.object({
  id: Id, key: MechanicKey, label: z.string().trim().min(1).max(200), meaning: MechanicText.default(""),
});
export const RepairResourceMechanicSchema = z.object({
  id: Id, key: MechanicKey, label: z.string().trim().min(1).max(200),
  kind: z.enum(["inventory", "currency", "counter"]), initial: z.number().int().default(0), meaning: MechanicText.default(""),
});

export const RepairMechanicSchema = z.union([
  RepairRelationshipMechanicSchema.strict(), RepairVisibleStatMechanicSchema.strict(),
  RepairFlagMechanicSchema.strict(), RepairResourceMechanicSchema.strict(),
]);

export const RepairEntityKindSchema = z.enum([
  "passage", "choice", "thread", "mechanic", "relationship", "canon-fact", "route",
  "route-act", "route-decision", "route-reconvergence", "route-ending-hook", "ending",
]);
export type RepairEntityKind = z.infer<typeof RepairEntityKindSchema>;

const schemas: Record<RepairEntityKind, z.ZodTypeAny> = {
  passage: RepairPassagePlanSchema.strict(),
  choice: RepairChoicePlanSchema.strict(),
  thread: RepairNarrativeThreadSchema.strict(),
  mechanic: RepairMechanicSchema,
  relationship: RepairBibleRelationshipSchema.strict(),
  "canon-fact": RepairBibleCanonFactSchema.strict(),
  route: RepairMajorRouteSchema.strict(),
  "route-act": RepairRouteActSchema.strict(),
  "route-decision": RepairRouteDecisionPointSchema.strict(),
  "route-reconvergence": RepairRouteReconvergenceSchema.strict(),
  "route-ending-hook": RepairRouteEndingHookSchema.strict(),
  ending: RepairEndingOutcomeSchema.strict(),
};

export function validateCanonicalRepairEntityPayload(kind: RepairEntityKind, value: unknown): Record<string, unknown> {
  const parsed = schemas[kind].parse(value) as Record<string, unknown>;
  if (canonical(parsed) !== canonical(value)) throw new Error(`Repair-proposal ${kind} payload contains unknown, omitted, or defaulted fields`);
  return parsed;
}

export function repairMechanicPayloadKind(value: Record<string, unknown>): "relationship" | "stat" | "flag" | "resource" {
  if ("relationshipId" in value) return "relationship";
  if ("minimum" in value) return "stat";
  if ("kind" in value) return "resource";
  return "flag";
}

function canonical(value: unknown): string {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
