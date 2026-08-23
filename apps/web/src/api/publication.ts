import type {
  NativeGameBundle,
  NativePlayerConfig,
  NativePlayerRewindPolicy,
  NativePlayerVisibleMechanic,
} from "@story-to-cyoa/runtime";

export interface PublicationDiagnostic {
  code: string;
  severity: "blocker" | "warning" | "info";
  message: string;
  sourceKind: string;
  sourceId: string;
  fingerprint: string;
  acknowledged: boolean;
  rationale?: string;
}

export interface PublicationReadiness {
  schemaVersion: 1;
  projectId: string;
  ready: boolean;
  sourceInputFingerprint: string | null;
  snapshotId: string | null;
  structureVersionId: string | null;
  passageCount: number;
  choiceCount: number;
  acceptedDraftCount: number;
  acceptedWordCount: number;
  blockers: PublicationDiagnostic[];
  warnings: PublicationDiagnostic[];
  acknowledgedWarnings: PublicationDiagnostic[];
  diagnostics: PublicationDiagnostic[];
  compiler: { policyId: string; policyVersion: number; version: string };
  runtimeContract: { schemaVersion: number; version: string };
  bundleContract: { schemaId: string; schemaVersion: number; maximumSerializedBytes: number };
}

export interface NativeBuildSummary {
  id: string;
  version: number;
  createdAt: string;
  current: boolean;
  content: {
    id: string;
    compilationInputArtifactVersionId: string;
    sourceInputFingerprint: string;
    bundleFingerprint: string;
    runtimeFingerprint: string;
    snapshotId: string;
    structureVersionId: string;
    compilerVersion: string;
    runtimeContractVersion: string;
    bundleSchemaId: string;
    bundleSchemaVersion: number;
    passageCount: number;
    choiceCount: number;
    acceptedWordCount: number;
    serializedBytes: number;
    validation: { valid: true; loaded: true; smokePassageId: string; availableChoiceCount: number };
  };
}

export interface NativePlayerConfigWorkspace {
  config: NativePlayerConfig;
  version: {
    id: string;
    version: number;
    createdAt: string;
  } | null;
  validForCurrentBundle: boolean;
  validationError: string | null;
  historicalBuildPolicy: "current-player-config";
  passageOptions: Array<{ id: string; title: string }>;
  visibleMechanicOptions: Array<NativePlayerVisibleMechanic & { selected: boolean }>;
}

export interface NativePlayerConfigUpdate {
  rewindPolicy: NativePlayerRewindPolicy;
  autosaveEnabled: boolean;
  manualSlotLimit: number;
  visibleMechanicKeys: string[];
}

async function json<T>(response: Response): Promise<T> {
  const body = await response.json() as T | { error?: string };
  if (!response.ok) throw new Error((body as { error?: string }).error ?? "Request failed");
  return body as T;
}

const root = (projectId: string) => `/api/long-form/projects/${encodeURIComponent(projectId)}/publication`;

export const loadPublicationReadiness = async (projectId: string) =>
  json<PublicationReadiness>(await fetch(`${root(projectId)}/readiness`));

export const listNativeBuilds = async (projectId: string) =>
  json<{ items: NativeBuildSummary[] }>(await fetch(`${root(projectId)}/builds`));

export const loadNativePlayerConfig = async (projectId: string) =>
  json<NativePlayerConfigWorkspace>(await fetch(`${root(projectId)}/player-config`));

export const saveNativePlayerConfig = async (projectId: string, input: NativePlayerConfigUpdate) =>
  json<NativePlayerConfigWorkspace>(await fetch(`${root(projectId)}/player-config`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }));

export const compileNativeBuild = async (projectId: string, inputArtifactVersionId?: string) =>
  json<{
    build: NativeBuildSummary;
    bundle: NativeGameBundle;
    playerConfig: NativePlayerConfig;
    playerConfigVersionId: string | null;
  }>(await fetch(`${root(projectId)}/compile`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(inputArtifactVersionId ? { inputArtifactVersionId } : {}),
  }));

export type PublicationExportFormat = "portable" | "markdown" | "static" | "standalone" | "twee";
export const publicationExportUrl = (projectId: string, format: PublicationExportFormat, inputArtifactVersionId?: string) =>
  `${root(projectId)}/exports/${format}${inputArtifactVersionId ? `?inputArtifactVersionId=${encodeURIComponent(inputArtifactVersionId)}` : ""}`;

async function portableRequest<T>(path: "preview" | "import", file: File): Promise<T> {
  const data = new FormData(); data.append("file", file);
  return json<T>(await fetch(`/api/portable-projects/${path}`, { method: "POST", body: data }));
}
export const previewPortableProject = (file: File) => portableRequest<{
  manifest: { projectId: string; projectFingerprint: string; historyMode: string; counts: Record<string, number>; exclusions: string[] };
  projectName: string; conflict: boolean;
}>("preview", file);
export const importPortableProject = (file: File) => portableRequest<{ projectId: string; projectFingerprint: string }>("import", file);
export const inspectTweeCompatibility = async (projectId: string) => json<{
  compatible: boolean; blockers: Array<{ code: string; message: string; path?: string }>;
  warnings: Array<{ code: string; message: string }>; compatibilityFingerprint: string;
}>(await fetch(`${root(projectId)}/twee-compatibility`));
