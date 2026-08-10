import { useEffect, useMemo, useState } from "react";
import {
  applyDraftAcceptance,
  authorizeDraftingPlan,
  cancelDraftingJob,
  comparePassageDrafts,
  createDraftingPlan,
  loadPassageDraft,
  loadDraftingJob,
  listDraftingPlans,
  previewDraftAcceptance,
  previewDraftingPlan,
  retryDraftingUnit,
  restorePassageDraft,
  saveManualPassageDraft,
  startDraftingJob,
  transitionPassageDraft,
  unlockAcceptedPassageDraft,
  type DraftAcceptancePreview,
  type DraftingJob,
  type DraftingPlan,
  type DraftingPlanPreview,
  type PassageDraftComparison,
  type PassageDraftState,
  type PassageDraftVersion,
} from "../../api/passage-drafts.js";

export function PassageDraftPanel(props: {
  projectId: string;
  passageId: string;
  passagePlanVersionId: string;
  passagePlanApproved: boolean;
  setMessage(value: string | null): void;
  onCorpusChange?(): void;
}) {
  const [state, setState] = useState<PassageDraftState | null>(null);
  const [prose, setProse] = useState("");
  const [authorNote, setAuthorNote] = useState("");
  const [reviewVersionId, setReviewVersionId] = useState<string | null>(null);
  const [comparisonBeforeId, setComparisonBeforeId] = useState<string | null>(null);
  const [comparison, setComparison] = useState<PassageDraftComparison | null>(null);
  const [acceptancePreview, setAcceptancePreview] = useState<DraftAcceptancePreview | null>(null);
  const [plan, setPlan] = useState<DraftingPlanPreview | DraftingPlan | null>(null);
  const [job, setJob] = useState<DraftingJob | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (selectCurrent = false) => {
    const next = await loadPassageDraft(props.projectId, props.passageId);
    setState(next);
    setProse(next.head?.current.proseMarkdown ?? "");
    setAuthorNote(next.head?.current.authorNote ?? "");
    setReviewVersionId((current) => !selectCurrent && next.history.some((version) => version.id === current)
      ? current : next.head?.current.id ?? null);
    return next;
  };
  useEffect(() => {
    setPlan(null);
    setJob(null);
    setAcceptancePreview(null);
    setComparison(null);
    void load().catch((error: Error) => props.setMessage(error.message));
    if (props.passagePlanApproved) void (async () => {
      const plans = await listDraftingPlans(props.projectId);
      const latest = plans.find((item) => item.scope.passageIds.includes(props.passageId));
      if (!latest) return;
      setPlan(latest);
      setJob(await loadDraftingJob(props.projectId, latest.jobId));
    })().catch((error: Error) => props.setMessage(error.message));
  }, [props.projectId, props.passageId, props.passagePlanVersionId, props.passagePlanApproved]);

  const reviewVersion = useMemo(() => state?.history.find((version) => version.id === reviewVersionId)
    ?? state?.head?.current ?? null, [state, reviewVersionId]);
  const accepted = state?.head?.accepted ?? null;
  useEffect(() => {
    if (!reviewVersion) return setComparison(null);
    const beforeId = comparisonBeforeId ?? accepted?.id ?? null;
    void comparePassageDrafts(props.projectId, props.passageId, beforeId, reviewVersion.id)
      .then(setComparison).catch((error: Error) => props.setMessage(error.message));
  }, [props.projectId, props.passageId, reviewVersion?.id, accepted?.id, comparisonBeforeId]);

  if (!state) return <section className="passage-draft-panel"><p>Loading draft metadata…</p></section>;
  const current = state.head?.current ?? null;
  const planPolicy = plan && ("executionPolicy" in plan ? plan.executionPolicy : plan.policy);
  const refresh = async () => {
    const next = await load(true);
    props.onCorpusChange?.();
    return next;
  };
  const refreshJob = async (jobId: string) => {
    for (let index = 0; index < 200; index += 1) {
      const next = await loadDraftingJob(props.projectId, jobId);
      setJob(next);
      if (["completed", "partially_failed", "failed", "cancelled"].includes(next.status)) {
        await refresh();
        return next;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("Drafting job did not finish within the local inspection window");
  };
  const exactSelection = reviewVersion ? [{
    passageId: props.passageId, candidateDraftVersionId: reviewVersion.id,
  }] : [];

  return <section className="passage-draft-panel" aria-label="Passage prose review">
    <header><div><p className="eyebrow">Foundation 4B-3</p><h3>Review prose</h3>
      <p>{state.passagePlan.title} <code>{props.passageId}</code></p></div>
      <div className="draft-status-badges">
        <span>{reviewVersion?.status ?? "no draft"}</span>
        {state.head?.acceptedLocked && <span>accepted locked</span>}
      </div>
    </header>

    <dl className="draft-metadata">
      <div><dt>Specification</dt><dd>{state.passagePlan.wordTarget} words · base {reviewVersion?.basedOnPassagePlanVersionId ?? state.passagePlanVersionId}</dd></div>
      <div><dt>Candidate</dt><dd>{reviewVersion ? `v${reviewVersion.version} · ${reviewVersion.wordCount} words · ${reviewVersion.sourceKind}` : "None"}</dd></div>
      <div><dt>Accepted</dt><dd>{accepted ? `v${accepted.version} · ${accepted.lifecycleStatus} · ${accepted.wordCount} words${accepted.stale ? " · stale" : ""}` : "None"}</dd></div>
      <div><dt>Corpus</dt><dd>{state.summary.acceptedWords.toLocaleString()} accepted · {state.summary.remainingWords.toLocaleString()} remaining · {state.summary.acceptanceCompletionPercentage}%</dd></div>
      <div><dt>Generated</dt><dd>{reviewVersion?.generationProvenance
        ? `${reviewVersion.generationProvenance.providerId}/${reviewVersion.generationProvenance.modelId} · ${new Date(reviewVersion.createdAt).toLocaleString()}`
        : reviewVersion ? `${reviewVersion.sourceKind} · ${new Date(reviewVersion.createdAt).toLocaleString()}` : "Not drafted"}</dd></div>
    </dl>

    {reviewVersion?.stale && <StaleNotice version={reviewVersion} />}
    <div className="prose-review-grid">
      <section aria-label="Candidate prose"><h4>Candidate prose</h4>
        <ProseReader markdown={reviewVersion?.proseMarkdown ?? "No candidate prose yet."} />
      </section>
      <section aria-label="Current accepted prose"><h4>Current accepted prose</h4>
        <ProseReader markdown={accepted?.proseMarkdown ?? "No prose has been accepted."} />
      </section>
    </div>

    {reviewVersion && <section className="draft-comparison" aria-label="Deterministic prose comparison">
      <header><h4>Before / after comparison</h4><label>Compare from
        <select value={comparisonBeforeId ?? accepted?.id ?? ""} onChange={(event) => setComparisonBeforeId(event.target.value || null)}>
          <option value="">Empty prose</option>
          {state.history.filter((version) => version.id !== reviewVersion.id).map((version) =>
            <option key={version.id} value={version.id}>v{version.version} · {version.status} · {version.wordCount} words</option>)}
        </select></label></header>
      {comparison?.paragraphs && <>
        <p>{comparison.wordCountDelta >= 0 ? "+" : ""}{comparison.wordCountDelta} words
          {comparison.baseVersionChanged ? " · passage-plan base changed" : ""}
          {comparison.provenanceChanged ? " · provenance changed" : ""}</p>
        <div className="prose-diff">{comparison.paragraphs.length ? comparison.paragraphs.map((part, index) =>
          part.kind === "removed" ? <del key={index}>{part.text}</del>
            : part.kind === "added" ? <ins key={index}>{part.text}</ins>
              : <p key={index}>{part.text}</p>) : <p>No prose differences.</p>}</div>
      </>}
    </section>}

    {reviewVersion?.lifecycleStatus === "candidate" && <section className="acceptance-review" aria-label="Exact draft acceptance">
      <div className="proposal-actions">
        <button type="button" disabled={busy || reviewVersion.stale} onClick={async () => {
          setBusy(true);
          try {
            setAcceptancePreview(await previewDraftAcceptance(props.projectId, exactSelection));
            props.setMessage("Acceptance impact previewed locally. No provider was called and no prose changed.");
          } catch (error) { props.setMessage((error as Error).message); }
          finally { setBusy(false); }
        }}>Preview exact acceptance</button>
        {acceptancePreview && <button type="button" className="primary" disabled={busy || !acceptancePreview.valid} onClick={async () => {
          setBusy(true);
          try {
            await applyDraftAcceptance(props.projectId, exactSelection, acceptancePreview.fingerprint);
            setAcceptancePreview(null);
            await refresh();
            props.setMessage("Exact candidate accepted as a new immutable lifecycle version.");
          } catch (error) { props.setMessage((error as Error).message); }
          finally { setBusy(false); }
        }}>Accept exact candidate</button>}
      </div>
      {acceptancePreview && <AcceptancePreviewView preview={acceptancePreview} />}
    </section>}

    {accepted && <div className="proposal-actions" aria-label="Accepted prose lifecycle">
      {accepted.lifecycleStatus === "accepted" && <button type="button" disabled={busy || accepted.stale} onClick={async () => {
        setBusy(true); try { await transitionPassageDraft(props.projectId, props.passageId, accepted.id, "reviewed"); await refresh(); }
        catch (error) { props.setMessage((error as Error).message); } finally { setBusy(false); }
      }}>Mark reviewed</button>}
      {accepted.lifecycleStatus === "reviewed" && <button type="button" disabled={busy || accepted.stale} onClick={async () => {
        setBusy(true); try { await transitionPassageDraft(props.projectId, props.passageId, accepted.id, "locked"); await refresh(); }
        catch (error) { props.setMessage((error as Error).message); } finally { setBusy(false); }
      }}>Lock accepted text</button>}
      {state.head?.acceptedLocked && <button type="button" disabled={busy} onClick={async () => {
        setBusy(true); try { await unlockAcceptedPassageDraft(props.projectId, props.passageId); await refresh(); props.setMessage("Accepted text unlocked. No candidate was accepted."); }
        catch (error) { props.setMessage((error as Error).message); } finally { setBusy(false); }
      }}>Unlock accepted text</button>}
    </div>}

    <details><summary>Manual candidate editor</summary>
      <label>Prose Markdown<textarea className="draft-prose" value={prose} onChange={(event) => setProse(event.target.value)} /></label>
      <label>Author note<textarea value={authorNote} onChange={(event) => setAuthorNote(event.target.value)} /></label>
      <button type="button" className="primary" disabled={busy} onClick={async () => {
        setBusy(true);
        try {
          const result = await saveManualPassageDraft(props.projectId, props.passageId, prose, authorNote);
          setState(result.state); setReviewVersionId(result.draft.id); setAcceptancePreview(null); props.onCorpusChange?.();
          props.setMessage("Manual draft saved as a new immutable candidate version. Accepted prose was unchanged.");
        } catch (error) { props.setMessage((error as Error).message); }
        finally { setBusy(false); }
      }}>Save new candidate version</button>
    </details>

    <details className="artifact-history"><summary>Immutable draft history ({state.history.length})</summary>
      {state.history.map((version) => <div className="snapshot-row" key={version.id}>
        <button type="button" onClick={() => { setReviewVersionId(version.id); setAcceptancePreview(null); }}>
          Inspect v{version.version}
        </button>
        <span>{version.status} · {version.sourceKind} · {version.wordCount} words · {new Date(version.createdAt).toLocaleString()}
          {version.restoredFromVersionId ? ` · restored from ${version.restoredFromVersionId}` : ""}</span>
        <button type="button" disabled={busy} onClick={async () => {
          setBusy(true);
          try {
            const result = await restorePassageDraft(props.projectId, props.passageId, version.id);
            setState(result.state); setProse(result.draft.proseMarkdown); setAuthorNote(result.draft.authorNote);
            setReviewVersionId(result.draft.id); setAcceptancePreview(null); props.onCorpusChange?.();
            props.setMessage("Draft restored as a new immutable candidate version. It was not accepted or unlocked.");
          } catch (error) { props.setMessage((error as Error).message); }
          finally { setBusy(false); }
        }}>Restore as candidate</button>
      </div>)}
      {(state.acceptanceHistory ?? []).length > 0 && <details><summary>Acceptance audit ({state.acceptanceHistory.length})</summary>
        {(state.acceptanceHistory ?? []).map((application) => <small key={application.id ?? application.previewFingerprint}>
          {new Date(application.createdAt).toLocaleString()} · batch {application.id} · {application.acceptedWordDelta >= 0 ? "+" : ""}{application.acceptedWordDelta} words
        </small>)}
      </details>}
    </details>

    <details className="drafting-plan-preview"><summary>Regenerate through bounded drafting</summary>
      <p>Preparing or authorizing a plan does not call a provider. Explicit Start creates a separate candidate and never replaces accepted prose.</p>
      {!props.passagePlanApproved && <p className="warning">Approve the current passage-plan snapshot before creating a drafting plan.</p>}
      <div className="proposal-actions">
        <button type="button" disabled={busy || !props.passagePlanApproved} onClick={async () => {
          setBusy(true); try { setPlan(await previewDraftingPlan(props.projectId, [props.passageId])); }
          catch (error) { props.setMessage((error as Error).message); } finally { setBusy(false); }
        }}>Preview regeneration plan</button>
        <button type="button" disabled={busy || !props.passagePlanApproved} onClick={async () => {
          setBusy(true); try { setPlan(await createDraftingPlan(props.projectId, [props.passageId])); props.setMessage("New bounded drafting plan saved. No provider was called."); }
          catch (error) { props.setMessage((error as Error).message); } finally { setBusy(false); }
        }}>Prepare regeneration plan</button>
        {plan && "id" in plan && plan.authorizationState === "planned" && <button type="button" disabled={busy} onClick={async () => {
          setBusy(true); try { setPlan(await authorizeDraftingPlan(props.projectId, plan.id, plan.fingerprint)); props.setMessage("Exact plan authorized. Generation has not started."); }
          catch (error) { props.setMessage((error as Error).message); } finally { setBusy(false); }
        }}>Authorize exact plan</button>}
        {plan && "id" in plan && plan.authorizationState === "authorized" && ["authorized", "partially_failed", "failed"].includes(plan.jobStatus) && <button type="button" className="primary" disabled={busy} onClick={async () => {
          setBusy(true);
          try { setJob(await startDraftingJob(props.projectId, plan.jobId)); const finished = await refreshJob(plan.jobId); props.setMessage(`Drafting job ${finished.status}. Accepted prose was unchanged.`); }
          catch (error) { props.setMessage((error as Error).message); } finally { setBusy(false); }
        }}>Start generation</button>}
        {job && ["authorized", "running"].includes(job.status) && <button type="button" onClick={async () => {
          try { setJob(await cancelDraftingJob(props.projectId, job.id)); props.setMessage("Drafting job cancelled."); }
          catch (error) { props.setMessage((error as Error).message); }
        }}>Cancel</button>}
      </div>
      {plan && planPolicy && <div className="generation-plan-inspection">
        <strong>{plan.units.length} unit · {plan.estimatedInputTokens.toLocaleString()} estimated input tokens · {plan.estimatedOutputTokens.toLocaleString()} output tokens</strong>
        <small>Fingerprint {plan.fingerprint}</small>
        <small>Limits: {planPolicy.maxPassagesPerUnit} passages/unit · {planPolicy.maxAttemptsPerUnit} attempts · {planPolicy.maxSerializedCandidateBytes.toLocaleString()} candidate bytes</small>
        {plan.units.map((unit) => <details key={unit.id}><summary>Unit {unit.position + 1}: {unit.contextDiagnostics.status} context</summary>
          <small>{unit.passageIds.length} passage · {unit.estimatedInputTokens.toLocaleString()} input tokens · {unit.contextDiagnostics.serializedBytes?.toLocaleString() ?? "legacy"} bytes</small>
        </details>)}
      </div>}
      {job && <div className="generation-plan-inspection" aria-label="Drafting job status"><strong>Job {job.status}</strong>
        {job.units.map((unit) => <div className="drafting-unit-status" key={unit.id}>
          <span>Unit {unit.position + 1}: {unit.status} · attempt {unit.attemptNumber}</span>
          {unit.generatedCandidates.map((candidate) => <small key={candidate.draftVersionId}>{candidate.passageId}: {candidate.wordCount} words generated</small>)}
          {unit.normalizedError && <small className="warning">{unit.normalizedError.code}: {unit.normalizedError.message}</small>}
          {unit.status === "failed" && <button type="button" disabled={busy} onClick={async () => {
            setBusy(true); try { setJob(await retryDraftingUnit(props.projectId, job.id, unit.id)); setJob(await startDraftingJob(props.projectId, job.id)); await refreshJob(job.id); }
            catch (error) { props.setMessage((error as Error).message); } finally { setBusy(false); }
          }}>Retry unit</button>}
        </div>)}
      </div>}
    </details>

    {reviewVersion && <details className="draft-diagnostics"><summary>Technical provenance</summary>
      <dl><dt>Draft version ID</dt><dd>{reviewVersion.id}</dd><dt>Passage-plan base</dt><dd>{reviewVersion.basedOnPassagePlanVersionId}</dd>
        <dt>Upstream versions</dt><dd>{Object.entries(reviewVersion.upstreamVersions).map(([key, value]) => `${key}: ${value}`).join(" · ")}</dd>
        <dt>Neighbor versions</dt><dd>{Object.entries(reviewVersion.neighboringDraftVersions).map(([key, value]) => `${key}: ${value}`).join(" · ") || "None"}</dd></dl>
    </details>}
  </section>;
}

function ProseReader({ markdown }: { markdown: string }) {
  return <div className="prose-reader">{markdown.split(/\r?\n\s*\r?\n/).map((paragraph, index) =>
    <p key={index}>{paragraph}</p>)}</div>;
}

function StaleNotice({ version }: { version: PassageDraftVersion }) {
  return <div className="warning" role="status"><strong>This draft is stale and cannot be accepted.</strong>
    <ul>{version.staleReasons.map((reason) => <li key={reason.id}>{reason.reasonCode}: {reason.sourceEntityKind} {reason.sourceEntityId}
      {reason.changedFields.length ? ` (${reason.changedFields.join(", ")})` : ""}</li>)}</ul></div>;
}

function AcceptancePreviewView({ preview }: { preview: DraftAcceptancePreview }) {
  return <div className={preview.valid ? "acceptance-preview" : "acceptance-preview warning"}>
    <strong>{preview.valid ? "Ready for explicit acceptance" : "Acceptance blocked"}</strong>
    <small>Fingerprint {preview.fingerprint}</small>
    <p>{preview.items.length} passage · {preview.acceptedWordDelta >= 0 ? "+" : ""}{preview.acceptedWordDelta} accepted words · {preview.downstreamStaleness.length} downstream drafts become stale</p>
    {preview.issues.length > 0 && <ul>{preview.issues.map((issue, index) => <li key={`${issue.code}:${index}`}>{issue.severity}: {issue.message}</li>)}</ul>}
  </div>;
}
