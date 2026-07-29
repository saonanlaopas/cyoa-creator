import { useEffect, useState } from "react";
import type { ProjectBrief } from "../../api/long-form.js";

const lines = (value: string) => value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);

export function BriefEditor(props: {
  brief: ProjectBrief;
  busy: boolean;
  onSave(brief: ProjectBrief): Promise<void>;
}) {
  const [draft, setDraft] = useState(props.brief);
  useEffect(() => setDraft(props.brief), [props.brief]);
  const field = <K extends keyof ProjectBrief>(key: K, value: ProjectBrief[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  return <form className="brief-editor" onSubmit={(event) => {
    event.preventDefault();
    void props.onSave(draft);
  }}>
    <section className="brief-section">
      <h3>Story foundation</h3>
      <label>Working title<input value={draft.workingTitle} onChange={(event) => field("workingTitle", event.target.value)} required /></label>
      <label>Premise<textarea value={draft.premise} onChange={(event) => field("premise", event.target.value)} placeholder="What is this adaptation or original story about?" /></label>
      <div className="brief-grid">
        <label>Source
          <select value={draft.sourceMode} onChange={(event) => field("sourceMode", event.target.value as ProjectBrief["sourceMode"])}>
            <option value="imported-source">Imported source</option>
            <option value="original-premise">Original premise</option>
          </select>
        </label>
        <label>Protagonist<input value={draft.protagonist} onChange={(event) => field("protagonist", event.target.value)} /></label>
        <label>Point of view
          <select value={draft.pointOfView} onChange={(event) => field("pointOfView", event.target.value as ProjectBrief["pointOfView"])}>
            <option value="second-person">Second person</option>
            <option value="first-person">First person</option>
            <option value="third-person">Third person</option>
          </select>
        </label>
        <label>Adaptation fidelity
          <select value={draft.adaptationFidelity} onChange={(event) => field("adaptationFidelity", event.target.value as ProjectBrief["adaptationFidelity"])}>
            <option value="balanced">Balanced</option>
            <option value="canon-centered">Canon-centered</option>
            <option value="expansive">Expansive</option>
          </select>
        </label>
      </div>
      <label>Tone and style<textarea value={draft.tone} onChange={(event) => field("tone", event.target.value)} /></label>
    </section>

    <section className="brief-section">
      <h3>Long-form targets</h3>
      <div className="brief-grid targets">
        <label>Total words<input aria-label="Total words" type="number" min={50_000} max={1_000_000} value={draft.totalWordTarget} onChange={(event) => field("totalWordTarget", Number(event.target.value))} /></label>
        <label>Typical playthrough<input aria-label="Typical playthrough words" type="number" min={10_000} max={500_000} value={draft.typicalPlaythroughWordTarget} onChange={(event) => field("typicalPlaythroughWordTarget", Number(event.target.value))} /></label>
        <label>Major routes<input type="number" min={2} max={20} value={draft.routeTarget} onChange={(event) => field("routeTarget", Number(event.target.value))} /></label>
        <label>Endings<input type="number" min={3} max={30} value={draft.endingTarget} onChange={(event) => field("endingTarget", Number(event.target.value))} /></label>
        <label>Average passage words<input type="number" min={100} max={1_500} value={draft.passageWordTarget} onChange={(event) => field("passageWordTarget", Number(event.target.value))} /></label>
        <label>Branching style
          <select value={draft.branchingStyle} onChange={(event) => field("branchingStyle", event.target.value as ProjectBrief["branchingStyle"])}>
            <option value="braided">Braided routes</option>
            <option value="route-focused">Route-focused</option>
            <option value="wide-tree">Wide tree</option>
          </select>
        </label>
      </div>
      <p className="field-note">The default is 175,000 total words with a 50,000-word typical playthrough. These are planning budgets, not hard limits.</p>
    </section>

    <section className="brief-section">
      <h3>Priorities and boundaries</h3>
      <label>Content boundaries <span>One per line</span><textarea value={draft.contentBoundaries.join("\n")} onChange={(event) => field("contentBoundaries", lines(event.target.value))} /></label>
      <label>Priority characters <span>One per line</span><textarea value={draft.priorityCharacters.join("\n")} onChange={(event) => field("priorityCharacters", lines(event.target.value))} /></label>
      <label>Priority relationships <span>One per line</span><textarea value={draft.priorityRelationships.join("\n")} onChange={(event) => field("priorityRelationships", lines(event.target.value))} /></label>
      <label>Project constraints <span>One per line</span><textarea value={draft.projectConstraints.join("\n")} onChange={(event) => field("projectConstraints", lines(event.target.value))} /></label>
      <label>Unresolved questions <span>One per line</span><textarea value={draft.unresolvedQuestions.join("\n")} onChange={(event) => field("unresolvedQuestions", lines(event.target.value))} /></label>
    </section>

    <div className="brief-actions">
      <button className="primary" disabled={props.busy}>{props.busy ? "Saving…" : "Save draft"}</button>
    </div>
  </form>;
}
