export type ProjectMode = "quick" | "long-form";

export interface ProjectRecord {
  id: string;
  name: string;
  mode: ProjectMode;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectBrief {
  schemaVersion: 1;
  workingTitle: string;
  premise: string;
  sourceMode: "imported-source" | "original-premise";
  protagonist: string;
  pointOfView: "first-person" | "second-person" | "third-person";
  adaptationFidelity: "canon-centered" | "balanced" | "expansive";
  tone: string;
  contentBoundaries: string[];
  totalWordTarget: number;
  typicalPlaythroughWordTarget: number;
  routeTarget: number;
  endingTarget: number;
  passageWordTarget: number;
  branchingStyle: "braided" | "route-focused" | "wide-tree";
  priorityCharacters: string[];
  priorityRelationships: string[];
  projectConstraints: string[];
  unresolvedQuestions: string[];
}

export interface ArtifactVersion<T> {
  id: string;
  projectId: string;
  artifactId: string;
  version: number;
  content: T;
  stale: boolean;
  createdAt: string;
}

export interface WorkflowState {
  projectId: string;
  artifactId: string;
  status: "empty" | "draft" | "reviewed" | "approved" | "stale";
  approvedVersionId: string | null;
  updatedAt: string;
}

export interface LongFormProjectState {
  project: ProjectRecord;
  brief: ArtifactVersion<ProjectBrief>;
  workflow: WorkflowState | { brief: WorkflowState; bible: WorkflowState };
}

async function json<T>(response: Response): Promise<T> {
  const body = await response.json() as T | { error?: string };
  if (!response.ok) throw new Error("error" in (body as object) ? (body as { error?: string }).error : "Request failed");
  return body as T;
}

export async function listLongFormProjects(): Promise<ProjectRecord[]> {
  const response = await fetch("/api/projects");
  const projects = await json<ProjectRecord[]>(response);
  return projects.filter((project) => project.mode === "long-form");
}

export async function createLongFormProject(name: string): Promise<{
  project: ProjectRecord;
  brief: ArtifactVersion<ProjectBrief>;
  workflow: WorkflowState;
}> {
  return json(await fetch("/api/long-form/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  }));
}

export async function loadLongFormProject(projectId: string): Promise<{
  project: ProjectRecord;
  brief: ArtifactVersion<ProjectBrief>;
  workflow: { brief: WorkflowState; bible: WorkflowState };
}> {
  return json(await fetch(`/api/long-form/projects/${encodeURIComponent(projectId)}`));
}

export async function saveProjectBrief(projectId: string, brief: ProjectBrief): Promise<{
  brief: ArtifactVersion<ProjectBrief>;
  workflow: WorkflowState;
}> {
  return json(await fetch(`/api/long-form/projects/${encodeURIComponent(projectId)}/brief`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(brief),
  }));
}

export async function approveProjectBrief(projectId: string, versionId: string): Promise<WorkflowState> {
  return json(await fetch(`/api/long-form/projects/${encodeURIComponent(projectId)}/brief/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ versionId }),
  }));
}

export async function downloadBrief(projectId: string, format: "markdown" | "json"): Promise<void> {
  const response = await fetch(`/api/long-form/projects/${encodeURIComponent(projectId)}/brief/export?format=${format}`);
  if (!response.ok) throw new Error("Could not export the project brief");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${projectId}-brief.${format === "markdown" ? "md" : "json"}`;
  anchor.click();
  URL.revokeObjectURL(url);
}
