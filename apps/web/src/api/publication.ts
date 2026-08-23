import type { NativeGameBundle, NativePlayerConfig } from "@story-to-cyoa/runtime";

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

export const compileNativeBuild = async (projectId: string, inputArtifactVersionId?: string) =>
  json<{ build: NativeBuildSummary; bundle: NativeGameBundle; playerConfig: NativePlayerConfig }>(await fetch(`${root(projectId)}/compile`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(inputArtifactVersionId ? { inputArtifactVersionId } : {}),
  }));
