import { createHash } from "node:crypto";
import { z } from "zod";
import { stableJson } from "./passage-generation-plan.js";
import type { ChoicePlan, NarrativeThread, PassagePlan } from "./schemas/passage-plan.js";

export const narrativeReviewContextSchema = Object.freeze({ id: "cyoa.narrative-review-context", version: 1 });
export const narrativeReviewOutputSchema = Object.freeze({ id: "cyoa.narrative-review-output", version: 1 });
export const narrativeReviewFindingSchema = Object.freeze({ id: "cyoa.narrative-review-finding", version: 1 });

export const NarrativeReviewCategorySchema = z.enum([
  "pacing", "repetitive-prose", "weak-or-unclear-choices", "indistinguishable-choices",
  "abrupt-transitions", "character-consistency", "voice-drift", "emotional-continuity",
  "route-differentiation", "setup-payoff", "ending-buildup", "branching-continuity",
  "reconvergence-continuity", "forgotten-consequence", "false-knowledge",
]);
export type NarrativeReviewCategory = z.infer<typeof NarrativeReviewCategorySchema>;

const ids = z.array(z.string().min(1).max(256)).max(24);
export const NarrativeReviewEvidenceReferenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("passage"), passageId: z.string().min(1), draftVersionId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("choice"), choiceId: z.string().min(1), sourcePassageId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("simulation-run"), runVersionId: z.string().min(1), traceFingerprint: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("playtest-finding"), campaignVersionId: z.string().min(1), findingId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("playtest-sample"), campaignVersionId: z.string().min(1), sampleId: z.string().min(1), traceFingerprint: z.string().min(1) }).strict(),
]);
export type NarrativeReviewEvidenceReference = z.infer<typeof NarrativeReviewEvidenceReferenceSchema>;

export const NarrativeReviewFindingCandidateSchema = z.object({
  logicalKey: z.string().min(1).max(160),
  category: NarrativeReviewCategorySchema,
  severity: z.enum(["info", "warning", "error"]),
  confidence: z.enum(["low", "medium", "high"]),
  message: z.string().min(1).max(2_000),
  reviewNote: z.string().max(2_000),
  passageIds: ids,
  choiceIds: ids,
  routeIds: ids,
  endingIds: ids,
  mechanicKeys: ids,
  threadIds: ids,
  acceptedDraftVersionIds: ids,
  evidenceReferences: z.array(NarrativeReviewEvidenceReferenceSchema).min(1).max(32),
}).strict();
export type NarrativeReviewFindingCandidate = z.infer<typeof NarrativeReviewFindingCandidateSchema>;

export const NarrativeReviewUnitOutputSchema = z.object({
  schemaId: z.literal(narrativeReviewOutputSchema.id),
  schemaVersion: z.literal(narrativeReviewOutputSchema.version),
  findings: z.array(NarrativeReviewFindingCandidateSchema).max(40),
}).strict();
export type NarrativeReviewUnitOutput = z.infer<typeof NarrativeReviewUnitOutputSchema>;

export interface NarrativeReviewPolicy {
  id: "narrative-review-v1";
  maxPassagesPerUnit: number;
  maxUnits: number;
  maxInputTokensPerUnit: number;
  maxOutputTokensPerUnit: number;
  maxFindingsPerUnit: number;
  maxFindingBytesPerUnit: number;
  maxAttemptsPerUnit: number;
  maxRepairInputBytes: number;
  maxRepairsPerAttempt: 1;
}

export const narrativeReviewPolicyV1: NarrativeReviewPolicy = Object.freeze({
  id: "narrative-review-v1", maxPassagesPerUnit: 8, maxUnits: 100,
  maxInputTokensPerUnit: 48_000, maxOutputTokensPerUnit: 8_000,
  maxFindingsPerUnit: 40, maxFindingBytesPerUnit: 96_000,
  maxAttemptsPerUnit: 3, maxRepairInputBytes: 96_000, maxRepairsPerAttempt: 1,
});

