import { useEffect, useRef, useState } from "react";
import { SCENE_BATCH_LIMIT, sceneDefaultKey, type IllustratedScene, type SceneBatchSelection, type SceneDefaultSlot } from "@story-to-cyoa/domain";
import type { PassagePlanState } from "../../api/passage-plan.js";
import { assetPath, assetRequest, type AssetList } from "../../api/asset-library.js";
import "./scene-batch.css";

type Image = NonNullable<IllustratedScene["background"]>;
type Entry = { slot: SceneDefaultSlot; image: Image; targetName: string | null; stale: boolean };
type Change = { slot: SceneDefaultSlot; image: Image | null };
type ReviewedScene = Omit<IllustratedScene, "dialogue"> & { dialogueLineCount: number };
type BatchRow = { passageId: string; before: ReviewedScene | null; after: ReviewedScene | null; reasons: string[]; unresolved: string[]; changed: boolean };
const positions = ["left", "center", "right"] as const;

export function SceneBatchWorkspace({ projectId, passages, onApply }: { projectId: string; passages: PassagePlanState["passages"]; onApply: () => void }) {
  const [entries, setEntries] = useState<Entry[]>([]), [assets, setAssets] = useState<AssetList["items"]>([]);
  const [assetVersion, setAssetVersion] = useState(""), [passageId, setPassageId] = useState("");
  const [selection, setSelection] = useState<SceneBatchSelection>([]);
  const [defaultReview, setDefaultReview] = useState<{ change: Change; previous: Entry | null; fingerprint: string } | null>(null);
  const [batchReview, setBatchReview] = useState<{ fingerprint: string; ready: boolean; passages: BatchRow[] } | null>(null);
  const [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const operation = useRef<{ fingerprint: string; id: string } | null>(null);
  const call = <T,>(tool: string, input: unknown = {}) => assetRequest<T>(`/api/long-form/projects/${encodeURIComponent(projectId)}/scenes/${tool}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  const refresh = async () => {
    const base = assetPath(projectId);
    const get = (offset: number) => assetRequest<AssetList>(`${base}?approvedOnly=true&offset=${offset}`);
    const [{ entries }, first] = await Promise.all([call<{ entries: Entry[] }>("read_scene_defaults"), get(0)]);
    const rest = await Promise.all(Array.from({ length: Math.max(0, Math.ceil(first.total / 25) - 1) }, (_, i) => get((i + 1) * 25)));
    setEntries(entries); setAssets([first, ...rest].flatMap(page => page.items));
  };
  const invalidate = () => { setBatchReview(null); setDefaultReview(null); setConsent(false); };
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setMessage("");
    try { await action(); } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  };
  useEffect(() => { void run(refresh); }, [projectId]);
  const label = (entry: Entry) => {
    const name = entry.targetName ?? (entry.slot.kind === "background" ? entry.slot.locationId : entry.slot.characterId);
    return `${name}${entry.slot.kind === "portrait" ? ` / ${entry.slot.expressionKey}` : ""}${entry.stale ? " (missing binding)" : ""}`;
  };
  const candidates = assets.flatMap((asset) => {
    const d = asset.metadata.designation;
    const slot: SceneDefaultSlot | null = d?.role === "background" && d.locationId ? { kind: "background", locationId: d.locationId }
      : d?.role === "portrait" && d.characterId && d.expressionKey ? { kind: "portrait", characterId: d.characterId, expressionKey: d.expressionKey } : null;
    return slot && !asset.bindingStale ? [{ asset, slot }] : [];
  });
  const choice = candidates.find(({ asset }) => asset.versionId === assetVersion);
  const inspect = (change: Change) => void run(async () => {
    invalidate(); setDefaultReview(await call("review_scene_default", { change }));
  });
  const apply = (tool: string, fingerprint: string, input: unknown) => call(tool, {
    ...(input as object), fingerprint, approved: true,
    operationId: (operation.current?.fingerprint === fingerprint ? operation.current : (operation.current = { fingerprint, id: crypto.randomUUID() })).id,
  });
  const update = (next: SceneBatchSelection) => { setSelection(next); invalidate(); };
  const edit = (value: SceneBatchSelection[number]) => update(selection.map(item => item.passageId === value.passageId ? value : item));
  const assetLabel = (image: Image) => `${assets.find(asset => asset.versionId === image.versionId)?.metadata.title ?? image.assetId} · ${image.versionId}`;
  const title = (id: string) => passages.find(p => p.entityId === id)?.content.title ?? id;
  function summarize(scene: ReviewedScene | null) {
    if (!scene) return <p>No scene</p>;
    return <dl className="scene-batch-summary">
      <dt>Layout</dt><dd>{scene.layout}</dd>
      <dt>Background</dt><dd>{scene.background ? assetLabel(scene.background) : "None"}</dd>
      <dt>Portraits</dt><dd>{scene.portraits.length ? <ul>{scene.portraits.map(p => <li key={p.position}>{p.position}: {p.character} / {p.expression} · {assetLabel(p.image)}</li>)}</ul> : "None"}</dd>
      <dt>Dialogue</dt><dd>{scene.dialogueLineCount} lines (unchanged)</dd>
    </dl>;
  }
  return <div className="scene-batch-workspace">
    {message && <p role="status">{message}</p>}
    <fieldset disabled={busy} className="scene-editor-form">
      <legend>Scene defaults</legend>
      <button type="button" onClick={() => void run(async () => { invalidate(); await refresh(); })}>Refresh defaults and approved assets</button>
      <label>Approved image for default<select value={assetVersion} onChange={e => { setAssetVersion(e.target.value); invalidate(); }}>
        <option value="">Select an image</option>
        {candidates.map(({ asset, slot }) => <option key={asset.versionId} value={asset.versionId}>{asset.metadata.title} / {slot.kind === "background" ? slot.locationId : `${slot.characterId} / ${slot.expressionKey}`}</option>)}
      </select></label>
      <button disabled={!choice} onClick={() => choice && inspect({ slot: choice.slot, image: { assetId: choice.asset.assetId, versionId: choice.asset.versionId } })}>Review setting default</button>
      <ul>{entries.map(entry => <li key={sceneDefaultKey(entry.slot)}>
        <span>{entry.slot.kind}: {label(entry)} · {assetLabel(entry.image)}</span>{" "}
        <button onClick={() => inspect({ slot: entry.slot, image: null })}>Review clearing {label(entry)}</button>
      </li>)}</ul>
      {defaultReview && <section aria-label="Default change review">
        <p>{sceneDefaultKey(defaultReview.change.slot)}</p>
        <p>Previous: {defaultReview.previous ? assetLabel(defaultReview.previous.image) : "None"}</p>
        <p>Proposed: {defaultReview.change.image ? assetLabel(defaultReview.change.image) : "None"}</p>
        <label className="scene-check"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />I approve this exact default change.</label>
        <button disabled={!consent} onClick={() => void run(async () => {
          await apply("apply_scene_default", defaultReview.fingerprint, { change: defaultReview.change });
          invalidate(); await refresh(); setMessage("Default applied. Existing scenes are unchanged.");
        })}>Apply default</button>
      </section>}
    </fieldset>
    <fieldset disabled={busy} className="scene-editor-form">
      <legend>Batch scene assignment ({selection.length}/{SCENE_BATCH_LIMIT})</legend>
      <label>Passage to add<select value={passageId} onChange={e => setPassageId(e.target.value)}>
        <option value="">Select a passage</option>
        {passages.filter(p => !selection.some(item => item.passageId === p.entityId)).map(p => <option key={p.entityId} value={p.entityId}>{p.content.title}</option>)}
      </select></label>
      <button disabled={!passageId || selection.length >= SCENE_BATCH_LIMIT} onClick={() => {
        update([...selection, { passageId, portraits: [] }]); setPassageId("");
      }}>Add passage to batch</button>
      {selection.map(item => <fieldset key={item.passageId} className="scene-editor-form">
        <legend>{title(item.passageId)}</legend>
        <button onClick={() => update(selection.filter(value => value !== item))}>Remove {title(item.passageId)} from batch</button>
        <label>Background location<select value={item.background?.locationId ?? ""} onChange={e => edit({ ...item, background: e.target.value ? { locationId: e.target.value } : undefined })}>
          <option value="">No background change</option>
          {entries.filter(entry => entry.slot.kind === "background").map(entry => entry.slot.kind === "background" && <option key={entry.slot.locationId} value={entry.slot.locationId}>{label(entry)}</option>)}
        </select></label>
        {item.background && <label className="scene-check"><input type="checkbox" checked={Boolean(item.background.replace)} onChange={e => edit({ ...item, background: { ...item.background!, replace: e.target.checked } })} />Replace existing background</label>}
        {positions.map(position => {
          const portrait = item.portraits.find(p => p.position === position);
          const remaining = item.portraits.filter(p => p.position !== position);
          return <div key={position}>
            <label>{position} portrait<select value={portrait ? sceneDefaultKey({ kind: "portrait", characterId: portrait.characterId, expressionKey: portrait.expressionKey }) : ""}
              onChange={e => {
                const slot = entries.find(entry => sceneDefaultKey(entry.slot) === e.target.value)?.slot;
                edit({ ...item, portraits: slot?.kind === "portrait" ? [...remaining, { characterId: slot.characterId, expressionKey: slot.expressionKey, position }] : remaining });
              }}>
              <option value="">No portrait change</option>
              {entries.filter(entry => entry.slot.kind === "portrait").map(entry => <option key={sceneDefaultKey(entry.slot)} value={sceneDefaultKey(entry.slot)}>{label(entry)}</option>)}
            </select></label>
            {portrait && <label className="scene-check"><input type="checkbox" checked={Boolean(portrait.replace)} onChange={e => edit({ ...item, portraits: [...remaining, { ...portrait, replace: e.target.checked }] })} />Replace existing {position} portrait</label>}
          </div>;
        })}
      </fieldset>)}
      <button disabled={!selection.length} onClick={() => void run(async () => { invalidate(); setBatchReview(await call("review_scene_batch", { selection })); })}>Review batch</button>
      {batchReview && <section aria-label="Scene batch review">
        {batchReview.passages.map(row => <section key={row.passageId}>
          <h3>{title(row.passageId)}</h3>
          <h4>Before</h4>{summarize(row.before)}
          <h4>After{row.changed ? "" : " (unchanged)"}</h4>{summarize(row.after)}
          {(row.reasons.length > 0 || row.unresolved.length > 0) && <ul>{row.reasons.map((reason, index) => <li key={index}>{reason}</li>)}
            {row.unresolved.map((issue, index) => <li key={`unresolved-${index}`} className="warning">{issue}</li>)}</ul>}
        </section>)}
        {batchReview.ready && <label className="scene-check"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />I approve this exact scene batch.</label>}
        <button disabled={!batchReview.ready || !consent} onClick={() => void run(async () => {
          await apply("apply_scene_batch", batchReview.fingerprint, { selection });
          update([]); onApply(); setMessage("Scene batch applied. Existing builds are unchanged.");
        })}>Apply scene batch</button>
      </section>}
    </fieldset>
  </div>;
}
