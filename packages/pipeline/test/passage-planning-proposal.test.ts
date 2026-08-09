import { describe, expect, it } from "vitest";
import {
  PassageProposalConsolidationError,
  consolidatePassagePlanningCandidates,
  deterministicCandidateId,
  passagePlanningCandidateSchema,
  type ChoicePlan,
  type NarrativeThread,
  type PassagePlan,
  type PassagePlanningContextPack,
  type PassagePlanningUnitCandidate,
  type PassageProposalCandidateInput,
} from "../src/index.js";

const passage = (id = "passage-a"): PassagePlan => ({
  id, sequenceId: "sequence-a", title: "Original", kind: "scene", purpose: "", summary: "",
  wordTarget: 500, routeIds: [], tags: [], characterIds: [], relationshipIds: [], locationIds: [],
  requiredFactIds: [], revealedFactIds: [], setupThreadIds: ["thread-a"], payoffThreadIds: [],
  preservedDifferenceIds: [], choiceIds: ["choice-a"], terminal: false, endingId: null,
  draftingNotes: [], unresolvedQuestions: [], planningStatus: "planned", position: 0,
});
const choice: ChoicePlan = {
  id: "choice-a", sourcePassageId: "passage-a", destinationPassageId: "passage-b", label: "Continue",
  narrativeIntent: "", consequencePreview: "", condition: null, unavailableBehavior: "disabled",
  unavailableExplanation: "", effects: [], sourceDecisionIds: [], position: 0,
};
const thread: NarrativeThread = {
  id: "thread-a", label: "Promise", description: "", setupPassageIds: ["passage-a"],
  payoffPassageIds: [], routeIds: [], required: true, status: "planned", waiverRationale: "",
};
const context = (selected = passage()): PassagePlanningContextPack => ({
  schemaId: "cyoa.passage-planning-context", schemaVersion: 1,
  identity: { projectId: "project-a", snapshotId: "snapshot-a", structureVersionId: "structure-v1", upstreamVersions: {} },
  scope: { kind: "sequence", sequenceId: "sequence-a" },
  structure: {
    act: { id: "act-a", label: "Act", purpose: "", summary: "", wordTarget: 1_000, routeIds: [], sequenceIds: ["sequence-a"], position: 0 },
    sequence: { id: "sequence-a", actId: "act-a", label: "Sequence", purpose: "", summary: "", wordTarget: 1_000, routeIds: [], passageIds: [selected.id, "passage-b"], entryGoals: [], exitGoals: [], requiredDecisionIds: [], endingHookIds: [], position: 0, planningStatus: "planned" },
  },
  selectedPassages: [{ versionId: `version-${selected.id}`, content: selected }],
  neighboringPassages: [{ versionId: "version-passage-b", content: { ...passage("passage-b"), sequenceId: "sequence-a", choiceIds: [], terminal: true, endingId: "ending-a" } }],
  choices: selected.id === "passage-a" ? [{ versionId: "version-choice-a", content: choice }] : [],
  threads: selected.id === "passage-a" ? [{ versionId: "version-thread-a", content: thread }] : [],
  upstream: {
    brief: { workingTitle: "Test", premise: "Premise", sourceMode: "original-premise", tone: "", pointOfView: "second-person", adaptationFidelity: "balanced" },
    bible: { schemaVersion: 1, title: "Bible", proseGuidance: { tone: [], pointOfView: "", style: [], avoid: [] }, characters: [], relationships: [], settings: [], canonFacts: [] },
    routes: { schemaVersion: 1, title: "Routes", acts: [], routes: [], decisionPoints: [], reconvergences: [], endingHooks: [] },
    endings: { schemaVersion: 1, title: "Endings", endings: [] },
    mechanics: { schemaVersion: 1, title: "Mechanics", visibleStats: [], relationships: [], flags: [], resources: [], gates: [], choiceEffectPlans: [], balancingRules: [] },
  },
});

function candidate(inputFingerprint: string, overrides: Partial<PassagePlanningUnitCandidate> = {}): PassagePlanningUnitCandidate {
  return {
    schemaId: passagePlanningCandidateSchema.id,
    schemaVersion: passagePlanningCandidateSchema.version,
    jobId: "job-a", unitId: "unit-a", inputFingerprint,
    passages: [passage()], choices: [choice], threads: [thread], generatedIds: [],
    ...overrides,
  };
}

function input(
  candidateId: string,
  unitId: string,
  unitPosition: number,
  value: PassagePlanningUnitCandidate,
  boundedContext = context(),
): PassageProposalCandidateInput {
  return {
    candidateId, attemptId: `attempt-${candidateId}`, unitId, unitPosition,
    inputFingerprint: value.inputFingerprint, contextFingerprint: `context-${unitId}`,
    candidate: { ...value, unitId }, context: boundedContext,
  };
}