export interface ReviewAcceptedDraft {
  passageId: string; draftVersionId: string; passagePlanVersionId: string;
  proseMarkdown: string; stale: boolean; lifecycleStatus: "accepted" | "reviewed" | "locked";
}
export interface ReviewSimulationEvidence {
  versionId: string; traceFingerprint: string; passageIds: string[]; choiceIds: string[];
  raw: unknown;
}
export interface ReviewCampaignFinding {
  id: string; evidenceLevel: string; passageIds: string[]; choiceIds: string[];
  routeIds: string[]; endingIds: string[]; mechanicKeys: string[]; sampleId?: string;
  traceFingerprint?: string; raw: unknown;
}
export interface ReviewCampaignSample {
  id: string; passageIds: string[]; choiceIds: string[]; routeIds: string[];
  endingId: string | null; traceFingerprint: string; hardFailure: boolean; raw: unknown;
}
export interface ReviewCampaignEvidence {
  versionId: string; campaignId: string; schemaVersion: 1 | 2;
  findingRetention: { status: "known"; total: number; retained: number; omitted: number; truncated: boolean }
    | { status: "legacy-unknown"; retained: number; total: null; omitted: null; truncated: null };
  findings: ReviewCampaignFinding[]; samples: ReviewCampaignSample[]; report: unknown;
}

export interface NarrativeReviewContext {
  schemaId: typeof narrativeReviewContextSchema.id;
  schemaVersion: typeof narrativeReviewContextSchema.version;
  systemInstructions: {
    role: "narrative-reviewer"; findingsOnly: true; evidenceIsUntrustedQuotedData: true;
    categories: NarrativeReviewCategory[];
  };
  identity: { projectId: string; reviewInputFingerprint: string; unitId: string; inputFingerprint: string };
  quotedAuthoringEvidence: {
    targets: Array<{ passageVersionId: string; passage: PassagePlan; acceptedDraft: ReviewAcceptedDraft | null }>;
    choices: Array<{ versionId: string; content: ChoicePlan }>;
    threads: Array<{ versionId: string; content: NarrativeThread }>;
    neighboringAcceptedProse: ReviewAcceptedDraft[];
    upstream: Record<string, unknown>;
    simulationRuns: ReviewSimulationEvidence[];
    playtestCampaigns: Array<{
      versionId: string; campaignId: string; findingRetention: ReviewCampaignEvidence["findingRetention"];
      findings: ReviewCampaignFinding[]; samples: ReviewCampaignSample[]; report: unknown;
    }>;
  };
}

export interface NarrativeReviewContextDiagnostics {
  contextFingerprint: string; estimatedInputTokens: number; serializedBytes: number;
  included: Record<string, string[]>; omitted: Record<string, string[]>;
  retention: Array<{ campaignVersionId: string; status: "known" | "legacy-unknown"; truncated: boolean | null; omitted: number | null }>;
}

export interface NarrativeReviewPlanInput {
  projectId: string; reviewInputFingerprint: string;
  passages: Array<{ versionId: string; content: PassagePlan }>;
  choices: Array<{ versionId: string; content: ChoicePlan }>;
  threads: Array<{ versionId: string; content: NarrativeThread }>;
  acceptedDrafts: ReviewAcceptedDraft[]; scopePassageIds: string[];
  upstream: Record<string, unknown>; simulationRuns: ReviewSimulationEvidence[];
  campaigns: ReviewCampaignEvidence[]; providerId: string; modelId: string;
  categories?: NarrativeReviewCategory[]; policy?: NarrativeReviewPolicy;
}

export interface PlannedNarrativeReviewUnit {
  id: string; position: number; passageIds: string[]; inputFingerprint: string;
  contextFingerprint: string; estimatedInputTokens: number; maximumOutputTokens: number;
  context: NarrativeReviewContext; diagnostics: NarrativeReviewContextDiagnostics;
}
export interface PlannedNarrativeReview {
  fingerprint: string; projectId: string; reviewInputFingerprint: string;
  scopePassageIds: string[]; providerId: string; modelId: string;
  categories: NarrativeReviewCategory[]; policy: NarrativeReviewPolicy;
  units: PlannedNarrativeReviewUnit[]; estimatedInputTokens: number;
}

