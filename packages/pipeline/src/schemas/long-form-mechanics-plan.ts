import { z } from "zod";
import {
  RepairFlagMechanicSchema,
  RepairRelationshipMechanicSchema,
  RepairResourceMechanicSchema,
  RepairVisibleStatMechanicSchema,
} from "@story-to-cyoa/domain";
import type { LongFormEndingPlan } from "./long-form-ending-plan.js";
import type { LongFormStoryBible } from "./long-form-story-bible.js";

const Id = z.string().trim().min(1).max(200);
const Key = z.string().trim().regex(/^[a-z][a-z0-9_-]*$/).max(100);
const Text = z.string().trim().max(10_000);

export const LongFormMechanicsPlanSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  title: z.string().trim().min(1).max(300),
  overview: Text.default(""),
  visibleStats: z.array(RepairVisibleStatMechanicSchema).max(12).default([]),
  relationships: z.array(RepairRelationshipMechanicSchema).max(100).default([]),
  flags: z.array(RepairFlagMechanicSchema).max(300).default([]),
  resources: z.array(RepairResourceMechanicSchema).max(100).default([]),
  gates: z.array(z.object({
    id: Id,
    targetType: z.enum(["route", "ending"]),
    targetId: Id,
    logic: z.enum(["all", "any"]),
    conditions: z.array(z.object({
      id: Id,
      mechanicKey: Key,
      operator: z.enum(["at-least", "at-most", "equals", "present", "absent"]),
      value: z.number().int().nullable(),
    })).min(1).max(20),
    rationale: Text.default(""),
    fallback: Text.default(""),
  })).max(500).default([]),
  choiceEffectPlans: z.array(z.object({
    id: Id,
    label: z.string().trim().min(1).max(300),
    sourceDecisionIds: z.array(Id).max(100).default([]),
    mechanicKeys: z.array(Key).min(1).max(30),
    effectGuidance: z.array(Text).min(1).max(100),
  })).max(500).default([]),
  balancingRules: z.array(z.object({
    id: Id, label: z.string().trim().min(1).max(300), description: Text.default(""),
  })).max(100).default([]),
  unresolvedQuestions: z.array(z.object({ id: Id, question: Text, answer: Text.default("") })).max(300).default([]),
}).superRefine((plan, context) => {
  const mechanics = [...plan.visibleStats, ...plan.relationships, ...plan.flags, ...plan.resources];
  const keys = new Set<string>();
  mechanics.forEach((item, index) => {
    if (keys.has(item.key)) context.addIssue({
      code: z.ZodIssueCode.custom, path: ["mechanics", index, "key"], message: `Mechanic keys must be unique: ${item.key}`,
    });
    keys.add(item.key);
    if ("minimum" in item && (item.minimum > item.initial || item.initial > item.maximum)) context.addIssue({
      code: z.ZodIssueCode.custom, path: ["mechanics", index], message: "Initial values must be within the declared scale",
    });
  });
  const refs = [
    ...plan.gates.flatMap((gate) => gate.conditions.map((condition) => condition.mechanicKey)),
    ...plan.choiceEffectPlans.flatMap((effect) => effect.mechanicKeys),
  ];
  refs.forEach((key, index) => {
    if (!keys.has(key)) context.addIssue({
      code: z.ZodIssueCode.custom, path: ["references", index], message: `Unknown mechanic key: ${key}`,
    });
  });
});

export type LongFormMechanicsPlan = z.infer<typeof LongFormMechanicsPlanSchema>;

export function defaultLongFormMechanicsPlan(
  bible: LongFormStoryBible,
  endings: LongFormEndingPlan,
): LongFormMechanicsPlan {
  return LongFormMechanicsPlanSchema.parse({
    title: `${endings.title.replace(/ endings$/i, "")} mechanics`,
    overview: "A consequence model in which every tracked value must visibly influence choices, routes, or outcomes.",
    visibleStats: [
      { id: "stat-resolve", key: "resolve", label: "Resolve", description: "Capacity to persist under pressure.", minimum: -5, maximum: 10, initial: 0, increaseSignals: [], decreaseSignals: [] },
      { id: "stat-insight", key: "insight", label: "Insight", description: "Understanding of people, systems, and hidden causes.", minimum: -5, maximum: 10, initial: 0, increaseSignals: [], decreaseSignals: [] },
      { id: "stat-integrity", key: "integrity", label: "Integrity", description: "Alignment between stated values and costly action.", minimum: -5, maximum: 10, initial: 0, increaseSignals: [], decreaseSignals: [] },
    ],
    relationships: bible.relationships.map((relationship, index) => ({
      id: `mechanic-relationship-${index + 1}`,
      relationshipId: relationship.id,
      key: `relationship_${index + 1}`,
      label: relationship.label || `Relationship ${index + 1}`,
      description: relationship.plannedArc,
      minimum: -5, maximum: 10, initial: 0,
      increaseSignals: [], decreaseSignals: [],
      bands: [
        { id: `relationship-${index + 1}-hostile`, minimum: -5, label: "Hostile", meaning: "" },
        { id: `relationship-${index + 1}-wary`, minimum: 0, label: "Wary", meaning: "" },
        { id: `relationship-${index + 1}-trusted`, minimum: 5, label: "Trusted", meaning: "" },
      ],
    })),
    flags: [],
    resources: [],
    gates: [],
    choiceEffectPlans: [],
    balancingRules: [
      { id: "rule-no-grinding", label: "No grinding", description: "Repeated low-cost choices cannot inflate a stat or relationship without new narrative risk." },
      { id: "rule-legible-effects", label: "Legible consequences", description: "Important changes receive prose feedback even when exact hidden values are not shown." },
      { id: "rule-no-single-key", label: "No universal best stat", description: "No single mechanic should unlock every favorable route or ending." },
    ],
    unresolvedQuestions: [],
  });
}
