import {
  approveStoryBible,
  createStoryBible,
  downloadStoryBible,
  saveStoryBible,
  type ArtifactVersion,
  type LongFormStoryBible,
  type WorkflowState,
} from "../../api/long-form.js";
import { BibleEditor } from "./BibleEditor.js";

export function BibleWorkspace(props: {
  projectId: string;
  briefApproved: boolean;
  bible: ArtifactVersion<LongFormStoryBible> | null;
  workflow: WorkflowState;
  busy: boolean;
  message: string | null;
  setBusy(value: boolean): void;
  setMessage(value: string | null): void;
  onChanged(): Promise<void>;
}) {
  if (!props.bible) {
    return <section className="artifact-pane">
      <header className="artifact-header">
        <div>
          <p className="eyebrow">Stage 2</p>
          <h1>Story bible</h1>
          <p>Not started</p>
        </div>
      </header>
      {props.message && <p className="error" role="status">{props.message}</p>}
      <section className="brief-section stage-intro">
        <h2>Build the canonical story reference</h2>
        <p>The bible holds characters, relationships, setting, timeline, rules, themes, prose guidance, cited facts, contradictions, adaptation opportunities, and unresolved questions.</p>
        <p>Creating it is local and free. It starts from the approved project brief; you can fill it manually or use scoped chat afterward.</p>
        <button className="primary" disabled={!props.briefApproved || props.busy} onClick={async () => {
          props.setBusy(true);
          props.setMessage(null);
          try {
            await createStoryBible(props.projectId);
            await props.onChanged();
            props.setMessage("Story bible draft created locally.");
          } catch (error) {
            props.setMessage((error as Error).message);
          } finally {
            props.setBusy(false);
          }
        }}>{props.briefApproved ? "Create story bible" : "Approve the project brief first"}</button>
      </section>
    </section>;
  }

  return <section className="artifact-pane">
    <header className="artifact-header">
      <div>
        <p className="eyebrow">Stage 2</p>
        <h1>Story bible</h1>
        <p>Version {props.bible.version} · <span className={`workflow-status ${props.workflow.status}`}>{props.workflow.status}</span></p>
      </div>
      <div className="artifact-actions">
        <button onClick={() => void downloadStoryBible(props.projectId, "markdown")}>Export Markdown</button>
        <button onClick={() => void downloadStoryBible(props.projectId, "json")}>Export JSON</button>
        <button
          disabled={props.workflow.approvedVersionId === props.bible.id || props.busy}
          onClick={async () => {
            props.setBusy(true);
            props.setMessage(null);
            try {
              await approveStoryBible(props.projectId, props.bible!.id);
              await props.onChanged();
              props.setMessage("Story bible approved. Routes are the next planning stage.");
            } catch (error) {
              props.setMessage((error as Error).message);
            } finally {
              props.setBusy(false);
            }
          }}
        >Approve bible</button>
      </div>
    </header>
    {props.message && <p className={
      props.message.includes("approved") || props.message.includes("saved") || props.message.includes("created")
        ? "status good"
        : "error"
    } role="status">{props.message}</p>}
    {props.workflow.status === "stale" && <p className="warning">The project brief or source changed after this bible was created. Review and save a new bible version before relying on it downstream.</p>}
    <BibleEditor bible={props.bible.content} busy={props.busy} onSave={async (content) => {
      props.setBusy(true);
      props.setMessage(null);
      try {
        await saveStoryBible(props.projectId, content);
        await props.onChanged();
        props.setMessage("Story bible draft saved locally.");
      } catch (error) {
        props.setMessage((error as Error).message);
      } finally {
        props.setBusy(false);
      }
    }} />
  </section>;
}