export class NarrativeReviewValidationError extends Error {
  public readonly code = "narrative_review_validation_failed";
  public readonly retryable = true;
  public constructor(message: string, public readonly issues: string[], public readonly structurallyRepairable = true) { super(message); }
}

export function buildNarrativeReviewPlan(input: NarrativeReviewPlanInput): PlannedNarrativeReview {
  const policy = constrainPolicy(input.policy ?? narrativeReviewPolicyV1);
  const passageById = new Map(input.passages.map((item) => [item.content.id, item]));
  const selected = [...new Set(input.scopePassageIds)].sort();
  if (!selected.length) throw new Error("Narrative review requires at least one passage");
  if (selected.some((id) => !passageById.has(id))) throw new Error("Narrative review scope contains an unknown passage");
  const categories = [...new Set(input.categories ?? NarrativeReviewCategorySchema.options)].sort() as NarrativeReviewCategory[];
  const adjacency = new Map(selected.map((id) => [id, new Set<string>()]));
  for (const choice of input.choices) {
    const { sourcePassageId: source, destinationPassageId: destination } = choice.content;
    if (adjacency.has(source) && adjacency.has(destination)) { adjacency.get(source)!.add(destination); adjacency.get(destination)!.add(source); }
  }
  const groups = connectedGroups(selected, adjacency, policy.maxPassagesPerUnit);
  if (groups.length > policy.maxUnits) throw new Error(`Narrative review exceeds the ${policy.maxUnits}-unit limit`);
  const units = groups.map((passageIds, position) => buildUnit(input, policy, categories, passageIds, position));
  const base = {
    projectId: input.projectId, reviewInputFingerprint: input.reviewInputFingerprint,
    scopePassageIds: selected, providerId: input.providerId, modelId: input.modelId,
    categories, policy,
    units: units.map(({ context: _context, ...unit }) => unit),
  };
  return { ...base, fingerprint: digest(base), units, estimatedInputTokens: units.reduce((n, unit) => n + unit.estimatedInputTokens, 0) };
}