describe("passage proposal consolidation", () => {
  it("deterministically creates exact-base updates and deterministic additions", () => {
    const fingerprint = "a".repeat(64);
    const newChoiceId = deterministicCandidateId(fingerprint, "choice", "new-choice");
    const newThreadId = deterministicCandidateId(fingerprint, "thread", "new-thread");
    const updatedPassage = {
      ...passage(), title: "Revised", choiceIds: ["choice-a", newChoiceId], setupThreadIds: ["thread-a", newThreadId],
    };
    const value = candidate(fingerprint, {
      passages: [updatedPassage],
      choices: [
        { ...choice, label: "Go on" },
        { ...choice, id: newChoiceId, label: "New route", position: 1 },
      ],
      threads: [
        { ...thread, label: "Revised promise" },
        { ...thread, id: newThreadId, label: "New promise" },
      ],
      generatedIds: [
        { entityKind: "choice", logicalKey: "new-choice", id: newChoiceId },
        { entityKind: "thread", logicalKey: "new-thread", id: newThreadId },
      ],
    });
    const first = consolidatePassagePlanningCandidates([input("candidate-a", "unit-a", 0, value)]);
    const second = consolidatePassagePlanningCandidates([input("candidate-a", "unit-a", 0, value)]);

    expect(first).toEqual(second);
    expect(first.operations.map((operation) => [operation.kind, operation.entityKind, operation.entityId, operation.baseVersionId])).toEqual([
      ["update-entity", "passage", "passage-a", "version-passage-a"],
      ["add-entity", "choice", newChoiceId, null],
      ["update-entity", "choice", "choice-a", "version-choice-a"],
      ["add-entity", "thread", newThreadId, null],
      ["update-entity", "thread", "thread-a", "version-thread-a"],
    ]);
    expect(first.operations.every((operation) => operation.id.startsWith("ppo_"))).toBe(true);
    expect(first.groups).toHaveLength(1);
    expect(first.groups[0]).toMatchObject({ unitId: "unit-a", dependsOnGroupIds: [], safeToApplyIndependently: true });
    expect(first.consolidationFingerprint).toHaveLength(64);
  });

  it("does not infer deletion from omission and emits no operations for no-op records", () => {
    const noOp = consolidatePassagePlanningCandidates([input(
      "candidate-a", "unit-a", 0,
      candidate("b".repeat(64), { choices: [], threads: [] }),
    )]);
    expect(noOp.operations).toEqual([]);
    expect(noOp.groups).toEqual([]);
  });

  it("deduplicates identical existing effects and rejects conflicts and generated-ID collisions", () => {
    const left = candidate("c".repeat(64), { passages: [{ ...passage(), title: "Same" }], choices: [], threads: [] });
    const right = candidate("d".repeat(64), { passages: [{ ...passage(), title: "Same" }], choices: [], threads: [] });
    const deduplicated = consolidatePassagePlanningCandidates([
      input("candidate-b", "unit-b", 1, right), input("candidate-a", "unit-a", 0, left),
    ]);
    expect(deduplicated.operations).toHaveLength(1);
    expect(deduplicated.operations[0].sourceCandidateIds).toEqual(["candidate-a", "candidate-b"]);
    expect(deduplicated.groups).toHaveLength(1);

    const conflicting = candidate("e".repeat(64), { passages: [{ ...passage(), title: "Different" }], choices: [], threads: [] });
    expect(() => consolidatePassagePlanningCandidates([
      input("candidate-a", "unit-a", 0, left), input("candidate-b", "unit-b", 1, conflicting),
    ])).toThrow(PassageProposalConsolidationError);

    const generatedId = deterministicCandidateId("f".repeat(64), "thread", "collision");
    const generated = (candidateId: string, unitId: string, position: number) => input(
      candidateId, unitId, position,
      candidate("f".repeat(64), {
        passages: [], choices: [], threads: [{ ...thread, id: generatedId }],
        generatedIds: [{ entityKind: "thread", logicalKey: "collision", id: generatedId }],
      }),
    );
    expect(() => consolidatePassagePlanningCandidates([
      generated("candidate-a", "unit-a", 0), generated("candidate-b", "unit-b", 1),
    ])).toThrow("Generated stable ID collision");
  });

  it("computes explicit cross-unit dependencies for references to newly generated entities", () => {
    const fingerprint = "1".repeat(64);
    const generatedId = deterministicCandidateId(fingerprint, "thread", "cross-unit-thread");
    const other = passage("passage-other");
    const producer = candidate(fingerprint, {
      passages: [other], choices: [], threads: [{ ...thread, id: generatedId, setupPassageIds: ["passage-a"] }],
      generatedIds: [{ entityKind: "thread", logicalKey: "cross-unit-thread", id: generatedId }],
    });
    const consumer = candidate("2".repeat(64), {
      passages: [{ ...passage(), setupThreadIds: ["thread-a", generatedId] }], choices: [], threads: [],
    });
    const result = consolidatePassagePlanningCandidates([
      input("candidate-producer", "unit-producer", 0, producer, context(other)),
      input("candidate-consumer", "unit-consumer", 1, consumer),
    ]);
    expect(result.groups).toHaveLength(2);
    expect(result.groups[1].dependsOnGroupIds).toEqual([result.groups[0].id]);
    expect(result.groups[1].safeToApplyIndependently).toBe(false);
  });
});
