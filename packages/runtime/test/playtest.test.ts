import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DETERMINISTIC_PATH_POLICY,
  DeterministicPlaytestPrng,
  PLAYTEST_BACKEND_LIMITS,
  PLAYTEST_PRNG_VERSION,
  PlaytestIntegrityError,
  PlaytestPolicyError,
  assertPlaytestCampaignIdentity,
  compileRuntime,
  createPlaytestPolicy,
  replayPlaytestSample,
  runPlaytestCampaign,
  serializedBytes,
  type PlaytestAnalysisSource,
  type RuntimeCompileSource,
} from "../src/index.js";

function branchingFixture(): { source: RuntimeCompileSource; analysis: PlaytestAnalysisSource } {
  const passages = [
    { id: "passage-start", choices: ["choice-a", "choice-b", "choice-b-alt"], routeIds: [] as string[] },
    { id: "passage-a-setup", choices: ["choice-a-1"], routeIds: ["route-a"] },
    { id: "passage-a-linear-1", choices: ["choice-a-2"], routeIds: ["route-a"] },
    { id: "passage-a-linear-2", choices: ["choice-a-hub"], routeIds: ["route-a"] },
    { id: "passage-b-payoff", choices: ["choice-b-hub"], routeIds: ["route-b"] },
    { id: "passage-b-alt", choices: ["choice-b-alt-hub"], routeIds: ["route-b"] },
    { id: "passage-hub", choices: ["choice-ending-a", "choice-ending-b", "choice-hidden"], routeIds: [] as string[] },
    { id: "passage-ending-a", choices: [], routeIds: ["route-a"], terminal: true, endingId: "ending-a" },
    { id: "passage-ending-b", choices: [], routeIds: ["route-b"], terminal: true, endingId: "ending-b" },
  ];
  const passageVersions = passages.map((passage) => ({
    versionId: `pv-${passage.id}`,
    id: passage.id,
    choiceIds: passage.choices,
    terminal: passage.terminal ?? false,
    endingId: passage.endingId ?? null,
    routeIds: passage.routeIds,
    requiredFactIds: passage.id === "passage-hub" ? ["fact-secret"] : [],
    revealedFactIds: passage.id === "passage-a-setup" ? ["fact-secret"] : [],
  }));
  const choice = (
    id: string,
    sourcePassageId: string,
    destinationPassageId: string,
    position: number,
    options: Partial<RuntimeCompileSource["choiceVersions"][number]> = {},
  ): RuntimeCompileSource["choiceVersions"][number] => ({
    versionId: `cv-${id}`,
    id,
    sourcePassageId,
    destinationPassageId,
    condition: null,
    unavailableBehavior: "disabled",
    unavailableExplanation: "Unavailable in this state",
    effects: [],
    sourceDecisionIds: [],
    position,
    ...options,
  });
  const choiceVersions = [
    choice("choice-a", "passage-start", "passage-a-setup", 0, {
      effects: [
        { id: "effect-resolve", mechanicKey: "resolve", operation: "add", value: 2, feedback: "", visibility: "visible" },
        { id: "effect-bond", mechanicKey: "bond", operation: "add", value: 2, feedback: "", visibility: "visible" },
        { id: "effect-tokens", mechanicKey: "tokens", operation: "add", value: 1, feedback: "", visibility: "visible" },
      ],
      sourceDecisionIds: ["decision-a"],
    }),
    choice("choice-b", "passage-start", "passage-b-payoff", 1, { sourceDecisionIds: ["decision-b"] }),
    choice("choice-b-alt", "passage-start", "passage-b-alt", 2, { sourceDecisionIds: ["decision-b"] }),
    choice("choice-a-1", "passage-a-setup", "passage-a-linear-1", 0),
    choice("choice-a-2", "passage-a-linear-1", "passage-a-linear-2", 0),
    choice("choice-a-hub", "passage-a-linear-2", "passage-hub", 0),
    choice("choice-b-hub", "passage-b-payoff", "passage-hub", 0),
    choice("choice-b-alt-hub", "passage-b-alt", "passage-hub", 0),
    choice("choice-ending-a", "passage-hub", "passage-ending-a", 0, {
      condition: { kind: "compare", mechanicKey: "resolve", operator: "gte", value: 1 },
    }),
    choice("choice-ending-b", "passage-hub", "passage-ending-b", 1),
    choice("choice-hidden", "passage-hub", "passage-ending-a", 2, {
      condition: { kind: "compare", mechanicKey: "resolve", operator: "gte", value: 99 },
      unavailableBehavior: "hidden",
    }),
  ];
  const source: RuntimeCompileSource = {
    snapshotId: "snapshot-playtest",
    structureVersionId: "structure-playtest",
    startPassageId: "passage-start",
    passageVersions,
    choiceVersions,
    threadVersionIds: ["thread-version-1"],
    routeIds: ["route-a", "route-b"],
    routeDecisionIds: ["decision-a", "decision-b"],
    endings: [{ id: "ending-a", routeId: "route-a" }, { id: "ending-b", routeId: "route-b" }],
    mechanics: {
      visibleStats: [{ key: "resolve", minimum: 0, maximum: 10, initial: 0 }],
      relationships: [{ key: "bond", minimum: 0, maximum: 10, initial: 0, bands: [{ minimum: 0, label: "Distant" }] }],
      flags: [],
      resources: [{ key: "tokens", kind: "inventory", initial: 0 }],
      gates: [{
        id: "gate-ending-a", targetType: "ending", targetId: "ending-a", logic: "all",
        conditions: [{ id: "gate-bond", mechanicKey: "bond", operator: "at-least", value: 1 }],
      }],
    },
  };
  const analysis: PlaytestAnalysisSource = {
    passages: Object.fromEntries(passages.map((passage, index) => [passage.id, {
      id: passage.id,
      title: passage.id,
      actId: index < 4 ? "act-1" : "act-2",
      sequenceId: index < 4 ? "sequence-1" : "sequence-2",
      routeIds: passage.routeIds,
      wordTarget: 100 + index,
      wordCount: 100 + index,
      wordBasis: index % 2 === 0 ? "accepted-prose" as const : "planned-target" as const,
      acceptedDraftVersionId: index % 2 === 0 ? `draft-${index}` : null,
      requiredFactIds: passage.id === "passage-hub" ? ["fact-secret"] : [],
      revealedFactIds: passage.id === "passage-a-setup" ? ["fact-secret"] : [],
      setupThreadIds: passage.id === "passage-a-setup" ? ["thread-1"] : [],
      payoffThreadIds: passage.id === "passage-hub" ? ["thread-1"] : [],
      authoredChoiceCount: passage.choices.length,
    }])),
    threads: {
      "thread-1": {
        id: "thread-1", label: "Secret setup", setupPassageIds: ["passage-a-setup"],
        payoffPassageIds: ["passage-hub"], routeIds: [], required: true,
      },
    },
    routeLabels: { "route-a": "Route A", "route-b": "Route B" },
    endingLabels: { "ending-a": "Ending A", "ending-b": "Ending B" },
    mechanicLabels: { resolve: "Resolve", bond: "Bond", tokens: "Tokens" },
  };
  return { source, analysis };
}

