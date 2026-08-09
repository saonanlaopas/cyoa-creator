import { useEffect, useState } from "react";
import {
  authorizeDraftingPlan,
  createDraftingPlan,
  loadPassageDraft,
  previewDraftingPlan,
  restorePassageDraft,
  saveManualPassageDraft,
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
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const next = await loadPassageDraft(props.projectId, props.passageId);
    setState(next);
    setProse(next.head?.current.proseMarkdown ?? "");
    setAuthorNote(next.head?.current.authorNote ?? "");
  };
  useEffect(() => {
    setPlan(null);
    void load().catch((error: Error) => props.setMessage(error.message));
  }, [props.projectId, props.passageId, props.passagePlanVersionId]);

  if (!state) return <section className="passage-draft-panel"><p>Loading draft metadata…</p></section>;
  const current = state.head?.current ?? null;
  const accepted = state.head?.accepted ?? null;
  return <section className="passage-draft-panel" aria-label="Passage draft architecture">
    <header><div><p className="eyebrow">Foundation 4B-1</p><h3>Passage draft</h3></div>
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
    <details className="drafting-plan-preview"><summary>Drafting-plan architecture</summary>
      <p className="field-note">Preview and authorization are local. Foundation 4B-1 does not construct prose context or generate prose.</p>
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
            props.setMessage("Exact drafting-plan fingerprint authorized. No execution or prose generation occurred.");
          } catch (error) { props.setMessage((error as Error).message); }
          finally { setBusy(false); }
        }}>Authorize exact plan</button>}
      </div>
      {plan && <div className="generation-plan-inspection">
        <strong>{plan.units.length} unit · {plan.estimatedInputTokens.toLocaleString()} estimated input tokens · {plan.estimatedOutputTokens.toLocaleString()} output tokens</strong>
        <small>Fingerprint {plan.fingerprint}</small>
        <small>Limits: {plan.policy.maxPassagesPerUnit} passages/unit · {plan.policy.maxAttemptsPerUnit} attempts · {plan.policy.maxSerializedCandidateBytes.toLocaleString()} candidate bytes</small>
        {"authorizationState" in plan && <small>Status: {plan.authorizationState} · job {plan.jobStatus}</small>}
      </div>}
    </details>
  </section>;
}
