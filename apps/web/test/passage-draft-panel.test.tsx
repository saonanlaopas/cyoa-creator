// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PassageDraftPanel } from "../src/features/workspace/PassageDraftPanel.js";

const summary = {
  passageCount: 300, plannedPassageCount: 300, currentDraftCount: 0, currentCandidateCount: 0,
  acceptedDraftCount: 0, reviewedDraftCount: 0, lockedDraftCount: 0,
  staleCurrentCandidateCount: 0, staleAcceptedDraftCount: 0,
  currentCandidateWords: 0, candidateWords: 0, acceptedWords: 0, reviewedWords: 0,
  lockedWords: 0, staleAcceptedWords: 0, plannedWords: 150_000, remainingWords: 150_000,
  acceptanceCompletionPercentage: 0,
};
const emptyState = {
  passagePlanVersionId: "passage-plan-v1",
  passagePlan: { id: "passage-001", title: "The arrival", wordTarget: 500 },
  head: null, history: [], acceptanceHistory: [], summary,
};
const candidate = {
  id: "draft-v1", projectId: "project-1", passageId: "passage-001", version: 1,
  basedOnPassagePlanVersionId: "passage-plan-v1",
  proseMarkdown: "Fanawë arrives.\n\n<img src=x onerror=window.hacked=true>", wordCount: 5,
  lifecycleStatus: "candidate", status: "candidate", sourceKind: "manual", authorNote: "Keep the name.",
  generationPlanId: null, generationJobId: null, generationUnitId: null, generationProvenance: null,
  upstreamVersions: { brief: "brief-v1", bible: "bible-v1", routes: "routes-v1", endings: "endings-v1", mechanics: "mechanics-v1" },
  neighboringDraftVersions: {}, restoredFromVersionId: null, stale: false, staleReasons: [], createdAt: "2026-08-10T00:00:00.000Z",
};
const candidateState = {
  ...emptyState,
  head: { current: candidate, accepted: null, acceptedLocked: false, updatedAt: candidate.createdAt },
  history: [candidate], summary: { ...summary, currentDraftCount: 1, currentCandidateCount: 1, candidateWords: 5, currentCandidateWords: 5 },
};
const accepted = { ...candidate, id: "accepted-v2", version: 2, lifecycleStatus: "accepted", status: "accepted", sourceKind: "lifecycle" };
const acceptedState = {
  ...candidateState,
  head: { current: accepted, accepted, acceptedLocked: false, updatedAt: candidate.createdAt },
  history: [accepted, candidate], acceptanceHistory: [{
    id: "application-1", projectId: "project-1", previewFingerprint: "fingerprint-1",
    selectedCandidates: [{ passageId: "passage-001", candidateDraftVersionId: candidate.id }],
    previousAcceptedVersions: { "passage-001": null }, resultingAcceptedVersions: { "passage-001": accepted.id },
    downstreamStaleness: [], acceptedWordDelta: 5, createdAt: candidate.createdAt,
  }],
  summary: { ...summary, currentDraftCount: 1, acceptedDraftCount: 1, currentCandidateWords: 5, acceptedWords: 5, remainingWords: 149_995 },
};
const comparison = {
  before: null, after: candidate, wordCountDelta: 5, baseVersionChanged: false, provenanceChanged: false,
  paragraphs: [{ kind: "added", text: candidate.proseMarkdown }],
};
const acceptancePreview = {
  projectId: "project-1", selections: [{ passageId: "passage-001", candidateDraftVersionId: candidate.id }],
  items: [{ passageId: "passage-001", candidateDraftVersionId: candidate.id, previousAcceptedVersionId: null,
    resultingAcceptedVersionId: accepted.id, resultingLifecycle: "accepted", acceptedLocked: false,
    candidateWordCount: 5, previousAcceptedWordCount: 0, acceptedWordDelta: 5, noOp: false }],
  issues: [], downstreamStaleness: [], acceptedWordDelta: 5, acceptedPassageDelta: 1, valid: true, fingerprint: "fingerprint-1",
};
const planPreview = {
  fingerprint: "abc123", snapshotId: "snapshot-v1", upstreamVersions: candidate.upstreamVersions,
  scope: { kind: "passages", passageIds: ["passage-001"] }, providerId: "offline-drafting", modelId: "deterministic-prose-v1",
  units: [{ id: "unit-1", position: 0, passageIds: ["passage-001"], passageVersionIds: ["passage-plan-v1"],
    inputFingerprint: "input-1", estimatedInputTokens: 250, estimatedOutputTokens: 2_500,
    contextDiagnostics: { status: "built", serializedBytes: 800 } }],
  estimatedInputTokens: 250, estimatedOutputTokens: 2_500,
  policy: { id: "drafting-v1", maxPassagesPerUnit: 8, maxUnitsPerPlan: 100, maxEstimatedInputTokensPerUnit: 48_000,
    maxOutputTokensPerPassage: 2_500, maxOutputTokensPerUnit: 12_000, maxAttemptsPerUnit: 3, maxSerializedCandidateBytes: 96_000 },
};

