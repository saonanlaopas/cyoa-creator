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

export interface CreativeDirectionProvenance {
  fieldPath: string;
  stableEntityId?: string;
  reference: {
    kind: "user-message" | "source-evidence" | "source-observation" | "approved-artifact" | "author-override" | "manual-edit" | "proposal" | "migration-derived";
    targetId?: string; versionId?: string; excerpt?: string; unavailable?: boolean;
  };
}

export interface CreativeDirection {
  schemaId: "cyoa.creative-direction";
  schemaVersion: 1;
  tone: { descriptors: string[]; tonalRange: "focused" | "moderate" | "wide"; exclusions: string[]; customGuidance: string };
  pacing: {
    developmentPace: "very-slow" | "slow-burn" | "measured" | "brisk" | "rapid";
    sceneTreatment: "scene-focused" | "balanced" | "summary-forward";
    actionIntensity: "low" | "moderate" | "high" | "variable";
    narrativeDensity: "spacious" | "balanced" | "dense";
    transitionDensity: "sparse" | "balanced" | "frequent";
    quietScenesAllowed: boolean;
    escalationShape: "steady" | "stepped" | "wave" | "late-surge" | "custom";
    customGuidance: string;
  };
  prose: {
    descriptiveness: "restrained" | "balanced" | "descriptive" | "lush";
    treatment: "compact" | "balanced" | "long-form";
    pointOfView: "first-person" | "second-person" | "third-person-close" | "third-person-omniscient" | "mixed";
    tense: "past" | "present" | "mixed";
    interiority: "low" | "moderate" | "high";
    dialogueIntegration: "sparse" | "balanced" | "integrated" | "dialogue-forward";
    sceneTransitionDensity: "sparse" | "balanced" | "frequent";
    passageLengthPreference: "compact" | "moderate" | "expansive" | "variable";
    voiceDescriptors: string[]; avoid: string[]; customGuidance: string;
  };
  relationshipPresentation?: {
    projectDefault?: { mechanicsVisibility: "hidden" | "subtle" | "visible"; customGuidance: string };
    profiles: Array<{
      id: string; relationshipKind: "romance" | "friendship" | "family" | "rivalry" | "partnership" | "ensemble" | "custom";
      customKind?: string; relationshipId?: string; participantIds: string[];
      developmentStyle: "gradual" | "steady" | "volatile" | "episodic" | "background" | "custom";
      emotionalTension: "low" | "moderate" | "high" | "variable"; melodrama: "low" | "moderate" | "high";
      sensuality?: "none" | "subtle" | "moderate" | "explicit-within-boundaries";
      physicalIntimacy?: "none" | "fade-to-black" | "implied" | "on-page-within-boundaries";
      mechanicsVisibility: "hidden" | "subtle" | "visible"; customGuidance: string; contentBoundaries: string[];
    }>;
  };
  scopedVariations: Array<{ id: string; scopeKind: "route" | "act" | "relationship" | "character"; scopeId: string; toneDescriptors: string[]; pacingGuidance: string; proseGuidance: string }>;
  fieldProvenance: CreativeDirectionProvenance[];
  materialFingerprint: string;
  provenanceFingerprint: string;
}

export interface BibleCharacter {
  id: string;
  name: string;
  role: string;
  summary: string;
  motivations: string[];
  knowledge: string[];
  plannedArc: string;
}

export interface BibleRelationship {
  id: string;
  characterIds: string[];
  label: string;
  currentState: string;
  plannedArc: string;
}

export interface BibleSectionEntry {
  id: string;
  label: string;
  description: string;
}

export interface LongFormStoryBible {
  schemaVersion: 1;
  title: string;
  overview: string;
  characters: BibleCharacter[];
  relationships: BibleRelationship[];
  settings: BibleSectionEntry[];
  timeline: BibleSectionEntry[];
  worldRules: BibleSectionEntry[];
  themes: BibleSectionEntry[];
  proseGuidance: { tone: string[]; pointOfView: string; style: string[]; avoid: string[] };
  canonFacts: Array<{ id: string; statement: string; sourceExcerptIds: string[]; confidence: "confirmed" | "likely" | "uncertain" }>;
  contradictions: Array<{ id: string; description: string; resolution: string }>;
  adaptationOpportunities: Array<{ id: string; description: string; rationale: string }>;
  unresolvedQuestions: Array<{ id: string; question: string; answer: string }>;
}

export interface RouteAct {
  id: string;
  routeId: string | null;
  label: string;
  purpose: string;
  summary: string;
  wordTarget: number;
}

