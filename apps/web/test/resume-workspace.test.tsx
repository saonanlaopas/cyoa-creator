// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResumeWorkWorkspace } from "../src/features/workspace/ResumeWorkWorkspace.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Foundation 8C resume work", () => {
  it("labels browser hints as non-canonical and navigates only from persisted facts without provider calls", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      schemaId: "cyoa.project-resume", schemaVersion: 1, projectId: "project-1", authority: "persisted-facts-only",
      generatedAt: "2026-09-01T00:00:00.000Z", facts: { pendingDraftCandidates: 1 },
      backup: { latestVerifiedAt: null, latestVerifiedBackupId: null, freshness: "not-evaluated" },
      actions: [
        { id: "draft-candidates", stage: "passage-plan", label: "Review pending prose candidates", count: 1,
          stableId: "passage-042", jobKind: null, jobId: null, jobStatus: null },
        { id: "drafting-failed", stage: "passage-plan", label: "Inspect failed drafting jobs", count: 1,
          stableId: "passage-099", jobKind: "drafting", jobId: "draft-job-exact", jobStatus: "failed" },
      ],
      truncated: false,
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const navigate = vi.fn(); const user = userEvent.setup();
    render(<ResumeWorkWorkspace projectId="project-1" localHint={{ stage: "repair", entityId: null }} onNavigate={navigate} />);
    expect(await screen.findByRole("heading", { name: "Resume work" })).toBeTruthy();
    expect(screen.getByText(/non-canonical navigation hint/i)).toBeTruthy();
    expect(screen.getByText(/Persisted facts only/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Review pending prose candidates/ }));
    expect(navigate).toHaveBeenCalledWith("passage-plan", "passage-042", null);
    expect(screen.getByText(/draft-job-exact/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Inspect failed drafting jobs/ }));
    expect(navigate).toHaveBeenLastCalledWith("passage-plan", "passage-099", {
      kind: "drafting", id: "draft-job-exact",
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(String(fetch.mock.calls[0]?.[0])).toContain("/health/resume");
  });

  it("renders actionable retry-safe failure guidance", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("database unavailable"));
    render(<ResumeWorkWorkspace projectId="project-1" localHint={null} onNavigate={() => undefined} />);
    expect((await screen.findByRole("alert")).textContent).toContain("No project data changed");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
