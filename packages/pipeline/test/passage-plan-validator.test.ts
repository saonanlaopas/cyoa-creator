import { describe, expect, it } from "vitest";
import {
  defaultLongFormEndingPlan,
  defaultLongFormMechanicsPlan,
  defaultLongFormRoutePlan,
  defaultLongFormStoryBible,
  defaultProjectBrief,
  validatePassagePlan,
  type PassagePlanBundle,
} from "../src/index.js";
import {
  RuntimeCompileError,
  compileRuntime,
  conditionStaticTruth,
  createInitialRuntimeState,
  createRuntimeMechanicRegistry,
  effectCompatible,
  evaluateRuntimeCondition,
  type RuntimeCompileSource,
} from "@story-to-cyoa/runtime";

function fixture() {
  const brief = defaultProjectBrief("Validator");
  const bibleSeed = defaultLongFormStoryBible({ title: brief.workingTitle, protagonist: "Mara" });
  const bible = {
    ...bibleSeed,
    canonFacts: [{
      id: "fact-secret",
      statement: "The professor knows the hidden rule.",
      sourceExcerptIds: [],
      confidence: "confirmed" as const,
    }],
  };
  const routeSeed = defaultLongFormRoutePlan(brief);
  const route = routeSeed.routes[0]!;
  const routes = {
    ...routeSeed,
    routes: [route],
    acts: routeSeed.acts.filter((act) => !act.routeId || act.routeId === route.id),
  };
  const endingSeed = defaultLongFormEndingPlan(routeSeed);
  const ending = endingSeed.endings.find((item) => item.routeId === route.id)!;
  const endings = { ...endingSeed, endings: [ending], endingWordTarget: ending.wordTarget };
  const mechanicSeed = defaultLongFormMechanicsPlan(bible, endings);
  const mechanics = {
    ...mechanicSeed,
    visibleStats: [mechanicSeed.visibleStats.find((item) => item.key === "resolve")!],
    relationships: [],
    flags: [],
    resources: [],
  };
  const bundle: PassagePlanBundle = {
    schemaVersion: 1,
    structure: {
      schemaVersion: 1,
      title: "Validated plan",
      projectWordTarget: 1_500,
      typicalPathWordTarget: 1_500,
      startPassageId: "passage-start",
      acts: [{
        id: "act-main",
        label: "Main act",
        purpose: "",
        summary: "",
        wordTarget: 1_500,
        routeIds: [route.id],
        sequenceIds: ["sequence-main"],
        position: 0,
      }],
      sequences: [{
        id: "sequence-main",
        actId: "act-main",
        label: "Main sequence",
        purpose: "",
        summary: "",
        wordTarget: 1_500,
        routeIds: [route.id],
        passageIds: ["passage-start", "passage-gate", "passage-ending"],
        entryGoals: [],
        exitGoals: [],
        requiredDecisionIds: [],
        endingHookIds: [],
        position: 0,
        planningStatus: "planned",
      }],
      characterAvailability: [{
        characterId: "character-protagonist",
        actIds: ["act-main"],
        routeIds: [route.id],
      }],
    },
    passages: [
      {
        id: "passage-start",
        sequenceId: "sequence-main",
        title: "Start",
        kind: "scene",
        purpose: "",
        summary: "",
        wordTarget: 500,
        routeIds: [route.id],
        tags: [],
        characterIds: ["character-protagonist"],
        relationshipIds: [],
        locationIds: [],
        requiredFactIds: [],
        revealedFactIds: ["fact-secret"],
        setupThreadIds: ["thread-secret"],
        payoffThreadIds: [],
        preservedDifferenceIds: [],
        choiceIds: ["choice-write"],
        terminal: false,
        endingId: null,
        draftingNotes: [],
        unresolvedQuestions: [],
        planningStatus: "planned",
        position: 0,
      },
      {
        id: "passage-gate",
        sequenceId: "sequence-main",
        title: "Gate",
        kind: "climax",
        purpose: "",
        summary: "",
        wordTarget: 500,
        routeIds: [route.id],
        tags: [],
        characterIds: ["character-protagonist"],
        relationshipIds: [],
        locationIds: [],
        requiredFactIds: ["fact-secret"],
        revealedFactIds: [],
        setupThreadIds: [],
        payoffThreadIds: ["thread-secret"],
        preservedDifferenceIds: [],
        choiceIds: ["choice-gate"],
        terminal: false,
        endingId: null,
        draftingNotes: [],
        unresolvedQuestions: [],
        planningStatus: "planned",
        position: 1,
      },
      {
        id: "passage-ending",
        sequenceId: "sequence-main",
        title: "Ending",
        kind: "epilogue",
        purpose: "",
        summary: "",
        wordTarget: 500,
        routeIds: [route.id],
        tags: ["ending"],
        characterIds: ["character-protagonist"],
        relationshipIds: [],
        locationIds: [],
        requiredFactIds: [],
        revealedFactIds: [],
        setupThreadIds: [],
        payoffThreadIds: [],
        preservedDifferenceIds: [],
        choiceIds: [],
        terminal: true,
        endingId: ending.id,
        draftingNotes: [],
        unresolvedQuestions: [],
        planningStatus: "planned",
        position: 2,
      },
    ],
    choices: [
      {
        id: "choice-write",
        sourcePassageId: "passage-start",
        label: "Act",
        destinationPassageId: "passage-gate",
        narrativeIntent: "",
        consequencePreview: "",
        condition: null,
        unavailableBehavior: "disabled",
        unavailableExplanation: "",
        effects: [{
          id: "effect-resolve",
          mechanicKey: "resolve",
          operation: "add",
          value: 1,
          feedback: "",
          visibility: "visible",
        }],
        sourceDecisionIds: [],
        position: 0,
      },
      {
        id: "choice-gate",
        sourcePassageId: "passage-gate",
        label: "Finish",
        destinationPassageId: "passage-ending",
        narrativeIntent: "",
        consequencePreview: "",
        condition: { kind: "compare", mechanicKey: "resolve", operator: "gte", value: 1 },
        unavailableBehavior: "disabled",
        unavailableExplanation: "",
        effects: [],
        sourceDecisionIds: [],
        position: 0,
      },
    ],
    threads: [{
      id: "thread-secret",
      label: "Secret",
      description: "",
      setupPassageIds: ["passage-start"],
      payoffPassageIds: ["passage-gate"],
      routeIds: [route.id],
      required: true,
      status: "covered",
      waiverRationale: "",
    }],
  };
  return { bible, routes, endings, mechanics, bundle };
}

