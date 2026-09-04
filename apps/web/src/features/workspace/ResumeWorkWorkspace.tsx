import { useEffect, useRef, useState } from "react";
import { loadProjectResume, type ProjectResumeReport } from "../../api/project-health.js";

export function ResumeWorkWorkspace({ projectId, localHint, onNavigate }: {
  projectId: string;
  localHint: { stage: string; entityId: string | null } | null;
  onNavigate: (stage: "passage-plan" | "repair" | "publication" | "recovery" | "health", stableId?: string | null) => void;
}) {
  const [report, setReport] = useState<ProjectResumeReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const refresh = async () => { setError(null); setReport(await loadProjectResume(projectId)); };
  useEffect(() => { setReport(null); void refresh().catch((reason: Error) => setError(reason.message)); }, [projectId]);
  useEffect(() => { if (report) headingRef.current?.focus(); }, [report?.generatedAt]);
  return <section className="resume-workspace" aria-labelledby="resume-heading">
    <header className="artifact-header"><div><p className="eyebrow">Foundation 8C operations</p>
      <h1 id="resume-heading" ref={headingRef} tabIndex={-1}>Resume work</h1>
      <p>Bounded, read-only guidance from persisted facts. Opening this view changes no project data and calls no provider.</p></div>
      <button onClick={() => void refresh().catch((reason: Error) => setError(reason.message))}>Refresh</button>
    </header>
    {localHint && <aside className="local-hint" aria-label="Browser-local navigation hint">
      <strong>On this browser</strong>
      <p>Last workspace: {localHint.stage}{localHint.entityId ? ` · ${localHint.entityId}` : ""}. This is a non-canonical navigation hint, not project progress.</p>
    </aside>}
    {error && <div className="recovery-message error" role="alert"><strong>Resume view could not load.</strong>
      <p>{error}</p><p>No project data changed. Retrying is safe.</p><button onClick={() => void refresh().catch((reason: Error) => setError(reason.message))}>Retry</button></div>}
    {!report && !error ? <p role="status">Loading persisted work state…</p> : report && <>
      <dl className="simulation-metadata">
        <div><dt>Authority</dt><dd>Persisted facts only</dd></div>
        <div><dt>Verified backup</dt><dd>{report.backup.latestVerifiedAt ? new Date(report.backup.latestVerifiedAt).toLocaleString() : "None recorded"} · current freshness not evaluated</dd></div>
        <div><dt>Generated</dt><dd>{new Date(report.generatedAt).toLocaleString()}</dd></div>
      </dl>
      <section className="brief-section" aria-labelledby="resume-actions-heading"><h2 id="resume-actions-heading">Suggested next inspections</h2>
        {report.actions.length === 0 ? <p>No interrupted, stale, pending, or unverified work was found in the bounded checks.</p>
          : <ul className="resume-actions">{report.actions.map((action) => <li key={action.id}>
            <button onClick={() => onNavigate(action.stage, action.stableId)}><span>{action.label}</span><small>{action.count.toLocaleString()} item(s){action.stableId ? ` · ${action.stableId}` : ""}</small></button>
          </li>)}</ul>}
      </section>
    </>}
  </section>;
}
