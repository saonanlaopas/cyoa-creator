import { useEffect, useMemo, useState } from "react";
import {
  applyPassageProposal,
  createPassageProposal,
  listPassageProposals,
  previewPassageProposal,
  rejectPassageProposalGroups,
  type GenerationJob,
  type PassageProposalPreview,
  type PassageProposalSet,
} from "../../api/passage-generation.js";

export function PassageProposalReview(props: {
  projectId: string;
  job: GenerationJob;
  busy: boolean;
  setBusy(value: boolean): void;
  setMessage(value: string | null): void;
  onApplied(): Promise<void>;
}) {
  const [proposal, setProposal] = useState<PassageProposalSet | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<PassageProposalPreview | null>(null);

  const defaults = (value: PassageProposalSet) => new Set(value.groups
    .filter((group) => group.status === "proposed" && group.safeToApplyIndependently)
    .map((group) => group.id));
  const load = async () => {
    const found = (await listPassageProposals(props.projectId))
      .find((item) => item.generationJobId === props.job.id) ?? null;
    setProposal(found);
    setSelectedIds(found ? defaults(found) : new Set());
    setPreview(null);
  };
  useEffect(() => { void load().catch((error: Error) => props.setMessage(error.message)); }, [props.projectId, props.job.id, props.job.status]);

  const groupsById = useMemo(() => new Map(proposal?.groups.map((group) => [group.id, group]) ?? []), [proposal]);
  const setSelected = (groupId: string, checked: boolean) => {
    const next = new Set(selectedIds);
    if (checked) {
      const add = (id: string) => {
        if (next.has(id)) return;
        next.add(id);
        groupsById.get(id)?.dependsOnGroupIds.forEach(add);
      };
      add(groupId);
    } else {
      next.delete(groupId);
      let changed = true;
      while (changed) {
        changed = false;
        proposal?.groups.forEach((group) => {
          if (next.has(group.id) && group.dependsOnGroupIds.some((id) => !next.has(id)
            && groupsById.get(id)?.status !== "applied")) {
            next.delete(group.id);
            changed = true;
          }
        });
      }
    }
    setSelectedIds(next);
    setPreview(null);
  };
  const perform = async (operation: () => Promise<void>) => {
    props.setBusy(true);
    try { await operation(); }
    catch (error) { setPreview(null); props.setMessage((error as Error).message); }
    finally { props.setBusy(false); }
  };

  if (props.job.status !== "completed" && !proposal) return null;
  if (!proposal) return <section className="proposal-review" aria-label="Passage proposal review">
    <h3>Validated candidate proposal</h3>
    <p>Consolidate the completed immutable candidates locally into reviewable passage-plan operations. This does not call a provider or change the passage plan.</p>
    <button disabled={props.busy} onClick={() => void perform(async () => {
      const created = await createPassageProposal(props.projectId, props.job.id);
      setProposal(created); setSelectedIds(defaults(created));
      props.setMessage("Validated candidates consolidated locally. Review and preview before applying.");
    })}>Create proposal set</button>
  </section>;

  return <section className="proposal-review" aria-label="Passage proposal review">
    <header>
      <div><h3>Passage proposal review</h3><p>Status: <strong>{proposal.status}</strong></p></div>
      <small>Proposal <code>{proposal.id}</code> / job <code>{proposal.generationJobId}</code></small>
    </header>
    <p>{proposal.groups.length} coherent group{proposal.groups.length === 1 ? "" : "s"} / {proposal.candidateIds.length} validated candidate{proposal.candidateIds.length === 1 ? "" : "s"}</p>
    <details>
      <summary>Immutable provenance</summary>
      <small>Plan: <code>{proposal.generationPlanId}</code></small>
      <small>Plan fingerprint: <code>{proposal.generationPlanFingerprint}</code></small>
      <small>Approved snapshot: <code>{proposal.snapshotId}</code></small>
      <small>Consolidation: <code>{proposal.consolidationFingerprint}</code></small>
      <small>Candidate IDs: {proposal.candidateIds.join(", ")}</small>
    </details>
    {proposal.groups.length === 0 && <p className="status good">Candidates are identical to their immutable bases; there is nothing to apply.</p>}
    <div className="proposal-groups">
      {proposal.groups.map((group) => <article className="proposal-group" key={group.id}>
        <label>
          <input
            type="checkbox"
            aria-label={`Select ${group.label}`}
            checked={selectedIds.has(group.id)}
            disabled={group.status !== "proposed"}
            onChange={(event) => setSelected(group.id, event.target.checked)}
          />
          <strong>{group.label}</strong> / {group.status}
        </label>
        <p>{group.summary}</p>
        <small>{group.safeToApplyIndependently ? "Safe independently" : "Dependency or validation review required"}</small>
        {group.dependsOnGroupIds.length > 0 && <small>Requires: {group.dependsOnGroupIds.join(", ")}</small>}
        <small>Affects: {group.affectedEntityIds.join(", ")}</small>
        {group.validationFindingIds.length > 0 && <small>Related findings: {group.validationFindingIds.join(", ")}</small>}
        <details>
          <summary>Operation details ({group.operations.length})</summary>
          {group.operations.map((operation) => <div className="proposal-operation" key={operation.id}>
            <strong>{operation.kind} {operation.entityKind}:{operation.entityId}</strong>
            <small>Base: {operation.baseVersionId ?? "new deterministic entity"}</small>
            <ul>{operation.fieldDiffs.map((diff) => <li key={diff.field}>
              <code>{diff.field}</code>: <span>{display(diff.before)}</span> -&gt; <span>{display(diff.after)}</span>
            </li>)}</ul>
          </div>)}
        </details>
      </article>)}
    </div>
    <div className="artifact-actions">
      <button disabled={props.busy || selectedIds.size === 0} onClick={() => void perform(async () => {
        const next = await previewPassageProposal(props.projectId, proposal.id, [...selectedIds]);
        setPreview(next);
        props.setMessage(next.valid ? "Validation preview is current and ready for explicit application." : "Validation preview found blocking issues.");
      })}>Refresh validation preview</button>
      <button disabled={props.busy || !preview?.valid} onClick={() => void perform(async () => {
        const applied = await applyPassageProposal(
          props.projectId, proposal.id, [...selectedIds], preview!.previewFingerprint,
        );
        setProposal(applied); setPreview(null); setSelectedIds(defaults(applied));
        await props.onApplied();
        props.setMessage("Selected proposal groups applied transactionally as new passage-plan versions.");
      })}>Apply reviewed selection</button>
      <button disabled={props.busy || selectedIds.size === 0} onClick={() => void perform(async () => {
        const rejected = await rejectPassageProposalGroups(props.projectId, proposal.id, [...selectedIds]);
        setProposal(rejected); setPreview(null); setSelectedIds(defaults(rejected));
        props.setMessage("Selected proposal groups rejected without changing the passage plan.");
      })}>Reject selected</button>
    </div>
    {preview && <section className={preview.valid ? "status good" : "validation-blocked"} aria-label="Proposal validation preview">
      <strong>{preview.valid ? "Preview valid" : "Application blocked"}</strong>
      <small>Fingerprint: <code>{preview.previewFingerprint}</code></small>
      <small>Affected: {preview.affectedEntityIds.join(", ")}</small>
      {preview.hardErrors.map((finding) => <p className="error" key={`${finding.code}:${finding.entityId}`}>{finding.message}</p>)}
      {preview.warnings.map((finding) => <p className="warning" key={`${finding.code}:${finding.entityId}`}>{finding.message}{finding.acknowledged ? " (acknowledged)" : ""}</p>)}
      <details open>
        <summary>Before/after differences</summary>
        {preview.beforeAfter.map((item) => <div key={item.operationId}>
          <strong>{item.entityKind}:{item.entityId}</strong>
          <ul>{item.fieldDiffs.map((diff) => <li key={diff.field}><code>{diff.field}</code>: {display(diff.before)} -&gt; {display(diff.after)}</li>)}</ul>
        </div>)}
      </details>
    </section>}
    {proposal.applications.length > 0 && <details>
      <summary>Application history ({proposal.applications.length})</summary>
      {proposal.applications.map((application) => <p key={application.id}>
        {application.createdAt} / groups {application.selectedGroupIds.join(", ")} / {application.appliedOperationIds.length} operations
      </p>)}
    </details>}
  </section>;
}

function display(value: unknown): string {
  if (value === undefined) return "(unset)";
  const result = typeof value === "string" ? value : JSON.stringify(value);
  return result.length > 180 ? `${result.slice(0, 177)}...` : result;
}