export interface MajorRoute {
  id: string;
  name: string;
  promise: string;
  summary: string;
  entryConditions: string[];
  relationshipArcs: Array<{ relationshipId: string; trajectory: string; keyMoments: string[] }>;
  endingHookIds: string[];
}

export interface LongFormRoutePlan {
  schemaVersion: 1;
  title: string;
  overview: string;
  totalWordTarget: number;
  acts: RouteAct[];
  routes: MajorRoute[];
  decisionPoints: Array<{
    id: string;
    label: string;
    actId: string;
    question: string;
    choices: Array<{
      id: string;
      label: string;
      destinationActId: string;
      routeId: string | null;
      conditions: string[];
      consequences: string[];
    }>;
  }>;
  reconvergences: Array<{
    id: string;
    label: string;
    fromActIds: string[];
    toActId: string;
    requirements: string[];
    preservedDifferences: string[];
  }>;
  endingHooks: Array<{
    id: string;
    label: string;
    routeId: string;
    type: "success" | "partial" | "failure" | "special";
    summary: string;
  }>;
  unresolvedQuestions: Array<{ id: string; question: string; answer: string }>;
}

export interface EndingOutcome {
  id: string;
  hookId: string;
  routeId: string;
  title: string;
  type: "success" | "partial" | "failure" | "special";
  summary: string;
  thematicPayoff: string;
  wordTarget: number;
  requirements: string[];
  exclusions: string[];
  contributingDecisionIds: string[];
  foreshadowing: string[];
  characterOutcomes: Array<{ characterId: string; outcome: string }>;
  relationshipOutcomes: Array<{ relationshipId: string; outcome: string }>;
  stateConsequences: string[];
  variants: Array<{ id: string; label: string; requirements: string[]; differences: string[] }>;
}

export interface LongFormEndingPlan {
  schemaVersion: 1;
  title: string;
  overview: string;
  projectWordTarget: number;
  endingWordTarget: number;
  endings: EndingOutcome[];
  unresolvedQuestions: Array<{ id: string; question: string; answer: string }>;
}

export interface LongFormMechanicsPlan {
  schemaVersion: 1; title: string; overview: string;
  visibleStats: Array<{ id: string; key: string; label: string; description: string; minimum: number; maximum: number; initial: number; increaseSignals: string[]; decreaseSignals: string[] }>;
  relationships: Array<{ id: string; relationshipId: string; key: string; label: string; description: string; minimum: number; maximum: number; initial: number; increaseSignals: string[]; decreaseSignals: string[]; bands: Array<{ id: string; minimum: number; label: string; meaning: string }> }>;
  flags: Array<{ id: string; key: string; label: string; meaning: string }>;
  resources: Array<{ id: string; key: string; label: string; kind: "inventory" | "currency" | "counter"; initial: number; meaning: string }>;
  gates: Array<{ id: string; targetType: "route" | "ending"; targetId: string; logic: "all" | "any"; conditions: Array<{ id: string; mechanicKey: string; operator: "at-least" | "at-most" | "equals" | "present" | "absent"; value: number | null }>; rationale: string; fallback: string }>;
  choiceEffectPlans: Array<{ id: string; label: string; sourceDecisionIds: string[]; mechanicKeys: string[]; effectGuidance: string[] }>;
  balancingRules: Array<{ id: string; label: string; description: string }>;
  unresolvedQuestions: Array<{ id: string; question: string; answer: string }>;
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
  creativeDirection: ArtifactVersion<CreativeDirection> | null;
  bible: ArtifactVersion<LongFormStoryBible> | null;
  routes: ArtifactVersion<LongFormRoutePlan> | null;
  endings: ArtifactVersion<LongFormEndingPlan> | null;
  mechanics: ArtifactVersion<LongFormMechanicsPlan> | null;
  workflow: WorkflowState | {
    brief: WorkflowState; "creative-direction": WorkflowState; bible: WorkflowState; routes: WorkflowState; endings: WorkflowState; mechanics: WorkflowState;
  };
}

export interface PlanningFinding {
  code: string;
  severity: "error" | "warning" | "info";
  artifactId: "brief" | "creative-direction" | "bible" | "routes" | "endings" | "mechanics";
  entityId?: string;
  path?: string;
  message: string;
  suggestion?: string;
}

