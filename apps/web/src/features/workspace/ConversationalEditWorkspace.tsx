import { useEffect, useMemo, useState } from "react";
import { ConversationalEditApi, type EditHistory, type EditPreview, type EditProposal, type EditReview, type EditTarget } from "../../api/conversational-edit.js";
import "./foundation-bootstrap.css";
import "./conversational-edit.css";

const display = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value, null, 2);
export function ConversationalEditWorkspace({ projectId, onApplied, onDraftRoute }: { projectId: string; onApplied: () => Promise<void>; onDraftRoute: (id: string) => void }) {
  const api = useMemo(() => new ConversationalEditApi(projectId), [projectId]);
  const [catalogue, setCatalogue] = useState<{ total: number; items: EditTarget[] }>({ total: 0, items: [] });
  const [search, setSearch] = useState(""), [offset, setOffset] = useState(0), [scope, setScope] = useState<EditTarget[]>([]);
  const [request, setRequest] = useState(""), [intent, setIntent] = useState("propose"), [provider, setProvider] = useState("offline-edit"), [model, setModel] = useState("offline-edit-v1");
  const [preview, setPreview] = useState<EditPreview | null>(null), [authorized, setAuthorized] = useState(false);
  const [proposal, setProposal] = useState<EditProposal | null>(null), [groups, setGroups] = useState<string[]>([]), [review, setReview] = useState<EditReview | null>(null);
  const [conversationId, setConversationId] = useState(""), [history, setHistory] = useState<EditHistory | null>(null);
  const [busy, setBusy] = useState(false), [generating, setGenerating] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const resetPreview = () => { setPreview(null); setAuthorized(false); };
  const act = async (fn: () => Promise<void>) => { setBusy(true); setError(""); setNotice(""); try { await fn(); } catch (e) { setError((e as Error).message); setReview(null); setAuthorized(false); } finally { setBusy(false); } };
  const refreshHistory = async (id: string) => { setConversationId(id); setHistory(await api.history(id)); };
  useEffect(() => {
    let live = true;
    void api.targets(search, offset).then((v) => { if (live) setCatalogue(v); }).catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [api, search, offset]);
  useEffect(() => {
    let live = true;
    void api.conversations().then(async (items) => { if (!items[0]) return; const h = await api.history(items[0].id); if (live) { setConversationId(items[0].id); setHistory(h); } }).catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [api]);
  const toggleTarget = (target: EditTarget) => { setScope((current) => current.some((t) => t.key === target.key) ? current.filter((t) => t.key !== target.key) : [...current, target]); resetPreview(); };
  const openProposal = (p: EditProposal) => { setProposal(p); setGroups(p.proposal.response.groups.map((g) => g.id)); setReview(null); setScope(p.proposal.plan.targets); resetPreview(); };
  const ready = preview?.status === "ready" ? preview : null;
  return <section className="artifact-pane bootstrap-workspace edit-workspace" aria-label="Conversational editing">
    <header className="artifact-header"><h1>Conversational editing</h1><span className="workflow-status">{generating ? "Generating" : proposal?.status ?? "Draft proposals"}</span></header>
    {error && <p className="error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <section className="brief-section"><h2>Scope</h2>
      <label>Find planning records<input value={search} disabled={busy} onChange={(e) => { setSearch(e.target.value); setOffset(0); }} /></label>
      <div className="edit-scope-list" role="region" aria-label="Planning records">{catalogue.items.map((target) => <label className="bootstrap-check" key={target.key}>
        <input type="checkbox" disabled={busy || scope.length >= 12 && !scope.some((t) => t.key === target.key)} checked={scope.some((t) => t.key === target.key)} onChange={() => toggleTarget(target)} />
        <span>{target.label}<small>{target.key}</small></span>
      </label>)}</div>
      <div className="artifact-actions"><button disabled={busy || offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous records</button><span>{catalogue.total ? offset + 1 : 0}-{Math.min(offset + 50, catalogue.total)} of {catalogue.total}</span><button disabled={busy || offset + 50 >= catalogue.total} onClick={() => setOffset(offset + 50)}>Next records</button></div>
      <h3>Selected scope ({scope.length}/12)</h3>
      {scope.length ? <ul>{scope.map((target) => <li key={target.key}>{target.label} <code>{target.key}</code> <button disabled={busy} onClick={() => toggleTarget(target)}>Remove</button></li>)}</ul> : <p>No explicit scope selected</p>}
    </section>
    <section className="brief-section"><h2>Director request</h2>
      <label>Editing request<textarea maxLength={6000} disabled={busy} value={request} onChange={(e) => { setRequest(e.target.value); resetPreview(); }} /></label>
      <fieldset className="edit-intent"><legend>Intent</legend>{["propose", "discuss"].map((value) => <label className="bootstrap-check" key={value}><input type="radio" name="editing-intent" value={value} checked={intent === value} disabled={busy} onChange={() => { setIntent(value); resetPreview(); }} />{value === "propose" ? "Propose edits" : "Discuss"}</label>)}</fieldset>
      <div className="bootstrap-provider"><label>Editing provider<select disabled={busy} value={provider} onChange={(e) => { setProvider(e.target.value); setModel(e.target.value === "offline-edit" ? "offline-edit-v1" : ""); resetPreview(); }}><option value="offline-edit">Offline editor</option><option value="openrouter-edit">OpenRouter</option></select></label>
        <label>Editing model<input disabled={busy || provider === "offline-edit"} value={model} onChange={(e) => { setModel(e.target.value); resetPreview(); }} /></label></div>
      <button disabled={busy || !request.trim() || !model.trim()} onClick={() => void act(async () => {
        setAuthorized(false); setProposal(null); setReview(null);
        const next = await api.preview({ message: request, targetKeys: scope.map((t) => t.key), intent, providerId: provider, modelId: model, ...(conversationId ? { conversationId } : {}) }); setPreview(next);
        if (next.status === "ready") { setScope(next.plan.targets); await refreshHistory(next.plan.conversationId); }
      })}>Preview editing scope</button>
    </section>
    {preview?.status === "clarification" && <section className="brief-section" aria-label="Scope clarification"><h2>Clarify scope</h2><p>{preview.question}</p>{preview.candidates.map((t) => <label className="bootstrap-check" key={t.key}><input type="checkbox" checked={scope.some((s) => s.key === t.key)} disabled={busy} onChange={() => toggleTarget(t)} />{t.label} <code>{t.key}</code></label>)}</section>}
    {preview?.status === "draft-workflow" && <section className="brief-section"><h2>Passage candidate</h2><p>Accepted and locked prose remains protected.</p><button disabled={!preview.passageId} onClick={() => { if (preview.passageId) onDraftRoute(preview.passageId); }}>Open passage drafting</button></section>}
    {ready && <section className="brief-section" aria-label="Editing generation preview"><h2>Generation preview</h2>
      <ul>{ready.plan.targets.map((t) => <li key={t.key}>{t.label} <code>{t.targetId}</code></li>)}</ul>
      <p>Potential downstream staleness: {ready.impact.join(", ") || "None"}</p>
      <dl className="simulation-metadata"><div><dt>Context bytes</dt><dd>{ready.plan.contextBytes}</dd></div><div><dt>Estimated input tokens</dt><dd>{ready.estimatedInputTokens}</dd></div><div><dt>Cost</dt><dd>{ready.cost === 0 ? "$0.00 (offline)" : "Unavailable / provider charges may apply"}</dd></div></dl>
      <details><summary>Exact bases</summary>{ready.plan.targets.map((t) => <p key={t.key}>{t.key}: <code>{t.versionId}</code></p>)}<p><code>{ready.plan.fingerprint}</code></p></details>
      <label className="bootstrap-check"><input type="checkbox" disabled={busy} checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} />Authorize this exact editing generation</label>
      <div className="artifact-actions"><button disabled={busy || !authorized} onClick={() => void act(async () => {
        setGenerating(true); try { const result = await api.generate(ready.plan); setNotice(result.message); if (result.proposal) openProposal(result.proposal); await refreshHistory(ready.plan.conversationId); } finally { setGenerating(false); setAuthorized(false); }
      })}>Generate editing response</button><button disabled={!generating} onClick={() => { void api.cancel(ready.plan).catch((e: Error) => setError(e.message)); }}>Cancel generation</button></div>
    </section>}
    {proposal && <section className="brief-section" aria-label="Editing proposal"><h2>Review proposal</h2><p>{proposal.summary}</p>
      {proposal.proposal.response.groups.map((g) => <div className="bootstrap-group" key={g.id}><label className="bootstrap-check"><input type="checkbox" checked={groups.includes(g.id)} disabled={busy || proposal.status !== "proposed"} onChange={(e) => { setGroups((current) => e.target.checked ? [...current, g.id] : current.filter((id) => id !== g.id)); setReview(null); }} />{g.label}</label><p>{g.explanation}</p><p>Depends on: {g.dependsOnGroupIds.join(", ") || "None declared"}</p><ul>{g.operations.map((op, i) => <li key={i}><code>{op.targetKey}</code> / {op.kind}</li>)}</ul></div>)}
      <div className="artifact-actions"><button disabled={busy || !groups.length || proposal.status !== "proposed"} onClick={() => void act(async () => setReview(await api.review(proposal.id, groups)))}>Review selected changes</button><button disabled={busy || proposal.status !== "proposed"} onClick={() => void act(async () => { await api.reject(proposal.id); setProposal({ ...proposal, status: "rejected" }); setReview(null); await refreshHistory(conversationId); })}>Reject proposal</button></div>
      {review && <section aria-label="Effective editing changes"><h3>Effective changes</h3><p>Downstream staleness: {review.wouldStale.join(", ") || "None"}</p><p>{review.protectedProse}</p><p>Required groups: {review.requiredGroupIds.join(", ") || "None"}</p>
        {review.outputs.map((output) => <details key={`${output.owner}:${output.targetId}`}><summary>{output.owner} / {output.targetId}: before and after</summary><div className="bootstrap-diff"><div><h4>Before</h4><pre>{display(output.before)}</pre></div><div><h4>After</h4><pre>{display(output.after)}</pre></div></div></details>)}
        <details><summary>Validation and evidence</summary><p>{review.evidence.request}</p><p>Author message: <code>{review.evidence.messageId}</code></p><p>{review.validation.totalFindings ? `${review.validation.totalFindings} current validation findings (no new errors); ${review.validation.omittedFindings} omitted from this view` : "No validation findings"}</p>{review.findings.map((f, i) => <p key={i}>{f.severity}: {f.message}</p>)}<pre>{display(review.generatedIds)}</pre></details>
        {review.evidence.sourceRecords.length > 0 && <details><summary>Source provenance</summary>{review.evidence.sourceRecords.map(({ record, excerpts }) => <div key={record.id}><h4>{record.claim}</h4><code>{record.id}</code>{excerpts.map((e, i) => <blockquote key={i}>{e.text}</blockquote>)}</div>)}</details>}
        <button disabled={busy || proposal.status !== "proposed"} onClick={() => void act(async () => { await api.apply(proposal.id, review.selectedGroupIds, review.fingerprint); setProposal({ ...proposal, status: "applied" }); setReview(null); resetPreview(); setNotice("Selected changes applied as draft versions. Ordinary approval remains required; remaining groups were not applied."); await refreshHistory(conversationId); await onApplied(); })}>Apply selected editing changes</button>
      </section>}
    </section>}
    <section className="brief-section"><h2>Conversation history</h2>{history?.proposals.map((p) => <div className="bootstrap-detail" key={p.id}><span>{p.status} / {p.summary}</span> <button disabled={busy} onClick={() => void act(async () => openProposal(await api.proposal(p.id)))}>Open saved proposal</button></div>)}
      <details><summary>Recent messages</summary>{history?.messages.map((m) => <p key={m.id}><strong>{m.role}</strong>: {m.content}</p>)}</details>
    </section>
  </section>;
}
