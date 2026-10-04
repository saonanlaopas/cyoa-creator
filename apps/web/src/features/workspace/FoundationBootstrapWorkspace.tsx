import { useEffect, useMemo, useState } from "react";
import { FoundationBootstrapApi, type BootstrapApplyPreview, type BootstrapJob, type BootstrapPlan, type BootstrapReview, type BootstrapState, type FoundationArtifactId } from "../../api/foundation-bootstrap.js";
import "./foundation-bootstrap.css";

const labels: Record<FoundationArtifactId, string> = { brief: "Project brief", "creative-direction": "Creative Direction", bible: "Story bible", routes: "Routes", endings: "Detailed endings", mechanics: "Mechanics" };
const display = (value: unknown) => value === null || value === undefined ? "(none)" : typeof value === "string" ? value : JSON.stringify(value, null, 2);

export function FoundationBootstrapWorkspace({ projectId, onApplied }: { projectId: string; onApplied?: () => Promise<void> }) {
  const api = useMemo(() => new FoundationBootstrapApi(projectId), [projectId]);
  const [state, setState] = useState<BootstrapState | null>(null), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false), [decision, setDecision] = useState(""), [providerId, setProviderId] = useState(""), [modelId, setModelId] = useState("");
  const [plan, setPlan] = useState<BootstrapPlan | null>(null), [authorized, setAuthorized] = useState(false), [job, setJob] = useState<BootstrapJob | null>(null);
  const [review, setReview] = useState<BootstrapReview | null>(null), [selected, setSelected] = useState<FoundationArtifactId[]>([]), [detail, setDetail] = useState<FoundationArtifactId | null>(null);
  const [applyPreview, setApplyPreview] = useState<BootstrapApplyPreview | null>(null);
  const refresh = async () => { const next = await api.state(); setState(next); return next; };
  const act = async (action: () => Promise<void>) => { setBusy(true); setError(""); setMessage(""); try { await action(); } catch (e) { setError((e as Error).message); setAuthorized(false); setApplyPreview(null); } finally { setBusy(false); } };
  useEffect(() => {
    let live = true;
    void api.state().then((next) => { if (!live) return; setState(next); const provider = next.providers[0]; setProviderId(provider?.id ?? ""); setModelId(provider?.models[0] ?? ""); }).catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [api]);
  useEffect(() => {
    if (!job || !["running", "authorized", "pending"].includes(job.status)) return;
    let live = true;
    const timer = setTimeout(() => { void api.job(job.id).then((next) => { if (live) setJob(next); }).catch((e: Error) => { if (live) setError(e.message); }); }, 500);
    return () => { live = false; clearTimeout(timer); };
  }, [api, job]);
  const resetPreview = () => { setPlan(null); setAuthorized(false); };
  const openJob = async (id: string) => { setJob(await api.job(id)); setReview(null); setDetail(null); setSelected([]); setApplyPreview(null); };
  const openReview = async () => { if (!job) return; setReview(await api.review(job.id)); setDetail(null); setSelected([]); setApplyPreview(null); };
  const candidate = review?.candidates.find((item) => item.artifactId === detail);
  const appliedIds = new Set(review?.applications.flatMap((application) => Object.keys(application.artifactVersionIds)) ?? []);
  const blocked = busy || review?.currentState.status !== "fresh" || Boolean(review?.validation.errors.length);
  return <section className="artifact-pane bootstrap-workspace" aria-label="Foundation bootstrap">
    <header className="artifact-header"><div><h1>Foundation bootstrap</h1><p>Draft foundations / ordinary approval required</p></div><span className="workflow-status">{job?.status ?? "Not started"}</span></header>
    {error && <p role="alert" className="error">{error}</p>}{message && <p role="status">{message}</p>}
    {!state ? <p role="status">Loading foundations</p> : <>
      {!state.availability.allowed && <p className="status">{state.availability.reason}</p>}
      <section className="brief-section"><h2>Generation decision</h2>
        <label>Foundation request<textarea disabled={busy} maxLength={6000} value={decision} onChange={(e) => { setDecision(e.target.value); resetPreview(); }} /></label>
        <div className="bootstrap-provider"><label>Foundation provider<select disabled={busy} value={providerId} onChange={(e) => { const provider = state.providers.find((item) => item.id === e.target.value); setProviderId(e.target.value); setModelId(provider?.models[0] ?? ""); resetPreview(); }}>{state.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select></label>
          <label>Foundation model<select disabled={busy} value={modelId} onChange={(e) => { setModelId(e.target.value); resetPreview(); }}>{state.providers.find((provider) => provider.id === providerId)?.models.map((model) => <option key={model}>{model}</option>)}</select></label></div>
        <button disabled={busy || !state.availability.allowed || !decision.trim() || !providerId || !modelId} onClick={() => void act(async () => { setAuthorized(false); setPlan(await api.preview({ message: decision, providerId, modelId })); await refresh(); })}>Preview foundation generation</button>
      </section>
      {plan && <section className="brief-section" aria-label="Foundation generation preview"><h2>Exact generation preview</h2>
        <p>{plan.context.request}</p>
        <dl className="simulation-metadata"><div><dt>Provider / model</dt><dd>{plan.providerId} / {plan.modelId}</dd></div><div><dt>Estimated input tokens</dt><dd>{plan.estimatedInputTokens}</dd></div><div><dt>Context bytes</dt><dd>{plan.contextBytes}</dd></div><div><dt>Estimated cost</dt><dd>{plan.cost === 0 ? "$0.00 (offline)" : plan.cost === null ? "Unavailable" : `$${plan.cost.toFixed(4)}`}</dd></div></dl>
        <details><summary>Exact input versions and preconditions</summary><p>Dossier: {plan.context.dossierVersionId}</p><p>Adaptation Intent: {plan.context.intentVersionId}</p>{Object.entries(plan.context.baseVersionIds).map(([id, version]) => <p key={id}>{labels[id as FoundationArtifactId] ?? id}: {version ?? "must-not-exist"}</p>)}<p>Context: {plan.contextFingerprint}</p><p>Plan: {plan.fingerprint}</p></details>
        <p>{plan.units.length} bounded unit(s) / {plan.units.flatMap((unit) => unit.artifactIds).length} foundation candidates</p>
        <label className="bootstrap-check"><input type="checkbox" checked={authorized} disabled={busy} onChange={(e) => setAuthorized(e.target.checked)} />Authorize this exact foundation generation</label>
        <button disabled={busy || !authorized} onClick={() => void act(async () => { const started = await api.start(plan); setAuthorized(false); setJob(started); setReview(null); setApplyPreview(null); await refresh(); })}>Start foundation generation</button>
      </section>}
      {job && <section className="brief-section" aria-label="Foundation generation progress"><h2>Generation progress</h2><p>{job.id} / {job.status}</p>
        {job.units.map((unit) => <details key={unit.id} open><summary>{unit.artifactIds.map((id) => labels[id]).join(", ")} / {unit.status}</summary>{unit.attempts.map((attempt) => <p key={attempt.id}>Attempt {attempt.number}: {attempt.status}{attempt.diagnostic ? ` / ${attempt.diagnostic}` : ""}</p>)}</details>)}
        <div className="artifact-actions"><button disabled={busy} onClick={() => void act(async () => { setJob(await api.job(job.id)); await refresh(); })}>Refresh job</button>
          {["running", "authorized", "pending"].includes(job.status) && <button disabled={busy} onClick={() => void act(async () => { setJob(await api.cancel(job.id)); await refresh(); })}>Cancel generation</button>}
          {["failed", "partially-failed", "interrupted"].includes(job.status) && <button disabled={busy} onClick={() => void act(async () => { setJob(await api.retry(job.id)); await refresh(); })}>Retry failed generation</button>}
          {job.status === "completed" && <button disabled={busy} onClick={() => void act(openReview)}>Review foundation bundle</button>}</div>
      </section>}
      {review && <section className="brief-section" aria-label="Foundation bundle review"><header><h2>Foundation overview</h2><p>{review.currentState.status} / {review.candidates.length} candidates / {review.applications.length} applications</p></header>
        {review.currentState.reasons.map((reason) => <p className="error" key={reason}>{reason}</p>)}
        <h3>Validation</h3>{review.validation.errors.length === 0 ? <p>No blocking validation errors</p> : review.validation.errors.map((item) => <p className="error" key={item}>{item}</p>)}{review.validation.warnings.map((item) => <p key={item}>{item}</p>)}
        <h3>Dependency groups</h3>{review.groups.map((group) => <section className="bootstrap-group" key={group.id} aria-label={group.label}><h4>{group.label}</h4><small>Requires: {group.dependsOnGroupIds.join(", ") || "None"}</small>
          {group.artifactIds.map((id) => <div className="bootstrap-artifact" key={id}><label className="bootstrap-check"><input type="checkbox" checked={selected.includes(id)} disabled={blocked || appliedIds.has(id)} onChange={(e) => { setSelected((current) => e.target.checked ? [...current, id] : current.filter((value) => value !== id)); setApplyPreview(null); }} />{labels[id]}{appliedIds.has(id) ? " (applied draft)" : ""}</label><button disabled={busy} onClick={() => setDetail(id)}>Review {labels[id]}</button></div>)}
        </section>)}
        {candidate && <section className="bootstrap-detail" aria-label="Foundation artifact detail"><h3>{labels[candidate.artifactId]}</h3><p>Base: {candidate.baseVersionId ?? "must-not-exist"}</p>
          <h4>Field changes</h4>{candidate.fieldDiffs.map((diff) => <details key={diff.path}><summary>{diff.path}</summary><div className="bootstrap-diff"><div><strong>Before</strong><pre>{display(diff.before)}</pre></div><div><strong>Proposed draft</strong><pre>{display(diff.after)}</pre></div></div></details>)}
          <details><summary>Source / override / adaptation-only provenance</summary>{candidate.provenance.map((item, index) => <details key={`${item.fieldPath}-${index}`}><summary>{item.fieldPath} / {item.origin}</summary><p>{item.rationale}</p><dl className="simulation-metadata"><div><dt>Source records</dt><dd>{item.sourceRecordIds.join(", ") || "None"}</dd></div><div><dt>A3 corrections</dt><dd>{item.correctionIds.join(", ") || "None"}</dd></div><div><dt>A4 overrides</dt><dd>{item.overrideIds.join(", ") || "None"}</dd></div><div><dt>Adaptation-only inventions</dt><dd>{item.inventionIds.join(", ") || "None"}</dd></div></dl></details>)}</details>
          <details><summary>Complete candidate</summary><pre>{display(candidate.content)}</pre></details>
        </section>}
        <details><summary>Requested canon obligation assessment</summary><p>Passage-level preservation pending graph validation</p>{review.canonAssessment.map((item) => <details key={item.obligationId}><summary>{item.obligationId} / {item.status}</summary><p>{item.rationale}</p><dl className="simulation-metadata"><div><dt>Routes</dt><dd>{item.routeIds.join(", ") || "None"}</dd></div><div><dt>Acts</dt><dd>{item.actIds.join(", ") || "None"}</dd></div><div><dt>Endings</dt><dd>{item.endingIds.join(", ") || "None"}</dd></div></dl>{item.structuralEvidence.map((evidence) => <p key={`${evidence.artifactId}:${evidence.fieldPath}`}>{labels[evidence.artifactId]}: <code>{evidence.fieldPath}</code></p>)}</details>)}</details>
        <button disabled={blocked || selected.length === 0} onClick={() => void act(async () => setApplyPreview(await api.previewApply(review.jobId, selected)))}>Preview selected drafts</button>
        {applyPreview && <section aria-label="Foundation application preview"><h3>Application preview</h3><p>Selected drafts: {applyPreview.effectiveArtifactIds.map((id) => labels[id]).join(", ")}</p><p>Required dependencies: {applyPreview.requiredDependencies.map((id) => labels[id]).join(", ") || "None"}</p><h4>Staleness impact</h4>{applyPreview.wouldStale.length ? applyPreview.wouldStale.map((id) => <p key={id}>{id}</p>) : <p>No downstream artifacts affected</p>}<p>Approval: none / passage plan: none / prose: none</p>
          <button className="primary" disabled={blocked} onClick={() => void act(async () => { await api.apply(review.jobId, applyPreview.effectiveArtifactIds, applyPreview.previewFingerprint); setApplyPreview(null); setSelected([]); setReview(await api.review(review.jobId)); await refresh(); await onApplied?.(); setMessage("Foundation drafts applied. Ordinary approval required; no passage plan or prose generated."); })}>Apply reviewed drafts</button>
        </section>}
        {review.applications.map((application) => <details key={application.id}><summary>Applied draft versions / {application.createdAt}</summary>{Object.entries(application.artifactVersionIds).map(([id, version]) => <p key={id}>{labels[id as FoundationArtifactId] ?? id}: {version}</p>)}</details>)}
      </section>}
      <section className="brief-section" aria-label="Saved foundation jobs"><h2>Saved jobs</h2>{state.jobs.length === 0 ? <p>No foundation jobs</p> : state.jobs.map((saved) => <button disabled={busy} key={saved.id} onClick={() => void act(() => openJob(saved.id))}>{saved.status} / {saved.id}</button>)}</section>
      {state.plans.length > 0 && <details><summary>Saved generation previews</summary>{state.plans.map((saved) => <button disabled={busy} key={saved.id} onClick={() => { setPlan(saved); setAuthorized(false); setError(""); }}>Open preview {saved.id}</button>)}</details>}
    </>}
  </section>;
}
