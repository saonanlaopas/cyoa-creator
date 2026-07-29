import { useEffect, useState } from "react";
import {
  approveProjectBrief,
  createLongFormProject,
  downloadBrief,
  listLongFormProjects,
  loadLongFormProject,
  saveProjectBrief,
  type ArtifactVersion,
  type ProjectBrief,
  type ProjectRecord,
  type WorkflowState,
} from "../../api/long-form.js";
import { BriefEditor } from "./BriefEditor.js";

const activeProjectKey = "story-to-cyoa.long-form-project-id";
const stages = ["Project brief", "Story bible", "Routes", "Endings", "Mechanics", "Passage plan", "Drafts", "Review", "Play & export"];

export function LongFormWorkspace() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [brief, setBrief] = useState<ArtifactVersion<ProjectBrief> | null>(null);
  const [briefWorkflow, setBriefWorkflow] = useState<WorkflowState | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const openProject = async (projectId: string) => {
    const state = await loadLongFormProject(projectId);
    setProject(state.project);
    setBrief(state.brief);
    setBriefWorkflow(state.workflow.brief);
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
      setNewName("");
      localStorage.setItem(activeProjectKey, created.project.id);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!project || !brief || !briefWorkflow) {
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
        setMessage(null);
      }}>New project</button>
      <ol>
        {stages.map((stage, index) => <li key={stage} className={index === 0 ? "current" : ""}>
          <button disabled={index > 0}>
            <span>{stage}</span>
            <small>{index === 0 ? briefWorkflow.status : "Not started"}</small>
          </button>
        </li>)}
      </ol>
    </nav>

    <section className="artifact-pane">
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
    </section>

    <aside className="assistant-preview">
      <p className="eyebrow">Assistant</p>
      <h2>Scoped project chat</h2>
      <div className="scope-preview">
        <strong>Scope</strong>
        <span>Project brief · version {brief.version}</span>
      </div>
      <p>The persistent scoped assistant arrives in the next slice. This space will discuss the selected artifact and propose versioned changes without silently applying them.</p>
      <p className="field-note">Recommended next step: finish and approve the project brief.</p>
    </aside>
  </main>;
}
