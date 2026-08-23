import { describe, expect, it } from "vitest";
import { ArtifactRepository, openDatabase, PortableProjectRepository, ProjectRepository } from "../src/index.js";

describe("PortableProjectRepository", () => {
  it("round-trips immutable authoring history and rejects collisions", () => {
    const source = openDatabase(); const target = openDatabase();
    try {
      new ProjectRepository(source).create("Portable tale", "portable-project", "long-form");
      const artifacts = new ArtifactRepository(source);
      artifacts.saveArtifact({ projectId: "portable-project", artifactId: "brief", artifactType: "brief", schemaVersion: 1, content: { title: "v1" } });
      artifacts.saveArtifact({ projectId: "portable-project", artifactId: "brief", artifactType: "brief", schemaVersion: 1, content: { title: "v2" } });
      const exported = new PortableProjectRepository(source).exportRows("portable-project");
      const repository = new PortableProjectRepository(target); repository.importRows(exported);
      expect(repository.exportRows("portable-project")).toEqual(exported);
      expect(() => repository.importRows(exported)).toThrow(/portable_project_conflict/);
    } finally { source.close(); target.close(); }
  });

  it("rolls back every row when imported lineage is invalid", () => {
    const source = openDatabase(); const target = openDatabase();
    try {
      new ProjectRepository(source).create("Portable tale", "portable-project", "long-form");
      const rows = new PortableProjectRepository(source).exportRows("portable-project");
      rows.tables.artifact_dependencies.push({ project_id: "another-project", upstream_artifact_id: "brief", dependent_artifact_id: "bible" });
      expect(() => new PortableProjectRepository(target).importRows(rows)).toThrow(/lineage_invalid/);
      expect(new ProjectRepository(target).get("portable-project")).toBeUndefined();
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
      new PortableProjectRepository(target).importRows(exported);
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
      new PortableProjectRepository(target).importRows(exported);
      expect(new PortableProjectRepository(target).exportRows("generated-project")).toEqual(exported);
      expect(exported.tables.passage_draft_generation_provenance).toHaveLength(1);
    } finally { source.close(); target.close(); }
  });
});
