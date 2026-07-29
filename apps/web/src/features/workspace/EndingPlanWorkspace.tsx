import {
  approveEndingPlan,
  createEndingPlan,
  downloadEndingPlan,
  saveEndingPlan,
  type ArtifactVersion,
  type LongFormEndingPlan,
  type LongFormRoutePlan,
  type WorkflowState,
} from "../../api/long-form.js";
import { EndingPlanEditor } from "./EndingPlanEditor.js";

export function EndingPlanWorkspace(props: {
  projectId: string;
  routesApproved: boolean;
  routePlan: LongFormRoutePlan | null;
  endings: ArtifactVersion<LongFormEndingPlan> | null;
  workflow: WorkflowState;
  busy: boolean;
  message: string | null;
  setBusy(value: boolean): void;
  setMessage(value: string | null): void;
  onChanged(): Promise<void>;
}) {
  if (!props.endings) {
    return <section className="artifact-pane">
      <header className="artifact-header"><div>
        <p className="eyebrow">Stage 4</p>
        <h1>Ending architecture</h1>
        <p>Not started</p>
      </div></header>
      {props.message && <p className="error" role="status">{props.message}</p>}
      <section className="brief-section stage-intro">
        <h2>Turn route hooks into earned outcomes</h2>
        <p>Develop each ending’s payoff, requirements, exclusions, contributing decisions, foreshadowing, character and relationship outcomes, state consequences, variants, and prose budget.</p>
        <p>Creating the first plan is local and free. Every approved route hook becomes one detailed ending record.</p>
        <button className="primary" disabled={!props.routesApproved || props.busy} onClick={async () => {
          props.setBusy(true);
          props.setMessage(null);
          try {
            await createEndingPlan(props.projectId);
            await props.onChanged();
            props.setMessage("Ending architecture draft created locally.");
          } catch (error) {
            props.setMessage((error as Error).message);
          } finally {
            props.setBusy(false);
          }
        }}>{props.routesApproved ? "Create ending architecture" : "Approve the route architecture first"}</button>
      </section>
    </section>;
  }

  return <section className="artifact-pane">
    <header className="artifact-header">
      <div>
        <p className="eyebrow">Stage 4</p>
        <h1>Ending architecture</h1>
        <p>Version {props.endings.version} · <span className={`workflow-status ${props.workflow.status}`}>{props.workflow.status}</span></p>
      </div>
      <div className="artifact-actions">
        <button onClick={() => void downloadEndingPlan(props.projectId, "markdown")}>Export Markdown</button>
        <button onClick={() => void downloadEndingPlan(props.projectId, "json")}>Export JSON</button>
        <button disabled={props.workflow.approvedVersionId === props.endings.id || props.busy} onClick={async () => {
          props.setBusy(true);
          props.setMessage(null);
          try {
            await approveEndingPlan(props.projectId, props.endings!.id);
            await props.onChanged();
            props.setMessage("Ending architecture approved. Mechanics are the next planning stage.");
          } catch (error) {
            props.setMessage((error as Error).message);
          } finally {
            props.setBusy(false);
          }
        }}>Approve endings</button>
      </div>
    </header>
    {props.message && <p className={
      props.message.includes("approved") || props.message.includes("saved") || props.message.includes("created")
        ? "status good"
        : "error"
    } role="status">{props.message}</p>}
    {props.workflow.status === "stale" && <p className="warning">The route architecture changed. Review ending links, requirements, and coverage before relying on this version.</p>}
    <EndingPlanEditor
      plan={props.endings.content}
      routes={props.routePlan}
      busy={props.busy}
      onSave={async (content) => {
        props.setBusy(true);
        props.setMessage(null);
        try {
          await saveEndingPlan(props.projectId, content);
          await props.onChanged();
          props.setMessage("Ending architecture draft saved locally.");
        } catch (error) {
          props.setMessage((error as Error).message);
        } finally {
          props.setBusy(false);
        }
      }}
    />
  </section>;
}
