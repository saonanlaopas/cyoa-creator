// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RepairWorkspace } from "../src/features/workspace/RepairWorkspace.js";

const fingerprint = "a".repeat(64);
const locator = { sourceKind: "foundation-5a-runtime", sourceVersionId: "run-v1", findingId: "finding-1" };
const summary = { sourceKind: locator.sourceKind, locator, sourceFingerprint: fingerprint, code: "unknown-choice", category: "runtime", severity: "error", message: "Choice does not exist", sourceState: "current", entityIds: ["passage:p1"], createdAt: "2026-08-12T00:00:00Z" };
const resolved = { reference: { kind: locator.sourceKind }, sourceFingerprint: fingerprint, sourceState: "current", stateReasons: [], categoryCode: summary.code, message: summary.message, entityKeys: ["passage:p1"] };
const target = { target: { kind: "passage-prose", passageId: "p1" }, targetKey: "prose:p1", reason: "Prose for an evidence passage", protected: true };
const definition = { projectId: "project-1", selectedFindings: [resolved.reference], intent: { schemaVersion: 1, category: "prose", note: "" }, authorizedTargets: [target.target], expectedBases: [{ kind: "passage-prose-head", targetKey: target.targetKey, acceptedLocked: true, acceptedDraftVersionId: "draft-v1" }], impactGraph: { fingerprint: "b".repeat(64), nodes: [{ id: "direct:prose:p1", classification: "direct", entityKind: "passage-prose", entityId: "prose:p1", label: "prose:p1", reason: "Explicitly authorized mutation target" }, { id: "historical:run", classification: "historical-evidence", entityKind: "simulation-run", entityId: "run-v1", label: "run-v1", reason: "Captured base" }], edges: [] }, sourceState: "current", providerNeeded: "ai-assisted" };
const preview = { definition, fingerprint: "c".repeat(64), currentState: { status: "current", reasons: [] }, eligibleForGeneration: true };
const saved = { id: "repair-1", artifactVersionId: "repair-v1", definitionFingerprint: preview.fingerprint, definition, createdAt: "2026-08-12T00:00:00Z", currentState: preview.currentState, eligibleForGeneration: true };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("RepairWorkspace", () => {
  it("loads metadata first, displays locked exact scope, previews, saves, and blocks historical proposal generation", async () => {
    const requests: Array<{ url: string; method: string }> = [];
    let listed = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (request, init) => {
      const url = String(request); const method = init?.method ?? "GET"; requests.push({ url, method });
      if (url.includes("/findings?")) return response({ items: [summary], truncated: false, limit: 500 });
      if (url.endsWith("/findings/resolve")) return response(resolved);
      if (url.endsWith("/targets")) return response({ findings: [resolved], targets: [target] });
      if (url.endsWith("/plans/preview")) return response(preview);
      if (url.endsWith("/plans") && method === "POST") { listed = true; return response(saved, 201); }
      if (url.endsWith("/plans") && method === "GET") return response({ items: listed ? [{ id: saved.id, artifactVersionId: saved.artifactVersionId, createdAt: saved.createdAt, definitionFingerprint: saved.definitionFingerprint, intent: definition.intent, findingCount: 1, targetCount: 1, impactCount: 2, currentState: { status: "historical", reasons: ["Expected base changed: prose:p1"] } }] : [] });
      if (url.endsWith("/plans/repair-1")) return response({ ...saved, currentState: { status: "historical", reasons: ["Expected base changed: prose:p1"] }, eligibleForGeneration: false });
      if (url.endsWith("/proposal-generations")) return response({ items: [] });
      if (url.endsWith("/proposals")) return response({ items: [] });
      if (url.endsWith("/applications")) return response({ items: [] });
      return response({ error: `Unexpected ${method} ${url}` }, 404);
    });
    const user = userEvent.setup();
    render(<RepairWorkspace projectId="project-1" />);
    expect(await screen.findByText("Choice does not exist")).toBeTruthy();
    expect(requests.some((item) => item.url.endsWith("/findings/resolve"))).toBe(false);
    await user.click(screen.getByRole("checkbox", { name: /unknown-choice/i }));
    await user.selectOptions(screen.getByLabelText("Repair intent"), "prose");
    expect(await screen.findByText("Locked")).toBeTruthy();
    await user.click(screen.getByRole("checkbox", { name: /prose:p1/i }));
    await user.click(screen.getByRole("button", { name: "Preview repair plan" }));
    expect(await screen.findByText("Exact plan preview")).toBeTruthy();
    expect(screen.getByText(/acceptedDraftVersionId/)).toBeTruthy();
    expect(screen.getByText("historical-evidence")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Save exact plan" }));
    expect(await screen.findByText("Repair plan saved.")).toBeTruthy();
    await user.click(await screen.findByRole("button", { name: /prose · 1 findings · 1 targets/i }));
    expect(await screen.findByText("Expected base changed: prose:p1")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /generate|apply|authorize|start/i })).toBeNull();
    expect(requests.every((item) => !/openrouter|provider/.test(item.url))).toBe(true);
  });

  it("runs the explicit AI proposal lifecycle and reopens immutable groups without execution controls", async () => {
    const generationPreview = {
      repairPlan: saved, generationFingerprint: "d".repeat(64), mode: "ai-assisted", providerId: "offline-repair-proposal", modelId: "deterministic-repair-v1",
      policy: { maxUnits: 24 }, estimatedInputTokens: 120, expectedGroupStrategy: "one coherent group", providerCalls: 0, canonicalMutations: 0,
      units: [{ id: "unit-1", position: 0, targetKeys: ["prose:p1"], contextFingerprint: "e".repeat(64), estimatedInputTokens: 120, serializedContextBytes: 480, maximumOutputTokens: 8000 }],
    };
    const generation = (status: string) => ({
      generation: { id: "generation-1", fingerprint: generationPreview.generationFingerprint, status: status === "planned" ? "planned" : "authorized", providerId: "offline-repair-proposal", modelId: "deterministic-repair-v1" },
      job: { id: "job-1", status, proposalId: status === "completed" ? "proposal-1" : null, units: [{ ...generationPreview.units[0], status: status === "completed" ? "completed" : "pending", attempts: status === "completed" ? [{ id: "attempt-1", number: 1, status: "completed", error: null, repair: { performed: 0 } }] : [] }] },
      currentState: { status: "current", reasons: [] },
    });
    const proposal = {
      id: "proposal-1", definitionFingerprint: "f".repeat(64), repairPlanId: saved.id,
      provenance: { mode: "ai-assisted", providerId: "offline-repair-proposal", modelId: "deterministic-repair-v1" },
      groups: [{ id: "group-1", label: "Repair prose:p1", summary: "Bounded prose candidate", operationIds: ["operation-1"], dependsOnGroupIds: [], validation: { status: "valid" } }],
      operations: [{ id: "operation-1", kind: "create-passage-draft-candidate", entityKind: "passage-prose", entityId: "p1", fieldDiffs: [{ field: "proposedProse", before: null, after: "Candidate prose" }], requiresUnlock: true }],
      validation: { status: "valid", errors: [], warnings: [] }, currentState: { status: "current", reasons: [] },
    };
    let completed = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (request, init) => {
      const url = String(request); const method = init?.method ?? "GET";
      if (url.includes("/findings?")) return response({ items: [], truncated: false, limit: 500 });
      if (url.endsWith("/plans") && method === "GET") return response({ items: [{ id: saved.id, artifactVersionId: saved.artifactVersionId, createdAt: saved.createdAt, definitionFingerprint: saved.definitionFingerprint, intent: definition.intent, findingCount: 1, targetCount: 1, impactCount: 2, currentState: { status: "current", reasons: [] } }] });
      if (url.endsWith("/plans/repair-1")) return response(saved);
      if (url.endsWith("/proposals/generation-preview")) return response(generationPreview);
      if (url.endsWith("/proposal-generations") && method === "POST") return response(generation("planned"), 201);
      if (url.endsWith("/proposal-generations") && method === "GET") return response({ items: completed ? [generation("completed")] : [] });
      if (url.endsWith("/proposal-generations/generation-1/authorize")) return response(generation("authorized"));
      if (url.endsWith("/proposal-generations/generation-1/start")) { completed = true; return response(generation("running")); }
      if (url.endsWith("/proposal-generations/generation-1")) return response(generation(completed ? "completed" : "running"));
      if (url.endsWith("/proposals") && method === "GET") return response({ items: completed ? [proposal] : [] });
      if (url.endsWith("/proposals/proposal-1")) return response(proposal);
      if (url.endsWith("/applications")) return response({ items: [] });
      return response({ error: `Unexpected ${method} ${url}` }, 404);
    });
    const user = userEvent.setup(); render(<RepairWorkspace projectId="project-1" />);
    await user.click(await screen.findByRole("button", { name: /prose · 1 findings · 1 targets/i }));
    expect(await screen.findByRole("heading", { name: "Repair proposals" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Preview proposal generation" }));
    expect(await screen.findByText(generationPreview.generationFingerprint)).toBeTruthy();
    expect(screen.getByText("0", { selector: "dd" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Save exact generation plan" }));
    await user.click(await screen.findByRole("button", { name: "Authorize exact fingerprint" }));
    await user.click(await screen.findByRole("button", { name: "Start generation" }));
    expect(await screen.findByText(/completed · offline-repair-proposal/i)).toBeTruthy();
    await user.click(await screen.findByRole("button", { name: /ai-assisted · 1 groups · 1 operations/i }));
    expect(await screen.findByRole("heading", { name: "Immutable proposal" })).toBeTruthy();
    expect(screen.getByText("create-passage-draft-candidate · passage-prose:p1")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /apply|accept|unlock/i })).toBeNull();
  });

  it("reviews an exact group, previews dependency-safe mutation, applies explicitly, and reopens history", async () => {
    const proposal = {
      id: "proposal-1", definitionFingerprint: "f".repeat(64), repairPlanId: saved.id,
      provenance: { mode: "ai-assisted", providerId: "offline-repair-proposal", modelId: "deterministic-repair-v1" },
      groups: [{ id: "group-1", label: "Repair prose:p1", summary: "Bounded prose candidate", operationIds: ["operation-1"], dependsOnGroupIds: [], validation: { status: "valid" } }],
      operations: [{ id: "operation-1", kind: "create-passage-draft-candidate", entityKind: "passage-prose", entityId: "p1", fieldDiffs: [{ field: "proposedProse", before: null, after: "Candidate prose" }], requiresUnlock: true }],
      validation: { status: "valid", errors: [], warnings: [] }, currentState: { status: "current", reasons: [] },
    };
    const applicationPreview = {
      explicitlySelectedGroupIds: ["group-1"], requiredDependencyGroupIds: [], effectiveGroupIds: ["group-1"],
      groups: proposal.groups, operations: proposal.operations,
      expectedBases: [{ kind: "passage-prose-head", targetKey: "prose:p1", currentDraftVersionId: "draft-v1" }],
      currentBases: { "prose:p1": "draft-v1" }, generatedEntityIds: [], wouldStale: [],
      validation: { status: "valid" }, errors: [], warnings: [], verificationPlan: [{ kind: "historical-only", sourceFingerprint: fingerprint, bounded: true, description: "Require explicit narrative re-review." }],
      definitionFingerprint: "1".repeat(64), previewFingerprint: "2".repeat(64), applyAllowed: true, providerCalls: 0, canonicalMutations: 0,
    };
    const application = {
      id: "application-1", proposalId: proposal.id, result: "applied", appliedAt: "2026-08-13T00:00:00.000Z",
      definitionFingerprint: applicationPreview.definitionFingerprint, previewFingerprint: applicationPreview.previewFingerprint,
      explicitlySelectedGroupIds: ["group-1"], requiredDependencyGroupIds: [], effectiveGroupIds: ["group-1"], operationIds: ["operation-1"],
      resultingVersions: [{ operationId: "operation-1", entityKind: "passage-prose", entityId: "p1", versionId: "draft-v2" }],
      stalenessEvents: [], verification: { checks: applicationPreview.verificationPlan, dispositions: [{ sourceKind: "foundation-5c-narrative-review", sourceFingerprint: fingerprint, status: "requires-narrative-rereview", message: "Explicit narrative re-review is required." }] },
    };
    let applied = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (request, init) => {
      const url = String(request); const method = init?.method ?? "GET";
      if (url.includes("/findings?")) return response({ items: [], truncated: false, limit: 500 });
      if (url.endsWith("/plans") && method === "GET") return response({ items: [] });
      if (url.endsWith("/proposal-generations")) return response({ items: [] });
      if (url.endsWith("/proposals") && method === "GET") return response({ items: [proposal] });
      if (url.endsWith("/proposals/proposal-1") && method === "GET") return response(proposal);
      if (url.endsWith("/application-preview")) return response(applicationPreview);
      if (url.endsWith("/proposals/proposal-1/apply")) { applied = true; return response(application, 201); }
      if (url.endsWith("/applications") && method === "GET") return response({ items: applied ? [application] : [] });
      if (url.endsWith("/applications/application-1")) return response(application);
      return response({ error: `Unexpected ${method} ${url}` }, 404);
    });
    const user = userEvent.setup(); render(<RepairWorkspace projectId="project-1" />);
    await user.click(await screen.findByRole("button", { name: /ai-assisted.*1 groups.*1 operations/i }));
    await user.click(screen.getByRole("checkbox", { name: /Repair prose:p1/i }));
    await user.click(screen.getByRole("button", { name: "Preview selected repair" }));
    expect(await screen.findByText("Accepted prose stays locked and unchanged.")).toBeTruthy();
    expect(screen.getByText("Require explicit narrative re-review.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Apply exact preview" }));
    expect(await screen.findByRole("heading", { name: "Application result" })).toBeTruthy();
    expect(screen.getByText("draft-v2")).toBeTruthy();
    expect(screen.getByText(/requires-narrative-rereview/)).toBeTruthy();

    cleanup(); render(<RepairWorkspace projectId="project-1" />);
    await user.click(await screen.findByRole("button", { name: /applied.*1 operations/i }));
    expect(await screen.findByText("draft-v2")).toBeTruthy();
  });
});
