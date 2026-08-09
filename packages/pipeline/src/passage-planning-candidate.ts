import { createHash } from "node:crypto";
import { z } from "zod";
import { ChoicePlanSchema, NarrativeThreadSchema, PassagePlanSchema, type ConditionExpression } from "./schemas/passage-plan.js";
import type { PassagePlanningContextPack } from "./passage-planning-context.js";

export const passagePlanningCandidateSchema = Object.freeze({
  id: "cyoa.passage-planning-unit-candidate",
  version: 1,
});

const GeneratedIdSchema = z.object({
  entityKind: z.enum(["choice", "thread"]),
  logicalKey: z.string().trim().min(1).max(200),
  id: z.string().trim().min(1).max(200),
}).strict();

export const PassagePlanningUnitCandidateSchema = z.object({
  schemaId: z.literal(passagePlanningCandidateSchema.id),
  schemaVersion: z.literal(passagePlanningCandidateSchema.version),
  jobId: z.string().min(1).max(200),
  unitId: z.string().min(1).max(200),
  inputFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  passages: z.array(PassagePlanSchema.strict()).min(1).max(25),
  choices: z.array(ChoicePlanSchema.strict()).max(250),
  threads: z.array(NarrativeThreadSchema.strict()).max(100),
  generatedIds: z.array(GeneratedIdSchema).max(350).default([]),
}).strict();

export type PassagePlanningUnitCandidate = z.infer<typeof PassagePlanningUnitCandidateSchema>;

export const passagePlanningCandidateLimits = Object.freeze({
  maximumSerializedBytes: 1_048_576,
  maximumSerializedBytesPerRequestedOutputToken: 8,
  maximumConditionDepth: 12,
  maximumRepairInputBytes: 262_144,
  maximumRepairOutputTokens: 8_000,
  maximumRepairsPerExecutionAttempt: 1,
});

export interface CandidateValidationInput {
  raw: string;
  jobId: string;
  unitId: string;
  inputFingerprint: string;
  context: PassagePlanningContextPack;
  maximumOutputTokens?: number;
}

export interface CandidateValidationResult {
  candidate: PassagePlanningUnitCandidate;
  diagnostics: { valid: true; checks: string[]; serializedBytes: number };
}

export class PassagePlanningCandidateError extends Error {
  public readonly code = "candidate_validation_failed";
  public readonly retryable = true;
  public constructor(message: string, public readonly issues: string[] = [message]) { super(message); }
}

export function deterministicCandidateId(inputFingerprint: string, entityKind: "choice" | "thread", logicalKey: string): string {
  const digest = createHash("sha256")
    .update(`${inputFingerprint}\0${entityKind}\0${logicalKey}`)
    .digest("hex").slice(0, 32);
  return `${entityKind === "choice" ? "ch" : "th"}_${digest}`;
}

