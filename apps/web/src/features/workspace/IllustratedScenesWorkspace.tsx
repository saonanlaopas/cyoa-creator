import { useEffect, useRef, useState } from "react";
import type { IllustratedScene as Scene } from "@story-to-cyoa/domain";
import type { IllustratedPresentation } from "@story-to-cyoa/runtime";
import { loadPassagePlan, type PassagePlanState } from "../../api/passage-plan.js";
import { assetPath, assetRequest, type AssetDetail, type AssetList } from "../../api/asset-library.js";
import { IllustratedScene } from "../player/IllustratedScene.js";

type Review = { fingerprint: string; previous: Scene | null; scene: Scene };
export function IllustratedScenesWorkspace({ projectId }: { projectId: string }) {
  const [passages, setPassages] = useState<PassagePlanState["passages"]>([]), [selected, setSelected] = useState("");
  const [scene, setScene] = useState<Scene | null>(null), [review, setReview] = useState<Review | null>(null), [consent, setConsent] = useState(false);
  const [assets, setAssets] = useState<AssetList>({ total: 0, offset: 0, items: [] }), [offset, setOffset] = useState(0);
  const [images, setImages] = useState<Record<string, AssetDetail["selected"]>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState("");
  const sequence = useRef(0), operation = useRef<{ key: string; id: string } | null>(null);
  const call = <T,>(tool: string, input: unknown) => assetRequest<T>(`/api/long-form/projects/${encodeURIComponent(projectId)}/scenes/${tool}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  useEffect(() => { let active = true;
    void loadPassagePlan(projectId).then((state) => { if (active) { setPassages(state.passages); setSelected(state.passages[0]?.entityId ?? ""); } }).catch((e) => active && setError(String(e)));
    return () => { active = false; sequence.current++; };
  }, [projectId]);
  useEffect(() => { let active = true;
    void assetRequest<AssetList>(`${assetPath(projectId)}?offset=${offset}`).then((list) => active && setAssets(list)).catch((e) => active && setError(String(e)));
    return () => { active = false; };
  }, [projectId, offset]);
  const load = async () => {
    const n = ++sequence.current; setReview(null); setConsent(false); setScene(null); setError(null); setBusy(true);
    try { const result = await call<{ scene: Scene; passageVersionId: string; stale: boolean }>("read_scene", { passageId: selected });
      if (n !== sequence.current) return;
      setScene({ ...result.scene, passageVersionId: result.passageVersionId });
      setNotice(result.stale ? "Passage changed. Review this scene against the current passage before applying." : "");
    } catch (e) { if (n === sequence.current) setError(String(e)); }
    finally { if (n === sequence.current) setBusy(false); }
  };
  useEffect(() => { if (selected) void load(); }, [projectId, selected]);
  useEffect(() => {
    let active = true;
    const refs = scene ? [...(scene.background ? [scene.background] : []), ...scene.portraits.map((p) => p.image)] : [];
    for (const ref of refs) if (!images[ref.versionId]) void assetRequest<AssetDetail>(`${assetPath(projectId)}/${ref.assetId}?versionId=${encodeURIComponent(ref.versionId)}`)
      .then((detail) => active && setImages((old) => ({ ...old, [ref.versionId]: detail.selected }))).catch((e) => active && setError(String(e)));
    return () => { active = false; };
  }, [projectId, scene, images]);
  const edit = (value: Scene) => { setScene(value); setReview(null); setConsent(false); operation.current = null; setNotice(""); };
  const selectImage = (versionId: string) => {
    const item = assets.items.find((a) => a.approvedVersionId === versionId);
    return item && versionId ? { assetId: item.assetId, versionId } : null;
  };
  const options = (current: Scene["background"]) => <>
    <option value="">None</option>
    {current && !assets.items.some((a) => a.approvedVersionId === current.versionId) && <option value={current.versionId}>{images[current.versionId]?.content.metadata.title ?? "Pinned approved image"}</option>}
    {assets.items.filter((a) => a.approvedVersionId).map((a) => <option key={a.assetId} value={a.approvedVersionId!}>{a.metadata.title}</option>)}
  </>;
  const presentation: IllustratedPresentation = { schemaId: "cyoa.illustrated-presentation", schemaVersion: 1,
    assets: Object.values(images).map((a) => ({ id: a.id, dataUrl: a.image.url, ...a.content.metadata })),
    scenes: scene?.layout === "illustrated" ? [{ passageId: scene.passageId, background: scene.background?.versionId ?? null,
      portraits: scene.portraits.map((p) => ({ ...p, image: p.image.versionId })), dialogue: scene.dialogue }] : [],
  };
  const inspect = async () => { if (!scene) return; setBusy(true); setError(null); setReview(null); setConsent(false);
    try { setReview(await call<Review>("review_scene", { scene })); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  const apply = async () => { if (!review || !consent || !scene) return; setBusy(true); setError(null);
    const key = JSON.stringify({ scene, fingerprint: review.fingerprint });
    if (operation.current?.key !== key) operation.current = { key, id: crypto.randomUUID() };
    try { await call("apply_scene", { scene, fingerprint: review.fingerprint, operationId: operation.current.id, approved: true }); await load(); setNotice("Scene applied. Existing builds are unchanged."); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  return <section className="artifact-pane scene-editor" aria-label="Illustrated scenes">
    <h2>Illustrated scenes</h2>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className="scene-editor-top"><label>Passage<select disabled={busy} value={selected} onChange={(e) => setSelected(e.target.value)}>{passages.map((p) => <option key={p.entityId} value={p.entityId}>{p.content.title}</option>)}</select></label>
      <button title="Reload scene" disabled={busy || !selected} onClick={() => void load()}>Reload</button>
      <span>{assets.total} assets</span><button title="Previous asset page" disabled={offset === 0 || busy} onClick={() => setOffset(Math.max(0, offset - 25))}>&larr;</button>
      <button title="Next asset page" disabled={offset + 25 >= assets.total || busy} onClick={() => setOffset(offset + 25)}>&rarr;</button>
    </div>
    {!passages.length && <p>No passages.</p>}
    {scene && <div className="scene-editor-fields"><fieldset className="scene-editor-form" disabled={busy}>
      <legend>{passages.find((p) => p.entityId === selected)?.content.title}</legend>
      <label>Layout<select value={scene.layout} onChange={(e) => edit({ ...scene, layout: e.target.value as Scene["layout"], ...(e.target.value === "text" ? { background: null, portraits: [], dialogue: [] } : {}) })}><option value="text">Text</option><option value="illustrated">Illustrated</option></select></label>
      {scene.layout === "illustrated" && <>
        <label>Background<select value={scene.background?.versionId ?? ""} onChange={(e) => edit({ ...scene, background: selectImage(e.target.value) })}>{options(scene.background)}</select></label>
        <h3>Portraits</h3>
        {scene.portraits.map((p, i) => <div className="scene-editor-row" key={i}>
          <label>Character {i + 1}<input maxLength={100} value={p.character} onChange={(e) => edit({ ...scene, portraits: scene.portraits.map((v, j) => i === j ? { ...v, character: e.target.value } : v) })} /></label>
          <label>Expression {i + 1}<input maxLength={100} value={p.expression} onChange={(e) => edit({ ...scene, portraits: scene.portraits.map((v, j) => i === j ? { ...v, expression: e.target.value } : v) })} /></label>
          <button title={`Remove portrait ${i + 1}`} onClick={() => edit({ ...scene, portraits: scene.portraits.filter((_, j) => i !== j) })}>&times;</button>
          <label>Position {i + 1}<select value={p.position} onChange={(e) => edit({ ...scene, portraits: scene.portraits.map((v, j) => i === j ? { ...v, position: e.target.value as typeof p.position } : v) })}>{["left", "center", "right"].map((position) => <option key={position}>{position}</option>)}</select></label>
          <label>Portrait image {i + 1}<select value={p.image.versionId} onChange={(e) => { const image = selectImage(e.target.value); if (image) edit({ ...scene, portraits: scene.portraits.map((v, j) => i === j ? { ...v, image } : v) }); }}>{options(p.image)}</select></label>
        </div>)}
        <button disabled={scene.portraits.length >= 3 || !assets.items.some((a) => a.approvedVersionId)} onClick={() => {
          const image = selectImage(assets.items.find((a) => a.approvedVersionId)!.approvedVersionId!)!;
          edit({ ...scene, portraits: [...scene.portraits, { character: "", expression: "", position: (["left", "center", "right"] as const).find((p) => !scene.portraits.some((v) => v.position === p))!, image }] });
        }}>Add portrait</button>
        <h3>Dialogue</h3>
        {scene.dialogue.map((line, i) => <div className="scene-editor-row" key={i}>
          <label>Speaker {i + 1}<input maxLength={100} value={line.speaker} onChange={(e) => edit({ ...scene, dialogue: scene.dialogue.map((v, j) => i === j ? { ...v, speaker: e.target.value } : v) })} /></label>
          <button title={`Remove dialogue ${i + 1}`} onClick={() => edit({ ...scene, dialogue: scene.dialogue.filter((_, j) => i !== j) })}>&times;</button>
          <label className="scene-editor-wide">Dialogue {i + 1}<textarea maxLength={2000} value={line.text} onChange={(e) => edit({ ...scene, dialogue: scene.dialogue.map((v, j) => i === j ? { ...v, text: e.target.value } : v) })} /></label>
        </div>)}
        <button disabled={scene.dialogue.length >= 12} onClick={() => edit({ ...scene, dialogue: [...scene.dialogue, { speaker: "", text: "" }] })}>Add dialogue</button>
      </>}
      <button disabled={busy} onClick={() => void inspect()}>Review scene</button>
    </fieldset><div><IllustratedScene presentation={presentation} passageId={scene.passageId} />
      {scene.layout === "text" && <p>Text layout</p>}
      {review && <section className="scene-editor-review" aria-label="Scene review"><h3>Scene review</h3>
        <h4>Previous scene</h4>
        {review.previous ? <SceneSummary scene={review.previous} images={images} /> : <p>No scene assigned.</p>}
        <h4>Reviewed scene</h4><SceneSummary scene={review.scene} images={images} />
        <details><summary>Exact version bindings</summary><pre>{JSON.stringify({ previous: review.previous, reviewed: review.scene }, null, 2)}</pre></details>
        <label className="scene-check"><input type="checkbox" disabled={busy} checked={consent} onChange={(e) => setConsent(e.target.checked)} />I approve this exact scene and image selection.</label>
        <button disabled={busy || !consent} onClick={() => void apply()}>Apply scene</button>
      </section>}
    </div></div>}
  </section>;
}

function SceneSummary({ scene, images }: { scene: Scene; images: Record<string, AssetDetail["selected"]> }) {
  return <div><dl>
    <dt>Layout</dt><dd>{scene.layout}</dd>
    <dt>Background</dt><dd>{scene.background ? images[scene.background.versionId]?.content.metadata.title ?? scene.background.versionId : "None"}</dd>
    <dt>Portraits</dt><dd>{scene.portraits.length ? scene.portraits.map((p) => `${p.character}: ${p.expression} (${p.position})`).join("; ") : "None"}</dd>
  </dl>{scene.dialogue.map((line, i) => <p key={i}><strong>{line.speaker}: </strong>{line.text}</p>)}</div>;
}
