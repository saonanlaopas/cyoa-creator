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
  it("loads metadata first, displays locked exact scope, previews, saves, and reopens historical plans without generation controls", async () => {
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
});
