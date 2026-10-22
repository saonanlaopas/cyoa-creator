// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MemoryNativePlayerStorage,
  NativePlayerError,
  assertNativePlayerManualSlot,
  createNativePlayerConfig,
  createNativePlayerInstallation,
  loadNativePlayerSave,
  nativeBundleFingerprint,
  type NativePlayerSave,
} from "@story-to-cyoa/runtime";
import { NativePlayer } from "../src/features/player/NativePlayer.js";
import { playerConfigInput, playerFixture } from "../../../packages/runtime/test/native-player-fixture.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.location.hash = "";
});

async function installedPlayer(passageCount = 4, storage = new MemoryNativePlayerStorage()) {
  const bundle = playerFixture(passageCount);
  const config = createNativePlayerConfig(playerConfigInput(bundle), bundle);
  await storage.install(createNativePlayerInstallation(bundle, config, true));
  const route = { gameId: bundle.gameId, bundleFingerprint: bundle.bundleFingerprint, debug: false };
  return { bundle, config, storage, route };
}

async function installedWorldPlayer(autosaveEnabled = true) {
  const bundle = playerFixture(3);
  bundle.world = {
    schemaId: "cyoa.native-world", schemaVersion: 1, startLocationId: "station", initialMinutes: 1455,
    waitMinutes: [15], assets: [], connections: [],
    locations: [{ id: "station", name: "Station", parentId: null, passageId: "passage-0", mapImage: null, marker: null, hours: null }],
    actions: [{ id: "board", locationId: "station", label: "Read departure board", minutes: 7, result: "The early train leaves at dawn.\n\nPlatform three." }],
  };
  bundle.initialState.world = { schemaVersion: 1, locationId: "station", minutes: 1455 };
  bundle.bundleFingerprint = nativeBundleFingerprint(bundle);
  const config = createNativePlayerConfig({ ...playerConfigInput(bundle), autosaveEnabled }, bundle);
  const storage = new MemoryNativePlayerStorage();
  await storage.install(createNativePlayerInstallation(bundle, config));
  return { bundle, config, storage, route: { gameId: bundle.gameId, bundleFingerprint: bundle.bundleFingerprint, debug: false } };
}