export interface AssistantScope {
  kind: "project" | "artifact";
  projectId: string;
  stage?: "brief" | "creative-direction" | "bible" | "routes" | "endings" | "mechanics";
  artifactId?: "brief" | "creative-direction" | "bible" | "routes" | "endings" | "mechanics";
  versionId?: string;
  sectionId?: string;
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
  context: {
    briefVersionId?: string; bibleVersionId?: string; routesVersionId?: string; endingsVersionId?: string;
    mechanicsVersionId?: string; creativeDirectionVersionId?: string;
    [key: string]: string | undefined;
  };
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ConversationSummaryVersion {
  id: string; stableId: string; projectId: string; conversationId: string; version: number;
  scope: AssistantScope;
  sourceRange: { firstMessageId: string; lastMessageId: string; messageCount: number; fingerprint: string };
  method: "deterministic-extractive"; methodVersion: 1; creationState: "created";
  status: "current" | "superseded" | "stale"; staleReasons: string[];
  supersedesVersionId: string | null; canonicalDependencies: Record<string, string>;
  content: string; createdAt: string;
}
export interface DecisionScope {
  kind: "project" | "artifact" | "entity";
  artifactId?: string; entityKind?: string; entityId?: string;
}
export interface PinnedDecisionVersion {
  id: string; stableId: string; projectId: string; version: number; scope: DecisionScope;
  relatedIds: string[]; content: string; status: "active" | "superseded" | "withdrawn";
  provenance: { messageId?: string; changeSetId?: string; note?: string };
  supersedesVersionId: string | null; createdAt: string; updatedAt: string;
}
export interface AuthorMemoryContext {
  authority: "non-canonical-author-memory";
  summary: ConversationSummaryVersion | null;
  decisions: PinnedDecisionVersion[];
  recentMessages: MessageRecord[];
  diagnostics: {
    summaryStatus: "none" | "current" | "superseded" | "stale";
    staleSummaryReasons: string[]; omittedDecisionCount: number; omittedDecisionBytes: number;
    omittedRecentMessageCount: number; omittedRecentMessageBytes: number;
    recentMessageBytes: number; totalAuthorMemoryBytes: number;
    limits: Record<string, number>;
  };
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
  candidate: ProjectBrief | LongFormStoryBible | LongFormRoutePlan | LongFormEndingPlan | LongFormMechanicsPlan | null;
  proposal: {
    groups: Array<{
      id: string;
      label: string;
      summary: string;
      dependsOnGroupIds: string[];
      safeToApplyIndependently: boolean;
      operations: Array<{
        id: string;
        kind: "set-fields" | "add-item" | "remove-item" | "reorder-items";
        targetId: string;
        collection?: string;
        changes?: Record<string, unknown>;
        item?: Record<string, unknown>;
        orderedIds?: string[];
        baseFingerprint: string;
      }>;
    }>;
  } | null;
  validationFindings: PlanningFinding[];
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
  creativeDirection: ArtifactVersion<CreativeDirection>;
  workflow: WorkflowState;
  creativeDirectionWorkflow: WorkflowState;
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
  creativeDirection: ArtifactVersion<CreativeDirection> | null;
  bible: ArtifactVersion<LongFormStoryBible> | null;
  routes: ArtifactVersion<LongFormRoutePlan> | null;
  endings: ArtifactVersion<LongFormEndingPlan> | null;
  mechanics: ArtifactVersion<LongFormMechanicsPlan> | null;
  workflow: { brief: WorkflowState; "creative-direction": WorkflowState; bible: WorkflowState; routes: WorkflowState; endings: WorkflowState; mechanics: WorkflowState };
  validation: PlanningFinding[];
}> {
  return json(await fetch(`/api/long-form/projects/${encodeURIComponent(projectId)}`));
}

export async function saveCreativeDirection(projectId: string, direction: CreativeDirection): Promise<{
  creativeDirection: ArtifactVersion<CreativeDirection>; workflow: WorkflowState;
}> {
  return json(await fetch(`/api/long-form/projects/${encodeURIComponent(projectId)}/creative-direction`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(direction),
  }));
}

export async function approveCreativeDirection(projectId: string, versionId: string): Promise<WorkflowState> {
  return json(await fetch(`/api/long-form/projects/${encodeURIComponent(projectId)}/creative-direction/approve`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ versionId }),
  }));
}

export async function adoptLegacyCreativeDirection(projectId: string): Promise<{
  artifact: ArtifactVersion<CreativeDirection>; workflow: WorkflowState; conflicts: string[];
}> {
  return json(await fetch(`/api/long-form/projects/${encodeURIComponent(projectId)}/creative-direction/adopt-legacy`, { method: "POST" }));
}

