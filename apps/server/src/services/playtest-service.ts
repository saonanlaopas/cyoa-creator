import type {
  ArtifactRepository,
  ArtifactVersion,
  ProjectRepository,
} from "@story-to-cyoa/persistence";
import {
  assertPlaytestCampaignIdentity,
  createPlaytestPolicy,
  replayPlaytestSample,
  runPlaytestCampaign,
  stableFingerprint,
  type PlaytestAnalysisSource,
  type PlaytestCampaignRecord,
  type PlaytestPolicy,
  type PlaytestPolicyRequest,
  type ReplayPlaytestSampleResult,
} from "@story-to-cyoa/runtime";
import {
  SimulationService,
  SimulationServiceError,
  type ResolvedSimulationInput,
} from "./simulation-service.js";

export const PLAYTEST_CAMPAIGN_ARTIFACT_ID = "playtest-campaigns";

export class PlaytestServiceError extends Error {
  public constructor(public readonly code: string, message: string, public readonly details?: unknown) {
    super(message);
  }
}

export class PlaytestService {
  public constructor(
    private readonly projects: ProjectRepository,
    private readonly artifacts: ArtifactRepository,
    private readonly simulations: SimulationService,
  ) {}

  previewPolicy(projectId: string, inputVersionId: string, request: PlaytestPolicyRequest): {
    inputArtifactVersionId: string;
    inputFingerprint: string;
    runtimeFingerprint: string;
    snapshotId: string;
    policy: PlaytestPolicy;
  } {
    const resolved = this.resolve(projectId, inputVersionId);
    return {
      inputArtifactVersionId: resolved.inputVersion.id,
      inputFingerprint: resolved.input.fingerprint,
      runtimeFingerprint: resolved.runtime.fingerprint,
      snapshotId: resolved.input.snapshotId,
      policy: createPlaytestPolicy(request, resolved.input.policy),
    };
  }

  runCampaign(projectId: string, input: {
    inputArtifactVersionId: string;
    seed: string;
    policy?: PlaytestPolicyRequest;
  }): ArtifactVersion<PlaytestCampaignRecord> {
    const resolved = this.resolve(projectId, input.inputArtifactVersionId);
    const policy = createPlaytestPolicy(input.policy ?? {}, resolved.input.policy);
    const campaign = runPlaytestCampaign({
      identity: {
        projectId,
        simulationInputArtifactVersionId: resolved.inputVersion.id,
        simulationInputFingerprint: resolved.input.fingerprint,
        compiledRuntimeFingerprint: resolved.runtime.fingerprint,
        snapshotId: resolved.input.snapshotId,
        seed: input.seed,
      },
      runtime: resolved.runtime,
      source: analysisSource(resolved),
      policy,
    });
    return this.artifacts.saveArtifact({
      projectId,
      artifactId: PLAYTEST_CAMPAIGN_ARTIFACT_ID,
      artifactType: "playtest-campaign",
      schemaVersion: 1,
      content: campaign,
    });
  }

  listCampaigns(projectId: string): ArtifactVersion<PlaytestCampaignRecord>[] {
    this.requireProject(projectId);
    return this.artifacts.listVersions<PlaytestCampaignRecord>(projectId, PLAYTEST_CAMPAIGN_ARTIFACT_ID);
  }

  getCampaign(projectId: string, versionId: string): ArtifactVersion<PlaytestCampaignRecord> {
    this.requireProject(projectId);
    const version = this.artifacts.getVersion<PlaytestCampaignRecord>(versionId);
    if (!version || version.projectId !== projectId || version.artifactId !== PLAYTEST_CAMPAIGN_ARTIFACT_ID) {
      throw new PlaytestServiceError("playtest_campaign_not_found", "Playtest campaign not found");
    }
    try {
      assertPlaytestCampaignIdentity(version.content);
    } catch (error) {
      throw new PlaytestServiceError("playtest_evidence_integrity_failure", (error as Error).message);
    }
    return version;
  }

