import "./authoring-settings.css";
import { useEffect, useState } from "react";
import type { AuthoringSettings, FictionCraftSnapshot } from "@story-to-cyoa/domain";
type SettingsView = Omit<AuthoringSettings, "guide"> & { guide: Pick<FictionCraftSnapshot, "id" | "version" | "sha256"> | null };
type State = { versionId: string | null; settings: SettingsView };
type Review = { fingerprint: string; after: SettingsView; effect: string; retainedCustomInstructions: Array<{ name: string }> };
/** A separate creative preference batch, never a content approval. */
export function AuthoringSettingsPanel({ projectId }: { projectId: string }) {
  const [state, setState] = useState<State | null>(null), [enabled, setEnabled] = useState(false);
  const [review, setReview] = useState<Review | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  async function call<T>(tool: string, body: object = {}): Promise<T> {
    const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/authoring/${tool}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await r.json(); if (!r.ok) throw new Error(data.error ?? "Could not update authoring settings");
    if (tool === "read_authoring_settings" && (!data?.settings || typeof data.settings.enabled !== "boolean" || !(data.versionId === null || typeof data.versionId === "string"))) throw new Error("Creator returned invalid authoring settings");
    if (tool === "review_authoring_settings" && (!data?.after || typeof data.after.enabled !== "boolean" || typeof data.fingerprint !== "string" || !Array.isArray(data.retainedCustomInstructions))) throw new Error("Creator returned an invalid preference review");
    return data as T;
  }
  useEffect(() => { let current = true; setState(null); setReview(null); setError(""); setNotice("");
    call<State>("read_authoring_settings").then(s => { if (current) { setState(s); setEnabled(s.settings.enabled); } }).catch(e => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [projectId]);
  async function preview() { setBusy(true); setError(""); setNotice(""); try { setReview(await call<Review>("review_authoring_settings", { expectedVersionId: state!.versionId, enabled })); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function apply() { if (!state || !review) return; setBusy(true); setError(""); try {
    // Retain exact retry arguments if the response is lost; changed reviews get a new UUID.
    const key = `cyoa.authoring-settings.retry.${projectId}`, args = { expectedVersionId: state.versionId, enabled, fingerprint: review.fingerprint, approved: true };
    const old = sessionStorage.getItem(key), saved = old ? JSON.parse(old) as { args: typeof args; operationId: string } : null;
    const operationId = saved && JSON.stringify(saved.args) === JSON.stringify(args) ? saved.operationId : crypto.randomUUID();
    sessionStorage.setItem(key, JSON.stringify({ args, operationId }));
    await call("apply_authoring_settings", { ...args, operationId }); sessionStorage.removeItem(key);
    const next = await call<State>("read_authoring_settings"); setState(next); setEnabled(next.settings.enabled); setReview(null); setNotice("Authoring preference saved. Existing content approvals are unchanged.");
  } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  return <details className="panel authoring-settings"><summary>Fiction Craft preferences</summary>
    {state && <><p>{state.settings.guide ? `Selected guide ${state.settings.guide.version}` : "Legacy project: shared guide was not enabled automatically."}</p>
      <label><input type="checkbox" checked={enabled} disabled={busy} onChange={e => { setEnabled(e.target.checked); setReview(null); }} /> Use the shared Fiction Craft Guide for future authoring</label>
      <p>Your custom instructions and approved project direction take precedence over these craft defaults. Turning the guide off preserves both.</p>
      <button disabled={busy || enabled === state.settings.enabled} onClick={() => void preview()}>Review preference change</button>
      {review && <div aria-label="Fiction Craft preference review"><p>{review.after.enabled ? "Enable" : "Disable"} Fiction Craft {review.after.guide?.version}.</p><p>{review.effect}</p><p>{review.retainedCustomInstructions.length} custom instructions retained.</p><button disabled={busy} onClick={() => void apply()}>Apply reviewed preference</button><button disabled={busy} onClick={() => setReview(null)}>Cancel preference change</button></div>}
    </>}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error} Refresh the project to read current settings before reviewing again.</p>}
  </details>;
}