function campaign(seed = "campaign-seed", sampleCount = 18) {
  const fixture = branchingFixture();
  const runtime = compileRuntime(fixture.source);
  const policy = createPlaytestPolicy({
    sampleCount,
    maxStepsPerSample: 20,
    linearStretchThreshold: 3,
    denseChoiceThreshold: 3,
  }, DEFAULT_DETERMINISTIC_PATH_POLICY);
  return runPlaytestCampaign({
    identity: {
      projectId: "project-playtest",
      simulationInputArtifactVersionId: "input-version-playtest",
      simulationInputFingerprint: "input-fingerprint-playtest",
      compiledRuntimeFingerprint: runtime.fingerprint,
      snapshotId: fixture.source.snapshotId,
      seed,
    },
    runtime,
    source: fixture.analysis,
    policy,
  });
}

describe("Foundation 5B deterministic PRNG", () => {
  it("has an explicit version and stable golden vectors without Math.random", () => {
    expect(PLAYTEST_PRNG_VERSION).toBe("xorshift32-fnv1a-v1");
    const random = vi.spyOn(Math, "random");
    const prng = new DeterministicPlaytestPrng("golden-seed");
    expect(Array.from({ length: 6 }, () => prng.nextUint32())).toEqual([
      3273237567, 72991216, 2963023779, 3110334327, 1428212497, 3290131248,
    ]);
    expect(random).not.toHaveBeenCalled();
  });
});

