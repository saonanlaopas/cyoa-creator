// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MemoryNativePlayerStorage,
  NativePlayerError,
  createNativePlayerConfig,
  createNativePlayerInstallation,
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

describe("NativePlayer", () => {
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
