import { useEffect, useState } from "react";
import {
  approveProjectBrief,
  createLongFormProject,
  downloadBrief,
  listLongFormProjects,
  loadLongFormProject,
  saveProjectBrief,
  type ArtifactVersion,
  type LongFormStoryBible,
  type LongFormRoutePlan,
  type LongFormEndingPlan,
  type LongFormMechanicsPlan,
  type ProjectBrief,
  type ProjectRecord,
  type PlanningFinding,
  type WorkflowState,
} from "../../api/long-form.js";
import { BriefEditor } from "./BriefEditor.js";
import { AssistantPanel } from "./AssistantPanel.js";
import { BibleWorkspace } from "./BibleWorkspace.js";
import { RoutePlanWorkspace } from "./RoutePlanWorkspace.js";
import { EndingPlanWorkspace } from "./EndingPlanWorkspace.js";
import { MechanicsWorkspace } from "./MechanicsWorkspace.js";
import { ArtifactHistory } from "./ArtifactHistory.js";
import { PassagePlanWorkspace } from "./PassagePlanWorkspace.js";

const activeProjectKey = "story-to-cyoa.long-form-project-id";
const activeStageKey = "story-to-cyoa.long-form-stage";
const stages = ["Project brief", "Story bible", "Routes", "Endings", "Mechanics", "Passage plan", "Drafts", "Review", "Play & export"];

