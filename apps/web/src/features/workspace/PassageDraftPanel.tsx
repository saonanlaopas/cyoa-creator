import { useEffect, useState } from "react";
import {
  authorizeDraftingPlan,
  cancelDraftingJob,
  createDraftingPlan,
  loadPassageDraft,
  loadDraftingJob,
  listDraftingPlans,
  previewDraftingPlan,
  retryDraftingUnit,
  restorePassageDraft,
  saveManualPassageDraft,
  startDraftingJob,
  type DraftingJob,
  type DraftingPlan,
  type DraftingPlanPreview,
  type PassageDraftState,
} from "../../api/passage-drafts.js";

export function PassageDraftPanel(props: {
  projectId: string;
  passageId: string;
  passagePlanVersionId: string;
  passagePlanApproved: boolean;
  setMessage(value: string | null): void;
}) {
  const [state, setState] = useState<PassageDraftState | null>(null);
  const [prose, setProse] = useState("");
  const [authorNote, setAuthorNote] = useState("");
  const [plan, setPlan] = useState<DraftingPlanPreview | DraftingPlan | null>(null);
  const [job, setJob] = useState<DraftingJob | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const next = await loadPassageDraft(props.projectId, props.passageId);
    setState(next);
    setProse(next.head?.current.proseMarkdown ?? "");
    setAuthorNote(next.head?.current.authorNote ?? "");
  };
  useEffect(() => {
    setPlan(null);
    setJob(null);
    void load().catch((error: Error) => props.setMessage(error.message));
    if (props.passagePlanApproved) void (async () => {
      const plans = await listDraftingPlans(props.projectId);
      const latest = plans.find((item) => item.scope.passageIds.includes(props.passageId));
      if (!latest) return;
      setPlan(latest);
      setJob(await loadDraftingJob(props.projectId, latest.jobId));
    })().catch((error: Error) => props.setMessage(error.message));
  }, [props.projectId, props.passageId, props.passagePlanVersionId, props.passagePlanApproved]);

  if (!state) return <section className="passage-draft-panel"><p>Loading draft metadata…</p></section>;
  const current = state.head?.current ?? null;
  const accepted = state.head?.accepted ?? null;
  const planPolicy = plan && ("executionPolicy" in plan ? plan.executionPolicy : plan.policy);
  const refreshJob = async (jobId: string) => {
    for (let index = 0; index < 200; index += 1) {
      const next = await loadDraftingJob(props.projectId, jobId);
      setJob(next);
      if (["completed", "partially_failed", "failed", "cancelled"].includes(next.status)) {
        await load();
        return next;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("Drafting job did not finish within the local inspection window");
  };
  return <section className="passage-draft-panel" aria-label="Passage draft architecture">
    <header><div><p className="eyebrow">Foundation 4B-2</p><h3>Passage draft</h3></div>
      <div className="draft-status-badges">
        <span>{current?.status ?? "no draft"}</span>
        {state.head?.acceptedLocked && <span>accepted locked</span>}
      </div>
    </header>
    <dl className="draft-metadata">
      <div><dt>Passage-plan base</dt><dd>{current?.basedOnPassagePlanVersionId ?? state.passagePlanVersionId}</dd></div>
      <div><dt>Current words</dt><dd>{current?.wordCount ?? 0} / {state.passagePlan.wordTarget}</dd></div>
      <div><dt>Accepted</dt><dd>{accepted ? `v${accepted.version} · ${accepted.wordCount} words${accepted.stale ? " · stale" : ""}` : "None"}</dd></div>
      <div><dt>Corpus</dt><dd>{state.summary.acceptedWords.toLocaleString()} accepted · {state.summary.remainingWords.toLocaleString()} remaining</dd></div>
      <div><dt>Current source</dt><dd>{current?.sourceKind ?? "None"}{current?.generationProvenance ? ` · ${current.generationProvenance.providerId}/${current.generationProvenance.modelId}` : ""}</dd></div>
    </dl>
    {current?.stale && <div className="warning" role="status">
      <strong>This draft is stale.</strong>
      <ul>{current.staleReasons.map((reason) => <li key={reason.id}>
        {reason.reasonCode}: {reason.sourceEntityKind} {reason.sourceEntityId}
        {reason.changedFields.length ? ` (${reason.changedFields.join(", ")})` : ""}
      </li>)}</ul>
    </div>}
    <label>Prose Markdown<textarea className="draft-prose" value={prose} onChange={(event) => setProse(event.target.value)} /></label>
    <label>Author note<textarea value={authorNote} onChange={(event) => setAuthorNote(event.target.value)} /></label>
    <div className="proposal-actions"><button type="button" className="primary" disabled={busy} onClick={async () => {
      setBusy(true);
      try {
        const result = await saveManualPassageDraft(props.projectId, props.passageId, prose, authorNote);
        setState(result.state);
        props.setMessage("Manual draft saved as a new immutable candidate version. No provider was called.");
      } catch (error) { props.setMessage((error as Error).message); }
      finally { setBusy(false); }
    }}>Save new candidate version</button></div>
    <details className="artifact-history"><summary>Draft history ({state.history.length})</summary>
      {state.history.map((version) => <div className="snapshot-row" key={version.id}>
        <span>v{version.version} · {version.status} · {version.wordCount} words · {new Date(version.createdAt).toLocaleString()}</span>
        <button type="button" disabled={busy} onClick={async () => {
          setBusy(true);
          try {
            const result = await restorePassageDraft(props.projectId, props.passageId, version.id);
            setState(result.state); setProse(result.draft.proseMarkdown); setAuthorNote(result.draft.authorNote);
            props.setMessage("Draft restored as a new immutable candidate version.");
          } catch (error) { props.setMessage((error as Error).message); }
          finally { setBusy(false); }
        }}>Restore as candidate</button>
      </div>)}
    </details>
    <details className="drafting-plan-preview"><summary>Bounded prose generation</summary>
      {!props.passagePlanApproved && <p className="warning">Approve the current passage-plan snapshot before creating a drafting plan.</p>}
      <div className="proposal-actions">
        <button type="button" disabled={busy || !props.passagePlanApproved} onClick={async () => {
          setBusy(true);
          try { setPlan(await previewDraftingPlan(props.projectId, [props.passageId])); }
          catch (error) { props.setMessage((error as Error).message); }
          finally { setBusy(false); }
        }}>Preview one-passage plan</button>
        <button type="button" disabled={busy || !props.passagePlanApproved} onClick={async () => {
          setBusy(true);
          try { setPlan(await createDraftingPlan(props.projectId, [props.passageId])); props.setMessage("Drafting plan saved locally without generating prose."); }
          catch (error) { props.setMessage((error as Error).message); }
          finally { setBusy(false); }
        }}>Save plan</button>
        {plan && "id" in plan && plan.authorizationState === "planned" && <button type="button" disabled={busy} onClick={async () => {
          setBusy(true);
          try {
            setPlan(await authorizeDraftingPlan(props.projectId, plan.id, plan.fingerprint));
            props.setMessage("Exact immutable drafting plan authorized. Generation has not started.");
          } catch (error) { props.setMessage((error as Error).message); }
          finally { setBusy(false); }
        }}>Authorize exact plan</button>}
        {plan && "id" in plan && plan.authorizationState === "authorized" && ["authorized", "partially_failed", "failed"].includes(plan.jobStatus) && <button type="button" className="primary" disabled={busy} onClick={async () => {
          setBusy(true);
          try {
            setJob(await startDraftingJob(props.projectId, plan.jobId));
            props.setMessage("Bounded offline prose generation started.");
            const finished = await refreshJob(plan.jobId);
            props.setMessage(finished.status === "completed" ? "Generated candidate prose is persisted." : `Drafting job ${finished.status}.`);
          } catch (error) { props.setMessage((error as Error).message); }
          finally { setBusy(false); }
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
        {"authorizationState" in plan && <small>Status: {plan.authorizationState} · job {plan.jobStatus}</small>}
        {plan.units.map((unit) => <details key={unit.id}>
          <summary>Unit {unit.position + 1}: {unit.contextDiagnostics.status} context</summary>
          <small>{unit.passageIds.length} passage · {unit.estimatedInputTokens.toLocaleString()} input tokens · {unit.contextDiagnostics.serializedBytes?.toLocaleString() ?? "legacy"} bytes</small>
          {unit.contextDiagnostics.contextFingerprint && <small>Context {unit.contextDiagnostics.contextFingerprint}</small>}
          {unit.contextDiagnostics.includedRecords && <small>Included: {Object.entries(unit.contextDiagnostics.includedRecords)
            .map(([key, value]) => `${key} ${value.ids.length}`).join(" · ")}</small>}
          {unit.contextDiagnostics.staleNeighborDraftsExcluded?.length ? <small>Stale accepted neighbors excluded: {unit.contextDiagnostics.staleNeighborDraftsExcluded.map((item) => item.passageId).join(", ")}</small> : null}
        </details>)}
      </div>}
      {job && <div className="generation-plan-inspection" aria-label="Drafting job status">
        <strong>Job {job.status}</strong>
        {job.units.map((unit) => <div className="drafting-unit-status" key={unit.id}>
          <span>Unit {unit.position + 1}: {unit.status} · attempt {unit.attemptNumber}</span>
          {unit.generatedCandidates.map((candidate) => <small key={candidate.draftVersionId}>
            {candidate.passageId}: {candidate.wordCount} words generated
          </small>)}
          {unit.normalizedError && <small className="warning">{unit.normalizedError.code}: {unit.normalizedError.message}</small>}
          {unit.status === "failed" && <button type="button" disabled={busy} onClick={async () => {
            setBusy(true);
            try {
              const retried = await retryDraftingUnit(props.projectId, job.id, unit.id);
              setJob(retried);
              setJob(await startDraftingJob(props.projectId, job.id));
              await refreshJob(job.id);
            } catch (error) { props.setMessage((error as Error).message); }
            finally { setBusy(false); }
          }}>Retry unit</button>}
        </div>)}
      </div>}
    </details>
  </section>;
}
