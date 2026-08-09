import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDatabase } from "../src/index.js";

const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const v4FixturePath = join(fixtureDirectory, "schema-v4.sqlite");
const v5FixturePath = join(fixtureDirectory, "schema-v5.sqlite");
const v6FixturePath = join(fixtureDirectory, "schema-v6.sqlite");
const temporaryDirectories: string[] = [];
afterEach(() => temporaryDirectories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

describe("generation kernel migration", () => {
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

    expect((database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(7);
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

    expect((database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(7);
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

  it("migrates the frozen accepted schema-v6 fixture losslessly to v7 without changing its bytes", () => {
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
    expect((database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(7);
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
});