export function LongFormWorkspace() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [brief, setBrief] = useState<ArtifactVersion<ProjectBrief> | null>(null);
  const [briefWorkflow, setBriefWorkflow] = useState<WorkflowState | null>(null);
  const [bible, setBible] = useState<ArtifactVersion<LongFormStoryBible> | null>(null);
  const [bibleWorkflow, setBibleWorkflow] = useState<WorkflowState | null>(null);
  const [routes, setRoutes] = useState<ArtifactVersion<LongFormRoutePlan> | null>(null);
  const [routesWorkflow, setRoutesWorkflow] = useState<WorkflowState | null>(null);
  const [endings, setEndings] = useState<ArtifactVersion<LongFormEndingPlan> | null>(null);
  const [endingsWorkflow, setEndingsWorkflow] = useState<WorkflowState | null>(null);
  const [mechanics, setMechanics] = useState<ArtifactVersion<LongFormMechanicsPlan> | null>(null);
  const [mechanicsWorkflow, setMechanicsWorkflow] = useState<WorkflowState | null>(null);
  const storedStage = localStorage.getItem(activeStageKey);
  const [activeStage, setActiveStage] = useState<"brief" | "bible" | "routes" | "endings" | "mechanics" | "passage-plan">(
    storedStage === "bible" || storedStage === "routes" || storedStage === "endings" || storedStage === "mechanics" || storedStage === "passage-plan" ? storedStage : "brief",
  );
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [validation, setValidation] = useState<PlanningFinding[]>([]);

  const openProject = async (projectId: string) => {
    const state = await loadLongFormProject(projectId);
    setProject(state.project);
    setBrief(state.brief);
    setBriefWorkflow(state.workflow.brief);
    setBible(state.bible);
    setBibleWorkflow(state.workflow.bible);
    setRoutes(state.routes);
    setRoutesWorkflow(state.workflow.routes);
    setEndings(state.endings);
    setEndingsWorkflow(state.workflow.endings);
    setMechanics(state.mechanics);
    setMechanicsWorkflow(state.workflow.mechanics);
    setValidation(state.validation);
    localStorage.setItem(activeProjectKey, projectId);
  };

  useEffect(() => {
    void listLongFormProjects().then(async (items) => {
      setProjects(items);
      const stored = localStorage.getItem(activeProjectKey);
      const selected = items.find((item) => item.id === stored) ?? items[0];
      if (selected) await openProject(selected.id);
    }).catch((error: Error) => setMessage(error.message));
  }, []);

  const create = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const created = await createLongFormProject(newName);
      setProjects((items) => [created.project, ...items]);
      setProject(created.project);
      setBrief(created.brief);
      setBriefWorkflow(created.workflow);
      setBible(null);
      setBibleWorkflow({
        projectId: created.project.id,
        artifactId: "bible",
        status: "empty",
        approvedVersionId: null,
        updatedAt: "",
      });
      setRoutes(null);
      setRoutesWorkflow({
        projectId: created.project.id,
        artifactId: "routes",
        status: "empty",
        approvedVersionId: null,
        updatedAt: "",
      });
      setEndings(null);
      setEndingsWorkflow({
        projectId: created.project.id,
        artifactId: "endings",
        status: "empty",
        approvedVersionId: null,
        updatedAt: "",
      });
      setMechanics(null);
      setMechanicsWorkflow({ projectId: created.project.id, artifactId: "mechanics", status: "empty", approvedVersionId: null, updatedAt: "" });
      setActiveStage("brief");
      localStorage.setItem(activeStageKey, "brief");
      setNewName("");
      localStorage.setItem(activeProjectKey, created.project.id);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!project || !brief || !briefWorkflow || !bibleWorkflow || !routesWorkflow || !endingsWorkflow || !mechanicsWorkflow) {
    return <main className="long-form-home">
      <header>
        <p className="eyebrow">Long-form workspace</p>
        <h1>Design before drafting</h1>
        <p>Create a persistent 150k–200k branching project and review each planning stage before prose generation.</p>
      </header>
      <section className="panel project-create">
        <h2>New long-form project</h2>
        <label>Working title<input value={newName} onChange={(event) => setNewName(event.target.value)} /></label>
        <button className="primary" disabled={busy || !newName.trim()} onClick={() => void create()}>Create project</button>
        {projects.length > 0 && <div className="project-list">
          <h3>Existing projects</h3>
          {projects.map((item) => <button key={item.id} onClick={() => void openProject(item.id)}>{item.name}</button>)}
        </div>}
        {message && <p className="error">{message}</p>}
      </section>
    </main>;
  }

  return <main className="long-form-workspace">
    <nav className="workflow-nav" aria-label="Long-form workflow">
      <p className="eyebrow">Long-form project</p>
      <h2>{project.name}</h2>
      <label>Switch project
        <select value={project.id} onChange={(event) => void openProject(event.target.value)}>
          {projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <button className="new-project-button" onClick={() => {
        setProject(null);
        setBrief(null);
        setBriefWorkflow(null);
        setBible(null);
        setBibleWorkflow(null);
        setRoutes(null);
        setRoutesWorkflow(null);
        setEndings(null);
        setEndingsWorkflow(null);
        setMechanics(null); setMechanicsWorkflow(null);
        setMessage(null);
        setActiveStage("brief");
        localStorage.setItem(activeStageKey, "brief");
      }}>New project</button>
      <ol>
        {stages.map((stage, index) => {
          const stageId = index === 0
            ? "brief"
            : index === 1
              ? "bible"
              : index === 2
                ? "routes"
                : index === 3
                  ? "endings"
              : index === 4
                    ? "mechanics"
                    : index === 5
                      ? "passage-plan"
                  : null;
          const enabled = stageId === "brief"
            || (stageId === "bible" && (briefWorkflow.status === "approved" || Boolean(bible)))
            || (stageId === "routes" && (bibleWorkflow.status === "approved" || Boolean(routes)));
          const available = enabled
            || (stageId === "endings" && (routesWorkflow.status === "approved" || Boolean(endings)))
            || (stageId === "mechanics" && (endingsWorkflow.status === "approved" || Boolean(mechanics)))
            || (stageId === "passage-plan" && mechanicsWorkflow.status === "approved");
          const status = stageId === "brief"
            ? briefWorkflow.status
            : stageId === "bible"
              ? bibleWorkflow.status === "empty" ? "Not started" : bibleWorkflow.status
              : stageId === "routes"
                ? routesWorkflow.status === "empty" ? "Not started" : routesWorkflow.status
                : stageId === "endings"
                  ? endingsWorkflow.status === "empty" ? "Not started" : endingsWorkflow.status
                  : stageId === "mechanics"
                    ? mechanicsWorkflow.status === "empty" ? "Not started" : mechanicsWorkflow.status
                    : stageId === "passage-plan"
                      ? mechanicsWorkflow.status === "approved" ? "Available" : "Not started"
              : "Not started";
          return <li key={stage} className={stageId === activeStage ? "current" : ""}>
          <button disabled={!available} onClick={() => {
            if (stageId) {
              setActiveStage(stageId);
              localStorage.setItem(activeStageKey, stageId);
              setMessage(null);
            }
          }}>
            <span>{stage}</span>
            <small>{status}</small>
          </button>
        </li>;
        })}
      </ol>
    </nav>

    {activeStage !== "passage-plan" && <section className="artifact-tools">
      <ArtifactHistory
        projectId={project.id}
        artifactId={activeStage}
        currentVersionId={(activeStage === "brief" ? brief : activeStage === "bible" ? bible : activeStage === "routes" ? routes : activeStage === "endings" ? endings : mechanics)?.id ?? ""}
        onChanged={() => openProject(project.id)}
      />
      {validation.filter((finding) => finding.artifactId === activeStage).length > 0 && <details className="validation-panel" open>
        <summary>Validation ({validation.filter((finding) => finding.artifactId === activeStage).length})</summary>
        {validation.filter((finding) => finding.artifactId === activeStage).map((finding, index) =>
          <p className={`validation-${finding.severity}`} key={`${finding.code}-${finding.path}-${index}`}>
            <strong>{finding.severity}</strong> {finding.message}
          </p>)}
      </details>}
    </section>}

    {activeStage === "brief" ? <section className="artifact-pane">
      <header className="artifact-header">
        <div>
          <p className="eyebrow">Stage 1</p>
          <h1>Project brief</h1>
          <p>Version {brief.version} · <span className={`workflow-status ${briefWorkflow.status}`}>{briefWorkflow.status}</span></p>
        </div>
        <div className="artifact-actions">
          <button onClick={() => void downloadBrief(project.id, "markdown")}>Export Markdown</button>
          <button onClick={() => void downloadBrief(project.id, "json")}>Export JSON</button>
          <button disabled={briefWorkflow.approvedVersionId === brief.id} onClick={async () => {
            setBusy(true);
            try {
              setBriefWorkflow(await approveProjectBrief(project.id, brief.id));
              setMessage("Project brief approved. Story-bible work will be the next stage.");
            } catch (error) {
              setMessage((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}>Approve brief</button>
        </div>
      </header>

      {message && <p className={message.includes("approved") ? "status good" : "error"} role="status">{message}</p>}
      <BriefEditor brief={brief.content} busy={busy} onSave={async (content) => {
        setBusy(true);
        setMessage(null);
        try {
          const saved = await saveProjectBrief(project.id, content);
          setBrief(saved.brief);
          setBriefWorkflow(saved.workflow);
          setMessage("Draft saved locally.");
        } catch (error) {
          setMessage((error as Error).message);
        } finally {
          setBusy(false);
        }
      }} />
    </section> : activeStage === "bible" ? <BibleWorkspace
      projectId={project.id}
      briefApproved={briefWorkflow.status === "approved"}
      bible={bible}
      workflow={bibleWorkflow}
      busy={busy}
      message={message}
      setBusy={setBusy}
      setMessage={setMessage}
      onChanged={() => openProject(project.id)}
    /> : activeStage === "routes" ? <RoutePlanWorkspace
      projectId={project.id}
      bibleApproved={bibleWorkflow.status === "approved"}
      routes={routes}
      workflow={routesWorkflow}
      busy={busy}
      message={message}
      setBusy={setBusy}
      setMessage={setMessage}
      onChanged={() => openProject(project.id)}
    /> : activeStage === "endings" ? <EndingPlanWorkspace
      projectId={project.id}
      routesApproved={routesWorkflow.status === "approved"}
      routePlan={routes?.content ?? null}
      endings={endings}
      workflow={endingsWorkflow}
      busy={busy}
      message={message}
      setBusy={setBusy}
      setMessage={setMessage}
      onChanged={() => openProject(project.id)}
    /> : activeStage === "mechanics" ? <MechanicsWorkspace
      projectId={project.id} endingsApproved={endingsWorkflow.status === "approved"}
      routes={routes?.content ?? null} endings={endings?.content ?? null}
      mechanics={mechanics} workflow={mechanicsWorkflow} busy={busy} message={message}
      setBusy={setBusy} setMessage={setMessage} onChanged={() => openProject(project.id)}
    /> : <PassagePlanWorkspace
      projectId={project.id}
      mechanicsApproved={mechanicsWorkflow.status === "approved"}
      bible={bible?.content ?? null}
      routes={routes?.content ?? null}
      endings={endings?.content ?? null}
      mechanics={mechanics?.content ?? null}
      message={message}
      setMessage={setMessage}
    />}

    {activeStage !== "passage-plan" && <AssistantPanel
      key={project.id}
      project={project}
      brief={brief}
      bible={bible}
      routes={routes}
      endings={endings}
      mechanics={mechanics}
      activeArtifact={activeStage}
      onBriefApplied={() => openProject(project.id)}
    />}
  </main>;
}
