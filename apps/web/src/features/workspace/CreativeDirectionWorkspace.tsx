import { useEffect, useState } from "react";
import {
  adoptLegacyCreativeDirection,
  approveCreativeDirection,
  downloadCreativeDirection,
  previewCreativeDirectionContext,
  saveCreativeDirection,
  type ArtifactVersion,
  type CreativeDirection,
  type WorkflowState,
} from "../../api/long-form.js";

const lines = (value: string) => value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

export function CreativeDirectionWorkspace(props: {
  projectId: string;
  direction: ArtifactVersion<CreativeDirection> | null;
  workflow: WorkflowState;
  busy: boolean;
  message: string | null;
  setBusy(value: boolean): void;
  setMessage(value: string | null): void;
  onChanged(): Promise<void> | void;
}) {
  const [draft, setDraft] = useState(props.direction?.content ?? null);
  const [contextPreview, setContextPreview] = useState<Record<string, unknown> | null>(null);
  useEffect(() => setDraft(props.direction?.content ?? null), [props.direction?.id]);

  if (!draft || !props.direction) return <section className="artifact-pane">
    <header className="artifact-header"><div><p className="eyebrow">Stage 2</p><h1>Creative Direction</h1></div></header>
    <div className="panel">
      <h2>Adopt presentation direction</h2>
      <p>This older project has no Creative Direction. Its Brief, Bible, prose, exports, and playthroughs remain unchanged.</p>
      <p>Create a reviewable draft from legacy tone, point-of-view, and prose guidance. Nothing is approved automatically.</p>
      <button className="primary" disabled={props.busy} onClick={async () => {
        props.setBusy(true); props.setMessage(null);
        try {
          const result = await adoptLegacyCreativeDirection(props.projectId);
          props.setMessage(result.conflicts.length ? `Draft created. Review: ${result.conflicts.join(" ")}` : "Legacy presentation fields were projected into a reviewable draft.");
          await props.onChanged();
        } catch (error) { props.setMessage((error as Error).message); }
        finally { props.setBusy(false); }
      }}>Create adoption draft</button>
    </div>
  </section>;

  const update = <K extends keyof CreativeDirection>(key: K, value: CreativeDirection[K]) => setDraft({ ...draft, [key]: value });
  const save = async () => {
    props.setBusy(true); props.setMessage(null);
    try {
      const provenance = ["tone", "pacing", "prose", "relationshipPresentation", "scopedVariations"]
        .filter((key) => JSON.stringify(draft[key as keyof CreativeDirection]) !== JSON.stringify(props.direction!.content[key as keyof CreativeDirection]))
        .map((key) => ({ fieldPath: `/${key}`, reference: {
          kind: "manual-edit" as const, versionId: props.direction!.id, excerpt: "Changed in the Creative Direction editor",
        } }));
      await saveCreativeDirection(props.projectId, { ...draft, fieldProvenance: [...draft.fieldProvenance, ...provenance] });
      props.setMessage("Creative Direction draft saved. Its material meaning is not authoritative until approved.");
      await props.onChanged();
    } catch (error) { props.setMessage((error as Error).message); }
    finally { props.setBusy(false); }
  };

  return <section className="artifact-pane creative-direction-workspace">
    <header className="artifact-header">
      <div>
        <p className="eyebrow">Stage 2 · What should this story feel and read like?</p>
        <h1>Creative Direction</h1>
        <p>Version {props.direction.version} · <span className={`workflow-status ${props.workflow.status}`}>{props.workflow.status}</span></p>
      </div>
      <div className="artifact-actions">
        <button onClick={() => void downloadCreativeDirection(props.projectId, "markdown")}>Export Markdown</button>
        <button onClick={() => void downloadCreativeDirection(props.projectId, "json")}>Export JSON</button>
        <button disabled={props.busy || props.workflow.approvedVersionId === props.direction.id} onClick={async () => {
          props.setBusy(true); props.setMessage(null);
          try { await approveCreativeDirection(props.projectId, props.direction!.id); props.setMessage("Creative Direction approved for future planning and prose work."); await props.onChanged(); }
          catch (error) { props.setMessage((error as Error).message); }
          finally { props.setBusy(false); }
        }}>Approve direction</button>
      </div>
    </header>

    {props.message && <p className={props.message.includes("approved") || props.message.includes("saved") ? "status good" : "warning"} role="status">{props.message}</p>}

    <section className="panel creative-direction-summary" aria-labelledby="creative-direction-summary-heading">
      <h2 id="creative-direction-summary-heading">At a glance</h2>
      <dl>
        <div><dt>Tone</dt><dd>{draft.tone.descriptors.join(" · ") || "Not described yet"}</dd></div>
        <div><dt>Pacing</dt><dd>{draft.pacing.developmentPace} · {draft.pacing.sceneTreatment}</dd></div>
        <div><dt>Prose</dt><dd>{draft.prose.treatment} · {draft.prose.descriptiveness} · {draft.prose.pointOfView} · {draft.prose.interiority} interiority</dd></div>
        <div><dt>Relationships</dt><dd>{draft.relationshipPresentation?.profiles.length ?? 0} configured profile(s)</dd></div>
      </dl>
    </section>

    <form className="brief-editor" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <section className="brief-section">
        <h2>Tone</h2>
        <label>Desired tone <span>One descriptor per line; custom words are welcome</span>
          <textarea value={draft.tone.descriptors.join("\n")} onChange={(event) => update("tone", { ...draft.tone, descriptors: lines(event.target.value) })} />
        </label>
        <div className="brief-grid">
          <label>Tonal range<select value={draft.tone.tonalRange} onChange={(event) => update("tone", { ...draft.tone, tonalRange: event.target.value as CreativeDirection["tone"]["tonalRange"] })}>
            <option value="focused">Focused</option><option value="moderate">Moderate</option><option value="wide">Wide</option>
          </select></label>
          <label>Avoid these tones<textarea value={draft.tone.exclusions.join("\n")} onChange={(event) => update("tone", { ...draft.tone, exclusions: lines(event.target.value) })} /></label>
        </div>
        <label>Custom tone guidance<textarea value={draft.tone.customGuidance} onChange={(event) => update("tone", { ...draft.tone, customGuidance: event.target.value })} /></label>
      </section>

      <section className="brief-section">
        <h2>Pacing</h2>
        <div className="brief-grid">
          <Select label="Development pace" value={draft.pacing.developmentPace} values={["very-slow", "slow-burn", "measured", "brisk", "rapid"]} onChange={(value) => update("pacing", { ...draft.pacing, developmentPace: value as CreativeDirection["pacing"]["developmentPace"] })} />
          <Select label="Scene treatment" value={draft.pacing.sceneTreatment} values={["scene-focused", "balanced", "summary-forward"]} onChange={(value) => update("pacing", { ...draft.pacing, sceneTreatment: value as CreativeDirection["pacing"]["sceneTreatment"] })} />
          <Select label="Action intensity" value={draft.pacing.actionIntensity} values={["low", "moderate", "high", "variable"]} onChange={(value) => update("pacing", { ...draft.pacing, actionIntensity: value as CreativeDirection["pacing"]["actionIntensity"] })} />
          <Select label="Narrative density" value={draft.pacing.narrativeDensity} values={["spacious", "balanced", "dense"]} onChange={(value) => update("pacing", { ...draft.pacing, narrativeDensity: value as CreativeDirection["pacing"]["narrativeDensity"] })} />
          <Select label="Transition density" value={draft.pacing.transitionDensity} values={["sparse", "balanced", "frequent"]} onChange={(value) => update("pacing", { ...draft.pacing, transitionDensity: value as CreativeDirection["pacing"]["transitionDensity"] })} />
          <Select label="Escalation shape" value={draft.pacing.escalationShape} values={["steady", "stepped", "wave", "late-surge", "custom"]} onChange={(value) => update("pacing", { ...draft.pacing, escalationShape: value as CreativeDirection["pacing"]["escalationShape"] })} />
        </div>
        <label className="checkbox-line"><input type="checkbox" checked={draft.pacing.quietScenesAllowed} onChange={(event) => update("pacing", { ...draft.pacing, quietScenesAllowed: event.target.checked })} />Allow quiet scenes</label>
        <label>Custom pacing guidance<textarea value={draft.pacing.customGuidance} onChange={(event) => update("pacing", { ...draft.pacing, customGuidance: event.target.value })} /></label>
      </section>

      <details className="brief-section advanced-editor">
        <summary><strong>Advanced prose and scoped presentation</strong><span> Exact POV, tense, voice, relationship profiles, and route/act variations</span></summary>
        <section>
          <h2>Prose treatment</h2>
          <div className="brief-grid">
            <Select label="Descriptiveness" value={draft.prose.descriptiveness} values={["restrained", "balanced", "descriptive", "lush"]} onChange={(value) => update("prose", { ...draft.prose, descriptiveness: value as CreativeDirection["prose"]["descriptiveness"] })} />
            <Select label="Treatment" value={draft.prose.treatment} values={["compact", "balanced", "long-form"]} onChange={(value) => update("prose", { ...draft.prose, treatment: value as CreativeDirection["prose"]["treatment"] })} />
            <Select label="Point of view" value={draft.prose.pointOfView} values={["first-person", "second-person", "third-person-close", "third-person-omniscient", "mixed"]} onChange={(value) => update("prose", { ...draft.prose, pointOfView: value as CreativeDirection["prose"]["pointOfView"] })} />
            <Select label="Tense" value={draft.prose.tense} values={["past", "present", "mixed"]} onChange={(value) => update("prose", { ...draft.prose, tense: value as CreativeDirection["prose"]["tense"] })} />
            <Select label="Interiority" value={draft.prose.interiority} values={["low", "moderate", "high"]} onChange={(value) => update("prose", { ...draft.prose, interiority: value as CreativeDirection["prose"]["interiority"] })} />
            <Select label="Dialogue integration" value={draft.prose.dialogueIntegration} values={["sparse", "balanced", "integrated", "dialogue-forward"]} onChange={(value) => update("prose", { ...draft.prose, dialogueIntegration: value as CreativeDirection["prose"]["dialogueIntegration"] })} />
            <Select label="Scene transitions" value={draft.prose.sceneTransitionDensity} values={["sparse", "balanced", "frequent"]} onChange={(value) => update("prose", { ...draft.prose, sceneTransitionDensity: value as CreativeDirection["prose"]["sceneTransitionDensity"] })} />
            <Select label="Passage length preference" value={draft.prose.passageLengthPreference} values={["compact", "moderate", "expansive", "variable"]} onChange={(value) => update("prose", { ...draft.prose, passageLengthPreference: value as CreativeDirection["prose"]["passageLengthPreference"] })} />
          </div>
          <div className="brief-grid">
            <label>Voice and style descriptors<textarea value={draft.prose.voiceDescriptors.join("\n")} onChange={(event) => update("prose", { ...draft.prose, voiceDescriptors: lines(event.target.value) })} /></label>
            <label>Avoid list<textarea value={draft.prose.avoid.join("\n")} onChange={(event) => update("prose", { ...draft.prose, avoid: lines(event.target.value) })} /></label>
          </div>
          <label>Custom prose guidance<textarea value={draft.prose.customGuidance} onChange={(event) => update("prose", { ...draft.prose, customGuidance: event.target.value })} /></label>
        </section>

        <section>
          <header className="bible-section-heading"><h2>Relationship presentation <small>optional</small></h2><button type="button" onClick={() => update("relationshipPresentation", {
            ...(draft.relationshipPresentation ?? { profiles: [] }), profiles: [...(draft.relationshipPresentation?.profiles ?? []), {
              id: uid("relationship-profile"), relationshipKind: "friendship", participantIds: [], developmentStyle: "steady",
              emotionalTension: "moderate", melodrama: "moderate", mechanicsVisibility: "subtle", customGuidance: "", contentBoundaries: [],
            }],
          })}>Add profile</button></header>
          {(draft.relationshipPresentation?.profiles ?? []).length === 0 && <p className="field-note">No relationship profile is required. Mystery, horror, adventure, and general-fiction projects can leave this empty.</p>}
          {(draft.relationshipPresentation?.profiles ?? []).map((profile, index) => <article className="bible-card" key={profile.id}>
            <div className="brief-grid"><label>Stable profile ID<input value={profile.id} readOnly aria-readonly="true" /></label>
              <Select label="Kind" value={profile.relationshipKind} values={["romance", "friendship", "family", "rivalry", "partnership", "ensemble", "custom"]} onChange={(value) => updateProfile(draft, setDraft, index, { ...profile, relationshipKind: value as typeof profile.relationshipKind, ...(value === "romance" ? {} : { sensuality: undefined, physicalIntimacy: undefined }) })} /></div>
            {profile.relationshipKind === "custom" && <label>Custom kind<input value={profile.customKind ?? ""} onChange={(event) => updateProfile(draft, setDraft, index, { ...profile, customKind: event.target.value })} /></label>}
            <div className="brief-grid"><label>Relationship ID<input value={profile.relationshipId ?? ""} onChange={(event) => updateProfile(draft, setDraft, index, { ...profile, relationshipId: event.target.value || undefined })} /></label>
              <label>Participant character IDs <span>One per line</span><textarea value={profile.participantIds.join("\n")} onChange={(event) => updateProfile(draft, setDraft, index, { ...profile, participantIds: lines(event.target.value) })} /></label></div>
            <div className="brief-grid"><Select label="Development" value={profile.developmentStyle} values={["gradual", "steady", "volatile", "episodic", "background", "custom"]} onChange={(value) => updateProfile(draft, setDraft, index, { ...profile, developmentStyle: value as typeof profile.developmentStyle })} />
              <Select label="Emotional tension" value={profile.emotionalTension} values={["low", "moderate", "high", "variable"]} onChange={(value) => updateProfile(draft, setDraft, index, { ...profile, emotionalTension: value as typeof profile.emotionalTension })} />
              <Select label="Melodrama" value={profile.melodrama} values={["low", "moderate", "high"]} onChange={(value) => updateProfile(draft, setDraft, index, { ...profile, melodrama: value as typeof profile.melodrama })} />
              <Select label="Mechanics visibility" value={profile.mechanicsVisibility} values={["hidden", "subtle", "visible"]} onChange={(value) => updateProfile(draft, setDraft, index, { ...profile, mechanicsVisibility: value as typeof profile.mechanicsVisibility })} /></div>
            {profile.relationshipKind === "romance" && <div className="brief-grid"><Select label="Sensuality" value={profile.sensuality ?? "none"} values={["none", "subtle", "moderate", "explicit-within-boundaries"]} onChange={(value) => updateProfile(draft, setDraft, index, { ...profile, sensuality: value as NonNullable<typeof profile.sensuality> })} />
              <Select label="Physical intimacy" value={profile.physicalIntimacy ?? "none"} values={["none", "fade-to-black", "implied", "on-page-within-boundaries"]} onChange={(value) => updateProfile(draft, setDraft, index, { ...profile, physicalIntimacy: value as NonNullable<typeof profile.physicalIntimacy> })} /></div>}
            <label>Guidance<textarea value={profile.customGuidance} onChange={(event) => updateProfile(draft, setDraft, index, { ...profile, customGuidance: event.target.value })} /></label>
            <label>Content boundaries <span>One per line</span><textarea value={profile.contentBoundaries.join("\n")} onChange={(event) => updateProfile(draft, setDraft, index, { ...profile, contentBoundaries: lines(event.target.value) })} /></label>
            <button type="button" className="danger-text" onClick={() => update("relationshipPresentation", { ...(draft.relationshipPresentation ?? {}), profiles: draft.relationshipPresentation!.profiles.filter((_, itemIndex) => itemIndex !== index) })}>Remove profile</button>
          </article>)}
        </section>

        <section>
          <header className="bible-section-heading"><h2>Scoped presentation variations</h2><button type="button" onClick={() => update("scopedVariations", [...draft.scopedVariations, { id: uid("direction-scope"), scopeKind: "route", scopeId: "", toneDescriptors: [], pacingGuidance: "", proseGuidance: "" }])}>Add variation</button></header>
          {draft.scopedVariations.map((variation, index) => <article className="bible-card" key={variation.id}>
            <div className="brief-grid"><label>Stable variation ID<input value={variation.id} readOnly aria-readonly="true" /></label>
              <Select label="Scope" value={variation.scopeKind} values={["route", "act", "relationship", "character"]} onChange={(value) => updateVariation(draft, setDraft, index, { ...variation, scopeKind: value as typeof variation.scopeKind })} />
              <label>Scope ID<input value={variation.scopeId} onChange={(event) => updateVariation(draft, setDraft, index, { ...variation, scopeId: event.target.value })} /></label></div>
            <label>Tone descriptors<textarea value={variation.toneDescriptors.join("\n")} onChange={(event) => updateVariation(draft, setDraft, index, { ...variation, toneDescriptors: lines(event.target.value) })} /></label>
            <label>Pacing guidance<textarea value={variation.pacingGuidance} onChange={(event) => updateVariation(draft, setDraft, index, { ...variation, pacingGuidance: event.target.value })} /></label>
            <label>Prose guidance<textarea value={variation.proseGuidance} onChange={(event) => updateVariation(draft, setDraft, index, { ...variation, proseGuidance: event.target.value })} /></label>
            <button type="button" className="danger-text" onClick={() => update("scopedVariations", draft.scopedVariations.filter((_, itemIndex) => itemIndex !== index))}>Remove variation</button>
          </article>)}
        </section>
      </details>

      <div className="brief-actions"><button className="primary" disabled={props.busy}>Save Creative Direction draft</button></div>
    </form>

    <details className="panel why-inspector">
      <summary><strong>Why is this set?</strong><span> Durable evidence only; hidden reasoning is never shown</span></summary>
      {draft.fieldProvenance.length === 0 ? <p>Provenance is unavailable for these initial defaults.</p> : <ul>{draft.fieldProvenance.map((item, index) => <li key={`${item.fieldPath}-${index}`}>
        <strong>{item.fieldPath}</strong>: {item.reference.unavailable ? "evidence unavailable after project duplication" : item.reference.excerpt || provenanceLabel(item.reference.kind)}
        {item.reference.versionId ? ` · exact version ${item.reference.versionId}` : ""}
      </li>)}</ul>}
    </details>

    <details className="panel technical-details">
      <summary>Technical identity and context bounds</summary>
      <p><strong>Material:</strong> <code>{draft.materialFingerprint}</code></p>
      <p><strong>Explanation:</strong> <code>{draft.provenanceFingerprint}</code></p>
      <button type="button" disabled={props.workflow.status !== "approved"} onClick={async () => {
        try { setContextPreview((await previewCreativeDirectionContext(props.projectId)).diagnostics); }
        catch (error) { props.setMessage((error as Error).message); }
      }}>Preview bounded context</button>
      {contextPreview && <pre>{JSON.stringify(contextPreview, null, 2)}</pre>}
    </details>
  </section>;
}

