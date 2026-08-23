import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  NativePlayerError,
  assertNativePlayerInstallation,
  assertNativePlayerManualSlot,
  chooseNativePlayerSession,
  createNativePlayerManualSlot,
  createNativePlayerSave,
  createNativePlayerSession,
  loadNativePlayerSave,
  nativePlayerSaveCompatibility,
  nativePlayerView,
  restartNativePlayerSession,
  rewindNativePlayerSession,
  type NativePlayerInstallation,
  type NativePlayerManualSlot,
  type NativePlayerSession,
  type NativePlayerStorage,
} from "@story-to-cyoa/runtime";
import { IndexedDbNativePlayerStorage } from "./native-player-storage.js";

export interface NativePlayerRoute {
  gameId: string;
  bundleFingerprint: string;
  debug: boolean;
}

interface SlotView {
  slot: NativePlayerManualSlot | null;
  raw: unknown;
  compatible: boolean;
  compatibilityCode: string | null;
}

export function NativePlayer({ route, storage: suppliedStorage }: {
  route: NativePlayerRoute;
  storage?: NativePlayerStorage;
}) {
  const [storage] = useState<NativePlayerStorage>(() => suppliedStorage ?? new IndexedDbNativePlayerStorage());
  const [installation, setInstallation] = useState<NativePlayerInstallation | null>(null);
  const [session, setSession] = useState<NativePlayerSession | null>(null);
  const [slots, setSlots] = useState<SlotView[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Loading game…");
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"save" | "load" | "restart" | "overwrite" | "delete" | null>(null);
  const [pendingSlot, setPendingSlot] = useState<SlotView | null>(null);
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const [saveLabel, setSaveLabel] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const refreshSlots = async (installed: NativePlayerInstallation): Promise<void> => {
    const rawSlots = await storage.listManualSlots(installed.gameId);
    setSlots(rawSlots.map((raw): SlotView => {
      try {
        const slot = assertNativePlayerManualSlot(raw);
        const compatibility = nativePlayerSaveCompatibility(installed.bundle, slot.save);
        return { slot, raw, compatible: compatibility.compatible, compatibilityCode: compatibility.code };
      } catch {
        return { slot: null, raw, compatible: false, compatibilityCode: "manual_slot_invalid" };
      }
    }).sort((left, right) => (right.slot?.savedAt ?? "").localeCompare(left.slot?.savedAt ?? "")));
  };

  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const raw = await storage.readInstallation(route.gameId, route.bundleFingerprint);
        if (!raw) throw new NativePlayerError("installation_invalid", "This native build is not installed in this browser");
        const installed = assertNativePlayerInstallation(raw);
        if (installed.gameId !== route.gameId || installed.bundleFingerprint !== route.bundleFingerprint) {
          throw new NativePlayerError("installation_invalid", "Installed game identity does not match this player route");
        }
        if (route.debug && !installed.debugAuthorized) {
          throw new NativePlayerError("installation_invalid", "Debug play was not authorized for this launch");
        }
        let next = createNativePlayerSession(installed.bundle, installed.config);
        const autosave = await storage.readAutosave(installed.gameId, installed.bundleFingerprint);
        let autosaveError: unknown = null;
        if (autosave) {
          try { next = loadNativePlayerSave(installed.bundle, installed.config, autosave); }
          catch (caught) { autosaveError = caught; }
        }
        if (!current) return;
        setInstallation(installed);
        setSession(next);
        setRecoveryRequired(Boolean(autosaveError));
        setError(autosaveError ? `Autosave was not loaded. ${playerErrorMessage(autosaveError)}` : null);
        setMessage(autosaveError ? "" : autosave ? "Autosave restored." : "New game started.");
        try { await refreshSlots(installed); }
        catch (caught) { if (current) setError(playerErrorMessage(caught)); }
      } catch (caught) {
        if (current) {
          setError(playerErrorMessage(caught));
          setMessage("");
        }
      }
    })();
    return () => { current = false; };
  }, [route.gameId, route.bundleFingerprint, route.debug, storage]);

  const focusPassage = () => requestAnimationFrame(() => headingRef.current?.focus());

  const openDialog = (next: NonNullable<typeof dialog>, slot: SlotView | null = null) => {
    if (!dialog) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    setPendingSlot(slot);
    setDialog(next);
  };

  const closeDialog = () => {
    setDialog(null);
    setPendingSlot(null);
    requestAnimationFrame(() => returnFocusRef.current?.focus());
  };

  const persistAutosave = async (installed: NativePlayerInstallation, next: NativePlayerSession): Promise<void> => {
    if (!installed.config.autosaveEnabled) return;
    const save = createNativePlayerSave(installed.bundle, installed.config, next);
    await storage.writeAutosave(installed.gameId, installed.bundleFingerprint, save);
  };

  const commitSession = async (next: NativePlayerSession, success: string): Promise<void> => {
    if (!installation) return;
    setSession(next);
    setRecoveryRequired(false);
    setError(null);
    focusPassage();
    try {
      await persistAutosave(installation, next);
      setMessage(installation.config.autosaveEnabled ? success : "Progress updated. Autosave is disabled.");
    } catch (caught) {
      setMessage("");
      setError(`Progress changed, but it is not saved. ${playerErrorMessage(caught)}`);
    }
  };

  const choose = async (choiceId: string) => {
    if (!installation || !session || busy) return;
    setBusy(true);
    try {
      const next = chooseNativePlayerSession(installation.bundle, installation.config, session, choiceId).session;
      await commitSession(next, "Progress autosaved.");
    } catch (caught) {
      setError(playerErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const rewind = async () => {
    if (!installation || !session || busy) return;
    setBusy(true);
    try {
      await commitSession(
        rewindNativePlayerSession(installation.bundle, installation.config, session),
        "Rewound and autosaved.",
      );
    } catch (caught) {
      setError(playerErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const restart = async () => {
    if (!installation || busy) return;
    closeDialog();
    setBusy(true);
    try {
      await commitSession(restartNativePlayerSession(installation.bundle, installation.config), "New game autosaved.");
    } finally {
      setBusy(false);
    }
  };

  const writeSlot = async (slotId?: string, label?: string) => {
    if (!installation || !session || busy) return;
    const effectiveLabel = (label ?? saveLabel).trim();
    if (!effectiveLabel) {
      setError("Enter a name for this save.");
      return;
    }
    const gameSlotCount = slots.filter((item) => item.slot).length;
    if (!slotId && gameSlotCount >= installation.config.manualSlotLimit) {
      setError(`This game allows ${installation.config.manualSlotLimit} manual save slots.`);
      return;
    }
    setBusy(true);
    try {
      const nextSlot = createNativePlayerManualSlot(
        installation.bundle, installation.config, session,
        slotId ?? `slot-${globalThis.crypto.randomUUID()}`, effectiveLabel, new Date().toISOString(),
      );
      await storage.writeManualSlot(nextSlot);
      await refreshSlots(installation);
      setSaveLabel("");
      closeDialog();
      setError(null);
      setMessage(slotId ? `Overwrote “${effectiveLabel}”.` : `Saved “${effectiveLabel}”.`);
    } catch (caught) {
      setError(playerErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const loadSlot = async (view: SlotView) => {
    if (!installation || !view.slot || !view.compatible || busy) return;
    setBusy(true);
    try {
      const next = loadNativePlayerSave(installation.bundle, installation.config, view.slot.save);
      closeDialog();
      await commitSession(next, `Loaded “${view.slot.label}”.`);
    } catch (caught) {
      setError(`Save was not loaded. ${playerErrorMessage(caught)}`);
    } finally {
      setBusy(false);
    }
  };

  const deleteSlot = async (view: SlotView) => {
    if (!installation || !view.slot || busy) return;
    setBusy(true);
    try {
      await storage.deleteManualSlot(view.slot.gameId, view.slot.slotId, view.slot.bundleFingerprint);
      await refreshSlots(installation);
      closeDialog();
      setMessage(`Deleted “${view.slot.label}”.`);
      setError(null);
    } catch (caught) {
      setError(playerErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const retryAutosave = async () => {
    if (!installation || !session || busy) return;
    setBusy(true);
    try {
      await persistAutosave(installation, session);
      setError(null);
      setMessage("Progress is saved.");
    } catch (caught) {
      setError(`Progress is still not saved. ${playerErrorMessage(caught)}`);
    } finally {
      setBusy(false);
    }
  };

  if (!installation || !session) return <main className="native-player-shell">
    <section className="native-player-card" aria-label="Native game player">
      <h1>Native game player</h1>
      {error ? <p className="error" role="alert">{error}</p> : <p role="status">{message}</p>}
      <button onClick={() => { window.location.hash = "long-form"; }}>Return to publication workspace</button>
    </section>
  </main>;

  const view = nativePlayerView(installation.bundle, installation.config, session);
  const canRewind = installation.config.rewindPolicy.kind !== "disabled" && session.history.length > 0;

  return <main className="native-player-shell">
    <div className="native-player-layout">
      <article className="native-player-card native-player-passage">
        <header>
          <p className="eyebrow">{view.terminal.result ? "Ending" : `Turn ${session.state.turn + 1}`}</p>
          <h1 ref={headingRef} tabIndex={-1}>{view.passage.presentation.title}</h1>
        </header>
        <div className="native-player-prose">
          {paragraphs(view.passage.proseMarkdown).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
        </div>
        {recoveryRequired && <section className="native-player-recovery" aria-label="Save recovery">
          <strong>Saved progress needs attention.</strong>
          <p>Start a new game explicitly or load a compatible manual save. The unreadable autosave has not been deleted.</p>
          <div>
            <button disabled={busy} onClick={() => void restart()}>Start new game</button>
            <button disabled={busy} onClick={() => openDialog("load")}>Review manual saves</button>
          </div>
        </section>}
        {view.terminal.result && <p className="native-player-ending" role="status">This ending is complete.</p>}
        {!view.terminal.result && <section className="native-player-choices" aria-label="Choices">
          {view.choices.map(({ choice, availability }) => <button
            key={choice.id}
            disabled={busy || recoveryRequired || !availability.enabled}
            aria-describedby={!availability.enabled && choice.unavailableExplanation ? `${choice.id}-reason` : undefined}
            onClick={() => void choose(choice.id)}
          >
            <span>{choice.text}</span>
            {!availability.enabled && choice.unavailableExplanation
              ? <small id={`${choice.id}-reason`}>{choice.unavailableExplanation}</small> : null}
          </button>)}
        </section>}
      </article>

      <aside className="native-player-sidebar" aria-label="Game status and saves">
        {view.visibleState.length > 0 && <section className="native-player-state">
          <h2>Status</h2>
          <dl>{view.visibleState.map((item) => <div key={item.key}>
            <dt>{item.label}</dt><dd>{item.value}{item.bandLabel ? ` · ${item.bandLabel}` : ""}</dd>
          </div>)}</dl>
        </section>}
        <section className="native-player-controls" aria-label="Game controls">
          <h2>Game</h2>
          {installation.config.rewindPolicy.kind !== "disabled"
            ? <button disabled={busy || recoveryRequired || !canRewind} onClick={() => void rewind()}>Rewind</button> : null}
          <button disabled={busy || recoveryRequired} onClick={() => openDialog("save")}>Save game</button>
          <button disabled={busy} onClick={() => openDialog("load")}>Load game</button>
          <button disabled={busy || recoveryRequired} onClick={() => openDialog("restart")}>Restart</button>
        </section>
        {message && <p className="status good" role="status">{message}</p>}
        {error && <p className="error" role="alert">{error}</p>}
        {error?.includes("not saved") && !recoveryRequired
          ? <button disabled={busy} onClick={() => void retryAutosave()}>Retry autosave</button> : null}
        {route.debug && <details className="native-player-debug">
          <summary>Authorized debug state</summary>
          <pre>{JSON.stringify({
            bundleFingerprint: installation.bundleFingerprint,
            sourceInputFingerprint: installation.bundle.source.inputFingerprint,
            passageId: session.state.currentPassageId,
            turn: session.state.turn,
            decisions: session.state.decisions.slice(-50),
            routes: session.state.routes,
            knownFacts: session.state.knownFacts.slice(-100),
          }, null, 2)}</pre>
        </details>}
      </aside>
    </div>

    {dialog === "save" && <PlayerDialog labelId="save-game-title" onClose={closeDialog}>
      <h2 id="save-game-title">Save game</h2>
      <label>Save name<input autoFocus maxLength={80} value={saveLabel} onChange={(event) => setSaveLabel(event.target.value)} /></label>
      <p>{slots.filter((item) => item.slot).length} / {installation.config.manualSlotLimit} slots used</p>
      <div className="native-player-dialog-actions">
        <button disabled={busy} onClick={closeDialog}>Cancel</button>
        <button className="primary" disabled={busy || !saveLabel.trim()} onClick={() => void writeSlot()}>Create save</button>
      </div>
      {slots.filter((item) => item.compatible && item.slot).map((item) => <div className="native-player-slot" key={item.slot!.slotId}>
        <span><strong>{item.slot!.label}</strong><small>{formatDate(item.slot!.savedAt)}</small></span>
        <button disabled={busy} onClick={() => openDialog("overwrite", item)}>Overwrite</button>
      </div>)}
    </PlayerDialog>}

    {dialog === "load" && <PlayerDialog labelId="load-game-title" onClose={closeDialog}>
      <h2 id="load-game-title">Load game</h2>
      {slots.length === 0 ? <p>No manual saves yet.</p> : slots.map((item, index) => <div className="native-player-slot" key={item.slot?.slotId ?? `invalid-${index}`}>
        <span>
          <strong>{item.slot?.label ?? "Unreadable save"}</strong>
          <small>{item.slot ? formatDate(item.slot.savedAt) : "Stored data is invalid"}</small>
          {!item.compatible && <em>Incompatible: {compatibilityLabel(item.compatibilityCode)}</em>}
        </span>
        <div>
          <button disabled={busy || !item.compatible} onClick={() => void loadSlot(item)}>Load</button>
          {item.slot && <button disabled={busy} onClick={() => openDialog("delete", item)}>Delete</button>}
        </div>
      </div>)}
      <button autoFocus disabled={busy} onClick={closeDialog}>Close</button>
    </PlayerDialog>}

    {dialog === "restart" && <PlayerDialog labelId="restart-title" onClose={closeDialog}>
      <h2 id="restart-title">Restart this game?</h2>
      <p>Your autosave will return to the opening passage. Manual saves will remain available.</p>
      <div className="native-player-dialog-actions">
        <button autoFocus disabled={busy} onClick={closeDialog}>Cancel</button>
        <button className="primary" disabled={busy} onClick={() => void restart()}>Restart game</button>
      </div>
    </PlayerDialog>}

    {dialog === "overwrite" && pendingSlot?.slot && <PlayerDialog labelId="overwrite-title" onClose={closeDialog}>
      <h2 id="overwrite-title">Overwrite “{pendingSlot.slot.label}”?</h2>
      <p>The prior contents of this manual slot will be replaced with the current validated session.</p>
      <div className="native-player-dialog-actions">
        <button autoFocus disabled={busy} onClick={closeDialog}>Cancel</button>
        <button className="primary" disabled={busy} onClick={() => void writeSlot(
          pendingSlot.slot!.slotId, pendingSlot.slot!.label,
        )}>Overwrite save</button>
      </div>
    </PlayerDialog>}

    {dialog === "delete" && pendingSlot?.slot && <PlayerDialog labelId="delete-title" onClose={closeDialog}>
      <h2 id="delete-title">Delete “{pendingSlot.slot.label}”?</h2>
      <p>This removes only this browser-local manual save. The active game will not change.</p>
      <div className="native-player-dialog-actions">
        <button autoFocus disabled={busy} onClick={closeDialog}>Cancel</button>
        <button disabled={busy} onClick={() => void deleteSlot(pendingSlot)}>Delete save</button>
      </div>
    </PlayerDialog>}
  </main>;
}

function paragraphs(prose: string): string[] {
  return prose.split(/\r?\n\s*\r?\n/).filter((item) => item.length > 0);
}

function playerErrorMessage(error: unknown): string {
  if (error instanceof NativePlayerError) return `${error.message} (${error.code})`;
  return error instanceof Error ? error.message : "Unexpected player error";
}

function compatibilityLabel(code: string | null): string {
  return ({
    save_schema_unsupported: "unsupported save format",
    save_game_mismatch: "another game",
    save_bundle_incompatible: "another gameplay build",
    save_runtime_incompatible: "another runtime version",
    save_bundle_schema_incompatible: "another bundle format",
    save_fingerprint_invalid: "failed integrity validation",
    save_state_invalid: "invalid save data",
    save_history_invalid: "invalid rewind history",
    manual_slot_invalid: "invalid save slot",
  } as Record<string, string>)[code ?? ""] ?? "unknown reason";
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function PlayerDialog({ labelId, onClose, children }: {
  labelId: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof element.showModal === "function") element.showModal();
    else element.setAttribute("open", "");
    return () => { if (element.open && typeof element.close === "function") element.close(); };
  }, []);
  return <dialog
    ref={ref}
    aria-labelledby={labelId}
    className="native-player-dialog"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
  >{children}</dialog>;
}
