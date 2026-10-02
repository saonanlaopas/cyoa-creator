import { useEffect, useMemo, useState } from "react";
import { SOURCE_CATEGORIES, type SourceEvidence, type SourceCorrectionOperation } from "@story-to-cyoa/domain";
import { SourceAnalysisApi, type SourceMetadata, type SourcePreview, type AnalysisJob, type DossierMetadata, type RecordSummary, type RecordDetails } from "../../api/source-analysis.js";

export function SourceAnalysisWorkspace({ projectId }: { projectId: string }) {
  const api = useMemo(() => new SourceAnalysisApi(projectId), [projectId]);
  const [source, setSource] = useState<SourceMetadata | null>(null), [chapterOffset, setChapterOffset] = useState(0);
  const [selected, setSelected] = useState<string[]>([]), [pasted, setPasted] = useState("");
  const [providerId, setProvider] = useState("offline-source-analysis"), [modelId, setModel] = useState("offline-source-v1");
  const [preview, setPreview] = useState<SourcePreview | null>(null), [authorized, setAuthorized] = useState(false);
  const [job, setJob] = useState<AnalysisJob | null>(null), [unitOffset, setUnitOffset] = useState(0);
  const [jobs, setJobs] = useState<Array<{ id: string; status: string }>>([]);
  const [dossier, setDossier] = useState<DossierMetadata | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [category, setCategory] = useState(""), [search, setSearch] = useState(""), [conflictsOnly, setConflictsOnly] = useState(false), [recordOffset, setRecordOffset] = useState(0);
  const [records, setRecords] = useState<RecordSummary[]>([]), [recordTotal, setRecordTotal] = useState(0);
  const [record, setRecord] = useState<RecordDetails | null>(null), [evidenceOffset, setEvidenceOffset] = useState(0);
  const [evidence, setEvidence] = useState<{ reference: SourceEvidence; text: string } | null>(null);
  const [history, setHistory] = useState<Array<{ id: string; version: number; correctionCount: number }>>([]), [historyId, setHistoryId] = useState("");
  const [historyOffset, setHistoryOffset] = useState(0), [historyTotal, setHistoryTotal] = useState(0);
  const [comparison, setComparison] = useState<{ materialEqual: boolean; provenanceEqual: boolean; changedRecordIds: string[] } | null>(null);
  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setMessage("");
    try { await action(); } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  };
  const refreshDossier = async () => {
    try {
      const next = await api.dossier(); setDossier(next);
      const history = await api.request<{ items: Array<{ id: string; version: number; correctionCount: number }>; total: number }>(`/history?offset=${historyOffset}`);
      setHistory(history.items); setHistoryTotal(history.total);
    } catch (error) {
      if ((error as { status?: number }).status !== 404) throw error;
      setDossier(null);
    }
  };
  const refreshSource = async () => {
    const next = await api.source(chapterOffset); setSource(next); setSelected(next.scope?.chapterIds ?? []);
  };
  useEffect(() => {
    let cancelled = false;
    void Promise.all([api.source(), api.jobs()]).then(async ([source, jobs]) => {
      if (cancelled) return;
      setSource(source); setSelected(source.scope?.chapterIds ?? []); setJobs(jobs.items);
      if (jobs.items[0]) setJob(await api.job(jobs.items[0].id));
      await refreshDossier();
    }).catch((error: Error) => { if (!cancelled) setMessage(error.message); });
    return () => { cancelled = true; };
  }, [api]);
  useEffect(() => { void api.source(chapterOffset).then(setSource).catch((e: Error) => setMessage(e.message)); }, [api, chapterOffset]);
  useEffect(() => {
    if (!job?.executing) return;
    let cancelled = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api.job(job.id, unitOffset);
        if (cancelled) return;
        setJob(next);
        if (!next.executing) { await refreshDossier(); setJobs((await api.jobs()).items); }
        else timer = setTimeout(() => void poll(), 400);
      } catch (e) { if (!cancelled) setMessage((e as Error).message); }
    };
    timer = setTimeout(() => void poll(), 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [api, job?.id, job?.executing, unitOffset]);
  useEffect(() => {
    if (!dossier) { setRecords([]); return; }
    let cancelled = false;
    const timer = setTimeout(() => void api.records({ category, search, conflictsOnly, offset: recordOffset }).then((result) => {
      if (!cancelled) { setRecords(result.items); setRecordTotal(result.total); }
    }).catch((e: Error) => { if (!cancelled) setMessage(e.message); }), 150);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [api, dossier?.id, category, search, conflictsOnly, recordOffset]);
  useEffect(() => {
    if (!dossier) return;
    void api.request<{ items: typeof history; total: number }>(`/history?offset=${historyOffset}`).then((result) => { setHistory(result.items); setHistoryTotal(result.total); }).catch((e: Error) => setMessage(e.message));
  }, [api, dossier?.id, historyOffset]);
  const invalidatePreview = () => { setPreview(null); setAuthorized(false); };
  const scopeDirty = Boolean(source?.scope && JSON.stringify([...selected].sort()) !== JSON.stringify([...source.scope.chapterIds].sort()));
  const saveScope = async (value: { entireWork: true } | { chapterIds: string[] }) => {
    await api.scope(value); invalidatePreview(); await refreshSource(); await refreshDossier(); setMessage("Source scope saved.");
  };
  const importResponse = async (response: Response) => {
    if (!response.ok) throw new Error(((await response.json()) as { error: string }).error);
    await response.json(); invalidatePreview(); setSelected([]); await refreshSource(); await refreshDossier(); setMessage("Source imported. Select its scope.");
  };
  const selectRecord = async (id: string, offset = 0) => { setRecord(await api.record(id, offset)); setEvidenceOffset(offset); setEvidence(null); };
  return <section className="source-analysis-workspace" aria-label="Source analysis">
    <header className="workspace-heading"><div><p className="eyebrow">Supplied story</p><h2>Source analysis</h2></div>
      {dossier && <span className={`status ${dossier.workflow.status === "approved" ? "good" : ""}`}>Dossier v{dossier.version}: {dossier.stale ? "stale" : dossier.workflow.status}</span>}
    </header>
    {message && <p role="status" className="status">{message}</p>}
    <section className="source-analysis-band" aria-label="Import and scope">
      <h3>Import story</h3>
      <label>Story file (TXT, HTML, EPUB)<input type="file" accept=".txt,.html,.htm,.epub" disabled={busy} onChange={(event) => {
        const file = event.target.files?.[0]; if (!file) return;
        void perform(async () => { const form = new FormData(); form.append("file", file); await importResponse(await fetch(`/api/projects/${projectId}/source`, { method: "POST", body: form })); });
        event.target.value = "";
      }} /></label>
      <details><summary>Paste source text</summary><label>Source manuscript<textarea rows={6} value={pasted} onChange={(e) => setPasted(e.target.value)} /></label>
        <button disabled={busy || !pasted.trim()} onClick={() => void perform(async () => {
          await importResponse(await fetch(`/api/projects/${projectId}/source/text`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: pasted }) })); setPasted("");
        })}>Import pasted story</button></details>
      {source?.sourceVersionId && <>
        <h3>{source.metadata?.title ?? "Imported story"}</h3>
        <p>{source.chapterCount} chapters. Selected scope: {source.scope?.chapterIds.length ?? 0} chapters.</p>
        <fieldset><legend>Chapters to analyze</legend><div className="source-chapters">
          {source.chapters.map((chapter) => <label key={chapter.id}><input type="checkbox" checked={selected.includes(chapter.id)} onChange={(e) => {
            setSelected((ids) => e.target.checked ? [...ids, chapter.id] : ids.filter((id) => id !== chapter.id)); invalidatePreview();
          }} />{chapter.title}<span>{chapter.characters.toLocaleString()} characters</span></label>)}
        </div></fieldset>
        <PageControls offset={chapterOffset} total={source.chapterCount} step={50} onChange={setChapterOffset} label="Chapter pages" />
        <div className="source-actions"><button disabled={busy || !selected.length} onClick={() => void perform(() => saveScope({ chapterIds: selected }))}>Save selected scope</button>
          <button disabled={busy} onClick={() => void perform(() => saveScope({ entireWork: true }))}>Select entire work</button></div>
      </>}
    </section>
    <section className="source-analysis-band" aria-label="Analysis request">
      <h3>Analysis request</h3>
      <div className="source-actions"><label>Provider<select value={providerId} onChange={(e) => { setProvider(e.target.value); setModel(e.target.value === "offline-source-analysis" ? "offline-source-v1" : ""); invalidatePreview(); }}>
        <option value="offline-source-analysis">Offline fixture</option><option value="openrouter-source-analysis">OpenRouter</option></select></label>
        <label>Model<input value={modelId} disabled={providerId === "offline-source-analysis"} onChange={(e) => { setModel(e.target.value); invalidatePreview(); }} /></label>
        <button disabled={busy || !source?.scope || scopeDirty || !modelId} onClick={() => void perform(async () => { setPreview(await api.preview(providerId, modelId)); setAuthorized(false); })}>Preview analysis</button></div>
      {preview && <div className="analysis-preview" role="region" aria-label="Analysis preview">
        <dl className="source-metrics"><div><dt>Source</dt><dd>{preview.sourceCharacters.toLocaleString()} characters / {preview.sourceBytes.toLocaleString()} bytes</dd></div>
          <div><dt>Selected scope</dt><dd>{preview.selectedChapters} chapters</dd></div><div><dt>Units</dt><dd>{preview.unitCount}; at most {preview.maxUnitCharacters} source characters each</dd></div>
          <div><dt>Input estimate</dt><dd>About {preview.estimatedInputTokens.toLocaleString()} tokens (heuristic)</dd></div><div><dt>Output limit</dt><dd>{preview.maximumOutputTokensPerUnit} tokens per unit</dd></div>
          <div><dt>Provider / model</dt><dd>{preview.providerId} / {preview.modelId}</dd></div><div><dt>Cost</dt><dd>{preview.cost === null ? "Unknown" : "$0.00 (offline)"}</dd></div></dl>
        <label className="source-check"><input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} />Authorize this exact source-analysis request</label>
        <button className="primary" disabled={busy || !authorized || Boolean(job?.executing)} onClick={() => void perform(async () => { setJob(await api.start(preview)); setAuthorized(false); setUnitOffset(0); setMessage("Analysis started."); })}>Start source analysis</button>
      </div>}
      {jobs.length > 0 && <label>Analysis history<select value={job?.id ?? ""} onChange={(e) => void perform(async () => { setJob(await api.job(e.target.value)); setUnitOffset(0); })}>
        {jobs.map((j, index) => <option value={j.id} key={j.id}>Run {jobs.length - index}: {j.status}</option>)}</select></label>}
      {job && <div className="source-progress" aria-label="Analysis progress">
        <p role="status">{job.counts.completed} / {job.unitCount} units complete. {job.executing ? "Running" : job.status}.</p>
        <progress value={job.counts.completed} max={job.unitCount} aria-label="Analysis completion" />
        <div className="source-actions"><button disabled={busy || job.executing || !["pending", "failed"].includes(job.status)} onClick={() => void perform(async () => { setJob(await api.action(job.id, "resume")); setMessage("Analysis resumed."); })}>Resume / retry analysis</button>
          <button disabled={busy || ["completed", "cancelled"].includes(job.status)} onClick={() => void perform(async () => { setJob(await api.action(job.id, "cancel")); setMessage("Analysis cancelled."); })}>Cancel analysis</button></div>
        <details><summary>Unit audit</summary><table><thead><tr><th>Unit</th><th>Status</th><th>Attempts</th><th>Diagnostic</th></tr></thead><tbody>
          {job.units.map((u, i) => <tr key={u.id}><td>{unitOffset + i + 1}</td><td>{u.status}</td><td>{u.attempts.length}</td><td>{u.attempts.at(-1)?.diagnostic || "None"}</td></tr>)}
        </tbody></table><PageControls offset={unitOffset} total={job.unitCount} step={50} label="Unit pages" onChange={(offset) => {
          setUnitOffset(offset); void api.job(job.id, offset).then(setJob).catch((e: Error) => setMessage(e.message));
        }} /></details>
      </div>}
    </section>
    {dossier && <section className="source-analysis-band" aria-label="Source Dossier review">
      <header className="workspace-heading"><div><h3>Source Dossier</h3><p>{dossier.recordCount} records; {dossier.conflictCount} identity ambiguities / contradictions; {dossier.correctionCount} corrections.</p></div>
        <div className="source-actions"><a href={`${api.root}/export`} download>Export dossier JSON</a><button disabled={busy || dossier.stale || dossier.workflow.status === "approved"} onClick={() => void perform(async () => { await api.approve(dossier.id); await refreshDossier(); setMessage("Source Dossier approved."); })}>Approve dossier</button></div></header>
      <div className="source-filters"><label>Category<select aria-label="Category" value={category} onChange={(e) => { setCategory(e.target.value); setRecordOffset(0); setRecord(null); }}><option value="">All categories</option>
        {SOURCE_CATEGORIES.map((c) => <option key={c} value={c}>{c} ({dossier.categories[c] ?? 0})</option>)}</select></label>
        <label>Identity or claim<input type="search" value={search} onChange={(e) => { setSearch(e.target.value); setRecordOffset(0); }} /></label>
        <label className="source-check"><input type="checkbox" checked={conflictsOnly} onChange={(e) => { setConflictsOnly(e.target.checked); setRecordOffset(0); }} />Ambiguities and contradictions</label></div>
      <div className="source-review-layout"><div className="source-record-list" role="region" aria-label="Dossier records">
        {records.map((r) => <button key={r.id} className={record?.id === r.id ? "selected" : ""} aria-pressed={record?.id === r.id} onClick={() => void perform(() => selectRecord(r.id))}>
          <strong>{r.identityKey}: {r.field}</strong><span>{r.claim}</span><small>{r.classification} / {r.status} / {r.evidenceCount} evidence references</small></button>)}
        {!records.length && <p>No matching records.</p>}
        <PageControls offset={recordOffset} total={recordTotal} step={50} label="Record pages" onChange={setRecordOffset} />
      </div>
      <div className="source-record-detail" role="region" aria-label="Selected dossier record">
        {record ? <>
          <h4>{record.identityKey}: {record.field}</h4><p>{record.claim}</p><p>{record.classification}; {record.status}</p>
          {record.uncertainty && <p>{record.uncertainty}</p>}
          {record.conflicts.map((conflict) => <p key={conflict.id} className="status">{conflict.kind}: {conflict.reason}</p>)}
          <h4>Source evidence</h4><ol>{record.evidence.map((ref, i) => <li key={`${ref.excerptId}:${ref.start}:${ref.end}`}>
            <button onClick={() => void perform(async () => setEvidence(await api.evidence(ref)))}>Why? Evidence {evidenceOffset + i + 1}</button>
          </li>)}</ol>
          <PageControls offset={evidenceOffset} total={record.evidenceCount} step={20} label="Evidence pages" onChange={(offset) => void perform(() => selectRecord(record.id, offset))} />
          {evidence && <blockquote className="source-evidence" aria-label="Source excerpt">{evidence.text}</blockquote>}
          <SourceCorrectionForm key={`${record.id}:${dossier.id}`} record={record} dossier={dossier} records={records} api={api} busy={busy || dossier.stale}
            onApply={(operation) => perform(async () => { setDossier(await api.correct(operation)); setRecord(null); setEvidence(null); await refreshDossier(); setMessage("Analysis correction saved as a new dossier draft."); })} />
          <details><summary>Original observations ({record.observationIds.length} shown)</summary>
            {record.originals.map((p) => <article key={p.observationId}><h5>{p.original.identityKey}: {p.original.field}</h5><p>{p.original.claim}</p><p>{p.original.classification}; {p.providerId} / {p.modelId}</p></article>)}
          </details>
          <details><summary>Correction audit ({dossier.correctionCount})</summary>{record.corrections.map((c) => <p key={c.id}>{c.kind}: {c.reason}</p>)}</details>
        </> : <p>Select a record.</p>}
      </div></div>
      <details><summary>Dossier version history ({historyTotal})</summary><div className="source-actions"><label>Historical version<select aria-label="Historical version" value={historyId} onChange={(e) => setHistoryId(e.target.value)}><option value="">Select version</option>
        {history.map((v) => <option key={v.id} value={v.id}>v{v.version} / {v.correctionCount} corrections</option>)}</select></label>
        <button disabled={busy || !historyId} onClick={() => void perform(async () => setComparison(await api.request("/compare", { from: historyId, to: dossier.id })))}>Compare with current</button>
        <button disabled={busy || !historyId || historyId === dossier.id} onClick={() => void perform(async () => { await api.request("/restore", { versionId: historyId }); setRecord(null); await refreshDossier(); setMessage("Historical dossier restored as a new draft."); })}>Restore as draft</button></div>
        <PageControls offset={historyOffset} total={historyTotal} step={50} label="Dossier history pages" onChange={(offset) => { setHistoryOffset(offset); setHistoryId(""); }} />
        {comparison && <p>{comparison.materialEqual ? "Material unchanged" : `Material changed (${comparison.changedRecordIds.length} records)`}; {comparison.provenanceEqual ? "audit unchanged" : "audit changed"}.</p>}</details>
    </section>}
  </section>;
}

