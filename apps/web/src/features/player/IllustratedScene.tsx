import { useState } from "react";
import type { IllustratedPresentation } from "@story-to-cyoa/runtime";
import "./illustrated-scene.css";

export function IllustratedScene({ presentation, passageId }: { presentation: IllustratedPresentation; passageId: string }) {
  const [failed, setFailed] = useState<string[]>([]);
  const scene = presentation.scenes.find((s) => s.passageId === passageId);
  if (!scene) return null;
  const image = (id: string | null, className: string, caption?: string) => {
    const asset = presentation.assets.find((a) => a.id === id);
    if (!asset) return null;
    return <figure className={className}>
      {failed.includes(asset.id) ? <p className="scene-art-fallback">{asset.altText || caption || "Artwork unavailable"}</p>
        : <img src={asset.dataUrl} alt={asset.altText || caption || "Scene artwork"} onError={() => setFailed((ids) => [...new Set([...ids, asset.id])])} />}
      {caption && <figcaption>{caption}</figcaption>}
    </figure>;
  };
  const used = new Set([scene.background, ...scene.portraits.map((p) => p.image)]);
  return <section className="illustrated-scene" aria-label="Illustrated scene">
    <div className="scene-stage">
      {image(scene.background, "scene-background")}
      <div className="scene-portraits">{scene.portraits.map((p) => <div key={p.position} className={`scene-portrait scene-portrait-${p.position}`}>
        {image(p.image, "scene-character", `${p.character} \u00b7 ${p.expression}`)}
      </div>)}</div>
    </div>
    {scene.dialogue.length > 0 && <div className="scene-dialogue" aria-label="Dialogue">{scene.dialogue.map((line, i) => <p key={i}><strong>{line.speaker}</strong><span>{line.text}</span></p>)}</div>}
    {presentation.assets.some((a) => used.has(a.id) && (a.credit || a.license)) && <details className="scene-credits"><summary>Artwork credits</summary>
      {presentation.assets.filter((a) => used.has(a.id)).map((a) => <p key={a.id}>{a.credit}{a.license ? ` (${a.license})` : ""}</p>)}
    </details>}
  </section>;
}
