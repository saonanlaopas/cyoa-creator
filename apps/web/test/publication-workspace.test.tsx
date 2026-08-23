// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryNativePlayerStorage, createNativePlayerConfig } from "@story-to-cyoa/runtime";
import { PublicationWorkspace } from "../src/features/workspace/PublicationWorkspace.js";
import { playerConfigInput, playerFixture } from "../../../packages/runtime/test/native-player-fixture.js";

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
    id: "nativebuild-1", compilationInputArtifactVersionId: "native-input-v1",
    sourceInputFingerprint: sourceFingerprint, bundleFingerprint,
    runtimeFingerprint: "5".repeat(32), snapshotId: readiness.snapshotId,
    structureVersionId: readiness.structureVersionId, compilerVersion: "foundation-7a-v1",
    runtimeContractVersion: "foundation-5a-v1", bundleSchemaId: "cyoa.native-game-bundle",
    bundleSchemaVersion: 1, passageCount: 300, choiceCount: 475, acceptedWordCount: 151_250,
    serializedBytes: 1_250_000,
    validation: { valid: true, loaded: true, smokePassageId: "passage-start", availableChoiceCount: 3 },
  },
};

const configBundle = playerFixture(4);
const defaultPlayerConfig = createNativePlayerConfig(playerConfigInput(configBundle), configBundle);
const configWorkspace = (config = defaultPlayerConfig, version: null | { id: string; version: number; createdAt: string } = null) => ({
  config,
  version,
  validForCurrentBundle: true,
  validationError: null,
  historicalBuildPolicy: "current-player-config" as const,
  passageOptions: configBundle.passages.map((passage) => ({ id: passage.id, title: passage.presentation.title })),
  visibleMechanicOptions: defaultPlayerConfig.visibleMechanics.map((mechanic) => ({
    ...mechanic, selected: config.visibleMechanics.some((selected) => selected.key === mechanic.key),
  })),
});

const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json" },
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.location.hash = ""; });

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
      if (url.endsWith("/publication/player-config")) return response(configWorkspace());
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
    expect(screen.getByText("Build v1").parentElement?.textContent).toContain("current");
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
    expect(screen.getByText(/historical source/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Compile native bundle" }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("installs an exact build locally and navigates to normal or authorized debug play", async () => {
    const bundle = playerFixture(3);
    const playerConfig = createNativePlayerConfig(playerConfigInput(bundle), bundle);
    const storage = new MemoryNativePlayerStorage();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (request, init) => {
      const url = String(request);
      if (url.endsWith("/publication/readiness")) return response(readiness);
      if (url.endsWith("/publication/builds")) return response({ items: [] });
      if (url.endsWith("/publication/player-config")) return response(configWorkspace(playerConfig));
      if (url.endsWith("/publication/compile") && init?.method === "POST") {
        return response({ build, bundle, playerConfig }, 201);
      }
      return response({ error: "Unexpected request" }, 404);
    });

    const user = userEvent.setup();
    render(<PublicationWorkspace projectId="project-native" playerStorage={storage} />);
    await user.click(await screen.findByRole("button", { name: "Play current build" }));
    await waitFor(() => expect(window.location.hash).toContain(`#player/${bundle.gameId}/${bundle.bundleFingerprint}`));
    expect(await storage.readInstallation(bundle.gameId, bundle.bundleFingerprint)).toMatchObject({ debugAuthorized: false });

    window.location.hash = "";
    await user.click(screen.getByRole("button", { name: "Debug current build" }));
    await waitFor(() => expect(window.location.hash).toContain("/debug"));
    expect(await storage.readInstallation(bundle.gameId, bundle.bundleFingerprint)).toMatchObject({ debugAuthorized: true });
  });

  it("edits, persists, reopens, and launches the current immutable player policy", async () => {
    const bundle = configBundle;
    const storage = new MemoryNativePlayerStorage();
    let currentConfig = defaultPlayerConfig;
    let version: null | { id: string; version: number; createdAt: string } = null;
    const requests: Array<{ url: string; method: string; body?: any }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (request, init) => {
      const url = String(request);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ url, method, body });
      if (url.endsWith("/publication/readiness")) return response(readiness);
      if (url.endsWith("/publication/builds")) return response({ items: [] });
      if (url.endsWith("/publication/player-config") && method === "GET") {
        return response(configWorkspace(currentConfig, version));
      }
      if (url.endsWith("/publication/player-config") && method === "PUT") {
        currentConfig = createNativePlayerConfig({
          gameId: bundle.gameId,
          rewindPolicy: body.rewindPolicy,
          autosaveEnabled: body.autosaveEnabled,
          manualSlotLimit: body.manualSlotLimit,
          visibleMechanics: defaultPlayerConfig.visibleMechanics.filter(
            (item) => body.visibleMechanicKeys.includes(item.key),
          ),
        }, bundle);
        version = { id: "player-config-v1", version: 1, createdAt: "2026-08-24T00:00:00.000Z" };
        return response(configWorkspace(currentConfig, version), 201);
      }
      if (url.endsWith("/publication/compile") && method === "POST") {
        return response({ build, bundle, playerConfig: currentConfig, playerConfigVersionId: version?.id ?? null }, 201);
      }
      return response({ error: "Unexpected request" }, 404);
    });

    const user = userEvent.setup();
    const rendered = render(<PublicationWorkspace projectId="project-native" playerStorage={storage} />);
    await screen.findByRole("combobox", { name: "Rewind mode" });
    await user.selectOptions(screen.getByRole("combobox", { name: "Rewind mode" }), "disabled");
    await user.clear(screen.getByRole("spinbutton", { name: "Manual save-slot limit" }));
    await user.type(screen.getByRole("spinbutton", { name: "Manual save-slot limit" }), "7");
    await user.click(screen.getByRole("checkbox", { name: /Autosave after/ }));
    await user.click(screen.getByRole("button", { name: "Save player policy" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("immutable version 1"));
    expect(requests.find((item) => item.method === "PUT")?.body).toMatchObject({
      rewindPolicy: { kind: "disabled" }, autosaveEnabled: false, manualSlotLimit: 7,
    });

    rendered.unmount();
    render(<PublicationWorkspace projectId="project-native" playerStorage={storage} />);
    expect(await screen.findByText(/Saved version 1/)).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Rewind mode" })).toHaveProperty("value", "disabled");
    await user.click(screen.getByRole("button", { name: "Play current build" }));
    await waitFor(() => expect(window.location.hash).toContain(`#player/${bundle.gameId}/${bundle.bundleFingerprint}`));
    expect(await storage.readInstallation(bundle.gameId, bundle.bundleFingerprint)).toMatchObject({
      config: { rewindPolicy: { kind: "disabled" }, autosaveEnabled: false, manualSlotLimit: 7 },
    });
  });
});
