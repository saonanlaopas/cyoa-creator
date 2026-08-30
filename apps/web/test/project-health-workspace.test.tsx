// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectHealthWorkspace } from "../src/features/workspace/ProjectHealthWorkspace.js";

const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const health = {
  schemaId: "cyoa.project-health", schemaVersion: 1, project: { id: "health-project", mode: "long-form", schemaVersion: 16 },
  scale: { passages: 300, choices: 299, threads: 12, acceptedDrafts: 250, acceptedWords: 125000, staleAcceptedDrafts: 4, staleCurrentDrafts: 5, draftVersions: 420, repairApplications: 3 },
  validation: { passagePlanStatus: "approved", approvedSnapshotId: "snapshot-1", blockers: 0, warnings: 2 },
  evidence: { latest: [{ kind: "playtest", versionId: "play-1", createdAt: "2026-08-31T00:00:00.000Z", status: "completed", fingerprint: null }], freshness: "historical-evidence" },
  repair: { latest: [], }, publication: { currentReadiness: "not-evaluated", nativeBuildCount: 1, latestBuildAt: null },
  recovery: { latestVerifiedBackupAt: null, latestVerifiedBackupId: null, currentFreshness: "not-evaluated", restoreCount: 0 },
  storage: { database: { status: "in-memory", sqliteBytes: null, walBytes: null, measurement: "not-available" }, immutableHistory: { artifactVersions: 12, passageEntityVersions: 900 }, policy: "diagnostic-only-no-automatic-cleanup" },
  usage: { statuses: { completed: 2 }, requestCount: 2, tokenKnownRequestCount: 2, legacyUnknownRequestCount: 0, inputTokens: 100, outputTokens: 50, totalTokens: 150, cost: { status: "partial", recorded: 0.03, recordedRequestCount: 1, unknownRequestCount: 1 }, firstRecordedAt: null, lastRecordedAt: null },
  budgets: { maximumUsageGroups: 100 },
};
const usage = { schemaId: "cyoa.project-usage", schemaVersion: 1, projectId: "health-project", authority: { excludes: ["candidate mirrors"] }, totals: health.usage, groupsTruncated: false, groups: [{ workflow: "passage-drafting", providerId: "offline", modelId: "fixture", statuses: { completed: 2 }, requestCount: 2, tokenKnownRequestCount: 2, legacyUnknownRequestCount: 0, inputTokens: 100, outputTokens: 50, totalTokens: 150, cost: health.usage.cost, firstRecordedAt: null, lastRecordedAt: null }] };

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Foundation 8B project health workspace", () => {
  it("shows bounded operational facts, explicit unknowns, and workflow links without prose", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (request) => String(request).endsWith("/usage") ? response(usage) : response(health));
    const navigate = vi.fn(); const user = userEvent.setup();
    render(<ProjectHealthWorkspace projectId="health-project" onNavigate={navigate} />);
    expect(await screen.findByRole("heading", { name: "Project health" })).toBeTruthy();
    expect(screen.getByText(/300 \/ 299 \/ 12/)).toBeTruthy();
    expect(screen.getByText(/Current readiness is not evaluated here/)).toBeTruthy();
    expect(screen.getAllByText(/some historical costs unknown/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/secret prose/i)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Open publication" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("publication"));
  });
});
