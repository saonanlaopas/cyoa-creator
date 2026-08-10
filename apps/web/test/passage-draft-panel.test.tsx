// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PassageDraftPanel } from "../src/features/workspace/PassageDraftPanel.js";

const summary = {
  passageCount: 300, currentDraftCount: 0, acceptedDraftCount: 0,
  currentCandidateWords: 0, acceptedWords: 0, plannedWords: 150_000, remainingWords: 150_000,
};
const emptyState = {
  passagePlanVersionId: "passage-plan-v1",
  passagePlan: { id: "passage-001", title: "The arrival", wordTarget: 500 },
  head: null,
  history: [],
  summary,
};
const candidate = {
  id: "draft-v1", projectId: "project-1", passageId: "passage-001", version: 1,
  basedOnPassagePlanVersionId: "passage-plan-v1", proseMarkdown: "Fanawë arrives.", wordCount: 2,
  lifecycleStatus: "candidate", status: "candidate", sourceKind: "manual", authorNote: "Keep the name.",
  upstreamVersions: { brief: "brief-v1", bible: "bible-v1", routes: "routes-v1", endings: "endings-v1", mechanics: "mechanics-v1" },
  neighboringDraftVersions: {}, restoredFromVersionId: null, stale: false, staleReasons: [], createdAt: "2026-08-10T00:00:00.000Z",
};
const savedState = {
  ...emptyState,
  head: { current: candidate, accepted: null, acceptedLocked: false, updatedAt: candidate.createdAt },
  history: [candidate],
  summary: { ...summary, currentDraftCount: 1, currentCandidateWords: 2 },
};
const preview = {
  fingerprint: "abc123", snapshotId: "snapshot-v1",
  upstreamVersions: candidate.upstreamVersions,
  scope: { kind: "passages", passageIds: ["passage-001"] },
  providerId: "offline-drafting", modelId: "deterministic-prose-v1",
  units: [{
    id: "unit-1", position: 0, passageIds: ["passage-001"], passageVersionIds: ["passage-plan-v1"],
    inputFingerprint: "input-1", estimatedInputTokens: 250, estimatedOutputTokens: 2_500,
    contextFingerprint: "c".repeat(64), context: { schemaId: "cyoa.passage-drafting-context", schemaVersion: 1 },
    contextDiagnostics: { status: "built", contextSchema: { id: "cyoa.passage-drafting-context", version: 1 },
      includedRecords: { passages: { ids: ["passage-001"], versionIds: ["passage-plan-v1"] } },
      omittedOptionalContext: { acceptedNeighborPassageIds: [] }, staleNeighborDraftsExcluded: [],
      requestedMaximumOutputTokens: 2_500, serializedBytes: 800, contextFingerprint: "c".repeat(64) },
  }],
  estimatedInputTokens: 250, estimatedOutputTokens: 2_500,
  policy: { id: "drafting-v1", maxPassagesPerUnit: 8, maxUnitsPerPlan: 100,
    maxEstimatedInputTokensPerUnit: 48_000, maxOutputTokensPerPassage: 2_500,
    maxOutputTokensPerUnit: 12_000, maxAttemptsPerUnit: 3, maxSerializedCandidateBytes: 96_000 },
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("PassageDraftPanel", () => {
  it("loads compact metadata, saves a manual candidate, and previews bounded real drafting context", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith("/drafting/plans/preview")) {
        return new Response(JSON.stringify(preview), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/drafting/plans") && !init?.method) {
        return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (init?.method === "PUT") {
        return new Response(JSON.stringify({ draft: candidate, state: savedState }), {
          status: 201, headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify(emptyState), { status: 200, headers: { "content-type": "application/json" } });
    });
    const setMessage = vi.fn();
    const user = userEvent.setup();
    render(<PassageDraftPanel
      projectId="project-1" passageId="passage-001" passagePlanVersionId="passage-plan-v1"
      passagePlanApproved setMessage={setMessage}
    />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Passage draft" })).toBeTruthy());
    expect(screen.getByText((_, element) => element?.tagName === "DD"
      && /0 accepted · 150[.,]000 remaining/.test(element.textContent ?? ""))).toBeTruthy();
    await user.type(screen.getByLabelText("Prose Markdown"), "Fanawë arrives.");
    await user.type(screen.getByLabelText("Author note"), "Keep the name.");
    await user.click(screen.getByRole("button", { name: "Save new candidate version" }));
    await waitFor(() => expect(screen.getByText("candidate")).toBeTruthy());
    expect(screen.getByText("2 / 500")).toBeTruthy();
    expect(JSON.parse(String(requests.find((item) => item.init?.method === "PUT")?.init?.body))).toEqual({
      proseMarkdown: "Fanawë arrives.", authorNote: "Keep the name.",
    });
    expect(setMessage).toHaveBeenCalledWith(expect.stringContaining("No provider was called"));

    await user.click(screen.getByText("Bounded prose generation"));
    await user.click(screen.getByRole("button", { name: "Preview one-passage plan" }));
    await waitFor(() => expect(screen.getByText(/1 unit · 250 estimated input tokens/)).toBeTruthy());
    expect(screen.getByText(/Limits: 8 passages\/unit · 3 attempts/)).toBeTruthy();
    expect(screen.getByText("Unit 1: built context")).toBeTruthy();
    const previewRequest = requests.find((item) => item.url.endsWith("/drafting/plans/preview"));
    expect(JSON.parse(String(previewRequest?.init?.body))).toEqual({
      scope: { kind: "passages", passageIds: ["passage-001"] },
      providerId: "offline-drafting", modelId: "deterministic-prose-v1",
    });
  });

  it("shows stale reasons without hiding the stored prose", async () => {
    const stale = {
      ...candidate, status: "stale", stale: true,
      staleReasons: [{ id: "stale-1", reasonCode: "passage-plan-material-change", sourceEntityKind: "passage",
        sourceEntityId: "passage-001", fromVersionId: "passage-plan-v1", toVersionId: "passage-plan-v2",
        changedFields: ["wordTarget"], createdAt: "2026-08-10T00:01:00.000Z" }],
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => new Response(JSON.stringify(
      String(input).endsWith("/drafting/plans") ? [] : {
        ...savedState, head: { ...savedState.head, current: stale }, history: [stale],
      },
    ), { status: 200, headers: { "content-type": "application/json" } }));
    render(<PassageDraftPanel
      projectId="project-1" passageId="passage-001" passagePlanVersionId="passage-plan-v2"
      passagePlanApproved setMessage={vi.fn()}
    />);
    await waitFor(() => expect(screen.getByText("This draft is stale.")).toBeTruthy());
    expect(screen.getByDisplayValue("Fanawë arrives.")).toBeTruthy();
    expect(screen.getByText(/passage-plan-material-change: passage passage-001 \(wordTarget\)/)).toBeTruthy();
  });

  it("authorizes explicit offline generation, shows persisted completion, and exposes no acceptance control", async () => {
    const savedPlan = {
      ...preview, id: "drafting-plan-1", executionPolicyId: preview.policy.id, executionPolicy: preview.policy,
      authorizationState: "planned", authorizationFingerprint: null, createdAt: "2026-08-10T00:00:00.000Z",
      jobId: "drafting-job-1", jobStatus: "planned",
    };
    const authorizedPlan = {
      ...savedPlan, authorizationState: "authorized", authorizationFingerprint: preview.fingerprint,
      jobStatus: "authorized",
    };
    const generatedCandidate = {
      ...candidate, id: "draft-generated", sourceKind: "generated", proseMarkdown: "Generated offline prose.",
      wordCount: 3, generationPlanId: savedPlan.id, generationJobId: savedPlan.jobId, generationUnitId: "unit-1",
      generationProvenance: { outputId: "output-1", attemptId: "attempt-1", inputFingerprint: "input-1",
        contextFingerprint: "c".repeat(64), providerId: "offline-drafting", modelId: "deterministic-prose-v1",
        executionPolicyId: preview.policy.id, outputSchemaId: "cyoa.passage-drafting-unit-output",
        outputSchemaVersion: 1, usage: { inputTokens: 100, outputTokens: 20, cost: 0 }, repair: { repairsPerformed: 0 } },
    };
    const generatedState = {
      ...emptyState,
      head: { current: generatedCandidate, accepted: null, acceptedLocked: false, updatedAt: candidate.createdAt },
      history: [generatedCandidate], summary: { ...summary, currentDraftCount: 1, currentCandidateWords: 3 },
    };
    const completedJob = {
      id: savedPlan.jobId, projectId: "project-1", planId: savedPlan.id, status: "completed",
      startedAt: candidate.createdAt, finishedAt: candidate.createdAt, updatedAt: candidate.createdAt,
      units: [{ ...preview.units[0], projectId: "project-1", planId: savedPlan.id, jobId: savedPlan.jobId,
        status: "completed", attemptNumber: 1, normalizedError: null, usage: { inputTokens: 100, outputTokens: 20, cost: 0 },
        generatedCandidates: [{ draftVersionId: generatedCandidate.id, passageId: "passage-001", wordCount: 3 }] }],
    };
    let generated = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
        status, headers: { "content-type": "application/json" },
      });
      if (url.endsWith("/drafting/plans") && init?.method === "POST") return response(savedPlan, 201);
      if (url.endsWith("/drafting/plans") && !init?.method) return response([]);
      if (url.endsWith("/authorize")) return response(authorizedPlan);
      if (url.endsWith("/start")) return response({ ...completedJob, status: "running", units: [{ ...completedJob.units[0], status: "running", generatedCandidates: [] }] });
      if (url.includes("/drafting/jobs/")) { generated = true; return response(completedJob); }
      return response(generated ? generatedState : emptyState);
    });
    const user = userEvent.setup();
    render(<PassageDraftPanel projectId="project-1" passageId="passage-001"
      passagePlanVersionId="passage-plan-v1" passagePlanApproved setMessage={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Passage draft" })).toBeTruthy());
    await user.click(screen.getByText("Bounded prose generation"));
    await user.click(screen.getByRole("button", { name: "Save plan" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Authorize exact plan" })).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "Authorize exact plan" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Start generation" })).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "Start generation" }));
    await waitFor(() => expect(screen.getByText("Job completed")).toBeTruthy());
    expect(screen.getByText("passage-001: 3 words generated")).toBeTruthy();
    expect(screen.getByDisplayValue("Generated offline prose.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /accept/i })).toBeNull();
  });
});
