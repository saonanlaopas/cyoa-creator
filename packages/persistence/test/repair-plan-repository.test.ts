import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { openDatabase, ProjectRepository, RepairPlanRepository } from "../src/index.js";

function definition(projectId: string) {
  return {
    schemaId: "cyoa.repair-plan" as const,
    schemaVersion: 1 as const,
    projectId,
    selectedFindings: [], resolvedFindings: [], intent: {}, authorizedTargets: [], expectedBases: [],
    impactGraph: {}, sourceState: "current", providerNeeded: "manual-deterministic", contextAvailability: [], policy: {},
  };
}

function repairFingerprint(value: unknown): string {
  const canonical = (item: unknown): string => {
    if (Array.isArray(item)) return `[${item.map(canonical).join(",")}]`;
    if (item && typeof item === "object") return `{${Object.entries(item as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`).join(",")}}`;
    return JSON.stringify(item);
  };
  return createHash("sha256").update(canonical(value)).digest("hex");
}

describe("RepairPlanRepository", () => {
  it("saves, lists, and reopens one immutable definition with project cascade", () => {
    const database = openDatabase();
    const projects = new ProjectRepository(database);
    const repository = new RepairPlanRepository(database);
    const project = projects.create("Repair persistence", undefined, "long-form");
    expect((database.prepare("SELECT MAX(version) version FROM schema_migrations").get() as { version: number }).version).toBe(13);
    const planDefinition = definition(project.id);
    const record = {
      id: "repair-1", definitionFingerprint: repairFingerprint(planDefinition),
      definition: planDefinition, createdAt: "2026-08-12T00:00:00.000Z",
    };
    const created = repository.create(project.id, record);
    expect(created.version).toBe(1);
    expect(repository.get(project.id, record.id)?.content).toEqual(record);
    expect(repository.getVersion(project.id, created.id)?.content).toEqual(record);
    expect(repository.list(project.id)).toHaveLength(1);
    expect(() => repository.create(project.id, record)).toThrow("already exists");
    expect(() => database.prepare("DELETE FROM projects WHERE id = ?").run(project.id)).not.toThrow();
    expect(repository.list(project.id)).toEqual([]);
    database.close();
  });

  it("rejects cross-project identity, fingerprint tampering, and appended versions", () => {
    const database = openDatabase();
    const projects = new ProjectRepository(database);
    const repository = new RepairPlanRepository(database);
    const project = projects.create("Repair persistence", undefined, "long-form");
    const other = projects.create("Other", undefined, "long-form");
    const planDefinition = definition(project.id);
    const record = { id: "repair-1", definitionFingerprint: repairFingerprint(planDefinition), definition: planDefinition, createdAt: "2026-08-12T00:00:00.000Z" };
    const created = repository.create(project.id, record);
    expect(() => repository.create(other.id, record)).toThrow("identity mismatch");
    expect(() => repository.create(project.id, { ...record, id: "repair-2", definitionFingerprint: "0".repeat(64) })).toThrow("fingerprint mismatch");
    const crossProjectDefinition = { ...planDefinition, selectedFindings: [{ projectId: other.id }] };
    expect(() => repository.create(project.id, { ...record, id: "repair-cross", definition: crossProjectDefinition, definitionFingerprint: repairFingerprint(crossProjectDefinition) })).toThrow("source project mismatch");
    database.prepare(`INSERT INTO artifact_versions
      (id, project_id, artifact_id, artifact_type, version, schema_version, content_json, stale, created_at)
      VALUES ('tampered-version', ?, 'repair-plan:repair-1', 'repair-plan', 2, 1, ?, 0, ?)`)
      .run(project.id, JSON.stringify(record), record.createdAt);
    expect(() => repository.get(project.id, record.id)).toThrow("immutable");
    expect(() => repository.list(project.id)).toThrow("immutable");
    expect(repository.getVersion(project.id, created.id)?.content).toEqual(record);
    database.close();
  });
});
