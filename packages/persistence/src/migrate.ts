import type { StoryDatabase } from "./database.js";
import {
  generationCandidateLineageMigrationSql,
  generationJobParentLineageTriggerSql,
  generationKernelMigrationSql,
  generationLineageMigrationSql,
  passagePlanningCandidatesMigrationSql,
  schemaSql,
} from "./schema.js";

export function migrate(database: StoryDatabase): void {
  database.exec(schemaSql);
  addColumn(database, "projects", "mode", "TEXT NOT NULL DEFAULT 'quick'");
  addColumn(database, "conversations", "title", "TEXT NOT NULL DEFAULT 'Project discussion'");
  addColumn(database, "conversations", "scope_json", "TEXT NOT NULL DEFAULT '{}'");
  addColumn(database, "conversations", "summary", "TEXT NOT NULL DEFAULT ''");
  addColumn(database, "conversations", "updated_at", "TEXT NOT NULL DEFAULT ''");
  addColumn(database, "messages", "intent", "TEXT NOT NULL DEFAULT 'discuss'");
  addColumn(database, "messages", "scope_json", "TEXT NOT NULL DEFAULT '{}'");
  addColumn(database, "messages", "context_json", "TEXT NOT NULL DEFAULT '{}'");
  addColumn(database, "messages", "metadata_json", "TEXT NOT NULL DEFAULT '{}'");
  addColumn(database, "change_sets", "proposal_json", "TEXT");
  addColumn(database, "change_sets", "validation_json", "TEXT NOT NULL DEFAULT '[]'");
  database.prepare(`
    INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (1, ?)
  `).run(new Date().toISOString());
  database.prepare(`
    INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (2, ?)
  `).run(new Date().toISOString());
  database.prepare(`
    INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (3, ?)
  `).run(new Date().toISOString());
  database.prepare(`
    INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (4, ?)
  `).run(new Date().toISOString());
  const generationKernelApplied = database.prepare(
    "SELECT version FROM schema_migrations WHERE version = 5",
  ).get();
  if (!generationKernelApplied) {
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(generationKernelMigrationSql);
      database.prepare(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (5, ?)",
      ).run(new Date().toISOString());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  const generationLineageApplied = database.prepare(
    "SELECT version FROM schema_migrations WHERE version = 6",
  ).get();
  if (!generationLineageApplied) {
    database.exec("BEGIN IMMEDIATE");
    try {
      assertValidGenerationJobUnitLineage(database);
      database.exec(generationLineageMigrationSql);
      database.prepare(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (6, ?)",
      ).run(new Date().toISOString());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  } else if (!hasTrigger(database, "generation_jobs_lineage_update")) {
    database.exec("BEGIN IMMEDIATE");
    try {
      assertValidGenerationJobUnitLineage(database);
      database.exec(generationJobParentLineageTriggerSql);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  const passagePlanningCandidatesApplied = database.prepare(
    "SELECT version FROM schema_migrations WHERE version = 7",
  ).get();
  if (!passagePlanningCandidatesApplied) {
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(passagePlanningCandidatesMigrationSql);
      database.prepare(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (7, ?)",
      ).run(new Date().toISOString());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  const generationCandidateLineageApplied = database.prepare(
    "SELECT version FROM schema_migrations WHERE version = 8",
  ).get();
  if (!generationCandidateLineageApplied) {
    database.exec("BEGIN IMMEDIATE");
    try {
      assertValidGenerationCandidateLineage(database);
      database.exec(generationCandidateLineageMigrationSql);
      database.prepare(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (8, ?)",
      ).run(new Date().toISOString());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}

function assertValidGenerationJobUnitLineage(database: StoryDatabase): void {
  const invalid = database.prepare(`
    SELECT units.project_id, units.job_id, units.plan_id
    FROM generation_job_units units
    LEFT JOIN generation_jobs jobs
      ON jobs.project_id = units.project_id
      AND jobs.id = units.job_id
      AND jobs.plan_id = units.plan_id
    WHERE jobs.id IS NULL
    LIMIT 1
  `).get();
  if (invalid) throw new Error("Cannot migrate generation data with invalid job-unit lineage");
}

function assertValidGenerationCandidateLineage(database: StoryDatabase): void {
  const invalid = database.prepare(`
    SELECT candidates.project_id, candidates.job_id, candidates.plan_id, candidates.unit_id
    FROM generation_unit_candidates candidates
    LEFT JOIN generation_job_units units
      ON units.project_id = candidates.project_id
      AND units.job_id = candidates.job_id
      AND units.plan_id = candidates.plan_id
      AND units.unit_id = candidates.unit_id
    LEFT JOIN generation_jobs jobs
      ON jobs.project_id = candidates.project_id
      AND jobs.id = candidates.job_id
      AND jobs.plan_id = candidates.plan_id
    WHERE units.job_id IS NULL OR jobs.id IS NULL
    LIMIT 1
  `).get();
  if (invalid) throw new Error("Cannot migrate generation data with invalid candidate lineage");
}

function hasTrigger(database: StoryDatabase, name: string): boolean {
  return Boolean(database.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = ?",
  ).get(name));
}

function addColumn(database: StoryDatabase, table: string, column: string, definition: string): void {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
