import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  openDatabase,
  ProjectRepository,
  RepairProposalGenerationRepository,
  RepairProposalRepository,
  type RepairProposalGenerationAggregateShape,
  type RepairProposalAggregateShape,
} from "../src/index.js";

function repairProposalFingerprint(value: unknown): string {
  const canonical = (item: unknown): string => {
    if (Array.isArray(item)) return `[${item.map(canonical).join(",")}]`;
    if (item && typeof item === "object") return `{${Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`).join(",")}}`;
    return JSON.stringify(item);
  };
  return createHash("sha256").update(canonical(JSON.parse(JSON.stringify(value)))).digest("hex");
}

type Aggregate = RepairProposalGenerationAggregateShape & {
  baseFingerprint: string; base: Record<string, unknown>;
  generation: RepairProposalGenerationAggregateShape["generation"] & { providerId: string; modelId: string; policy: Record<string, number | string> };
  job: RepairProposalGenerationAggregateShape["job"] & { status: string; startedAt: string | null; finishedAt: string | null; proposalId: string | null; proposalArtifactVersionId: string | null; error: unknown };
};

function aggregate(projectId: string): Aggregate {
  const base = { exact: "base" }; const baseFingerprint = repairProposalFingerprint(base);
  const policy = { id: "foundation-6b-v1", maxAttemptsPerUnit: 3 };
  const definition = {
    repairPlanId: "repair-plan", repairPlanArtifactVersionId: "repair-plan-version", repairPlanDefinitionFingerprint: "a".repeat(64),
    providerId: "offline-repair-proposal", modelId: "deterministic-repair-v1", policy, baseFingerprint,
    units: [{ position: 0, targetKeys: ["prose:p1"] }],
  };
  const fingerprint = repairProposalFingerprint(definition); const context = { exact: "context" };
  const contextFingerprint = repairProposalFingerprint(context); const unitId = "unit-1";
  return {
    schemaVersion: 1, projectId, baseFingerprint, base,
    generation: { id: "generation-1", fingerprint, definitionFingerprint: fingerprint, status: "planned", authorizedFingerprint: null,
      repairPlanId: "repair-plan", repairPlanArtifactVersionId: "repair-plan-version", repairPlanDefinitionFingerprint: "a".repeat(64),
      providerId: "offline-repair-proposal", modelId: "deterministic-repair-v1", policy },
    job: { id: "job-1", status: "planned", createdAt: "2026-08-12T00:00:00.000Z", startedAt: null, finishedAt: null,
      proposalId: null, proposalArtifactVersionId: null, error: null,
      units: [{ id: unitId, position: 0, targetKeys: ["prose:p1"], context, contextFingerprint,
        inputFingerprint: repairProposalFingerprint({ fingerprint, id: unitId, contextFingerprint }), status: "pending", attempts: [], candidates: [] }],
    },
  };
}

function attempt(number: number, status: "running" | "completed" | "failed" | "cancelled" = "running") {
  return { id: `attempt-${number}`, number, status, startedAt: `2026-08-12T00:00:0${number}.000Z`, finishedAt: status === "running" ? null : `2026-08-12T00:00:1${number}.000Z`,
    error: status === "failed" ? { code: "failed" } : null, repair: {}, usage: null, providerMetadata: [] };
}

function proposal(projectId: string): RepairProposalAggregateShape {
  const expectedBase = { kind: "passage-prose-head", targetKey: "prose:p1", passageId: "p1" };
  const operation = { id: "operation-1", groupId: "group-1", sourceFindingFingerprints: ["f".repeat(64)], kind: "create-passage-draft-candidate", entityKind: "passage-prose", entityId: "p1", targetKey: "prose:p1", expectedBase, authorizedParentTargetKey: null, before: null, after: { proposedProse: "Repair" }, fieldDiffs: [{ field: "proposedProse", before: undefined, after: "Repair" }], requiresUnlock: false };
  const definition = {
    schemaId: "cyoa.repair-proposal" as const, schemaVersion: 1 as const, projectId, repairPlanId: "repair-plan", repairPlanArtifactVersionId: "repair-plan-version", repairPlanDefinitionFingerprint: "a".repeat(64),
    sourceFindingFingerprints: ["f".repeat(64)], expectedBases: [expectedBase], generatedIds: [],
    groups: [{ id: "group-1", operationIds: [operation.id], dependsOnGroupIds: [], sourceFindingFingerprints: ["f".repeat(64)], authorizedTargetKeys: ["prose:p1"] }],
    operations: [operation], validation: { status: "valid" as const, errors: [] },
  };
  const durable = JSON.parse(JSON.stringify(definition)) as typeof definition;
  const definitionFingerprint = repairProposalFingerprint(durable);
  return { ...durable, id: `rpp_${definitionFingerprint.slice(0, 32)}`, definitionFingerprint, createdAt: "2026-08-12T00:01:00.000Z" };
}

describe("Repair proposal persistence", () => {
  it("binds append-only attempts and candidates to the unit and job lifecycle", () => {
    const database = openDatabase(); const project = new ProjectRepository(database).create("Repair lifecycle", undefined, "long-form");
    const repository = new RepairProposalGenerationRepository(database); const initial = aggregate(project.id); repository.create(initial);
    const authorized = structuredClone(initial); authorized.generation.status = "authorized"; authorized.generation.authorizedFingerprint = authorized.generation.fingerprint; authorized.job.status = "authorized"; repository.update(authorized);
    const runningJob = structuredClone(authorized); runningJob.job.status = "running"; repository.update(runningJob);
    const running = structuredClone(runningJob); running.job.units[0]!.status = "running"; running.job.units[0]!.attempts.push(attempt(1)); repository.update(running);
    const failed = structuredClone(running); failed.job.status = "failed"; failed.job.units[0]!.status = "failed"; failed.job.units[0]!.attempts[0] = attempt(1, "failed"); repository.update(failed);
    const retry = structuredClone(failed); retry.job.status = "authorized"; retry.job.units[0]!.status = "pending"; repository.update(retry);
    const retryingJob = structuredClone(retry); retryingJob.job.status = "running"; repository.update(retryingJob);
    const retrying = structuredClone(retryingJob); retrying.job.units[0]!.status = "running"; retrying.job.units[0]!.attempts.push(attempt(2)); repository.update(retrying);
    const completedUnit = structuredClone(retrying); completedUnit.job.units[0]!.status = "completed"; completedUnit.job.units[0]!.attempts[1] = attempt(2, "completed"); completedUnit.job.units[0]!.candidates.push({ attemptId: "attempt-2", candidate: { strict: true } }); repository.update(completedUnit);
    const completed = structuredClone(completedUnit); completed.job.status = "completed"; completed.job.proposalId = "proposal"; completed.job.proposalArtifactVersionId = "proposal-version"; repository.update(completed);
    expect(repository.history(project.id, initial.generation.id)).toHaveLength(10);
    database.close();
  });

  it("rejects impossible direct lifecycle transitions, mutable definitions, and forged fingerprints", () => {
    const database = openDatabase(); const project = new ProjectRepository(database).create("Repair lifecycle", undefined, "long-form");
    let sequence = 0;
    const rejected = (mutate: (value: Aggregate) => void) => {
      const value = aggregate(project.id); value.generation.id = `generation-${sequence++}`;
      const repository = new RepairProposalGenerationRepository(database); repository.create(value); const next = structuredClone(value); mutate(next); expect(() => repository.update(next)).toThrow();
    };
    rejected((value) => { value.job.status = "completed"; value.job.proposalId = "p"; value.job.proposalArtifactVersionId = "v"; value.job.units[0]!.status = "completed"; });
    rejected((value) => { value.generation.status = "authorized"; value.generation.authorizedFingerprint = value.generation.fingerprint; value.job.status = "running"; value.job.units[0]!.attempts.push(attempt(1)); });
    rejected((value) => { value.generation.providerId = "forged"; });
    rejected((value) => { value.base.exact = "forged"; });
    const forged = aggregate(project.id); forged.generation.id = "forged-create"; forged.generation.fingerprint = forged.generation.definitionFingerprint = "0".repeat(64);
    expect(() => new RepairProposalGenerationRepository(database).create(forged)).toThrow("fingerprint");
    database.close();
  });

  it("preserves cancellation and atomically commits final proposal plus generation completion", () => {
    const database = openDatabase(); const project = new ProjectRepository(database).create("Repair completion", undefined, "long-form");
    const generations = new RepairProposalGenerationRepository(database); const proposals = new RepairProposalRepository(database);
    const initial = aggregate(project.id); generations.create(initial);
    const authorized = structuredClone(initial); authorized.generation.status = "authorized"; authorized.generation.authorizedFingerprint = authorized.generation.fingerprint; authorized.job.status = "authorized"; generations.update(authorized);
    const running = structuredClone(authorized); running.job.status = "running"; running.job.units[0]!.status = "running"; running.job.units[0]!.attempts.push(attempt(1)); generations.update(running);
    const cancelled = structuredClone(running); cancelled.job.status = "cancelled"; cancelled.job.units[0]!.status = "cancelled"; cancelled.job.units[0]!.attempts[0] = attempt(1, "cancelled"); generations.update(cancelled);
    expect(() => { const retry = structuredClone(cancelled); retry.job.status = "authorized"; retry.job.units[0]!.status = "pending"; generations.update(retry); }).toThrow();

    const next = aggregate(project.id); next.generation.id = "generation-completion"; generations.create(next);
    const nextAuthorized = structuredClone(next); nextAuthorized.generation.status = "authorized"; nextAuthorized.generation.authorizedFingerprint = nextAuthorized.generation.fingerprint; nextAuthorized.job.status = "authorized"; generations.update(nextAuthorized);
    const nextRunning = structuredClone(nextAuthorized); nextRunning.job.status = "running"; nextRunning.job.units[0]!.status = "running"; nextRunning.job.units[0]!.attempts.push(attempt(1)); generations.update(nextRunning);
    const ready = structuredClone(nextRunning); ready.job.units[0]!.status = "completed"; ready.job.units[0]!.attempts[0] = attempt(1, "completed"); ready.job.units[0]!.candidates.push({ attemptId: "attempt-1", candidate: { strict: true } }); ready.job.status = "completed";
    const finalProposal = proposal(project.id);
    expect(() => proposals.completeGeneration(ready, finalProposal, { simulateFailure: true })).toThrow("Simulated");
    expect(proposals.get(project.id, finalProposal.id)).toBeUndefined(); expect(generations.get<Aggregate>(project.id, next.generation.id)?.content.job.status).toBe("running");
    const completed = proposals.completeGeneration(ready, finalProposal);
    expect(completed.proposal.content.id).toBe(finalProposal.id); expect(completed.generation.content.job.status).toBe("completed");
    expect((completed.generation.content.job as Aggregate["job"]).proposalArtifactVersionId).toBe(completed.proposal.id);
    database.close();
  });

  it("rejects invalid final proposal persistence and keeps records immutable", () => {
    const database = openDatabase(); const project = new ProjectRepository(database).create("Repair proposal", undefined, "long-form"); const repository = new RepairProposalRepository(database);
    const valid = proposal(project.id); repository.create(project.id, valid); expect(() => repository.create(project.id, valid)).toThrow("already exists");
    const invalid = structuredClone(valid); invalid.id = "invalid"; invalid.groups = []; const { id: _id, definitionFingerprint: _fp, createdAt: _at, ...definition } = invalid; invalid.definitionFingerprint = repairProposalFingerprint(definition);
    expect(() => repository.create(project.id, invalid)).toThrow();
    expect(repository.get(project.id, valid.id)?.content).toEqual(valid);
    database.close();
  });
});
