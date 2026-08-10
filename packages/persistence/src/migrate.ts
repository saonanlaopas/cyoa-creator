import type { StoryDatabase } from "./database.js";
import {
  generationCandidateLineageMigrationSql,
  generationJobParentLineageTriggerSql,
  generationKernelMigrationSql,
  generationLineageMigrationSql,
  passagePlanningCandidatesMigrationSql,
  passageDraftArchitectureMigrationSql,
  passageDraftGenerationMigrationSql,
  passageDraftProvenanceMigrationSql,
  passageProposalMigrationSql,
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
  const passageProposalApplied = database.prepare(
    "SELECT version FROM schema_migrations WHERE version = 9",
  ).get();
  if (!passageProposalApplied) {
    database.exec("BEGIN IMMEDIATE");
    try {
      assertValidGenerationCandidateLineage(database);
      database.exec(passageProposalMigrationSql);
      database.prepare(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (9, ?)",
      ).run(new Date().toISOString());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  const passageDraftArchitectureApplied = database.prepare(
    "SELECT version FROM schema_migrations WHERE version = 10",
  ).get();
  if (!passageDraftArchitectureApplied) {
    database.exec("BEGIN IMMEDIATE");
    try {
      if (hasTable(database, "passage_draft_versions")) assertValidPassageDraftLineage(database);
      database.exec(passageDraftArchitectureMigrationSql);
      assertValidPassageDraftLineage(database);
      database.prepare(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (10, ?)",
      ).run(new Date().toISOString());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  const passageDraftProvenanceApplied = database.prepare(
    "SELECT version FROM schema_migrations WHERE version = 11",
  ).get();
  if (!passageDraftProvenanceApplied) {
    database.exec("BEGIN IMMEDIATE");
    try {
      assertValidGeneratedDraftProvenance(database);
      database.exec(passageDraftProvenanceMigrationSql);
      assertValidGeneratedDraftProvenance(database);
      database.prepare(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (11, ?)",
      ).run(new Date().toISOString());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  const passageDraftGenerationApplied = database.prepare(
    "SELECT version FROM schema_migrations WHERE version = 12",
  ).get();
  if (!passageDraftGenerationApplied) {
    database.exec("BEGIN IMMEDIATE");
    try {
      assertValidPassageDraftLineage(database);
      assertValidGeneratedDraftProvenance(database);
      database.exec(passageDraftGenerationMigrationSql);
      assertValidDraftingGenerationLineage(database);
      database.prepare(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (12, ?)",
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

function hasTable(database: StoryDatabase, name: string): boolean {
  return Boolean(database.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(name));
}

function assertValidPassageDraftLineage(database: StoryDatabase): void {
  const invalidDraft = database.prepare(`
    SELECT drafts.id
    FROM passage_draft_versions drafts
    LEFT JOIN passage_entity_versions passages
      ON passages.project_id = drafts.project_id
      AND passages.id = drafts.based_on_passage_plan_version_id
      AND passages.entity_kind = 'passage'
      AND passages.entity_id = drafts.passage_id
    WHERE passages.id IS NULL
    LIMIT 1
  `).get();
  if (invalidDraft) throw new Error("Cannot migrate passage drafts with invalid passage-version lineage");
  const invalidHead = database.prepare(`
    SELECT heads.passage_id
    FROM passage_draft_heads heads
    LEFT JOIN passage_draft_versions current_versions
      ON current_versions.project_id = heads.project_id
      AND current_versions.id = heads.current_version_id
      AND current_versions.passage_id = heads.passage_id
    LEFT JOIN passage_draft_versions accepted_versions
      ON accepted_versions.project_id = heads.project_id
      AND accepted_versions.id = heads.accepted_version_id
      AND accepted_versions.passage_id = heads.passage_id
      AND accepted_versions.lifecycle_status IN ('accepted', 'reviewed', 'locked')
    WHERE current_versions.id IS NULL
      OR (heads.accepted_version_id IS NOT NULL AND accepted_versions.id IS NULL)
      OR (heads.accepted_locked = 1 AND heads.accepted_version_id IS NULL)
    LIMIT 1
  `).get();
  if (invalidHead) throw new Error("Cannot migrate passage drafts with invalid head lineage");
  const invalidUpstream = database.prepare(`
    SELECT dependencies.draft_version_id
    FROM passage_draft_upstream_artifacts dependencies
    LEFT JOIN passage_draft_versions drafts
      ON drafts.project_id = dependencies.project_id AND drafts.id = dependencies.draft_version_id
    LEFT JOIN artifact_versions artifacts
      ON artifacts.project_id = dependencies.project_id
      AND artifacts.id = dependencies.artifact_version_id
      AND artifacts.artifact_id = dependencies.artifact_id
    WHERE drafts.id IS NULL OR artifacts.id IS NULL
    LIMIT 1
  `).get();
  if (invalidUpstream) throw new Error("Cannot migrate passage drafts with invalid upstream lineage");
  const invalidGeneration = database.prepare(`
    SELECT drafts.id
    FROM passage_draft_versions drafts
    LEFT JOIN drafting_job_units units
      ON units.project_id = drafts.project_id
      AND units.job_id = drafts.generation_job_id
      AND units.plan_id = drafts.generation_plan_id
      AND units.unit_id = drafts.generation_unit_id
    WHERE (drafts.source_kind = 'generated' AND units.job_id IS NULL)
      OR (drafts.source_kind IN ('manual', 'restore')
        AND (drafts.generation_plan_id IS NOT NULL OR drafts.generation_job_id IS NOT NULL
          OR drafts.generation_unit_id IS NOT NULL))
      OR (drafts.source_kind = 'lifecycle'
        AND ((drafts.generation_plan_id IS NULL) != (drafts.generation_job_id IS NULL)
          OR (drafts.generation_job_id IS NULL) != (drafts.generation_unit_id IS NULL)
          OR (drafts.generation_plan_id IS NOT NULL AND units.job_id IS NULL)))
    LIMIT 1
  `).get();
  if (invalidGeneration) throw new Error("Cannot migrate passage drafts with invalid generation lineage");
  const invalidUnit = database.prepare(`
    SELECT inputs.unit_id
    FROM drafting_plan_unit_passages inputs
    LEFT JOIN drafting_plans plans
      ON plans.project_id = inputs.project_id AND plans.id = inputs.plan_id
    LEFT JOIN passage_plan_snapshot_items items
      ON items.snapshot_id = plans.passage_snapshot_id
      AND items.entity_kind = 'passage'
      AND items.entity_id = inputs.passage_id
      AND items.version_id = inputs.passage_plan_version_id
    WHERE plans.id IS NULL OR items.version_id IS NULL
    LIMIT 1
  `).get();
  if (invalidUnit) throw new Error("Cannot migrate drafting plans with invalid snapshot lineage");
  const invalidJob = database.prepare(`
    SELECT units.job_id
    FROM drafting_job_units units
    LEFT JOIN drafting_jobs jobs
      ON jobs.project_id = units.project_id AND jobs.id = units.job_id AND jobs.plan_id = units.plan_id
    WHERE jobs.id IS NULL
    LIMIT 1
  `).get();
  if (invalidJob) throw new Error("Cannot migrate drafting jobs with invalid job-unit lineage");
  const invalidAttempt = database.prepare(`
    SELECT attempts.id
    FROM drafting_unit_attempts attempts
    LEFT JOIN drafting_job_units units
      ON units.project_id = attempts.project_id
      AND units.job_id = attempts.job_id
      AND units.unit_id = attempts.unit_id
    WHERE units.job_id IS NULL
    LIMIT 1
  `).get();
  if (invalidAttempt) throw new Error("Cannot migrate drafting jobs with invalid attempt lineage");
}

function assertValidGeneratedDraftProvenance(database: StoryDatabase): void {
  const invalidInput = database.prepare(`
    SELECT drafts.id
    FROM passage_draft_versions drafts
    LEFT JOIN drafting_job_units job_units
      ON job_units.project_id = drafts.project_id
      AND job_units.job_id = drafts.generation_job_id
      AND job_units.plan_id = drafts.generation_plan_id
      AND job_units.unit_id = drafts.generation_unit_id
    LEFT JOIN drafting_plan_unit_passages passage_inputs
      ON passage_inputs.project_id = drafts.project_id
      AND passage_inputs.plan_id = drafts.generation_plan_id
      AND passage_inputs.unit_id = drafts.generation_unit_id
      AND passage_inputs.passage_id = drafts.passage_id
      AND passage_inputs.passage_plan_version_id = drafts.based_on_passage_plan_version_id
    WHERE drafts.generation_plan_id IS NOT NULL
      AND (job_units.job_id IS NULL OR passage_inputs.passage_id IS NULL)
    LIMIT 1
  `).get();
  if (invalidInput) throw new Error("Cannot migrate passage drafts with invalid generation input provenance");

  const generated = database.prepare(`
    SELECT drafts.id, plans.upstream_versions_json
    FROM passage_draft_versions drafts
    JOIN drafting_plans plans
      ON plans.project_id = drafts.project_id AND plans.id = drafts.generation_plan_id
    WHERE drafts.generation_plan_id IS NOT NULL
    ORDER BY drafts.id
  `).all() as Array<{ id: string; upstream_versions_json: string }>;
  const dependencies = database.prepare(`
    SELECT artifact_id, artifact_version_id
    FROM passage_draft_upstream_artifacts
    WHERE draft_version_id = ? ORDER BY artifact_id
  `);
  for (const draft of generated) {
    const rows = dependencies.all(draft.id) as Array<{ artifact_id: string; artifact_version_id: string }>;
    const actual = Object.fromEntries(rows.map((row) => [row.artifact_id, row.artifact_version_id]));
    if (canonicalRecordJson(JSON.parse(draft.upstream_versions_json)) !== canonicalRecordJson(actual)) {
      throw new Error("Cannot migrate passage drafts with invalid generation upstream provenance");
    }
  }
}

function assertValidDraftingGenerationLineage(database: StoryDatabase): void {
  const invalidOutput = database.prepare(`
    SELECT outputs.id
    FROM drafting_unit_outputs outputs
    LEFT JOIN drafting_job_units job_units
      ON job_units.project_id = outputs.project_id AND job_units.job_id = outputs.job_id
        AND job_units.plan_id = outputs.plan_id AND job_units.unit_id = outputs.unit_id
    LEFT JOIN drafting_plan_units plan_units
      ON plan_units.project_id = outputs.project_id AND plan_units.plan_id = outputs.plan_id
        AND plan_units.unit_id = outputs.unit_id
    LEFT JOIN drafting_unit_attempts attempts
      ON attempts.project_id = outputs.project_id AND attempts.id = outputs.attempt_id
        AND attempts.job_id = outputs.job_id AND attempts.unit_id = outputs.unit_id
    LEFT JOIN drafting_plans plans
      ON plans.project_id = outputs.project_id AND plans.id = outputs.plan_id
    WHERE job_units.job_id IS NULL OR plan_units.unit_id IS NULL OR attempts.id IS NULL OR plans.id IS NULL
      OR outputs.input_fingerprint != plan_units.input_fingerprint
      OR outputs.input_fingerprint != attempts.input_fingerprint
      OR outputs.context_fingerprint != plan_units.context_fingerprint
      OR outputs.provider_id != plans.provider_id OR outputs.model_id != plans.model_id
      OR outputs.execution_policy_id != plans.execution_policy_id
    LIMIT 1
  `).get();
  if (invalidOutput) throw new Error("Cannot migrate drafting outputs with invalid execution lineage");
  const invalidCandidate = database.prepare(`
    SELECT provenance.draft_version_id
    FROM passage_draft_generation_provenance provenance
    LEFT JOIN passage_draft_versions drafts
      ON drafts.project_id = provenance.project_id AND drafts.id = provenance.draft_version_id
        AND drafts.passage_id = provenance.passage_id
    LEFT JOIN drafting_unit_outputs outputs
      ON outputs.project_id = provenance.project_id AND outputs.id = provenance.output_id
    LEFT JOIN drafting_plan_unit_passages inputs
      ON inputs.project_id = provenance.project_id AND inputs.plan_id = provenance.plan_id
        AND inputs.unit_id = provenance.unit_id AND inputs.passage_id = provenance.passage_id
        AND inputs.passage_plan_version_id = provenance.passage_plan_version_id
    WHERE drafts.id IS NULL OR outputs.id IS NULL OR inputs.passage_id IS NULL
      OR drafts.source_kind != 'generated'
      OR drafts.generation_plan_id != provenance.plan_id
      OR drafts.generation_job_id != provenance.job_id
      OR drafts.generation_unit_id != provenance.unit_id
      OR outputs.attempt_id != provenance.attempt_id
      OR outputs.context_fingerprint != provenance.context_fingerprint
    LIMIT 1
  `).get();
  if (invalidCandidate) throw new Error("Cannot migrate generated passage candidates with invalid provenance");
}

function canonicalRecordJson(value: Record<string, unknown>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))));
}

function addColumn(database: StoryDatabase, table: string, column: string, definition: string): void {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
