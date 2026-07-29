import {
  approveMechanicsPlan, createMechanicsPlan, downloadMechanicsPlan, saveMechanicsPlan,
  type ArtifactVersion, type LongFormEndingPlan, type LongFormMechanicsPlan,
  type LongFormRoutePlan, type WorkflowState,
} from "../../api/long-form.js";
import { MechanicsEditor } from "./MechanicsEditor.js";

export function MechanicsWorkspace(props: {
  projectId: string; endingsApproved: boolean; routes: LongFormRoutePlan | null;
  endings: LongFormEndingPlan | null; mechanics: ArtifactVersion<LongFormMechanicsPlan> | null;
  workflow: WorkflowState; busy: boolean; message: string | null;
  setBusy(value: boolean): void; setMessage(value: string | null): void; onChanged(): Promise<void>;
}) {
  if (!props.mechanics) return <section className="artifact-pane">
    <header className="artifact-header"><div><p className="eyebrow">Stage 5</p><h1>Mechanics</h1><p>Not started</p></div></header>
    <section className="brief-section stage-intro">
      <h2>Make tracked state change the story</h2>
      <p>Define stats, relationships, flags, resources, gates, choice effects, and balancing rules. Approval requires every declared mechanic to influence at least one gate or effect plan.</p>
      <button className="primary" disabled={!props.endingsApproved || props.busy} onClick={async () => {
        props.setBusy(true); props.setMessage(null);
        try { await createMechanicsPlan(props.projectId); await props.onChanged(); props.setMessage("Mechanics draft created locally."); }
        catch (error) { props.setMessage((error as Error).message); } finally { props.setBusy(false); }
      }}>{props.endingsApproved ? "Create mechanics plan" : "Approve the ending architecture first"}</button>
    </section>
  </section>;
  return <section className="artifact-pane">
    <header className="artifact-header"><div><p className="eyebrow">Stage 5</p><h1>Mechanics</h1>
      <p>Version {props.mechanics.version} · <span className={`workflow-status ${props.workflow.status}`}>{props.workflow.status}</span></p></div>
      <div className="artifact-actions">
        <button onClick={() => void downloadMechanicsPlan(props.projectId, "markdown")}>Export Markdown</button>
        <button onClick={() => void downloadMechanicsPlan(props.projectId, "json")}>Export JSON</button>
        <button disabled={props.workflow.approvedVersionId === props.mechanics.id || props.busy} onClick={async () => {
          props.setBusy(true); props.setMessage(null);
          try { await approveMechanicsPlan(props.projectId, props.mechanics!.id); await props.onChanged(); props.setMessage("Mechanics approved. Passage planning is next."); }
          catch (error) { props.setMessage((error as Error).message); } finally { props.setBusy(false); }
        }}>Approve mechanics</button>
      </div>
    </header>
    {props.message && <p className={props.message.includes("approved") || props.message.includes("saved") || props.message.includes("created") ? "status good" : "error"}>{props.message}</p>}
    {props.workflow.status === "stale" && <p className="warning">Upstream planning changed. Review gates, targets, and effect plans.</p>}
    <MechanicsEditor plan={props.mechanics.content} routes={props.routes} endings={props.endings} busy={props.busy} onSave={async (plan) => {
      props.setBusy(true); props.setMessage(null);
      try { await saveMechanicsPlan(props.projectId, plan); await props.onChanged(); props.setMessage("Mechanics draft saved locally."); }
      catch (error) { props.setMessage((error as Error).message); } finally { props.setBusy(false); }
    }} />
  </section>;
}
