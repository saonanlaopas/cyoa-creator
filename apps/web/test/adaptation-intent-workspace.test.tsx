// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newAdaptationIntent } from "@story-to-cyoa/domain";
import { AdaptationIntentWorkspace } from "../src/features/workspace/AdaptationIntentWorkspace.js";
const intent = newAdaptationIntent("project", { dossierVersionId: "dossier", dossierMaterialFingerprint: "a".repeat(64), source: { projectId: "project", sourceVersionId: "source", sourceFingerprint: "b".repeat(64), scopeVersionId: "scope", scopeFingerprint: "c".repeat(64), chapterIds: ["chapter"] } });
const { overrides: _, inventions: __, obligations: ___, exceptions: ____, expansion: _____, ...policy } = intent;
const state = { current: { id: "intent-v1", version: 1, stale: false, policy, counts: { overrides: 300, inventions: 0, obligations: 0, exceptions: 0, expansion: 0 }, reconciliation: { planned: null, target: null, difference: null, status: "unknown" } }, approvedDossier: intent.binding, workflow: { status: "draft", approvedVersionId: null }, legacyProjection: null };
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("Adaptation Intent review workspace", () => {
  it("opens without generation or implicit approval and stores explicit expanded dimensions", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => new Response(JSON.stringify(String(input).endsWith("/adaptation-intent") ? state : { total: 0, items: [] }), { status: 200 }));
    render(<AdaptationIntentWorkspace projectId="project" />);
    expect(await screen.findByText("Intent v1: draft")).toBeTruthy(); expect(screen.getByRole("heading", { name: "Canon route requested" })).toBeTruthy();
    expect(screen.queryByText("Canon route preserved")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Apply expanded preset" }));
    expect(fetchMock.mock.calls.filter(([url]) => /generate|approve/.test(String(url)))).toHaveLength(0);
    const edited = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/edit")); expect(JSON.parse(String(edited?.[1]?.body))).toEqual({ baseVersionId: "intent-v1", preset: "meaningful-divergence" });
  });
  it("keeps 300-item metadata collections bounded, paginated and stable-ID searchable", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input), "http://local");
      if (url.pathname.endsWith("/adaptation-intent")) return new Response(JSON.stringify(state));
      if (url.pathname.endsWith("/collections/overrides")) { const offset = Number(url.searchParams.get("offset")); return new Response(JSON.stringify({ total: 300, items: Array.from({ length: 20 }, (_, i) => ({ id: `override-${offset + i}`, scope: "project", rationale: "Reviewed preference", effect: `Effect ${offset + i}`, active: true, reviewed: true })) })); }
      return new Response(JSON.stringify({ total: 300, items: Array.from({ length: 20 }, (_, i) => ({ id: `source-${i}`, identityKey: `Identity ${i}`, field: "state", classification: "source-canon" })) }));
    });
    const user = userEvent.setup(); render(<AdaptationIntentWorkspace projectId="project" />); await screen.findByText("Intent v1: draft");
    await user.click(screen.getByRole("button", { name: "Overrides", exact: true })); await screen.findByText("Effect 0");
    expect(screen.getAllByRole("button", { name: "Review / edit" })).toHaveLength(20);
    await user.click(within(screen.getByRole("navigation", { name: "Intent item pages" })).getByRole("button", { name: "Next" })); await screen.findByText("Effect 20");
    expect(screen.queryByText("Effect 0")).toBeNull(); expect(fetchMock.mock.calls.some(([url]) => String(url).includes("offset=20"))).toBe(true);
    await user.type(screen.getByLabelText("Find intent item or stable ID"), "override-42");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("search=override-42"))).toBe(true);
    expect(fetchMock.mock.calls.filter(([url]) => /generate|approve/.test(String(url)))).toHaveLength(0);
  });
  it("original projects do not implicitly adopt source-specific intent", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ current: null, approvedDossier: null, workflow: { status: "empty" }, legacyProjection: null })));
    render(<AdaptationIntentWorkspace projectId="original" />); await screen.findByText("Not adopted");
    expect((screen.getByRole("button", { name: "Create intent draft" }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
