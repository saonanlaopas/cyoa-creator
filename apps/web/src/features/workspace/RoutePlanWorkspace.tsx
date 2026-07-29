import {
  approveRoutePlan,
  createRoutePlan,
  downloadRoutePlan,
  saveRoutePlan,
  type ArtifactVersion,
  type LongFormRoutePlan,
  type WorkflowState,
} from "../../api/long-form.js";
import { RoutePlanEditor } from "./RoutePlanEditor.js";

export function RoutePlanWorkspace(props: {
  projectId: string;
  bibleApproved: boolean;
  routes: ArtifactVersion<LongFormRoutePlan> | null;
  workflow: WorkflowState;
  busy: boolean;
  message: string | null;
  setBusy(value: boolean): void;
  setMessage(value: string | null): void;
  onChanged(): Promise<void>;
}) {
  if (!props.routes) {
    return <section className="artifact-pane">
      <header className="artifact-header">
        <div>
          <p className="eyebrow">Stage 3</p>
          <h1>Route architecture</h1>
          <p>Not started</p>
        </div>
      </header>
      {props.message && <p className="error" role="status">{props.message}</p>}
      <section className="brief-section stage-intro">
        <h2>Design the whole branching shape before prose</h2>
        <p>This stage maps shared and route-exclusive acts, route promises and entry conditions, major decisions, controlled reconvergences, relationship trajectories, ending hooks, and the full word budget.</p>
        <p>Creating the first plan is local and free. It uses the approved brief targets and leaves the detailed ending and passage work for their own stages.</p>
        <button className="primary" disabled={!props.bibleApproved || props.busy} onClick={async () => {
          props.setBusy(true);
          props.setMessage(null);
          try {
            await createRoutePlan(props.projectId);
            await props.onChanged();
            props.setMessage("Route architecture draft created locally.");
          } catch (error) {
            props.setMessage((error as Error).message);
          } finally {
            props.setBusy(false);
          }
        }}>{props.bibleApproved ? "Create route architecture" : "Approve the story bible first"}</button>
      </section>
    </section>;
  }

  return <section className="artifact-pane">
    <header className="artifact-header">
      <div>
        <p className="eyebrow">Stage 3</p>
        <h1>Route architecture</h1>
        <p>Version {props.routes.version} · <span className={`workflow-status ${props.workflow.status}`}>{props.workflow.status}</span></p>
      </div>
      <div className="artifact-actions">
        <button onClick={() => void downloadRoutePlan(props.projectId, "markdown")}>Export Markdown</button>
        <button onClick={() => void downloadRoutePlan(props.projectId, "json")}>Export JSON</button>
        <button
          disabled={props.workflow.approvedVersionId === props.routes.id || props.busy}
          onClick={async () => {
            props.setBusy(true);
            props.setMessage(null);
            try {
              await approveRoutePlan(props.projectId, props.routes!.id);
              await props.onChanged();
              props.setMessage("Route architecture approved. Detailed endings are the next planning stage.");
            } catch (error) {
              props.setMessage((error as Error).message);
            } finally {
              props.setBusy(false);
            }
          }}
        >Approve routes</button>
      </div>
    </header>
    {props.message && <p className={
      props.message.includes("approved") || props.message.includes("saved") || props.message.includes("created")
        ? "status good"
        : "error"
    } role="status">{props.message}</p>}
    {props.workflow.status === "stale" && <p className="warning">The approved brief, source, or story bible changed. Review this architecture and save a new version before relying on it downstream.</p>}
    <RoutePlanEditor routes={props.routes.content} busy={props.busy} onSave={async (content) => {
      props.setBusy(true);
      props.setMessage(null);
      try {
        await saveRoutePlan(props.projectId, content);
        await props.onChanged();
        props.setMessage("Route architecture draft saved locally.");
      } catch (error) {
        props.setMessage((error as Error).message);
      } finally {
        props.setBusy(false);
      }
    }} />
  </section>;
}
