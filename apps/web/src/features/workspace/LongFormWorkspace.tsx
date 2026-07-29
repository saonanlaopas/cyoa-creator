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
  type ProjectBrief,
  type ProjectRecord,
  type WorkflowState,
} from "../../api/long-form.js";
import { BriefEditor } from "./BriefEditor.js";
import { AssistantPanel } from "./AssistantPanel.js";
import { BibleWorkspace } from "./BibleWorkspace.js";

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
  const [activeStage, setActiveStage] = useState<"brief" | "bible">(
    localStorage.getItem(activeStageKey) === "bible" ? "bible" : "brief",
  );
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const openProject = async (projectId: string) => {
    const state = await loadLongFormProject(projectId);
    setProject(state.project);
    setBrief(state.brief);
    setBriefWorkflow(state.workflow.brief);
    setBible(state.bible);
    setBibleWorkflow(state.workflow.bible);
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

  if (!project || !brief || !briefWorkflow || !bibleWorkflow) {
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
        setMessage(null);
        setActiveStage("brief");
        localStorage.setItem(activeStageKey, "brief");
      }}>New project</button>
      <ol>
        {stages.map((stage, index) => {
          const stageId = index === 0 ? "brief" : index === 1 ? "bible" : null;
          const enabled = stageId === "brief" || (stageId === "bible" && (briefWorkflow.status === "approved" || Boolean(bible)));
          const status = stageId === "brief"
            ? briefWorkflow.status
            : stageId === "bible"
              ? bibleWorkflow.status === "empty" ? "Not started" : bibleWorkflow.status
              : "Not started";
          return <li key={stage} className={stageId === activeStage ? "current" : ""}>
          <button disabled={!enabled} onClick={() => {
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
    </section> : <BibleWorkspace
      projectId={project.id}
      briefApproved={briefWorkflow.status === "approved"}
      bible={bible}
      workflow={bibleWorkflow}
      busy={busy}
      message={message}
      setBusy={setBusy}
      setMessage={setMessage}
      onChanged={() => openProject(project.id)}
    />}

    <AssistantPanel
      key={project.id}
      project={project}
      brief={brief}
      bible={bible}
      activeArtifact={activeStage}
      onBriefApplied={() => openProject(project.id)}
    />
  </main>;
}
