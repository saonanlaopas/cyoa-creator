import { useEffect, useState } from "react";
import {
  compareArtifactVersions,
  listArtifactVersions,
  restoreArtifactVersion,
  type ArtifactVersion,
} from "../../api/long-form.js";

export function ArtifactHistory(props: {
  projectId: string;
  artifactId: string;
  currentVersionId: string;
  onChanged(): Promise<void>;
}) {
  const [versions, setVersions] = useState<ArtifactVersion<unknown>[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState(props.currentVersionId);
  const [comparison, setComparison] = useState<{ from: ArtifactVersion<unknown>; to: ArtifactVersion<unknown>; equal: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const items = await listArtifactVersions(props.projectId, props.artifactId);
    setVersions(items);
    setTo(props.currentVersionId);
    setFrom((value) => value || items.find((item) => item.id !== props.currentVersionId)?.id || props.currentVersionId);
  };

  useEffect(() => {
    void refresh().catch((reason: Error) => setError(reason.message));
  }, [props.projectId, props.artifactId, props.currentVersionId]);

  return <details className="artifact-history">
    <summary>Version history ({versions.length})</summary>
    {error && <p className="error">{error}</p>}
    <div className="history-controls">
      <label>From<select value={from} onChange={(event) => setFrom(event.target.value)}>
        {versions.map((version) => <option value={version.id} key={version.id}>v{version.version}{version.stale ? " (stale)" : ""}</option>)}
      </select></label>
      <label>To<select value={to} onChange={(event) => setTo(event.target.value)}>
        {versions.map((version) => <option value={version.id} key={version.id}>v{version.version}{version.id === props.currentVersionId ? " (current)" : ""}</option>)}
      </select></label>
      <button type="button" disabled={busy || !from || !to} onClick={async () => {
        setBusy(true); setError(null);
        try { setComparison(await compareArtifactVersions(props.projectId, props.artifactId, from, to)); }
        catch (reason) { setError((reason as Error).message); }
        finally { setBusy(false); }
      }}>Compare</button>
      <button type="button" disabled={busy || !from || from === props.currentVersionId} onClick={async () => {
        setBusy(true); setError(null);
        try {
          await restoreArtifactVersion(props.projectId, props.artifactId, from);
          setComparison(null);
          await props.onChanged();
        } catch (reason) { setError((reason as Error).message); }
        finally { setBusy(false); }
      }}>Restore “From” as new draft</button>
    </div>
    {comparison && <div className="history-comparison">
      <p>{comparison.equal ? "These versions are identical." : `Comparing v${comparison.from.version} with v${comparison.to.version}.`}</p>
      {!comparison.equal && <div className="history-json">
        <pre>{JSON.stringify(comparison.from.content, null, 2)}</pre>
        <pre>{JSON.stringify(comparison.to.content, null, 2)}</pre>
      </div>}
    </div>}
  </details>;
}
