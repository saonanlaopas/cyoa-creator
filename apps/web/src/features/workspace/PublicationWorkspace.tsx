import { useEffect, useState } from "react";
import {
  NATIVE_PLAYER_LIMITS,
  createNativePlayerInstallation,
  type NativePlayerRewindPolicy,
  type NativePlayerStorage,
} from "@story-to-cyoa/runtime";
import {
  compileNativeBuild,
  listNativeBuilds,
  loadNativePlayerConfig,
  loadPublicationReadiness,
  saveNativePlayerConfig,
  type NativeBuildSummary,
  type NativePlayerConfigWorkspace,
  type PublicationDiagnostic,
  type PublicationReadiness,
} from "../../api/publication.js";
import { IndexedDbNativePlayerStorage } from "../player/native-player-storage.js";
import { nativePlayerHash } from "../player/player-route.js";

interface PlayerConfigDraft {
  rewindKind: NativePlayerRewindPolicy["kind"];
  lastNSteps: number;
  maximumCheckpoints: number;
  passageIds: string[];
  autosaveEnabled: boolean;
  manualSlotLimit: number;
  visibleMechanicKeys: string[];
}

export function PublicationWorkspace({ projectId, playerStorage }: {
  projectId: string;
  playerStorage?: NativePlayerStorage;
}) {
  const [storage] = useState<NativePlayerStorage>(() => playerStorage ?? new IndexedDbNativePlayerStorage());
  const [readiness, setReadiness] = useState<PublicationReadiness | null>(null);
  const [builds, setBuilds] = useState<NativeBuildSummary[]>([]);
  const [playerConfig, setPlayerConfig] = useState<NativePlayerConfigWorkspace | null>(null);
  const [configDraft, setConfigDraft] = useState<PlayerConfigDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = async () => {
    const [nextReadiness, nextBuilds] = await Promise.all([
      loadPublicationReadiness(projectId),
      listNativeBuilds(projectId),
    ]);
    const nextPlayerConfig = nextReadiness.ready ? await loadNativePlayerConfig(projectId) : null;
    setReadiness(nextReadiness);
    setBuilds(nextBuilds.items);
    setPlayerConfig(nextPlayerConfig);
    setConfigDraft(nextPlayerConfig ? configDraftFrom(nextPlayerConfig) : null);
  };

  useEffect(() => {
    setMessage(null);
    void refresh().catch((error: Error) => setMessage(error.message));
  }, [projectId]);

  const compile = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await compileNativeBuild(projectId);
      await refresh();
      setMessage(`Native bundle compiled and runtime-loaded: ${result.bundle.bundleFingerprint}`);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveConfig = async () => {
    if (!configDraft) return;
    setBusy(true);
    setMessage(null);
    try {
      const rewindPolicy: NativePlayerRewindPolicy = configDraft.rewindKind === "bounded-last-n"
        ? { kind: "bounded-last-n", steps: configDraft.lastNSteps }
        : configDraft.rewindKind === "designated-checkpoints"
          ? {
            kind: "designated-checkpoints",
            passageIds: [...configDraft.passageIds].sort(),
            maximumCheckpoints: configDraft.maximumCheckpoints,
          }
          : { kind: configDraft.rewindKind };
      const saved = await saveNativePlayerConfig(projectId, {
        rewindPolicy,
        autosaveEnabled: configDraft.autosaveEnabled,
        manualSlotLimit: configDraft.manualSlotLimit,
        visibleMechanicKeys: [...configDraft.visibleMechanicKeys].sort(),
      });
      setPlayerConfig(saved);
      setConfigDraft(configDraftFrom(saved));
      setMessage(`Player policy saved as immutable version ${saved.version?.version ?? 1}.`);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const launch = async (debug: boolean, inputArtifactVersionId?: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await compileNativeBuild(projectId, inputArtifactVersionId);
      const installation = createNativePlayerInstallation(result.bundle, result.playerConfig, debug);
      await storage.install(installation);
      setBusy(false);
      window.location.hash = nativePlayerHash(installation.gameId, installation.bundleFingerprint, debug);
    } catch (error) {
      setMessage((error as Error).message);
      setBusy(false);
    }
  };

  if (!readiness) return <section className="artifact-pane publication-workspace">
    <header className="artifact-header"><div><p className="eyebrow">Foundation 7B</p><h1>Publication and play</h1></div></header>
    <p role="status">{message ?? "Inspecting exact approved publication state…"}</p>
  </section>;

  return <section className="artifact-pane publication-workspace" aria-label="Native publication workspace">
    <header className="artifact-header">
      <div>
        <p className="eyebrow">Foundation 7B</p>
        <h1>Publication and play</h1>
        <p>Compile one exact approved project state, then install and play it locally in the browser.</p>
      </div>
      <div className="artifact-actions">
        <button disabled={busy || !readiness.ready} onClick={() => void compile()}>Compile native bundle</button>
        <button className="primary" disabled={busy || !readiness.ready} onClick={() => void launch(false)}>Play current build</button>
        <button disabled={busy || !readiness.ready} onClick={() => void launch(true)}>Debug current build</button>
      </div>
    </header>

    {message && <p className={message.includes("runtime-loaded") || message.includes("policy saved") ? "status good" : "error"} role="status">{message}</p>}
    <p className={readiness.ready ? "status good" : "warning"}>
      {readiness.ready ? "Ready to compile exact accepted prose." : `${readiness.blockers.length} publication blocker${readiness.blockers.length === 1 ? "" : "s"}.`}
    </p>

    <section className="brief-section publication-player-config">
      <h2>Browser player policy</h2>
      <p>This immutable project setting is separate from gameplay bundle identity. Current policy is used for current and historical build launches.</p>
      {!playerConfig || !configDraft ? <p>Player policy is available when the project is publication-ready.</p> : <>
        {!playerConfig.validForCurrentBundle && <p className="error" role="alert">{playerConfig.validationError}</p>}
        <div className="publication-config-grid">
          <label>Rewind mode
            <select
              aria-label="Rewind mode"
              value={configDraft.rewindKind}
              onChange={(event) => setConfigDraft({ ...configDraft, rewindKind: event.target.value as PlayerConfigDraft["rewindKind"] })}
            >
              <option value="disabled">Disabled</option>
              <option value="previous-step">Previous step</option>
              <option value="bounded-last-n">Bounded last N</option>
              <option value="designated-checkpoints">Designated checkpoints</option>
            </select>
          </label>
          {configDraft.rewindKind === "bounded-last-n" && <label>Retained rewind steps
            <input
              aria-label="Retained rewind steps"
              type="number"
              min={1}
              max={NATIVE_PLAYER_LIMITS.maximumRewindLastN}
              value={configDraft.lastNSteps}
              onChange={(event) => setConfigDraft({ ...configDraft, lastNSteps: Number(event.target.value) })}
            />
          </label>}
          {configDraft.rewindKind === "designated-checkpoints" && <label>Maximum retained checkpoints
            <input
              aria-label="Maximum retained checkpoints"
              type="number"
              min={1}
              max={NATIVE_PLAYER_LIMITS.maximumHistoryEntries}
              value={configDraft.maximumCheckpoints}
              onChange={(event) => setConfigDraft({ ...configDraft, maximumCheckpoints: Number(event.target.value) })}
            />
          </label>}
          <label>Manual save-slot limit
            <input
              aria-label="Manual save-slot limit"
              type="number"
              min={1}
              max={NATIVE_PLAYER_LIMITS.maximumManualSlots}
              value={configDraft.manualSlotLimit}
              onChange={(event) => setConfigDraft({ ...configDraft, manualSlotLimit: Number(event.target.value) })}
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={configDraft.autosaveEnabled}
              onChange={(event) => setConfigDraft({ ...configDraft, autosaveEnabled: event.target.checked })}
            /> Autosave after successful state changes
          </label>
        </div>
        {configDraft.rewindKind === "designated-checkpoints" && <fieldset>
          <legend>Designated checkpoint passages</legend>
          <div className="publication-config-options">
            {playerConfig.passageOptions.map((passage) => <label className="checkbox" key={passage.id}>
              <input
                type="checkbox"
                checked={configDraft.passageIds.includes(passage.id)}
                onChange={(event) => setConfigDraft({
                  ...configDraft,
                  passageIds: toggleValue(configDraft.passageIds, passage.id, event.target.checked),
                })}
              /> {passage.title} <small>({passage.id})</small>
            </label>)}
          </div>
        </fieldset>}
        <fieldset>
          <legend>Player-visible state</legend>
          <p>Only mechanics already declared as visible stats can be selected. Hidden flags, facts, routes, and decisions are never offered.</p>
          <div className="publication-config-options">
            {playerConfig.visibleMechanicOptions.map((mechanic) => <label className="checkbox" key={mechanic.key}>
              <input
                type="checkbox"
                checked={configDraft.visibleMechanicKeys.includes(mechanic.key)}
                onChange={(event) => setConfigDraft({
                  ...configDraft,
                  visibleMechanicKeys: toggleValue(configDraft.visibleMechanicKeys, mechanic.key, event.target.checked),
                })}
              /> {mechanic.label} <small>({mechanic.key})</small>
            </label>)}
          </div>
        </fieldset>
        <div className="artifact-actions publication-config-actions">
          <small>{playerConfig.version
            ? `Saved version ${playerConfig.version.version} · ${playerConfig.config.configFingerprint}`
            : `Unsaved default · ${playerConfig.config.configFingerprint}`}</small>
          <button className="primary" disabled={busy} onClick={() => void saveConfig()}>Save player policy</button>
        </div>
      </>}
    </section>

    <section className="brief-section">
      <h2>Exact source identity</h2>
      <dl className="simulation-metadata">
        <div><dt>Source-input fingerprint</dt><dd>{readiness.sourceInputFingerprint ?? "Unavailable until blockers are resolved"}</dd></div>
        <div><dt>Approved snapshot</dt><dd>{readiness.snapshotId ?? "Not approved"}</dd></div>
        <div><dt>Structure version</dt><dd>{readiness.structureVersionId ?? "Unavailable"}</dd></div>
        <div><dt>Accepted prose coverage</dt><dd>{readiness.acceptedDraftCount} / {readiness.passageCount} passages</dd></div>
        <div><dt>Accepted words</dt><dd>{readiness.acceptedWordCount.toLocaleString()}</dd></div>
        <div><dt>Runtime</dt><dd>{readiness.runtimeContract.version} · schema v{readiness.runtimeContract.schemaVersion}</dd></div>
        <div><dt>Bundle</dt><dd>{readiness.bundleContract.schemaId}/v{readiness.bundleContract.schemaVersion}</dd></div>
        <div><dt>Compiler</dt><dd>{readiness.compiler.version} · policy v{readiness.compiler.policyVersion}</dd></div>
      </dl>
    </section>

    <DiagnosticSection title="Blockers" items={readiness.blockers} empty="No hard publication blockers." />
    <DiagnosticSection title="Warnings" items={readiness.warnings} empty="No unacknowledged warnings." />
    <DiagnosticSection title="Acknowledged warnings" items={readiness.acknowledgedWarnings} empty="No acknowledged warnings." />

    <section className="brief-section publication-builds">
      <h2>Immutable build metadata</h2>
      <p>Compiled bundle bodies are returned on demand and are not stored in SQLite. These records retain exact source and bundle identities.</p>
      {builds.length === 0 ? <p>No native builds yet.</p> : builds.map((build) => <article key={build.id}>
        <header>
          <span><strong>Build v{build.version}</strong> · {build.current ? "current" : "historical source"}</span>
          <span className="artifact-actions">
            <button disabled={busy} onClick={() => void launch(false, build.content.compilationInputArtifactVersionId)}>Play</button>
            <button disabled={busy} onClick={() => void launch(true, build.content.compilationInputArtifactVersionId)}>Debug</button>
          </span>
        </header>
        <dl className="simulation-metadata">
          <div><dt>Bundle fingerprint</dt><dd>{build.content.bundleFingerprint}</dd></div>
          <div><dt>Source fingerprint</dt><dd>{build.content.sourceInputFingerprint}</dd></div>
          <div><dt>Runtime fingerprint</dt><dd>{build.content.runtimeFingerprint}</dd></div>
          <div><dt>Corpus</dt><dd>{build.content.passageCount} passages · {build.content.choiceCount} choices · {build.content.acceptedWordCount.toLocaleString()} words</dd></div>
          <div><dt>Serialized bundle</dt><dd>{build.content.serializedBytes.toLocaleString()} bytes</dd></div>
          <div><dt>Runtime smoke</dt><dd>{build.content.validation.loaded ? `Loaded at ${build.content.validation.smokePassageId}` : "Failed"}</dd></div>
        </dl>
      </article>)}
    </section>
  </section>;
}

function DiagnosticSection({ title, items, empty }: {
  title: string;
  items: PublicationDiagnostic[];
  empty: string;
}) {
  return <section className="brief-section publication-diagnostics">
    <h2>{title}</h2>
    {items.length === 0 ? <p>{empty}</p> : items.map((item) => <article key={item.fingerprint}>
      <strong>{item.code}</strong>
      <p>{item.message}</p>
      <small>{item.sourceKind}: {item.sourceId}</small>
      {item.rationale && <p>Acknowledgement rationale: {item.rationale}</p>}
    </article>)}
  </section>;
}

function configDraftFrom(workspace: NativePlayerConfigWorkspace): PlayerConfigDraft {
  const policy = workspace.config.rewindPolicy;
  const passageIds = new Set(workspace.passageOptions.map((item) => item.id));
  const visibleMechanicKeys = new Set(workspace.visibleMechanicOptions.map((item) => item.key));
  return {
    rewindKind: policy.kind,
    lastNSteps: policy.kind === "bounded-last-n" ? policy.steps : 3,
    maximumCheckpoints: policy.kind === "designated-checkpoints" ? policy.maximumCheckpoints : 10,
    passageIds: policy.kind === "designated-checkpoints"
      ? policy.passageIds.filter((item) => passageIds.has(item)) : [],
    autosaveEnabled: workspace.config.autosaveEnabled,
    manualSlotLimit: workspace.config.manualSlotLimit,
    visibleMechanicKeys: workspace.config.visibleMechanics.map((item) => item.key)
      .filter((item) => visibleMechanicKeys.has(item)),
  };
}

function toggleValue(values: string[], value: string, checked: boolean): string[] {
  return checked
    ? [...new Set([...values, value])].sort()
    : values.filter((item) => item !== value);
}
