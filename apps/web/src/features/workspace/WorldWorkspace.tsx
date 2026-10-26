import { PeopleEditor, PeopleSummary } from "./PeopleEditor.js";
import { useEffect, useRef, useState } from "react";
import { emptyWorld, WorldDefinitionSchema, type WorldDefinition } from "@story-to-cyoa/domain";
import { loadPassagePlan, type PassagePlanState } from "../../api/passage-plan.js";
import { assetPath, assetRequest, type AssetList, type AssetDetail } from "../../api/asset-library.js";
import { WorldPanel } from "../player/WorldPanel.js";
import { ProgressionEditor, ProgressionSummary } from "./ProgressionEditor.js";
import { NativeWorldSchema, initialWorldState, projectWorldProgression, projectWorldPeople, type NativeWorld, type RuntimeState } from "@story-to-cyoa/runtime";
import "../player/world.css";

type Review = { fingerprint: string; world: WorldDefinition; previous: WorldDefinition | null; diagnostics?: { findings: Array<{ code: string; entityId: string; message: string }>; total: number; omitted: number; exhaustive: false } };
export function WorldWorkspace({ projectId }: { projectId: string }) {
  const [world, setWorld] = useState<WorldDefinition | null>(null), [review, setReview] = useState<Review | null>(null);
  const [passages, setPassages] = useState<PassagePlanState["passages"]>([]), [assets, setAssets] = useState<AssetList["items"]>([]);
  const [images, setImages] = useState<Record<string, AssetDetail["selected"]>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState(""), [consent, setConsent] = useState(false);
  const generation = useRef(0), operation = useRef<{ key: string; id: string } | null>(null);
  const call = <T,>(tool: string, body: unknown) => assetRequest<T>(`/api/long-form/projects/${encodeURIComponent(projectId)}/world/${tool}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const load = async () => {
    const n = ++generation.current; setBusy(true); setReview(null); setConsent(false); setError(null);
    try {
      const result = await call<{ world: WorldDefinition }>("read_world", {}), plan = await loadPassagePlan(projectId);
      const images: AssetList["items"] = [];
      for (let offset = 0; ; offset += 25) { const page = await assetRequest<AssetList>(`${assetPath(projectId)}?offset=${offset}`); images.push(...page.items); if (offset + 25 >= page.total) break; }
      if (generation.current === n) { setWorld(result.world); setPassages(plan.passages); setAssets(images); }
    } catch (e) { if (generation.current === n) setError(String(e)); }
    finally { if (generation.current === n) setBusy(false); }
  };
  useEffect(() => { void load(); return () => { generation.current++; }; }, [projectId]);
  useEffect(() => {
    let active = true;
    for (const location of world?.locations ?? []) {
      const ref = location.mapImage;
      if (ref && !images[ref.versionId]) void assetRequest<AssetDetail>(`${assetPath(projectId)}/${ref.assetId}?versionId=${encodeURIComponent(ref.versionId)}`)
        .then((detail) => active && setImages((old) => ({ ...old, [ref.versionId]: detail.selected }))).catch((e) => active && setError(String(e)));
    }
    return () => { active = false; };
  }, [projectId, world, images]);
  const edit = (next: WorldDefinition) => { setWorld(next); setReview(null); setConsent(false); setNotice(""); operation.current = null; };
  const inspect = async () => { if (!world) return; setBusy(true); setError(null); setReview(null); setConsent(false);
    try { setReview(await call<Review>("review_world", { world })); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  const apply = async () => { if (!review || !world || !consent || busy) return; setBusy(true); setError(null);
    const key = JSON.stringify(review); if (operation.current?.key !== key) operation.current = { key, id: crypto.randomUUID() };
    try { await call("apply_world", { world, fingerprint: review.fingerprint, operationId: operation.current.id, approved: true }); await load(); setNotice("World applied. Existing builds are unchanged."); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  if (!world) return <section aria-label="Locations and time">{error ? <p role="alert">{error}</p> : <p role="status">Loading…</p>}</section>;
  const locationOptions = (none = false) => <>{none && <option value="">None</option>}{world.locations.map((l) => <option key={l.id} value={l.id}>{l.name || l.id}</option>)}</>;
  const peopleLocationReferences = (id: string) => [
    ...(world.people?.schedules.flatMap((slot, i) => slot.locationId === id ? [`Schedule ${i + 1}`] : []) ?? []),
    ...(world.people?.overrides.flatMap((o, i) => o.locationId === id || o.prerequisites.some((c) => c.kind === "location" && c.locationId === id) ? [`Story override ${i + 1}`] : []) ?? []),
  ];
  const patchLocation = (index: number, patch: Partial<WorldDefinition["locations"][number]>) => edit({ ...world, locations: world.locations.map((l, i) => i === index ? { ...l, ...patch } : l) });
  const numeric = (value: number, change: (n: number) => void, max = 1440, min = 0) => <input type="number" min={min} max={max} step={1} value={value} onChange={(e) => change(Number(e.target.value))} />;
  const projection: NativeWorld | null = world.enabled && WorldDefinitionSchema.safeParse(world).success ? {
    schemaId: "cyoa.native-world", schemaVersion: 1, startLocationId: world.startLocationId!, initialMinutes: world.initialMinutes, waitMinutes: world.waitMinutes,
    locations: world.locations.map(({ passage, mapImage, ...l }) => ({ ...l, passageId: passage?.passageId ?? null, mapImage: mapImage?.versionId ?? null })),
    connections: world.connections, actions: world.actions, ...(world.progression ? { progression: projectWorldProgression(world.progression) } : {}), ...(world.people ? { people: projectWorldPeople(world.people) } : {}),
    assets: Object.values(images).filter((a) => world.locations.some((location) => location.mapImage?.versionId === a.id))
      .map((a) => ({ id: a.id, dataUrl: a.image.url, altText: a.content.metadata.altText, credit: a.content.metadata.credit, license: a.content.metadata.license })),
  } : null;
  // Editor artwork uses authenticated asset URLs; published bundles require embedded PNGs.
  // Validate the gameplay projection with placeholders while retaining its editor URLs for rendering.
  const previewParsed = projection ? NativeWorldSchema.safeParse({ ...projection,
    assets: projection.assets.map((asset) => ({ ...asset, dataUrl: "data:image/png;base64,AA==" })) }) : null;
  const previewWorld = previewParsed?.success ? projection : null;
  const previewState: RuntimeState | null = previewWorld ? { currentPassageId: previewWorld.locations.find((l) => l.id === previewWorld.startLocationId)!.passageId!,
    world: initialWorldState(previewWorld), turn: 0,
    stats: {}, relationships: {}, resources: {}, flags: {}, decisions: [], routes: [], knownFacts: [], visitCounts: {} } : null;
  return <section className="artifact-pane world-editor" aria-label="World authoring"><h2>Locations and time</h2>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <button disabled={busy} onClick={() => void load()}>Reload world</button>
    {previewWorld && previewState && <details><summary>Map preview</summary><WorldPanel world={previewWorld} state={previewState} disabled={true} onAction={() => undefined} /></details>}
    <fieldset disabled={busy}><label className="world-check"><input type="checkbox" checked={world.enabled} onChange={(e) => edit(e.target.checked ? { ...world, enabled: true } : emptyWorld())} />World enabled</label>
      {world.enabled && <>
        <div className="world-row"><label>Start location<select value={world.startLocationId ?? ""} onChange={(e) => edit({ ...world, startLocationId: e.target.value || null })}>{locationOptions(true)}</select></label>
          <label>Initial game minutes{numeric(world.initialMinutes, (n) => edit({ ...world, initialMinutes: n }), 52_560_000)}</label></div>
        <h3>Locations</h3>
        {world.locations.map((l, i) => <div className="world-row" key={l.id}>
          <label>Location name {i + 1}<input value={l.name} maxLength={200} onChange={(e) => patchLocation(i, { name: e.target.value })} /></label>
          <label>Parent {i + 1}<select value={l.parentId ?? ""} onChange={(e) => patchLocation(i, { parentId: e.target.value || null, marker: e.target.value ? l.marker : null })}>{locationOptions(true)}</select></label>
          <label>Passage {i + 1}<select value={l.passage?.passageId ?? ""} onChange={(e) => { const p = passages.find((p) => p.entityId === e.target.value); patchLocation(i, { passage: p ? { passageId: p.entityId, versionId: p.id } : null }); }}><option value="">Area only</option>
            {l.passage && !passages.some((p) => p.entityId === l.passage!.passageId) && <option value={l.passage.passageId}>Missing passage</option>}{passages.map((p) => <option value={p.entityId} key={p.entityId}>{p.content.title}</option>)}</select></label>
          <label>Map artwork {i + 1}<select value={l.mapImage?.versionId ?? ""} onChange={(e) => { const a = assets.find((a) => a.approvedVersionId === e.target.value); patchLocation(i, { mapImage: a?.approvedVersionId ? { assetId: a.assetId, versionId: a.approvedVersionId } : null }); }}><option value="">None</option>
            {l.mapImage && !assets.some((a) => a.approvedVersionId === l.mapImage!.versionId) && <option value={l.mapImage.versionId}>Pinned approved map</option>}{assets.filter((a) => a.approvedVersionId).map((a) => <option key={a.assetId} value={a.approvedVersionId!}>{a.metadata.title}</option>)}</select></label>
          {l.parentId && <><label className="world-check"><input type="checkbox" checked={Boolean(l.marker)} onChange={(e) => patchLocation(i, { marker: e.target.checked ? { x: 50, y: 50 } : null })} />Map marker {i + 1}</label>
            {l.marker && <><label>Marker X {i + 1}{numeric(l.marker.x, (x) => patchLocation(i, { marker: { ...l.marker!, x } }), 100)}</label><label>Marker Y {i + 1}{numeric(l.marker.y, (y) => patchLocation(i, { marker: { ...l.marker!, y } }), 100)}</label></>}</>}
          <label className="world-check"><input type="checkbox" checked={Boolean(l.hours)} onChange={(e) => patchLocation(i, { hours: e.target.checked ? { opens: 480, closes: 1320 } : null })} />Opening hours {i + 1}</label>
          {l.hours && <><label>Opens at minute {i + 1}{numeric(l.hours.opens, (opens) => patchLocation(i, { hours: { ...l.hours!, opens } }), 1439)}</label><label>Closes at minute {i + 1}{numeric(l.hours.closes, (closes) => patchLocation(i, { hours: { ...l.hours!, closes } }), 1439)}</label></>}
          <button title={`Remove location ${i + 1}`} disabled={peopleLocationReferences(l.id).length > 0} onClick={() => edit({ ...world, locations: world.locations.filter((_, j) => i !== j) })}>&times;</button>
          {peopleLocationReferences(l.id).length > 0 && <p className="progression-dependencies">Clear these references before removing {l.name}: {peopleLocationReferences(l.id).join(", ")}. Remove or retarget the listed schedule/override controls.</p>}
        </div>)}
        <button disabled={world.locations.length >= 60} onClick={() => edit({ ...world, locations: [...world.locations, { id: crypto.randomUUID(), name: "", parentId: null, passage: null, mapImage: null, marker: null, hours: null }] })}>Add location</button>
        <button onClick={() => {
          const rebind = (ref: { passageId: string; versionId: string } | null) => { const p = passages.find((p) => p.entityId === ref?.passageId); return p ? { passageId: p.entityId, versionId: p.id } : ref; };
          edit({ ...world, locations: world.locations.map((l) => ({ ...l, passage: rebind(l.passage) })), ...(world.progression ? { progression: { ...world.progression,
            events: world.progression.events.map((e) => ({ ...e, passage: rebind(e.passage) })), transitions: world.progression.transitions.map((t) => ({ ...t, passage: rebind(t.passage) })) } } : {}) });
        }}>Rebind current passages</button>
        <h3>Travel connections</h3>
        {world.connections.map((c, i) => <div className="world-row" key={c.id}>
          <label>From {i + 1}<select value={c.from} onChange={(e) => edit({ ...world, connections: world.connections.map((x, j) => j === i ? { ...x, from: e.target.value } : x) })}>{locationOptions(true)}</select></label>
          <label>To {i + 1}<select value={c.to} onChange={(e) => edit({ ...world, connections: world.connections.map((x, j) => j === i ? { ...x, to: e.target.value } : x) })}>{locationOptions(true)}</select></label>
          <label>Travel minutes {i + 1}{numeric(c.minutes, (minutes) => edit({ ...world, connections: world.connections.map((x, j) => j === i ? { ...x, minutes } : x) }))}</label>
          <button title={`Remove connection ${i + 1}`} onClick={() => edit({ ...world, connections: world.connections.filter((_, j) => i !== j) })}>&times;</button>
        </div>)}
        <button disabled={world.connections.length >= 100} onClick={() => edit({ ...world, connections: [...world.connections, { id: crypto.randomUUID(), from: "", to: "", minutes: 10 }] })}>Add connection</button>
        <h3>Local actions</h3>
        {world.actions.map((a, i) => { const patch = (p: Partial<typeof a>) => edit({ ...world, actions: world.actions.map((x, j) => j === i ? { ...x, ...p } : x) }); return <div className="world-row" key={a.id}>
          <label>Action location {i + 1}<select value={a.locationId} onChange={(e) => patch({ locationId: e.target.value })}>{locationOptions(true)}</select></label>
          <label>Action label {i + 1}<input value={a.label} maxLength={200} onChange={(e) => patch({ label: e.target.value })} /></label>
          <label>Action minutes {i + 1}{numeric(a.minutes, (minutes) => patch({ minutes }))}</label>
          <label>Action result {i + 1}<textarea value={a.result} maxLength={1000} onChange={(e) => patch({ result: e.target.value })} /></label>
          <button title={`Remove action ${i + 1}`} onClick={() => edit({ ...world, actions: world.actions.filter((_, j) => i !== j) })}>&times;</button>
        </div>; })}
        <button disabled={world.actions.length >= 100} onClick={() => edit({ ...world, actions: [...world.actions, { id: crypto.randomUUID(), locationId: "", label: "", minutes: 15, result: "" }] })}>Add action</button>
        <h3>Waiting</h3><div className="world-row">{world.waitMinutes.map((minutes, i) => <label key={i}>Wait minutes {i + 1}{numeric(minutes, (n) => edit({ ...world, waitMinutes: world.waitMinutes.map((x, j) => j === i ? n : x) }), 1440, 1)}
          <button disabled={world.waitMinutes.length <= 1} title={`Remove wait ${i + 1}`} onClick={() => edit({ ...world, waitMinutes: world.waitMinutes.filter((_, j) => i !== j) })}>&times;</button></label>)}</div>
        <button disabled={world.waitMinutes.length >= 6} onClick={() => edit({ ...world, waitMinutes: [...world.waitMinutes, 30] })}>Add wait duration</button>
        <ProgressionEditor progression={world.progression} locations={world.locations} passages={passages} people={world.people} onChange={(progression) => { const { progression: _old, ...base } = world; const next = progression ? { ...base, progression } : base; edit(world.people ? { ...next, people: { ...world.people, events: (progression?.events ?? []).map((e) => world.people!.events.find((r) => r.eventId === e.id) ?? { eventId: e.id, priority: 0, mandatory: false, characterIds: [] }) } } : next); }} />
        <PeopleEditor world={world} onChange={(people) => { const { people: _old, ...base } = world; edit(people ? { ...base, people } : base); }} />
      </>}
      <button onClick={() => void inspect()}>Review world</button>
    </fieldset>
    {review && <section aria-label="World review"><h3>World review</h3><WorldSummary world={review.world} />
      {review.diagnostics && <section aria-label="Progression diagnostics"><h4>Potential progression traps</h4><p>Limited static checks; these warnings are not an exhaustive proof of progression.</p>
        <p>{review.diagnostics.total} warning(s){review.diagnostics.omitted ? `; ${review.diagnostics.omitted} omitted from this bounded view` : ""}.</p>
        <ul>{review.diagnostics.findings.map((finding, i) => <li key={i}>{finding.message} ({finding.entityId})</li>)}</ul></section>}
      <details><summary>Previous definition</summary>{review.previous ? <WorldSummary world={review.previous} /> : <p>No world.</p>}</details>
      <details><summary>Exact version bindings</summary><pre>{JSON.stringify(review, null, 2)}</pre></details>
      <label className="world-check"><input type="checkbox" disabled={busy} checked={consent} onChange={(e) => setConsent(e.target.checked)} />I approve this exact world and time definition.</label>
      <button disabled={busy || !consent} onClick={() => void apply()}>Apply world</button>
    </section>}
  </section>;
}
function WorldSummary({ world }: { world: WorldDefinition }) {
  const name = (id: string | null) => world.locations.find((l) => l.id === id)?.name ?? "None";
  return <div><p>{world.enabled ? `Start: ${name(world.startLocationId)}; initial minutes: ${world.initialMinutes}` : "World disabled"}</p>
    {world.locations.map((l) => <p key={l.id}><strong>{l.name}</strong> · Parent: {name(l.parentId)} · {l.passage?.passageId ?? "Area only"} · Map: {l.mapImage ? "Approved image" : "None"} · Marker: {l.marker ? `${l.marker.x}, ${l.marker.y}` : "None"} · Hours: {l.hours ? `${l.hours.opens}–${l.hours.closes}` : "Always open"}</p>)}
    {world.connections.map((c) => <p key={c.id}>{name(c.from)} → {name(c.to)} · {c.minutes} min</p>)}
    {world.actions.map((a) => <p key={a.id}>{name(a.locationId)} · {a.label} · {a.minutes} min · {a.result}</p>)}
    {world.progression && <ProgressionSummary progression={world.progression} locations={world.locations} />}
    {world.people && <PeopleSummary world={world} />}
    <p>Wait: {world.waitMinutes.join(", ")} min</p>
  </div>;
}
