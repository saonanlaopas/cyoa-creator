import { useEffect, useState } from "react";
import { loadProjectHealth, loadProjectUsage, type ProjectHealth, type ProjectUsageFilters, type ProjectUsageReport } from "../../api/project-health.js";

export function ProjectHealthWorkspace({ projectId, onNavigate }: {
  projectId: string;
  onNavigate: (stage: "passage-plan" | "simulation" | "repair" | "publication" | "recovery") => void;
}) {
  const [health, setHealth] = useState<ProjectHealth | null>(null);
  const [usage, setUsage] = useState<ProjectUsageReport | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [filters, setFilters] = useState<ProjectUsageFilters>({});
  const refresh = async () => {
    const [nextHealth, nextUsage] = await Promise.all([loadProjectHealth(projectId), loadProjectUsage(projectId, filters)]);
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
          <div><dt>Passage plan</dt><dd>{planningValidationText(health.validation)}</dd></div>
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
        <form className="usage-filters" aria-label="Filter recorded AI usage" onSubmit={(event) => {
          event.preventDefault(); void refresh().catch((error: Error) => setMessage(error.message));
        }}>
          <label>Workflow<select value={filters.workflow ?? ""} onChange={(event) => setFilters((current) => ({ ...current, workflow: event.target.value || undefined }))}>
            <option value="">All workflows</option>{usage.available.workflows.map((value) => <option key={value}>{value}</option>)}
          </select></label>
          <label>Provider<select value={filters.providerId ?? ""} onChange={(event) => setFilters((current) => ({ ...current, providerId: event.target.value || undefined }))}>
            <option value="">All providers</option>{usage.available.providers.map((value) => <option key={value}>{value}</option>)}
          </select></label>
          <label>Model<select value={filters.modelId ?? ""} onChange={(event) => setFilters((current) => ({ ...current, modelId: event.target.value || undefined }))}>
            <option value="">All models</option>{usage.available.models.map((value) => <option key={value}>{value}</option>)}
          </select></label>
          <label>From<input type="date" value={filters.from?.slice(0, 10) ?? ""} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value || undefined }))} /></label>
          <label>To<input type="date" value={filters.to?.slice(0, 10) ?? ""} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value ? `${event.target.value}T23:59:59.999Z` : undefined }))} /></label>
          <button>Apply filters</button>
          <button type="button" onClick={() => {
            setFilters({}); void Promise.all([loadProjectHealth(projectId), loadProjectUsage(projectId)])
              .then(([nextHealth, nextUsage]) => { setHealth(nextHealth); setUsage(nextUsage); })
              .catch((error: Error) => setMessage(error.message));
          }}>Clear</button>
        </form>
        <p className="field-note">Filters use recorded metadata only. Prompts, provider responses, credentials, and reasoning text are never shown.</p>
        <p>{usage.totals.attemptCount.toLocaleString()} recorded attempt(s) · {providerRequestText(usage.totals)} · {usage.totals.inputTokens.toLocaleString()} input tokens · {usage.totals.outputTokens.toLocaleString()} output tokens · {costText(usage.totals.cost)}. Costs are never estimated or repriced.</p>
        {usage.groups.length > 0 && <div className="compact-table" role="table" aria-label="Recorded AI usage by workflow"><div role="row"><strong role="columnheader">Workflow</strong><strong role="columnheader">Tokens</strong><strong role="columnheader">Cost</strong></div>{usage.groups.map((group) => <div role="row" key={`${group.workflow}-${group.providerId}-${group.modelId}`}><span role="cell">{group.workflow} · {group.providerId ?? "historical"} / {group.modelId ?? "unknown model"}</span><span role="cell">{group.totalTokens.toLocaleString()} ({group.attemptCount} attempt(s); {providerRequestText(group)})</span><span role="cell">{costText(group.cost)}</span></div>)}</div>}
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
function providerRequestText(usage: { providerRequestCount: number | null; providerRequestCountStatus: "known" | "partial" | "unknown" }): string {
  if (usage.providerRequestCountStatus === "unknown") return "provider request count unknown";
  const count = usage.providerRequestCount?.toLocaleString() ?? "0";
  return usage.providerRequestCountStatus === "partial"
    ? `${count}+ known provider request(s); some attempt request counts unknown`
    : `${count} provider request(s)`;
}
function planningValidationText(validation: ProjectHealth["validation"]): string {
  const status = validation.passagePlanStatus ?? "Not started";
  if (validation.freshness === "not-evaluated") return `${status} · validation not evaluated`;
  if (validation.freshness === "invalid") return `${status} · validation metadata invalid`;
  const counts = `${validation.blockers ?? 0} blocker(s), ${validation.warnings ?? 0} warning(s)`;
  return validation.freshness === "current" ? `${status} · ${counts}` : `${status} · historical approved validation · ${counts}`;
}
function storageText(health: ProjectHealth): string {
  if (health.storage.database.status === "available") return `${health.storage.database.sqliteBytes?.toLocaleString() ?? "Unknown"} SQLite bytes${health.storage.database.walBytes ? ` + ${health.storage.database.walBytes.toLocaleString()} WAL bytes` : ""}.`;
  return health.storage.database.status === "in-memory" ? "In-memory database; on-disk size is not available." : "Database file size is not available.";
}
function formatTime(value: string): string { return new Date(value).toLocaleString(); }
