// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FoundationBootstrapWorkspace } from "../src/features/workspace/FoundationBootstrapWorkspace.js";
import type { BootstrapJob, BootstrapPlan, BootstrapReview, BootstrapState } from "../src/api/foundation-bootstrap.js";

const artifacts = ["brief", "creative-direction", "bible", "routes", "endings", "mechanics"] as const;
const plan: BootstrapPlan = { id: "plan", fingerprint: "exact-plan", contextFingerprint: "exact-context", contextBytes: 4000, estimatedInputTokens: 1000, cost: 0, providerId: "offline-bootstrap", modelId: "fixture", context: { dossierVersionId: "dossier-v1", intentVersionId: "intent-v1", request: "Adapt the approved source", baseVersionIds: { brief: null, "creative-direction": null, bible: null, routes: null, endings: null, mechanics: null } }, units: [{ id: "foundations", artifactIds: [...artifacts] }] };
const job: BootstrapJob = { id: "job", projectId: "project", planId: "plan", status: "completed", authorizedFingerprint: "exact-plan", createdAt: "now", updatedAt: "now", units: [{ id: "foundations", artifactIds: [...artifacts], status: "completed", attempts: [{ id: "attempt", number: 1, status: "completed", diagnostic: null, startedAt: "now", finishedAt: "now", contextFingerprint: "exact-context" }] }] };
const state: BootstrapState = { providers: [{ id: "offline-bootstrap", label: "Offline", models: ["fixture"] }], availability: { allowed: true, reason: null }, plans: [plan], jobs: [job] };
const review: BootstrapReview = { jobId: "job", currentState: { status: "fresh", reasons: [] }, candidates: artifacts.map((artifactId) => ({ artifactId, baseVersionId: null, content: { summary: "Proposed foundation" }, provenance: [{ artifactId, fieldPath: "/summary", origin: "source", sourceRecordIds: ["source-record"], correctionIds: [], overrideIds: [], inventionIds: [], rationale: "Supported source evidence" }], fieldDiffs: [{ path: "/summary", before: null, after: "Proposed foundation" }] })), groups: [{ id: "foundation-policy", label: "Foundation policy", artifactIds: ["brief", "creative-direction"], dependsOnGroupIds: [] }, { id: "world", label: "World", artifactIds: ["bible", "mechanics"], dependsOnGroupIds: ["foundation-policy"] }, { id: "structure", label: "Structure", artifactIds: ["routes", "endings"], dependsOnGroupIds: ["foundation-policy", "world"] }], validation: { errors: [], warnings: [] }, canonAssessment: [{ obligationId: "obligation", status: "pending-passage-validation", routeIds: ["route-1"], actIds: ["act-1"], endingIds: ["ending-1"], structuralEvidence: [{ artifactId: "routes", fieldPath: "/routes/0/summary" }], rationale: "Pending passage graph" }], applications: [] };
function mockApi(overrides: Record<string, unknown> = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const suffix = String(input).split("/foundation-bootstrap")[1] ?? "";
    const values: Record<string, unknown> = { "": state, "/preview": plan, "/start": job, "/jobs/job": job, "/jobs/job/review": review, "/jobs/job/preview-apply": { effectiveArtifactIds: artifacts, requiredDependencies: artifacts.filter((id) => id !== "routes"), previewFingerprint: "exact-apply", wouldStale: ["passage-plan"] }, "/jobs/job/apply": { id: "application", artifactVersionIds: { routes: "routes-v1" }, createdAt: "now" }, ...overrides };
    return new Response(JSON.stringify(values[suffix] ?? {}));
  });
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("Foundation bootstrap workspace", () => {
  it("never starts generation on open or preview and requires authorization of an unchanged preview", async () => {
    const fetchMock = mockApi(); const user = userEvent.setup(); render(<FoundationBootstrapWorkspace projectId="project" />);
    await screen.findByText("Generation decision"); expect(fetchMock.mock.calls).toHaveLength(1);
    await user.type(screen.getByLabelText("Foundation request"), "Adapt the approved source"); await user.click(screen.getByRole("button", { name: "Preview foundation generation" }));
    expect(await screen.findByText("$0.00 (offline)")).toBeTruthy(); expect((screen.getByRole("button", { name: "Start foundation generation" }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/start"))).toBe(false);
    await user.click(screen.getByLabelText("Authorize this exact foundation generation")); await user.type(screen.getByLabelText("Foundation request"), " carefully");
    expect(screen.queryByRole("button", { name: "Start foundation generation" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Preview foundation generation" })); await user.click(await screen.findByLabelText("Authorize this exact foundation generation")); await user.click(screen.getByRole("button", { name: "Start foundation generation" }));
    await screen.findByRole("button", { name: "Review foundation bundle" });
    const start = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/start")); expect(JSON.parse(String(start?.[1]?.body))).toEqual({ planId: "plan", fingerprint: "exact-plan" });
  });
  it("drills into exact diffs and provenance before applying reviewed dependency closure without approval", async () => {
    const fetchMock = mockApi(); const user = userEvent.setup(), onApplied = vi.fn().mockResolvedValue(undefined);
    render(<FoundationBootstrapWorkspace projectId="project" onApplied={onApplied} />);
    await user.click(await screen.findByRole("button", { name: "completed / job" })); await user.click(await screen.findByRole("button", { name: "Review foundation bundle" }));
    await screen.findByRole("heading", { name: "Foundation overview" }); expect(screen.queryByRole("region", { name: "Foundation artifact detail" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Review Routes" })); const detail = screen.getByRole("region", { name: "Foundation artifact detail" });
    expect(within(detail).getByText("/summary")).toBeTruthy(); expect(within(detail).getByText(/source-record/)).toBeTruthy();
    await user.click(screen.getByRole("checkbox", { name: "Routes", exact: true })); await user.click(screen.getByRole("button", { name: "Preview selected drafts" }));
    const application = await screen.findByRole("region", { name: "Foundation application preview" }); expect(application.textContent).toContain("Required dependencies: Project brief, Creative Direction, Story bible, Detailed endings, Mechanics");
    await user.click(screen.getByRole("button", { name: "Apply reviewed drafts" })); await screen.findByText("Foundation drafts applied. Ordinary approval required; no passage plan or prose generated.");
    expect(onApplied).toHaveBeenCalledOnce(); const applied = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/apply")); expect(JSON.parse(String(applied?.[1]?.body))).toEqual({ artifactIds: artifacts, fingerprint: "exact-apply" });
    expect(fetchMock.mock.calls.some(([url]) => /approve|drafting|passage-generation/.test(String(url)))).toBe(false);
  });
  it("keeps stale bundles inspectable but cannot preview or apply them", async () => {
    mockApi({ "/jobs/job/review": { ...review, currentState: { status: "stale", reasons: ["Adaptation Intent changed"] } } });
    const user = userEvent.setup(); render(<FoundationBootstrapWorkspace projectId="project" />);
    await user.click(await screen.findByRole("button", { name: "completed / job" })); await user.click(await screen.findByRole("button", { name: "Review foundation bundle" }));
    await screen.findByText("Adaptation Intent changed"); expect((screen.getByRole("checkbox", { name: "Routes", exact: true }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Preview selected drafts" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Review Routes" })); expect(screen.getByRole("region", { name: "Foundation artifact detail" })).toBeTruthy();
  });
  it("recovers saved failed jobs and leaves cancellation available independently of polling", async () => {
    const failed = { ...job, status: "failed" }, running = { ...job, status: "running" };
    const fetchMock = mockApi({ "": { ...state, jobs: [failed] }, "/jobs/job": failed, "/jobs/job/retry": running, "/jobs/job/cancel": { ...job, status: "cancelled" } });
    const user = userEvent.setup(); render(<FoundationBootstrapWorkspace projectId="project" />);
    await user.click(await screen.findByRole("button", { name: "failed / job" })); await user.click(await screen.findByRole("button", { name: "Retry failed generation" }));
    await user.click(await screen.findByRole("button", { name: "Cancel generation" })); await screen.findByText("job / cancelled");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/retry"))).toHaveLength(1); expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/cancel"))).toHaveLength(1);
  });
});
