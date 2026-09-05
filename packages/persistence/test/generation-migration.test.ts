import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  ArtifactRepository,
  AuthorMemoryRepository,
  ConversationRepository,
  CURRENT_SCHEMA_VERSION,
  DatabaseRecoveryError,
  ProjectRepository,
  migrate,
  openDatabase,
  passageDraftArchitectureMigrationSql,
  runDatabaseIntegrityCheck,
} from "../src/index.js";

const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const v4FixturePath = join(fixtureDirectory, "schema-v4.sqlite");
const v5FixturePath = join(fixtureDirectory, "schema-v5.sqlite");
const v6FixturePath = join(fixtureDirectory, "schema-v6.sqlite");
const v7FixturePath = join(fixtureDirectory, "schema-v7.sqlite");
const v8FixturePath = join(fixtureDirectory, "schema-v8.sqlite");
const v9FixturePath = join(fixtureDirectory, "schema-v9.sqlite");
const v10FixturePath = join(fixtureDirectory, "schema-v10.sqlite");
const v11FixturePath = join(fixtureDirectory, "schema-v11.sqlite");
const v12FixturePath = join(fixtureDirectory, "schema-v12.sqlite");
const v13FixturePath = join(fixtureDirectory, "schema-v13.sqlite");
const v14FixturePath = join(fixtureDirectory, "schema-v14.sqlite");
const v15FixturePath = join(fixtureDirectory, "schema-v15.sqlite");
const v16FixturePath = join(fixtureDirectory, "schema-v16.sqlite");
const supportedFixtures = [
  v4FixturePath, v5FixturePath, v6FixturePath, v7FixturePath, v8FixturePath, v9FixturePath,
  v10FixturePath, v11FixturePath, v12FixturePath, v13FixturePath, v14FixturePath, v15FixturePath, v16FixturePath,
];
const temporaryDirectories: string[] = [];
afterEach(() => temporaryDirectories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

function logicalDatabaseState(database: DatabaseSync): string {
  const schema = database.prepare(`SELECT type, name, tbl_name, sql FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`).all();
  const tables = (database.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'
    AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as Array<{ name: string }>).map(({ name }) => ({
      name,
      rows: database.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`).all(),
    }));
  return JSON.stringify({ schema, tables });
}

describe("generation kernel migration", () => {
  it.each(supportedFixtures.map((path, index) => ({ sourceVersion: index + 4, path })))(
    "migrates frozen schema v$sourceVersion through normal open, quick_check, and domain reads without touching the fixture",
    ({ sourceVersion, path }) => {
      const originalHash = digest(path);
      const directory = mkdtempSync(join(tmpdir(), `cyoa-v${sourceVersion}-compatibility-`));
      temporaryDirectories.push(directory);
      const copyPath = join(directory, `schema-v${sourceVersion}.sqlite`);
      copyFileSync(path, copyPath);

      const database = openDatabase(copyPath);
      expect((database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version)
        .toBe(CURRENT_SCHEMA_VERSION);
      expect(runDatabaseIntegrityCheck(database)).toMatchObject({ ok: true, method: "quick_check", results: ["ok"] });
      expect(new ProjectRepository(database).list({ includeArchived: true }).length).toBeGreaterThan(0);
      database.close();

      expect(digest(path)).toBe(originalHash);
      const stillFrozen = new DatabaseSync(path, { readOnly: true });
      expect((stillFrozen.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version)
        .toBe(sourceVersion);
      stillFrozen.close();
    },
  );

  it("migrates a temporary v4 copy while preserving the frozen fixture and canonical records", () => {
    const originalHash = digest(v4FixturePath);
    const frozen = new DatabaseSync(v4FixturePath, { readOnly: true });
    expect((frozen.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(4);
    expect(() => frozen.prepare("SELECT * FROM generation_plans").all()).toThrow();
    frozen.close();

    const directory = mkdtempSync(join(tmpdir(), "cyoa-v4-migration-"));
    temporaryDirectories.push(directory);
    const copyPath = join(directory, "schema-v4.sqlite");
    copyFileSync(v4FixturePath, copyPath);
    const database = openDatabase(copyPath);

    expect((database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(CURRENT_SCHEMA_VERSION);
    expect((database.prepare("SELECT COUNT(*) AS count FROM generation_plans").get() as { count: number }).count).toBe(0);
    expect(database.prepare("SELECT name, mode FROM projects WHERE id = 'fixture-project'").get()).toEqual({
      name: "Frozen v4 project", mode: "long-form",
    });
    expect((database.prepare("SELECT COUNT(*) AS count FROM artifact_versions WHERE project_id = 'fixture-project'").get() as { count: number }).count).toBe(2);
    expect(database.prepare("SELECT status, approved_version_id FROM artifact_workflow_state WHERE project_id = 'fixture-project'").get()).toEqual({
      status: "approved", approved_version_id: "brief-v2",
    });
    expect(database.prepare("SELECT status, approved_snapshot_id FROM passage_plan_state WHERE project_id = 'fixture-project'").get()).toEqual({
      status: "approved", approved_snapshot_id: "snapshot-v1",
    });
    expect(database.prepare("SELECT rationale FROM passage_finding_overrides WHERE project_id = 'fixture-project'").get()).toEqual({
      rationale: "Reviewed before migration",
    });
    database.close();

    expect(digest(v4FixturePath)).toBe(originalHash);
    const stillFrozen = new DatabaseSync(v4FixturePath, { readOnly: true });
    expect((stillFrozen.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(4);
    stillFrozen.close();
  });

  it("migrates a frozen v5 generation kernel without changing or losing its records", () => {
    const originalHash = digest(v5FixturePath);
    const frozen = new DatabaseSync(v5FixturePath, { readOnly: true });
    expect((frozen.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(5);
    expect((frozen.prepare("SELECT COUNT(*) AS count FROM generation_jobs").get() as { count: number }).count).toBe(1);
    expect(frozen.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'generation_job_units_lineage_insert'").get()).toBeUndefined();
    frozen.close();

    const directory = mkdtempSync(join(tmpdir(), "cyoa-v5-migration-"));
    temporaryDirectories.push(directory);
    const copyPath = join(directory, "schema-v5.sqlite");
    copyFileSync(v5FixturePath, copyPath);
    const database = openDatabase(copyPath);

    expect((database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(CURRENT_SCHEMA_VERSION);
    expect(database.prepare("SELECT name FROM projects WHERE id = 'fixture-project-v5'").get()).toEqual({
      name: "Frozen v5 project",
    });
    expect(database.prepare("SELECT status FROM passage_plan_state WHERE project_id = 'fixture-project-v5'").get()).toEqual({
      status: "approved",
    });
    expect((database.prepare("SELECT COUNT(*) AS count FROM passage_plan_snapshots WHERE project_id = 'fixture-project-v5' AND status = 'approved'").get() as { count: number }).count).toBe(1);
    expect((database.prepare("SELECT COUNT(*) AS count FROM generation_plans WHERE project_id = 'fixture-project-v5'").get() as { count: number }).count).toBe(1);
    expect((database.prepare("SELECT COUNT(*) AS count FROM generation_plan_units WHERE project_id = 'fixture-project-v5'").get() as { count: number }).count).toBe(2);
    expect(database.prepare("SELECT status FROM generation_jobs WHERE project_id = 'fixture-project-v5'").get()).toEqual({
      status: "partially_failed",
    });
    expect((database.prepare("SELECT COUNT(*) AS count FROM generation_job_units WHERE project_id = 'fixture-project-v5'").get() as { count: number }).count).toBe(2);
    expect((database.prepare("SELECT COUNT(*) AS count FROM generation_unit_attempts WHERE project_id = 'fixture-project-v5'").get() as { count: number }).count).toBe(2);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'generation_job_units_lineage_insert'").get()).toEqual({
      name: "generation_job_units_lineage_insert",
    });
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'generation_jobs_lineage_update'").get()).toEqual({
      name: "generation_jobs_lineage_update",
    });
    database.exec("DROP TRIGGER generation_jobs_lineage_update");
    migrate(database);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'generation_jobs_lineage_update'").get()).toEqual({
      name: "generation_jobs_lineage_update",
    });
    database.close();

    expect(digest(v5FixturePath)).toBe(originalHash);
    const stillFrozen = new DatabaseSync(v5FixturePath, { readOnly: true });
    expect((stillFrozen.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(5);
    stillFrozen.close();
  });

  it("rejects corrupted v5 lineage without recording v6 or leaving triggers", () => {
    const originalHash = digest(v5FixturePath);
    const directory = mkdtempSync(join(tmpdir(), "cyoa-v5-corrupt-migration-"));
    temporaryDirectories.push(directory);
    const copyPath = join(directory, "schema-v5-corrupt.sqlite");
    copyFileSync(v5FixturePath, copyPath);
    const database = new DatabaseSync(copyPath);
    database.exec("PRAGMA foreign_keys = OFF");
    database.prepare(`
      UPDATE generation_job_units SET plan_id = 'corrupt-plan-id'
      WHERE rowid = (SELECT MIN(rowid) FROM generation_job_units)
    `).run();

    expect(() => migrate(database)).toThrow("invalid job-unit lineage");
    expect((database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(5);
    expect(database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'trigger' AND name IN (
        'generation_job_units_lineage_insert',
        'generation_job_units_lineage_update',
        'generation_jobs_lineage_update'
      )
    `).all()).toEqual([]);
    expect((database.prepare(`
      SELECT COUNT(*) AS count FROM generation_job_units WHERE plan_id = 'corrupt-plan-id'
    `).get() as { count: number }).count).toBe(1);
    database.close();

    expect(digest(v5FixturePath)).toBe(originalHash);
  });

  it("migrates the frozen accepted schema-v6 fixture losslessly to the latest schema without changing its bytes", () => {
    const originalHash = digest(v6FixturePath);
    const frozen = new DatabaseSync(v6FixturePath, { readOnly: true });
    expect((frozen.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(6);
    const before = {
      plans: (frozen.prepare("SELECT COUNT(*) AS count FROM generation_plans").get() as { count: number }).count,
      jobs: (frozen.prepare("SELECT COUNT(*) AS count FROM generation_jobs").get() as { count: number }).count,
      units: (frozen.prepare("SELECT COUNT(*) AS count FROM generation_job_units").get() as { count: number }).count,
      attempts: (frozen.prepare("SELECT COUNT(*) AS count FROM generation_unit_attempts").get() as { count: number }).count,
    };
    frozen.close();

    const directory = mkdtempSync(join(tmpdir(), "cyoa-v6-migration-"));
    temporaryDirectories.push(directory);
    const copyPath = join(directory, "schema-v6.sqlite");
    copyFileSync(v6FixturePath, copyPath);
    const database = openDatabase(copyPath);
    expect((database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(CURRENT_SCHEMA_VERSION);
    expect({
      plans: (database.prepare("SELECT COUNT(*) AS count FROM generation_plans").get() as { count: number }).count,
      jobs: (database.prepare("SELECT COUNT(*) AS count FROM generation_jobs").get() as { count: number }).count,
      units: (database.prepare("SELECT COUNT(*) AS count FROM generation_job_units").get() as { count: number }).count,
      attempts: (database.prepare("SELECT COUNT(*) AS count FROM generation_unit_attempts").get() as { count: number }).count,
    }).toEqual(before);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'generation_unit_candidates'").get()).toEqual({ name: "generation_unit_candidates" });
    expect(database.prepare("SELECT context_json, context_fingerprint FROM generation_plan_units LIMIT 1").get()).toEqual({ context_json: "{}", context_fingerprint: "" });
    database.close();
    expect(digest(v6FixturePath)).toBe(originalHash);
  });

  it("rolls back every v7 schema change when candidate migration cannot complete", () => {
    const originalHash = digest(v6FixturePath);
    const directory = mkdtempSync(join(tmpdir(), "cyoa-v7-rollback-"));
    temporaryDirectories.push(directory);
    const copyPath = join(directory, "schema-v6-conflict.sqlite");
    copyFileSync(v6FixturePath, copyPath);
    const database = new DatabaseSync(copyPath);
    database.exec("CREATE TABLE generation_unit_candidates (conflict TEXT)");
    expect(() => migrate(database)).toThrow();
    expect((database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(6);
    expect((database.prepare("PRAGMA table_info(generation_plan_units)").all() as Array<{ name: string }>).some((item) => item.name === "context_json")).toBe(false);
    expect(database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'generation_unit_candidates'").get()).toEqual({
      sql: "CREATE TABLE generation_unit_candidates (conflict TEXT)",
    });
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'generation_unit_candidates_immutable_update'").get()).toBeUndefined();
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'generation_unit_attempts_lineage_identity'").get()).toBeUndefined();
    database.close();
    expect(digest(v6FixturePath)).toBe(originalHash);
  });

  it("migrates the frozen accepted schema-v7 fixture losslessly to the latest schema without changing its bytes", () => {
    const originalHash = digest(v7FixturePath);
    const frozen = new DatabaseSync(v7FixturePath, { readOnly: true });
    expect((frozen.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(7);
    const before = {
      unit: frozen.prepare(`
        SELECT context_json, context_diagnostics_json, context_fingerprint
        FROM generation_plan_units WHERE unit_id = 'unit-shared'
      `).get(),
      job: frozen.prepare(`
        SELECT project_id, plan_id, status FROM generation_jobs
        WHERE project_id = 'fixture-project-v7'
      `).get(),
      attempt: frozen.prepare(`
        SELECT project_id, job_id, unit_id, status FROM generation_unit_attempts
        WHERE project_id = 'fixture-project-v7'
      `).get(),
      candidate: frozen.prepare(`
        SELECT project_id, plan_id, job_id, unit_id, attempt_id, content_json
        FROM generation_unit_candidates WHERE id = 'candidate-v7'
      `).get(),
    };
    expect(frozen.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'trigger' AND name = 'generation_unit_candidates_lineage_insert'
    `).get()).toBeUndefined();
    frozen.close();

    const directory = mkdtempSync(join(tmpdir(), "cyoa-v7-migration-"));
    temporaryDirectories.push(directory);
    const copyPath = join(directory, "schema-v7.sqlite");
    copyFileSync(v7FixturePath, copyPath);
    const database = openDatabase(copyPath);

    expect((database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(CURRENT_SCHEMA_VERSION);
    expect({
      unit: database.prepare(`
        SELECT context_json, context_diagnostics_json, context_fingerprint
        FROM generation_plan_units WHERE unit_id = 'unit-shared'
      `).get(),
      job: database.prepare(`
        SELECT project_id, plan_id, status FROM generation_jobs
        WHERE project_id = 'fixture-project-v7'
      `).get(),
      attempt: database.prepare(`
        SELECT project_id, job_id, unit_id, status FROM generation_unit_attempts
        WHERE project_id = 'fixture-project-v7'
      `).get(),
      candidate: database.prepare(`
        SELECT project_id, plan_id, job_id, unit_id, attempt_id, content_json
        FROM generation_unit_candidates WHERE id = 'candidate-v7'
      `).get(),
    }).toEqual(before);
    expect(database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'trigger' AND name = 'generation_unit_candidates_lineage_insert'
    `).get()).toEqual({ name: "generation_unit_candidates_lineage_insert" });
    database.close();

    expect(digest(v7FixturePath)).toBe(originalHash);
  });

  it("rejects corrupted v7 candidate lineage transactionally without installing v8", () => {
    const originalHash = digest(v7FixturePath);
    const directory = mkdtempSync(join(tmpdir(), "cyoa-v7-corrupt-migration-"));
    temporaryDirectories.push(directory);
    const copyPath = join(directory, "schema-v7-corrupt.sqlite");
    copyFileSync(v7FixturePath, copyPath);
    const database = new DatabaseSync(copyPath);
    database.exec("PRAGMA foreign_keys = OFF");
    database.exec("DROP TRIGGER generation_unit_candidates_immutable_update");
    database.prepare(`
      UPDATE generation_unit_candidates SET plan_id = 'corrupt-plan-id'
      WHERE id = 'candidate-v7'
    `).run();

    expect(() => migrate(database)).toThrow("invalid candidate lineage");
    expect((database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(7);
    expect(database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'trigger' AND name = 'generation_unit_candidates_lineage_insert'
    `).get()).toBeUndefined();
    expect(database.prepare(`
      SELECT plan_id FROM generation_unit_candidates WHERE id = 'candidate-v7'
    `).get()).toEqual({ plan_id: "corrupt-plan-id" });
    expect((database.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 8").get() as { count: number }).count).toBe(0);
    database.close();

    expect(digest(v7FixturePath)).toBe(originalHash);
  });

  it("migrates the frozen accepted schema-v8 fixture losslessly to v9 without changing its bytes", () => {
    const originalHash = digest(v8FixturePath);
    const frozen = new DatabaseSync(v8FixturePath, { readOnly: true });
    expect((frozen.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(8);
    const before = {
      project: frozen.prepare("SELECT id, name, mode FROM projects WHERE id = 'fixture-project-v7'").get(),
      snapshot: frozen.prepare("SELECT id, status, structure_version_id FROM passage_plan_snapshots LIMIT 1").get(),
      context: frozen.prepare("SELECT context_json, context_diagnostics_json, context_fingerprint FROM generation_plan_units LIMIT 1").get(),
      job: frozen.prepare("SELECT id, plan_id, status FROM generation_jobs LIMIT 1").get(),
      attempt: frozen.prepare("SELECT id, job_id, unit_id, status FROM generation_unit_attempts LIMIT 1").get(),
      candidate: frozen.prepare("SELECT id, plan_id, job_id, unit_id, attempt_id, content_json FROM generation_unit_candidates LIMIT 1").get(),
    };
    expect(frozen.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'passage_proposal_sets'").get()).toBeUndefined();
    frozen.close();

    const directory = mkdtempSync(join(tmpdir(), "cyoa-v8-migration-"));
    temporaryDirectories.push(directory);
    const copyPath = join(directory, "schema-v8.sqlite");
    copyFileSync(v8FixturePath, copyPath);
    const database = openDatabase(copyPath);
    expect((database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(CURRENT_SCHEMA_VERSION);
    expect({
      project: database.prepare("SELECT id, name, mode FROM projects WHERE id = 'fixture-project-v7'").get(),
      snapshot: database.prepare("SELECT id, status, structure_version_id FROM passage_plan_snapshots LIMIT 1").get(),
      context: database.prepare("SELECT context_json, context_diagnostics_json, context_fingerprint FROM generation_plan_units LIMIT 1").get(),
      job: database.prepare("SELECT id, plan_id, status FROM generation_jobs LIMIT 1").get(),
      attempt: database.prepare("SELECT id, job_id, unit_id, status FROM generation_unit_attempts LIMIT 1").get(),
      candidate: database.prepare("SELECT id, plan_id, job_id, unit_id, attempt_id, content_json FROM generation_unit_candidates LIMIT 1").get(),
    }).toEqual(before);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'passage_proposal_sets'").get())
      .toEqual({ name: "passage_proposal_sets" });
    database.close();
    expect(digest(v8FixturePath)).toBe(originalHash);
  });

  it("rejects corrupt accepted-v8 candidate lineage without partially installing v9", () => {
    const originalHash = digest(v8FixturePath);
    const directory = mkdtempSync(join(tmpdir(), "cyoa-v8-corrupt-migration-"));
    temporaryDirectories.push(directory);
    const copyPath = join(directory, "schema-v8-corrupt.sqlite");
    copyFileSync(v8FixturePath, copyPath);
    const database = new DatabaseSync(copyPath);
    database.exec("PRAGMA foreign_keys = OFF");
    database.exec("DROP TRIGGER generation_unit_candidates_immutable_update");
    database.prepare("UPDATE generation_unit_candidates SET plan_id = 'corrupt-plan-id' WHERE id = 'candidate-v7'").run();

    expect(() => migrate(database)).toThrow("invalid candidate lineage");
    expect((database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(8);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'passage_proposal_sets'").get()).toBeUndefined();
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'passage_proposal_sets_lineage_insert'").get()).toBeUndefined();
    database.close();
    expect(digest(v8FixturePath)).toBe(originalHash);
  });

  it("rolls back every v9 schema object when proposal migration cannot complete", () => {
    const originalHash = digest(v8FixturePath);
    const directory = mkdtempSync(join(tmpdir(), "cyoa-v9-rollback-"));
    temporaryDirectories.push(directory);
    const copyPath = join(directory, "schema-v8-conflict.sqlite");
    copyFileSync(v8FixturePath, copyPath);
    const database = new DatabaseSync(copyPath);
    database.exec("CREATE TABLE passage_proposal_sets (conflict TEXT)");
    expect(() => migrate(database)).toThrow();
    expect((database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(8);
    expect(database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'passage_proposal_sets'").get())
      .toEqual({ sql: "CREATE TABLE passage_proposal_sets (conflict TEXT)" });
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'passage_proposal_groups'").get()).toBeUndefined();
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'passage_proposal_sets_lineage_insert'").get()).toBeUndefined();
    database.close();
    expect(digest(v8FixturePath)).toBe(originalHash);
  });

  it("migrates the frozen representative schema-v9 fixture losslessly to the latest schema without changing its bytes", () => {
    const originalHash = digest(v9FixturePath);
    const frozen = new DatabaseSync(v9FixturePath, { readOnly: true });
    expect((frozen.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(9);
    const before = {
      project: frozen.prepare("SELECT id, name, mode FROM projects WHERE id = 'fixture-project-v7'").get(),
      snapshot: frozen.prepare("SELECT id, status, structure_version_id FROM passage_plan_snapshots LIMIT 1").get(),
      generationPlan: frozen.prepare("SELECT id, fingerprint, authorization_state FROM generation_plans LIMIT 1").get(),
      candidate: frozen.prepare("SELECT id, plan_id, job_id, unit_id, attempt_id FROM generation_unit_candidates LIMIT 1").get(),
      proposal: frozen.prepare("SELECT id, generation_plan_id, generation_job_id, status FROM passage_proposal_sets WHERE id = 'proposal-v9'").get(),
      group: frozen.prepare("SELECT proposal_id, id, generation_unit_id, status FROM passage_proposal_groups WHERE id = 'group-v9'").get(),
      operation: frozen.prepare("SELECT proposal_id, id, entity_kind, entity_id, base_version_id FROM passage_proposal_operations WHERE id = 'operation-v9'").get(),
      preview: frozen.prepare("SELECT id, proposal_id, preview_fingerprint, valid FROM passage_proposal_previews WHERE id = 'preview-v9'").get(),
      application: frozen.prepare("SELECT id, proposal_id, validation_preview_fingerprint FROM passage_proposal_applications WHERE id = 'application-v9'").get(),
    };
    expect(frozen.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'passage_draft_versions'").get()).toBeUndefined();
    frozen.close();

    const directory = mkdtempSync(join(tmpdir(), "cyoa-v9-migration-"));
    temporaryDirectories.push(directory);
    const copyPath = join(directory, "schema-v9.sqlite");
    copyFileSync(v9FixturePath, copyPath);
    const database = openDatabase(copyPath);

    expect((database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(CURRENT_SCHEMA_VERSION);
    expect({
      project: database.prepare("SELECT id, name, mode FROM projects WHERE id = 'fixture-project-v7'").get(),
      snapshot: database.prepare("SELECT id, status, structure_version_id FROM passage_plan_snapshots LIMIT 1").get(),
      generationPlan: database.prepare("SELECT id, fingerprint, authorization_state FROM generation_plans LIMIT 1").get(),
      candidate: database.prepare("SELECT id, plan_id, job_id, unit_id, attempt_id FROM generation_unit_candidates LIMIT 1").get(),
      proposal: database.prepare("SELECT id, generation_plan_id, generation_job_id, status FROM passage_proposal_sets WHERE id = 'proposal-v9'").get(),
      group: database.prepare("SELECT proposal_id, id, generation_unit_id, status FROM passage_proposal_groups WHERE id = 'group-v9'").get(),
      operation: database.prepare("SELECT proposal_id, id, entity_kind, entity_id, base_version_id FROM passage_proposal_operations WHERE id = 'operation-v9'").get(),
      preview: database.prepare("SELECT id, proposal_id, preview_fingerprint, valid FROM passage_proposal_previews WHERE id = 'preview-v9'").get(),
      application: database.prepare("SELECT id, proposal_id, validation_preview_fingerprint FROM passage_proposal_applications WHERE id = 'application-v9'").get(),
    }).toEqual(before);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'passage_draft_versions'").get())
      .toEqual({ name: "passage_draft_versions" });
    expect((database.prepare("SELECT COUNT(*) AS count FROM passage_draft_versions").get() as { count: number }).count).toBe(0);
    database.close();

    expect(digest(v9FixturePath)).toBe(originalHash);
    const stillFrozen = new DatabaseSync(v9FixturePath, { readOnly: true });
    expect((stillFrozen.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(9);
    stillFrozen.close();
  });

  it("rejects pre-existing corrupt draft lineage transactionally without recording v10 or repairing partial schema", () => {
    const originalHash = digest(v9FixturePath);
    const directory = mkdtempSync(join(tmpdir(), "cyoa-v9-corrupt-draft-migration-"));
    temporaryDirectories.push(directory);
    const copyPath = join(directory, "schema-v9-corrupt.sqlite");
    copyFileSync(v9FixturePath, copyPath);
    const database = new DatabaseSync(copyPath);
    database.exec("PRAGMA foreign_keys = ON");
    database.exec(passageDraftArchitectureMigrationSql);
    database.prepare(`INSERT INTO passage_draft_versions (
      id, project_id, passage_id, version, based_on_passage_plan_version_id,
      prose_markdown, word_count, lifecycle_status, source_kind, author_note, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      "corrupt-draft-v1", "fixture-project-v7", "passage-shared", 1,
      "ab320a80-ed8e-43db-9aad-d277692944ac", "Fixture prose", 2,
      "candidate", "manual", "", "2026-08-10T00:00:00.000Z",
    );
    database.prepare(`INSERT INTO passage_draft_heads (
      project_id, passage_id, current_version_id, accepted_version_id, accepted_locked, updated_at
    ) VALUES (?, ?, ?, NULL, 0, ?)`).run(
      "fixture-project-v7", "passage-shared", "corrupt-draft-v1", "2026-08-10T00:00:00.000Z",
    );
    database.exec("DROP TRIGGER passage_draft_versions_immutable_update");
    database.exec("PRAGMA foreign_keys = OFF");
    database.prepare("UPDATE passage_draft_versions SET based_on_passage_plan_version_id = 'missing-version' WHERE id = 'corrupt-draft-v1'").run();

    expect(() => migrate(database)).toThrow("invalid passage-version lineage");
    expect((database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(9);
    expect(database.prepare("SELECT based_on_passage_plan_version_id FROM passage_draft_versions WHERE id = 'corrupt-draft-v1'").get())
      .toEqual({ based_on_passage_plan_version_id: "missing-version" });
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'passage_draft_versions_immutable_update'").get())
      .toBeUndefined();
    expect((database.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 10").get() as { count: number }).count).toBe(0);
    database.close();
    expect(digest(v9FixturePath)).toBe(originalHash);
  });

  it("rolls back every v10 schema object when the draft migration cannot complete", () => {
    const originalHash = digest(v9FixturePath);
    const directory = mkdtempSync(join(tmpdir(), "cyoa-v10-rollback-"));
    temporaryDirectories.push(directory);
    const copyPath = join(directory, "schema-v9-conflict.sqlite");
    copyFileSync(v9FixturePath, copyPath);
    const database = new DatabaseSync(copyPath);
    database.exec("CREATE TABLE passage_draft_versions (conflict TEXT)");
    expect(() => migrate(database)).toThrow();
    expect((database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(9);
    expect(database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'passage_draft_versions'").get())
      .toEqual({ sql: "CREATE TABLE passage_draft_versions (conflict TEXT)" });
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'drafting_plans'").get()).toBeUndefined();
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'passage_draft_versions_base_lineage_insert'").get()).toBeUndefined();
    database.close();
    expect(digest(v9FixturePath)).toBe(originalHash);
  });

  it("migrates only a temporary copy of the frozen representative schema-v10 fixture", () => {
    const originalHash = digest(v10FixturePath);
    const frozen = new DatabaseSync(v10FixturePath, { readOnly: true });
    expect((frozen.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version)
      .toBe(10);
    const before = {
      drafts: (frozen.prepare("SELECT COUNT(*) AS count FROM passage_draft_versions").get() as { count: number }).count,
      plans: (frozen.prepare("SELECT COUNT(*) AS count FROM drafting_plans").get() as { count: number }).count,
      units: (frozen.prepare("SELECT COUNT(*) AS count FROM drafting_plan_unit_passages").get() as { count: number }).count,
      generated: frozen.prepare(`SELECT passage_id, based_on_passage_plan_version_id,
        generation_plan_id, generation_job_id, generation_unit_id
        FROM passage_draft_versions WHERE source_kind = 'generated'`).get(),
    };
    frozen.close();

    const directory = mkdtempSync(join(tmpdir(), "cyoa-v10-migration-"));
    temporaryDirectories.push(directory);
    const copyPath = join(directory, "schema-v10.sqlite");
    copyFileSync(v10FixturePath, copyPath);
    const database = openDatabase(copyPath);
    expect((database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version)
      .toBe(CURRENT_SCHEMA_VERSION);
    expect({
      drafts: (database.prepare("SELECT COUNT(*) AS count FROM passage_draft_versions").get() as { count: number }).count,
      plans: (database.prepare("SELECT COUNT(*) AS count FROM drafting_plans").get() as { count: number }).count,
      units: (database.prepare("SELECT COUNT(*) AS count FROM drafting_plan_unit_passages").get() as { count: number }).count,
      generated: database.prepare(`SELECT passage_id, based_on_passage_plan_version_id,
        generation_plan_id, generation_job_id, generation_unit_id
        FROM passage_draft_versions WHERE source_kind = 'generated'`).get(),
    }).toEqual(before);
    expect(database.prepare(`SELECT name FROM sqlite_master
      WHERE type = 'trigger' AND name = 'passage_draft_generation_input_insert'`).get())
      .toEqual({ name: "passage_draft_generation_input_insert" });
    database.close();

    expect(digest(v10FixturePath)).toBe(originalHash);
    const stillFrozen = new DatabaseSync(v10FixturePath, { readOnly: true });
    expect((stillFrozen.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version)
      .toBe(10);
    stillFrozen.close();
  });

  it("rejects corrupt schema-v10 generation input lineage without leaving partial v11 state", () => {
    const originalHash = digest(v10FixturePath);
    const directory = mkdtempSync(join(tmpdir(), "cyoa-v11-corrupt-migration-"));
    temporaryDirectories.push(directory);
    const copyPath = join(directory, "schema-v10-corrupt.sqlite");
    copyFileSync(v10FixturePath, copyPath);
    const database = new DatabaseSync(copyPath);
    database.exec("DROP TRIGGER passage_draft_versions_immutable_update");
    database.prepare(`UPDATE passage_draft_versions SET generation_unit_id = 'unit-2'
      WHERE source_kind = 'generated'`).run();

    expect(() => migrate(database)).toThrow("invalid generation input provenance");
    expect((database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version)
      .toBe(10);
    expect(database.prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger'
      AND name IN ('passage_draft_generation_input_insert', 'passage_draft_generation_upstream_insert')`).all())
      .toEqual([]);
    expect(database.prepare("SELECT generation_unit_id FROM passage_draft_versions WHERE source_kind = 'generated'").get())
      .toEqual({ generation_unit_id: "unit-2" });
    database.close();
    expect(digest(v10FixturePath)).toBe(originalHash);
  });

  it("migrates only a temporary copy of the frozen representative schema-v11 fixture", () => {
    const originalHash = digest(v11FixturePath);
    const frozen = new DatabaseSync(v11FixturePath, { readOnly: true });
    expect((frozen.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version)
      .toBe(11);
    const before = {
      projects: (frozen.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number }).count,
      generationCandidates: (frozen.prepare("SELECT COUNT(*) AS count FROM generation_unit_candidates").get() as { count: number }).count,
      proposals: (frozen.prepare("SELECT COUNT(*) AS count FROM passage_proposal_sets").get() as { count: number }).count,
      drafts: (frozen.prepare("SELECT COUNT(*) AS count FROM passage_draft_versions").get() as { count: number }).count,
      accepted: frozen.prepare("SELECT accepted_version_id, accepted_locked FROM passage_draft_heads LIMIT 1").get(),
      plans: (frozen.prepare("SELECT COUNT(*) AS count FROM drafting_plans").get() as { count: number }).count,
      attempts: (frozen.prepare("SELECT COUNT(*) AS count FROM drafting_unit_attempts").get() as { count: number }).count,
    };
    expect(() => frozen.prepare("SELECT context_json FROM drafting_plan_units").get()).toThrow();
    frozen.close();

    const directory = mkdtempSync(join(tmpdir(), "cyoa-v11-migration-"));
    temporaryDirectories.push(directory);
    const copyPath = join(directory, "schema-v11.sqlite");
    copyFileSync(v11FixturePath, copyPath);
    const database = openDatabase(copyPath);
    expect((database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version)
      .toBe(CURRENT_SCHEMA_VERSION);
    expect({
      projects: (database.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number }).count,
      generationCandidates: (database.prepare("SELECT COUNT(*) AS count FROM generation_unit_candidates").get() as { count: number }).count,
      proposals: (database.prepare("SELECT COUNT(*) AS count FROM passage_proposal_sets").get() as { count: number }).count,
      drafts: (database.prepare("SELECT COUNT(*) AS count FROM passage_draft_versions").get() as { count: number }).count,
      accepted: database.prepare("SELECT accepted_version_id, accepted_locked FROM passage_draft_heads LIMIT 1").get(),
      plans: (database.prepare("SELECT COUNT(*) AS count FROM drafting_plans").get() as { count: number }).count,
      attempts: (database.prepare("SELECT COUNT(*) AS count FROM drafting_unit_attempts").get() as { count: number }).count,
    }).toEqual(before);
    expect(database.prepare("SELECT context_json, context_fingerprint FROM drafting_plan_units LIMIT 1").get())
      .toEqual({ context_json: "{}", context_fingerprint: "" });
    expect((database.prepare("SELECT COUNT(*) AS count FROM drafting_unit_outputs").get() as { count: number }).count).toBe(0);
    database.close();

    expect(digest(v11FixturePath)).toBe(originalHash);
    const stillFrozen = new DatabaseSync(v11FixturePath, { readOnly: true });
    expect((stillFrozen.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version)
      .toBe(11);
    stillFrozen.close();
  });

  it("rejects corrupt schema-v11 attempt lineage without leaving partial v12 context or candidate objects", () => {
    const originalHash = digest(v11FixturePath);
    const directory = mkdtempSync(join(tmpdir(), "cyoa-v12-corrupt-attempt-migration-"));
    temporaryDirectories.push(directory);
    const copyPath = join(directory, "schema-v11-corrupt.sqlite");
    copyFileSync(v11FixturePath, copyPath);
    const database = new DatabaseSync(copyPath);
    database.exec("DROP TRIGGER drafting_unit_attempts_lineage_update");
    database.exec("PRAGMA foreign_keys = OFF");
    database.prepare("UPDATE drafting_unit_attempts SET unit_id = 'missing-unit'").run();

    expect(() => migrate(database)).toThrow("invalid attempt lineage");
    expect((database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version)
      .toBe(11);
    expect(() => database.prepare("SELECT context_json FROM drafting_plan_units").get()).toThrow();
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'drafting_unit_outputs'").get())
      .toBeUndefined();
    expect(database.prepare("SELECT unit_id FROM drafting_unit_attempts LIMIT 1").get())
      .toEqual({ unit_id: "missing-unit" });
    database.close();
    expect(digest(v11FixturePath)).toBe(originalHash);
  });

  it("migrates only a temporary copy of the frozen representative schema-v12 fixture losslessly", () => {
    const originalHash = digest(v12FixturePath);
    const frozen = new DatabaseSync(v12FixturePath, { readOnly: true });
    expect((frozen.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version)
      .toBe(12);
    const before = {
      drafts: (frozen.prepare("SELECT COUNT(*) AS count FROM passage_draft_versions").get() as { count: number }).count,
      accepted: frozen.prepare("SELECT accepted_version_id, accepted_locked FROM passage_draft_heads WHERE accepted_version_id IS NOT NULL LIMIT 1").get(),
      contexts: (frozen.prepare("SELECT COUNT(*) AS count FROM drafting_plan_units WHERE context_fingerprint != ''").get() as { count: number }).count,
      outputs: (frozen.prepare("SELECT COUNT(*) AS count FROM drafting_unit_outputs").get() as { count: number }).count,
      provenance: (frozen.prepare("SELECT COUNT(*) AS count FROM passage_draft_generation_provenance").get() as { count: number }).count,
      jobs: (frozen.prepare("SELECT COUNT(*) AS count FROM drafting_jobs").get() as { count: number }).count,
      attempts: (frozen.prepare("SELECT COUNT(*) AS count FROM drafting_unit_attempts").get() as { count: number }).count,
      stale: (frozen.prepare("SELECT COUNT(*) AS count FROM passage_draft_staleness_events").get() as { count: number }).count,
    };
    expect(before.outputs).toBeGreaterThan(0);
    expect(before.provenance).toBeGreaterThan(0);
    frozen.close();

    const directory = mkdtempSync(join(tmpdir(), "cyoa-v12-migration-"));
    temporaryDirectories.push(directory);
    const copyPath = join(directory, "schema-v12.sqlite");
    copyFileSync(v12FixturePath, copyPath);
    const database = openDatabase(copyPath);
    expect((database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version)
      .toBe(CURRENT_SCHEMA_VERSION);
    expect({
      drafts: (database.prepare("SELECT COUNT(*) AS count FROM passage_draft_versions").get() as { count: number }).count,
      accepted: database.prepare("SELECT accepted_version_id, accepted_locked FROM passage_draft_heads WHERE accepted_version_id IS NOT NULL LIMIT 1").get(),
      contexts: (database.prepare("SELECT COUNT(*) AS count FROM drafting_plan_units WHERE context_fingerprint != ''").get() as { count: number }).count,
      outputs: (database.prepare("SELECT COUNT(*) AS count FROM drafting_unit_outputs").get() as { count: number }).count,
      provenance: (database.prepare("SELECT COUNT(*) AS count FROM passage_draft_generation_provenance").get() as { count: number }).count,
      jobs: (database.prepare("SELECT COUNT(*) AS count FROM drafting_jobs").get() as { count: number }).count,
      attempts: (database.prepare("SELECT COUNT(*) AS count FROM drafting_unit_attempts").get() as { count: number }).count,
      stale: (database.prepare("SELECT COUNT(*) AS count FROM passage_draft_staleness_events").get() as { count: number }).count,
    }).toEqual(before);
    expect((database.prepare("SELECT COUNT(*) AS count FROM passage_draft_acceptance_applications").get() as { count: number }).count).toBe(0);
    expect((database.prepare("SELECT COUNT(*) AS count FROM passage_draft_acceptance_items").get() as { count: number }).count).toBe(0);
    database.close();

    expect(digest(v12FixturePath)).toBe(originalHash);
    const stillFrozen = new DatabaseSync(v12FixturePath, { readOnly: true });
    expect((stillFrozen.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version)
      .toBe(12);
    stillFrozen.close();
  });

  it("rolls back every v13 object when the additive acceptance migration cannot complete", () => {
    const originalHash = digest(v12FixturePath);
    const directory = mkdtempSync(join(tmpdir(), "cyoa-v13-rollback-"));
    temporaryDirectories.push(directory);
    const copyPath = join(directory, "schema-v12-conflict.sqlite");
    copyFileSync(v12FixturePath, copyPath);
    const database = new DatabaseSync(copyPath);
    database.exec("CREATE TABLE passage_draft_acceptance_applications (conflict TEXT)");
    expect(() => migrate(database)).toThrow();
    expect((database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version)
      .toBe(12);
    expect(database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'passage_draft_acceptance_applications'").get())
      .toEqual({ sql: "CREATE TABLE passage_draft_acceptance_applications (conflict TEXT)" });
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'passage_draft_acceptance_items'").get())
      .toBeUndefined();
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'passage_draft_acceptance_items_lineage_insert'").get())
      .toBeUndefined();
    database.close();
    expect(digest(v12FixturePath)).toBe(originalHash);
  });

  it("migrates only a temporary copy of the frozen schema-v13 fixture losslessly through v15", () => {
    const originalHash = digest(v13FixturePath);
    const frozen = new DatabaseSync(v13FixturePath, { readOnly: true });
    expect((frozen.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(13);
    const before = {
      projects: (frozen.prepare("SELECT COUNT(*) count FROM projects").get() as { count: number }).count,
      artifacts: (frozen.prepare("SELECT COUNT(*) count FROM artifact_versions").get() as { count: number }).count,
      snapshots: (frozen.prepare("SELECT COUNT(*) count FROM passage_plan_snapshots").get() as { count: number }).count,
      drafts: (frozen.prepare("SELECT COUNT(*) count FROM passage_draft_versions").get() as { count: number }).count,
      acceptance: (frozen.prepare("SELECT COUNT(*) count FROM passage_draft_acceptance_applications").get() as { count: number }).count,
    };
    frozen.close();

    const directory = mkdtempSync(join(tmpdir(), "cyoa-v14-migration-"));
    temporaryDirectories.push(directory);
    const copyPath = join(directory, "schema-v13.sqlite");
    copyFileSync(v13FixturePath, copyPath);
    const database = openDatabase(copyPath);
    expect((database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(CURRENT_SCHEMA_VERSION);
    expect({
      projects: (database.prepare("SELECT COUNT(*) count FROM projects").get() as { count: number }).count,
      artifacts: (database.prepare("SELECT COUNT(*) count FROM artifact_versions").get() as { count: number }).count,
      snapshots: (database.prepare("SELECT COUNT(*) count FROM passage_plan_snapshots").get() as { count: number }).count,
      drafts: (database.prepare("SELECT COUNT(*) count FROM passage_draft_versions").get() as { count: number }).count,
      acceptance: (database.prepare("SELECT COUNT(*) count FROM passage_draft_acceptance_applications").get() as { count: number }).count,
    }).toEqual(before);
    expect((database.prepare("SELECT COUNT(*) count FROM repair_applications").get() as { count: number }).count).toBe(0);
    expect((database.prepare("SELECT COUNT(*) count FROM repair_application_draft_links").get() as { count: number }).count).toBe(0);
    expect((database.prepare("SELECT COUNT(*) count FROM repair_application_result_versions").get() as { count: number }).count).toBe(0);
    database.close();

    expect(digest(v13FixturePath)).toBe(originalHash);
    const stillFrozen = new DatabaseSync(v13FixturePath, { readOnly: true });
    expect((stillFrozen.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(13);
    stillFrozen.close();
  });

  it("rolls back every v14 object when the additive repair-application migration cannot complete", () => {
    const originalHash = digest(v13FixturePath);
    const directory = mkdtempSync(join(tmpdir(), "cyoa-v14-rollback-"));
    temporaryDirectories.push(directory);
    const copyPath = join(directory, "schema-v13-conflict.sqlite");
    copyFileSync(v13FixturePath, copyPath);
    const database = new DatabaseSync(copyPath);
    database.exec("CREATE TABLE repair_applications (conflict TEXT)");
    expect(() => migrate(database)).toThrow();
    expect((database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(13);
    expect(database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'repair_applications'").get())
      .toEqual({ sql: "CREATE TABLE repair_applications (conflict TEXT)" });
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'repair_application_draft_links'").get())
      .toBeUndefined();
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'repair_application_result_versions'").get())
      .toBeUndefined();
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'repair_applications_lineage_insert'").get())
      .toBeUndefined();
    database.close();
    expect(digest(v13FixturePath)).toBe(originalHash);
  });

  it("migrates a frozen schema-v14 database additively to v15 without changing the fixture", () => {
    const originalHash = digest(v14FixturePath);
    const frozen = new DatabaseSync(v14FixturePath, { readOnly: true });
    expect((frozen.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(14);
    frozen.close();
    const directory = mkdtempSync(join(tmpdir(), "cyoa-v15-migration-"));
    temporaryDirectories.push(directory);
    const copyPath = join(directory, "schema-v14.sqlite");
    copyFileSync(v14FixturePath, copyPath);
    const database = openDatabase(copyPath);
    expect((database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(CURRENT_SCHEMA_VERSION);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'repair_application_draft_links_provenance_v15_insert'").get())
      .toEqual({ name: "repair_application_draft_links_provenance_v15_insert" });
    database.close();
    expect(digest(v14FixturePath)).toBe(originalHash);
  });

  it("rolls back the additive v15 trigger and version on migration failure", () => {
    const originalHash = digest(v14FixturePath);
    const directory = mkdtempSync(join(tmpdir(), "cyoa-v15-rollback-"));
    temporaryDirectories.push(directory);
    const copyPath = join(directory, "schema-v14-conflict.sqlite");
    copyFileSync(v14FixturePath, copyPath);
    const database = new DatabaseSync(copyPath);
    database.exec("CREATE TRIGGER repair_application_draft_links_provenance_v15_insert BEFORE INSERT ON repair_application_draft_links BEGIN SELECT 1; END");
    expect(() => migrate(database)).toThrow();
    expect((database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(14);
    expect((database.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type = 'trigger' AND name = 'repair_application_draft_links_provenance_v15_insert'").get() as { count: number }).count).toBe(1);
    database.close();
    expect(digest(v14FixturePath)).toBe(originalHash);
  });

  it("migrates only a temporary copy of the frozen schema-v15 fixture to v16 without changing accepted bytes", () => {
    const originalHash = digest(v15FixturePath);
    expect(originalHash).toBe("02226988ab537ca17a7612a3e8b7b48206b8e3983257308609221208afb13534");
    const frozen = new DatabaseSync(v15FixturePath, { readOnly: true });
    expect((frozen.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(15);
    expect(frozen.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_backup_records'").get()).toBeUndefined();
    const before = {
      projects: (frozen.prepare("SELECT COUNT(*) count FROM projects").get() as { count: number }).count,
      artifacts: (frozen.prepare("SELECT COUNT(*) count FROM artifact_versions").get() as { count: number }).count,
      drafts: (frozen.prepare("SELECT COUNT(*) count FROM passage_draft_versions").get() as { count: number }).count,
      repairLinks: (frozen.prepare("SELECT COUNT(*) count FROM repair_application_draft_links").get() as { count: number }).count,
    };
    frozen.close();

    const directory = mkdtempSync(join(tmpdir(), "cyoa-v16-migration-"));
    temporaryDirectories.push(directory);
    const copyPath = join(directory, "schema-v15.sqlite");
    copyFileSync(v15FixturePath, copyPath);
    const database = openDatabase(copyPath);
    expect((database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(CURRENT_SCHEMA_VERSION);
    expect((database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(CURRENT_SCHEMA_VERSION);
    expect({
      projects: (database.prepare("SELECT COUNT(*) count FROM projects").get() as { count: number }).count,
      artifacts: (database.prepare("SELECT COUNT(*) count FROM artifact_versions").get() as { count: number }).count,
      drafts: (database.prepare("SELECT COUNT(*) count FROM passage_draft_versions").get() as { count: number }).count,
      repairLinks: (database.prepare("SELECT COUNT(*) count FROM repair_application_draft_links").get() as { count: number }).count,
    }).toEqual(before);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_backup_records'").get())
      .toEqual({ name: "project_backup_records" });
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_recovery_state'").get())
      .toEqual({ name: "project_recovery_state" });
    database.close();
    expect(digest(v15FixturePath)).toBe(originalHash);
  });

  it("rolls back every v16 recovery object and version when the additive migration conflicts", () => {
    const originalHash = digest(v15FixturePath);
    const directory = mkdtempSync(join(tmpdir(), "cyoa-v16-rollback-"));
    temporaryDirectories.push(directory);
    const copyPath = join(directory, "schema-v15-conflict.sqlite");
    copyFileSync(v15FixturePath, copyPath);
    const database = new DatabaseSync(copyPath);
    database.exec("CREATE TABLE project_backup_records (conflict TEXT)");
    expect(() => migrate(database)).toThrow();
    expect((database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(15);
    expect((database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).not.toBe(16);
    expect(database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'project_backup_records'").get())
      .toEqual({ sql: "CREATE TABLE project_backup_records (conflict TEXT)" });
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_restore_records'").get()).toBeUndefined();
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_recovery_state'").get()).toBeUndefined();
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'project_backup_records_immutable_update'").get()).toBeUndefined();
    database.close();
    expect(digest(v15FixturePath)).toBe(originalHash);
  });

  it("migrates only a temporary copy of the frozen schema-v16 fixture to v17 without changing accepted bytes", () => {
    const originalHash = digest(v16FixturePath);
    expect(originalHash).toBe("7c85c6e746c47aa8e227a9e5840e0c7f8d4b248d6e03402259df9c8935074369");
    const frozen = new DatabaseSync(v16FixturePath, { readOnly: true });
    expect((frozen.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(16);
    expect(frozen.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pinned_decisions'").get()).toBeUndefined();
    const before = logicalDatabaseState(frozen);
    frozen.close();

    const directory = mkdtempSync(join(tmpdir(), "cyoa-v17-migration-"));
    temporaryDirectories.push(directory);
    const copyPath = join(directory, "schema-v16.sqlite");
    copyFileSync(v16FixturePath, copyPath);
    const database = openDatabase(copyPath);
    expect((database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version)
      .toBe(CURRENT_SCHEMA_VERSION);
    expect((database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version)
      .toBe(CURRENT_SCHEMA_VERSION);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pinned_decisions'").get())
      .toEqual({ name: "pinned_decisions" });
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'conversation_summary_versions'").get())
      .toEqual({ name: "conversation_summary_versions" });
    database.close();
    expect(digest(v16FixturePath)).toBe(originalHash);
    const stillFrozen = new DatabaseSync(v16FixturePath, { readOnly: true });
    expect(logicalDatabaseState(stillFrozen)).toBe(before);
    stillFrozen.close();
  });

  it("rolls back every v17 author-memory object and version when the additive migration conflicts", () => {
    const originalHash = digest(v16FixturePath);
    const directory = mkdtempSync(join(tmpdir(), "cyoa-v17-rollback-"));
    temporaryDirectories.push(directory);
    const copyPath = join(directory, "schema-v16-conflict.sqlite");
    copyFileSync(v16FixturePath, copyPath);
    const database = new DatabaseSync(copyPath);
    database.exec("CREATE TABLE conversation_summary_series (conflict TEXT)");
    expect(() => migrate(database)).toThrow();
    expect((database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(16);
    expect((database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(16);
    expect(database.prepare("SELECT sql FROM sqlite_master WHERE name = 'conversation_summary_series'").get())
      .toEqual({ sql: "CREATE TABLE conversation_summary_series (conflict TEXT)" });
    expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'conversation_summary_versions'").get()).toBeUndefined();
    expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'pinned_decisions'").get()).toBeUndefined();
    database.close();
    expect(digest(v16FixturePath)).toBe(originalHash);
  });

  it("rejects a non-latest v17 author-memory head without partially reinstalling integrity triggers", () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-v17-corrupt-head-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "corrupt.sqlite");
    const database = openDatabase(databasePath);
    const project = new ProjectRepository(database).create("Corrupt author memory", undefined, "long-form");
    const brief = new ArtifactRepository(database).saveArtifact({ projectId: project.id, artifactId: "brief",
      content: { title: "Brief" } });
    const conversations = new ConversationRepository(database);
    const scope = { kind: "artifact" as const, projectId: project.id, stage: "brief" as const,
      artifactId: "brief" as const, versionId: brief.id };
    const conversation = conversations.create(project.id, scope);
    const memory = new AuthorMemoryRepository(database);
    for (let index = 0; index < 14; index += 1) conversations.addMessage({ conversationId: conversation.id,
      role: "user", content: `Initial ${index}`, intent: "discuss", scope,
      context: { briefVersionId: brief.id }, metadata: {} });
    const first = memory.ensureSummary(project.id, conversation.id)!;
    for (let index = 0; index < 6; index += 1) conversations.addMessage({ conversationId: conversation.id,
      role: "user", content: `Later ${index}`, intent: "discuss", scope,
      context: { briefVersionId: brief.id }, metadata: {} });
    const second = memory.ensureSummary(project.id, conversation.id)!;
    expect(second.version).toBe(2);
    database.exec("DROP TRIGGER conversation_summary_heads_monotonic_update");
    database.prepare("UPDATE conversation_summary_heads SET current_version_id = ? WHERE series_id = ?")
      .run(first.id, first.stableId);
    database.close();

    let rejection: unknown;
    try { openDatabase(databasePath); } catch (error) { rejection = error; }
    expect(rejection).toBeInstanceOf(DatabaseRecoveryError);
    expect(String((rejection as Error & { cause?: unknown }).cause)).toContain("non-latest summary head");
    const rejected = new DatabaseSync(databasePath);
    expect((rejected.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(17);
    expect(rejected.prepare("SELECT current_version_id FROM conversation_summary_heads WHERE series_id = ?")
      .get(first.stableId)).toEqual({ current_version_id: first.id });
    expect(rejected.prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger'
      AND name = 'conversation_summary_heads_monotonic_update'`).get()).toBeUndefined();
    rejected.close();
  });

  it("installs the additive v17 integrity patch without changing valid author-memory history", () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-v17-integrity-patch-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "valid.sqlite");
    const database = openDatabase(databasePath);
    const project = new ProjectRepository(database).create("Valid author memory", undefined, "long-form");
    const memory = new AuthorMemoryRepository(database);
    const decision = memory.createDecision({ projectId: project.id, scope: { kind: "project" }, content: "Retain history" });
    database.exec("DROP TRIGGER pinned_decisions_immutable_delete");
    database.close();

    const reopened = openDatabase(databasePath);
    expect(reopened.prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger'
      AND name = 'pinned_decisions_immutable_delete'`).get()).toBeDefined();
    expect(new AuthorMemoryRepository(reopened).getDecision(project.id, decision.stableId)).toMatchObject({
      id: decision.id, content: decision.content, version: 1,
    });
    expect((reopened.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version)
      .toBe(17);
    reopened.close();
  });

  it.each([
    { version: 4, fixture: v4FixturePath },
    { version: 5, fixture: v5FixturePath },
    { version: 10, fixture: v10FixturePath },
    { version: 15, fixture: v15FixturePath },
  ])("keeps a schema-v$version upgrade logically exact when a later v16 conflict fails", ({ version, fixture }) => {
    const directory = mkdtempSync(join(tmpdir(), `cyoa-whole-upgrade-v${version}-`));
    temporaryDirectories.push(directory);
    const copyPath = join(directory, `schema-v${version}-conflict.sqlite`);
    copyFileSync(fixture, copyPath);
    const raw = new DatabaseSync(copyPath);
    raw.exec("CREATE TABLE project_backup_records (conflict TEXT)");
    raw.prepare("INSERT INTO project_backup_records VALUES (?)").run("preserve conflict exactly");
    const before = logicalDatabaseState(raw);
    const userVersion = (raw.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
    raw.close();

    expect(() => openDatabase(copyPath)).toThrow();
    const rejected = new DatabaseSync(copyPath);
    expect(logicalDatabaseState(rejected)).toBe(before);
    expect((rejected.prepare("SELECT MAX(version) version FROM schema_migrations").get() as { version: number }).version).toBe(version);
    expect((rejected.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(userVersion);
    const laterObject = rejected.prepare("SELECT name FROM sqlite_master WHERE name = 'passage_draft_acceptance_applications'").get();
    if (version >= 13) expect(laterObject).toBeDefined();
    else expect(laterObject).toBeUndefined();
    rejected.exec("DROP TABLE project_backup_records");
    rejected.close();

    const retried = openDatabase(copyPath);
    expect((retried.prepare("SELECT MAX(version) version FROM schema_migrations").get() as { version: number }).version).toBe(CURRENT_SCHEMA_VERSION);
    expect((retried.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(CURRENT_SCHEMA_VERSION);
    retried.close();
  });

  it("rolls back all earlier upgrade work when invalid repair lineage is discovered several versions later", () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-late-corruption-"));
    temporaryDirectories.push(directory);
    const copyPath = join(directory, "schema-v4-late-corruption.sqlite");
    copyFileSync(v4FixturePath, copyPath);
    const raw = new DatabaseSync(copyPath);
    raw.exec(`CREATE TABLE repair_applications (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, proposal_artifact_version_id TEXT NOT NULL,
      repair_plan_artifact_version_id TEXT NOT NULL, proposal_id TEXT NOT NULL, content_json TEXT NOT NULL
    )`);
    raw.prepare("INSERT INTO repair_applications VALUES (?, ?, ?, ?, ?, ?)").run(
      "invalid-application", "fixture-project", "missing-proposal", "missing-plan", "missing", "{}",
    );
    const before = logicalDatabaseState(raw);
    const userVersion = (raw.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
    raw.close();

    expect(() => openDatabase(copyPath)).toThrow();
    const rejected = new DatabaseSync(copyPath);
    expect(logicalDatabaseState(rejected)).toBe(before);
    expect((rejected.prepare("SELECT MAX(version) version FROM schema_migrations").get() as { version: number }).version).toBe(4);
    expect((rejected.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(userVersion);
    expect(rejected.prepare("SELECT name FROM sqlite_master WHERE name = 'repair_application_draft_links'").get()).toBeUndefined();
    rejected.exec("DROP TABLE repair_applications");
    rejected.close();

    const retried = openDatabase(copyPath);
    expect((retried.prepare("SELECT MAX(version) version FROM schema_migrations").get() as { version: number }).version).toBe(CURRENT_SCHEMA_VERSION);
    retried.close();
  });
});
