import type {
  CompiledRuntime,
  DeterministicPathPolicy,
  RuntimeFinding,
  RuntimeResult,
  RuntimeScalar,
  RuntimeState,
  RuntimeStateDelta,
} from "./types.js";
import type { PLAYTEST_PRNG_VERSION } from "./prng.js";

export const PLAYTEST_POLICY_VERSION = "foundation-5b-v1" as const;
export const PLAYTEST_STRATEGY_VERSION = "coverage-aware-v1" as const;

export const PLAYTEST_BACKEND_LIMITS = Object.freeze({
  maxSamples: 500,
  maxStepsPerSample: 500,
  maxVisitsPerPassage: 20,
  maxTotalSampledSteps: 50_000,
  maxTraceBytesPerSample: 2_000_000,
  maxCampaignBytes: 16_000_000,
  maxFindings: 2_000,
  maxFindingBytes: 4_000_000,
  maxRetainedFullTraces: 24,
  maxSeedBytes: 256,
  maxChoiceIdsPerCampaign: 50_500,
});

export interface PlaytestPolicyRequest {
  sampleCount?: number;
  maxStepsPerSample?: number;
  maxVisitsPerPassage?: number;
  maxTraceBytesPerSample?: number;
  linearStretchThreshold?: number;
  denseChoiceThreshold?: number;
}

export interface PlaytestPolicy {
  version: typeof PLAYTEST_POLICY_VERSION;
  prngVersion: typeof PLAYTEST_PRNG_VERSION;
  strategyVersion: typeof PLAYTEST_STRATEGY_VERSION;
  sampleCount: number;
  maxStepsPerSample: number;
  maxVisitsPerPassage: number;
  maxTraceBytesPerSample: number;
  maxTotalSampledSteps: number;
  maxCampaignBytes: number;
  maxFindings: number;
  maxFindingBytes: number;
  maxRetainedFullTraces: number;
  maxChoiceIdsPerCampaign: number;
  linearStretchThreshold: number;
  denseChoiceThreshold: number;
}

export type PassageWordBasis = "accepted-prose" | "historical-stale-accepted" | "planned-target";

export interface PlaytestPassageEvidence {
  id: string;
  title: string;
  actId: string | null;
  sequenceId: string;
  routeIds: string[];
  wordTarget: number;
  wordCount: number;
  wordBasis: PassageWordBasis;
  acceptedDraftVersionId: string | null;
  requiredFactIds: string[];
  revealedFactIds: string[];
  setupThreadIds: string[];
  payoffThreadIds: string[];
  authoredChoiceCount: number;
}

export interface PlaytestThreadEvidence {
  id: string;
  label: string;
  setupPassageIds: string[];
  payoffPassageIds: string[];
  routeIds: string[];
  required: boolean;
}

export interface PlaytestAnalysisSource {
  passages: Record<string, PlaytestPassageEvidence>;
  threads: Record<string, PlaytestThreadEvidence>;
  routeLabels: Record<string, string>;
  endingLabels: Record<string, string>;
  mechanicLabels: Record<string, string>;
  routeDecisionIds: Record<string, string[]>;
  sharedDecisionIds: string[];
}

export interface CompactPlaytestStep {
  stepIndex: number;
  passageId: string;
  selectedChoiceId: string;
  nextPassageId: string;
  enabledChoiceIds: string[];
  stateDelta: RuntimeStateDelta[];
}

export interface CompactPlaytestTrace {
  schemaVersion: 1;
  simulationInputFingerprint: string;
  compiledRuntimeFingerprint: string;
  sampleSeed: string;
  sampleIndex: number;
  policy: Pick<PlaytestPolicy, "version" | "maxStepsPerSample" | "maxVisitsPerPassage" | "maxTraceBytesPerSample">;
  visitedPassageIds: string[];
  selectedChoiceIds: string[];
  steps: CompactPlaytestStep[];
  finalState: RuntimeState;
  result: RuntimeResult;
  runtimeFindings: RuntimeFinding[];
  hardFailureCodes: string[];
  fingerprint: string;
}

