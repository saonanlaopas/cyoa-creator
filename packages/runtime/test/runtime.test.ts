import { describe, expect, it } from "vitest";
import {
  DEFAULT_DETERMINISTIC_PATH_POLICY,
  RuntimeCompileError,
  RuntimeSemanticError,
  applyRuntimeChoice,
  applyRuntimeEffects,
  compileRuntime,
  createInitialRuntimeState,
  createRuntimeMechanicRegistry,
  evaluateRuntimeCondition,
  initializeRuntimeState,
  listRuntimeChoices,
  runDeterministicPath,
  type RuntimeCompileSource,
  type RuntimeEffect,
} from "../src/index.js";

function source(): RuntimeCompileSource {
  return {
    snapshotId: "snapshot-1",
    structureVersionId: "structure-1",
    startPassageId: "passage-start",
    passageVersions: [
      {
        versionId: "pv-start", id: "passage-start", choiceIds: ["choice-trust", "choice-skip", "choice-hidden"],
        terminal: false, endingId: null, routeIds: [], requiredFactIds: [], revealedFactIds: ["fact-opening"],
      },
      {
        versionId: "pv-route", id: "passage-route", choiceIds: ["choice-end"], terminal: false,
        endingId: null, routeIds: ["route-1"], requiredFactIds: ["fact-opening"], revealedFactIds: [],
      },
      {
        versionId: "pv-other", id: "passage-other", choiceIds: ["choice-other"], terminal: false,
        endingId: null, routeIds: [], requiredFactIds: [], revealedFactIds: [],
      },
      {
        versionId: "pv-ending", id: "passage-ending", choiceIds: [], terminal: true,
        endingId: "ending-1", routeIds: ["route-1"], requiredFactIds: [], revealedFactIds: [],
      },
    ],
    choiceVersions: [
      {
        versionId: "cv-trust", id: "choice-trust", sourcePassageId: "passage-start", destinationPassageId: "passage-route",
        condition: { kind: "compare", mechanicKey: "resolve", operator: "gte", value: 0 },
        unavailableBehavior: "disabled", unavailableExplanation: "Need resolve",
        effects: [
          { id: "effect-resolve", mechanicKey: "resolve", operation: "add", value: 2, feedback: "", visibility: "visible" },
          { id: "effect-trust", mechanicKey: "relationship_1", operation: "add", value: 3, feedback: "", visibility: "visible" },
          { id: "effect-flag", mechanicKey: "committed", operation: "set", value: true, feedback: "", visibility: "hidden" },
        ],
        sourceDecisionIds: ["decision-route"], position: 0,
      },
      {
        versionId: "cv-skip", id: "choice-skip", sourcePassageId: "passage-start", destinationPassageId: "passage-route",
        condition: null, unavailableBehavior: "disabled", unavailableExplanation: "", effects: [], sourceDecisionIds: [], position: 1,
      },
      {
        versionId: "cv-hidden", id: "choice-hidden", sourcePassageId: "passage-start", destinationPassageId: "passage-route",
        condition: { kind: "compare", mechanicKey: "resolve", operator: "gte", value: 5 },
        unavailableBehavior: "hidden", unavailableExplanation: "Secret", effects: [], sourceDecisionIds: [], position: 2,
      },
      {
        versionId: "cv-end", id: "choice-end", sourcePassageId: "passage-route", destinationPassageId: "passage-ending",
        condition: {
          kind: "all", items: [
            { kind: "compare", mechanicKey: "committed", operator: "eq", value: true },
            { kind: "visit-count", passageId: "passage-start", operator: "gte", value: 1 },
          ],
        },
        unavailableBehavior: "disabled", unavailableExplanation: "Commit first",
        effects: [{ id: "effect-coins", mechanicKey: "coins", operation: "add", value: 5, feedback: "", visibility: "visible" }],
        sourceDecisionIds: [], position: 0,
      },
      {
        versionId: "cv-other", id: "choice-other", sourcePassageId: "passage-other", destinationPassageId: "passage-ending",
        condition: null, unavailableBehavior: "disabled", unavailableExplanation: "", effects: [], sourceDecisionIds: [], position: 0,
      },
    ],
    threadVersionIds: ["tv-1"],
    routeIds: ["route-1"],
    routeDecisionIds: ["decision-route"],
    endings: [{ id: "ending-1", routeId: "route-1" }],
    mechanics: {
      visibleStats: [{ key: "resolve", minimum: -5, maximum: 10, initial: 0 }],
      relationships: [{
        key: "relationship_1", minimum: -5, maximum: 10, initial: 0,
        bands: [{ minimum: -5, label: "Hostile" }, { minimum: 3, label: "Trusted" }],
      }],
      flags: [{ key: "committed" }],
      resources: [
        { key: "coins", kind: "currency", initial: 0 },
        { key: "clue", kind: "inventory", initial: 0 },
      ],
      gates: [{
        id: "gate-ending", targetType: "ending", targetId: "ending-1", logic: "all",
        conditions: [{ id: "gate-trust", mechanicKey: "relationship_1", operator: "at-least", value: 3 }],
      }],
    },
  };
}

