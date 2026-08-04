import { describe, expect, it } from "vitest";
import { buildPassageGenerationPlan, passageGenerationPolicyV1, type PassagePlan } from "../src/index.js";

const passage = (id: string, sequenceId: string, position: number, routeIds = ["route-a"]): PassagePlan => ({
  id, sequenceId, title: id, kind: "scene", purpose: "Purpose", summary: "Summary", wordTarget: 500,
  routeIds, tags: [], characterIds: [], relationshipIds: [], locationIds: [], requiredFactIds: [],
  revealedFactIds: [], setupThreadIds: [], payoffThreadIds: [], preservedDifferenceIds: [], choiceIds: [],
  terminal: false, endingId: null, draftingNotes: [], unresolvedQuestions: [], planningStatus: "planned", position,
});
const passages = [
  ...Array.from({ length: 30 }, (_, index) => passage(`a-${String(index).padStart(2, "0")}`, "sequence-a", index)),
  ...Array.from({ length: 8 }, (_, index) => passage(`b-${String(index).padStart(2, "0")}`, "sequence-b", index)),
];
const structure = {
  schemaVersion: 1 as const,
  title: "Fixture",
  projectWordTarget: 175_000,
  typicalPathWordTarget: 80_000,
  startPassageId: "a-00",
  acts: [{
    id: "act-a", label: "Act A", purpose: "", summary: "", wordTarget: 175_000,
    routeIds: ["route-a"], sequenceIds: ["sequence-a", "sequence-b"], position: 0,
  }],
  sequences: [
    {
      id: "sequence-b", actId: "act-a", label: "B", purpose: "", summary: "", wordTarget: 20_000,
      routeIds: ["route-a"], passageIds: passages.filter((item) => item.sequenceId === "sequence-b").map((item) => item.id),
      entryGoals: [], exitGoals: [], requiredDecisionIds: [], endingHookIds: [], position: 1, planningStatus: "planned" as const,
    },
    {
      id: "sequence-a", actId: "act-a", label: "A", purpose: "", summary: "", wordTarget: 30_000,
      routeIds: ["route-a"], passageIds: passages.filter((item) => item.sequenceId === "sequence-a").map((item) => item.id),
      entryGoals: [], exitGoals: [], requiredDecisionIds: [], endingHookIds: [], position: 0, planningStatus: "planned" as const,
    },
  ],
  characterAvailability: [],
};

const base = {
  projectId: "project-a",
  snapshotId: "snapshot-a",
  structureVersionId: "structure-v1",
  upstreamVersions: { mechanics: "mechanics-v1", brief: "brief-v1" },
  structure,
  passages: passages.map((content) => ({ versionId: `${content.id}-v1`, content })),
  providerId: "offline-kernel",
  modelId: "deterministic-fixture-v1",
  policy: passageGenerationPolicyV1,
};

describe("bounded passage generation planning", () => {
  it("creates deterministic stable-ID units capped by sequence and 25 passages", () => {
    const first = buildPassageGenerationPlan({ ...base, scope: { kind: "act", actId: "act-a" } });
    const second = buildPassageGenerationPlan({
      ...base,
      upstreamVersions: { brief: "brief-v1", mechanics: "mechanics-v1" },
      scope: { kind: "act", actId: "act-a" },
    });

    expect(second).toEqual(first);
    expect(first.units.map((unit) => [unit.sequenceId, unit.passageIds.length])).toEqual([
      ["sequence-a", 25], ["sequence-a", 5], ["sequence-b", 8],
    ]);
    expect(first.units.every((unit) => unit.id.startsWith("pgu_") && unit.inputFingerprint.length === 64)).toBe(true);
    expect(first.fingerprint).toHaveLength(64);
  });

  it("canonicalizes an explicit route segment by approved stable-ID ordering", () => {
    const plan = buildPassageGenerationPlan({
      ...base,
      scope: { kind: "route-segment", routeId: "route-a", passageIds: ["b-02", "a-03", "a-02"] },
    });
    expect(plan.units.map((unit) => unit.passageIds)).toEqual([["a-02", "a-03"], ["b-02"]]);
    expect(() => buildPassageGenerationPlan({
      ...base,
      scope: { kind: "route-segment", routeId: "route-other", passageIds: ["a-02"] },
    })).toThrow("does not belong");
  });
});