function buildUnit(input: NarrativeReviewPlanInput, policy: NarrativeReviewPolicy, categories: NarrativeReviewCategory[], passageIds: string[], position: number): PlannedNarrativeReviewUnit {
  const targets = new Set(passageIds);
  const passageById = new Map(input.passages.map((item) => [item.content.id, item]));
  const draftByPassage = new Map(input.acceptedDrafts.map((item) => [item.passageId, item]));
  const connectedChoices = input.choices.filter((item) => targets.has(item.content.sourcePassageId) || targets.has(item.content.destinationPassageId));
  const neighborIds = [...new Set(connectedChoices.flatMap((item) => [item.content.sourcePassageId, item.content.destinationPassageId]))]
    .filter((id) => !targets.has(id)).sort();
  const threadIds = new Set(passageIds.flatMap((id) => {
    const passage = passageById.get(id)!.content; return [...passage.setupThreadIds, ...passage.payoffThreadIds];
  }));
  const threads = input.threads.filter((item) => threadIds.has(item.content.id)
    || item.content.setupPassageIds.some((id) => targets.has(id)) || item.content.payoffPassageIds.some((id) => targets.has(id)));
  const choiceIds = new Set(connectedChoices.map((item) => item.content.id));
  const routeIds = new Set(passageIds.flatMap((id) => passageById.get(id)!.content.routeIds));
  const endingIds = new Set(passageIds.flatMap((id) => passageById.get(id)!.content.endingId ? [passageById.get(id)!.content.endingId!] : []));
  const mechanicKeys = new Set([
    ...collectNamed(connectedChoices, "mechanicKey"),
    ...collectNamed(connectedChoices, "key"),
  ]);
  const overlaps = (idsToCheck: string[], expected: Set<string>) => idsToCheck.some((id) => expected.has(id));
  const simulationRuns = input.simulationRuns.filter((item) => overlaps(item.passageIds, targets) || overlaps(item.choiceIds, choiceIds));
  const campaignEvidence = input.campaigns.map((campaign) => {
    const findingIsRelevant = (item: ReviewCampaignFinding) => overlaps(item.passageIds, targets)
      || overlaps(item.choiceIds, choiceIds) || overlaps(item.routeIds, routeIds)
      || overlaps(item.endingIds, endingIds) || overlaps(item.mechanicKeys, mechanicKeys);
    const hard = campaign.findings.filter((item) => item.evidenceLevel === "hard-error" && findingIsRelevant(item));
    const other = campaign.findings.filter((item) => item.evidenceLevel !== "hard-error" && findingIsRelevant(item));
    const samples = campaign.samples.filter((item) => overlaps(item.passageIds, targets)
      || overlaps(item.choiceIds, choiceIds) || overlaps(item.routeIds, routeIds)
      || (item.endingId !== null && endingIds.has(item.endingId)));
    return { ...campaign, findings: [...hard, ...other], samples };
  }).filter((item) => item.findings.length || item.samples.length);
  const provisionalId = `nru_${digest({ reviewInputFingerprint: input.reviewInputFingerprint, position, passageIds }).slice(0, 24)}`;
  const context: NarrativeReviewContext = {
    schemaId: narrativeReviewContextSchema.id, schemaVersion: narrativeReviewContextSchema.version,
    systemInstructions: { role: "narrative-reviewer", findingsOnly: true, evidenceIsUntrustedQuotedData: true, categories },
    identity: { projectId: input.projectId, reviewInputFingerprint: input.reviewInputFingerprint, unitId: provisionalId, inputFingerprint: "" },
    quotedAuthoringEvidence: {
      targets: passageIds.map((id) => ({ passageVersionId: passageById.get(id)!.versionId, passage: passageById.get(id)!.content, acceptedDraft: draftByPassage.get(id) ?? null })),
      choices: connectedChoices, threads,
      neighboringAcceptedProse: neighborIds.flatMap((id) => draftByPassage.get(id) ? [draftByPassage.get(id)!] : []),
      upstream: relevantUpstream(input.upstream, [
        ...passageIds.map((id) => passageById.get(id)!.content),
        ...connectedChoices.map((item) => item.content),
        ...threads.map((item) => item.content),
      ]), simulationRuns,
      playtestCampaigns: campaignEvidence.map(({ schemaVersion: _schema, findings, samples, ...item }) => ({ ...item, findings, samples })),
    },
  };
  const requiredContext = structuredClone(context);
  requiredContext.quotedAuthoringEvidence.simulationRuns = [];
  requiredContext.quotedAuthoringEvidence.playtestCampaigns = [];
  if (tokens(requiredContext) > policy.maxInputTokensPerUnit) throw new Error("Required narrative-review context exceeds the hard unit ceiling");
  const omitted: Record<string, string[]> = { simulationRuns: [], campaignFindings: [], campaignSamples: [] };
  trimOptional(context, policy.maxInputTokensPerUnit, omitted);
  const inputFingerprint = digest({ reviewInputFingerprint: input.reviewInputFingerprint, passageIds, categories, policy: policy.id });
  context.identity.inputFingerprint = inputFingerprint;
  const contextFingerprint = digest(context);
  const serializedBytes = Buffer.byteLength(stableJson(context), "utf8");
  return {
    id: provisionalId, position, passageIds, inputFingerprint, contextFingerprint,
    estimatedInputTokens: tokens(context), maximumOutputTokens: policy.maxOutputTokensPerUnit, context,
    diagnostics: {
      contextFingerprint, estimatedInputTokens: tokens(context), serializedBytes,
      included: {
        passages: passageIds, choices: connectedChoices.map((item) => item.content.id),
        threads: threads.map((item) => item.content.id), neighbors: context.quotedAuthoringEvidence.neighboringAcceptedProse.map((item) => item.passageId),
        simulationRuns: context.quotedAuthoringEvidence.simulationRuns.map((item) => item.versionId),
        campaigns: context.quotedAuthoringEvidence.playtestCampaigns.map((item) => item.versionId),
      }, omitted,
      retention: input.campaigns.map((item) => ({ campaignVersionId: item.versionId, status: item.findingRetention.status, truncated: item.findingRetention.truncated, omitted: item.findingRetention.omitted })),
    },
  };
}