const path = (choiceIds: string[]) => ({ choiceIds, policy: { ...DEFAULT_DETERMINISTIC_PATH_POLICY } });

describe("Foundation 5A pure runtime", () => {
  it("compiles deterministically from runtime-relevant fields and initializes exact state", () => {
    const input = source();
    const first = compileRuntime(input);
    const second = compileRuntime({ ...input, passageVersions: input.passageVersions.map((item) => ({ ...item })) });
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(initializeRuntimeState(first)).toEqual({
      currentPassageId: "passage-start",
      stats: { resolve: 0 },
      relationships: { relationship_1: 0 },
      flags: { committed: false },
      resources: { clue: "", coins: 0 },
      decisions: [], routes: [], knownFacts: ["fact-opening"], visitCounts: { "passage-start": 1 }, turn: 0,
    });

    const changed = source();
    changed.choiceVersions[0]!.effects[0]!.value = 3;
    expect(compileRuntime(changed).fingerprint).not.toBe(first.fingerprint);

    const cosmetic = source() as RuntimeCompileSource & { projectTitle?: string };
    cosmetic.projectTitle = "Cosmetic authoring label excluded from runtime";
    cosmetic.snapshotId = "snapshot-cosmetic-only";
    cosmetic.structureVersionId = "structure-cosmetic-only";
    expect(compileRuntime(cosmetic).fingerprint).toBe(first.fingerprint);
  });

  it("evaluates every accepted condition form with boundaries and rejects unknown or wrong types", () => {
    const registry = createRuntimeMechanicRegistry(source().mechanics);
    const state = createInitialRuntimeState("passage-start", registry);
    state.visitCounts["passage-start"] = 1;
    expect(evaluateRuntimeCondition({ kind: "compare", mechanicKey: "resolve", operator: "gte", value: 0 }, state, registry)).toBe(true);
    expect(evaluateRuntimeCondition({ kind: "compare", mechanicKey: "resolve", operator: "lt", value: 0 }, state, registry)).toBe(false);
    expect(evaluateRuntimeCondition({ kind: "visit-count", passageId: "passage-start", operator: "eq", value: 1 }, state, registry)).toBe(true);
    expect(evaluateRuntimeCondition({ kind: "not", item: { kind: "compare", mechanicKey: "committed", operator: "eq", value: true } }, state, registry)).toBe(true);
    expect(evaluateRuntimeCondition({ kind: "all", items: [
      { kind: "compare", mechanicKey: "resolve", operator: "eq", value: 0 },
      { kind: "compare", mechanicKey: "committed", operator: "eq", value: false },
    ] }, state, registry)).toBe(true);
    expect(evaluateRuntimeCondition({ kind: "any", items: [
      { kind: "compare", mechanicKey: "resolve", operator: "gt", value: 10 },
      { kind: "compare", mechanicKey: "committed", operator: "eq", value: false },
    ] }, state, registry)).toBe(true);
    expect(() => evaluateRuntimeCondition(
      { kind: "compare", mechanicKey: "missing", operator: "eq", value: 0 }, state, registry,
    )).toThrow(RuntimeSemanticError);
    expect(() => evaluateRuntimeCondition(
      { kind: "compare", mechanicKey: "resolve", operator: "eq", value: "wrong" }, state, registry,
    )).toThrow("Invalid condition");
  });

  it("applies all current effect forms in order and rejects invalid or out-of-bounds effects atomically", () => {
    const registry = createRuntimeMechanicRegistry(source().mechanics);
    const state = createInitialRuntimeState("passage-start", registry);
    const effects: RuntimeEffect[] = [
      { id: "stat", mechanicKey: "resolve", operation: "add", value: 2, feedback: "", visibility: "visible" },
      { id: "stat-subtract", mechanicKey: "resolve", operation: "subtract", value: 1, feedback: "", visibility: "visible" },
      { id: "relationship", mechanicKey: "relationship_1", operation: "set", value: 4, feedback: "", visibility: "visible" },
      { id: "flag", mechanicKey: "committed", operation: "set", value: true, feedback: "", visibility: "hidden" },
      { id: "resource", mechanicKey: "coins", operation: "add", value: 5, feedback: "", visibility: "visible" },
      { id: "inventory", mechanicKey: "clue", operation: "set", value: "clue-1", feedback: "", visibility: "visible" },
      { id: "clear", mechanicKey: "committed", operation: "clear", value: null, feedback: "", visibility: "hidden" },
    ];
    const applied = applyRuntimeEffects(state, effects, registry);
    expect(applied.state).toMatchObject({
      stats: { resolve: 1 }, relationships: { relationship_1: 4 }, flags: { committed: false },
      resources: { coins: 5, clue: "clue-1" },
    });
    expect(applied.deltas.map((item) => item.path)).toEqual([
      "stat.resolve", "stat.resolve", "relationship.relationship_1", "flag.committed",
      "resource.coins", "resource.clue", "flag.committed",
    ]);
    expect(() => applyRuntimeEffects(state, [{
      id: "wrong", mechanicKey: "committed", operation: "add", value: 1, feedback: "", visibility: "visible",
    }], registry)).toThrow("Invalid effect");
    expect(() => applyRuntimeEffects(state, [{
      id: "overflow", mechanicKey: "resolve", operation: "add", value: 11, feedback: "", visibility: "visible",
    }], registry)).toThrow("outside its bounds");
    expect(state.stats.resolve).toBe(0);
  });

  it("traverses exact stable choice IDs with exact state, decision, route, relationship, and ending evidence", () => {
    const runtime = compileRuntime(source());
    const firstTransition = applyRuntimeChoice(runtime, "input-fingerprint", initializeRuntimeState(runtime), "choice-trust", 0);
    expect(firstTransition).toMatchObject({
      ok: true,
      state: { currentPassageId: "passage-route", stats: { resolve: 2 }, relationships: { relationship_1: 3 } },
      step: { passageId: "passage-start", selectedChoiceId: "choice-trust", nextPassageId: "passage-route" },
    });
    const trace = runDeterministicPath(runtime, "input-fingerprint", path(["choice-trust", "choice-end"]));
    expect(trace.visitedPassageIds).toEqual(["passage-start", "passage-route", "passage-ending"]);
    expect(trace.selectedChoiceIds).toEqual(["choice-trust", "choice-end"]);
    expect(trace.finalState).toMatchObject({
      currentPassageId: "passage-ending", stats: { resolve: 2 }, relationships: { relationship_1: 3 },
      flags: { committed: true }, resources: { coins: 5 }, decisions: ["decision-route"], routes: ["route-1"], turn: 2,
    });
    expect(trace.result).toEqual({ kind: "completed-ending", passageId: "passage-ending", endingId: "ending-1", eligible: true });
    expect(trace.steps[0]).toMatchObject({
      passageId: "passage-start", selectedChoiceId: "choice-trust", nextPassageId: "passage-route",
      availability: { visible: true, enabled: true, conditionResult: true },
    });
    expect(trace.steps[0]!.stateDelta).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "relationships.relationship_1", before: 0, after: 3 }),
      expect.objectContaining({ path: "decisions", after: "decision-route" }),
      expect.objectContaining({ path: "routes", after: "route-1" }),
    ]));
  });

  it("rejects wrong-source, unavailable, and missing-destination choices with exact findings", () => {
    const runtime = compileRuntime(source());
    const wrongSource = runDeterministicPath(runtime, "input", path(["choice-other"]));
    expect(wrongSource.result.kind).toBe("blocked");
    expect(wrongSource.findings[0]).toMatchObject({
      code: "runtime.choice-wrong-source", passageId: "passage-start", choiceId: "choice-other", stepIndex: 0,
    });
    const unavailable = runDeterministicPath(runtime, "input", path(["choice-hidden"]));
    expect(unavailable.findings[0]).toMatchObject({ code: "runtime.choice-unavailable", choiceId: "choice-hidden" });

    const corrupted = structuredClone(runtime);
    delete corrupted.passages["passage-route"];
    const missing = runDeterministicPath(corrupted, "input", path(["choice-trust"]));
    expect(missing.findings[0]).toMatchObject({
      code: "runtime.destination-missing", passageId: "passage-route", choiceId: "choice-trust",
    });
  });

  it("preserves hidden versus disabled availability and stable-ID behavior independent of entity ordering", () => {
    const input = source();
    const runtime = compileRuntime(input);
    const availability = listRuntimeChoices(runtime, initializeRuntimeState(runtime));
    expect(availability.find((item) => item.choiceId === "choice-hidden")).toMatchObject({
      visible: false, enabled: false, reason: "Secret",
    });
    expect(availability.find((item) => item.choiceId === "choice-trust")).toMatchObject({
      visible: true, enabled: true,
    });
    const disabledInput = source();
    disabledInput.choiceVersions.find((item) => item.id === "choice-trust")!.condition = {
      kind: "compare", mechanicKey: "resolve", operator: "gte", value: 5,
    };
    const disabledRuntime = compileRuntime(disabledInput);
    expect(listRuntimeChoices(disabledRuntime, initializeRuntimeState(disabledRuntime))
      .find((item) => item.choiceId === "choice-trust")).toMatchObject({ visible: true, enabled: false, reason: "Need resolve" });

    const reordered = source();
    reordered.passageVersions.reverse();
    reordered.choiceVersions.reverse();
    expect(compileRuntime(reordered).fingerprint).toBe(runtime.fingerprint);
    expect(runDeterministicPath(compileRuntime(reordered), "input", path(["choice-trust", "choice-end"])).result.kind)
      .toBe("completed-ending");
  });

  it("resolves satisfied and unsatisfied ending gates and rejects invalid terminal compilation", () => {
    const runtime = compileRuntime(source());
    expect(runDeterministicPath(runtime, "input", path(["choice-trust", "choice-end"])).result.kind)
      .toBe("completed-ending");

    const noTrust = source();
    noTrust.choiceVersions.find((item) => item.id === "choice-end")!.condition = null;
    const ineligible = runDeterministicPath(compileRuntime(noTrust), "input", path(["choice-skip", "choice-end"]));
    expect(ineligible.result).toMatchObject({ kind: "ending-ineligible", endingId: "ending-1", eligible: false });
    expect(ineligible.findings[0]).toMatchObject({ code: "runtime.ending-ineligible", endingId: "ending-1" });

    const invalid = source();
    invalid.passageVersions.find((item) => item.id === "passage-ending")!.endingId = null;
    expect(() => compileRuntime(invalid)).toThrow(RuntimeCompileError);
  });

  it("produces identical traces and fingerprints without wall-clock identity", () => {
    const runtime = compileRuntime(source());
    const definition = path(["choice-trust", "choice-end"]);
    const first = runDeterministicPath(runtime, "input-fingerprint", definition);
    const second = runDeterministicPath(runtime, "input-fingerprint", definition);
    expect(second).toEqual(first);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(JSON.stringify(first)).not.toMatch(/createdAt|timestamp|selectedAt/);
  });

  it("stops cycles and step exhaustion deterministically without reporting success", () => {
    const looping = source();
    looping.passageVersions = [{
      versionId: "pv-loop", id: "passage-loop", choiceIds: ["choice-loop"], terminal: false,
      endingId: null, routeIds: [], requiredFactIds: [], revealedFactIds: [],
    }];
    looping.choiceVersions = [{
      versionId: "cv-loop", id: "choice-loop", sourcePassageId: "passage-loop", destinationPassageId: "passage-loop",
      condition: null, unavailableBehavior: "disabled", unavailableExplanation: "", effects: [], sourceDecisionIds: [], position: 0,
    }];
    looping.startPassageId = "passage-loop";
    looping.endings = [];
    looping.routeIds = [];
    looping.mechanics.gates = [];
    const runtime = compileRuntime(looping);
    const cycle = runDeterministicPath(runtime, "input", {
      choiceIds: ["choice-loop", "choice-loop", "choice-loop"],
      policy: { ...DEFAULT_DETERMINISTIC_PATH_POLICY, maxVisitsPerPassage: 2 },
    });
    expect(cycle.result.kind).toBe("cycle-guard-reached");
    expect(cycle.findings[0]).toMatchObject({ code: "runtime.cycle-guard-reached", passageId: "passage-loop", stepIndex: 1 });
    const limited = runDeterministicPath(runtime, "input", {
      choiceIds: ["choice-loop", "choice-loop"],
      policy: { ...DEFAULT_DETERMINISTIC_PATH_POLICY, maxSteps: 1, maxVisitsPerPassage: 20 },
    });
    expect(limited.result.kind).toBe("step-limit-reached");
    expect(limited.findings[0]?.code).toBe("runtime.step-limit-reached");
  });

  it("enforces trace bytes and records deterministic expectation findings at exact steps", () => {
    const runtime = compileRuntime(source());
    const traceLimited = runDeterministicPath(runtime, "bounded-input", {
      choiceIds: ["choice-trust", "choice-end"],
      policy: { ...DEFAULT_DETERMINISTIC_PATH_POLICY, maxTraceBytes: 1_000 },
    });
    expect(traceLimited.result.kind).toBe("trace-limit-reached");
    expect(traceLimited.findings[0]).toMatchObject({
      code: "runtime.trace-limit-reached", stepIndex: 0, passageId: "passage-route", choiceId: "choice-trust",
      simulationInputFingerprint: "bounded-input", compiledRuntimeFingerprint: runtime.fingerprint,
    });

    const asserted = runDeterministicPath(runtime, "asserted-input", {
      choiceIds: ["choice-trust", "choice-end"],
      expectedEndingId: "ending-other",
      expectedState: { stats: { resolve: 9 }, relationships: { relationship_1: 3 } },
      policy: { ...DEFAULT_DETERMINISTIC_PATH_POLICY },
    });
    expect(asserted.findings.map((finding) => ({ code: finding.code, stepIndex: finding.stepIndex }))).toEqual([
      { code: "runtime.expected-ending-mismatch", stepIndex: 2 },
      { code: "runtime.expected-state-mismatch", stepIndex: 2 },
    ]);
    expect(runDeterministicPath(runtime, "asserted-input", asserted.path)).toEqual(asserted);
  });

  it("compiles and runs a deterministic 300-passage path with trace growth limited to visited steps", () => {
    const large = source();
    large.routeIds = ["route-large"];
    large.routeDecisionIds = [];
    large.endings = [{ id: "ending-large", routeId: "route-large" }];
    large.mechanics.gates = [];
    large.passageVersions = Array.from({ length: 300 }, (_, index) => ({
      versionId: `pv-${index}`,
      id: `passage-${index}`,
      choiceIds: index === 299 ? [] : [`choice-${index}`],
      terminal: index === 299,
      endingId: index === 299 ? "ending-large" : null,
      routeIds: ["route-large"], requiredFactIds: [], revealedFactIds: [],
    }));
    large.choiceVersions = Array.from({ length: 299 }, (_, index) => ({
      versionId: `cv-${index}`, id: `choice-${index}`, sourcePassageId: `passage-${index}`,
      destinationPassageId: `passage-${index + 1}`, condition: null as null,
      unavailableBehavior: "disabled" as const, unavailableExplanation: "", effects: [], sourceDecisionIds: [], position: 0,
    }));
    large.startPassageId = "passage-0";
    const runtime = compileRuntime(large);
    const trace = runDeterministicPath(runtime, "large-input", path(Array.from({ length: 299 }, (_, index) => `choice-${index}`)));
    expect(trace.result).toMatchObject({ kind: "completed-ending", endingId: "ending-large" });
    expect(trace.visitedPassageIds).toHaveLength(300);
    expect(trace.steps).toHaveLength(299);
    expect(trace.selectedChoiceIds).toHaveLength(299);
  });
});