function Select(props: { label: string; value: string; values: string[]; onChange(value: string): void }) {
  return <label>{props.label}<select value={props.value} onChange={(event) => props.onChange(event.target.value)}>
    {props.values.map((value) => <option key={value} value={value}>{value.replaceAll("-", " ")}</option>)}
  </select></label>;
}

function updateProfile(direction: CreativeDirection, setDirection: (value: CreativeDirection) => void, index: number, profile: NonNullable<CreativeDirection["relationshipPresentation"]>["profiles"][number]) {
  setDirection({ ...direction, relationshipPresentation: {
    ...(direction.relationshipPresentation ?? {}),
    profiles: (direction.relationshipPresentation?.profiles ?? []).map((item, itemIndex) => itemIndex === index ? profile : item),
  } });
}

function updateVariation(direction: CreativeDirection, setDirection: (value: CreativeDirection) => void, index: number, variation: CreativeDirection["scopedVariations"][number]) {
  setDirection({ ...direction, scopedVariations: direction.scopedVariations.map((item, itemIndex) => itemIndex === index ? variation : item) });
}

function provenanceLabel(kind: CreativeDirection["fieldProvenance"][number]["reference"]["kind"]): string {
  return ({
    "manual-edit": "Manually configured", "migration-derived": "Derived from an exact legacy planning version",
    "user-message": "Proposed through an exact message", proposal: "Applied from an exact proposal",
    "approved-artifact": "Derived from an approved artifact", "source-evidence": "Derived from source evidence",
    "source-observation": "Derived from a source observation", "author-override": "Author override",
  })[kind];
}
