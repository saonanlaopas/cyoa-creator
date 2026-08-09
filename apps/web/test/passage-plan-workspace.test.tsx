// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PassagePlanWorkspace } from "../src/features/workspace/PassagePlanWorkspace.js";

const structure = {
  schemaVersion: 1 as const,
  title: "Dashboard plan",
  projectWordTarget: 1_000,
  typicalPathWordTarget: 1_000,
  startPassageId: "passage-start",
  acts: [{
    id: "act-1",
    label: "Act One",
    purpose: "",
    summary: "",
    wordTarget: 1_000,
    routeIds: ["route-1"],
    sequenceIds: ["sequence-1"],
    position: 0,
  }],
  sequences: [{
    id: "sequence-1",
    actId: "act-1",
    label: "Sequence One",
    purpose: "",
    summary: "",
    wordTarget: 1_000,
    routeIds: ["route-1"],
    passageIds: ["passage-start", "passage-end"],
    entryGoals: [],
    exitGoals: [],
    requiredDecisionIds: [],
    endingHookIds: [],
    position: 0,
    planningStatus: "planned" as const,
  }],
  characterAvailability: [],
};
const passages = [
  {
    id: "passage-start",
    sequenceId: "sequence-1",
    title: "Start",
    kind: "scene" as const,
    purpose: "",
    summary: "",
    wordTarget: 500,
    routeIds: ["route-1"],
    tags: [],
    characterIds: [],
    relationshipIds: [],
    locationIds: [],
    requiredFactIds: [],
    revealedFactIds: [],
    setupThreadIds: [],
    payoffThreadIds: [],
    preservedDifferenceIds: [],
    choiceIds: ["choice-1"],
    terminal: false,
    endingId: null,
    draftingNotes: [],
    unresolvedQuestions: [],
    planningStatus: "planned" as const,
    position: 0,
  },
  {
    id: "passage-end",
    sequenceId: "sequence-1",
    title: "Ending",
    kind: "epilogue" as const,
    purpose: "",
    summary: "",
    wordTarget: 500,
    routeIds: ["route-1"],
    tags: [],
    characterIds: [],
    relationshipIds: [],
    locationIds: [],
    requiredFactIds: [],
    revealedFactIds: [],
    setupThreadIds: [],
    payoffThreadIds: [],
    preservedDifferenceIds: [],
    choiceIds: [],
    terminal: true,
    endingId: "ending-1",
    draftingNotes: [],
    unresolvedQuestions: [],
    planningStatus: "planned" as const,
    position: 1,
  },
];
const choice = {
  id: "choice-1",
  sourcePassageId: "passage-start",
  label: "Continue",
  destinationPassageId: "passage-end",
  narrativeIntent: "",
  consequencePreview: "",
  condition: { kind: "compare" as const, mechanicKey: "resolve", operator: "gte" as const, value: 1 },
  unavailableBehavior: "disabled" as const,
  unavailableExplanation: "",
  effects: [],
  sourceDecisionIds: [],
  position: 0,
};
const finding = {
  code: "choice.always-unavailable",
  severity: "warning" as const,
  entityType: "choice" as const,
  entityId: "choice-1",
  message: "Choice appears always disabled.",
  evidence: ["resolve"],
  suggestion: "Add a write.",
  acknowledged: false,
};
const state = {
  structure: { id: "structure-v1", projectId: "project-1", version: 1, content: structure, createdAt: "t" },
  passages: passages.map((content) => ({
    id: `${content.id}-v1`,
    projectId: "project-1",
    entityKind: "passage" as const,
    entityId: content.id,
    version: 1,
    content,
    createdAt: "t",
  })),
  choices: [{
    id: "choice-v1",
    projectId: "project-1",
    entityKind: "choice" as const,
    entityId: choice.id,
    version: 1,
    content: choice,
    createdAt: "t",
  }],
  threads: [],
  state: { projectId: "project-1", status: "draft" as const, approvedSnapshotId: null, updatedAt: "t" },
  snapshots: [],
  report: {
    findings: [finding],
    budgets: {
      project: { target: 1_000, planned: 1_000, difference: 0 },
      acts: [{ id: "act-1", target: 1_000, planned: 1_000, difference: 0 }],
      sequences: [{ id: "sequence-1", target: 1_000, planned: 1_000, difference: 0 }],
      routes: [{ id: "route-1", target: 1_000, planned: 1_000, difference: 0 }],
    },
    coverage: {
      reachablePassageIds: ["passage-start"],
      unreachablePassageIds: ["passage-end"],
      endingCoverage: [{ endingId: "ending-1", incomingPassageIds: [], plausible: false }],
      routeCoverage: [{ routeId: "route-1", passageCount: 2, endingCount: 0 }],
      pathWords: { minimum: null, maximum: null, representative: null, truncated: false },
      mechanicCoverage: [{ key: "resolve", reads: [], writes: [] }],
    },
  },
};

afterEach(() => vi.restoreAllMocks());

describe("PassagePlanWorkspace coverage dashboard", () => {
  it("shows conservative coverage and links a finding to its exact choice editor", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = String(input);
      const body = path.includes("/drafts/passages/") ? {
        passagePlanVersionId: "passage-start-v1",
        passagePlan: passages[0],
        head: null,
        history: [],
        summary: {
          passageCount: 2, currentDraftCount: 0, acceptedDraftCount: 0,
          currentCandidateWords: 0, acceptedWords: 0, plannedWords: 1_000, remainingWords: 1_000,
        },
      } : path.endsWith("/versions") ? [] : state;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const user = userEvent.setup();
    render(<PassagePlanWorkspace
      projectId="project-1"
      mechanicsApproved
      bible={null}
      routes={{ schemaVersion: 1, title: "Routes", overview: "", projectWordTarget: 1_000, sharedWordTarget: 0,
        routeWordTarget: 1_000, routes: [{ id: "route-1", name: "Route", premise: "", emotionalArc: "", thematicQuestion: "",
          entryCondition: "", signatureChoices: [], relationshipTrajectory: [], exclusiveWordTarget: 1_000 }],
        acts: [], decisionPoints: [], reconvergences: [], endingHooks: [], unresolvedQuestions: [] }}
      endings={{ schemaVersion: 1, title: "Endings", overview: "", projectWordTarget: 1_000, endingWordTarget: 500,
        endings: [{ id: "ending-1", hookId: "hook-1", routeId: "route-1", title: "Ending", type: "success",
          summary: "", thematicPayoff: "", wordTarget: 500, requirements: [], exclusions: [],
          contributingDecisionIds: [], foreshadowing: [], characterOutcomes: [], relationshipOutcomes: [],
          stateConsequences: [], variants: [] }], unresolvedQuestions: [] }}
      mechanics={{ schemaVersion: 1, title: "Mechanics", overview: "",
        visibleStats: [{ id: "stat-1", key: "resolve", label: "Resolve", description: "", minimum: 0, maximum: 10,
          initial: 0, increaseSignals: [], decreaseSignals: [] }],
        relationships: [], flags: [], resources: [], gates: [], choiceEffectPlans: [], balancingRules: [], unresolvedQuestions: [] }}
      message={null}
      setMessage={vi.fn()}
    />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Passage plan" })).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "Coverage & findings (1)" }));
    expect(screen.getByText(/Static analysis is conservative/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Ending coverage" })).toBeTruthy();
    expect(screen.getByText("No plausible path")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "choice · choice-1" }));
    expect(await screen.findByText("Continue → passage-end")).toBeTruthy();
    expect(screen.getByLabelText("Destination")).toBeTruthy();
  });
});
