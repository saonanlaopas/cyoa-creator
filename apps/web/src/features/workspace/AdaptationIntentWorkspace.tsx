import { useEffect, useMemo, useRef, useState } from "react";
import { FIDELITY_DIMENSIONS, FIDELITY_LEVELS, FIDELITY_PRESETS, TRANSFORMATIONS, expandFidelityPreset, type AdaptationIntent, type AdaptationSuggestion, type FidelityPreset, type PlannedWords, type SourceRecord } from "@story-to-cyoa/domain";
import { AdaptationIntentApi, type IntentCollection, type IntentHistory, type IntentPreview, type IntentProposal, type IntentState, type IntentItemSummary } from "../../api/adaptation-intent.js";
import { SourceAnalysisApi } from "../../api/source-analysis.js";

const presets: Record<FidelityPreset, string> = { faithful: "Faithful", "meaningful-divergence": "Faithful with meaningful divergence", loose: "Loose adaptation", inspired: "Inspired by source" };
const labels: Record<IntentCollection, string> = { overrides: "Overrides", inventions: "Adaptation-only additions", obligations: "Canon route requested", exceptions: "Reviewed exceptions", expansion: "Expansion" };
const dimensionLabels = { character: "Character fidelity", world: "World / canon fidelity", tone: "Tonal fidelity", structure: "Structural fidelity" };
const list = (value: string) => value.split(",").map((v) => v.trim()).filter(Boolean);
type Item = AdaptationIntent[IntentCollection][number];
export function AdaptationIntentWorkspace({ projectId, onStatusChange }: { projectId: string; onStatusChange?: (status: string) => void }) {
  const api = useMemo(() => new AdaptationIntentApi(projectId), [projectId]), sourceApi = useMemo(() => new SourceAnalysisApi(projectId), [projectId]);
  const [state, setState] = useState<IntentState | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [conflicts, setConflicts] = useState<Array<{ id: string; overrideIds: string[] }>>([]);
  const [tab, setTab] = useState<"fidelity" | IntentCollection | "history" | "director">("fidelity");
  const [preset, setPreset] = useState<FidelityPreset>("meaningful-divergence"), [items, setItems] = useState<IntentItemSummary[]>([]), [total, setTotal] = useState(0), [offset, setOffset] = useState(0), [search, setSearch] = useState("");
  const [sourceSearch, setSourceSearch] = useState(""), [sourceOffset, setSourceOffset] = useState(0), [sourceTotal, setSourceTotal] = useState(0), [sourceRecords, setSourceRecords] = useState<Array<Pick<SourceRecord, "id" | "identityKey" | "field" | "claim" | "classification">>>([]);
  const [selected, setSelected] = useState<SourceRecord[]>([]), [evidence, setEvidence] = useState("");
  const selection = useRef(new Set<string>()), [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editing, setEditing] = useState<Item | null>(null), [history, setHistory] = useState<IntentHistory[]>([]), [historicalId, setHistoricalId] = useState(""), [comparison, setComparison] = useState<{ materialEqual: boolean; provenanceEqual: boolean; changedIds: string[]; dimensions: { from: AdaptationIntent["dimensions"]; to: AdaptationIntent["dimensions"] }; budget: { from: AdaptationIntent["budget"]; to: AdaptationIntent["budget"] } } | null>(null);
  const [request, setRequest] = useState(""), [providerId, setProviderId] = useState("offline-adaptation-intent"), [modelId, setModelId] = useState("offline-a4-v1"), [preview, setPreview] = useState<IntentPreview | null>(null), [authorized, setAuthorized] = useState(false), [proposal, setProposal] = useState<IntentProposal | null>(null);
  const [proposals, setProposals] = useState<Array<{ versionId: string; status: string; request: string }>>([]), [proposalOffset, setProposalOffset] = useState(0);
  const current = state?.current, binding = current?.policy.binding ?? state?.approvedDossier;
  const load = async () => { const next = await api.state(); setState(next); onStatusChange?.(next.workflow.status); return next; };
  const act = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true); setMessage(""); setConflicts([]); try { await action(); await load(); setMessage(success); setPreview(null); setAuthorized(false); } catch (e) { setMessage((e as Error).message); setConflicts((e as { conflicts?: typeof conflicts }).conflicts ?? []); await load().catch(() => {}); } finally { setBusy(false); }
  };
  useEffect(() => { let live = true; void api.state().then((next) => { if (live) { setState(next); onStatusChange?.(next.workflow.status); } }).catch((e: Error) => { if (live) setMessage(e.message); }); return () => { live = false; }; }, [api]);
  useEffect(() => {
    let live = true;
    if (current && tab in labels) void api.collection(tab as IntentCollection, offset, search).then((result) => { if (live) { setItems(result.items); setTotal(result.total); } }).catch((e: Error) => { if (live) setMessage(e.message); });
    if (current && tab === "history") void api.history(offset).then((result) => { if (live) { setHistory(result.items); setTotal(result.total); } });
    return () => { live = false; };
  }, [api, tab, offset, search, current?.id]);
  useEffect(() => {
    let live = true; if (!binding) return;
    void api.request<{ total: number; items: typeof sourceRecords }>(`/source-records?offset=${sourceOffset}&search=${encodeURIComponent(sourceSearch)}`).then((r) => {
      if (live) { setSourceRecords(r.items); setSourceTotal(r.total); }
    }).catch((e: Error) => { if (live) setMessage(e.message); }); return () => { live = false; };
  }, [sourceApi, binding?.dossierVersionId, sourceOffset, sourceSearch]);
  useEffect(() => { let live = true; if (tab === "director") void api.request<{ items: typeof proposals }>(`/proposals?offset=${proposalOffset}`).then((r) => { if (live) setProposals(r.items); }); return () => { live = false; }; }, [api, tab, proposalOffset, proposal?.versionId, current?.id]);
  const selectRecord = async (id: string, checked: boolean) => {
    setPreview(null); setAuthorized(false);
    if (!checked) { selection.current.delete(id); setSelectedIds([...selection.current]); setSelected((v) => v.filter((r) => r.id !== id)); return; }
    if (selection.current.size >= 12 || !binding) return;
    selection.current.add(id); setSelectedIds([...selection.current]);
    try {
      const record = await sourceApi.request<SourceRecord>(`/records/${encodeURIComponent(id)}?versionId=${encodeURIComponent(binding.dossierVersionId)}&limit=1`);
      if (record.status !== "supported") throw new Error("Source target is not supported");
      if (selection.current.has(id)) setSelected((values) => [...values.filter((v) => v.id !== id), record]);
    } catch (error) { selection.current.delete(id); setSelectedIds([...selection.current]); throw error; }
  };
  const sourcePicker = <section className="intent-source" aria-label="Approved source records">
    <h2>Approved source</h2><small>Dossier {binding?.dossierVersionId ?? "not approved"}</small>
    <label>Find source record<input value={sourceSearch} onChange={(e) => { setSourceSearch(e.target.value); setSourceOffset(0); }} /></label>
    <fieldset disabled={!binding || busy}><legend>Source targets</legend>{sourceRecords.map((r) => <label className="intent-check" key={r.id}>
      <input type="checkbox" checked={selectedIds.includes(r.id)} onChange={(e) => void selectRecord(r.id, e.target.checked).catch((error: Error) => setMessage(error.message))} />
      <span>{r.identityKey}: {r.field}<small>{r.classification} · {r.id}</small></span></label>)}</fieldset>
    <Pages offset={sourceOffset} total={sourceTotal} onChange={setSourceOffset} label="Source record pages" />
    <button disabled={busy || !selectedIds.length} onClick={() => { selection.current.clear(); setSelectedIds([]); setSelected([]); setEvidence(""); }}>Clear source selection</button>
    <div className="intent-selected">{selected.map((r) => <article key={r.id}><strong>SOURCE · {r.classification}</strong><p>{r.claim}</p><small>{r.id}</small>
      <button disabled={busy} onClick={() => void sourceApi.evidence(r.evidence[0]!).then((result) => setEvidence(result.text)).catch((e: Error) => setMessage(e.message))}>Why? Source evidence</button></article>)}</div>
    {evidence && <blockquote aria-label="Durable source evidence">{evidence}</blockquote>}
  </section>;
  const changeTab = (next: typeof tab) => { setTab(next); setOffset(0); setSearch(""); setEditing(null); };
  const reviewItem = async (item: IntentItemSummary) => {
    setBusy(true);
    try {
      const detail = await api.request<Item>(`/collections/${tab}/${encodeURIComponent(item.id)}`);
      const targetIds = "targetIds" in detail ? detail.targetIds : "sourceRecordIds" in detail ? detail.sourceRecordIds : [];
      const records = binding ? await Promise.all(targetIds.map((id) => sourceApi.request<SourceRecord>(`/records/${encodeURIComponent(id)}?versionId=${binding.dossierVersionId}&limit=1`))) : [];
      selection.current = new Set(targetIds); setSelectedIds(targetIds); setSelected(records); setEditing(detail);
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  };
  const patch = (changes: Record<string, unknown>, success: string) => act(() => api.edit({ baseVersionId: current!.id, ...changes }), success);
  if (!state) return <section className="adaptation-intent-workspace" aria-label="Adaptation Intent"><h1>Adaptation Intent</h1><p role="status">{message || "Loading"}</p></section>;
  return <section className="adaptation-intent-workspace" aria-label="Adaptation Intent">
    <header className="artifact-header"><div><h1>Adaptation Intent</h1><p role="status">{current ? `Intent v${current.version}: ${state.workflow.status}` : "Not adopted"}</p></div>
      {current && <div className="artifact-actions"><button disabled={busy || current.stale} onClick={() => void act(() => api.request("/validate", {}), "Intent validated.")}>Validate</button>
        <button disabled={busy || current.stale} onClick={() => void act(() => api.request("/review", { versionId: current.id }), "Intent reviewed.")}>Mark reviewed</button>
        <button disabled={busy || current.stale || state.workflow.approvedVersionId === current.id} onClick={() => void act(() => api.request("/approve", { versionId: current.id }), "Adaptation Intent approved.")}>Approve intent</button>
        <a download href={`${api.root}/export`}>Export JSON</a></div>}</header>
    {message && <p role="status" className={message.includes(".") ? "status" : "error"}>{message}</p>}
    {conflicts.length > 0 && <section role="alert" aria-label="Conflicting active overrides"><h2>Conflicting active overrides</h2>{conflicts.map((c) => <p key={c.id}>{c.id}: {c.overrideIds.join(" / ")}</p>)}</section>}
    {current?.stale && <p className="error" role="alert">Exact approved Source Dossier has changed. Historical intent remains readable.</p>}
    {current?.stale && state.approvedDossier && <section aria-label="Fresh dossier adoption"><p>Approved dossier {state.approvedDossier.dossierVersionId}</p><button disabled={busy} onClick={() => void act(() => api.request("/create", { baseVersionId: current.id, preset }), "Fresh intent draft created; earlier policy remains in history.")}>Start fresh intent draft for approved dossier</button></section>}
    <h2>Canon route requested</h2>
    {!current ? <section className="intent-adoption"><label>Fidelity preset<select value={preset} onChange={(e) => setPreset(e.target.value as FidelityPreset)}>{FIDELITY_PRESETS.map((p) => <option key={p} value={p}>{presets[p]}</option>)}</select></label>
      <DimensionSummary dimensions={expandFidelityPreset(preset)} />
      <button disabled={busy || !state.approvedDossier} onClick={() => void act(() => api.request("/create", { preset }), "Intent draft created." )}>Create intent draft</button>
      {state.legacyProjection && <details><summary>Legacy Brief fidelity adoption</summary><p>{state.legacyProjection.value} · Brief {state.legacyProjection.briefVersionId}</p><DimensionSummary dimensions={state.legacyProjection.dimensions} />
        <button disabled={busy || !state.approvedDossier} onClick={() => void act(() => api.request("/create", { legacyBriefVersionId: state.legacyProjection!.briefVersionId }), "Legacy fidelity adopted as an intent draft.")}>Adopt legacy projection</button></details>}
      {!state.approvedDossier && <p>Approved Source Dossier required.</p>}
      <button onClick={() => changeTab("director")}>Director suggestions</button>
    </section> : <nav className="intent-tabs" aria-label="Adaptation views">{(["fidelity", ...Object.keys(labels), "history", "director"] as Array<typeof tab>).map((name) => <button key={name} aria-current={name === tab ? "page" : undefined} onClick={() => changeTab(name)}>{name === "fidelity" ? "Fidelity" : name === "history" ? "History" : name === "director" ? "Director" : labels[name]}</button>)}</nav>}
    {current && tab === "fidelity" && <section><label>Fidelity preset<select value={preset} onChange={(e) => setPreset(e.target.value as FidelityPreset)}>{FIDELITY_PRESETS.map((p) => <option key={p} value={p}>{presets[p]}</option>)}</select></label>
      <DimensionSummary dimensions={expandFidelityPreset(preset)} />
      <button disabled={busy || current.stale} onClick={() => void patch({ preset }, "Expanded fidelity preset saved.")}>Apply expanded preset</button>
      <fieldset disabled={busy || current.stale}><legend>Current dimensional policy</legend><div className="intent-grid">{FIDELITY_DIMENSIONS.map((dimension) => <label key={dimension}>{dimensionLabels[dimension]}<select value={current.policy.dimensions[dimension]} onChange={(e) => void patch({ dimensions: { ...current.policy.dimensions, [dimension]: e.target.value } }, "Dimension saved.")}>{FIDELITY_LEVELS.map((level) => <option key={level}>{level}</option>)}</select></label>)}</div></fieldset>
      <p>Preset provenance: {current.policy.preset ? presets[current.policy.preset] : "Manual dimensions"}</p>
      <label className="intent-check"><input type="checkbox" checked={current.policy.preserveCanonRoute} disabled={busy || current.stale} onChange={(e) => { const value = e.target.checked; setState({ ...state, current: { ...current, policy: { ...current.policy, preserveCanonRoute: value } } }); void patch({ preserveCanonRoute: value }, "Canon-route request saved."); }} />Canon route requested</label>
      <label>Requested source ending<select disabled={busy || current.stale} value={current.policy.endingIntent} onChange={(e) => void patch({ endingIntent: e.target.value }, "Ending request saved.")}>{["not-required", "preserve-ending", "preserve-result-alter-mechanism", "allow-alternates", "specific-state"].map((v) => <option key={v}>{v}</option>)}</select></label>
      <small>Material {current.policy.materialFingerprint}</small>
    </section>}
    {current && tab in labels && <div className="intent-review-layout"><div><h2>{labels[tab as IntentCollection]}</h2>
      {tab === "expansion" && <BudgetEditor budget={current.policy.budget} reconciliation={current.reconciliation} disabled={busy || current.stale} onSave={(budget) => patch({ budget }, "Author budget saved.")} />}
      <label>Find intent item or stable ID<input value={search} onChange={(e) => { setSearch(e.target.value); setOffset(0); }} /></label>
      <div className="intent-items" aria-label={labels[tab as IntentCollection]}>{items.map((item) => <article key={item.id}>
        <strong>{"effect" in item ? item.effect : "requirement" in item ? item.requirement : "permission" in item ? item.permission : item.description}</strong><small>{item.id} · {item.scope}</small><p>{item.rationale}</p>
        <div className="intent-item-actions"><button disabled={busy || current.stale} onClick={() => void reviewItem(item)}>Review / edit</button>
          {"active" in item && <button disabled={busy || current.stale} onClick={() => void act(async () => { const detail = await api.request<AdaptationIntent["overrides"][number]>(`/collections/overrides/${encodeURIComponent(item.id)}`); const { provenance: _, ...value } = detail; await api.edit({ baseVersionId: current.id, operations: [{ kind: "override", value: { ...value, active: !detail.active } }] }); }, "Override state saved.")}>{item.active ? "Deactivate" : "Activate"}</button>}
          <button disabled={busy || current.stale} onClick={() => void patch({ operations: [{ kind: "remove", collection: tab, id: item.id }] }, "Intent item removed.")}>Remove</button></div>
      </article>)}</div><Pages offset={offset} total={total} onChange={setOffset} label="Intent item pages" />
      <IntentItemEditor key={`${tab}:${editing?.id ?? "new"}`} collection={tab as IntentCollection} item={editing} selected={selected} disabled={busy || current.stale || selectedIds.length !== selected.length}
        onSave={(operation) => act(async () => { await api.edit({ baseVersionId: current.id, operations: [operation] }); setEditing(null); }, "Intent item saved.")} onCancel={() => setEditing(null)} />
    </div>{sourcePicker}</div>}
    {tab === "director" && <div className="intent-review-layout"><section aria-label="Adaptation Director"><h2>Director suggestions</h2>
      {proposals.length > 0 && <details><summary>Suggestion history</summary>{proposals.map((p) => <article key={p.versionId}><p>{p.status} · {p.request}</p><button disabled={busy} onClick={() => void api.request<IntentProposal>(`/proposals/${p.versionId}`).then(setProposal).catch((e: Error) => setMessage(e.message))}>Review stored suggestion</button></article>)}<nav aria-label="Suggestion history pages"><button disabled={proposalOffset === 0} onClick={() => setProposalOffset(Math.max(0, proposalOffset - 20))}>Previous</button><button disabled={proposals.length < 20} onClick={() => setProposalOffset(proposalOffset + 20)}>Next</button></nav></details>}
      <label>Adaptation preference<textarea maxLength={6000} value={request} onChange={(e) => { setRequest(e.target.value); setPreview(null); setAuthorized(false); }} /></label>
      <label>Provider<select value={providerId} onChange={(e) => { setProviderId(e.target.value); setPreview(null); setModelId(e.target.value === "offline-adaptation-intent" ? "offline-a4-v1" : ""); }}><option value="offline-adaptation-intent">Offline fixture</option><option value="openrouter-adaptation-intent">OpenRouter</option></select></label>
      <label>Model<input value={modelId} onChange={(e) => { setModelId(e.target.value); setPreview(null); }} /></label>
      <button disabled={busy || !request.trim() || !modelId.trim() || !state.approvedDossier || current?.stale} onClick={async () => { setBusy(true); try { setPreview(await api.preview({ request, recordIds: selected.map((v) => v.id), providerId, modelId })); setAuthorized(false); } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); } }}>Preview suggestion</button>
      {preview && <section aria-label="Adaptation suggestion preview"><p>Dossier {preview.binding.dossierVersionId}</p><p>Base {preview.baseVersionId ?? "must-not-exist"}</p><p>{preview.promptVersion} / schema {preview.schemaVersion} · {preview.bytes} bytes · ~{preview.estimatedInputTokens} input tokens</p><p>{preview.providerId} / {preview.modelId} · Cost: {preview.cost === null ? "unknown" : "$0.00 (offline)"}</p><p>Records: {preview.records.map((r) => r.id).join(", ") || "none"}</p>
        <label className="intent-check"><input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} />Authorize this exact adaptation suggestion</label>
        <button disabled={busy || !authorized} onClick={async () => { setBusy(true); try { setProposal(await api.request<IntentProposal>("/generate", { previewId: preview.id, fingerprint: preview.fingerprint })); setPreview(null); setAuthorized(false); setMessage("Suggestion ready for review."); } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); } }}>Generate suggestion</button></section>}
      {proposal && <section aria-label="Adaptation proposal review"><h3>Requested changes</h3>{proposal.operations.map((o, i) => <article key={i}><strong>{o.kind}</strong><pre>{JSON.stringify(o, null, 2)}</pre></article>)}
        <button disabled={busy || proposal.status !== "pending"} onClick={() => void act(async () => { await api.request("/apply", { versionId: proposal.versionId }); setProposal(null); }, "Reviewed adaptation suggestion applied as a draft.")}>Apply reviewed suggestion</button>
        <button disabled={busy || proposal.status !== "pending"} onClick={() => void act(async () => { await api.request("/reject", { versionId: proposal.versionId }); setProposal(null); }, "Suggestion rejected.")}>Reject suggestion</button></section>}
    </section>{sourcePicker}</div>}
    {current && tab === "history" && <section><h2>Intent version history</h2><label>Historical intent<select value={historicalId} onChange={(e) => { setHistoricalId(e.target.value); setComparison(null); }}><option value="">Select version</option>{history.map((v) => <option key={v.id} value={v.id}>v{v.version} / {v.revision.kind}</option>)}</select></label><Pages offset={offset} total={total} onChange={setOffset} label="Intent history pages" />
      <button disabled={busy || !historicalId} onClick={async () => { setBusy(true); try { setComparison(await api.request("/compare", { from: historicalId, to: current.id })); } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); } }}>Compare with current</button>
      <button disabled={busy || !historicalId || current.stale} onClick={() => void act(() => api.request("/restore", { versionId: historicalId }), "Historical intent restored as a new draft.")}>Restore as new draft</button>
      {comparison && <div><p>Material {comparison.materialEqual ? "unchanged" : "changed"}; provenance {comparison.provenanceEqual ? "unchanged" : "changed"}</p><dl className="intent-dimensions">{FIDELITY_DIMENSIONS.map((d) => <div key={d}><dt>{dimensionLabels[d]}</dt><dd>{comparison.dimensions.from[d]} to {comparison.dimensions.to[d]}</dd></div>)}</dl><details><summary>Length budget comparison</summary><pre>{JSON.stringify(comparison.budget, null, 2)}</pre></details><p>Changed IDs: {comparison.changedIds.slice(0, 100).join(", ") || "none"}</p></div>}
      {historicalId && <a download href={`${api.root}/export?versionId=${encodeURIComponent(historicalId)}`}>Export historical intent</a>}
    </section>}
  </section>;
}
function DimensionSummary({ dimensions }: { dimensions: AdaptationIntent["dimensions"] }) {
  return <dl className="intent-dimensions">{FIDELITY_DIMENSIONS.map((d) => <div key={d}><dt>{dimensionLabels[d]}</dt><dd>{dimensions[d]}</dd></div>)}</dl>;
}
function Pages({ offset, total, onChange, label }: { offset: number; total: number; onChange: (offset: number) => void; label: string }) {
  return <nav className="intent-pages" aria-label={label}><button title="Previous page" aria-label="Previous" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - 20))}>←</button><span>{total ? offset + 1 : 0}–{Math.min(total, offset + 20)} / {total}</span><button title="Next page" aria-label="Next" disabled={offset + 20 >= total} onClick={() => onChange(offset + 20)}>→</button></nav>;
}
function WordsInput({ label, value, onChange }: { label: string; value: PlannedWords; onChange: (value: PlannedWords) => void }) {
  return <label>{label}<select aria-label={`${label} certainty`} value={value.kind} onChange={(e) => onChange(e.target.value === "unknown" ? { kind: "unknown" } : { kind: e.target.value as "known" | "estimated", words: value.kind === "unknown" ? 0 : value.words })}><option value="unknown">Unknown</option><option value="estimated">Estimated</option><option value="known">Known</option></select>
    {value.kind !== "unknown" && <input aria-label={`${label} words`} type="number" min={0} max={10_000_000} value={value.words} onChange={(e) => onChange({ ...value, words: Number(e.target.value) })} />}</label>;
}
function BudgetEditor({ budget, reconciliation, disabled, onSave }: { budget: AdaptationIntent["budget"]; reconciliation: NonNullable<IntentState["current"]>["reconciliation"]; disabled: boolean; onSave: (budget: AdaptationIntent["budget"]) => Promise<void> }) {
  const [draft, setDraft] = useState(budget); useEffect(() => setDraft(budget), [budget]);
  return <form onSubmit={(e) => { e.preventDefault(); void onSave(draft); }}><fieldset disabled={disabled}><legend>Author length budget</legend><div className="intent-grid">
    <WordsInput label="Source-equivalent" value={draft.sourceEquivalent} onChange={(v) => setDraft({ ...draft, sourceEquivalent: v, discrepancyReviewed: false })} />
    <WordsInput label="Target" value={draft.target} onChange={(v) => setDraft({ ...draft, target: v, discrepancyReviewed: false })} /></div>
    <p>Planned: {reconciliation.planned ?? "unknown"} · Target: {reconciliation.target ?? "unknown"} · Difference: {reconciliation.difference ?? "unknown"} · {reconciliation.status}</p>
    <label className="intent-check"><input type="checkbox" checked={draft.discrepancyReviewed} onChange={(e) => setDraft({ ...draft, discrepancyReviewed: e.target.checked })} />I reviewed this exact allocation discrepancy</label><button>Save author budget</button></fieldset></form>;
}
function IntentItemEditor({ collection, item, selected, disabled, onSave, onCancel }: { collection: IntentCollection; item: Item | null; selected: SourceRecord[]; disabled: boolean; onSave: (operation: AdaptationSuggestion["operations"][number]) => Promise<void>; onCancel: () => void }) {
  const [id] = useState(item?.id ?? `ai_${crypto.randomUUID()}`), [scope, setScope] = useState(item?.scope ?? "project"), [rationale, setRationale] = useState(item?.rationale ?? "");
  const [description, setDescription] = useState(item ? "effect" in item ? item.effect : "requirement" in item ? item.requirement : "permission" in item ? item.permission : item.description : "");
  const [kind, setKind] = useState(item && "kind" in item ? item.kind : collection === "inventions" ? "scene" : "event"), [aspect, setAspect] = useState(item && "aspect" in item ? item.aspect : "state");
  const [reviewed, setReviewed] = useState(item && "reviewed" in item ? item.reviewed : false), [active, setActive] = useState(item && "active" in item ? item.active : true);
  const [dependencyIds, setDependencyIds] = useState(item && "dependencyIds" in item ? item.dependencyIds.join(", ") : ""), [obligationId, setObligationId] = useState(item && "obligationId" in item ? item.obligationId : "");
  const [origin, setOrigin] = useState(item && "origin" in item ? item.origin : "branching"), [overrideIds, setOverrideIds] = useState(item && "overrideIds" in item ? item.overrideIds.join(", ") : ""), [inventionIds, setInventionIds] = useState(item && "inventionIds" in item ? item.inventionIds.join(", ") : "");
  const [allocation, setAllocation] = useState<PlannedWords>(item && "allocation" in item ? item.allocation : { kind: "unknown" }), [strength, setStrength] = useState(item && "strength" in item ? item.strength : "required"), [transformations, setTransformations] = useState<string[]>(item && "transformations" in item ? item.transformations : []);
  const submit = () => {
    const common = { id, scope, rationale }, targetIds = selected.map((r) => r.id), evidence = selected.flatMap((r) => r.evidence.slice(0, 1));
    let operation: unknown;
    if (collection === "overrides") operation = { kind: "override", value: { ...common, authority: "author-override", targetIds, aspect, effect: description, active, reviewed } };
    if (collection === "inventions") operation = { kind: "invention", value: { ...common, origin: "adaptation-only", kind, description, dependencyIds: list(dependencyIds) } };
    if (collection === "obligations") operation = { kind: "obligation", value: { ...common, status: "requested", kind, targetIds, evidence, requirement: description, strength, transformations } };
    if (collection === "exceptions") operation = { kind: "exception", value: { ...common, obligationId, targetIds, evidence, permission: description, reviewed } };
    if (collection === "expansion") operation = { kind: "expansion", value: { ...common, origin, description, sourceRecordIds: targetIds, overrideIds: list(overrideIds), inventionIds: list(inventionIds), dependencyIds: list(dependencyIds), allocation } };
    void onSave(operation as AdaptationSuggestion["operations"][number]);
  };
  return <form className="intent-item-editor" onSubmit={(e) => { e.preventDefault(); submit(); }}><fieldset disabled={disabled}><legend>{item ? "Review intent item" : `Add ${labels[collection].toLowerCase()}`}</legend><small>Stable ID {id}</small>
    <label>Adaptation {collection === "overrides" ? "effect" : collection === "obligations" ? "request" : collection === "exceptions" ? "permission" : "description"}<textarea required maxLength={1200} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
    <label>Rationale<textarea required maxLength={1200} value={rationale} onChange={(e) => setRationale(e.target.value)} /></label><label>Scope<input required maxLength={200} value={scope} onChange={(e) => setScope(e.target.value)} /></label>
    {collection === "overrides" && <><label>Override aspect<input required value={aspect} onChange={(e) => setAspect(e.target.value)} /></label><label className="intent-check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Active override</label><strong>ADAPTATION</strong><p>{description || "No effect entered"}</p></>}
    {(collection === "inventions" || collection === "obligations") && <label>{collection === "inventions" ? "Invention kind" : "Requested obligation kind"}<select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>{(collection === "inventions" ? ["scene", "character", "relationship", "location", "event", "framing"] : ["event", "relationship", "reveal", "character-state", "chronology", "ending", "world", "tone"]).map((v) => <option key={v}>{v}</option>)}</select></label>}
    {collection === "inventions" && <p>Origin: adaptation-only</p>}
    {collection === "obligations" && <><label>Request strength<select value={strength} onChange={(e) => setStrength(e.target.value as typeof strength)}><option>required</option><option>preferred</option></select></label><fieldset><legend>Allowed transformations</legend>{TRANSFORMATIONS.map((v) => <label className="intent-check" key={v}><input type="checkbox" checked={transformations.includes(v)} onChange={(e) => setTransformations(e.target.checked ? [...transformations, v] : transformations.filter((t) => t !== v))} />{v}</label>)}</fieldset></>}
    {collection === "exceptions" && <label>Obligation stable ID<input required value={obligationId} onChange={(e) => setObligationId(e.target.value)} /></label>}
    {(collection === "overrides" || collection === "exceptions") && <label className="intent-check"><input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />Reviewed exact effect and evidence</label>}
    {(collection === "inventions" || collection === "expansion") && <label>Dependency stable IDs<input value={dependencyIds} onChange={(e) => setDependencyIds(e.target.value)} /></label>}
    {collection === "expansion" && <><label>Expansion origin<select value={origin} onChange={(e) => setOrigin(e.target.value as typeof origin)}>{["source-elaboration", "override-consequence", "adaptation-only", "branching", "connective"].map((v) => <option key={v}>{v}</option>)}</select></label><label>Override stable IDs<input value={overrideIds} onChange={(e) => setOverrideIds(e.target.value)} /></label><label>Invention stable IDs<input value={inventionIds} onChange={(e) => setInventionIds(e.target.value)} /></label><WordsInput label="Allocation" value={allocation} onChange={setAllocation} /></>}
    {["overrides", "obligations", "exceptions"].includes(collection) && <p>Source targets: {selected.map((r) => r.id).join(", ") || "none"}</p>}
    <button>{item ? "Save reviewed item" : "Add intent item"}</button>{item && <button type="button" onClick={onCancel}>Cancel edit</button>}
  </fieldset></form>;
}