describe("NativePlayer", () => {
  it.each(["enabled", "disabled", "failed"] as const)("retains the authored action outcome independently of %s autosave, committing time once", async (mode) => {
    const fixture = await installedWorldPlayer(mode !== "disabled");
    const write = vi.spyOn(fixture.storage, "writeAutosave");
    if (mode === "failed") write.mockRejectedValueOnce(new NativePlayerError("storage_quota_exceeded", "Test quota reached"));
    const user = userEvent.setup();
    render(<NativePlayer route={fixture.route} storage={fixture.storage} />);
    await user.click(await screen.findByRole("button", { name: "Read departure board · 7 min" }));
    await user.click(screen.getByRole("button", { name: "Confirm action" }));
    const outcome = await screen.findByRole("region", { name: "Action outcome" });
    expect(outcome.textContent).toBe("The early train leaves at dawn.Platform three.");
    expect(outcome.querySelectorAll("p")).toHaveLength(2);
    expect(screen.getByLabelText("Game time").textContent).toBe("Day 2 · 00:22");
    expect(screen.getByText("Turn 2")).toBeTruthy();
    expect(write).toHaveBeenCalledTimes(mode === "disabled" ? 0 : 1);
    if (mode === "failed") {
      expect(screen.getByRole("alert").textContent).toContain("Progress changed, but it is not saved.");
      expect(screen.getByRole("alert").textContent).toContain("storage_quota_exceeded");
      expect(await fixture.storage.readAutosave(fixture.bundle.gameId, fixture.bundle.bundleFingerprint)).toBeNull();
      await user.click(screen.getByRole("button", { name: "Retry autosave" }));
      await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
      expect(write).toHaveBeenCalledTimes(2);
      expect(write.mock.calls[1]![2].state).toEqual(write.mock.calls[0]![2].state);
      expect(screen.getByRole("status").textContent).toBe("Progress is saved.");
    } else {
      expect(screen.getByRole("status").textContent).toBe(mode === "enabled" ? "Progress autosaved." : "Progress updated. Autosave is disabled.");
    }
    await user.click(screen.getByRole("button", { name: "Save game" }));
    await user.type(screen.getByLabelText("Save name"), "After reading");
    await user.click(screen.getByRole("button", { name: "Create save" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Saved “After reading”"));
    const [slot] = await fixture.storage.listManualSlots(fixture.bundle.gameId);
    const saved = loadNativePlayerSave(fixture.bundle, fixture.config, assertNativePlayerManualSlot(slot).save);
    expect(saved.state.turn).toBe(1);
    expect(saved.state.world).toEqual({ schemaVersion: 1, locationId: "station", minutes: 1462, stationaryTurns: 1 });
    expect(screen.getByRole("region", { name: "Action outcome" })).toBe(outcome);
    expect(screen.getByLabelText("Game time").textContent).toBe("Day 2 · 00:22");
    expect(screen.getByText("Turn 2")).toBeTruthy();
  });

  it.each(["choice", "rewind", "restart", "load", "route"] as const)("clears an earlier action outcome when %s replaces the session", async (transition) => {
    const fixture = await installedWorldPlayer();
    const user = userEvent.setup();
    const mounted = render(<NativePlayer route={fixture.route} storage={fixture.storage} />);
    await user.click(await screen.findByRole("button", { name: "Save game" }));
    await user.type(screen.getByLabelText("Save name"), "Before reading");
    await user.click(screen.getByRole("button", { name: "Create save" }));
    await user.click(screen.getByRole("button", { name: "Read departure board · 7 min" }));
    await user.click(screen.getByRole("button", { name: "Confirm action" }));
    expect(screen.getByRole("region", { name: "Action outcome" }).textContent).toContain("The early train leaves at dawn.");
    if (transition === "choice") await user.click(screen.getByRole("button", { name: "Continue 1" }));
    if (transition === "rewind") await user.click(screen.getByRole("button", { name: "Rewind" }));
    if (transition === "restart") {
      await user.click(screen.getByRole("button", { name: "Restart" }));
      await user.click(screen.getByRole("button", { name: "Restart game" }));
    }
    if (transition === "load") {
      await user.click(screen.getByRole("button", { name: "Load game" }));
      await user.click(screen.getByRole("button", { name: "Load" }));
    }
    if (transition === "route") {
      const other = await installedPlayer(3, fixture.storage);
      mounted.rerender(<NativePlayer route={other.route} storage={fixture.storage} />);
      await waitFor(() => expect(screen.queryByLabelText("Game time")).toBeNull());
    }
    await waitFor(() => expect(screen.queryByRole("region", { name: "Action outcome" })).toBeNull());
  });

  it("retains the outcome when another action is cancelled and replaces it only when that action commits", async () => {
    const fixture = await installedWorldPlayer();
    const user = userEvent.setup();
    render(<NativePlayer route={fixture.route} storage={fixture.storage} />);
    await user.click(await screen.findByRole("button", { name: "Read departure board · 7 min" }));
    await user.click(screen.getByRole("button", { name: "Confirm action" }));
    await user.click(screen.getByRole("button", { name: "Wait 15 min" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("region", { name: "Action outcome" }).textContent).toContain("The early train leaves at dawn.");
    expect(screen.getByLabelText("Game time").textContent).toBe("Day 2 · 00:22");
    await user.click(screen.getByRole("button", { name: "Wait 15 min" }));
    await user.click(screen.getByRole("button", { name: "Confirm action" }));
    expect(screen.getByRole("region", { name: "Action outcome" }).textContent).not.toContain("The early train leaves at dawn.");
    expect(screen.getByLabelText("Game time").textContent).toBe("Day 2 · 00:37");
  });

  it("plays, autosaves, reloads, manually saves/loads, rewinds, and restarts without API calls", async () => {
    const fixture = await installedPlayer(4);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const user = userEvent.setup();
    const first = render(<NativePlayer route={fixture.route} storage={fixture.storage} />);
    expect(await screen.findByRole("heading", { name: "Passage 0" })).toBeTruthy();
    expect(screen.getByText("Exact prose 0.")).toBeTruthy();
    expect(screen.queryByText("Authorized debug state")).toBeNull();
    expect(screen.getByText("Resolve")).toBeTruthy();
    expect(screen.queryByText("secret")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Save game" }));
    await user.type(screen.getByLabelText("Save name"), "Opening");
    await user.click(screen.getByRole("button", { name: "Create save" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Opening"));

    await user.click(screen.getByRole("button", { name: "Continue 1" }));
    expect(await screen.findByRole("heading", { name: "Passage 1" })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Passage 1" })));
    first.unmount();

    render(<NativePlayer route={fixture.route} storage={fixture.storage} />);
    expect(await screen.findByRole("heading", { name: "Passage 1" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Autosave restored");
    await user.click(screen.getByRole("button", { name: "Rewind" }));
    expect(await screen.findByRole("heading", { name: "Passage 0" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Continue 1" }));
    await user.click(screen.getByRole("button", { name: "Load game" }));
    await user.click(screen.getByRole("button", { name: "Load" }));
    expect(await screen.findByRole("heading", { name: "Passage 0" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Continue 1" }));
    await user.click(screen.getByRole("button", { name: "Restart" }));
    await user.click(screen.getByRole("button", { name: "Restart game" }));
    expect(await screen.findByRole("heading", { name: "Passage 0" })).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps a successful transition active and visibly reports when autosave storage fails", async () => {
    class FailingStorage extends MemoryNativePlayerStorage {
      private failuresRemaining = 1;
      override async writeAutosave(gameId: string, bundleFingerprint: string, value: NativePlayerSave): Promise<void> {
        if (this.failuresRemaining-- > 0) {
          throw new NativePlayerError("storage_quota_exceeded", "Test quota reached");
        }
        await super.writeAutosave(gameId, bundleFingerprint, value);
      }
    }
    const fixture = await installedPlayer(3, new FailingStorage());
    const user = userEvent.setup();
    render(<NativePlayer route={fixture.route} storage={fixture.storage} />);
    await user.click(await screen.findByRole("button", { name: "Continue 1" }));
    expect(await screen.findByRole("heading", { name: "Passage 1" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("not saved");
    expect(screen.getByRole("alert").textContent).toContain("storage_quota_exceeded");
    await user.click(screen.getByRole("button", { name: "Retry autosave" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByRole("status").textContent).toContain("Progress is saved");
  });

  it("renders a canonically disabled choice with its approved explanation and keeps hidden unavailable choices absent", async () => {
    const disabledBundle = playerFixture(3, "disabled");
    const config = createNativePlayerConfig(playerConfigInput(disabledBundle), disabledBundle);
    const storage = new MemoryNativePlayerStorage();
    await storage.install(createNativePlayerInstallation(disabledBundle, config));
    render(<NativePlayer route={{
      gameId: disabledBundle.gameId, bundleFingerprint: disabledBundle.bundleFingerprint, debug: false,
    }} storage={storage} />);
    const unavailable = await screen.findByRole("button", { name: /Unavailable shortcut/ });
    expect((unavailable as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Not yet available.")).toBeTruthy();

    cleanup();
    const hidden = await installedPlayer(3);
    render(<NativePlayer route={hidden.route} storage={hidden.storage} />);
    await screen.findByRole("heading", { name: "Passage 0" });
    expect(screen.queryByText("Unavailable shortcut")).toBeNull();
  });

  it("requires explicit recovery when a stored autosave is malformed and does not silently delete it", async () => {
    const fixture = await installedPlayer(3);
    fixture.storage.unsafeSetAutosave(fixture.bundle.gameId, fixture.bundle.bundleFingerprint, {
      schemaId: "cyoa.native-player-save", schemaVersion: 1, corrupted: true,
    });
    const user = userEvent.setup();
    render(<NativePlayer route={fixture.route} storage={fixture.storage} />);
    expect(await screen.findByText("Saved progress needs attention.")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("save_state_invalid");
    expect((screen.getByRole("button", { name: "Continue 1" }) as HTMLButtonElement).disabled).toBe(true);
    expect(await fixture.storage.readAutosave(fixture.bundle.gameId, fixture.bundle.bundleFingerprint)).toMatchObject({ corrupted: true });
    await user.click(screen.getByRole("button", { name: "Start new game" }));
    await waitFor(() => expect(screen.queryByText("Saved progress needs attention.")).toBeNull());
  });

  it("omits rewind control and retains no history when rewind policy is disabled", async () => {
    const bundle = playerFixture(3);
    const config = createNativePlayerConfig({ ...playerConfigInput(bundle), rewindPolicy: { kind: "disabled" } }, bundle);
    const storage = new MemoryNativePlayerStorage();
    await storage.install(createNativePlayerInstallation(bundle, config));
    const user = userEvent.setup();
    render(<NativePlayer route={{ gameId: bundle.gameId, bundleFingerprint: bundle.bundleFingerprint, debug: false }} storage={storage} />);
    await user.click(await screen.findByRole("button", { name: "Continue 1" }));
    expect(screen.queryByRole("button", { name: "Rewind" })).toBeNull();
  });

  it("enables designated rewind only when the pure session layer has an earlier usable checkpoint", async () => {
    const bundle = playerFixture(4);
    const config = createNativePlayerConfig({
      ...playerConfigInput(bundle),
      rewindPolicy: {
        kind: "designated-checkpoints",
        passageIds: ["passage-1", "passage-2"],
        maximumCheckpoints: 2,
      },
    }, bundle);
    const storage = new MemoryNativePlayerStorage();
    await storage.install(createNativePlayerInstallation(bundle, config));
    const user = userEvent.setup();
    render(<NativePlayer route={{
      gameId: bundle.gameId, bundleFingerprint: bundle.bundleFingerprint, debug: false,
    }} storage={storage} />);
    await user.click(await screen.findByRole("button", { name: "Continue 1" }));
    const rewind = screen.getByRole("button", { name: "Rewind" });
    expect((rewind as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Continue 2" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Rewind" }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(screen.getByRole("button", { name: "Rewind" }));
    expect(await screen.findByRole("heading", { name: "Passage 1" })).toBeTruthy();
    expect(screen.queryByText(/player_rewind_unavailable/)).toBeNull();
  });

  it("renders untrusted prose as literal text and exposes bounded debug only on an authorized debug route", async () => {
    const bundle = playerFixture(3);
    bundle.passages[0]!.proseMarkdown = '<img src=x onerror="window.__owned=true">\n\nLiteral **markdown**.';
    bundle.bundleFingerprint = nativeBundleFingerprint(bundle);
    const config = createNativePlayerConfig(playerConfigInput(bundle), bundle);
    const storage = new MemoryNativePlayerStorage();
    await storage.install(createNativePlayerInstallation(bundle, config, true));
    const route = { gameId: bundle.gameId, bundleFingerprint: bundle.bundleFingerprint, debug: true };
    const { container } = render(<NativePlayer route={route} storage={storage} />);
    expect(await screen.findByText(/<img src=x onerror/)).toBeTruthy();
    expect(screen.getByText("Literal **markdown**.")).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("Authorized debug state")).toBeTruthy();
  });

  it("loads a 300-passage installation while rendering only the active passage", async () => {
    const fixture = await installedPlayer(300);
    const { container } = render(<NativePlayer route={fixture.route} storage={fixture.storage} />);
    expect(await screen.findByRole("heading", { name: "Passage 0" })).toBeTruthy();
    expect(screen.getByText("Exact prose 0.")).toBeTruthy();
    expect(screen.queryByText("Exact prose 299.")).toBeNull();
    expect(container.querySelectorAll(".native-player-passage")).toHaveLength(1);
  });

  it("keeps incompatible and malformed manual saves visible but not loadable", async () => {
    const fixture = await installedPlayer(3);
    const other = await installedPlayer(4, fixture.storage);
    const otherSession = (await import("@story-to-cyoa/runtime")).createNativePlayerSession(other.bundle, other.config);
    const otherSlot = (await import("@story-to-cyoa/runtime")).createNativePlayerManualSlot(
      other.bundle, other.config, otherSession, "other-slot", "Older gameplay", "2026-08-23T00:00:00.000Z",
    );
    await fixture.storage.writeManualSlot(otherSlot);
    const user = userEvent.setup();
    render(<NativePlayer route={fixture.route} storage={fixture.storage} />);
    await screen.findByRole("heading", { name: "Passage 0" });
    await user.click(screen.getByRole("button", { name: "Load game" }));
    expect(screen.getByText("Older gameplay")).toBeTruthy();
    expect(screen.getByText(/another gameplay build/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Load" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("uses accessible confirmations before overwriting or deleting a manual save", async () => {
    const fixture = await installedPlayer(3);
    const user = userEvent.setup();
    render(<NativePlayer route={fixture.route} storage={fixture.storage} />);
    await screen.findByRole("heading", { name: "Passage 0" });
    await user.click(screen.getByRole("button", { name: "Save game" }));
    await user.type(screen.getByLabelText("Save name"), "Protected slot");
    await user.click(screen.getByRole("button", { name: "Create save" }));

    await user.click(screen.getByRole("button", { name: "Save game" }));
    await user.click(screen.getByRole("button", { name: "Overwrite" }));
    expect(screen.getByRole("dialog", { name: /Overwrite/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: "Load game" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("dialog", { name: /Delete/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await fixture.storage.listManualSlots(fixture.bundle.gameId)).toHaveLength(1);
  });
});
