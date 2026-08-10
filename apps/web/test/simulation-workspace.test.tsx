// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SimulationWorkspace } from "../src/features/workspace/SimulationWorkspace.js";

const input = {
  versionId: "simulation-input-v1", version: 1, createdAt: "2026-08-11T00:00:00.000Z",
  inputId: "simin-exact", snapshotId: "snapshot-approved-v1",
  fingerprint: "11111111111111111111111111111111", runtimeFingerprint: "22222222222222222222222222222222",
  passageCount: 300, choiceCount: 475, acceptedDraftCount: 240,
  policy: { version: "foundation-5a-v1", maxSteps: 1_000, maxVisitsPerPassage: 20, maxTraceBytes: 5_000_000 },
};
const trace = {
  fingerprint: "33333333333333333333333333333333",
  visitedPassageIds: ["passage-start", "passage-ending"], selectedChoiceIds: ["choice-finish"],
  result: { kind: "completed-ending", passageId: "passage-ending", endingId: "ending-hope", eligible: true },
  findings: [],
  finalState: {
    currentPassageId: "passage-ending", stats: { resolve: 2 }, relationships: { professor: 3 },
    flags: { committed: true }, resources: { coins: 1 }, decisions: ["decision-route"], routes: ["route-hope"],
    knownFacts: ["fact-opening"], visitCounts: { "passage-start": 1, "passage-ending": 1 }, turn: 1,
  },
  steps: [{
    stepIndex: 0, passageId: "passage-start", selectedChoiceId: "choice-finish", nextPassageId: "passage-ending",
    availability: { visible: true, enabled: true, reason: null },
    stateDelta: [{ path: "stats.resolve", before: 0, after: 2 }],
    stateBefore: {
      currentPassageId: "passage-start", stats: { resolve: 0 }, relationships: { professor: 0 },
      flags: { committed: false }, resources: { coins: 0 }, decisions: [], routes: [], knownFacts: ["fact-opening"],
      visitCounts: { "passage-start": 1 }, turn: 0,
    },
    stateAfter: {
      currentPassageId: "passage-ending", stats: { resolve: 2 }, relationships: { professor: 3 },
      flags: { committed: true }, resources: { coins: 1 }, decisions: ["decision-route"], routes: ["route-hope"],
      knownFacts: ["fact-opening"], visitCounts: { "passage-start": 1, "passage-ending": 1 }, turn: 1,
    },
  }],
};
const run = {
  id: "simulation-run-v1", version: 1, createdAt: "2026-08-11T00:01:00.000Z",
  content: {
    id: "simrun-exact", inputArtifactVersionId: input.versionId,
    inputFingerprint: input.fingerprint, runtimeFingerprint: input.runtimeFingerprint, trace,
  },
};
const runSummary = {
  versionId: run.id, version: run.version, createdAt: run.createdAt, runId: run.content.id,
  inputArtifactVersionId: input.versionId, inputFingerprint: input.fingerprint,
  runtimeFingerprint: input.runtimeFingerprint, traceFingerprint: trace.fingerprint,
  result: trace.result, stepCount: 1, findingCount: 0,
};
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json" },
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("SimulationWorkspace", () => {
  it("captures, runs, and reopens compact 300-passage evidence without requesting prose or providers", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    let captured = false;
    let completed = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (request, init) => {
      const url = String(request); requests.push({ url, init });
      if (url.endsWith("/simulation/inputs") && init?.method === "POST") {
        captured = true; return response({ id: input.versionId, version: 1, createdAt: input.createdAt, content: { fingerprint: input.fingerprint } }, 201);
      }
      if (url.endsWith("/simulation/inputs")) return response({ items: captured ? [input] : [] });
      if (url.endsWith("/simulation/runs") && init?.method === "POST") { completed = true; return response(run, 201); }
      if (url.endsWith(`/simulation/runs/${run.id}`)) return response(run);
      if (url.endsWith("/simulation/runs")) return response({ items: completed ? [runSummary] : [] });
      return response({ error: "Unexpected request" }, 404);
    });

    const user = userEvent.setup();
    render(<SimulationWorkspace projectId="project-1" />);
    await waitFor(() => expect(screen.getByText("No simulation runs yet.")).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "Capture approved input" }));
    await waitFor(() => expect(screen.getByText(/300 passages · 475 choices · 240 accepted draft refs/)).toBeTruthy());
    await user.type(screen.getByLabelText("Stable choice IDs"), "choice-finish");
    await user.type(screen.getByLabelText("Expected ending stable ID (optional)"), "ending-hope");
    await user.click(screen.getByRole("button", { name: "Run deterministic path" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Trace evidence" })).toBeTruthy());
    expect(screen.getByText("passage-start → passage-ending")).toBeTruthy();
    expect(screen.getByText(/stats\.resolve/)).toBeTruthy();

    const runRequest = requests.find((item) => item.url.endsWith("/simulation/runs") && item.init?.method === "POST");
    expect(JSON.parse(String(runRequest?.init?.body))).toEqual({
      inputArtifactVersionId: input.versionId, choiceIds: ["choice-finish"], expectedEndingId: "ending-hope",
    });
    await user.click(screen.getByRole("button", { name: /v1 · completed-ending/ }));
    await waitFor(() => expect(requests.some((item) => item.url.endsWith(`/simulation/runs/${run.id}`))).toBe(true));
    expect(requests.every((item) => !/drafts|prose|provider|openrouter/i.test(item.url))).toBe(true);
  });
});
