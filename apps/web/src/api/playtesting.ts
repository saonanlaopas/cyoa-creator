import type {
  CompactPlaytestTrace,
  PlaytestAggregateReport,
  PlaytestCampaignRecord,
  PlaytestFinding,
  PlaytestPolicy,
  PlaytestSampleSummary,
} from "@story-to-cyoa/runtime";

export interface PlaytestCampaignSummary {
  versionId: string;
  version: number;
  createdAt: string;
  campaignId: string;
  fingerprint: string;
  simulationInputArtifactVersionId: string;
  simulationInputFingerprint: string;
  runtimeFingerprint: string;
  seed: string;
  sampleCount: number;
  hardFailureSampleCount: number;
  passageCoveragePercentage: number;
  routeCoverageCount: number;
  endingCoverageCount: number;
  findingCount: number;
  reportFingerprint: string;
}

export interface PlaytestCampaignVersion {
  id: string;
  version: number;
  createdAt: string;
  content: PlaytestCampaignRecord;
}

export interface PlaytestPolicyPreview {
  inputArtifactVersionId: string;
  inputFingerprint: string;
  runtimeFingerprint: string;
  snapshotId: string;
  policy: PlaytestPolicy;
}

export interface PlaytestReplay {
  sample: PlaytestSampleSummary;
  trace: CompactPlaytestTrace;
  verified: true;
}

export type { PlaytestAggregateReport, PlaytestFinding, PlaytestSampleSummary };

async function json<T>(response: Response): Promise<T> {
  const body = await response.json() as T | { error?: string };
  if (!response.ok) throw new Error((body as { error?: string }).error ?? "Request failed");
  return body as T;
}

const root = (projectId: string) => `/api/long-form/projects/${encodeURIComponent(projectId)}/simulation/playtests`;

export const previewPlaytestPolicy = async (
  projectId: string,
  inputArtifactVersionId: string,
  policy: Record<string, number>,
) => json<PlaytestPolicyPreview>(await fetch(`${root(projectId)}/policy`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ inputArtifactVersionId, policy }),
}));

export const runPlaytestCampaign = async (
  projectId: string,
  inputArtifactVersionId: string,
  seed: string,
  policy: Record<string, number>,
) => json<PlaytestCampaignVersion>(await fetch(`${root(projectId)}/campaigns`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ inputArtifactVersionId, seed, policy }),
}));

export const listPlaytestCampaigns = async (projectId: string) =>
  json<{ items: PlaytestCampaignSummary[] }>(await fetch(`${root(projectId)}/campaigns`));

export const loadPlaytestCampaign = async (projectId: string, versionId: string) =>
  json<PlaytestCampaignVersion>(await fetch(`${root(projectId)}/campaigns/${encodeURIComponent(versionId)}`));

export const replayPlaytestSample = async (
  projectId: string,
  versionId: string,
  sampleId: string,
) => json<PlaytestReplay>(await fetch(
  `${root(projectId)}/campaigns/${encodeURIComponent(versionId)}/samples/${encodeURIComponent(sampleId)}/replay`,
  { method: "POST" },
));