describe("Foundation 5B seeded playtesting", () => {
  it("reruns identically, varies branching by seed, and replays every compact sample through 5A semantics", () => {
    const first = campaign("same-seed");
    const second = campaign("same-seed");
    const different = campaign("different-seed");
    expect(second).toEqual(first);
    expect(different.samples.map((sample) => sample.choiceIds)).not.toEqual(first.samples.map((sample) => sample.choiceIds));
    assertPlaytestCampaignIdentity(first);

    const fixture = branchingFixture();
    const runtime = compileRuntime(fixture.source);
    for (const sample of first.samples) {
      const replay = replayPlaytestSample(first, sample, runtime);
      expect(replay.verified).toBe(true);
      expect(replay.trace.fingerprint).toBe(sample.traceFingerprint);
    }
    expect(first.samples.flatMap((sample) => sample.choiceIds)).not.toContain("choice-hidden");
    expect(first.samples.some((sample) => sample.result.kind === "completed-ending")).toBe(true);
    expect(first.samples.filter((sample) => sample.result.kind === "ending-ineligible")
      .every((sample) => sample.hardFailureCodes.includes("runtime.ending-ineligible"))).toBe(true);
  });

  it("reports exact sampled coverage without turning bounded absence into proof", () => {
    const result = campaign();
    expect(result.actualSampleCount).toBe(18);
    expect(result.report.passageCoverage).toMatchObject({ total: 9, visited: 9, unvisited: 0, percentage: 100 });
    expect(result.report.choiceCoverage.total).toBe(11);
    expect(result.report.choiceCoverage.items.find((item) => item.choiceId === "choice-hidden")).toMatchObject({
      selectionCount: 0,
      observedEnabledCount: 0,
    });
    expect(result.report.routeCoverage.map((route) => [route.routeId, route.sampleCount])).toEqual([
      ["route-a", 6], ["route-b", 12],
    ]);
    expect(result.report.endingCoverage.map((ending) => [ending.endingId, ending.completedCount, ending.ineligibleCount])).toEqual([
      ["ending-a", 6, 0], ["ending-b", 12, 0],
    ]);
    expect(result.findings.find((finding) => finding.code === "playtest.choice-not-observed-enabled"))
      .toMatchObject({ evidenceLevel: "coverage-gap", choiceIds: ["choice-hidden"] });
    expect(result.findings.some((finding) => /unreachable$/i.test(finding.message))).toBe(false);
  });

  it("distinguishes mechanic writes, observed consequences, relationship trajectories, and bounded non-consequence evidence", () => {
    const result = campaign();
    const resolve = result.report.mechanics.find((item) => item.mechanicKey === "resolve")!;
    const bond = result.report.relationships.find((item) => item.mechanicKey === "bond")!;
    const tokens = result.report.mechanics.find((item) => item.mechanicKey === "tokens")!;
    expect(resolve).toMatchObject({ observedWriteCount: 6, samplesChanged: 6, samplesWithObservedDownstreamConsequence: 6 });
    expect(resolve.downstreamReadChoiceIds).toContain("choice-ending-a");
    expect(bond).toMatchObject({ observedWriteCount: 6, samplesChanged: 6, samplesWithObservedDownstreamConsequence: 6 });
    expect(bond.downstreamEndingIds).toContain("ending-a");
    expect(tokens).toMatchObject({ observedWriteCount: 6, samplesChanged: 6, samplesWithObservedDownstreamConsequence: 0 });
    expect(result.findings.find((finding) => finding.mechanicKeys.includes("tokens"))?.message)
      .toContain("this bounded campaign");
  });

  it("uses structured facts and threads for per-path continuity evidence and labels pacing word bases", () => {
    const result = campaign();
    expect(result.report.continuity.requiredBeforeKnownCount).toBe(12);
    expect(result.report.continuity.payoffBeforeSetupCount).toBe(12);
    expect(result.report.continuity.threadObservations[0]).toMatchObject({
      setupSampleCount: 6,
      payoffSampleCount: 18,
      payoffWithoutSetupSampleCount: 12,
    });
    const routeASamples = result.samples.filter((sample) => sample.routeIds.includes("route-a"));
    expect(routeASamples.every((sample) => result.findings.every((finding) => (
      finding.sampleId !== sample.id || finding.code !== "playtest.fact-required-before-known"
    )))).toBe(true);
    const payoffBeforeSetup = result.findings.find((finding) => finding.code === "playtest.thread-payoff-before-setup")!;
    expect(payoffBeforeSetup).toMatchObject({
      routeIds: ["route-b"],
      evidence: { traceStepIndex: 1, threadId: "thread-1" },
    });
    expect(result.report.pacing).toMatchObject({
      longLinearStretchCount: 6,
      denseChoiceRegionCount: 18,
    });
    expect(result.samples.some((sample) => sample.words.basis === "mixed-accepted-and-planned")).toBe(true);
    expect(result.report.routeExclusiveContent.find((item) => item.routeId === "route-a")?.observedPassageIds)
      .toContain("passage-a-setup");
  });

  it("rejects raised or explosive policies before execution and detects tampered replay evidence", () => {
    expect(() => createPlaytestPolicy({ sampleCount: PLAYTEST_BACKEND_LIMITS.maxSamples + 1 }, DEFAULT_DETERMINISTIC_PATH_POLICY))
      .toThrow(PlaytestPolicyError);
    expect(() => createPlaytestPolicy({ sampleCount: 500, maxStepsPerSample: 500 }, DEFAULT_DETERMINISTIC_PATH_POLICY))
      .toThrow("permits");
    expect(() => createPlaytestPolicy({ maxStepsPerSample: DEFAULT_DETERMINISTIC_PATH_POLICY.maxSteps + 1 }, DEFAULT_DETERMINISTIC_PATH_POLICY))
      .toThrow("never raise");

    const result = campaign();
    const tampered = { ...result.samples[0]!, choiceIds: ["choice-hidden"] };
    expect(() => replayPlaytestSample(result, tampered, compileRuntime(branchingFixture().source)))
      .toThrow(PlaytestIntegrityError);

    const fixture = branchingFixture();
    const runtime = compileRuntime(fixture.source);
    const policy = createPlaytestPolicy({ sampleCount: 1 }, DEFAULT_DETERMINISTIC_PATH_POLICY);
    expect(() => runPlaytestCampaign({
      identity: {
        projectId: "project-wrong-lineage", simulationInputArtifactVersionId: "input-wrong-lineage",
        simulationInputFingerprint: "wrong-lineage-input", compiledRuntimeFingerprint: "not-the-runtime",
        snapshotId: fixture.source.snapshotId, seed: "wrong-lineage",
      },
      runtime, source: fixture.analysis, policy,
    })).toThrow(PlaytestIntegrityError);
  });

  it("retains hard failures distinctly and honors step/cycle/trace bounds", () => {
    const fixture = branchingFixture();
    const runtime = compileRuntime(fixture.source);
    const policy = createPlaytestPolicy({ sampleCount: 3, maxStepsPerSample: 1 }, DEFAULT_DETERMINISTIC_PATH_POLICY);
    const result = runPlaytestCampaign({
      identity: {
        projectId: "project-bounded", simulationInputArtifactVersionId: "input-bounded",
        simulationInputFingerprint: "bounded-input", compiledRuntimeFingerprint: runtime.fingerprint,
        snapshotId: fixture.source.snapshotId, seed: "bounded",
      },
      runtime, source: fixture.analysis, policy,
    });
    expect(result.samples.every((sample) => sample.hardFailureCodes.includes("runtime.step-limit-reached"))).toBe(true);
    expect(result.report.hardFailureSampleCount).toBe(3);
    expect(result.retainedTraces).toHaveLength(3);
    expect(result.findings.filter((finding) => finding.evidenceLevel === "hard-error")).toHaveLength(3);

    const cycleFixture = branchingFixture();
    cycleFixture.source.passageVersions.find((passage) => passage.id === "passage-start")!.choiceIds = ["choice-a"];
    cycleFixture.source.choiceVersions = cycleFixture.source.choiceVersions
      .filter((choice) => choice.sourcePassageId !== "passage-start" || choice.id === "choice-a");
    cycleFixture.source.choiceVersions.find((choice) => choice.id === "choice-a")!.destinationPassageId = "passage-start";
    const cycleRuntime = compileRuntime(cycleFixture.source);
    const cyclePolicy = createPlaytestPolicy({
      sampleCount: 1, maxStepsPerSample: 10, maxVisitsPerPassage: 2,
    }, DEFAULT_DETERMINISTIC_PATH_POLICY);
    const cycle = runPlaytestCampaign({
      identity: {
        projectId: "project-cycle", simulationInputArtifactVersionId: "input-cycle",
        simulationInputFingerprint: "cycle-input", compiledRuntimeFingerprint: cycleRuntime.fingerprint,
        snapshotId: cycleFixture.source.snapshotId, seed: "cycle",
      },
      runtime: cycleRuntime, source: cycleFixture.analysis, policy: cyclePolicy,
    });
    expect(cycle.samples[0]?.hardFailureCodes).toContain("runtime.cycle-guard-reached");

    const tracePolicy = createPlaytestPolicy({
      sampleCount: 1, maxStepsPerSample: 20, maxTraceBytesPerSample: 2_500,
    }, DEFAULT_DETERMINISTIC_PATH_POLICY);
    const traceBounded = runPlaytestCampaign({
      identity: {
        projectId: "project-trace", simulationInputArtifactVersionId: "input-trace",
        simulationInputFingerprint: "trace-input", compiledRuntimeFingerprint: runtime.fingerprint,
        snapshotId: fixture.source.snapshotId, seed: "trace",
      },
      runtime, source: fixture.analysis, policy: tracePolicy,
    });
    expect(traceBounded.samples[0]?.hardFailureCodes).toContain("runtime.trace-limit-reached");
    expect(serializedBytes(traceBounded.retainedTraces[0])).toBeLessThanOrEqual(tracePolicy.maxTraceBytesPerSample);
  });

  it("runs a bounded deterministic 300-passage campaign without exhaustive enumeration", () => {
    const fixture = branchingFixture();
    const large = fixture.source;
    large.startPassageId = "passage-000";
    large.routeIds = ["route-a"];
    large.endings = [{ id: "ending-a", routeId: "route-a" }];
    large.mechanics.gates = [];
    large.passageVersions = Array.from({ length: 300 }, (_, index) => ({
      versionId: `pv-${index}`, id: `passage-${String(index).padStart(3, "0")}`,
      choiceIds: index === 299 ? [] : [`choice-${String(index).padStart(3, "0")}`],
      terminal: index === 299, endingId: index === 299 ? "ending-a" : null,
      routeIds: index === 0 || index === 299 ? [] : ["route-a"], requiredFactIds: [], revealedFactIds: [],
    }));
    large.choiceVersions = Array.from({ length: 299 }, (_, index) => ({
      versionId: `cv-${index}`, id: `choice-${String(index).padStart(3, "0")}`,
      sourcePassageId: `passage-${String(index).padStart(3, "0")}`,
      destinationPassageId: `passage-${String(index + 1).padStart(3, "0")}`,
      condition: null, unavailableBehavior: "disabled" as const, unavailableExplanation: "",
      effects: [], sourceDecisionIds: [], position: 0,
    }));
    const analysis: PlaytestAnalysisSource = {
      ...fixture.analysis,
      passages: Object.fromEntries(large.passageVersions.map((passage, index) => [passage.id, {
        id: passage.id, title: passage.id, actId: `act-${Math.floor(index / 60)}`,
        sequenceId: `sequence-${Math.floor(index / 20)}`, routeIds: passage.routeIds,
        wordTarget: 500, wordCount: 500, wordBasis: "planned-target" as const,
        acceptedDraftVersionId: null, requiredFactIds: [], revealedFactIds: [], setupThreadIds: [], payoffThreadIds: [],
        authoredChoiceCount: passage.choiceIds.length,
      }])),
      threads: {}, routeLabels: { "route-a": "Route A" }, endingLabels: { "ending-a": "Ending A" },
    };
    const runtime = compileRuntime(large);
    const policy = createPlaytestPolicy({ sampleCount: 8, maxStepsPerSample: 300 }, DEFAULT_DETERMINISTIC_PATH_POLICY);
    const input = {
      identity: {
        projectId: "large-project", simulationInputArtifactVersionId: "large-input",
        simulationInputFingerprint: "large-fingerprint", compiledRuntimeFingerprint: runtime.fingerprint,
        snapshotId: large.snapshotId, seed: "large-fixed-seed",
      }, runtime, source: analysis, policy,
    };
    const first = runPlaytestCampaign(input);
    const second = runPlaytestCampaign(input);
    expect(second).toEqual(first);
    expect(first.report).toMatchObject({ sampleCount: 8, totalSampledSteps: 2_392 });
    expect(first.report.passageCoverage).toMatchObject({ total: 300, visited: 300, percentage: 100 });
    expect(first.samples.every((sample) => sample.choiceIds.length === 299)).toBe(true);
    expect(first.retainedTraces.length).toBeLessThanOrEqual(policy.maxRetainedFullTraces);
    expect(first.samples).toHaveLength(8);
  });
});