function runtimeSource(input: ReturnType<typeof fixture>): RuntimeCompileSource {
  return {
    snapshotId: "snapshot-contract",
    structureVersionId: "structure-contract",
    startPassageId: input.bundle.structure.startPassageId,
    passageVersions: input.bundle.passages.map((passage) => ({ versionId: `pv-${passage.id}`, ...passage })),
    choiceVersions: input.bundle.choices.map((choice) => ({ versionId: `cv-${choice.id}`, ...choice })),
    threadVersionIds: input.bundle.threads.map((thread) => `tv-${thread.id}`),
    routeIds: input.routes.routes.map((route) => route.id),
    routeDecisionIds: input.routes.decisionPoints.map((decision) => decision.id),
    endings: input.endings.endings.map((ending) => ({ id: ending.id, routeId: ending.routeId })),
    mechanics: input.mechanics,
  };
}

describe("passage-plan structural validator", () => {
  it("reports executable coverage and path budgets for a coherent plan", () => {
    const input = fixture();
    const report = validatePassagePlan(input);

    expect(report.findings.filter((finding) => finding.severity === "error")).toEqual([]);
    expect(report.coverage.reachablePassageIds).toEqual([
      "passage-start", "passage-gate", "passage-ending",
    ]);
    expect(report.coverage.endingCoverage).toEqual([{
      endingId: input.endings.endings[0]!.id,
      incomingPassageIds: ["passage-ending"],
      plausible: true,
    }]);
    expect(report.coverage.mechanicCoverage).toEqual([{
      key: "resolve",
      reads: ["choice-gate"],
      writes: ["choice-write"],
    }]);
    expect(report.coverage.pathWords).toEqual({
      minimum: 1_500,
      maximum: 1_500,
      representative: 1_500,
      truncated: false,
    });
  });

  it("finds hard graph/state failures and conservative continuity warnings", () => {
    const input = fixture();
    input.bundle.choices[0] = {
      ...input.bundle.choices[0]!,
      effects: [{ ...input.bundle.choices[0]!.effects[0]!, value: "wrong type" }],
    };
    input.bundle.choices[1] = {
      ...input.bundle.choices[1]!,
      condition: { kind: "compare", mechanicKey: "resolve", operator: "gte", value: 1 },
    };
    input.bundle.passages[0] = {
      ...input.bundle.passages[0]!,
      revealedFactIds: [],
      preservedDifferenceIds: ["difference-forgiveness"],
    };
    input.bundle.threads[0] = {
      ...input.bundle.threads[0]!,
      setupPassageIds: [],
    };
    input.bundle.structure.acts.push({
      id: "act-later",
      label: "Later",
      purpose: "",
      summary: "",
      wordTarget: 0,
      routeIds: [],
      sequenceIds: [],
      position: 1,
    });
    input.bundle.structure.characterAvailability[0] = {
      ...input.bundle.structure.characterAvailability[0]!,
      actIds: ["act-later"],
    };

    const report = validatePassagePlan(input);
    const codes = report.findings.map((finding) => finding.code);
    expect(codes).toEqual(expect.arrayContaining([
      "effect.type.invalid",
      "graph.choice.none-plausible",
      "condition.threshold.unreachable",
      "choice.always-unavailable",
      "graph.passage.unreachable",
      "ending.path.none-plausible",
      "continuity.fact.used-before-revelation",
      "continuity.thread.payoff-without-setup",
      "continuity.character.outside-availability",
      "continuity.difference.disappears",
      "mechanic.never-read",
      "mechanic.never-written",
    ]));
    expect(report.findings.find((finding) =>
      finding.code === "choice.always-unavailable")?.message).toContain("disabled");
  });

  it("detects ownership errors and uncontrolled cycles, and only acknowledges warnings", () => {
    const input = fixture();
    input.bundle.passages[2] = {
      ...input.bundle.passages[2]!,
      terminal: false,
      endingId: null,
      choiceIds: ["choice-loop"],
    };
    input.bundle.choices.push({
      id: "choice-loop",
      sourcePassageId: "passage-ending",
      label: "Loop",
      destinationPassageId: "passage-gate",
      narrativeIntent: "",
      consequencePreview: "",
      condition: null,
      unavailableBehavior: "hidden",
      unavailableExplanation: "",
      effects: [],
      sourceDecisionIds: [],
      position: 0,
    });
    input.bundle.choices.push({
      ...input.bundle.choices[0]!,
      id: "choice-orphan",
    });
    const first = validatePassagePlan(input);
    expect(first.findings.map((finding) => finding.code)).toEqual(expect.arrayContaining([
      "choice.source.unlisted",
      "graph.cycle.uncontrolled",
    ]));

    const warning = first.findings.find((finding) => finding.severity === "warning")!;
    const error = first.findings.find((finding) => finding.severity === "error")!;
    const acknowledged = validatePassagePlan({
      ...input,
      overrides: [
        { code: warning.code, entityId: warning.entityId, rationale: "Intentional branch uncertainty." },
        { code: error.code, entityId: error.entityId, rationale: "Must not suppress an error." },
      ],
    });
    expect(acknowledged.findings.find((finding) =>
      finding.code === warning.code && finding.entityId === warning.entityId)).toMatchObject({
      acknowledged: true,
      overrideRationale: "Intentional branch uncertainty.",
    });
    expect(acknowledged.findings.find((finding) =>
      finding.code === error.code && finding.entityId === error.entityId)).toMatchObject({
      acknowledged: false,
    });
  });

  it("shares condition/effect semantics and agrees on terminal failures with the runtime compiler", () => {
    const input = fixture();
    const registry = createRuntimeMechanicRegistry(input.mechanics);
    const maximum = input.mechanics.visibleStats[0]!.maximum;
    const impossible = { kind: "compare" as const, mechanicKey: "resolve", operator: "gte" as const, value: maximum + 1 };
    input.bundle.choices[1] = { ...input.bundle.choices[1]!, condition: impossible };
    expect(conditionStaticTruth(impossible, registry, new Set(["resolve"]))).toBe("always-false");
    expect(evaluateRuntimeCondition(impossible, createInitialRuntimeState("passage-start", registry), registry)).toBe(false);
    expect(validatePassagePlan(input).findings.map((finding) => finding.code)).toEqual(expect.arrayContaining([
      "condition.threshold.unreachable", "choice.always-unavailable",
    ]));

    const invalidEffect = { ...input.bundle.choices[0]!.effects[0]!, value: "wrong type" };
    input.bundle.choices[0] = { ...input.bundle.choices[0]!, effects: [invalidEffect] };
    expect(effectCompatible(invalidEffect, registry.resolve)).toBe(false);
    expect(validatePassagePlan(input).findings.map((finding) => finding.code)).toContain("effect.type.invalid");
    expect(() => compileRuntime(runtimeSource(input))).toThrow(RuntimeCompileError);

    const terminal = fixture();
    terminal.bundle.passages[2] = { ...terminal.bundle.passages[2]!, endingId: null };
    expect(validatePassagePlan(terminal).findings.map((finding) => finding.code)).toContain("graph.terminal.ending-missing");
    try { compileRuntime(runtimeSource(terminal)); throw new Error("Expected runtime compile failure"); }
    catch (error) {
      expect(error).toBeInstanceOf(RuntimeCompileError);
      expect((error as RuntimeCompileError).findings.map((finding) => finding.code)).toContain("runtime.terminal.ending-invalid");
    }
  });
});
