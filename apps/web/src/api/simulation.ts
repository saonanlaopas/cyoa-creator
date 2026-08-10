export interface SimulationInputSummary {
  versionId: string;
  version: number;
  createdAt: string;
  inputId: string;
  snapshotId: string;
  fingerprint: string;
  runtimeFingerprint: string;
  passageCount: number;
  choiceCount: number;
  acceptedDraftCount: number;
  policy: { version: string; maxSteps: number; maxVisitsPerPassage: number; maxTraceBytes: number };
}

export interface SimulationResult {
  kind: string;
  passageId: string;
  endingId: string | null;
  eligible: boolean | null;
}

export interface SimulationRunSummary {
  versionId: string;
  version: number;
  createdAt: string;
  runId: string;
  inputArtifactVersionId: string;
  inputFingerprint: string;
  runtimeFingerprint: string;
  traceFingerprint: string;
  result: SimulationResult;
  stepCount: number;
  findingCount: number;
}

export interface SimulationState {
  currentPassageId: string;
  stats: Record<string, number>;
  relationships: Record<string, number>;
  flags: Record<string, boolean>;
  resources: Record<string, number | string>;
  decisions: string[];
  routes: string[];
  knownFacts: string[];
  visitCounts: Record<string, number>;
  turn: number;
}

export interface SimulationRunVersion {
  id: string;
  version: number;
  createdAt: string;
  content: {
    id: string;
    inputArtifactVersionId: string;
    inputFingerprint: string;
    runtimeFingerprint: string;
    trace: {
      fingerprint: string;
      visitedPassageIds: string[];
      selectedChoiceIds: string[];
      result: SimulationResult;
      findings: Array<{ id: string; code: string; message: string; stepIndex: number; passageId?: string; choiceId?: string }>;
      finalState: SimulationState;
      steps: Array<{
        stepIndex: number;
        passageId: string;
        selectedChoiceId: string;
        nextPassageId: string;
        availability: { visible: boolean; enabled: boolean; reason: string | null };
        stateDelta: Array<{ path: string; before: number | boolean | string | null; after: number | boolean | string | null }>;
        stateBefore: SimulationState;
        stateAfter: SimulationState;
      }>;
    };
  };
}

async function json<T>(response: Response): Promise<T> {
  const body = await response.json() as T | { error?: string };
  if (!response.ok) throw new Error((body as { error?: string }).error ?? "Request failed");
  return body as T;
}

const root = (projectId: string) => `/api/long-form/projects/${encodeURIComponent(projectId)}/simulation`;

export const listSimulationInputs = async (projectId: string) =>
  json<{ items: SimulationInputSummary[] }>(await fetch(`${root(projectId)}/inputs`));

export const createSimulationInput = async (projectId: string) =>
  json<{ id: string; version: number; createdAt: string; content: { fingerprint: string } }>(await fetch(`${root(projectId)}/inputs`, { method: "POST" }));

export const listSimulationRuns = async (projectId: string) =>
  json<{ items: SimulationRunSummary[] }>(await fetch(`${root(projectId)}/runs`));

export const runSimulationPath = async (
  projectId: string,
  inputArtifactVersionId: string,
  choiceIds: string[],
  expectedEndingId?: string,
) => json<SimulationRunVersion>(await fetch(`${root(projectId)}/runs`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    inputArtifactVersionId,
    choiceIds,
    ...(expectedEndingId ? { expectedEndingId } : {}),
  }),
}));

export const loadSimulationRun = async (projectId: string, versionId: string) =>
  json<SimulationRunVersion>(await fetch(`${root(projectId)}/runs/${encodeURIComponent(versionId)}`));
