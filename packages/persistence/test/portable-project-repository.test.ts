import { describe, expect, it } from "vitest";
import { ArtifactRepository, openDatabase, PortableProjectRepository, ProjectRepository } from "../src/index.js";

describe("PortableProjectRepository", () => {
  const acceptDomainFixture = () => undefined;
  it("round-trips immutable authoring history and rejects collisions", () => {
    const source = openDatabase(); const target = openDatabase();
    try {
      new ProjectRepository(source).create("Portable tale", "portable-project", "long-form");
      const artifacts = new ArtifactRepository(source);
      artifacts.saveArtifact({ projectId: "portable-project", artifactId: "brief", artifactType: "brief", schemaVersion: 1, content: { title: "v1" } });
      artifacts.saveArtifact({ projectId: "portable-project", artifactId: "brief", artifactType: "brief", schemaVersion: 1, content: { title: "v2" } });
      const exported = new PortableProjectRepository(source).exportRows("portable-project");
      const repository = new PortableProjectRepository(target); repository.importRows(exported, acceptDomainFixture);
      expect(repository.exportRows("portable-project")).toEqual(exported);
      expect(() => repository.importRows(exported, acceptDomainFixture)).toThrow(/portable_project_conflict/);
    } finally { source.close(); target.close(); }
  });

  it("rolls back every row when imported lineage is invalid", () => {
    const source = openDatabase(); const target = openDatabase();
    try {
      new ProjectRepository(source).create("Portable tale", "portable-project", "long-form");
      const rows = new PortableProjectRepository(source).exportRows("portable-project");
      rows.tables.artifact_dependencies.push({ project_id: "another-project", upstream_artifact_id: "brief", dependent_artifact_id: "bible" });
      expect(() => new PortableProjectRepository(target).importRows(rows, acceptDomainFixture)).toThrow(/lineage_invalid/);
      expect(new ProjectRepository(target).get("portable-project")).toBeUndefined();
    } finally { source.close(); target.close(); }
  });

  it("rejects exact entity-head lineage mismatches that ordinary foreign keys permit", () => {
    const source = openDatabase(); const target = openDatabase();
    try {
      new ProjectRepository(source).create("Hostile", "hostile", "long-form");
      source.prepare(`INSERT INTO passage_entity_versions
        (id, project_id, entity_kind, entity_id, version, content_json, created_at)
        VALUES ('passage-a-v1', 'hostile', 'passage', 'passage-a', 1, '{"id":"passage-a"}', '2026-08-24T00:00:00.000Z')`).run();
      source.prepare(`INSERT INTO passage_entity_heads
        (project_id, entity_kind, entity_id, version_id, tombstoned)
        VALUES ('hostile', 'passage', 'passage-b', 'passage-a-v1', 0)`).run();
      const rows = new PortableProjectRepository(source).exportRows("hostile");
      expect(() => new PortableProjectRepository(target).importRows(rows, acceptDomainFixture)).toThrow(/entity head/);
      expect(new ProjectRepository(target).get("hostile")).toBeUndefined();
    } finally { source.close(); target.close(); }
  });

  it("rejects cross-project head and workflow references without touching the existing project", () => {
    const source = openDatabase(); const target = openDatabase();
    try {
      new ProjectRepository(source).create("Imported", "imported", "long-form");
      new ProjectRepository(target).create("Existing", "existing", "long-form");
      target.prepare(`INSERT INTO passage_entity_versions
        (id, project_id, entity_kind, entity_id, version, content_json, created_at)
        VALUES ('existing-passage-v1', 'existing', 'passage', 'passage-x', 1, '{"id":"passage-x"}', '2026-08-24T00:00:00.000Z')`).run();
      target.prepare(`INSERT INTO artifact_versions
        (id, project_id, artifact_id, artifact_type, version, schema_version, content_json, stale, created_at)
        VALUES ('existing-brief-v1', 'existing', 'brief', 'brief', 1, 1, '{}', 0, '2026-08-24T00:00:00.000Z')`).run();
      const rows = new PortableProjectRepository(source).exportRows("imported");
      rows.tables.passage_entity_heads.push({ project_id: "imported", entity_kind: "passage", entity_id: "passage-x", version_id: "existing-passage-v1", tombstoned: 0 });
      rows.tables.artifact_workflow_state.push({ project_id: "imported", artifact_id: "brief", status: "approved", approved_version_id: "existing-brief-v1", updated_at: "2026-08-24T00:00:00.000Z" });
      expect(() => new PortableProjectRepository(target).importRows(rows, acceptDomainFixture)).toThrow(/lineage_invalid/);
      expect(new ProjectRepository(target).get("imported")).toBeUndefined();
      expect(new ProjectRepository(target).get("existing")?.name).toBe("Existing");
    } finally { source.close(); target.close(); }
  });

  it("rejects snapshot items whose declared identity differs from their immutable version", () => {
    const source = openDatabase(); const target = openDatabase(); const at = "2026-08-24T00:00:00.000Z";
    try {
      new ProjectRepository(source).create("Snapshot", "snapshot-project", "long-form");
      source.prepare("INSERT INTO passage_structure_versions (id, project_id, version, content_json, created_at) VALUES ('structure-v1', 'snapshot-project', 1, '{}', ?)").run(at);
      source.prepare(`INSERT INTO passage_entity_versions
        (id, project_id, entity_kind, entity_id, version, content_json, created_at)
        VALUES ('passage-a-v1', 'snapshot-project', 'passage', 'passage-a', 1, '{"id":"passage-a"}', ?)`)
        .run(at);
      source.prepare(`INSERT INTO passage_plan_snapshots
        (id, project_id, version, structure_version_id, upstream_versions_json, validation_json, status, created_at)
        VALUES ('snapshot-v1', 'snapshot-project', 1, 'structure-v1', '{}', '[]', 'draft', ?)`)
        .run(at);
      source.prepare(`INSERT INTO passage_plan_snapshot_items (snapshot_id, entity_kind, entity_id, version_id)
        VALUES ('snapshot-v1', 'passage', 'passage-b', 'passage-a-v1')`).run();
      const rows = new PortableProjectRepository(source).exportRows("snapshot-project");
      expect(() => new PortableProjectRepository(target).importRows(rows, acceptDomainFixture)).toThrow(/snapshot item/);
      expect(new ProjectRepository(target).get("snapshot-project")).toBeUndefined();
    } finally { source.close(); target.close(); }
  });

  it("round-trips a representative 300-passage immutable graph", () => {
    const source = openDatabase(); const target = openDatabase();
    try {
      new ProjectRepository(source).create("Large archive", "large-project", "long-form");
      source.prepare("INSERT INTO passage_structure_versions (id, project_id, version, content_json, created_at) VALUES (?, ?, 1, ?, ?)")
        .run("structure-v1", "large-project", JSON.stringify({ acts: [] }), "2026-08-24T00:00:00.000Z");
      source.prepare("INSERT INTO passage_structure_heads (project_id, version_id) VALUES (?, ?)").run("large-project", "structure-v1");
      source.prepare("INSERT INTO passage_plan_snapshots (id, project_id, version, structure_version_id, upstream_versions_json, validation_json, status, created_at) VALUES (?, ?, 1, ?, '{}', '[]', 'approved', ?)")
        .run("snapshot-v1", "large-project", "structure-v1", "2026-08-24T00:00:00.000Z");
      for (let index = 0; index < 300; index++) {
        const id = `passage-${index}`, version = `passage-version-${index}`;
        source.prepare("INSERT INTO passage_entity_versions (id, project_id, entity_kind, entity_id, version, content_json, created_at) VALUES (?, ?, 'passage', ?, 1, ?, ?)")
          .run(version, "large-project", id, JSON.stringify({ id, title: `Passage ${index}` }), "2026-08-24T00:00:00.000Z");
        source.prepare("INSERT INTO passage_entity_heads (project_id, entity_kind, entity_id, version_id, tombstoned) VALUES (?, 'passage', ?, ?, 0)")
          .run("large-project", id, version);
        source.prepare("INSERT INTO passage_plan_snapshot_items (snapshot_id, entity_kind, entity_id, version_id) VALUES (?, 'passage', ?, ?)")
          .run("snapshot-v1", id, version);
      }
      source.prepare("INSERT INTO passage_plan_state (project_id, status, approved_snapshot_id, updated_at) VALUES (?, 'approved', ?, ?)")
        .run("large-project", "snapshot-v1", "2026-08-24T00:00:00.000Z");
      const exported = new PortableProjectRepository(source).exportRows("large-project");
      new PortableProjectRepository(target).importRows(exported, acceptDomainFixture);
      expect(new PortableProjectRepository(target).exportRows("large-project")).toEqual(exported);
      expect(exported.tables.passage_entity_versions).toHaveLength(300);
    } finally { source.close(); target.close(); }
  });

  it("round-trips completed generated-draft provenance through its required running insertion state", () => {
    const source = openDatabase(); const target = openDatabase(); const at = "2026-08-24T00:00:00.000Z";
    try {
      new ProjectRepository(source).create("Generated archive", "generated-project", "long-form");
      source.prepare("INSERT INTO passage_structure_versions (id, project_id, version, content_json, created_at) VALUES ('structure-v1', ?, 1, '{}', ?)").run("generated-project", at);
      source.prepare("INSERT INTO passage_entity_versions (id, project_id, entity_kind, entity_id, version, content_json, created_at) VALUES ('passage-v1', ?, 'passage', 'passage-1', 1, ?, ?)").run("generated-project", JSON.stringify({ id: "passage-1" }), at);
      source.prepare("INSERT INTO passage_plan_snapshots (id, project_id, version, structure_version_id, upstream_versions_json, validation_json, status, created_at) VALUES ('snapshot-v1', ?, 1, 'structure-v1', '{}', '[]', 'approved', ?)").run("generated-project", at);
      source.prepare("INSERT INTO passage_plan_snapshot_items (snapshot_id, entity_kind, entity_id, version_id) VALUES ('snapshot-v1', 'passage', 'passage-1', 'passage-v1')").run();
      source.prepare("INSERT INTO drafting_plans (id, project_id, fingerprint, passage_snapshot_id, structure_version_id, upstream_versions_json, scope_json, provider_id, model_id, estimated_input_tokens, estimated_output_tokens, cost_estimate_json, execution_policy_id, execution_policy_json, authorization_state, authorization_fingerprint, authorized_at, created_at) VALUES ('plan-1', ?, 'plan-fp', 'snapshot-v1', 'structure-v1', '{}', '{}', 'offline', 'fixture', 10, 10, '{}', 'policy-v1', '{}', 'authorized', 'auth-fp', ?, ?)").run("generated-project", at, at);
      source.prepare("INSERT INTO drafting_plan_units (plan_id, project_id, unit_id, position, input_fingerprint, estimated_input_tokens, estimated_output_tokens, context_diagnostics_json, created_at, context_json, context_fingerprint) VALUES ('plan-1', ?, 'unit-1', 0, 'input-fp', 10, 10, '{}', ?, ?, 'context-fp')").run("generated-project", at, JSON.stringify({ selectedPassages: [{ passageId: "passage-1" }] }));
      source.prepare("INSERT INTO drafting_plan_unit_passages (plan_id, project_id, unit_id, position, passage_id, passage_plan_version_id) VALUES ('plan-1', ?, 'unit-1', 0, 'passage-1', 'passage-v1')").run("generated-project");
      source.prepare("INSERT INTO drafting_jobs (id, project_id, plan_id, plan_fingerprint, status, execution_policy_id, created_at, authorized_at, started_at, updated_at) VALUES ('job-1', ?, 'plan-1', 'plan-fp', 'running', 'policy-v1', ?, ?, ?, ?)").run("generated-project", at, at, at, at);
      source.prepare("INSERT INTO drafting_job_units (job_id, project_id, plan_id, unit_id, status, attempt_number, input_fingerprint, execution_policy_id, created_at, started_at, updated_at) VALUES ('job-1', ?, 'plan-1', 'unit-1', 'running', 1, 'input-fp', 'policy-v1', ?, ?, ?)").run("generated-project", at, at, at);
      source.prepare("INSERT INTO drafting_unit_attempts (id, project_id, job_id, unit_id, attempt_number, status, input_fingerprint, execution_policy_id, created_at, started_at, updated_at) VALUES ('attempt-1', ?, 'job-1', 'unit-1', 1, 'running', 'input-fp', 'policy-v1', ?, ?, ?)").run("generated-project", at, at, at);
      source.prepare("INSERT INTO drafting_unit_outputs (id, project_id, plan_id, job_id, unit_id, attempt_id, input_fingerprint, context_fingerprint, provider_id, model_id, execution_policy_id, output_schema_id, output_schema_version, content_json, validation_json, repair_json, created_at) VALUES ('output-1', ?, 'plan-1', 'job-1', 'unit-1', 'attempt-1', 'input-fp', 'context-fp', 'offline', 'fixture', 'policy-v1', 'draft-output', 1, '{}', '[]', '{}', ?)").run("generated-project", at);
      source.prepare("INSERT INTO passage_draft_versions (id, project_id, passage_id, version, based_on_passage_plan_version_id, prose_markdown, word_count, lifecycle_status, source_kind, generation_plan_id, generation_job_id, generation_unit_id, created_at) VALUES ('draft-v1', ?, 'passage-1', 1, 'passage-v1', 'Generated prose.', 2, 'candidate', 'generated', 'plan-1', 'job-1', 'unit-1', ?)").run("generated-project", at);
      source.prepare("INSERT INTO passage_draft_generation_provenance (draft_version_id, project_id, output_id, plan_id, job_id, unit_id, attempt_id, passage_id, passage_plan_version_id, context_fingerprint, created_at) VALUES ('draft-v1', ?, 'output-1', 'plan-1', 'job-1', 'unit-1', 'attempt-1', 'passage-1', 'passage-v1', 'context-fp', ?)").run("generated-project", at);
      source.prepare("UPDATE drafting_unit_attempts SET status = 'completed', finished_at = ? WHERE id = 'attempt-1'").run(at);
      source.prepare("UPDATE drafting_job_units SET status = 'completed', finished_at = ? WHERE job_id = 'job-1'").run(at);
      source.prepare("UPDATE drafting_jobs SET status = 'completed', finished_at = ? WHERE id = 'job-1'").run(at);
      const exported = new PortableProjectRepository(source).exportRows("generated-project");
      new PortableProjectRepository(target).importRows(exported, acceptDomainFixture);
      expect(new PortableProjectRepository(target).exportRows("generated-project")).toEqual(exported);
      expect(exported.tables.passage_draft_generation_provenance).toHaveLength(1);
    } finally { source.close(); target.close(); }
  });
});
