import { useEffect, useRef, useState } from "react";
import {
  applySetup, askSetup, draftSetup, loadSetupSession, previewSetup, rejectSetup, reviseSetup,
  saveSetupMessage, startSetupSession, type SetupChange, type SetupPreview, type SetupSession,
} from "../../api/project-setup.js";

const display = (value: unknown): string => {
  if (value === null || value === undefined) return "Not set";
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value.join(", ") || "None";
  if (typeof value === "object") {
    const item = value as Record<string, unknown>;
    return [item.name ?? item.label ?? item.question, item.summary, item.currentState, item.plannedArc]
      .filter((field) => typeof field === "string" && field).join("\n") || JSON.stringify(value, null, 2);
  }
  return String(value);
};

function ValueEditor({ change, value, onChange }: { change: SetupChange; value: unknown; onChange: (value: unknown) => void }) {
  if (typeof value === "boolean") return <label><input type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)} />{change.label}</label>;
  if (typeof value === "number") return <label>{change.label}<input type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return <label>{change.label}<textarea value={value.join("\n")} onChange={(event) => onChange(event.target.value.split("\n"))} /></label>;
  if (value && typeof value === "object") return <fieldset><legend>{change.label}</legend>{Object.entries(value).filter(([key, item]) => key !== "id" && typeof item === "string").map(([key, item]) =>
    <label key={key}>{key}<textarea value={String(item)} onChange={(event) => onChange({ ...value, [key]: event.target.value })} /></label>)}</fieldset>;
  return <label>{change.label}<textarea value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} /></label>;
}

