import { useEffect, useState } from "react";
import { loadProjectHealth, loadProjectUsage, type ProjectHealth, type ProjectUsageReport } from "../../api/project-health.js";

export function ProjectHealthWorkspace({ projectId, onNavigate }: {
  projectId: string;
  onNavigate: (stage: "passage-plan" | "simulation" | "repair" | "publication" | "recovery") => void;
}) {
  const [health, setHealth] = useState<ProjectHealth | null>(null);
  const [usage, setUsage] = useState<ProjectUsageReport | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const refresh = async () => {
    const [nextHealth, nextUsage] = await Promise.all([loadProjectHealth(projectId), loadProjectUsage(projectId)]);
    setHealth(nextHealth); setUsage(nextUsage);
  };
  useEffect(() => {
    setHealth(null); setUsage(null); setMessage(null);
    void refresh().catch((error: Error) => setMessage(error.message));
  }, [projectId]);

  return <section className="project-health-workspace" aria-label="Project health">
    <header className="artifact-header">
      <div><p className="eyebrow">Foundation 8B operations</p><h1>Project health</h1>
        <p>Compact, read-only diagnostics for scale, evidence, storage, and recorded usage. Heavy prose and histories remain in their own review screens.</p></div>
      <button onClick={() => void refresh().catch((error: Error) => setMessage(error.message))}>Refresh health</button>
    </header>
    {message && <p className="error" role="status">{message}</p>}
    {!health || !usage ? <p>Loading project health…</p> : <>
      <section className="brief-section"><h2>Planning and draft health</h2>
        <dl className="simulation-metadata">
          <div><dt>Passage plan</dt><dd>{health.validation.passagePlanStatus ?? "Not started"} · {health.validation.blockers} blocker(s), {health.validation.warnings} warning(s)</dd></div>
          <div><dt>Passages / choices / threads</dt><dd>{health.scale.passages.toLocaleString()} / {health.scale.choices.toLocaleString()} / {health.scale.threads.toLocaleString()}</dd></div>
          <div><dt>Accepted prose</dt><dd>{health.scale.acceptedDrafts.toLocaleString()} accepted · {health.scale.acceptedWords.toLocaleString()} words · {health.scale.staleAcceptedDrafts.toLocaleString()} stale</dd></div>
          <div><dt>Draft history</dt><dd>{health.scale.draftVersions.toLocaleString()} immutable versions · {health.scale.staleCurrentDrafts.toLocaleString()} current stale</dd></div>
        </dl>
        <div className="artifact-actions"><button onClick={() => onNavigate("passage-plan")}>Open passage plan & drafts</button><button onClick={() => onNavigate("simulation")}>Open playtest analysis</button></div>
      </section>
      <section className="brief-section"><h2>Evidence, repair, publication, recovery</h2>
        <dl className="simulation-metadata">
          <div><dt>Latest evidence</dt><dd>{health.evidence.latest.length ? health.evidence.latest.map((item) => `${item.kind} · ${formatTime(item.createdAt)}`).join("; ") : "None recorded"}</dd></div>
          <div><dt>Repair history</dt><dd>{health.repair.latest.length ? `${health.repair.latest.length} latest record(s)` : "None recorded"} · {health.scale.repairApplications.toLocaleString()} application(s)</dd></div>
          <div><dt>Publication</dt><dd>{health.publication.nativeBuildCount.toLocaleString()} native build(s). Current readiness is not evaluated here.</dd></div>
          <div><dt>Recovery</dt><dd>{health.recovery.latestVerifiedBackupAt ? `Verified backup ${formatTime(health.recovery.latestVerifiedBackupAt)}` : "No verified backup recorded"}. Current freshness is not evaluated here.</dd></div>
        </dl>
        <div className="artifact-actions"><button onClick={() => onNavigate("repair")}>Open repair planning</button><button onClick={() => onNavigate("publication")}>Open publication</button><button onClick={() => onNavigate("recovery")}>Open backup & recovery</button></div>
      </section>
      <section className="brief-section"><h2>Storage diagnostics</h2>
        <p>{storageText(health)} The app never deletes history automatically.</p>
        <dl className="simulation-metadata"><div><dt>Immutable records</dt><dd>{Object.values(health.storage.immutableHistory).reduce((total, count) => total + count, 0).toLocaleString()}</dd></div><div><dt>Artifact versions</dt><dd>{health.storage.immutableHistory.artifactVersions.toLocaleString()}</dd></div><div><dt>Passage versions</dt><dd>{health.storage.immutableHistory.passageEntityVersions.toLocaleString()}</dd></div></dl>
      </section>
      <section className="brief-section"><h2>Recorded AI usage</h2>
        <p>{usage.totals.requestCount.toLocaleString()} recorded attempt(s) · {usage.totals.inputTokens.toLocaleString()} input tokens · {usage.totals.outputTokens.toLocaleString()} output tokens · {costText(usage.totals.cost)}. Costs are never estimated or repriced.</p>
        {usage.groups.length > 0 && <div className="compact-table" role="table" aria-label="Recorded AI usage by workflow"><div role="row"><strong role="columnheader">Workflow</strong><strong role="columnheader">Tokens</strong><strong role="columnheader">Cost</strong></div>{usage.groups.map((group) => <div role="row" key={`${group.workflow}-${group.providerId}-${group.modelId}`}><span role="cell">{group.workflow} · {group.providerId ?? "historical"} / {group.modelId ?? "unknown model"}</span><span role="cell">{group.totalTokens.toLocaleString()} ({group.requestCount} attempt(s))</span><span role="cell">{costText(group.cost)}</span></div>)}</div>}
        {usage.groupsTruncated && <p>Only the first {health.budgets.maximumUsageGroups} usage groups are displayed.</p>}
      </section>
    </>}
  </section>;
}

function costText(cost: { status: "recorded" | "partial" | "unknown"; recorded: number | null }): string {
  if (cost.status === "unknown") return "Cost unknown";
  const recorded = cost.recorded === null ? "" : `$${cost.recorded.toFixed(4)}`;
  return cost.status === "partial" ? `${recorded} recorded; some historical costs unknown` : `${recorded} recorded`;
}
function storageText(health: ProjectHealth): string {
  if (health.storage.database.status === "available") return `${health.storage.database.sqliteBytes?.toLocaleString() ?? "Unknown"} SQLite bytes${health.storage.database.walBytes ? ` + ${health.storage.database.walBytes.toLocaleString()} WAL bytes` : ""}.`;
  return health.storage.database.status === "in-memory" ? "In-memory database; on-disk size is not available." : "Database file size is not available.";
}
function formatTime(value: string): string { return new Date(value).toLocaleString(); }
