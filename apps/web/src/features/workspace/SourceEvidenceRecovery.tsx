import { useEffect, useRef, useState } from "react";

type Evidence = { sourceVersionId: string; sourceFingerprint: string; availability: "present" | "redacted" | "missing" };

export function SourceEvidenceRecovery({ projectId, onReattached }: { projectId: string; onReattached(): void | Promise<void> }) {
  const [items, setItems] = useState<Evidence[]>([]), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [offset, setOffset] = useState(0), [hasMore, setHasMore] = useState(false), [verified, setVerified] = useState(false);
  const [omissions, setOmissions] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const root = `/api/long-form/projects/${encodeURIComponent(projectId)}`;
  const refresh = async (pageOffset = offset) => {
    const response = await fetch(`${root}/source-availability?offset=${pageOffset}`);
    if (!response.ok) throw new Error("Could not check source evidence availability.");
    const result = await response.json() as { evidence: Evidence[]; hasMore: boolean; omittedHistoryCount?: number };
    if (!result.evidence.length && pageOffset > 0) return refresh(0);
    setOffset(pageOffset); setItems(result.evidence); setHasMore(result.hasMore); setOmissions(result.omittedHistoryCount ?? 0);
  };
  useEffect(() => { setItems([]); setMessage(""); void refresh().catch((error: Error) => setMessage(error.message)); }, [projectId]);
  if (!items.length && !message && !omissions) return null;
  return <section className="source-evidence-recovery" aria-label="Unavailable source evidence">
    <h3 ref={heading} tabIndex={-1}>{items.length ? "Source evidence unavailable" : verified ? "Source evidence verified" : message ? "Source evidence check failed" : "Archived history unavailable"}</h3>
    {omissions > 0 && <p>{omissions} archived history records were omitted. Canonical provenance excerpts are not recovered conversation evidence. Reattaching a source does not restore those records.</p>}
    {items.length > 0 && <p>Source-grounded AI work and full recovery backups are blocked. Reattach the original file or normalized source JSON; only an exact fingerprint match is accepted.</p>}
    {items.map((item) => <details key={item.sourceVersionId} open={items.length === 1}>
      <summary>Reattach source {item.sourceVersionId}</summary>
      <p className="fingerprint">Expected fingerprint: <code>{item.sourceFingerprint}</code></p>
      <label>Exact source file<input type="file" accept=".txt,.html,.htm,.epub,.json" disabled={busy} onChange={(event) => {
        const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
        setBusy(true); setMessage("");
        void (async () => {
          try {
            const body = new FormData(); body.append("file", file);
            const response = await fetch(`${root}/sources/${encodeURIComponent(item.sourceVersionId)}/reattach`, { method: "POST", body });
            const result = await response.json() as { error?: string };
            if (!response.ok) throw new Error(result.error ?? "Source verification failed. Nothing was changed.");
            await refresh(); await onReattached(); setVerified(true); setMessage("Exact source verified and reattached. Conversation omissions remain unavailable."); heading.current?.focus();
          } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
        })();
      }} /></label>
    </details>)}
    {(offset > 0 || hasMore) && <nav aria-label="Unavailable source pages">
      <button disabled={busy || offset === 0} onClick={() => void refresh(Math.max(0, offset - 20)).catch((error: Error) => setMessage(error.message))}>Previous sources</button>
      <button disabled={busy || !hasMore} onClick={() => void refresh(offset + 20).catch((error: Error) => setMessage(error.message))}>Next sources</button>
    </nav>}
    {message && <p role="status">{message}</p>}
  </section>;
}