export function validatePassagePlanningCandidate(input: CandidateValidationInput): CandidateValidationResult {
  const serializedBytes = Buffer.byteLength(input.raw, "utf8");
  const tokenDerivedByteLimit = (input.maximumOutputTokens ?? 8_000)
    * passagePlanningCandidateLimits.maximumSerializedBytesPerRequestedOutputToken;
  if (serializedBytes > Math.min(passagePlanningCandidateLimits.maximumSerializedBytes, tokenDerivedByteLimit)) {
    throw new PassagePlanningCandidateError("Candidate response exceeds the serialized-size limit");
  }
  let raw: unknown;
  try { raw = JSON.parse(input.raw) as unknown; }
  catch { throw new PassagePlanningCandidateError("Candidate response is not valid JSON"); }
  const parsed = PassagePlanningUnitCandidateSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PassagePlanningCandidateError("Candidate response does not match the required schema", parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  }
  const candidate = parsed.data;
  const issues: string[] = [];
  if (candidate.jobId !== input.jobId) issues.push("Candidate job identity does not match");
  if (candidate.unitId !== input.unitId) issues.push("Candidate unit identity does not match");
  if (candidate.inputFingerprint !== input.inputFingerprint) issues.push("Candidate input fingerprint does not match");

  const selectedIds = new Set(input.context.selectedPassages.map((item) => item.content.id));
  const neighboringIds = new Set(input.context.neighboringPassages.map((item) => item.content.id));
  const allowedPassageIds = new Set([...selectedIds, ...neighboringIds]);
  const sequenceId = input.context.structure.sequence.id;
  const routeIds = new Set((input.context.upstream.routes.routes ?? []).map((item) => item.id));
  const endingIds = new Set((input.context.upstream.endings.endings ?? []).map((item) => item.id));
  const characterIds = new Set((input.context.upstream.bible.characters ?? []).map((item) => item.id));
  const relationshipIds = new Set((input.context.upstream.bible.relationships ?? []).map((item) => item.id));
  const locationIds = new Set((input.context.upstream.bible.settings ?? []).map((item) => item.id));
  const factIds = new Set((input.context.upstream.bible.canonFacts ?? []).map((item) => item.id));
  const mechanicKeys = new Set([
    ...(input.context.upstream.mechanics.visibleStats ?? []).map((item) => item.key),
    ...(input.context.upstream.mechanics.relationships ?? []).map((item) => item.key),
    ...(input.context.upstream.mechanics.flags ?? []).map((item) => item.key),
    ...(input.context.upstream.mechanics.resources ?? []).map((item) => item.key),
  ]);
  const contextChoiceIds = new Set(input.context.choices.map((item) => item.content.id));
  const contextChoiceById = new Map(input.context.choices.map((item) => [item.content.id, item.content]));
  const contextThreadIds = new Set(input.context.threads.map((item) => item.content.id));
  const authorizedDecisionIds = new Set([
    ...input.context.structure.sequence.requiredDecisionIds,
    ...(input.context.upstream.routes.decisionPoints ?? []).map((item) => item.id),
  ]);
  const generated = new Map(candidate.generatedIds.map((item) => [`${item.entityKind}:${item.logicalKey}`, item.id]));
  if (generated.size !== candidate.generatedIds.length) issues.push("Generated logical identities must be unique");
  for (const item of candidate.generatedIds) {
    if (item.id !== deterministicCandidateId(input.inputFingerprint, item.entityKind, item.logicalKey)) {
      issues.push(`Generated ID ${item.id} is not the deterministic ID for ${item.entityKind}:${item.logicalKey}`);
    }
  }
  const choiceIds = new Set(candidate.choices.map((item) => item.id));
  const effectiveChoiceById = new Map(contextChoiceById);
  candidate.choices.forEach((item) => effectiveChoiceById.set(item.id, item));
  const candidatePassageById = new Map(candidate.passages.map((item) => [item.id, item]));
  const threadIds = new Set(candidate.threads.map((item) => item.id));
  duplicateIssues(candidate.passages.map((item) => item.id), "passage", issues);
  duplicateIssues([...choiceIds], "choice", issues);
  duplicateIssues([...threadIds], "thread", issues);
  for (const passage of candidate.passages) {
    if (!selectedIds.has(passage.id)) issues.push(`Passage ${passage.id} is outside the authorized unit scope`);
    if (passage.sequenceId !== sequenceId) issues.push(`Passage ${passage.id} has invalid sequence ownership`);
    passage.routeIds.forEach((id) => { if (!routeIds.has(id)) issues.push(`Unknown route ${id}`); });
    passage.characterIds.forEach((id) => { if (!characterIds.has(id)) issues.push(`Unknown character ${id}`); });
    passage.relationshipIds.forEach((id) => { if (!relationshipIds.has(id)) issues.push(`Unknown relationship ${id}`); });
    passage.locationIds.forEach((id) => { if (!locationIds.has(id)) issues.push(`Unknown location ${id}`); });
    [...passage.requiredFactIds, ...passage.revealedFactIds].forEach((id) => { if (!factIds.has(id)) issues.push(`Unknown fact ${id}`); });
    [...passage.setupThreadIds, ...passage.payoffThreadIds].forEach((id) => {
      if (!threadIds.has(id) && !contextThreadIds.has(id)) issues.push(`Unknown thread ${id}`);
    });
    passage.choiceIds.forEach((id) => {
      const choice = effectiveChoiceById.get(id);
      if (!choice) issues.push(`Unknown choice ${id}`);
      else if (choice.sourcePassageId !== passage.id) issues.push(`Choice ${id} does not originate from passage ${passage.id}`);
    });
    if (!passage.terminal && passage.choiceIds.length === 0) issues.push(`Nonterminal passage ${passage.id} must have an outgoing choice`);
    if (passage.terminal && passage.choiceIds.length) issues.push(`Terminal passage ${passage.id} cannot have choices`);
    if (passage.terminal && !passage.endingId) issues.push(`Terminal passage ${passage.id} must reference an ending`);
    if (!passage.terminal && passage.endingId) issues.push(`Passage ${passage.id} cannot reference an ending unless it is terminal`);
    if (passage.endingId && !endingIds.has(passage.endingId)) issues.push(`Unknown ending ${passage.endingId}`);
  }
  for (const choice of candidate.choices) {
    if (!selectedIds.has(choice.sourcePassageId)) issues.push(`Choice ${choice.id} source is outside the authorized unit scope`);
    if (!allowedPassageIds.has(choice.destinationPassageId)) issues.push(`Choice ${choice.id} destination is not an authorized neighbor`);
    choice.effects.forEach((effect) => { if (!mechanicKeys.has(effect.mechanicKey)) issues.push(`Unknown mechanic key ${effect.mechanicKey}`); });
    validateCondition(choice.condition, mechanicKeys, allowedPassageIds, issues, 1);
    choice.sourceDecisionIds.forEach((id) => { if (!authorizedDecisionIds.has(id)) issues.push(`Unauthorized source decision ${id}`); });
    const governedSource = candidatePassageById.get(choice.sourcePassageId);
    if (governedSource && !governedSource.choiceIds.includes(choice.id)) {
      issues.push(`Choice ${choice.id} is not represented in source passage ${choice.sourcePassageId}`);
    }
    if (!contextChoiceIds.has(choice.id) && !candidate.generatedIds.some((item) => item.entityKind === "choice" && item.id === choice.id)) {
      issues.push(`New choice ${choice.id} lacks deterministic generated-ID provenance`);
    }
  }
  for (const thread of candidate.threads) {
    [...thread.setupPassageIds, ...thread.payoffPassageIds].forEach((id) => { if (!allowedPassageIds.has(id)) issues.push(`Thread ${thread.id} references unauthorized passage ${id}`); });
    thread.routeIds.forEach((id) => { if (!routeIds.has(id)) issues.push(`Unknown route ${id}`); });
    if (!contextThreadIds.has(thread.id) && !candidate.generatedIds.some((item) => item.entityKind === "thread" && item.id === thread.id)) {
      issues.push(`New thread ${thread.id} lacks deterministic generated-ID provenance`);
    }
  }
  if (issues.length) throw new PassagePlanningCandidateError(issues[0]!, issues);
  return {
    candidate,
    diagnostics: {
      valid: true,
      checks: ["schema", "identity", "scope", "ownership", "stable-ids", "references", "route-semantics", "terminal-choice-consistency", "mechanics", "bounds"],
      serializedBytes,
    },
  };
}

function duplicateIssues(ids: string[], kind: string, issues: string[]): void {
  const seen = new Set<string>();
  for (const id of ids) { if (seen.has(id)) issues.push(`Duplicate ${kind} ID ${id}`); seen.add(id); }
}

function validateCondition(
  condition: ConditionExpression | null,
  mechanicKeys: Set<string>,
  passageIds: Set<string>,
  issues: string[],
  depth: number,
): void {
  if (!condition) return;
  if (depth > passagePlanningCandidateLimits.maximumConditionDepth) { issues.push("Choice condition nesting exceeds the depth limit"); return; }
  if (condition.kind === "compare" && !mechanicKeys.has(condition.mechanicKey)) issues.push(`Unknown mechanic key ${condition.mechanicKey}`);
  if (condition.kind === "visit-count" && !passageIds.has(condition.passageId)) issues.push(`Unknown visit-count passage ${condition.passageId}`);
  if (condition.kind === "not") validateCondition(condition.item, mechanicKeys, passageIds, issues, depth + 1);
  if (condition.kind === "all" || condition.kind === "any") condition.items.forEach((item) => validateCondition(item, mechanicKeys, passageIds, issues, depth + 1));
}
