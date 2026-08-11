// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NarrativeReviewWorkspace } from "../src/features/workspace/NarrativeReviewWorkspace.js";
import type { NarrativeReviewAggregate } from "../src/api/narrative-review.js";

const input = {
  versionId: "input-v1", version: 1, createdAt: "2026-08-12T00:00:00Z", inputId: "input",
  snapshotId: "snapshot", fingerprint: "a".repeat(64), runtimeFingerprint: "b".repeat(64),
  passageCount: 300, choiceCount: 420, acceptedDraftCount: 280,
  policy: { version: "foundation-5a-v1", maxSteps: 1_000, maxVisitsPerPassage: 20, maxTraceBytes: 5_000_000 },
};
const unit = (index: number) => ({
  id: `unit-${index}`, position: index, passageIds: Array.from({ length: 5 }, (_, offset) => `passage-${index * 5 + offset}`),
  status: "pending", inputFingerprint: `input-${index}`, contextFingerprint: `context-${index}`,
  estimatedInputTokens: 4_000, maximumOutputTokens: 2_000,
  diagnostics: { included: { passages: [`passage-${index * 5}`] }, omitted: {}, retention: [{ campaignVersionId: "campaign-v2", status: "known" as const, truncated: true, omitted: 3 }] },
  attempts: [], findings: [],
});
const base: NarrativeReviewAggregate = {
  schemaVersion: 1, projectId: "project-1",
  reviewInput: { fingerprint: "review-input", simulationInputVersionId: input.versionId, campaignVersionIds: ["campaign-v2"], simulationRunVersionIds: [] },
  plan: {
    id: "plan-1", fingerprint: "plan-fingerprint", status: "planned", authorizedFingerprint: null,
    providerId: "offline-narrative-review", modelId: "deterministic-review-v1", categories: ["pacing", "voice-drift"],
    scopePassageIds: Array.from({ length: 20 }, (_, index) => `passage-${index}`), estimatedInputTokens: 16_000,
    policy: { id: "narrative-review-v1", maxPassagesPerUnit: 8, maxInputTokensPerUnit: 48_000, maxOutputTokensPerUnit: 8_000 },
  },
  job: { id: "job-1", status: "planned", createdAt: "2026-08-12T00:00:00Z", startedAt: null, finishedAt: null, units: [unit(0), unit(1), unit(2), unit(3)] },
};
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("NarrativeReviewWorkspace", () => {
  it("keeps a 300-passage project metadata-first through preview, authorization, offline start, filtering, navigation, and reopen", async () => {
    let saved: NarrativeReviewAggregate | null = null; let runningReads = 0; const requests: Array<{ url: string; method: string }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (request, init) => {
      const url = String(request); const method = init?.method ?? "GET"; requests.push({ url, method });
      if (url.endsWith("/simulation/playtests/campaigns")) return response({ items: [{ versionId: "campaign-v2", version: 1, createdAt: "", campaignId: "campaign", fingerprint: "c", simulationInputArtifactVersionId: input.versionId, simulationInputFingerprint: input.fingerprint, runtimeFingerprint: input.runtimeFingerprint, seed: "seed", sampleCount: 10, hardFailureSampleCount: 1, passageCoveragePercentage: 70, routeCoverageCount: 1, endingCoverageCount: 1, findingRetentionStatus: "known", retainedFindingCount: 2, totalFindingCount: 5, omittedFindingCount: 3, findingsTruncated: true, reportFingerprint: "report" }] });
      if (url.endsWith("/narrative-review/plans/preview")) return response({ reviewInput: base.reviewInput, plan: { ...base.plan, units: base.job.units } });
      if (url.endsWith("/narrative-review/plans") && method === "POST") { saved = structuredClone(base); return response(saved, 201); }
      if (url.endsWith("/narrative-review/plans") && method === "GET") return response({ items: saved ? [saved] : [] });
      if (url.endsWith("/authorize")) { saved = { ...structuredClone(base), plan: { ...base.plan, status: "authorized", authorizedFingerprint: base.plan.fingerprint }, job: { ...base.job, status: "authorized" } }; return response(saved); }
      if (url.endsWith("/start")) { saved = { ...saved!, job: { ...saved!.job, status: "running", startedAt: "now" } }; return response(saved); }
      if (url.endsWith(`/narrative-review/plans/${base.plan.id}`)) {
        runningReads += 1;
        if (runningReads > 1 && saved?.job.status === "running") {
          saved = structuredClone(saved); saved.job.status = "completed"; saved.job.finishedAt = "done";
          saved.job.units.forEach((item) => { item.status = "completed"; });
          saved.job.units[0]!.findings = [{
            id: "finding", fingerprint: "finding-fingerprint", category: "pacing", severity: "warning", confidence: "high",
            message: "The transition lands abruptly.", reviewNote: "Inspect the emotional beat.",
            passageIds: ["passage-0"], choiceIds: [], routeIds: [], endingIds: [], mechanicKeys: [], threadIds: [], acceptedDraftVersionIds: ["draft-0"],
            evidenceReferences: [{ kind: "passage", passageId: "passage-0", draftVersionId: "draft-0" }],
            reviewPlanId: base.plan.id, jobId: base.job.id, unitId: "unit-0", attemptId: "attempt-1", reviewInputFingerprint: "review-input", contextFingerprint: "context-0",
          }];
        }
        return response(saved);
      }
      return response({ error: `Unexpected ${method} ${url}` }, 404);
    });
    const navigate = vi.fn(); const user = userEvent.setup();
    render(<NarrativeReviewWorkspace projectId="project-1" inputs={[input]} defaultInputId={input.versionId} onNavigateStableId={navigate} />);
    await waitFor(() => expect(screen.getByText("No narrative reviews yet.")).toBeTruthy());
    await user.type(screen.getByLabelText("Narrative review passage scope"), Array.from({ length: 20 }, (_, index) => `passage-${index}`).join(" "));
    await user.selectOptions(screen.getByLabelText("Narrative review campaign"), "campaign-v2");
    await user.click(screen.getByRole("button", { name: "Preview bounded plan" }));
    await waitFor(() => expect(screen.getByText(/No provider was called/)).toBeTruthy());
    expect(screen.getAllByText(/Unit [1-4]/).length).toBeGreaterThanOrEqual(4);
    expect(screen.getAllByText(/Schema-v2 retained subset · 3 findings omitted/)).toHaveLength(4);
    expect(requests.every((item) => !/openrouter|provider/.test(item.url))).toBe(true);
    await user.click(screen.getByRole("button", { name: "Save exact plan" }));
    await user.click(await screen.findByRole("button", { name: "Authorize exact fingerprint" }));
    await user.click(screen.getByRole("button", { name: "Start review" }));
    await waitFor(() => expect(screen.getByText("The transition lands abruptly.")).toBeTruthy(), { timeout: 3_000 });
    await user.selectOptions(screen.getByLabelText("Filter narrative review severity"), "warning");
    await user.click(screen.getAllByRole("button", { name: "passage-0" })[0]!); expect(navigate).toHaveBeenCalledWith("passage-0");
    await user.click(screen.getByRole("button", { name: /completed · 20 passages · 1 findings/ }));
    await waitFor(() => expect(screen.getByText("Historical immutable review reopened.")).toBeTruthy());
    expect(screen.queryByText(/Apply change|Fix finding|Replacement prose/)).toBeNull();
  }, 10_000);
});