function trimOptional(context: NarrativeReviewContext, maximum: number, omitted: Record<string, string[]>): void {
  const evidence = context.quotedAuthoringEvidence;
  while (tokens(context) > maximum && evidence.playtestCampaigns.some((item) => item.samples.length)) {
    const campaign = [...evidence.playtestCampaigns].reverse().find((item) => item.samples.length)!;
    omitted.campaignSamples.push(campaign.samples.pop()!.id);
  }
  while (tokens(context) > maximum && evidence.playtestCampaigns.some((item) => item.findings.some((finding) => finding.evidenceLevel !== "hard-error"))) {
    const campaign = [...evidence.playtestCampaigns].reverse().find((item) => item.findings.some((finding) => finding.evidenceLevel !== "hard-error"))!;
    const index = campaign.findings.map((item) => item.evidenceLevel).lastIndexOf("observation");
    const removeAt = index >= 0 ? index : lastIndexWhere(campaign.findings, (item) => item.evidenceLevel !== "hard-error");
    omitted.campaignFindings.push(campaign.findings.splice(removeAt, 1)[0]!.id);
  }
  while (tokens(context) > maximum && evidence.simulationRuns.length) omitted.simulationRuns.push(evidence.simulationRuns.pop()!.versionId);
  if (tokens(context) > maximum) throw new Error("Required narrative-review evidence exceeds the hard unit ceiling");
}

export function validateNarrativeReviewOutput(input: {
  raw: string; context: NarrativeReviewContext; maximumOutputTokens: number;
  policy?: NarrativeReviewPolicy;
}): { output: NarrativeReviewUnitOutput; serializedBytes: number } {
  const policy = input.policy ?? narrativeReviewPolicyV1;
  const bytes = Buffer.byteLength(input.raw, "utf8");
  const tokenByteLimit = input.maximumOutputTokens * 4;
  if (bytes > policy.maxFindingBytesPerUnit || bytes > tokenByteLimit) {
    throw new NarrativeReviewValidationError("Narrative-review output exceeds its effective bound", [`${bytes} bytes exceeds ${Math.min(policy.maxFindingBytesPerUnit, tokenByteLimit)}`], false);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(input.raw); }
  catch { throw new NarrativeReviewValidationError("Narrative-review output is not JSON", ["Invalid JSON"]); }
  const result = NarrativeReviewUnitOutputSchema.safeParse(parsed);
  if (!result.success) throw new NarrativeReviewValidationError("Narrative-review output does not match the strict schema", result.error.issues.map((item) => `${item.path.join(".")}: ${item.message}`));
  if (result.data.findings.length > policy.maxFindingsPerUnit) throw new NarrativeReviewValidationError("Too many findings", ["Finding count exceeds unit policy"], false);
  const issues = validateRelations(result.data.findings, input.context);
  if (issues.length) throw new NarrativeReviewValidationError("Narrative-review findings cite invalid evidence", issues, false);
  return { output: result.data, serializedBytes: bytes };
}

