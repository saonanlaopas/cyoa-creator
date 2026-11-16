import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ImageAssetMetadata, ImageAssetRole, ImageCatalogueFilters } from "@story-to-cyoa/domain";
import { assetPath, assetRequest, type AssetBinding, type AssetDetail, type AssetList, type AssetReview, type AssetVersion } from "../../api/asset-library.js";
import "./asset-library.css";

const emptyMetadata: ImageAssetMetadata = { title: "", description: "", altText: "", tags: [], credit: "", license: "" };
const roles: Record<ImageAssetRole, string> = { background: "Background", portrait: "Portrait", "full-scene-illustration": "Full-scene illustration", map: "Map", "reference-sheet": "Reference sheet" };
const roleOptions = Object.entries(roles).map(([role, name]) => <option key={role} value={role}>{name}</option>);
const optionKinds = ["character", "location"] as const;
const variantKeyPattern = "[a-zA-Z0-9][a-zA-Z0-9_\\-]{0,59}";
async function loadBindings(base: string, kind: typeof optionKinds[number]) {
  const page = (offset: number) => assetRequest<{ total: number; items: AssetBinding[] }>(`${base}/bindings?kind=${kind}&offset=${offset}`);
  const first = await page(0);
  const rest = await Promise.all(Array.from({ length: Math.max(0, Math.ceil(first.total / 50) - 1) }, (_, i) => page((i + 1) * 50)));
  return [first, ...rest].flatMap(item => item.items);
}
function BindingSelect({ label, value, items, onChange }: { label: string; value?: string; items: AssetBinding[]; onChange: (value: string | undefined) => void }) {
  return <label>{label}<select value={value ?? ""} onChange={e => onChange(e.target.value || undefined)}>
    <option value="">None</option>
    {value && !items.some(item => item.id === value) && <option value={value}>{value}</option>}
    {items.map(item => <option key={item.id} value={item.id}>{item.name} ({item.id})</option>)}
  </select></label>;
}
function metadataValue(key: keyof ImageAssetMetadata, version: AssetVersion) {
  if (key !== "designation") return String(version.content.metadata[key] ?? "") || "Unspecified";
  const designation = version.content.metadata.designation;
  if (!designation) return "Unclassified";
  return [
    roles[designation.role],
    ...Object.values(version.bindings ?? {}).map(item => item.name === null ? `Missing binding (${item.id})` : `${item.name} (${item.id})`),
    "expressionKey" in designation && designation.expressionKey ? `Expression: ${designation.expressionKey}` : null,
    "stateKey" in designation && designation.stateKey ? `State: ${designation.stateKey}` : null,
  ].filter(Boolean).join(" / ");
}
export function AssetLibraryWorkspace({ projectId }: { projectId: string }) {
  const base = assetPath(projectId), [list, setList] = useState<AssetList>({ total: 0, offset: 0, items: [] });
  const [search, setSearch] = useState(""), [offset, setOffset] = useState(0), [selectedId, setSelectedId] = useState<string | null>(null);
  const [filters, setFilters] = useState<ImageCatalogueFilters>({});
  const [showFilters, setShowFilters] = useState(false);
  const [bindings, setBindings] = useState<Record<typeof optionKinds[number], AssetBinding[]>>({ character: [], location: [] });
  const [detail, setDetail] = useState<AssetDetail | null>(null), [metadata, setMetadata] = useState<ImageAssetMetadata>(emptyMetadata);
  const [tagsText, setTagsText] = useState("");
  const [file, setFile] = useState<File | null>(null), [review, setReview] = useState<AssetReview | null>(null), [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [uploadingNew, setUploadingNew] = useState(false);
  const sequence = useRef(0), fileInput = useRef<HTMLInputElement>(null);
  const pending = useRef<{ key: string; file?: File; id: string } | null>(null);
  const query = new URLSearchParams({ search, offset: String(offset) });
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, String(value));
  const listUrl = `${base}?${query}`;
  const filter = (patch: Partial<ImageCatalogueFilters>) => { setFilters(prev => ({ ...prev, ...patch })); setOffset(0); };
  const loadList = () => assetRequest<AssetList>(listUrl).then(setList);
  useEffect(() => { let active = true; void assetRequest<AssetList>(listUrl)
    .then((value) => { if (active) setList(value); }).catch((e: Error) => { if (active) setMessage(e.message); }); return () => { active = false; }; }, [listUrl]);
  const needsBindings = showFilters || Boolean(metadata.designation);
  useEffect(() => {
    if (!needsBindings) return;
    let active = true;
    void Promise.all(optionKinds.map(kind => loadBindings(base, kind))).then(([character, location]) => {
      if (active) setBindings({ character: character!, location: location! });
    }).catch((e: Error) => { if (active) setMessage(e.message); });
    return () => { active = false; };
  }, [base, needsBindings]);
  useEffect(() => () => { sequence.current++; }, []);
  const open = async (assetId: string, versionId?: string, historyOffset = 0) => {
    const ticket = ++sequence.current; setSelectedId(assetId); setUploadingNew(false); setReview(null); setConsent(false); setFile(null); setDetail(null);
    if (fileInput.current) fileInput.current.value = "";
    try { const value = await assetRequest<AssetDetail>(`${base}/${assetId}?offset=${historyOffset}${versionId ? `&versionId=${encodeURIComponent(versionId)}` : ""}`);
      if (ticket !== sequence.current) return; setDetail(value); setMetadata(value.selected.content.metadata); setTagsText(value.selected.content.metadata.tags.join(", "));
    } catch (e) { if (ticket === sequence.current) setMessage((e as Error).message); }
  };
  const edit = (patch: Partial<ImageAssetMetadata>) => { setMetadata((m) => ({ ...m, ...patch })); setReview(null); setConsent(false); };
  const dirty = detail ? JSON.stringify(metadata) !== JSON.stringify(detail.selected.content.metadata) : true;
  const current = detail?.selected.id === detail?.currentVersionId;
  const designation = metadata.designation;
  const mutate = async (path: string, body: Record<string, unknown>, image?: File) => {
    const key = JSON.stringify({ path, body });
    if (!pending.current || pending.current.key !== key || pending.current.file !== image) pending.current = { key, file: image, id: crypto.randomUUID() };
    const input = { ...body, operationId: pending.current.id, approved: true };
    let options: RequestInit;
    if (image) { const form = new FormData(); form.append("metadata", JSON.stringify(input)); form.append("file", image); options = { method: "POST", body: form }; }
    else options = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) };
    const result = await assetRequest<{ assetId: string; versionId: string; status: string }>(path, options); pending.current = null; setFile(null); setReview(null); setConsent(false);
    if (fileInput.current) fileInput.current.value = "";
    await open(result.assetId); await loadList(); return result;
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      if (file) await mutate(`${base}/candidates`, { metadata, ...(selectedId && !uploadingNew ? { assetId: selectedId, expectedVersionId: detail!.currentVersionId } : {}) }, file);
      else if (detail) await mutate(`${base}/${detail.assetId}/revise`, { metadata, expectedVersionId: detail.currentVersionId });
      setMessage("Candidate saved. Approved image unchanged.");
    } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  };
  return <section className="artifact-pane asset-library" aria-label="Asset library">
    <header className="asset-library-header"><h1>Asset Library</h1><div className="asset-actions"><button aria-label="Refresh assets" title="Refresh assets" disabled={busy} onClick={async () => {
      try { await loadList(); if (selectedId) await open(selectedId); } catch (e) { setMessage((e as Error).message); }
    }}>&#8635;</button><button onClick={() => {
      sequence.current++; setDetail(null); setSelectedId(null); setUploadingNew(true); setMetadata(emptyMetadata); setTagsText(""); setFile(null); setReview(null); setConsent(false); setMessage("");
      if (fileInput.current) fileInput.current.value = "";
    }} disabled={busy}>New asset</button></div></header>
    {message && <p role="status">{message}</p>}
    <div className="asset-library-layout">
      <section className="asset-catalogue" aria-label="Asset catalogue">
        <label>Search assets<input type="search" disabled={busy} value={search} onChange={(e) => { setSearch(e.target.value); setOffset(0); }} /></label>
        <label className="checkbox-line"><input type="checkbox" checked={Boolean(filters.approvedOnly)} onChange={e => filter({ approvedOnly: e.target.checked })} />Approved versions only</label>
        <label>Filter by role<select value={filters.role ?? ""} onChange={e => filter({ role: (e.target.value || undefined) as ImageAssetRole | undefined })}><option value="">All roles</option>{roleOptions}</select></label>
        <button type="button" aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)}>Binding filters</button>
        {showFilters && <>
          <BindingSelect label="Filter by character" items={bindings.character} value={filters.characterId} onChange={characterId => filter({ characterId })} />
          <BindingSelect label="Filter by location" items={bindings.location} value={filters.locationId} onChange={locationId => filter({ locationId })} />
          <button type="button" onClick={() => filter({ characterId: undefined, locationId: undefined })}>Clear binding filters</button>
        </>}
        <p>{list.total} assets</p>
        <ul>{list.items.map((item) => <li key={item.assetId}><button className={selectedId === item.assetId ? "asset-selected" : ""} onClick={() => void open(item.assetId, filters.approvedOnly ? item.versionId : undefined)} disabled={busy}>
          <img src={item.thumbnailUrl} alt="" loading="lazy" width="72" height="56" /><span><strong>{item.metadata.title}</strong><small>{item.status}{item.approvedVersionId ? " / approved image retained" : " / not approved"}{item.metadata.designation ? ` / ${roles[item.metadata.designation.role]}` : ""}{item.bindingStale ? " / missing binding" : ""}</small></span>
        </button></li>)}</ul>
        {!list.items.length && <p>No assets found.</p>}
        <div className="asset-pagination"><button aria-label="Previous assets" disabled={busy || offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>&larr;</button>
          <span>{list.total ? offset + 1 : 0}-{Math.min(offset + 25, list.total)} / {list.total}</span>
          <button aria-label="Next assets" disabled={busy || offset + 25 >= list.total} onClick={() => setOffset(offset + 25)}>&rarr;</button></div>
      </section>
      <section className="asset-inspector" aria-label="Asset inspector">
        {detail ? <>
          <header><h2>{detail.selected.content.metadata.title}</h2><span>v{detail.selected.version} / {detail.selected.content.status}</span></header>
          <div className="asset-comparison"><AssetImage version={detail.selected} label={detail.selected.content.status === "candidate" ? "Candidate image" : "Selected image"} />
            {detail.approved && detail.approved.id !== detail.selected.id && <AssetImage version={detail.approved} label="Approved image" />}</div>
          <dl className="asset-facts"><div><dt>Origin</dt><dd>{detail.selected.content.provenance.kind === "assistant-import" ? "Assistant import / no provider call" : "User upload"}</dd></div>
            <div><dt>Source</dt><dd>{detail.selected.content.provenance.sourceName}</dd></div><div><dt>Image</dt><dd>{detail.selected.image.width} x {detail.selected.image.height} / {detail.selected.image.bytes.toLocaleString()} bytes</dd></div>
            <div><dt>Content SHA-256</dt><dd><code>{detail.selected.image.sha256}</code></dd></div>
            <div><dt>Designation</dt><dd>{metadataValue("designation", detail.selected)}</dd></div></dl>
          {detail.selected.content.provenance.kind === "assistant-import" && <p className="asset-origin">Assistant-supplied file; generator identity is not verified.</p>}
        </> : <h2>{uploadingNew ? "New image candidate" : selectedId ? "Loading asset" : "Select an asset"}</h2>}
        {(uploadingNew || detail) && <form onSubmit={(e) => void save(e)}>
          <fieldset disabled={busy || Boolean(detail && !current)}><legend>{detail ? "New candidate" : "Image candidate"}</legend>
            <label>{detail ? "Replacement image" : "Image file"}<input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" required={!detail} onChange={(e) => { setFile(e.target.files?.[0] ?? null); setReview(null); setConsent(false); }} /></label>
            <label>Title<input required maxLength={200} value={metadata.title} onChange={(e) => edit({ title: e.target.value })} /></label>
            <label>Description<textarea required maxLength={2000} value={metadata.description} onChange={(e) => edit({ description: e.target.value })} /></label>
            <label>Alternative text<textarea required maxLength={1000} value={metadata.altText} onChange={(e) => edit({ altText: e.target.value })} /></label>
            <label>Tags<input value={tagsText} onChange={(e) => { setTagsText(e.target.value); edit({ tags: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) }); }} /></label>
            <label>Asset role<select value={designation?.role ?? ""} onChange={e => {
              const role = e.target.value as ImageAssetRole | "";
              edit({ designation: role ? { role } : undefined });
            }}><option value="">Unclassified</option>{roleOptions}</select></label>
            {designation && (designation.role === "portrait" || designation.role === "reference-sheet") &&
              <BindingSelect label="Canonical character" items={bindings.character} value={designation.characterId} onChange={characterId => edit({ designation: { ...designation, characterId } })} />}
            {designation && designation.role !== "portrait" &&
              <BindingSelect label="World location" items={bindings.location} value={designation.locationId} onChange={locationId => edit({ designation: { ...designation, locationId } })} />}
            {designation?.role === "portrait" && <label>Expression key<input maxLength={60} pattern={variantKeyPattern} value={designation.expressionKey ?? ""} onChange={e => edit({ designation: { ...designation, expressionKey: e.target.value || undefined } })} /></label>}
            {designation && designation.role !== "portrait" && designation.role !== "reference-sheet" && <label>State key<input maxLength={60} pattern={variantKeyPattern} value={designation.stateKey ?? ""} onChange={e => edit({ designation: { ...designation, stateKey: e.target.value || undefined } })} /></label>}
            <div className="asset-credit-grid"><label>Credit<input maxLength={300} value={metadata.credit} onChange={(e) => edit({ credit: e.target.value })} /></label>
              <label>License<input maxLength={300} value={metadata.license} onChange={(e) => edit({ license: e.target.value })} /></label></div>
            <button type="submit" disabled={busy || !file && (!detail || !dirty)}>{file ? detail ? "Upload replacement candidate" : "Upload candidate" : "Save metadata candidate"}</button>
          </fieldset>
        </form>}
        {detail && current && detail.selected.content.status === "candidate" && <section className="asset-review" aria-label="Image approval review">
          <button disabled={busy || dirty || Boolean(file)} onClick={async () => { setBusy(true); try {
            setReview(await assetRequest<AssetReview>(`${base}/${detail.assetId}/review?versionId=${detail.selected.id}`)); setConsent(false);
          } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); } }}>Review candidate</button>
          {review && <><h3>Exact image review</h3><p>{review.selected.content.metadata.description}</p><p>Alternative text: {review.selected.content.metadata.altText}</p>
            <dl className="asset-review-metadata">{([...new Set([...Object.keys(metadata), "designation"])] as Array<keyof ImageAssetMetadata>).map((key) => <div key={key}><dt>{key}</dt>
              <dd>{metadataValue(key, review.selected)}</dd>{review.approved && <dd>Approved: {metadataValue(key, review.approved)}</dd>}</div>)}</dl>
            {review.findings.map((f) => <p key={f.code} className="warning">{f.message}</p>)}
            <p>{review.usage.totalAssignments} scene/map assignments</p>
            <label className="checkbox-line"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />I reviewed this exact image and metadata.</label>
            <div className="asset-actions">{(["approve", "reject"] as const).map((action) => <button key={action} disabled={busy || !consent || action === "approve" && review.findings.some(f => f.severity === "error")} onClick={async () => {
              setBusy(true); try { await mutate(`${base}/${detail.assetId}/${action}`, { versionId: review.selected.id, fingerprint: review.fingerprint }); setMessage(action === "approve" ? "Exact image candidate approved." : "Candidate rejected. Approved image unchanged."); }
              catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
            }}>{action === "approve" ? "Approve candidate" : "Reject candidate"}</button>)}</div></>}
        </section>}
        {detail && <section className="asset-history" aria-label="Asset history"><h3>History / {detail.totalVersions} versions</h3>
          <ol>{detail.history.map((v) => <li key={v.id}><button disabled={busy} onClick={() => void open(detail.assetId, v.id, detail.offset)}>Inspect v{v.version}</button><span>{v.status} / {v.title}</span></li>)}</ol>
          <div className="asset-pagination"><button aria-label="Previous image versions" disabled={busy || detail.offset === 0} onClick={() => void open(detail.assetId, detail.selected.id, Math.max(0, detail.offset - 20))}>&larr;</button>
            <span>{detail.offset + 1}-{Math.min(detail.offset + 20, detail.totalVersions)} / {detail.totalVersions}</span><button aria-label="Next image versions" disabled={busy || detail.offset + 20 >= detail.totalVersions} onClick={() => void open(detail.assetId, detail.selected.id, detail.offset + 20)}>&rarr;</button></div>
          <button disabled={busy} onClick={async () => { try { const usage = await assetRequest<{ totalAssignments: number; totalLibraryVersions: number }>(`${base}/${detail.assetId}/usage`);
            setMessage(`${usage.totalAssignments} scene/map assignments; ${usage.totalLibraryVersions} immutable library versions.`); } catch (e) { setMessage((e as Error).message); } }}>Inspect usage</button>
          {!current && <button disabled={busy} onClick={() => void open(detail.assetId)}>Return to current version</button>}
        </section>}
      </section>
    </div>
  </section>;
}
function AssetImage({ version, label }: { version: AssetVersion; label: string }) {
  return <figure><figcaption>{label} / v{version.version}</figcaption><a href={version.image.url} target="_blank" rel="noreferrer" title="Open full image">
    <img src={version.image.url} alt={version.content.metadata.altText} /></a></figure>;
}
