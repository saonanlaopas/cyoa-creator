import { useEffect, useMemo, useState } from "react";
import {
  authorizeNarrativeReview, cancelNarrativeReview, createNarrativeReview, listNarrativeReviews,
  loadNarrativeReview, previewNarrativeReview, retryNarrativeReviewUnit, startNarrativeReview,
  type NarrativeReviewAggregate, type NarrativeReviewPreview,
} from "../../api/narrative-review.js";
import { listPlaytestCampaigns, type PlaytestCampaignSummary } from "../../api/playtesting.js";
import type { SimulationInputSummary } from "../../api/simulation.js";

interface Props { projectId: string; inputs: SimulationInputSummary[]; defaultInputId: string; onNavigateStableId?(stableId: string): void }

export function NarrativeReviewWorkspace({ projectId, inputs, defaultInputId, onNavigateStableId }: Props) {
  const [campaigns, setCampaigns] = useState<PlaytestCampaignSummary[]>([]);
  const [history, setHistory] = useState<NarrativeReviewAggregate[]>([]);
  const [inputId, setInputId] = useState(defaultInputId);
  const [scope, setScope] = useState(""); const [campaignId, setCampaignId] = useState("");
  const [preview, setPreview] = useState<NarrativeReviewPreview | null>(null);
  const [review, setReview] = useState<NarrativeReviewAggregate | null>(null);
  const [category, setCategory] = useState("all"); const [severity, setSeverity] = useState("all");
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState<string | null>(null);

  const refresh = async () => {
    const [campaignResponse, reviewResponse] = await Promise.all([listPlaytestCampaigns(projectId), listNarrativeReviews(projectId)]);
    setCampaigns(campaignResponse.items); setHistory(reviewResponse.items);
  };
  useEffect(() => { setReview(null); setPreview(null); setMessage(null); void refresh().catch((error: Error) => setMessage(error.message)); }, [projectId]);
  useEffect(() => { if (!inputId && defaultInputId) setInputId(defaultInputId); }, [defaultInputId]);
  useEffect(() => {
    if (!review || review.job.status !== "running") return;
    const timer = window.setInterval(() => void loadNarrativeReview(projectId, review.plan.id).then((latest) => {
      setReview(latest); if (latest.job.status !== "running") void refresh();
    }).catch((error: Error) => setMessage(error.message)), 250);
    return () => window.clearInterval(timer);
  }, [projectId, review?.plan.id, review?.job.status]);

  const request = () => ({
    simulationInputVersionId: inputId,
    scopePassageIds: scope.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean),
    campaignVersionIds: campaignId ? [campaignId] : [],
    providerId: "offline-narrative-review", modelId: "deterministic-review-v1",
  });
  const act = async (operation: () => Promise<void>) => { setBusy(true); setMessage(null); try { await operation(); } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); } };
  const doPreview = () => act(async () => { setPreview(await previewNarrativeReview(projectId, request())); setReview(null); setMessage("Bounded review plan previewed. No provider was called."); });
  const save = () => act(async () => { const created = await createNarrativeReview(projectId, request()); setReview(created); setPreview(null); await refresh(); setMessage("Exact review plan saved. No provider was called."); });
  const authorize = () => review && act(async () => { setReview(await authorizeNarrativeReview(projectId, review.plan.id, review.plan.fingerprint)); setMessage("Exact review fingerprint authorized."); });
  const start = () => review && act(async () => { setReview(await startNarrativeReview(projectId, review.plan.id)); setMessage("Bounded offline narrative review started."); });
  const cancel = () => review && act(async () => { setReview(await cancelNarrativeReview(projectId, review.plan.id)); setMessage("Narrative review cancelled."); });
  const reopen = (planId: string) => act(async () => { setReview(await loadNarrativeReview(projectId, planId)); setPreview(null); setMessage("Historical immutable review reopened."); });
  const retry = (unitId: string) => review && act(async () => { setReview(await retryNarrativeReviewUnit(projectId, review.plan.id, unitId)); setMessage("Failed unit returned to pending for explicit Start."); });

  const units = review?.job.units ?? preview?.plan.units ?? [];
  const findings = useMemo(() => (review?.job.units.flatMap((unit) => unit.findings) ?? []).filter((finding) =>
    (category === "all" || finding.category === category) && (severity === "all" || finding.severity === severity)), [review, category, severity]);
  return <section className="playtest-workspace" aria-label="Narrative Review workspace">
    <header className="playtest-header"><div><p className="eyebrow">Foundation 5C</p><h2>Narrative Review</h2>
      <p>Review exact accepted prose and bounded simulation evidence. Findings are immutable evidence; this workspace never repairs or changes the story.</p></div></header>
    {message && <p className={/previewed|saved|authorized|started|reopened|pending/.test(message) ? "status good" : "error"} role="status">{message}</p>}
    <section className="brief-section playtest-controls"><h3>Exact review definition</h3>
      <div className="playtest-control-grid">
        <label>Exact simulation input<select aria-label="Narrative review simulation input" value={inputId} onChange={(event) => { setInputId(event.target.value); setPreview(null); }}>
          <option value="">Capture an approved 5A input first</option>{inputs.map((input) => <option key={input.versionId} value={input.versionId}>v{input.version} · {input.passageCount} passages · {input.fingerprint.slice(0, 12)}</option>)}</select></label>
        <label>Relevant 5B campaign<select aria-label="Narrative review campaign" value={campaignId} onChange={(event) => { setCampaignId(event.target.value); setPreview(null); }}>
          <option value="">No campaign</option>{campaigns.filter((item) => item.simulationInputArtifactVersionId === inputId).map((item) => <option key={item.versionId} value={item.versionId}>seed {item.seed} · {item.sampleCount} samples · {item.findingRetentionStatus}</option>)}</select></label>
      </div>
      <label>Stable passage IDs (whitespace or commas)<textarea aria-label="Narrative review passage scope" value={scope} onChange={(event) => { setScope(event.target.value); setPreview(null); }} placeholder="passage-opening passage-first-choice passage-reconvergence" /></label>
      <div className="artifact-actions"><button disabled={busy || !inputId || !scope.trim()} onClick={() => void doPreview()}>Preview bounded plan</button>
        <button disabled={busy || !inputId || !scope.trim()} onClick={() => void save()}>Save exact plan</button></div>
    </section>
    {(preview || review) && <section className="brief-section"><header><div><h3>Bounded units and diagnostics</h3><p>Context metadata only; prose is loaded inside one selected unit request, never rendered as a whole-project dump.</p></div></header>
      <dl className="simulation-metadata"><div><dt>Fingerprint</dt><dd>{review?.plan.fingerprint ?? preview?.plan.fingerprint}</dd></div>
        <div><dt>Input</dt><dd>{review?.reviewInput.fingerprint ?? preview?.reviewInput.fingerprint}</dd></div>
        <div><dt>Units</dt><dd>{units.length}</dd></div><div><dt>Estimated input</dt><dd>{(review?.plan.estimatedInputTokens ?? preview?.plan.estimatedInputTokens ?? 0).toLocaleString()} tokens</dd></div></dl>
      <div className="compact-table" aria-label="Narrative review unit diagnostics">{units.map((unit) => <details key={unit.id}><summary>Unit {unit.position + 1} · {unit.passageIds.length} passages · {unit.status ?? "preview"}</summary>
        <p>{unit.passageIds.map((id) => <button key={id} className="stable-id-link" onClick={() => onNavigateStableId?.(id)}>{id}</button>)}</p>
        <p>{unit.estimatedInputTokens.toLocaleString()} estimated input tokens · {unit.maximumOutputTokens.toLocaleString()} max output tokens</p>
        <p>Context {unit.contextFingerprint}</p>
        {unit.diagnostics.retention.map((item) => <p key={item.campaignVersionId}>{item.status === "legacy-unknown" ? "Legacy schema-v1 campaign · original finding completeness unknown" : item.truncated ? `Schema-v2 retained subset · ${item.omitted} findings omitted` : "Schema-v2 finding retention known complete"}</p>)}
        {unit.status === "failed" && <button disabled={busy} onClick={() => void retry(unit.id)}>Retry failed unit</button>}
      </details>)}</div>
      {review && <div className="artifact-actions"><button disabled={busy || review.plan.status !== "planned"} onClick={() => void authorize()}>Authorize exact fingerprint</button>
        <button className="primary" disabled={busy || review.plan.status !== "authorized" || !["authorized", "partially-failed", "failed"].includes(review.job.status)} onClick={() => void start()}>Start review</button>
        <button disabled={busy || review.job.status !== "running"} onClick={() => void cancel()}>Cancel</button></div>}
      {review?.currentState && <p className={review.currentState.status === "current" ? "status good" : "status"}>Review input is {review.currentState.status}{review.currentState.reason ? ` · ${review.currentState.reason}` : ""}.</p>}
    </section>}
    <section className="brief-section playtest-history"><h3>Historical reviews</h3>{history.length === 0 ? <p>No narrative reviews yet.</p> : <div className="playtest-history-list">{history.map((item) => <button key={item.plan.id} onClick={() => void reopen(item.plan.id)}><span>{item.job.status} · {item.plan.scopePassageIds.length} passages · {item.job.units.flatMap((unit) => unit.findings).length} findings</span><small>{item.plan.fingerprint.slice(0, 16)} · {item.job.createdAt}</small></button>)}</div>}</section>
    {review && <section className="brief-section playtest-findings"><header><div><h3>Validated narrative findings</h3><p>Findings only—no prepared patches, replacement prose, or apply operations.</p></div>
      <div><label>Category<select aria-label="Filter narrative review category" value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All</option>{review.plan.categories.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label>Severity<select aria-label="Filter narrative review severity" value={severity} onChange={(event) => setSeverity(event.target.value)}><option value="all">All</option><option value="error">Error</option><option value="warning">Warning</option><option value="info">Info</option></select></label></div></header>
      <div className="finding-list">{findings.map((finding) => <article key={finding.id} className={`playtest-finding ${finding.severity}`}><header><strong>{finding.category}</strong><span>{finding.severity} · {finding.confidence} confidence</span></header><p>{finding.message}</p><p>{finding.reviewNote}</p>
        <p className="finding-links">{[...finding.passageIds, ...finding.choiceIds, ...finding.routeIds, ...finding.endingIds, ...finding.threadIds, ...finding.mechanicKeys].map((id) => <button key={id} className="stable-id-link" onClick={() => onNavigateStableId?.(id)}>{id}</button>)}</p>
        <details><summary>Exact evidence and provenance</summary><p>{finding.fingerprint}</p><p>unit {finding.unitId} · attempt {finding.attemptId}</p><pre>{JSON.stringify(finding.evidenceReferences, null, 2)}</pre></details></article>)}</div>
    </section>}
  </section>;
}