export async function previewCreativeDirectionContext(projectId: string): Promise<{
  artifact: ArtifactVersion<CreativeDirection>; context: CreativeDirection; diagnostics: Record<string, unknown>;
}> { return json(await fetch(`/api/long-form/projects/${encodeURIComponent(projectId)}/creative-direction/context-preview`)); }

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

export async function createStoryBible(projectId: string): Promise<{
  bible: ArtifactVersion<LongFormStoryBible>;
  workflow: WorkflowState;
}> {
  return json(await fetch(`/api/long-form/projects/${encodeURIComponent(projectId)}/bible`, {
    method: "POST",
  }));
}

export async function saveStoryBible(projectId: string, bible: LongFormStoryBible): Promise<{
  bible: ArtifactVersion<LongFormStoryBible>;
  workflow: WorkflowState;
}> {
  return json(await fetch(`/api/long-form/projects/${encodeURIComponent(projectId)}/bible`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(bible),
  }));
}

export async function approveStoryBible(projectId: string, versionId: string): Promise<WorkflowState> {
  return json(await fetch(`/api/long-form/projects/${encodeURIComponent(projectId)}/bible/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ versionId }),
  }));
}

export async function createRoutePlan(projectId: string): Promise<{
  routes: ArtifactVersion<LongFormRoutePlan>;
  workflow: WorkflowState;
}> {
  return json(await fetch(`/api/long-form/projects/${encodeURIComponent(projectId)}/routes`, {
    method: "POST",
  }));
}

export async function saveRoutePlan(projectId: string, routes: LongFormRoutePlan): Promise<{
  routes: ArtifactVersion<LongFormRoutePlan>;
  workflow: WorkflowState;
}> {
  return json(await fetch(`/api/long-form/projects/${encodeURIComponent(projectId)}/routes`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(routes),
  }));
}

export async function approveRoutePlan(projectId: string, versionId: string): Promise<WorkflowState> {
  return json(await fetch(`/api/long-form/projects/${encodeURIComponent(projectId)}/routes/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ versionId }),
  }));
}

export async function createEndingPlan(projectId: string): Promise<{
  endings: ArtifactVersion<LongFormEndingPlan>;
  workflow: WorkflowState;
}> {
  return json(await fetch(`/api/long-form/projects/${encodeURIComponent(projectId)}/endings`, { method: "POST" }));
}

export async function saveEndingPlan(projectId: string, endings: LongFormEndingPlan): Promise<{
  endings: ArtifactVersion<LongFormEndingPlan>;
  workflow: WorkflowState;
}> {
  return json(await fetch(`/api/long-form/projects/${encodeURIComponent(projectId)}/endings`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(endings),
  }));
}

export async function approveEndingPlan(projectId: string, versionId: string): Promise<WorkflowState> {
  return json(await fetch(`/api/long-form/projects/${encodeURIComponent(projectId)}/endings/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ versionId }),
  }));
}

export const createMechanicsPlan = async (projectId: string): Promise<{ mechanics: ArtifactVersion<LongFormMechanicsPlan>; workflow: WorkflowState }> =>
  json(await fetch(`/api/long-form/projects/${encodeURIComponent(projectId)}/mechanics`, { method: "POST" }));
export const saveMechanicsPlan = async (projectId: string, mechanics: LongFormMechanicsPlan): Promise<{ mechanics: ArtifactVersion<LongFormMechanicsPlan>; workflow: WorkflowState }> =>
  json(await fetch(`/api/long-form/projects/${encodeURIComponent(projectId)}/mechanics`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(mechanics) }));
export const approveMechanicsPlan = async (projectId: string, versionId: string): Promise<WorkflowState> =>
  json(await fetch(`/api/long-form/projects/${encodeURIComponent(projectId)}/mechanics/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ versionId }) }));

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

export async function downloadCreativeDirection(projectId: string, format: "markdown" | "json"): Promise<void> {
  const response = await fetch(`/api/long-form/projects/${encodeURIComponent(projectId)}/creative-direction/export?format=${format}`);
  if (!response.ok) throw new Error("Creative Direction export failed");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url;
  link.download = `${projectId}-creative-direction.${format === "markdown" ? "md" : "json"}`;
  link.click(); URL.revokeObjectURL(url);
}

