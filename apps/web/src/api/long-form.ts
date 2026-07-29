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

export interface AssistantScope {
  kind: "project" | "artifact";
  projectId: string;
  stage?: "brief";
  artifactId?: "brief";
  versionId?: string;
}

export interface ConversationRecord {
  id: string;
  projectId: string;
  title: string;
  scope: AssistantScope;
  summary: string;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  intent: "discuss" | "propose";
  scope: AssistantScope;
  context: { briefVersionId?: string };
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ChangeSetRecord {
  id: string;
  projectId: string;
  conversationId: string;
  artifactId: string;
  baseVersionId: string;
  status: "proposed" | "applied" | "rejected" | "superseded";
  summary: string;
  rationale: string;
  candidate: ProjectBrief;
  invalidations: string[];
  appliedVersionId: string | null;
  createdAt: string;
  updatedAt: string;
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

const conversationBase = (projectId: string) =>
  `/api/long-form/projects/${encodeURIComponent(projectId)}/conversations`;

export async function listConversations(projectId: string): Promise<ConversationRecord[]> {
  return json(await fetch(conversationBase(projectId)));
}

export async function createConversation(projectId: string): Promise<ConversationRecord> {
  return json(await fetch(conversationBase(projectId), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Project brief discussion" }),
  }));
}

export async function loadConversation(projectId: string, conversationId: string): Promise<{
  conversation: ConversationRecord;
  messages: MessageRecord[];
  proposals: ChangeSetRecord[];
}> {
  return json(await fetch(`${conversationBase(projectId)}/${encodeURIComponent(conversationId)}`));
}

export async function updateConversationScope(
  projectId: string,
  conversationId: string,
  scope: AssistantScope,
): Promise<ConversationRecord> {
  return json(await fetch(`${conversationBase(projectId)}/${encodeURIComponent(conversationId)}/scope`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scope }),
  }));
}

export async function sendConversationMessage(input: {
  projectId: string;
  conversationId: string;
  content: string;
  intent: "discuss" | "propose";
  model: string;
}): Promise<{
  userMessage: MessageRecord;
  assistantMessage: MessageRecord;
  proposal: ChangeSetRecord | null;
  activity: Array<{ kind: string }>;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  cost: { currency: "USD"; total: number } | null;
}> {
  return json(await fetch(`${conversationBase(input.projectId)}/${encodeURIComponent(input.conversationId)}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: input.content, intent: input.intent, model: input.model }),
  }));
}

export async function applyProposal(projectId: string, conversationId: string, proposalId: string): Promise<{
  changeSet: ChangeSetRecord;
  version: ArtifactVersion<ProjectBrief>;
}> {
  return json(await fetch(
    `${conversationBase(projectId)}/${encodeURIComponent(conversationId)}/proposals/${encodeURIComponent(proposalId)}/apply`,
    { method: "POST" },
  ));
}

export async function rejectProposal(
  projectId: string,
  conversationId: string,
  proposalId: string,
): Promise<ChangeSetRecord> {
  return json(await fetch(
    `${conversationBase(projectId)}/${encodeURIComponent(conversationId)}/proposals/${encodeURIComponent(proposalId)}/reject`,
    { method: "POST" },
  ));
}