function validateRelations(findings: NarrativeReviewFindingCandidate[], context: NarrativeReviewContext): string[] {
  const evidence = context.quotedAuthoringEvidence;
  const passages = new Set([...evidence.targets.map((item) => item.passage.id), ...evidence.neighboringAcceptedProse.map((item) => item.passageId)]);
  const choices = new Map(evidence.choices.map((item) => [item.content.id, item.content]));
  const routes = new Set([...collectNamed(evidence.targets, "routeIds"), ...collectNamed(evidence.upstream.routes, "id")]);
  const endings = new Set([...evidence.targets.flatMap((item) => item.passage.endingId ? [item.passage.endingId] : []), ...collectNamed(evidence.upstream.endings, "id")]);
  const mechanics = new Set([...collectNamed(evidence, "mechanicKey"), ...collectNamed(evidence.upstream.mechanics, "key")]);
  const threads = new Set(evidence.threads.map((item) => item.content.id));
  const draftPassageByVersion = new Map([...evidence.targets, ...evidence.neighboringAcceptedProse.map((draft) => ({ acceptedDraft: draft }))]
    .flatMap((item) => item.acceptedDraft ? [[item.acceptedDraft.draftVersionId, item.acceptedDraft.passageId] as const] : []));
  const drafts = new Set(draftPassageByVersion.keys());
  const runs = new Map(evidence.simulationRuns.map((item) => [item.versionId, item]));
  const campaigns = new Map(evidence.playtestCampaigns.map((item) => [item.versionId, item]));
  const seen = new Set<string>(); const issues: string[] = [];
  for (const finding of findings) {
    if (seen.has(finding.logicalKey)) issues.push(`Duplicate logical key ${finding.logicalKey}`); seen.add(finding.logicalKey);
    finding.passageIds.filter((id) => !passages.has(id)).forEach((id) => issues.push(`Unknown passage ${id}`));
    finding.choiceIds.filter((id) => !choices.has(id)).forEach((id) => issues.push(`Unknown choice ${id}`));
    finding.routeIds.filter((id) => !routes.has(id)).forEach((id) => issues.push(`Unknown route ${id}`));
    finding.endingIds.filter((id) => !endings.has(id)).forEach((id) => issues.push(`Unknown ending ${id}`));
    finding.mechanicKeys.filter((id) => !mechanics.has(id)).forEach((id) => issues.push(`Unknown mechanic ${id}`));
    finding.threadIds.filter((id) => !threads.has(id)).forEach((id) => issues.push(`Unknown thread ${id}`));
    finding.acceptedDraftVersionIds.filter((id) => !drafts.has(id)).forEach((id) => issues.push(`Unknown accepted draft ${id}`));
    if (["weak-or-unclear-choices", "indistinguishable-choices"].includes(finding.category) && finding.choiceIds.length === 0) issues.push(`${finding.category} requires exact choice IDs`);
    if (finding.category === "route-differentiation" && finding.routeIds.length === 0) issues.push("route-differentiation requires exact route IDs");
    if (finding.category === "setup-payoff" && finding.threadIds.length === 0) issues.push("setup-payoff requires exact thread IDs");
    if (finding.category === "ending-buildup" && finding.endingIds.length === 0) issues.push("ending-buildup requires an exact ending ID");
    for (const reference of finding.evidenceReferences) {
      if (reference.kind === "passage" && (!passages.has(reference.passageId) || draftPassageByVersion.get(reference.draftVersionId) !== reference.passageId)) issues.push(`Invalid passage/draft relationship ${reference.passageId}`);
      if (reference.kind === "choice" && choices.get(reference.choiceId)?.sourcePassageId !== reference.sourcePassageId) issues.push(`Invalid choice/source relationship ${reference.choiceId}`);
      if (reference.kind === "simulation-run" && runs.get(reference.runVersionId)?.traceFingerprint !== reference.traceFingerprint) issues.push(`Invalid simulation trace ${reference.runVersionId}`);
      if (reference.kind === "playtest-finding" && !campaigns.get(reference.campaignVersionId)?.findings.some((item) => item.id === reference.findingId)) issues.push(`Invalid playtest finding ${reference.findingId}`);
      if (reference.kind === "playtest-sample" && !campaigns.get(reference.campaignVersionId)?.samples.some((item) => item.id === reference.sampleId && item.traceFingerprint === reference.traceFingerprint)) issues.push(`Invalid playtest sample ${reference.sampleId}`);
    }
  }
  return issues;
}

export interface NarrativeReviewProviderRequest {
  mode: "generate" | "repair"; jobId: string; unitId: string; attemptId: string;
  providerId: string; modelId: string; inputFingerprint: string; contextFingerprint: string;
  context: NarrativeReviewContext; categories: NarrativeReviewCategory[]; maximumOutputTokens: number;
  repair?: { malformedOutput: string; validationIssues: string[] }; signal: AbortSignal;
}
export interface NarrativeReviewProviderResult {
  output: string; usage?: { inputTokens: number; outputTokens: number; cost: number | null };
  metadata?: Record<string, unknown>;
}
export interface NarrativeReviewProvider {
  readonly id: string; readonly capabilities: { structuredOutput: boolean };
  generate(request: NarrativeReviewProviderRequest): Promise<NarrativeReviewProviderResult>;
}