export async function downloadStoryBible(projectId: string, format: "markdown" | "json"): Promise<void> {
  const response = await fetch(`/api/long-form/projects/${encodeURIComponent(projectId)}/bible/export?format=${format}`);
  if (!response.ok) throw new Error("Could not export the story bible");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${projectId}-bible.${format === "markdown" ? "md" : "json"}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function downloadRoutePlan(projectId: string, format: "markdown" | "json"): Promise<void> {
  const response = await fetch(`/api/long-form/projects/${encodeURIComponent(projectId)}/routes/export?format=${format}`);
  if (!response.ok) throw new Error("Could not export the route architecture");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${projectId}-routes.${format === "markdown" ? "md" : "json"}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function downloadEndingPlan(projectId: string, format: "markdown" | "json"): Promise<void> {
  const response = await fetch(`/api/long-form/projects/${encodeURIComponent(projectId)}/endings/export?format=${format}`);
  if (!response.ok) throw new Error("Could not export the ending architecture");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${projectId}-endings.${format === "markdown" ? "md" : "json"}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function downloadMechanicsPlan(projectId: string, format: "markdown" | "json"): Promise<void> {
  const response = await fetch(`/api/long-form/projects/${encodeURIComponent(projectId)}/mechanics/export?format=${format}`);
  if (!response.ok) throw new Error("Could not export mechanics");
  const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `${projectId}-mechanics.${format === "markdown" ? "md" : "json"}`; anchor.click(); URL.revokeObjectURL(url);
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
  messageCount?: number;
  messagesTruncated?: boolean;
  proposals: ChangeSetRecord[];
  proposalCount?: number;
  proposalsTruncated?: boolean;
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

export async function listAssistantSections(
  projectId: string,
  artifactId: string,
): Promise<Array<{ id: string; label: string }>> {
  return json(await fetch(`/api/long-form/projects/${encodeURIComponent(projectId)}/assistant-sections/${encodeURIComponent(artifactId)}`));
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

export async function loadAuthorMemoryContext(
  projectId: string, conversationId: string, scope: AssistantScope,
): Promise<AuthorMemoryContext> {
  const query = new URLSearchParams({ scope: JSON.stringify(scope) });
  return json(await fetch(`${conversationBase(projectId)}/${encodeURIComponent(conversationId)}/author-memory/context?${query}`));
}

export async function listPinnedDecisions(projectId: string, history = false): Promise<PinnedDecisionVersion[]> {
  return json(await fetch(`/api/long-form/projects/${encodeURIComponent(projectId)}/pinned-decisions?history=${history}`));
}

export async function createPinnedDecision(projectId: string, input: {
  scope: DecisionScope; content: string; relatedIds?: string[]; provenance?: PinnedDecisionVersion["provenance"];
}): Promise<PinnedDecisionVersion> {
  return json(await fetch(`/api/long-form/projects/${encodeURIComponent(projectId)}/pinned-decisions`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
  }));
}

export async function updatePinnedDecision(projectId: string, decisionId: string, input: {
  content?: string; status?: PinnedDecisionVersion["status"];
}): Promise<PinnedDecisionVersion> {
  return json(await fetch(`/api/long-form/projects/${encodeURIComponent(projectId)}/pinned-decisions/${encodeURIComponent(decisionId)}`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
  }));
}

export async function applyProposal(
  projectId: string,
  conversationId: string,
  proposalId: string,
  groupIds?: string[],
): Promise<{
  changeSet: ChangeSetRecord;
  version: ArtifactVersion<ProjectBrief | LongFormStoryBible | LongFormRoutePlan | LongFormEndingPlan | LongFormMechanicsPlan>;
}> {
  return json(await fetch(
    `${conversationBase(projectId)}/${encodeURIComponent(conversationId)}/proposals/${encodeURIComponent(proposalId)}/apply`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ groupIds }),
    },
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

export async function listArtifactVersions<T>(
  projectId: string,
  artifactId: string,
): Promise<ArtifactVersion<T>[]> {
  return json(await fetch(`/api/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(artifactId)}/versions`));
}

export async function compareArtifactVersions(
  projectId: string,
  artifactId: string,
  from: string,
  to: string,
): Promise<{ from: ArtifactVersion<unknown>; to: ArtifactVersion<unknown>; equal: boolean }> {
  const query = new URLSearchParams({ from, to });
  return json(await fetch(`/api/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(artifactId)}/compare?${query}`));
}

export async function restoreArtifactVersion(
  projectId: string,
  artifactId: string,
  versionId: string,
): Promise<{ version: ArtifactVersion<unknown>; workflow: WorkflowState; validation: PlanningFinding[] }> {
  return json(await fetch(`/api/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(artifactId)}/restore`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ versionId }),
  }));
}
