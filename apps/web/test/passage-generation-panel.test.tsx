// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PassageGenerationPanel } from "../src/features/workspace/PassageGenerationPanel.js";

const structure = {
  schemaVersion: 1 as const,
  title: "Plan", projectWordTarget: 1_000, typicalPathWordTarget: 1_000, startPassageId: "passage-a",
  acts: [{ id: "act-a", label: "Act A", purpose: "", summary: "", wordTarget: 1_000, routeIds: ["route-a"], sequenceIds: ["sequence-a"], position: 0 }],
  sequences: [{ id: "sequence-a", actId: "act-a", label: "Sequence A", purpose: "", summary: "", wordTarget: 1_000, routeIds: ["route-a"], passageIds: ["passage-a", "passage-shared"], entryGoals: [], exitGoals: [], requiredDecisionIds: [], endingHookIds: [], position: 0, planningStatus: "planned" as const }],
  characterAvailability: [],
};
const passages = [{
  id: "passage-a", sequenceId: "sequence-a", title: "A", kind: "scene" as const, purpose: "", summary: "",
  wordTarget: 1_000, routeIds: ["route-a"], tags: [], characterIds: [], relationshipIds: [], locationIds: [],
  requiredFactIds: [], revealedFactIds: [], setupThreadIds: [], payoffThreadIds: [], preservedDifferenceIds: [],
  choiceIds: [], terminal: false, endingId: null, draftingNotes: [], unresolvedQuestions: [], planningStatus: "planned" as const, position: 0,
}, {
  id: "passage-shared", sequenceId: "sequence-a", title: "Shared", kind: "scene" as const, purpose: "", summary: "",
  wordTarget: 1_000, routeIds: [], tags: [], characterIds: [], relationshipIds: [], locationIds: [],
  requiredFactIds: [], revealedFactIds: [], setupThreadIds: [], payoffThreadIds: [], preservedDifferenceIds: [],
  choiceIds: [], terminal: false, endingId: null, draftingNotes: [], unresolvedQuestions: [], planningStatus: "planned" as const, position: 1,
}];
const unit = {
  id: "unit-a", position: 0, sequenceId: "sequence-a", passageIds: ["passage-a"], passageVersionIds: ["passage-v1"],
  inputFingerprint: "input", estimatedInputTokens: 100, estimatedOutputTokens: 200,
};
const preview = {
  fingerprint: "f".repeat(64), snapshotId: "snapshot-v1", upstreamVersions: { brief: "brief-v1" },
  scope: { kind: "sequence" as const, sequenceId: "sequence-a" }, providerId: "offline-kernel", modelId: "deterministic-fixture-v1",
  units: [unit], estimatedInputTokens: 100, estimatedOutputTokens: 200,
  costEstimate: { status: "unavailable" as const, reason: "Offline" }, validationStages: ["schema"],
  policy: { id: "policy-v1", maxPassagesPerUnit: 25, maxUnitsPerPlan: 100, maxAttemptsPerUnit: 3 },
};
const plan = {
  ...preview, id: "plan-a", executionPolicyId: "policy-v1", executionPolicy: preview.policy,
  authorizationState: "planned" as const, authorizationFingerprint: null, authorizedAt: null,
  createdAt: "2026-08-01T00:00:00.000Z", jobId: "job-a", jobStatus: "planned" as const,
};
const job = {
  id: "job-a", projectId: "project-a", planId: "plan-a", planFingerprint: preview.fingerprint,
  status: "planned" as const, units: [{ ...unit, status: "pending" as const, attemptNumber: 0 }], updatedAt: "t",
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PassageGenerationPanel", () => {
  it("includes shared passages in the default route segment", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("[]", {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const user = userEvent.setup();
    render(<PassageGenerationPanel
      projectId="project-a" approved structure={structure} passages={passages} setMessage={vi.fn()}
    />);

    await user.selectOptions(screen.getByRole("combobox", { name: "Generation scope" }), "route-segment");

    expect((screen.getByRole("textbox", {
      name: "Route segment passage IDs",
    }) as HTMLInputElement).value).toBe("passage-a, passage-shared");
  });

  it("previews locally, inspects bounded units, persists, and authorizes the exact fingerprint", async () => {
    const requests: Array<{ path: string; body?: unknown }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      requests.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      let body: unknown = [];
      if (path.endsWith("/plans/preview")) body = preview;
      else if (path.endsWith("/plans") && init?.method === "POST") body = plan;
      else if (path.endsWith("/authorize")) body = { ...plan, authorizationState: "authorized", authorizationFingerprint: plan.fingerprint, jobStatus: "authorized" };
      else if (path.includes("/jobs/")) body = { ...job, status: path.endsWith("/start") ? "running" : "planned" };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
    const user = userEvent.setup();
    render(<PassageGenerationPanel
      projectId="project-a" approved structure={structure} passages={passages} setMessage={vi.fn()}
    />);
    await waitFor(() => expect(requests.some((item) => item.path.endsWith("/plans"))).toBe(true));
    await user.click(screen.getByRole("button", { name: "Preview plan" }));
    expect(await screen.findByRole("region", { name: "Generation plan inspection" })).toBeTruthy();
    expect(screen.getByText("1 bounded unit")).toBeTruthy();
    expect(screen.getByText("Cost: unavailable offline")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Save exact plan" }));
    await user.click(await screen.findByRole("button", { name: "Authorize exact plan" }));
    await waitFor(() => expect(requests.find((item) => item.path.endsWith("/authorize"))?.body).toEqual({
      fingerprint: plan.fingerprint,
    }));
    expect(requests.find((item) => item.path.endsWith("/plans/preview"))?.body).toMatchObject({
      providerId: "offline-kernel", modelId: "deterministic-fixture-v1",
    });
  });
});