export interface PlaytestWordSummary {
  total: number;
  basis: "accepted-prose" | "planned-target" | "mixed-accepted-and-planned" | "historical-stale-accepted";
  acceptedWords: number;
  plannedWords: number;
  historicalStaleAcceptedWords: number;
}

export interface PlaytestSampleSummary {
  id: string;
  index: number;
  seed: string;
  choiceIds: string[];
  visitedPassageIds: string[];
  observedEnabledChoiceIds: string[];
  result: RuntimeResult;
  hardFailure: boolean;
  hardFailureCodes: string[];
  stepCount: number;
  traceFingerprint: string;
  finalStateFingerprint: string;
  finalMechanicValues: Record<string, RuntimeScalar>;
  routeIds: string[];
  decisionIds: string[];
  endingId: string | null;
  words: PlaytestWordSummary;
  fingerprint: string;
}

export interface PassageCoverageItem {
  passageId: string;
  visitCount: number;
  sampleCount: number;
  firstSampleIndex: number | null;
  lastSampleIndex: number | null;
}

export interface ChoiceCoverageItem {
  choiceId: string;
  selectionCount: number;
  selectedSampleCount: number;
  observedEnabledCount: number;
  observedEnabledSampleCount: number;
}

export interface RouteCoverageItem {
  routeId: string;
  label: string;
  sampleCount: number;
  frequency: number;
  associatedPassageSampleCount: number;
  decisionIds: string[];
}

export interface EndingCoverageItem {
  endingId: string;
  label: string;
  completedCount: number;
  ineligibleCount: number;
  observedCount: number;
  frequency: number;
}

export interface MechanicTrajectoryReport {
  mechanicKey: string;
  label: string;
  category: "stat" | "relationship" | "flag" | "resource";
  initialValue: RuntimeScalar;
  observedWriteCount: number;
  observedMinimum: number | null;
  observedMaximum: number | null;
  samplesChanged: number;
  choiceIdsCausingChanges: string[];
  downstreamReadChoiceIds: string[];
  downstreamEndingIds: string[];
  samplesWithObservedDownstreamConsequence: number;
  finalDistribution: Record<string, number>;
  routeFinalDistributions: Record<string, Record<string, number>>;
  endingFinalDistributions: Record<string, Record<string, number>>;
}

export interface ContinuityReport {
  requiredBeforeKnownCount: number;
  payoffBeforeSetupCount: number;
  setupWithoutPayoffCompletedCount: number;
  finalKnownFactCounts: Record<string, number>;
  routeKnownFactCounts: Record<string, Record<string, number>>;
  threadObservations: Array<{
    threadId: string;
    setupSampleCount: number;
    payoffSampleCount: number;
    payoffWithoutSetupSampleCount: number;
    setupWithoutPayoffCompletedSampleCount: number;
    routeSampleCounts: Record<string, number>;
  }>;
}

export interface PacingReport {
  minimumWords: number | null;
  medianWords: number | null;
  maximumWords: number | null;
  averageWords: number | null;
  basisCounts: Record<PlaytestWordSummary["basis"], number>;
  actWordTotals: Record<string, number>;
  sequenceWordTotals: Record<string, number>;
  longLinearStretchCount: number;
  denseChoiceRegionCount: number;
  enabledChoicesPerVisitedPassage: Record<string, number>;
  authoredChoicesPerVisitedPassage: Record<string, number>;
}

export interface RouteExclusiveReportItem {
  routeId: string;
  authoredPassageIds: string[];
  observedPassageIds: string[];
  authoredWords: number;
  observedWords: number;
  acceptedWordVolume: number;
  plannedWordVolume: number;
}