const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json" },
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("PassageDraftPanel", () => {
  it("loads the exact persisted Resume drafting job rather than a newer passage plan", async () => {
    const ordinaryPlan = { ...planPreview, id: "drafting-plan-newer", executionPolicyId: planPreview.policy.id,
      executionPolicy: planPreview.policy, authorizationState: "planned", authorizationFingerprint: null,
      createdAt: candidate.createdAt, jobId: "drafting-job-newer", jobStatus: "planned" };
    const requestedPlan = { ...ordinaryPlan, id: "drafting-plan-requested", jobId: "drafting-job-requested", jobStatus: "failed" };
    const requestedJob = { id: requestedPlan.jobId, projectId: "project-1", planId: requestedPlan.id, status: "failed",
      startedAt: candidate.createdAt, finishedAt: candidate.createdAt, updatedAt: candidate.createdAt,
      units: [{ ...planPreview.units[0], projectId: "project-1", planId: requestedPlan.id, jobId: requestedPlan.jobId,
        status: "failed", attemptNumber: 1, normalizedError: { code: "fixture", message: "Inspect", retryable: true },
        usage: null, generatedCandidates: [] }] };
    const requests: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input); requests.push(url);
      if (url.endsWith("/drafting/plans")) return response([ordinaryPlan, requestedPlan]);
      if (url.endsWith("/drafting/jobs/drafting-job-requested")) return response(requestedJob);
      if (url.includes("/compare?")) return response(comparison);
      return response(emptyState);
    });
    render(<PassageDraftPanel projectId="project-1" passageId="passage-001"
      passagePlanVersionId="passage-plan-v1" passagePlanApproved requestedJobId="drafting-job-requested"
      setMessage={vi.fn()} />);
    await waitFor(() => expect(requests.some((url) => url.endsWith("/drafting/jobs/drafting-job-requested"))).toBe(true));
    await userEvent.setup().click(screen.getByText("Regenerate through bounded drafting"));
    expect(await screen.findByText("Job failed")).toBeTruthy();
  });

  it("loads compact metadata and saves a provider-free manual candidate", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input); requests.push({ url, init });
      if (url.endsWith("/drafting/plans") && !init?.method) return response([]);
      if (url.includes("/compare?")) return response(comparison);
      if (init?.method === "PUT") return response({ draft: candidate, state: candidateState }, 201);
      return response(emptyState);
    });
    const setMessage = vi.fn();
    const user = userEvent.setup();
    render(<PassageDraftPanel projectId="project-1" passageId="passage-001" passagePlanVersionId="passage-plan-v1" passagePlanApproved setMessage={setMessage} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Review prose" })).toBeTruthy());
    expect(screen.getByText(/0 accepted · 150[.,]000 remaining/)).toBeTruthy();
    await user.click(screen.getByText("Manual candidate editor"));
    await user.type(screen.getByLabelText("Prose Markdown"), candidate.proseMarkdown);
    await user.type(screen.getByLabelText("Author note"), candidate.authorNote);
    await user.click(screen.getByRole("button", { name: "Save new candidate version" }));
    await waitFor(() => expect(screen.getByText("Fanawë arrives.")).toBeTruthy());
    expect(JSON.parse(String(requests.find((item) => item.init?.method === "PUT")?.init?.body))).toEqual({
      proseMarkdown: candidate.proseMarkdown, authorNote: candidate.authorNote,
    });
    expect(setMessage).toHaveBeenCalledWith(expect.stringContaining("Accepted prose was unchanged"));
  });

  it("renders untrusted prose as text, compares locally, and explicitly accepts an exact candidate", async () => {
    let state = candidateState;
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input); requests.push({ url, init });
      if (url.endsWith("/drafting/plans") && !init?.method) return response([]);
      if (url.includes("/compare?")) return response(comparison);
      if (url.endsWith("/acceptance/preview")) return response(acceptancePreview);
      if (url.endsWith("/acceptance/apply")) { state = acceptedState; return response({ application: acceptedState.acceptanceHistory[0], preview: acceptancePreview, summary: acceptedState.summary }, 201); }
      return response(state);
    });
    const user = userEvent.setup();
    render(<PassageDraftPanel projectId="project-1" passageId="passage-001" passagePlanVersionId="passage-plan-v1" passagePlanApproved setMessage={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Fanawë arrives.")).toBeTruthy());
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getAllByText(/<img src=x onerror=window.hacked=true>/).length).toBeGreaterThan(0);
    expect(await screen.findByText("+5 words")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Preview exact acceptance" }));
    await waitFor(() => expect(screen.getByText("Ready for explicit acceptance")).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "Accept exact candidate" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Mark reviewed" })).toBeTruthy());
    const applyRequest = requests.find((item) => item.url.endsWith("/acceptance/apply"));
    expect(JSON.parse(String(applyRequest?.init?.body))).toEqual({
      selections: acceptancePreview.selections, previewFingerprint: acceptancePreview.fingerprint,
    });
  });

  it("shows stale reasons, readable prose, and blocks acceptance", async () => {
    const stale = { ...candidate, status: "stale", stale: true,
      staleReasons: [{ id: "stale-1", reasonCode: "passage-plan-material-change", sourceEntityKind: "passage",
        sourceEntityId: "passage-001", fromVersionId: "passage-plan-v1", toVersionId: "passage-plan-v2",
        changedFields: ["wordTarget"], createdAt: "2026-08-10T00:01:00.000Z" }] };
    const staleState = { ...candidateState, head: { ...candidateState.head, current: stale }, history: [stale] };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/drafting/plans")) return response([]);
      if (url.includes("/compare?")) return response({ ...comparison, after: stale });
      return response(staleState);
    });
    render(<PassageDraftPanel projectId="project-1" passageId="passage-001" passagePlanVersionId="passage-plan-v2" passagePlanApproved setMessage={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("This draft is stale and cannot be accepted.")).toBeTruthy());
    expect(screen.getAllByText("Fanawë arrives.").length).toBeGreaterThan(0);
    expect(screen.getByText(/passage-plan-material-change: passage passage-001 \(wordTarget\)/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Preview exact acceptance" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("prepares and starts bounded regeneration while accepted prose remains separate", async () => {
    const savedPlan = { ...planPreview, id: "drafting-plan-1", executionPolicyId: planPreview.policy.id,
      executionPolicy: planPreview.policy, authorizationState: "planned", authorizationFingerprint: null,
      createdAt: candidate.createdAt, jobId: "drafting-job-1", jobStatus: "planned" };
    const authorizedPlan = { ...savedPlan, authorizationState: "authorized", authorizationFingerprint: planPreview.fingerprint, jobStatus: "authorized" };
    const completedJob = { id: savedPlan.jobId, projectId: "project-1", planId: savedPlan.id, status: "completed",
      startedAt: candidate.createdAt, finishedAt: candidate.createdAt, updatedAt: candidate.createdAt,
      units: [{ ...planPreview.units[0], projectId: "project-1", planId: savedPlan.id, jobId: savedPlan.jobId,
        status: "completed", attemptNumber: 1, normalizedError: null, usage: { inputTokens: 100, outputTokens: 20, cost: 0 },
        generatedCandidates: [{ draftVersionId: candidate.id, passageId: "passage-001", wordCount: 5 }] }] };
    let generated = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/drafting/plans") && init?.method === "POST") return response(savedPlan, 201);
      if (url.endsWith("/drafting/plans") && !init?.method) return response([]);
      if (url.endsWith("/authorize")) return response(authorizedPlan);
      if (url.endsWith("/start")) return response({ ...completedJob, status: "running" });
      if (url.includes("/drafting/jobs/")) { generated = true; return response(completedJob); }
      if (url.includes("/compare?")) return response(comparison);
      return response(generated ? candidateState : emptyState);
    });
    const user = userEvent.setup();
    render(<PassageDraftPanel projectId="project-1" passageId="passage-001" passagePlanVersionId="passage-plan-v1" passagePlanApproved setMessage={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Review prose" })).toBeTruthy());
    await user.click(screen.getByText("Regenerate through bounded drafting"));
    await user.click(screen.getByRole("button", { name: "Prepare regeneration plan" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Authorize exact plan" })).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "Authorize exact plan" }));
    await user.click(await screen.findByRole("button", { name: "Start generation" }));
    await waitFor(() => expect(screen.getByText("Job completed")).toBeTruthy());
    expect(screen.getByText("passage-001: 5 words generated")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Preview exact acceptance" })).toBeTruthy();
    expect(screen.getByText("No prose has been accepted.")).toBeTruthy();
  });
});
