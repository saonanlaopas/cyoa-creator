import { describe, expect, it } from "vitest";
import {
  buildPassageDraftingPlan,
  passageDraftingPolicyV1,
  type ChoicePlan,
  type PassagePlan,
  type PassageStructure,
} from "../src/index.js";

function fixture(count = 10) {
  const passageIds = Array.from({ length: count }, (_, index) => `passage-${index}`);
  const structure: PassageStructure = {
    schemaVersion: 1,
    title: "Drafting fixture",
    projectWordTarget: 10_000,
    typicalPathWordTarget: 5_000,
    startPassageId: passageIds[0]!,
    acts: [{
      id: "act-1", label: "Act", purpose: "", summary: "", wordTarget: 10_000,
      routeIds: [], sequenceIds: ["sequence-1"], position: 0,
    }],
    sequences: [{
      id: "sequence-1", actId: "act-1", label: "Sequence", purpose: "", summary: "",
      wordTarget: 10_000, routeIds: [], passageIds, entryGoals: [], exitGoals: [],
      requiredDecisionIds: [], endingHookIds: [], position: 0, planningStatus: "planned",
    }],
    characterAvailability: [],
  };
  const passages = passageIds.map((id, index) => ({
    versionId: `version-${index}`,
    content: {
      id, sequenceId: "sequence-1", title: `Passage ${index}`, kind: "scene" as const,
      purpose: "Purpose", summary: "Summary", wordTarget: 500, routeIds: [], tags: [],
      characterIds: [], relationshipIds: [], locationIds: [], requiredFactIds: [], revealedFactIds: [],
      setupThreadIds: [], payoffThreadIds: [], preservedDifferenceIds: [],
      choiceIds: index < count - 1 ? [`choice-${index}`] : [], terminal: index === count - 1,
      endingId: null, draftingNotes: [], unresolvedQuestions: [], planningStatus: "planned" as const, position: index,
    } satisfies PassagePlan,
  }));
  const choices = passageIds.slice(0, -1).map((id, index) => ({
    versionId: `choice-version-${index}`,
    content: {
      id: `choice-${index}`, sourcePassageId: id, destinationPassageId: passageIds[index + 1]!,
      label: "Continue", narrativeIntent: "", consequencePreview: "", condition: null,
      unavailableBehavior: "disabled" as const, unavailableExplanation: "", effects: [],
      sourceDecisionIds: [], position: 0,
    } satisfies ChoicePlan,
  }));
  return { passageIds, structure, passages, choices };
}

describe("passage drafting plan", () => {
  it("builds deterministic connected units from exact immutable passage inputs", () => {
    const data = fixture();
    const input = {
      projectId: "project-1",
      snapshotId: "snapshot-1",
      structureVersionId: "structure-1",
      upstreamVersions: { mechanics: "mechanics-1", bible: "bible-1" },
      structure: data.structure,
      passages: data.passages,
      choices: data.choices,
      scope: { kind: "passages" as const, passageIds: data.passageIds },
      providerId: "offline-drafting-lifecycle",
      modelId: "no-prose-v1",
    };
    const first = buildPassageDraftingPlan(input);
    const second = buildPassageDraftingPlan({
      ...input,
      upstreamVersions: { bible: "bible-1", mechanics: "mechanics-1" },
      scope: { kind: "passages", passageIds: [...data.passageIds].reverse() },
    });
    expect(second).toEqual(first);
    expect(first.units.map((unit) => unit.passageIds.length)).toEqual([8, 2]);
    expect(first.units.flatMap((unit) => unit.passageVersionIds)).toEqual(data.passages.map((item) => item.versionId));
    expect(first.units.every((unit) => unit.contextDiagnostics.status === "not-built")).toBe(true);
    expect(first.units.every((unit) => unit.id.startsWith("dru_") && unit.inputFingerprint.length === 64)).toBe(true);
  });

  it("keeps disconnected selections in separate bounded units and excludes unselected passages", () => {
    const data = fixture(6);
    const scope = { kind: "passages" as const, passageIds: [data.passageIds[0]!, data.passageIds[1]!, data.passageIds[5]!] };
    const plan = buildPassageDraftingPlan({
      projectId: "project-1", snapshotId: "snapshot-1", structureVersionId: "structure-1",
      upstreamVersions: { bible: "bible-1" }, structure: data.structure,
      passages: data.passages, choices: data.choices, scope,
      providerId: "offline", modelId: "none",
    });
    expect(plan.units.map((unit) => unit.passageIds)).toEqual([
      [data.passageIds[0], data.passageIds[1]],
      [data.passageIds[5]],
    ]);
    expect(plan.units.flatMap((unit) => unit.passageIds)).not.toContain(data.passageIds[2]);
  });

  it("rejects policy attempts that exceed backend drafting ceilings", () => {
    const data = fixture(2);
    expect(() => buildPassageDraftingPlan({
      projectId: "project-1", snapshotId: "snapshot-1", structureVersionId: "structure-1",
      upstreamVersions: { bible: "bible-1" }, structure: data.structure,
      passages: data.passages, choices: data.choices,
      scope: { kind: "passages", passageIds: data.passageIds }, providerId: "offline", modelId: "none",
      policy: { ...passageDraftingPolicyV1, maxPassagesPerUnit: 9 },
    })).toThrow("at most 8 passages");
  });
});
