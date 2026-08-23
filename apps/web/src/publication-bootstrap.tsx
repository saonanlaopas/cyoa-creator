import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  MemoryNativePlayerStorage,
  createNativePlayerInstallation,
  type NativeGameBundle,
  type NativePlayerConfig,
  type NativePlayerStorage,
} from "@story-to-cyoa/runtime";
import { NativePlayer } from "./features/player/NativePlayer.js";
import { IndexedDbNativePlayerStorage } from "./features/player/native-player-storage.js";
import "./app/app.css";

declare global { var __CYOA_PUBLICATION_B64__: string | undefined }

function decodePayload(value: string): { bundle: NativeGameBundle; config: NativePlayerConfig } {
  const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as { bundle: NativeGameBundle; config: NativePlayerConfig };
}

async function source(): Promise<{ bundle: NativeGameBundle; config: NativePlayerConfig }> {
  if (globalThis.__CYOA_PUBLICATION_B64__) return decodePayload(globalThis.__CYOA_PUBLICATION_B64__);
  const [bundle, config] = await Promise.all([fetch("./game.json"), fetch("./player-config.json")]);
  if (!bundle.ok || !config.ok) throw new Error("Publication assets could not be loaded");
  return { bundle: await bundle.json() as NativeGameBundle, config: await config.json() as NativePlayerConfig };
}

function PublishedPlayer() {
  const [state, setState] = useState<{ storage: NativePlayerStorage; bundle: NativeGameBundle; persistent: boolean } | { error: string } | null>(null);
  useEffect(() => { void (async () => {
    try {
      const input = await source(); const installation = createNativePlayerInstallation(input.bundle, input.config, false);
      let storage: NativePlayerStorage = new IndexedDbNativePlayerStorage(); let persistent = true;
      try { await storage.install(installation); }
      catch { storage = new MemoryNativePlayerStorage(); persistent = false; await storage.install(installation); }
      setState({ storage, bundle: input.bundle, persistent });
    } catch (error) { setState({ error: error instanceof Error ? error.message : "Publication failed to load" }); }
  })(); }, []);
  if (!state) return <main className="native-player-shell"><p role="status">Loading publication…</p></main>;
  if ("error" in state) return <main className="native-player-shell"><p className="error" role="alert">{state.error}</p></main>;
  return <>{!state.persistent && <p className="warning" role="status">Browser storage is unavailable. This story remains playable, but saves last only while this page stays open.</p>}<NativePlayer route={{ gameId: state.bundle.gameId, bundleFingerprint: state.bundle.bundleFingerprint, debug: false }} storage={state.storage} /></>;
}

const root = document.getElementById("root");
if (!root) throw new Error("Publication root is missing");
createRoot(root).render(<PublishedPlayer />);