export interface RepresentativeSamples {
  shortestCompletedSampleId: string | null;
  medianCompletedSampleId: string | null;
  longestCompletedSampleId: string | null;
  minimumWordSampleId: string | null;
  maximumWordSampleId: string | null;
}

export interface PlaytestAggregateReport {
  schemaVersion: 1;
  sampleCount: number;
  completedSampleCount: number;
  hardFailureSampleCount: number;
  totalSampledSteps: number;
  passageCoverage: {
    total: number;
    visited: number;
    unvisited: number;
    percentage: number;
    items: PassageCoverageItem[];
  };
  choiceCoverage: {
    total: number;
    selected: number;
    neverSelected: number;
    neverObservedEnabled: number;
    items: ChoiceCoverageItem[];
  };
  routeCoverage: RouteCoverageItem[];
  endingCoverage: EndingCoverageItem[];
  mechanics: MechanicTrajectoryReport[];
  relationships: MechanicTrajectoryReport[];
  continuity: ContinuityReport;
  pacing: PacingReport;
  routeExclusiveContent: RouteExclusiveReportItem[];
  /** Present on Foundation 5B schema-v2 reports. */
  sharedDecisionIds?: string[];
  representatives: RepresentativeSamples;
  fingerprint: string;
}

export type PlaytestFindingCategory =
  | "runtime-hard-failure"
  | "coverage"
  | "pacing"
  | "mechanic"
  | "relationship"
  | "continuity"
  | "thread"
  | "route-exclusive";

export type PlaytestEvidenceLevel = "hard-error" | "warning" | "coverage-gap" | "observation";

export interface PlaytestFinding {
  id: string;
  fingerprint: string;
  schemaVersion: 1;
  campaignId: string;
  projectId: string;
  simulationInputArtifactVersionId: string;
  simulationInputFingerprint: string;
  policyVersion: typeof PLAYTEST_POLICY_VERSION;
  campaignSeed: string;
  sampleId: string | null;
  sampleIndex: number | null;
  traceFingerprint: string | null;
  category: PlaytestFindingCategory;
  code: string;
  evidenceLevel: PlaytestEvidenceLevel;
  message: string;
  passageIds: string[];
  choiceIds: string[];
  mechanicKeys: string[];
  routeIds: string[];
  endingIds: string[];
  evidence: Record<string, unknown>;
}

export interface PlaytestCampaignIdentity {
  projectId: string;
  simulationInputArtifactVersionId: string;
  simulationInputFingerprint: string;
  compiledRuntimeFingerprint: string;
  snapshotId: string;
  seed: string;
  policy: PlaytestPolicy;
}

export interface PlaytestFindingRetentionDiagnostics {
  totalFindingCount: number;
  retainedFindingCount: number;
  omittedFindingCount: number;
  retainedFindingBytes: number;
  truncated: boolean;
  aggregateReportFindingBasis: "all-generated-findings";
}

export interface PlaytestCampaignRecord extends PlaytestCampaignIdentity {
  schemaVersion: 1 | 2;
  id: string;
  status: "completed";
  requestedSampleCount: number;
  actualSampleCount: number;
  samples: PlaytestSampleSummary[];
  retainedTraces: CompactPlaytestTrace[];
  report: PlaytestAggregateReport;
  findings: PlaytestFinding[];
  /** Present on schema v2. Omitted only on historical schema-v1 campaigns. */
  findingRetention?: PlaytestFindingRetentionDiagnostics;
  fingerprint: string;
}

export interface RunPlaytestCampaignInput {
  identity: Omit<PlaytestCampaignIdentity, "policy">;
  runtime: CompiledRuntime;
  source: PlaytestAnalysisSource;
  policy: PlaytestPolicy;
}

export interface ReplayPlaytestSampleResult {
  sample: PlaytestSampleSummary;
  trace: CompactPlaytestTrace;
  verified: true;
}

export interface PlaytestPolicyInputRuntimeBounds extends DeterministicPathPolicy {}