export const fingerprintNarrativeReviewContext = (context: NarrativeReviewContext) => digest(context);
export const estimateNarrativeReviewTokens = tokens;
export const narrativeReviewDigest = digest;

function connectedGroups(idsToGroup: string[], adjacency: Map<string, Set<string>>, max: number): string[][] {
  const remaining = new Set(idsToGroup); const groups: string[][] = [];
  while (remaining.size) {
    const seed = idsToGroup.find((id) => remaining.has(id))!; const queue = [seed]; const group: string[] = [];
    while (queue.length && group.length < max) {
      const current = queue.shift()!; if (!remaining.delete(current)) continue; group.push(current);
      [...(adjacency.get(current) ?? [])].sort().forEach((id) => { if (remaining.has(id) && !queue.includes(id)) queue.push(id); });
    }
    groups.push(group.sort());
  }
  return groups;
}
function constrainPolicy(policy: NarrativeReviewPolicy): NarrativeReviewPolicy {
  const backend = narrativeReviewPolicyV1;
  return {
    ...backend,
    ...policy,
    id: "narrative-review-v1",
    maxPassagesPerUnit: Math.min(Math.max(1, policy.maxPassagesPerUnit), backend.maxPassagesPerUnit),
    maxUnits: Math.min(Math.max(1, policy.maxUnits), backend.maxUnits),
    maxInputTokensPerUnit: Math.min(Math.max(1, policy.maxInputTokensPerUnit), backend.maxInputTokensPerUnit),
    maxOutputTokensPerUnit: Math.min(Math.max(1, policy.maxOutputTokensPerUnit), backend.maxOutputTokensPerUnit),
    maxFindingsPerUnit: Math.min(Math.max(1, policy.maxFindingsPerUnit), backend.maxFindingsPerUnit),
    maxFindingBytesPerUnit: Math.min(Math.max(1, policy.maxFindingBytesPerUnit), backend.maxFindingBytesPerUnit),
    maxAttemptsPerUnit: Math.min(Math.max(1, policy.maxAttemptsPerUnit), backend.maxAttemptsPerUnit),
    maxRepairInputBytes: Math.min(Math.max(1, policy.maxRepairInputBytes), backend.maxRepairInputBytes),
    maxRepairsPerAttempt: 1,
  };
}
function collectNamed(value: unknown, key: string, result = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => collectNamed(item, key, result));
  else if (value && typeof value === "object") Object.entries(value as Record<string, unknown>).forEach(([name, item]) => {
    if (name === key && typeof item === "string") result.add(item);
    if (name === key && Array.isArray(item)) item.filter((entry): entry is string => typeof entry === "string").forEach((entry) => result.add(entry));
    collectNamed(item, key, result);
  });
  return result;
}
function lastIndexWhere<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) if (predicate(items[index]!)) return index;
  return -1;
}
function relevantUpstream(upstream: Record<string, unknown>, seeds: unknown[]): Record<string, unknown> {
  const identifiers = collectStrings(seeds);
  const filter = (value: unknown, depth: number): unknown => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.entries(record).map(([key, item]) => {
      if (!Array.isArray(item)) return [key, item];
      if (depth > 1 || ["contentBoundaries", "projectConstraints", "balancingRules", "proseGuidance"].includes(key)) return [key, item];
      return [key, item.filter((entry) => {
        const strings = collectStrings(entry);
        return strings.size === 0 || [...strings].some((id) => identifiers.has(id));
      }).map((entry) => filter(entry, depth + 1))];
    }));
  };
  return Object.fromEntries(Object.entries(upstream).map(([key, value]) => [key, filter(value, 0)]));
}
function collectStrings(value: unknown, result = new Set<string>()): Set<string> {
  if (typeof value === "string") result.add(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, result));
  else if (value && typeof value === "object") Object.values(value as Record<string, unknown>).forEach((item) => collectStrings(item, result));
  return result;
}
function tokens(value: unknown): number { return Math.max(1, Math.ceil(Buffer.byteLength(stableJson(value), "utf8") / 4)); }
function digest(value: unknown): string { return createHash("sha256").update(stableJson(value)).digest("hex"); }
