import { useEffect, useMemo, useState } from "react";
import {
  applyDraftAcceptance,
  loadDraftReviewQueue,
  previewDraftAcceptance,
  type DraftAcceptancePreview,
  type DraftReviewQueueItem,
} from "../../api/passage-drafts.js";

export function DraftReviewQueue(props: {
  projectId: string;
  selectedPassageId: string;
  refreshKey: number;
  onSelectPassage(passageId: string): void;
  onChanged(): void;
  setMessage(value: string | null): void;
}) {
  const [items, setItems] = useState<DraftReviewQueueItem[]>([]);
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof loadDraftReviewQueue>>["summary"] | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<DraftAcceptancePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const next = await loadDraftReviewQueue(props.projectId);
    const nextItems = Array.isArray(next.items) ? next.items : [];
    setItems(nextItems); setSummary(next.summary ?? null);
    setSelected((current) => new Set([...current].filter((passageId) => nextItems.some((item) =>
      item.passageId === passageId && item.currentLifecycleStatus === "candidate"))));
  };
  useEffect(() => { void load().catch((error: Error) => props.setMessage(error.message)); }, [props.projectId, props.refreshKey]);
  const visible = useMemo(() => items.filter((item) => {
    const haystack = `${item.title} ${item.stableId} ${item.sequenceId} ${item.actId ?? ""} ${item.routeIds.join(" ")}`.toLowerCase();
    return (!search || haystack.includes(search.toLowerCase()))
      && (!status || (status === "needs-review" ? item.needsReview : status === "stale"
        ? item.currentStatus === "stale" || item.acceptedStale : item.acceptedLifecycleStatus === status || item.currentStatus === status))
      && (!source || item.currentSourceKind === source);
  }), [items, search, status, source]);
  const selections = [...selected].flatMap((passageId) => {
    const item = items.find((candidate) => candidate.passageId === passageId);
    return item?.currentVersionId && item.currentLifecycleStatus === "candidate"
      ? [{ passageId, candidateDraftVersionId: item.currentVersionId }] : [];
  });
  return <details className="draft-review-queue" open>
    <summary><strong>Draft review queue</strong> · {items.length} planned passages</summary>
    {summary && <div className="draft-corpus-strip" aria-label="Draft corpus reporting">
      <span>{summary.currentCandidateCount} candidates</span><span>{summary.acceptedDraftCount} accepted</span>
      <span>{summary.reviewedDraftCount} reviewed</span><span>{summary.lockedDraftCount} locked</span>
      <span>{summary.staleCurrentCandidateCount} stale candidates</span><span>{summary.staleAcceptedDraftCount} stale accepted</span>
      <span>{summary.acceptedWords.toLocaleString()} / {summary.plannedWords.toLocaleString()} accepted words ({summary.acceptanceCompletionPercentage}%)</span>
    </div>}
    <div className="draft-queue-filters">
      <label>Find passage<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Title or stable ID" /></label>
      <label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}>
        <option value="">All</option><option value="needs-review">Needs review</option><option value="candidate">Candidate</option>
        <option value="accepted">Accepted</option><option value="reviewed">Reviewed</option><option value="locked">Locked</option>
        <option value="stale">Stale</option><option value="no-draft">No draft</option>
      </select></label>
      <label>Source<select value={source} onChange={(event) => setSource(event.target.value)}>
        <option value="">All</option><option value="manual">Manual</option><option value="generated">Generated</option>
        <option value="restore">Restore</option><option value="lifecycle">Lifecycle</option>
      </select></label>
    </div>
    <p className="field-note">{visible.length} rows · compact metadata only; prose loads after selection.</p>
    <div className="draft-queue-list" role="list" aria-label="Passage draft review queue">
      {visible.map((item) => <div role="listitem" className={item.passageId === props.selectedPassageId ? "selected" : ""} key={item.passageId}>
        <input type="checkbox" aria-label={`Select ${item.title} candidate`} disabled={item.currentLifecycleStatus !== "candidate"}
          checked={selected.has(item.passageId)} onChange={(event) => {
            setPreview(null); setSelected((current) => { const next = new Set(current);
              if (event.target.checked) next.add(item.passageId); else next.delete(item.passageId); return next; });
          }} />
        <button type="button" onClick={() => props.onSelectPassage(item.passageId)}>{item.title}</button>
        <code>{item.stableId}</code>
        <span>{item.currentStatus} · {item.currentWordCount}/{item.wordTarget}w · {item.currentSourceKind ?? "none"}</span>
        <span>{item.acceptedLifecycleStatus ?? "not accepted"}{item.acceptedLocked ? " · locked" : ""}{item.acceptedStale ? " · stale" : ""}</span>
      </div>)}
    </div>
    {selected.size > 0 && <div className="draft-batch-review">
      <strong>{selected.size} exact candidates selected</strong>
      <button type="button" disabled={busy} onClick={async () => {
        setBusy(true); try { setPreview(await previewDraftAcceptance(props.projectId, selections)); props.setMessage("Batch impact previewed locally with zero provider calls and zero writes."); }
        catch (error) { props.setMessage((error as Error).message); } finally { setBusy(false); }
      }}>Preview batch acceptance</button>
      {preview && <><span>{preview.valid ? "Ready" : "Blocked"} · {preview.acceptedWordDelta >= 0 ? "+" : ""}{preview.acceptedWordDelta} accepted words · {preview.downstreamStaleness.length} downstream stale</span>
        {preview.issues.map((issue, index) => <small className={issue.severity === "error" ? "warning" : ""} key={`${issue.code}:${index}`}>{issue.message}</small>)}
        <button type="button" className="primary" disabled={busy || !preview.valid} onClick={async () => {
          setBusy(true); try {
            await applyDraftAcceptance(props.projectId, selections, preview.fingerprint);
            setPreview(null); setSelected(new Set()); await load(); props.onChanged();
            props.setMessage("Batch accepted atomically as immutable lifecycle versions.");
          } catch (error) { props.setMessage((error as Error).message); } finally { setBusy(false); }
        }}>Accept exact batch</button></>}
    </div>}
  </details>;
}
