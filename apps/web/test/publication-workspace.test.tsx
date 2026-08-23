// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicationWorkspace } from "../src/features/workspace/PublicationWorkspace.js";

const sourceFingerprint = "1".repeat(32);
const bundleFingerprint = "2".repeat(32);
const readiness = {
  schemaVersion: 1,
  projectId: "project-native",
  ready: true,
  sourceInputFingerprint: sourceFingerprint,
  snapshotId: "snapshot-approved-v1",
  structureVersionId: "structure-v1",
  passageCount: 300,
  choiceCount: 475,
  acceptedDraftCount: 300,
  acceptedWordCount: 151_250,
  blockers: [],
  warnings: [{
    code: "publication.validation.pacing-warning", severity: "warning", message: "Inspect route pacing.",
    sourceKind: "route", sourceId: "route-main", fingerprint: "3".repeat(32), acknowledged: false,
  }],
  acknowledgedWarnings: [{
    code: "publication.validation.known-warning", severity: "warning", message: "Known intentional branch asymmetry.",
    sourceKind: "route", sourceId: "route-secret", fingerprint: "4".repeat(32), acknowledged: true,
    rationale: "This route is intentionally brief.",
  }],
  diagnostics: [],
  compiler: { policyId: "foundation-7a-native-compiler", policyVersion: 1, version: "foundation-7a-v1" },
  runtimeContract: { schemaVersion: 1, version: "foundation-5a-v1" },
  bundleContract: { schemaId: "cyoa.native-game-bundle", schemaVersion: 1, maximumSerializedBytes: 64_000_000 },
};
const build = {
  id: "artifact-build-v1",
  version: 1,
  createdAt: "2026-08-23T00:00:00.000Z",
  current: true,
  content: {
    id: "nativebuild-1", sourceInputFingerprint: sourceFingerprint, bundleFingerprint,
    runtimeFingerprint: "5".repeat(32), snapshotId: readiness.snapshotId,
    structureVersionId: readiness.structureVersionId, compilerVersion: "foundation-7a-v1",
    runtimeContractVersion: "foundation-5a-v1", bundleSchemaId: "cyoa.native-game-bundle",
    bundleSchemaVersion: 1, passageCount: 300, choiceCount: 475, acceptedWordCount: 151_250,
    serializedBytes: 1_250_000,
    validation: { valid: true, loaded: true, smokePassageId: "passage-start", availableChoiceCount: 3 },
  },
};

const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json" },
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("PublicationWorkspace", () => {
  it("shows exact readiness and compiles provider-free immutable build metadata", async () => {
    const requests: Array<{ url: string; method: string }> = [];
    let compiled = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (request, init) => {
      const url = String(request);
      const method = init?.method ?? "GET";
      requests.push({ url, method });
      if (url.endsWith("/publication/readiness")) return response(readiness);
      if (url.endsWith("/publication/builds")) return response({ items: compiled ? [build] : [] });
      if (url.endsWith("/publication/compile") && method === "POST") {
        compiled = true;
        return response({ build, bundle: { bundleFingerprint } }, 201);
      }
      return response({ error: "Unexpected request" }, 404);
    });

    const user = userEvent.setup();
    render(<PublicationWorkspace projectId="project-native" />);
    await waitFor(() => expect(screen.getByText("Ready to compile exact accepted prose.")).toBeTruthy());
    expect(screen.getByText(sourceFingerprint)).toBeTruthy();
    expect(screen.getByText("300 / 300 passages")).toBeTruthy();
    expect(screen.getByText(/151[.,]250/)).toBeTruthy();
    expect(screen.getByText("Inspect route pacing.")).toBeTruthy();
    expect(screen.getByText(/This route is intentionally brief/)).toBeTruthy();
    expect(screen.getByText("No native builds yet.")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Compile native bundle" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain(bundleFingerprint));
    expect(screen.getByText("Build v1")).toBeTruthy();
    expect(screen.getByText("current")).toBeTruthy();
    expect(screen.getByText("Loaded at passage-start")).toBeTruthy();
    expect(requests.filter((item) => item.url.endsWith("/publication/compile"))).toEqual([
      expect.objectContaining({ method: "POST" }),
    ]);
    expect(requests.every((item) => !/openrouter|provider|generation/i.test(item.url))).toBe(true);
  });

  it("surfaces structured blockers and disables compilation", async () => {
    const blocked = {
      ...readiness,
      ready: false,
      sourceInputFingerprint: null,
      acceptedDraftCount: 299,
      blockers: [{
        code: "publication.accepted-prose-stale", severity: "blocker", message: "Accepted prose is stale.",
        sourceKind: "draft", sourceId: "draft-v9", fingerprint: "6".repeat(32), acknowledged: false,
      }],
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (request) => {
      const url = String(request);
      if (url.endsWith("/publication/readiness")) return response(blocked);
      if (url.endsWith("/publication/builds")) return response({ items: [{ ...build, current: false }] });
      return response({ error: "Unexpected request" }, 404);
    });

    render(<PublicationWorkspace projectId="project-native" />);
    await waitFor(() => expect(screen.getByText("1 publication blocker.")).toBeTruthy());
    expect(screen.getByText("Accepted prose is stale.")).toBeTruthy();
    expect(screen.getByText("Unavailable until blockers are resolved")).toBeTruthy();
    expect(screen.getByText("historical source")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Compile native bundle" }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });
});
