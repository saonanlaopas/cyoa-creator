import { useEffect, useState } from "react";
import { createNativePlayerInstallation, type NativePlayerStorage } from "@story-to-cyoa/runtime";
import {
  compileNativeBuild,
  listNativeBuilds,
  loadPublicationReadiness,
  type NativeBuildSummary,
  type PublicationDiagnostic,
  type PublicationReadiness,
} from "../../api/publication.js";
import { IndexedDbNativePlayerStorage } from "../player/native-player-storage.js";
import { nativePlayerHash } from "../player/player-route.js";

export function PublicationWorkspace({ projectId, playerStorage }: {
  projectId: string;
  playerStorage?: NativePlayerStorage;
}) {
  const [storage] = useState<NativePlayerStorage>(() => playerStorage ?? new IndexedDbNativePlayerStorage());
  const [readiness, setReadiness] = useState<PublicationReadiness | null>(null);
  const [builds, setBuilds] = useState<NativeBuildSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = async () => {
    const [nextReadiness, nextBuilds] = await Promise.all([
      loadPublicationReadiness(projectId),
      listNativeBuilds(projectId),
    ]);
    setReadiness(nextReadiness);
    setBuilds(nextBuilds.items);
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

    {message && <p className={message.includes("runtime-loaded") ? "status good" : "error"} role="status">{message}</p>}
    <p className={readiness.ready ? "status good" : "warning"}>
      {readiness.ready ? "Ready to compile exact accepted prose." : `${readiness.blockers.length} publication blocker${readiness.blockers.length === 1 ? "" : "s"}.`}
    </p>

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
