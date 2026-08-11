// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeterministicPlaytestPrng, type PlaytestCampaignRecord } from "@story-to-cyoa/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlaytestWorkspace } from "../src/features/workspace/PlaytestWorkspace.js";

const input = {
  versionId: "simulation-input-v1", version: 1, createdAt: "2026-08-12T00:00:00.000Z",
  inputId: "simin-exact", snapshotId: "snapshot-approved-v1",
  fingerprint: "11111111111111111111111111111111", runtimeFingerprint: "22222222222222222222222222222222",
  passageCount: 300, choiceCount: 475, acceptedDraftCount: 240,
  policy: { version: "foundation-5a-v1" as const, maxSteps: 1_000, maxVisitsPerPassage: 20, maxTraceBytes: 5_000_000 },
};
const policy = {
  version: "foundation-5b-v1" as const,
  prngVersion: "xorshift32-fnv1a-v1" as const,
  strategyVersion: "coverage-aware-v1" as const,
  sampleCount: 50,
  maxStepsPerSample: 300,
  maxVisitsPerPassage: 20,
  maxTraceBytesPerSample: 2_000_000,
  maxTotalSampledSteps: 50_000,
  maxCampaignBytes: 16_000_000,
  maxFindings: 2_000,
  maxFindingBytes: 4_000_000,
  maxRetainedFullTraces: 24,
  maxChoiceIdsPerCampaign: 50_500,
  linearStretchThreshold: 4,
  denseChoiceThreshold: 5,
};
const sample = {
  id: "pts-sample", index: 0, seed: "derived-seed", choiceIds: ["choice-000"],
  visitedPassageIds: ["passage-000", "passage-001"], observedEnabledChoiceIds: ["choice-000"],
  result: { kind: "completed-ending" as const, passageId: "passage-001", endingId: "ending-hope", eligible: true },
  hardFailure: false, hardFailureCodes: [], stepCount: 1,
  traceFingerprint: "33333333333333333333333333333333", finalStateFingerprint: "44444444444444444444444444444444",
  finalMechanicValues: { resolve: 2, professor: 3 }, routeIds: ["route-hope"], decisionIds: ["decision-route"], endingId: "ending-hope",
  words: { total: 1_200, basis: "mixed-accepted-and-planned" as const, acceptedWords: 700, plannedWords: 500, historicalStaleAcceptedWords: 0 },
  fingerprint: "55555555555555555555555555555555",
};
const passageItems = Array.from({ length: 300 }, (_, index) => ({
  passageId: `passage-${String(index).padStart(3, "0")}`,
  visitCount: index < 250 ? 1 : 0,
  sampleCount: index < 250 ? 1 : 0,
  firstSampleIndex: index < 250 ? 0 : null,
  lastSampleIndex: index < 250 ? 0 : null,
}));
const campaign = {
  schemaVersion: 2, id: "ptc-campaign", projectId: "project-1",
  simulationInputArtifactVersionId: input.versionId,
  simulationInputFingerprint: input.fingerprint,
  compiledRuntimeFingerprint: input.runtimeFingerprint,
  snapshotId: input.snapshotId, seed: "author-review-v1", policy, status: "completed",
  requestedSampleCount: 50, actualSampleCount: 50,
  samples: [sample], retainedTraces: [],
  report: {
    schemaVersion: 1, sampleCount: 50, completedSampleCount: 49, hardFailureSampleCount: 1, totalSampledSteps: 1_400,
    passageCoverage: { total: 300, visited: 250, unvisited: 50, percentage: 83.3333, items: passageItems },
    choiceCoverage: {
      total: 475, selected: 320, neverSelected: 155, neverObservedEnabled: 40,
      items: [{ choiceId: "choice-000", selectionCount: 12, selectedSampleCount: 12, observedEnabledCount: 50, observedEnabledSampleCount: 50 }],
    },
    routeCoverage: [{ routeId: "route-hope", label: "Hope route", sampleCount: 28, frequency: .56, associatedPassageSampleCount: 28, decisionIds: ["decision-route"] }],
    endingCoverage: [{ endingId: "ending-hope", label: "Hope ending", completedCount: 20, ineligibleCount: 1, observedCount: 21, frequency: .42 }],
    mechanics: [{
      mechanicKey: "resolve", label: "Resolve", category: "stat", initialValue: 0, observedWriteCount: 40,
      observedMinimum: 0, observedMaximum: 8, samplesChanged: 30, choiceIdsCausingChanges: ["choice-000"],
      downstreamReadChoiceIds: ["choice-gated"], downstreamEndingIds: [], samplesWithObservedDownstreamConsequence: 18,
      finalDistribution: { "2": 12 }, routeFinalDistributions: { "route-hope": { "2": 12 } }, endingFinalDistributions: {},
    }, {
      mechanicKey: "professor", label: "Professor relationship", category: "relationship", initialValue: 0, observedWriteCount: 25,
      observedMinimum: 0, observedMaximum: 6, samplesChanged: 20, choiceIdsCausingChanges: ["choice-000"],
      downstreamReadChoiceIds: [], downstreamEndingIds: ["ending-hope"], samplesWithObservedDownstreamConsequence: 15,
      finalDistribution: { "3": 10 }, routeFinalDistributions: {}, endingFinalDistributions: { "ending-hope": { "3": 10 } },
    }],
    relationships: [],
    continuity: {
      requiredBeforeKnownCount: 1, payoffBeforeSetupCount: 2, setupWithoutPayoffCompletedCount: 3,
      finalKnownFactCounts: { "fact-opening": 50 }, routeKnownFactCounts: {},
      threadObservations: [{ threadId: "thread-mystery", setupSampleCount: 30, payoffSampleCount: 28, payoffWithoutSetupSampleCount: 2, setupWithoutPayoffCompletedSampleCount: 3, routeSampleCounts: { "route-hope": 20 } }],
    },
    pacing: {
      minimumWords: 900, medianWords: 1_200, maximumWords: 1_800, averageWords: 1_250,
      basisCounts: { "accepted-prose": 10, "planned-target": 5, "mixed-accepted-and-planned": 35, "historical-stale-accepted": 0 },
      actWordTotals: { "act-1": 60_000 }, sequenceWordTotals: { "sequence-1": 12_000 },
      longLinearStretchCount: 4, denseChoiceRegionCount: 2,
      enabledChoicesPerVisitedPassage: { "passage-000": 3 }, authoredChoicesPerVisitedPassage: { "passage-000": 4 },
    },
    routeExclusiveContent: [{ routeId: "route-hope", authoredPassageIds: ["passage-001"], observedPassageIds: ["passage-001"], authoredWords: 500, observedWords: 500, acceptedWordVolume: 500, plannedWordVolume: 0 }],
    sharedDecisionIds: ["decision-shared"],
    representatives: {
      shortestCompletedSampleId: sample.id, medianCompletedSampleId: sample.id, longestCompletedSampleId: sample.id,
      minimumWordSampleId: sample.id, maximumWordSampleId: sample.id,
    },
    fingerprint: "66666666666666666666666666666666",
  },
  findings: [{
    id: "ptf-finding", fingerprint: "77777777777777777777777777777777", schemaVersion: 1,
    campaignId: "ptc-campaign", projectId: "project-1", simulationInputArtifactVersionId: input.versionId,
    simulationInputFingerprint: input.fingerprint, policyVersion: "foundation-5b-v1", campaignSeed: "author-review-v1",
    sampleId: sample.id, sampleIndex: 0, traceFingerprint: sample.traceFingerprint,
    category: "continuity", code: "playtest.fact-required-before-known", evidenceLevel: "warning",
    message: "Passage passage-001 required structured facts before they were known in sample 0.",
    passageIds: ["passage-001"], choiceIds: [], mechanicKeys: [], routeIds: ["route-hope"], endingIds: [], evidence: { factId: "fact-secret" },
  }],
  findingRetention: {
    totalFindingCount: 3, retainedFindingCount: 1, omittedFindingCount: 2,
    retainedFindingBytes: 700, truncated: true, aggregateReportFindingBasis: "all-generated-findings",
  },
  fingerprint: "88888888888888888888888888888888",
} as unknown as PlaytestCampaignRecord;
const version = { id: "campaign-version-v1", version: 1, createdAt: "2026-08-12T00:01:00.000Z", content: campaign };
const summary = {
  versionId: version.id, version: 1, createdAt: version.createdAt, campaignId: campaign.id, fingerprint: campaign.fingerprint,
  simulationInputArtifactVersionId: input.versionId, simulationInputFingerprint: input.fingerprint,
  runtimeFingerprint: input.runtimeFingerprint, seed: campaign.seed, sampleCount: 50, hardFailureSampleCount: 1,
  passageCoveragePercentage: campaign.report.passageCoverage.percentage, routeCoverageCount: 1, endingCoverageCount: 1,
  findingCount: 1, totalFindingCount: 3, omittedFindingCount: 2, findingsTruncated: true,
  reportFingerprint: campaign.report.fingerprint,
};
const replay = {
  verified: true,
  sample,
  trace: {
    schemaVersion: 1, simulationInputFingerprint: input.fingerprint, compiledRuntimeFingerprint: input.runtimeFingerprint,
    sampleSeed: sample.seed, sampleIndex: 0,
    policy: { version: "foundation-5b-v1", maxStepsPerSample: 300, maxVisitsPerPassage: 20, maxTraceBytesPerSample: 2_000_000 },
    visitedPassageIds: sample.visitedPassageIds, selectedChoiceIds: sample.choiceIds,
    steps: [{
      stepIndex: 0, passageId: "passage-000", selectedChoiceId: "choice-000", nextPassageId: "passage-001",
      enabledChoiceIds: ["choice-000", "choice-other"], stateDelta: [{ path: "stats.resolve", before: 0, after: 2 }],
    }],
    finalState: {
      currentPassageId: "passage-001", stats: { resolve: 2 }, relationships: { professor: 3 }, flags: {}, resources: {},
      decisions: ["decision-route"], routes: ["route-hope"], knownFacts: ["fact-opening"], visitCounts: { "passage-000": 1, "passage-001": 1 }, turn: 1,
    },
    result: sample.result, runtimeFindings: [], hardFailureCodes: [], fingerprint: sample.traceFingerprint,
  },
};
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json" },
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("PlaytestWorkspace", () => {
  it("previews, runs, filters, navigates, replays, and reopens metadata-first 300-passage evidence", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    let completed = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (request, init) => {
      const url = String(request); requests.push({ url, init });
      if (url.endsWith("/playtests/policy")) return response({
        inputArtifactVersionId: input.versionId, inputFingerprint: input.fingerprint,
        runtimeFingerprint: input.runtimeFingerprint, snapshotId: input.snapshotId, policy,
      });
      if (url.endsWith("/playtests/campaigns") && init?.method === "POST") { completed = true; return response(version, 201); }
      if (url.endsWith(`/playtests/campaigns/${version.id}/samples/${sample.id}/replay`)) return response(replay);
      if (url.endsWith(`/playtests/campaigns/${version.id}`)) return response(version);
      if (url.endsWith("/playtests/campaigns")) return response({ items: completed ? [summary] : [] });
      return response({ error: "Unexpected request" }, 404);
    });
    const navigate = vi.fn();
    const user = userEvent.setup();
    render(<PlaytestWorkspace projectId="project-1" inputs={[input]} defaultInputId={input.versionId} onNavigateStableId={navigate} />);
    await waitFor(() => expect(screen.getByText("No seeded campaigns yet.")).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "Preview bounded policy" }));
    await waitFor(() => expect(screen.getByLabelText("Backend playtest policy").textContent).toContain("xorshift32-fnv1a-v1"));
    await user.click(screen.getByRole("button", { name: "Run seeded campaign" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Aggregate report" })).toBeTruthy());
    expect(screen.getByText("250/300 · 83.3%")).toBeTruthy();
    expect(screen.getByText(/28 samples · 56.0%/)).toBeTruthy();
    expect(screen.getByText(/decisions decision-route/)).toBeTruthy();
    expect(screen.getByText(/Observed shared decisions: decision-shared/)).toBeTruthy();
    expect(screen.getByText(/20 eligible · 1 ineligible/)).toBeTruthy();
    expect(screen.getByText(/Resolve · stat · 40 writes/)).toBeTruthy();
    expect(screen.getByText(/1 required-before-known observations/)).toBeTruthy();
    expect(screen.getByText(/4 long linear stretches observed/)).toBeTruthy();
    expect(screen.getByText(/1\/1 exclusive passages/)).toBeTruthy();
    expect(screen.getByText(/1\/3 retained from all generated evidence; 2 omitted/)).toBeTruthy();
    await user.click(screen.getAllByText("passage-001", { selector: "button" })[0]!);
    expect(navigate).toHaveBeenCalledWith("passage-001");

    await user.selectOptions(screen.getByLabelText("Filter playtest findings"), "warning");
    expect(screen.getByText("playtest.fact-required-before-known")).toBeTruthy();
    const list = screen.getByRole("list", { name: "Compact playtest sample summaries" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByLabelText("Verified playtest replay")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Replay exact sample" }));
    await waitFor(() => expect(screen.getByLabelText("Verified playtest replay").textContent).toContain(sample.traceFingerprint));
    expect(screen.getByText(/stats\.resolve/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /v1 · seed author-review-v1/ }));
    await waitFor(() => expect(requests.some((item) => item.url.endsWith(`/playtests/campaigns/${version.id}`))).toBe(true));
    expect(requests.every((item) => !/provider|openrouter|prose/i.test(item.url))).toBe(true);
    expect(JSON.stringify(summary)).not.toContain("retainedTraces");
  }, 10_000);

  it("uses the same golden PRNG algorithm in the browser-targeted workspace", () => {
    const prng = new DeterministicPlaytestPrng("golden-seed");
    expect(Array.from({ length: 3 }, () => prng.nextUint32())).toEqual([3273237567, 72991216, 2963023779]);
  });
});