export function ProjectSetupWorkspace({ projectId, onApplied }: { projectId: string; onApplied: () => Promise<void> }) {
  const [session, setSession] = useState<SetupSession | null>(null);
  const [content, setContent] = useState("");
  const [model, setModel] = useState("openrouter/auto");
  const [preview, setPreview] = useState<SetupPreview | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [edits, setEdits] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const proposal = session?.proposals.at(-1);
  const refresh = async (conversationId: string) => {
    const loaded = await loadSetupSession(projectId, conversationId);
    setSession(loaded);
    if (loaded.proposals.at(-1)?.id !== session?.proposals.at(-1)?.id || loaded.proposals.at(-1)?.status !== "proposed") {
      setSelected(loaded.proposals.at(-1)?.groups.map((group) => group.id) ?? []);
      setEdits({});
    }
  };
  useEffect(() => {
    let alive = true;
    setSession(null); setPreview(null); setAuthorized(false); setError(""); setStatus("");
    void startSetupSession(projectId).then(async (conversation) => {
      const loaded = await loadSetupSession(projectId, conversation.id);
      if (alive) { setSession(loaded); setSelected(loaded.proposals.at(-1)?.groups.map((group) => group.id) ?? []); }
    }).catch((failure: Error) => { if (alive) setError(failure.message); });
    return () => { alive = false; controller.current?.abort(); };
  }, [projectId]);
  const run = async (action: (signal: AbortSignal) => Promise<void>) => {
    if (!session || busy) return;
    setBusy(true); setError(""); setStatus("");
    const active = new AbortController(); controller.current = active;
    try { await action(active.signal); }
    catch (failure) { setError(active.signal.aborted ? "Request cancelled. Your saved ideas remain; retry when ready." : (failure as Error).message); }
    finally {
      if (controller.current === active) controller.current = null;
      try { await refresh(session.conversation.id); } catch (failure) { setError((failure as Error).message); }
      setBusy(false);
    }
  };
  const stalePreview = () => { setPreview(null); setAuthorized(false); };
  return <section className="setup-workspace" aria-labelledby="setup-heading">
    <header><h1 id="setup-heading">Talk it through</h1><p>Draft foundations only. Nothing is applied or approved without your review.</p></header>
    <div role="status" aria-live="polite">{busy ? "Studio is working…" : status}</div>
    {error && <p role="alert" className="error">{error}</p>}
    {!session ? <p>Loading setup…</p> : <>
      <div className="setup-columns">
        <section aria-label="Setup conversation">
          {session.messagesTruncated && <p>Showing the latest {session.messages.length} of {session.messageCount} messages.</p>}
          <ol className="setup-messages">{session.messages.map((message) => <li key={message.id}>
            <strong>{message.role === "user" ? "You" : "Studio"}</strong><p>{message.content}</p>
          </li>)}</ol>
          <label>Your idea or clarification<textarea ref={composer} disabled={busy} value={content} maxLength={16000} rows={5} onChange={(event) => setContent(event.target.value)} /></label>
          <div className="artifact-actions">
            <button disabled={busy || !content.trim()} onClick={() => void run(async () => {
              await saveSetupMessage(projectId, session.conversation.id, content); setContent(""); stalePreview(); setStatus("Idea saved. Project drafts are unchanged.");
            })}>Save idea</button>
            <button disabled={busy || !session.messages.some((message) => message.role === "user") || Boolean(content.trim())} onClick={() => void run(async (signal) => {
              stalePreview(); await askSetup(projectId, session.conversation.id, model, signal); setStatus("Understanding updated. Project drafts are unchanged.");
            })}>Ask Studio</button>
            {busy && <button onClick={() => controller.current?.abort()}>Cancel request</button>}
          </div>
        </section>
        <section aria-labelledby="setup-understanding-heading">
          <h2 id="setup-understanding-heading">What Studio understands</h2>
          {session.understanding ? <>
            {session.understanding.stale && <p>New ideas saved. Ask Studio to update this earlier understanding.</p>}
            <p>{session.understanding.understanding.summary}</p>
            <ul>{session.understanding.understanding.items.map((item) => <li key={item.id}>{item.statement} <small>{item.basis === "stated" ? "From your words" : "Proposed interpretation"}</small>
              {item.excerpt && <details><summary>Why</summary><blockquote>{item.excerpt}</blockquote></details>}</li>)}</ul>
            <h3>Still open</h3><ul>{session.understanding.understanding.unresolved.map((item) => <li key={item.id}>{item.note}</li>)}</ul>
            {session.understanding.questions.map((question) => <div key={question.id}><p><strong>{question.question}</strong></p><p>{question.why}</p></div>)}
            {!session.understanding.stale && <p>{session.understanding.readiness === "ready-to-propose" ? "Ready for a draft proposal" : "More detail would help"}</p>}
          </> : <p>Waiting for your idea.</p>}
        </section>
      </div>
      <section aria-labelledby="setup-proposal-heading">
        <h2 id="setup-proposal-heading">Draft foundations</h2>
        <details><summary>Provider and context</summary><label>Model<input value={model} disabled={busy} onChange={(event) => { setModel(event.target.value); stalePreview(); }} /></label>
          {preview && <pre>{JSON.stringify(preview.diagnostics, null, 2)}</pre>}
        </details>
        <button disabled={busy || Boolean(content.trim()) || !session.understanding || session.understanding.stale || session.understanding.readiness !== "ready-to-propose"} onClick={() => void run(async () => {
          setPreview(await previewSetup(projectId, session.conversation.id, model)); setAuthorized(false);
        })}>Preview proposal context</button>
        {preview && <div className="setup-authorization">
          <p>Model: {preview.provider.model}. Input: {preview.diagnostics.serializedBytes.toLocaleString()} bytes. Estimated input tokens: {preview.diagnostics.estimatedInputTokens}. Cost unavailable.</p>
          <p>Creates reviewable Brief, Creative Direction and Bible candidates. No passages. No approvals.</p>
          <label><input type="checkbox" checked={authorized} disabled={busy} onChange={(event) => setAuthorized(event.target.checked)} />Authorize this exact proposal request</label>
          <button disabled={busy || !authorized || !preview.ready || !preview.withinLimits} onClick={() => void run(async (signal) => {
            const approvedPreview = preview; stalePreview(); await draftSetup(projectId, session.conversation.id, approvedPreview, signal); setStatus("Proposal ready for review.");
          })}>Draft foundation proposal</button>
        </div>}
        {proposal && <section aria-label="Foundation proposal">
          <h3>{proposal.summary}</h3><p>Status: {proposal.status}</p>
          {proposal.validationFindings.map((finding, index) => <p key={index}>{finding.severity}: {finding.message}</p>)}
          {proposal.groups.map((group) => <article className="setup-proposal-group" key={group.id}>
            <label><input type="checkbox" checked={selected.includes(group.id)} disabled={busy || proposal.status !== "proposed"} onChange={(event) => {
              if (event.target.checked) setSelected([...new Set([...selected, group.id, ...group.dependsOnGroupIds])]);
              else setSelected(selected.filter((id) => id !== group.id && !proposal.groups.find((item) => item.id === id)?.dependsOnGroupIds.includes(group.id)));
            }} />{group.label}</label><p>{group.summary}</p>
            {group.dependsOnGroupIds.length > 0 && <small>Requires: {group.dependsOnGroupIds.map((id) => proposal.groups.find((item) => item.id === id)?.label).join(", ")}</small>}
            <details><summary>Review {group.changes.length} proposed fields</summary><dl>{group.changes.map((change) => <div key={change.path}><dt>{change.label}</dt><dd>
              <p className="setup-value">{display(change.after)}</p><small>{change.basis === "stated" ? "From your words" : "Proposed interpretation"}</small>
              <details><summary>Why and previous value</summary><blockquote>{change.excerpt || "Studio interpretation; not an author decision."}</blockquote><pre>{display(change.before)}</pre></details>
              {proposal.status === "proposed" && <details><summary>Edit proposed value</summary><ValueEditor change={change} value={edits[`${group.id}:${change.path}`] ?? change.after} onChange={(value) => setEdits({ ...edits, [`${group.id}:${change.path}`]: value })} /></details>}
            </dd></div>)}</dl></details>
            <details><summary>Full draft candidate and retained defaults</summary><pre>{JSON.stringify(group.candidate, null, 2)}</pre></details>
          </article>)}
          {proposal.status === "proposed" && <div className="artifact-actions">
            <button disabled={busy || !Object.keys(edits).length} onClick={() => void run(async () => {
              await reviseSetup(projectId, session.conversation.id, proposal.id, Object.entries(edits).map(([key, value]) => {
                const separator = key.indexOf(":"); return { groupId: key.slice(0, separator), path: key.slice(separator + 1), value };
              })); stalePreview(); setStatus("Edited proposal saved for review. Project drafts are unchanged.");
            })}>Save edits for review</button>
            <button disabled={busy || !selected.length || Object.keys(edits).length > 0} onClick={() => void run(async () => {
              await applySetup(projectId, session.conversation.id, proposal.id, selected); stalePreview(); await onApplied(); setStatus("Selected foundations applied as drafts, not approved. No passages generated.");
            })}>Apply selected foundations</button>
            <button disabled={busy} onClick={() => void run(async () => { await rejectSetup(projectId, session.conversation.id, proposal.id); stalePreview(); setStatus("Proposal rejected. Project drafts are unchanged."); })}>Reject proposal</button>
            <button disabled={busy} onClick={() => composer.current?.focus()}>Continue discussing</button>
          </div>}
        </section>}
      </section>
    </>}
  </section>;
}
