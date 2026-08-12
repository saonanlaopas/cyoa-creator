import { createHash } from "node:crypto";
import {
  REPAIR_PLANNING_POLICY_V1,
  repairImpactSchema,
  repairFindingReferenceSchema,
  repairPlanSchema,
  type RepairPlanDefinition,
  type RepairPlanRecord,
} from "@story-to-cyoa/domain";
import { describe, expect, it } from "vitest";
import { openDatabase, ProjectRepository, RepairPlanRepository } from "../src/index.js";

function repairFingerprint(value: unknown): string {
  const canonical = (item: unknown): string => {
    if (Array.isArray(item)) return `[${item.map(canonical).join(",")}]`;
    if (item && typeof item === "object") return `{${Object.entries(item as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`).join(",")}}`;
    return JSON.stringify(item);
  };
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function validDefinition(projectId: string): RepairPlanDefinition {
  const finding = {
    code: "missing-ending", severity: "warning" as const, entityType: "passage" as const, entityId: "p1",
    message: "Passage needs an ending", evidence: ["p1"], suggestion: "Add the ending", acknowledged: false,
  };
  const sourceFingerprint = repairFingerprint(finding);
  const reference = {
    schemaId: repairFindingReferenceSchema.id, schemaVersion: repairFindingReferenceSchema.version,
    kind: "foundation-3-static-validation" as const, projectId, snapshotId: "snapshot-1", snapshotVersion: 1,
    structureVersionId: "structure-1", upstreamVersions: { routes: "routes-1" },
    findingFingerprint: sourceFingerprint, finding,
  };
  const nodes = [{
    id: "direct:passage-plan-passage:passage:p1", classification: "direct" as const,
    entityKind: "passage-plan-passage", entityId: "passage:p1", label: "passage:p1",
    reason: "Explicitly authorized mutation target",
  }];
  const impactCore = {
    schemaId: repairImpactSchema.id, schemaVersion: repairImpactSchema.version,
    policyId: REPAIR_PLANNING_POLICY_V1.impactPolicyId, nodes, edges: [],
  };
  return {
    schemaId: repairPlanSchema.id, schemaVersion: repairPlanSchema.version, projectId,
    selectedFindings: [reference],
    resolvedFindings: [{
      reference, sourceFingerprint, sourceState: "current", stateReasons: [],
      categoryCode: "missing-ending", message: "Passage needs an ending", entityKeys: ["passage:p1"],
    }],
    intent: { schemaVersion: 1, category: "passage-plan", note: "Repair the passage" },
    authorizedTargets: [{ kind: "passage-plan-passage", passageId: "p1" }],
    expectedBases: [{ kind: "passage-entity-version", targetKey: "passage:p1", entityKind: "passage", entityId: "p1", versionId: "passage-v1" }],
    impactGraph: { ...impactCore, fingerprint: repairFingerprint(impactCore) },
    sourceState: "current", providerNeeded: "manual-deterministic", contextAvailability: [],
    policy: { ...REPAIR_PLANNING_POLICY_V1 },
  };
}

function record(id: string, definition: RepairPlanDefinition): RepairPlanRecord {
  return { id, definition, definitionFingerprint: repairFingerprint(definition), createdAt: "2026-08-12T00:00:00.000Z" };
}

function reseal(definition: RepairPlanDefinition, impact = true): RepairPlanDefinition {
  if (impact) {
    const graph = definition.impactGraph;
    graph.fingerprint = repairFingerprint({
      schemaId: graph.schemaId, schemaVersion: graph.schemaVersion, policyId: graph.policyId,
      nodes: graph.nodes, edges: graph.edges,
    });
  }
  return definition;
}

describe("RepairPlanRepository", () => {
  it("saves, lists, and reopens one canonical immutable definition with project cascade", () => {
    const database = openDatabase();
    const projects = new ProjectRepository(database);
    const repository = new RepairPlanRepository(database);
    const project = projects.create("Repair persistence", undefined, "long-form");
    expect((database.prepare("SELECT MAX(version) version FROM schema_migrations").get() as { version: number }).version).toBe(13);
    const plan = record("repair-1", validDefinition(project.id));
    const created = repository.create(project.id, plan);
    expect(created.version).toBe(1);
    expect(repository.get(project.id, plan.id)?.content).toEqual(plan);
    expect(repository.getVersion(project.id, created.id)?.content).toEqual(plan);
    expect(repository.list(project.id)).toHaveLength(1);
    expect(() => repository.create(project.id, plan)).toThrow("already exists");
    expect(() => database.prepare("DELETE FROM projects WHERE id = ?").run(project.id)).not.toThrow();
    expect(repository.list(project.id)).toEqual([]);
    database.close();
  });

  it("rejects malformed canonical and relational definitions at create", () => {
    const database = openDatabase();
    const projects = new ProjectRepository(database);
    const repository = new RepairPlanRepository(database);
    const project = projects.create("Repair persistence", undefined, "long-form");
    let sequence = 0;
    const rejected = (mutate: (definition: RepairPlanDefinition) => void, impact = true) => {
      const definition = structuredClone(validDefinition(project.id));
      mutate(definition);
      reseal(definition, impact);
      expect(() => repository.create(project.id, record(`invalid-${sequence++}`, definition))).toThrow();
    };

    rejected((definition) => { definition.selectedFindings = []; definition.resolvedFindings = []; });
    rejected((definition) => {
      const replacement = structuredClone(definition.resolvedFindings[0]!);
      replacement.reference.finding.entityId = "p2";
      replacement.reference.findingFingerprint = repairFingerprint(replacement.reference.finding);
      replacement.sourceFingerprint = replacement.reference.findingFingerprint;
      definition.resolvedFindings = [replacement];
    });
    rejected((definition) => { definition.resolvedFindings[0]!.sourceFingerprint = "0".repeat(64); });
    rejected((definition) => { definition.resolvedFindings = []; });
    rejected((definition) => {
      definition.selectedFindings.push(structuredClone(definition.selectedFindings[0]!));
      definition.resolvedFindings.push(structuredClone(definition.resolvedFindings[0]!));
    });
    rejected((definition) => { definition.expectedBases = []; });
    rejected((definition) => { definition.expectedBases.push({ kind: "passage-entity-version", targetKey: "passage:p2", entityKind: "passage", entityId: "p2", versionId: "passage-v2" }); });
    rejected((definition) => { definition.expectedBases[0]!.targetKey = "passage:wrong"; });
    rejected((definition) => { definition.expectedBases = [{ kind: "artifact-entity-version", targetKey: "passage:p1", artifactId: "routes", artifactVersionId: "routes-v1", entityType: "route", entityId: "p1", entityFingerprint: "c".repeat(64) }]; });
    rejected((definition) => { definition.impactGraph.nodes.push({ id: "direct:route:route:forged", classification: "direct", entityKind: "route", entityId: "route:forged", label: "forged", reason: "forged" }); });
    rejected((definition) => { definition.impactGraph.fingerprint = "0".repeat(64); }, false);
    rejected((definition) => { definition.sourceState = "historical"; });
    rejected((definition) => { definition.intent = { schemaVersion: 1, category: "passage-plan", note: "x".repeat(2_001) }; });
    rejected((definition) => { (definition.policy as { maxSelectedFindings: number }).maxSelectedFindings = 7; });
    expect(repository.list(project.id)).toEqual([]);
    database.close();
  });

  it("rejects malformed persisted content at every read boundary", () => {
    const database = openDatabase();
    const projects = new ProjectRepository(database);
    const repository = new RepairPlanRepository(database);
    const project = projects.create("Repair persistence", undefined, "long-form");
    const plan = record("repair-1", validDefinition(project.id));
    const created = repository.create(project.id, plan);
    const malformed = structuredClone(plan) as unknown as { definition: { policy: { maxSelectedFindings: number } }; definitionFingerprint: string };
    malformed.definition.policy.maxSelectedFindings = 7;
    malformed.definitionFingerprint = repairFingerprint(malformed.definition);
    database.prepare("UPDATE artifact_versions SET content_json = ? WHERE id = ?").run(JSON.stringify(malformed), created.id);
    expect(() => repository.get(project.id, plan.id)).toThrow();
    expect(() => repository.getVersion(project.id, created.id)).toThrow();
    expect(() => repository.list(project.id)).toThrow();
    database.close();
  });

  it("rejects cross-project identity, fingerprint tampering, and appended versions", () => {
    const database = openDatabase();
    const projects = new ProjectRepository(database);
    const repository = new RepairPlanRepository(database);
    const project = projects.create("Repair persistence", undefined, "long-form");
    const other = projects.create("Other", undefined, "long-form");
    const plan = record("repair-1", validDefinition(project.id));
    const created = repository.create(project.id, plan);
    expect(() => repository.create(other.id, plan)).toThrow("identity mismatch");
    expect(() => repository.create(project.id, { ...plan, id: "repair-2", definitionFingerprint: "0".repeat(64) })).toThrow("fingerprint mismatch");
    database.prepare(`INSERT INTO artifact_versions
      (id, project_id, artifact_id, artifact_type, version, schema_version, content_json, stale, created_at)
      VALUES ('tampered-version', ?, 'repair-plan:repair-1', 'repair-plan', 2, 1, ?, 0, ?)`)
      .run(project.id, JSON.stringify(plan), plan.createdAt);
    expect(() => repository.get(project.id, plan.id)).toThrow("immutable");
    expect(() => repository.list(project.id)).toThrow("immutable");
    expect(repository.getVersion(project.id, created.id)?.content).toEqual(plan);
    database.close();
  });
});
