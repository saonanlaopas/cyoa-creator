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
import { SimulationWorkspace } from "./SimulationWorkspace.js";
import { RepairWorkspace } from "./RepairWorkspace.js";
import { PublicationWorkspace } from "./PublicationWorkspace.js";
import { GlobalRestorePanel, RecoveryWorkspace } from "./RecoveryWorkspace.js";
import { ProjectHealthWorkspace } from "./ProjectHealthWorkspace.js";
import { ResumeWorkWorkspace } from "./ResumeWorkWorkspace.js";

const activeProjectKey = "story-to-cyoa.long-form-project-id";
const activeStageKey = "story-to-cyoa.long-form-stage";
const navigationKey = (projectId: string) => `story-to-cyoa.navigation.${projectId}`;
type LongFormStage = "brief" | "bible" | "routes" | "endings" | "mechanics" | "passage-plan" | "simulation" | "repair" | "publication" | "resume" | "health" | "recovery";
const stageIds: LongFormStage[] = ["brief", "bible", "routes", "endings", "mechanics", "passage-plan", "simulation", "repair", "publication", "resume", "health", "recovery"];
const isLongFormStage = (value: unknown): value is LongFormStage => typeof value === "string" && stageIds.includes(value as LongFormStage);
const stages = ["Project brief", "Story bible", "Routes", "Endings", "Mechanics", "Passage plan", "Drafts", "Playtest & analysis", "Repair planning", "Publication", "Resume work", "Project health", "Backup & recovery"];
type NavigationHint = { stage: LongFormStage; entityId: string | null };
const stageLabels: Record<LongFormStage, string> = {
  brief: "Project brief", bible: "Story bible", routes: "Routes", endings: "Endings", mechanics: "Mechanics",
  "passage-plan": "Passage plan", simulation: "Playtest & analysis", repair: "Repair planning",
  publication: "Publication", resume: "Resume work", health: "Project health", recovery: "Backup & recovery",
};

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
  const [activeStage, setActiveStage] = useState<LongFormStage>(
    isLongFormStage(storedStage) ? storedStage : "brief",
  );
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [validation, setValidation] = useState<PlanningFinding[]>([]);
  const [passagePlanJump, setPassagePlanJump] = useState("");
  const [currentStableId, setCurrentStableId] = useState("");
  const [stableIdInput, setStableIdInput] = useState("");
  const [navigationHistory, setNavigationHistory] = useState<LongFormStage[]>([]);
  const [lastWorkspaceHint, setLastWorkspaceHint] = useState<NavigationHint | null>(null);

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
    try {
      const saved = JSON.parse(localStorage.getItem(navigationKey(projectId)) ?? "null") as { stage?: LongFormStage; entityId?: string; scrollY?: number; previous?: NavigationHint } | null;
      if (isLongFormStage(saved?.stage)) setActiveStage(saved.stage);
      if (typeof saved?.entityId === "string" && saved.entityId.length <= 240) {
        setPassagePlanJump(saved.entityId); setCurrentStableId(saved.entityId); setStableIdInput(saved.entityId);
      }
      if (saved?.previous && isLongFormStage(saved.previous.stage)
        && (saved.previous.entityId === null || (typeof saved.previous.entityId === "string" && saved.previous.entityId.length <= 240))) {
        setLastWorkspaceHint(saved.previous);
      }
      if (typeof saved?.scrollY === "number" && Number.isFinite(saved.scrollY) && saved.scrollY >= 0) {
        requestAnimationFrame(() => window.scrollTo({ top: saved.scrollY }));
      }
    } catch { /* Browser-local navigation hints are disposable and non-canonical. */ }
  };

  const navigate = (stage: LongFormStage, entityId?: string | null) => {
    if (stage !== activeStage) setNavigationHistory((items) => [...items.slice(-19), activeStage]);
    if (stage === "resume" && activeStage !== "resume") setLastWorkspaceHint({ stage: activeStage, entityId: currentStableId || null });
    setActiveStage(stage);
    if (entityId !== undefined) { setPassagePlanJump(entityId ?? ""); setCurrentStableId(entityId ?? ""); setStableIdInput(entityId ?? ""); }
    localStorage.setItem(activeStageKey, stage);
    if (project) localStorage.setItem(navigationKey(project.id), JSON.stringify({
      stage, entityId: (entityId ?? currentStableId) || undefined, scrollY: 0,
      previous: stage === "resume" && activeStage !== "resume" ? { stage: activeStage, entityId: currentStableId || null } : lastWorkspaceHint ?? undefined,
    }));
    setMessage(null);
  };

  useEffect(() => {
    if (!project) return;
    const save = () => localStorage.setItem(navigationKey(project.id), JSON.stringify({
      stage: activeStage, entityId: currentStableId || undefined, scrollY: window.scrollY, previous: lastWorkspaceHint ?? undefined,
    }));
    window.addEventListener("pagehide", save);
    return () => { window.removeEventListener("pagehide", save); };
  }, [project?.id, activeStage, currentStableId, lastWorkspaceHint]);

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
    return <main id="main-content" className="long-form-home" tabIndex={-1}>
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
      <GlobalRestorePanel onRestored={async (projectId) => {
        const items = await listLongFormProjects(); setProjects(items);
        if (items.some((item) => item.id === projectId)) await openProject(projectId);
      }} />
    </main>;
  }

  return <main id="main-content" className="long-form-workspace" tabIndex={-1}>
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
                      : index === 7
                        ? "simulation"
                        : index === 8
                          ? "repair"
                          : index === 9
                            ? "publication"
                            : index === 10
                              ? "resume"
                              : index === 11
                                ? "health"
                                : index === 12
                                  ? "recovery"
                  : null;
          const enabled = stageId === "brief"
            || (stageId === "bible" && (briefWorkflow.status === "approved" || Boolean(bible)))
            || (stageId === "routes" && (bibleWorkflow.status === "approved" || Boolean(routes)));
          const available = enabled
            || (stageId === "endings" && (routesWorkflow.status === "approved" || Boolean(endings)))
            || (stageId === "mechanics" && (endingsWorkflow.status === "approved" || Boolean(mechanics)))
            || stageId === "recovery" || stageId === "health" || stageId === "resume"
            || ((stageId === "passage-plan" || stageId === "simulation" || stageId === "repair" || stageId === "publication") && mechanicsWorkflow.status === "approved");
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
                      : stageId === "simulation"
                        ? mechanicsWorkflow.status === "approved" ? "Available" : "Not started"
                        : stageId === "repair"
                          ? mechanicsWorkflow.status === "approved" ? "Available" : "Not started"
                          : stageId === "publication"
                            ? mechanicsWorkflow.status === "approved" ? "Available" : "Not started"
                            : stageId === "resume"
                              ? "Available"
                              : stageId === "health"
                              ? "Available"
                              : stageId === "recovery"
                              ? "Available"
              : "Not started";
          return <li key={stage} className={stageId === activeStage ? "current" : ""}>
          <button aria-current={stageId === activeStage ? "step" : undefined} disabled={!available} onClick={() => {
            if (stageId) {
              navigate(stageId);
            }
          }}>
            <span>{stage}</span>
            <small>{status}</small>
          </button>
        </li>;
        })}
      </ol>
      <section className="navigation-memory" aria-labelledby="navigation-memory-heading">
        <h3 id="navigation-memory-heading">Session navigation</h3>
        <p aria-live="polite">{project.name} / {stageLabels[activeStage]}{currentStableId ? ` / ${currentStableId}` : ""}</p>
        <button disabled={navigationHistory.length === 0} onClick={() => {
          const previous = navigationHistory.at(-1); if (!previous) return;
          setNavigationHistory((items) => items.slice(0, -1)); setActiveStage(previous); localStorage.setItem(activeStageKey, previous);
          if (project) localStorage.setItem(navigationKey(project.id), JSON.stringify({ stage: previous, entityId: currentStableId || undefined, scrollY: 0, previous: lastWorkspaceHint ?? undefined }));
        }}>Back to previous workspace</button>
        <label>Stable ID jump
          <input value={stableIdInput} onChange={(event) => setStableIdInput(event.target.value)} placeholder="passage or entity ID" />
        </label>
        <div className="artifact-actions">
          <button disabled={!stableIdInput.trim()} onClick={() => navigate("passage-plan", stableIdInput.trim())}>Jump</button>
          <button disabled={!stableIdInput.trim()} onClick={() => {
            if (!navigator.clipboard?.writeText) {
              setMessage("The stable ID could not be copied. Select the text and copy it manually."); return;
            }
            void navigator.clipboard.writeText(stableIdInput.trim())
              .then(() => setMessage(`Copied stable ID ${stableIdInput.trim()}.`))
              .catch(() => setMessage("The stable ID could not be copied. Select the text and copy it manually."));
          }}>Copy ID</button>
        </div>
        <small>Stored only in this browser; never treated as project workflow state.</small>
      </section>
    </nav>

    {activeStage !== "passage-plan" && activeStage !== "simulation" && activeStage !== "repair" && activeStage !== "publication" && activeStage !== "resume" && activeStage !== "health" && activeStage !== "recovery" && <section className="artifact-tools">
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
    /> : activeStage === "passage-plan" ? <PassagePlanWorkspace
      projectId={project.id}
      mechanicsApproved={mechanicsWorkflow.status === "approved"}
      bible={bible?.content ?? null}
      routes={routes?.content ?? null}
      endings={endings?.content ?? null}
      mechanics={mechanics?.content ?? null}
      message={message}
      setMessage={setMessage}
      requestedJumpId={passagePlanJump}
      onRequestedJumpHandled={() => setPassagePlanJump("")}
    /> : activeStage === "simulation" ? <SimulationWorkspace projectId={project.id} onNavigateStableId={(stableId) => {
      setPassagePlanJump(stableId);
      navigate("passage-plan", stableId);
      setMessage(`Navigated from playtest evidence to ${stableId}.`);
    }} /> : activeStage === "repair" ? <RepairWorkspace projectId={project.id} /> : activeStage === "publication"
      ? <PublicationWorkspace projectId={project.id} />
      : activeStage === "resume" ? <ResumeWorkWorkspace projectId={project.id}
        localHint={lastWorkspaceHint}
        onNavigate={(stage, stableId) => {
          if (stableId) setPassagePlanJump(stableId);
          navigate(stage, stableId);
        }} />
      : activeStage === "health" ? <ProjectHealthWorkspace projectId={project.id} onNavigate={(stage) => {
        navigate(stage);
      }} /> : <RecoveryWorkspace projectId={project.id} onProjectDeleted={async () => {
        const items = await listLongFormProjects(); setProjects(items);
        setProject(null); setBrief(null); setBriefWorkflow(null); setBible(null); setBibleWorkflow(null);
        setRoutes(null); setRoutesWorkflow(null); setEndings(null); setEndingsWorkflow(null);
        setMechanics(null); setMechanicsWorkflow(null); localStorage.removeItem(activeProjectKey);
      }} onProjectRestored={async (restoredProjectId) => {
        const items = await listLongFormProjects(); setProjects(items);
        await openProject(restoredProjectId);
      }} />}

    {activeStage !== "passage-plan" && activeStage !== "simulation" && activeStage !== "repair" && activeStage !== "publication" && activeStage !== "resume" && activeStage !== "health" && activeStage !== "recovery" && <AssistantPanel
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