  replay(projectId: string, campaignVersionId: string, sampleId: string): ReplayPlaytestSampleResult {
    const campaign = this.getCampaign(projectId, campaignVersionId).content;
    const sample = campaign.samples.find((item) => item.id === sampleId);
    if (!sample) throw new PlaytestServiceError("playtest_sample_not_found", "Playtest sample not found");
    const resolved = this.resolve(projectId, campaign.simulationInputArtifactVersionId);
    if (resolved.input.fingerprint !== campaign.simulationInputFingerprint
      || resolved.runtime.fingerprint !== campaign.compiledRuntimeFingerprint
      || resolved.input.snapshotId !== campaign.snapshotId) {
      throw new PlaytestServiceError("playtest_evidence_integrity_failure", "Historical simulation input no longer matches campaign lineage");
    }
    try {
      return replayPlaytestSample(campaign, sample, resolved.runtime);
    } catch (error) {
      throw new PlaytestServiceError("playtest_evidence_integrity_failure", (error as Error).message);
    }
  }

  private resolve(projectId: string, versionId: string): ResolvedSimulationInput {
    this.requireProject(projectId);
    try {
      return this.simulations.resolveInput(projectId, versionId);
    } catch (error) {
      if (error instanceof SimulationServiceError) {
        throw new PlaytestServiceError(error.code, error.message, error.details);
      }
      throw error;
    }
  }

  private requireProject(projectId: string): void {
    if (!this.projects.get(projectId)) throw new PlaytestServiceError("project_not_found", "Project not found");
  }
}

function sortedRecord(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function analysisSource(resolved: ResolvedSimulationInput): PlaytestAnalysisSource {
  const sequenceAct = new Map(resolved.structure.sequences.map((sequence) => [sequence.id, sequence.actId]));
  const passageVersions = new Map(resolved.input.passageVersions.map((item) => [item.entityId, item.versionId]));
  const acceptedDrafts = new Map(resolved.acceptedDrafts.map((draft) => [draft.passageId, draft]));
  const acceptedReferences = new Map(resolved.input.acceptedDraftVersions.map((item) => [item.entityId, item.versionId]));
  const exactUpstreamFingerprint = stableFingerprint(sortedRecord(resolved.input.upstreamVersions));
  const passages = Object.fromEntries(resolved.passages.map((passage) => {
    const draft = acceptedDrafts.get(passage.id);
    const exactDraft = draft && draft.id === acceptedReferences.get(passage.id)
      && draft.basedOnPassagePlanVersionId === passageVersions.get(passage.id)
      && stableFingerprint(sortedRecord(draft.upstreamVersions)) === exactUpstreamFingerprint
      && Object.entries(draft.neighboringDraftVersions).every(([neighborId, versionId]) => (
        acceptedReferences.get(neighborId) === versionId
      ));
    const wordBasis = exactDraft ? "accepted-prose" as const
      : draft ? "historical-stale-accepted" as const
        : "planned-target" as const;
    return [passage.id, {
      id: passage.id,
      title: passage.title,
      actId: sequenceAct.get(passage.sequenceId) ?? null,
      sequenceId: passage.sequenceId,
      routeIds: [...passage.routeIds].sort(),
      wordTarget: passage.wordTarget,
      wordCount: draft?.wordCount ?? passage.wordTarget,
      wordBasis,
      acceptedDraftVersionId: draft?.id ?? null,
      requiredFactIds: [...passage.requiredFactIds].sort(),
      revealedFactIds: [...passage.revealedFactIds].sort(),
      setupThreadIds: [...passage.setupThreadIds].sort(),
      payoffThreadIds: [...passage.payoffThreadIds].sort(),
      authoredChoiceCount: passage.choiceIds.length,
    }];
  }));
  return {
    passages,
    threads: Object.fromEntries(resolved.threads.map((thread) => [thread.id, {
      id: thread.id,
      label: thread.label,
      setupPassageIds: [...thread.setupPassageIds].sort(),
      payoffPassageIds: [...thread.payoffPassageIds].sort(),
      routeIds: [...thread.routeIds].sort(),
      required: thread.required,
    }])),
    routeLabels: Object.fromEntries(resolved.routes.routes.map((route) => [route.id, route.name])),
    endingLabels: Object.fromEntries(resolved.endings.endings.map((ending) => [ending.id, ending.title])),
    mechanicLabels: Object.fromEntries([
      ...resolved.mechanics.visibleStats,
      ...resolved.mechanics.relationships,
      ...resolved.mechanics.flags,
      ...resolved.mechanics.resources,
    ].map((mechanic) => [mechanic.key, mechanic.label])),
  };
}
