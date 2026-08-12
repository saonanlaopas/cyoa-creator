import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  repairProposalCandidateSchema,
  validateCanonicalRepairEntityPayload,
  validateRepairProposalUnitCandidate,
  type RepairExpectedBase,
} from "../src/index.js";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
function fingerprint(value: unknown): string { return createHash("sha256").update(canonical(JSON.parse(JSON.stringify(value)))).digest("hex"); }

const passage = {
  id: "passage-1", sequenceId: "sequence-1", title: "Passage", kind: "scene" as const,
  purpose: "", summary: "Before", wordTarget: 500, routeIds: [], tags: [], characterIds: [], relationshipIds: [],
  locationIds: [], requiredFactIds: [], revealedFactIds: [], setupThreadIds: [], payoffThreadIds: [], preservedDifferenceIds: [],
  choiceIds: [], terminal: false, endingId: null, draftingNotes: [], unresolvedQuestions: [], planningStatus: "planned" as const, position: 0,
};
const expectedBase: RepairExpectedBase = {
  kind: "passage-entity-version", targetKey: "passage:passage-1", entityKind: "passage", entityId: "passage-1", versionId: "version-1",
};

describe("repair proposal domain contracts", () => {
  it("accepts exact canonical typed entities and rejects wrong, unknown, or omitted fields", () => {
    expect(validateCanonicalRepairEntityPayload("passage", passage)).toEqual(passage);
    expect(() => validateCanonicalRepairEntityPayload("passage", { ...passage, wordTarget: "500" })).toThrow();
    expect(() => validateCanonicalRepairEntityPayload("passage", { ...passage, forged: true })).toThrow();
    const omitted = { ...passage } as Partial<typeof passage>; delete omitted.summary;
    expect(() => validateCanonicalRepairEntityPayload("passage", omitted)).toThrow();
  });

  it("validates complete candidate shape and group/base relations", () => {
    const context = {
      repairPlanDefinitionFingerprint: "a".repeat(64), generationFingerprint: "b".repeat(64),
      unitId: "unit-1", contextFingerprint: "c".repeat(64), authorizedTargetKeys: [expectedBase.targetKey],
      expectedBases: [expectedBase], fingerprint,
    };
    const candidate = {
      schemaId: repairProposalCandidateSchema.id, schemaVersion: 1 as const,
      repairPlanDefinitionFingerprint: context.repairPlanDefinitionFingerprint,
      generationFingerprint: context.generationFingerprint, unitId: context.unitId, contextFingerprint: context.contextFingerprint,
      generatedIds: [], groups: [{ logicalKey: "group", label: "Repair", summary: "", sourceFindingFingerprints: ["d".repeat(64)],
        authorizedTargetKeys: [expectedBase.targetKey], dependsOnGroupKeys: [], operations: [{
          logicalKey: "operation", groupKey: "group", kind: "update-entity" as const, entityKind: "passage" as const,
          entityId: passage.id, expectedBase, after: { ...passage, summary: "After" }, sourceFindingFingerprints: ["d".repeat(64)],
        }] }],
    };
    expect(validateRepairProposalUnitCandidate(candidate, context)).toEqual(candidate);
    const mismatch = structuredClone(candidate); mismatch.groups[0]!.operations[0]!.groupKey = "other";
    expect(() => validateRepairProposalUnitCandidate(mismatch, context)).toThrow("group mismatch");
  });
});