function PageControls({ offset, total, step, onChange, label }: { offset: number; total: number; step: number; onChange(offset: number): void; label: string }) {
  if (total <= step) return null;
  return <nav className="source-actions" aria-label={label}><button disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - step))}>Previous</button>
    <span>{offset + 1}-{Math.min(total, offset + step)} of {total}</span><button disabled={offset + step >= total} onClick={() => onChange(offset + step)}>Next</button></nav>;
}

function SourceCorrectionForm({ record, dossier, records, api, busy, onApply }: { record: RecordDetails; dossier: DossierMetadata; records: RecordSummary[]; api: SourceAnalysisApi; busy: boolean; onApply(operation: SourceCorrectionOperation): Promise<void> }) {
  const [kind, setKind] = useState<SourceCorrectionOperation["kind"]>("field"), [reason, setReason] = useState(""), [confirmed, setConfirmed] = useState(false);
  const [claim, setClaim] = useState(record.claim), [identityKey, setIdentity] = useState(record.identityKey), [field, setField] = useState(record.field);
  const [classification, setClassification] = useState(record.classification), [mergeTarget, setMergeTarget] = useState("");
  const [selectedEvidence, setSelectedEvidence] = useState<SourceEvidence[]>(record.evidence), [completeEvidence, setCompleteEvidence] = useState(record.evidence);
  const [loadingEvidence, setLoadingEvidence] = useState(record.evidenceCount > record.evidence.length), [correctionEvidenceOffset, setCorrectionEvidenceOffset] = useState(0);
  const [options, setOptions] = useState<Array<{ reference: SourceEvidence; label: string }>>([]), [optionTotal, setOptionTotal] = useState(0), [optionOffset, setOptionOffset] = useState(0), [optionSearch, setOptionSearch] = useState(""), [chosenOption, setChosenOption] = useState("");
  const [children, setChildren] = useState([{ id: `${record.id}.a`, identityKey: record.identityKey, claim: record.claim }, { id: `${record.id}.b`, identityKey: "", claim: "" }]);
  const [assignments, setAssignments] = useState<Record<string, string>>({}), [partitions, setPartitions] = useState<Record<number, string>>({});
  const [dependents, setDependents] = useState<RecordSummary[]>([]), [error, setError] = useState("");
  const [dependentOffset, setDependentOffset] = useState(0), [loadingDependents, setLoadingDependents] = useState(false);
  const [identityMatches, setIdentityMatches] = useState<RecordSummary[]>(records.filter((r) => r.category === "character" && r.id !== record.id));
  const [mergeSearch, setMergeSearch] = useState("");
  const [open, setOpen] = useState(false), [evidenceRetry, setEvidenceRetry] = useState(0);
  useEffect(() => {
    if (!open || record.evidenceCount <= completeEvidence.length) return;
    let cancelled = false;
    setLoadingEvidence(true);
    void (async () => {
      const evidence: SourceEvidence[] = [];
      for (let offset = 0; offset < record.evidenceCount; offset += 20) evidence.push(...(await api.record(record.id, offset)).evidence);
      if (!cancelled) { setCompleteEvidence(evidence); setSelectedEvidence(evidence); setLoadingEvidence(false); }
    })().catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [api, record.id, open, evidenceRetry]);
  useEffect(() => {
    if (kind !== "evidence") return;
    void api.request<{ total: number; items: typeof options }>(`/evidence/options?offset=${optionOffset}&search=${encodeURIComponent(optionSearch)}`).then((result) => { setOptions(result.items); setOptionTotal(result.total); setChosenOption(""); }).catch((e: Error) => setError(e.message));
  }, [kind, optionOffset, optionSearch, api]);
  useEffect(() => {
    if (kind !== "merge") return;
    void api.records({ category: "character", search: mergeSearch, conflictsOnly: false, offset: 0 }).then((result) => setIdentityMatches(result.items.filter((r) => r.id !== record.id && r.status === "supported" && r.field === "identity"))).catch((e: Error) => setError(e.message));
  }, [kind, mergeSearch, api, record.id]);
  useEffect(() => {
    if (kind !== "split") return;
    let cancelled = false;
    setLoadingDependents(true);
    // Explicitly enumerate dependent metadata across pages before offering assignments, never guess identity.
    void (async () => {
      let offset = 0, all: RecordSummary[] = [];
      while (true) {
        const result = await api.records({ category: "", search: "", conflictsOnly: false, offset });
        all = [...all, ...result.items.filter((r) => r.references.includes(record.id))];
        offset += result.items.length;
        if (offset >= result.total || !result.items.length) break;
      }
      if (!cancelled) { setDependents(all); setLoadingDependents(false); }
    })().catch((e: Error) => setError(e.message));
    return () => { cancelled = true; };
  }, [kind, api, record.id]);
  const submit = async () => {
    setError("");
    try {
      const common = { intent: "source-analysis-correction" as const, reason, previousVersionId: dossier.id };
      let operation: SourceCorrectionOperation;
      if (kind === "merge") operation = { ...common, kind, recordIds: [record.id, mergeTarget], targetId: record.id };
      else if (kind === "split") operation = { ...common, kind, recordId: record.id,
        children: children.map((child) => ({ ...child, evidence: completeEvidence.filter((_, i) => partitions[i] === child.id || partitions[i] === "both") })),
        assignments: dependents.map((r) => ({ recordId: r.id, replacementIds: assignments[r.id] === "both" ? children.map((c) => c.id) : [assignments[r.id] ?? ""] })) };
      else if (kind === "reject") operation = { ...common, kind, recordId: record.id };
      else if (kind === "classification") operation = { ...common, kind, recordId: record.id, classification, evidence: selectedEvidence };
      else if (kind === "evidence") operation = { ...common, kind, recordId: record.id, evidence: selectedEvidence };
      else operation = { ...common, kind, recordId: record.id, changes: { claim, identityKey, field }, evidence: selectedEvidence };
      await onApply(operation);
    } catch (error) { setError((error as Error).message); }
  };
  return <details className="source-correction" onToggle={(event) => setOpen(event.currentTarget.open)}><summary>Correct source analysis</summary>
    <label>Review action<select aria-label="Review action" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
      <option value="field">Correct field</option><option value="merge">Merge identities</option><option value="split">Split identity</option><option value="reject">Reject as unsupported</option><option value="evidence">Repair evidence</option><option value="classification">Change canon / inference</option></select></label>
    {kind === "field" && <><label>Identity<input value={identityKey} onChange={(e) => setIdentity(e.target.value)} /></label><label>Field<input value={field} onChange={(e) => setField(e.target.value)} /></label><label>Corrected source claim<textarea value={claim} onChange={(e) => setClaim(e.target.value)} /></label></>}
    {kind === "classification" && <label>Classification<select aria-label="Classification" value={classification} onChange={(e) => setClassification(e.target.value as typeof classification)}><option value="source-canon">Source canon</option><option value="inference">Inference</option></select></label>}
    {kind === "merge" && <><label>Find identity<input type="search" value={mergeSearch} onChange={(e) => setMergeSearch(e.target.value)} /></label><label>Identity to merge into this record<select aria-label="Identity to merge into this record" value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)}><option value="">Select identity</option>{identityMatches.map((r) => <option key={r.id} value={r.id}>{r.identityKey}: {r.field}</option>)}</select></label></>}
    {kind === "split" && <>
      {children.map((child, i) => <fieldset key={child.id}><legend>Resulting identity {i + 1}</legend><label>Name<input value={child.identityKey} onChange={(e) => setChildren((items) => items.map((c, index) => index === i ? { ...c, identityKey: e.target.value } : c))} /></label>
        <label>Source identity claim<input value={child.claim} onChange={(e) => setChildren((items) => items.map((c, index) => index === i ? { ...c, claim: e.target.value } : c))} /></label></fieldset>)}
      {completeEvidence.slice(correctionEvidenceOffset, correctionEvidenceOffset + 20).map((_, index) => { const i = correctionEvidenceOffset + index; return <label key={i}>Evidence {i + 1} belongs to<select value={partitions[i] ?? ""} onChange={(e) => setPartitions((values) => ({ ...values, [i]: e.target.value }))}><option value="">Assign evidence</option>{children.map((c) => <option key={c.id} value={c.id}>{c.identityKey || c.id}</option>)}<option value="both">Both identities</option></select></label>; })}
      <PageControls offset={correctionEvidenceOffset} total={completeEvidence.length} step={20} onChange={setCorrectionEvidenceOffset} label="Split evidence pages" />
      {dependents.slice(dependentOffset, dependentOffset + 20).map((r) => <label key={r.id}>{r.identityKey}: {r.field} refers to<select value={assignments[r.id] ?? ""} onChange={(e) => setAssignments((values) => ({ ...values, [r.id]: e.target.value }))}><option value="">Assign dependent</option>{children.map((c) => <option key={c.id} value={c.id}>{c.identityKey || c.id}</option>)}<option value="both">Both identities</option></select></label>)}
      <PageControls offset={dependentOffset} total={dependents.length} step={20} onChange={setDependentOffset} label="Dependent assignment pages" />
    </>}
    {["field", "classification", "evidence"].includes(kind) && <fieldset><legend>Supporting source evidence</legend>
      {selectedEvidence.slice(correctionEvidenceOffset, correctionEvidenceOffset + 20).map((ref, index) => { const i = correctionEvidenceOffset + index; return <label key={`${ref.excerptId}:${ref.start}:${i}`} className="source-check"><input type="checkbox" checked onChange={() => setSelectedEvidence((values) => values.filter((_, index) => index !== i))} />Evidence {i + 1}, characters {ref.start}-{ref.end}</label>; })}
      <PageControls offset={correctionEvidenceOffset} total={selectedEvidence.length} step={20} onChange={setCorrectionEvidenceOffset} label="Correction evidence pages" />
      {kind === "evidence" && <details><summary>Add exact source evidence</summary><label>Find chapter or excerpt<input type="search" value={optionSearch} onChange={(e) => { setOptionSearch(e.target.value); setOptionOffset(0); }} /></label>
        <label>Source excerpt<select value={chosenOption} onChange={(e) => setChosenOption(e.target.value)}><option value="">Select evidence</option>{options.map((item, i) => <option key={i} value={String(i)}>{item.label}</option>)}</select></label>
        <PageControls offset={optionOffset} total={optionTotal} step={50} onChange={setOptionOffset} label="Available evidence pages" />
        <button type="button" disabled={!chosenOption || busy} onClick={async () => {
          const ref = options[Number(chosenOption)]!.reference;
          try { await api.evidence(ref); setSelectedEvidence((values) => values.some((v) => JSON.stringify(v) === JSON.stringify(ref)) ? values : [...values, ref]); } catch (e) { setError((e as Error).message); }
        }}>Validate and add evidence</button></details>}
    </fieldset>}
    <label>Correction reason<textarea value={reason} onChange={(e) => setReason(e.target.value)} /></label>
    <label className="source-check"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />I am correcting the source analysis, not choosing changes for an adaptation.</label>
    {error && <p className="error" role="alert">{error}</p>}
    {loadingEvidence && <p role="status">Loading evidence metadata... {error && <button onClick={() => { setError(""); setEvidenceRetry((n) => n + 1); }}>Retry evidence metadata</button>}</p>}
    <button disabled={busy || loadingEvidence || (kind === "split" && loadingDependents) || record.status !== "supported" || !confirmed || !reason.trim()} onClick={() => void submit()}>Save analysis correction</button>
  </details>;
}
