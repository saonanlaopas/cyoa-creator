import type { StoryDatabase } from "./database.js";
import {
  RepairApplicationRecordSchema,
  RepairDraftProvenanceSchema,
  RepairProposalRecordSchema,
} from "@story-to-cyoa/domain";
import {
  artifactApprovalHistoryMigrationSql,
  artifactApprovalHistoryIntegrityTriggerSql,
  authorMemoryMigrationSql,
  authorMemoryIntegrityTriggerSql,
  generationCandidateLineageMigrationSql,
  generationJobParentLineageTriggerSql,
  generationKernelMigrationSql,
  generationLineageMigrationSql,
  passagePlanningCandidatesMigrationSql,
  passageDraftArchitectureMigrationSql,
  passageDraftAcceptanceMigrationSql,
  repairApplicationMigrationSql,
  repairDraftProvenanceLineageMigrationSql,
  recoveryMetadataIntegrityTriggerSql,
  recoveryMetadataMigrationSql,
  passageDraftGenerationMigrationSql,
  passageDraftProvenanceMigrationSql,
  passageProposalMigrationSql,
  schemaSql,
} from "./schema.js";

export const EARLIEST_SUPPORTED_SCHEMA_VERSION = 4;
export const CURRENT_SCHEMA_VERSION = 18;

export const SCHEMA_VERSION_HISTORY = Object.freeze([
  { version: 4, introducedBy: "Foundations 1-3 baseline", frozenFixture: "schema-v4.sqlite" },
  { version: 5, introducedBy: "Foundation 4A generation kernel", frozenFixture: "schema-v5.sqlite" },
  { version: 6, introducedBy: "Foundation 4A job-unit lineage", frozenFixture: "schema-v6.sqlite" },
  { version: 7, introducedBy: "Foundation 4A generation candidates", frozenFixture: "schema-v7.sqlite" },
  { version: 8, introducedBy: "Foundation 4A candidate lineage", frozenFixture: "schema-v8.sqlite" },
  { version: 9, introducedBy: "Foundation 4A proposal application", frozenFixture: "schema-v9.sqlite" },
  { version: 10, introducedBy: "Foundation 4B draft architecture", frozenFixture: "schema-v10.sqlite" },
  { version: 11, introducedBy: "Foundation 4B draft provenance", frozenFixture: "schema-v11.sqlite" },
  { version: 12, introducedBy: "Foundation 4B generated draft outputs", frozenFixture: "schema-v12.sqlite" },
  { version: 13, introducedBy: "Foundation 4B draft acceptance", frozenFixture: "schema-v13.sqlite" },
  { version: 14, introducedBy: "Foundation 6 repair applications", frozenFixture: "schema-v14.sqlite" },
  { version: 15, introducedBy: "Foundation 6 repair-draft provenance", frozenFixture: "schema-v15.sqlite" },
  { version: 16, introducedBy: "Foundation 8A recovery metadata", frozenFixture: "schema-v16.sqlite" },
  { version: 17, introducedBy: "Foundation 8C author memory", frozenFixture: "schema-v17.sqlite" },
  { version: 18, introducedBy: "A1 durable artifact approval history", frozenFixture: null },
] as const);

export function migrate(database: StoryDatabase): void {
  assertSupportedDatabaseVersion(database);
  database.exec("PRAGMA foreign_keys = ON; BEGIN IMMEDIATE");
  try {
    migrateWithinTransaction(database);
    database.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`);
    database.exec("COMMIT");
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* Preserve the migration failure. */ }
    throw error;
  }
}

function migrateWithinTransaction(database: StoryDatabase): void {
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
    runMigrationStep(database, "migration_v5", () => {
      database.exec(generationKernelMigrationSql);
      database.prepare(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (5, ?)",
      ).run(new Date().toISOString());
    });
  }
  const generationLineageApplied = database.prepare(
    "SELECT version FROM schema_migrations WHERE version = 6",
  ).get();
  if (!generationLineageApplied) {
    runMigrationStep(database, "migration_v6", () => {
      assertValidGenerationJobUnitLineage(database);
      database.exec(generationLineageMigrationSql);
      database.prepare(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (6, ?)",
      ).run(new Date().toISOString());
    });
  } else if (!hasTrigger(database, "generation_jobs_lineage_update")) {
    runMigrationStep(database, "migration_v6_parent_lineage_patch", () => {
      assertValidGenerationJobUnitLineage(database);
      database.exec(generationJobParentLineageTriggerSql);
    });
  }
  const passagePlanningCandidatesApplied = database.prepare(
    "SELECT version FROM schema_migrations WHERE version = 7",
  ).get();
  if (!passagePlanningCandidatesApplied) {
    runMigrationStep(database, "migration_v7", () => {
      database.exec(passagePlanningCandidatesMigrationSql);
      database.prepare(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (7, ?)",
      ).run(new Date().toISOString());
    });
  }
  const generationCandidateLineageApplied = database.prepare(
    "SELECT version FROM schema_migrations WHERE version = 8",
  ).get();
  if (!generationCandidateLineageApplied) {
    runMigrationStep(database, "migration_v8", () => {
      assertValidGenerationCandidateLineage(database);
      database.exec(generationCandidateLineageMigrationSql);
      database.prepare(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (8, ?)",
      ).run(new Date().toISOString());
    });
  }
  const passageProposalApplied = database.prepare(
    "SELECT version FROM schema_migrations WHERE version = 9",
  ).get();
  if (!passageProposalApplied) {
    runMigrationStep(database, "migration_v9", () => {
      assertValidGenerationCandidateLineage(database);
      database.exec(passageProposalMigrationSql);
      database.prepare(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (9, ?)",
      ).run(new Date().toISOString());
    });
  }
  const passageDraftArchitectureApplied = database.prepare(
    "SELECT version FROM schema_migrations WHERE version = 10",
  ).get();
  if (!passageDraftArchitectureApplied) {
    runMigrationStep(database, "migration_v10", () => {
      if (hasTable(database, "passage_draft_versions")) assertValidPassageDraftLineage(database);
      database.exec(passageDraftArchitectureMigrationSql);
      assertValidPassageDraftLineage(database);
      database.prepare(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (10, ?)",
      ).run(new Date().toISOString());
    });
  }
  const passageDraftProvenanceApplied = database.prepare(
    "SELECT version FROM schema_migrations WHERE version = 11",
  ).get();
  if (!passageDraftProvenanceApplied) {
    runMigrationStep(database, "migration_v11", () => {
      assertValidGeneratedDraftProvenance(database);
      database.exec(passageDraftProvenanceMigrationSql);
      assertValidGeneratedDraftProvenance(database);
      database.prepare(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (11, ?)",
      ).run(new Date().toISOString());
    });
  }
  const passageDraftGenerationApplied = database.prepare(
    "SELECT version FROM schema_migrations WHERE version = 12",
  ).get();
  if (!passageDraftGenerationApplied) {
    runMigrationStep(database, "migration_v12", () => {
      assertValidPassageDraftLineage(database);
      assertValidGeneratedDraftProvenance(database);
      database.exec(passageDraftGenerationMigrationSql);
      assertValidDraftingGenerationLineage(database);
      database.prepare(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (12, ?)",
      ).run(new Date().toISOString());
    });
  }
  const passageDraftAcceptanceApplied = database.prepare(
    "SELECT version FROM schema_migrations WHERE version = 13",
  ).get();
  if (!passageDraftAcceptanceApplied) {
    runMigrationStep(database, "migration_v13", () => {
      assertValidPassageDraftLineage(database);
      assertValidDraftingGenerationLineage(database);
      database.exec(passageDraftAcceptanceMigrationSql);
      assertValidPassageDraftAcceptanceLineage(database);
      database.prepare(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (13, ?)",
      ).run(new Date().toISOString());
    });
  }
  const repairApplicationApplied = database.prepare(
    "SELECT version FROM schema_migrations WHERE version = 14",
  ).get();
  if (!repairApplicationApplied) {
    runMigrationStep(database, "migration_v14", () => {
      assertValidRepairApplicationLineage(database);
      database.exec(repairApplicationMigrationSql);
      assertValidRepairApplicationLineage(database);
      database.prepare(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (14, ?)",
      ).run(new Date().toISOString());
    });
  }
  const repairDraftProvenanceApplied = database.prepare(
    "SELECT version FROM schema_migrations WHERE version = 15",
  ).get();
  if (!repairDraftProvenanceApplied) {
    runMigrationStep(database, "migration_v15", () => {
      assertValidRepairDraftProvenance(database);
      database.exec(repairDraftProvenanceLineageMigrationSql);
      assertValidRepairDraftProvenance(database);
      database.prepare(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (15, ?)",
      ).run(new Date().toISOString());
    });
  }
  const recoveryMetadataApplied = database.prepare(
    "SELECT version FROM schema_migrations WHERE version = 16",
  ).get();
  if (!recoveryMetadataApplied) {
    runMigrationStep(database, "migration_v16", () => {
      database.exec(recoveryMetadataMigrationSql);
      assertValidRecoveryMetadata(database);
      database.prepare(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (16, ?)",
      ).run(new Date().toISOString());
    });
  } else {
    assertValidRecoveryMetadata(database);
    if (!hasTrigger(database, "project_backup_records_immutable_delete")
      || !hasTrigger(database, "project_restore_records_immutable_delete")
      || !hasTrigger(database, "project_restore_records_exact_backup_insert")) {
      runMigrationStep(database, "migration_v16_integrity_patch", () => {
        database.exec(recoveryMetadataIntegrityTriggerSql);
        assertValidRecoveryMetadata(database);
      });
    }
  }
  const authorMemoryApplied = database.prepare(
    "SELECT version FROM schema_migrations WHERE version = 17",
  ).get();
  if (!authorMemoryApplied) {
    runMigrationStep(database, "migration_v17", () => {
      database.exec(authorMemoryMigrationSql);
      assertValidAuthorMemory(database);
      database.prepare(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (17, ?)",
      ).run(new Date().toISOString());
    });
  } else {
    if (!AUTHOR_MEMORY_INTEGRITY_TRIGGERS.every((name) => hasTrigger(database, name))) {
      runMigrationStep(database, "migration_v17_integrity_patch", () => {
        database.exec(authorMemoryIntegrityTriggerSql);
        assertValidAuthorMemory(database);
      });
    } else {
      assertValidAuthorMemory(database);
    }
  }
  const artifactApprovalHistoryApplied = database.prepare(
    "SELECT version FROM schema_migrations WHERE version = 18",
  ).get();
  if (!artifactApprovalHistoryApplied) {
    runMigrationStep(database, "migration_v18", () => {
      database.exec(artifactApprovalHistoryMigrationSql);
      database.prepare(`INSERT OR IGNORE INTO artifact_version_approvals
        (project_id, artifact_id, version_id, approved_at)
        SELECT workflow.project_id, workflow.artifact_id, workflow.approved_version_id, workflow.updated_at
        FROM artifact_workflow_state workflow
        JOIN artifact_versions versions
          ON versions.id = workflow.approved_version_id
          AND versions.project_id = workflow.project_id
          AND versions.artifact_id = workflow.artifact_id
        WHERE workflow.approved_version_id IS NOT NULL`).run();
      database.prepare(`INSERT OR IGNORE INTO artifact_version_approvals
        (project_id, artifact_id, version_id, approved_at)
        SELECT directions.project_id,
          json_extract(records.value, '$.reference.targetId'),
          json_extract(records.value, '$.reference.versionId'),
          directions.created_at
        FROM artifact_versions directions, json_each(directions.content_json, '$.fieldProvenance') records
        JOIN artifact_versions evidence
          ON evidence.id = json_extract(records.value, '$.reference.versionId')
          AND evidence.project_id = directions.project_id
          AND evidence.artifact_id = json_extract(records.value, '$.reference.targetId')
        WHERE directions.artifact_id = 'creative-direction'
          AND directions.artifact_type = 'creative-direction'
          AND json_extract(records.value, '$.reference.kind') = 'approved-artifact'`).run();
      database.exec(artifactApprovalHistoryIntegrityTriggerSql);
      assertValidArtifactApprovalHistory(database);
      database.prepare(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (18, ?)",
      ).run(new Date().toISOString());
    });
  } else {
    if (!hasTrigger(database, "artifact_version_approvals_lineage_insert")
      || !hasTrigger(database, "artifact_version_approvals_immutable_update")) {
      database.exec(artifactApprovalHistoryIntegrityTriggerSql);
    }
    assertValidArtifactApprovalHistory(database);
  }
}

const AUTHOR_MEMORY_INTEGRITY_TRIGGERS = [
  "conversation_summary_versions_monotonic_insert",
  "pinned_decision_versions_monotonic_insert",
  "conversation_summary_heads_latest_insert",
  "conversation_summary_heads_monotonic_update",
  "pinned_decision_heads_latest_insert",
  "pinned_decision_heads_monotonic_update",
  "conversation_summary_series_immutable_update",
  "pinned_decisions_immutable_update",
  "conversation_summary_series_immutable_delete",
  "conversation_summary_versions_immutable_delete",
  "conversation_summary_heads_immutable_delete",
  "pinned_decisions_immutable_delete",
  "pinned_decision_versions_immutable_delete",
  "pinned_decision_heads_immutable_delete",
  "messages_author_memory_size_insert",
] as const;

function runMigrationStep(database: StoryDatabase, name: string, operation: () => void): void {
  database.exec(`SAVEPOINT ${name}`);
  try {
    operation();
    database.exec(`RELEASE SAVEPOINT ${name}`);
  } catch (error) {
    try {
      database.exec(`ROLLBACK TO SAVEPOINT ${name}`);
      database.exec(`RELEASE SAVEPOINT ${name}`);
    } catch {
      // Preserve the original migration failure for the outer transaction.
    }
    throw error;
  }
}

export function databaseSchemaVersion(database: StoryDatabase): number {
  if (!hasTable(database, "schema_migrations")) return 0;
  const row = database.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get() as { version: number };
  return row.version;
}

function assertSupportedDatabaseVersion(database: StoryDatabase): void {
  const userVersion = (database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  const migrationVersion = databaseSchemaVersion(database);
  if (userVersion > CURRENT_SCHEMA_VERSION || migrationVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(`unsupported_future_schema: database schema ${Math.max(userVersion, migrationVersion)} is newer than supported ${CURRENT_SCHEMA_VERSION}`);
  }
  const userTables = database.prepare(`SELECT COUNT(*) AS count FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).get() as { count: number };
  if (userTables.count > 0 && migrationVersion > 0 && migrationVersion < EARLIEST_SUPPORTED_SCHEMA_VERSION) {
    throw new Error(`unsupported_historical_schema: database schema ${migrationVersion} is older than supported ${EARLIEST_SUPPORTED_SCHEMA_VERSION}`);
  }
  if (userTables.count > 0 && migrationVersion === 0 && !isRecognizedLegacyBootstrap(database)) {
    throw new Error("database_incompatible: existing SQLite file is not a supported CYOA Creator database");
  }
}

function isRecognizedLegacyBootstrap(database: StoryDatabase): boolean {
  const requiredColumns: Record<string, string[]> = {
    projects: ["id", "name", "archived", "created_at", "updated_at"],
    conversations: ["id", "project_id", "created_at"],
    messages: ["id", "conversation_id", "role", "content", "created_at"],
  };
  return Object.entries(requiredColumns).every(([table, required]) => {
    if (!hasTable(database, table)) return false;
    const columns = new Set((database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((item) => item.name));
    return required.every((column) => columns.has(column));
  });
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

function assertValidArtifactApprovalHistory(database: StoryDatabase): void {
  const invalid = database.prepare(`SELECT approvals.version_id
    FROM artifact_version_approvals approvals
    LEFT JOIN artifact_versions versions
      ON versions.id = approvals.version_id
      AND versions.project_id = approvals.project_id
      AND versions.artifact_id = approvals.artifact_id
    WHERE versions.id IS NULL
    LIMIT 1`).get();
  if (invalid) throw new Error("Cannot migrate artifact approval history with invalid version lineage");
}

function assertValidRecoveryMetadata(database: StoryDatabase): void {
  if (!hasTable(database, "project_backup_records") || !hasTable(database, "project_restore_records")
    || !hasTable(database, "project_recovery_state")) {
    throw new Error("Recovery metadata schema is incomplete");
  }
  const invalidBackup = database.prepare(`SELECT backups.id
    FROM project_backup_records backups
    LEFT JOIN projects ON projects.id = backups.project_id
    WHERE projects.id IS NULL
      OR backups.game_id != backups.project_id
      OR backups.portable_project_fingerprint != backups.restored_semantic_fingerprint
      OR backups.portable_project_fingerprint != backups.source_change_fingerprint
      OR json_valid(backups.verification_diagnostics_json) = 0
      OR json_type(backups.verification_diagnostics_json) != 'array'
    LIMIT 1`).get();
  if (invalidBackup) throw new Error("Cannot migrate recovery data with invalid backup metadata");
  const invalidRestore = database.prepare(`SELECT restores.id
    FROM project_restore_records restores
    LEFT JOIN projects ON projects.id = restores.project_id
    LEFT JOIN project_backup_records backups
      ON backups.id = restores.backup_id AND backups.project_id = restores.project_id
    WHERE projects.id IS NULL OR backups.id IS NULL
      OR restores.source_project_id != restores.project_id
      OR restores.portable_project_fingerprint != backups.portable_project_fingerprint
      OR restores.portable_project_fingerprint != restores.restored_semantic_fingerprint
      OR json_valid(restores.diagnostics_json) = 0
      OR json_type(restores.diagnostics_json) != 'array'
    LIMIT 1`).get();
  if (invalidRestore) throw new Error("Cannot migrate recovery data with invalid restore metadata");
  const invalidState = database.prepare(`SELECT states.project_id
    FROM project_recovery_state states
    LEFT JOIN projects ON projects.id = states.project_id
    WHERE projects.id IS NULL
      OR (states.reminder_dismissed_for_fingerprint IS NOT NULL AND length(states.reminder_dismissed_for_fingerprint) != 32)
      OR (states.last_verification_failure_fingerprint IS NOT NULL AND length(states.last_verification_failure_fingerprint) != 32)
    LIMIT 1`).get();
  if (invalidState) throw new Error("Cannot migrate recovery data with invalid reminder metadata");
}

function assertValidAuthorMemory(database: StoryDatabase): void {
  for (const table of [
    "conversation_summary_series", "conversation_summary_versions", "conversation_summary_heads",
    "pinned_decisions", "pinned_decision_versions", "pinned_decision_heads",
  ]) {
    if (!hasTable(database, table)) throw new Error("Author-memory schema is incomplete");
  }
  for (const trigger of AUTHOR_MEMORY_INTEGRITY_TRIGGERS) {
    if (!hasTrigger(database, trigger)) throw new Error("Author-memory integrity triggers are incomplete");
  }
  const invalidSummary = database.prepare(`SELECT versions.id
    FROM conversation_summary_versions versions
    LEFT JOIN conversation_summary_series series
      ON series.id = versions.series_id AND series.project_id = versions.project_id
        AND series.conversation_id = versions.conversation_id
    LEFT JOIN conversations conversations
      ON conversations.id = versions.conversation_id AND conversations.project_id = versions.project_id
    WHERE series.id IS NULL OR conversations.id IS NULL LIMIT 1`).get();
  if (invalidSummary) throw new Error("Cannot migrate author memory with invalid summary lineage");
  const invalidDecision = database.prepare(`SELECT versions.id
    FROM pinned_decision_versions versions
    LEFT JOIN pinned_decisions decisions
      ON decisions.id = versions.decision_id AND decisions.project_id = versions.project_id
    WHERE decisions.id IS NULL LIMIT 1`).get();
  if (invalidDecision) throw new Error("Cannot migrate author memory with invalid decision lineage");
  const invalidSummaryHead = database.prepare(`SELECT series.id
    FROM conversation_summary_series series
    LEFT JOIN conversation_summary_heads heads
      ON heads.series_id = series.id AND heads.project_id = series.project_id
    LEFT JOIN conversation_summary_versions current
      ON current.id = heads.current_version_id AND current.series_id = series.id
    WHERE heads.series_id IS NULL OR current.id IS NULL
      OR current.version != (SELECT MAX(latest.version) FROM conversation_summary_versions latest
        WHERE latest.series_id = series.id)
    LIMIT 1`).get();
  if (invalidSummaryHead) throw new Error("Cannot open author memory with a non-latest summary head");
  const invalidSummaryHistory = database.prepare(`WITH ordered AS (
      SELECT id, series_id, version, supersedes_version_id,
        ROW_NUMBER() OVER (PARTITION BY series_id ORDER BY version) AS expected_version,
        LAG(id) OVER (PARTITION BY series_id ORDER BY version) AS expected_previous
      FROM conversation_summary_versions
    ) SELECT id FROM ordered
    WHERE version != expected_version
      OR (version = 1 AND supersedes_version_id IS NOT NULL)
      OR (version > 1 AND supersedes_version_id IS NOT expected_previous)
    LIMIT 1`).get();
  if (invalidSummaryHistory) throw new Error("Cannot open author memory with a broken summary history");
  const invalidDecisionHead = database.prepare(`SELECT decisions.id
    FROM pinned_decisions decisions
    LEFT JOIN pinned_decision_heads heads
      ON heads.decision_id = decisions.id AND heads.project_id = decisions.project_id
    LEFT JOIN pinned_decision_versions current
      ON current.id = heads.current_version_id AND current.decision_id = decisions.id
    WHERE heads.decision_id IS NULL OR current.id IS NULL
      OR current.version != (SELECT MAX(latest.version) FROM pinned_decision_versions latest
        WHERE latest.decision_id = decisions.id)
    LIMIT 1`).get();
  if (invalidDecisionHead) throw new Error("Cannot open author memory with a non-latest decision head");
  const invalidDecisionHistory = database.prepare(`WITH ordered AS (
      SELECT id, decision_id, version, supersedes_version_id,
        ROW_NUMBER() OVER (PARTITION BY decision_id ORDER BY version) AS expected_version,
        LAG(id) OVER (PARTITION BY decision_id ORDER BY version) AS expected_previous
      FROM pinned_decision_versions
    ) SELECT id FROM ordered
    WHERE version != expected_version
      OR (version = 1 AND supersedes_version_id IS NOT NULL)
      OR (version > 1 AND supersedes_version_id IS NOT expected_previous)
    LIMIT 1`).get();
  if (invalidDecisionHistory) throw new Error("Cannot open author memory with a broken decision history");
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

function assertValidPassageDraftAcceptanceLineage(database: StoryDatabase): void {
  const invalid = database.prepare(`
    SELECT items.application_id
    FROM passage_draft_acceptance_items items
    LEFT JOIN passage_draft_acceptance_applications applications
      ON applications.project_id = items.project_id AND applications.id = items.application_id
    LEFT JOIN passage_draft_versions candidates
      ON candidates.project_id = items.project_id AND candidates.id = items.candidate_version_id
        AND candidates.passage_id = items.passage_id AND candidates.lifecycle_status = 'candidate'
    LEFT JOIN passage_draft_versions previous
      ON previous.project_id = items.project_id AND previous.id = items.previous_accepted_version_id
        AND previous.passage_id = items.passage_id
        AND previous.lifecycle_status IN ('accepted', 'reviewed', 'locked')
    LEFT JOIN passage_draft_versions results
      ON results.project_id = items.project_id AND results.id = items.resulting_accepted_version_id
        AND results.passage_id = items.passage_id AND results.lifecycle_status = 'accepted'
    WHERE applications.id IS NULL OR candidates.id IS NULL OR results.id IS NULL
      OR (items.previous_accepted_version_id IS NOT NULL AND previous.id IS NULL)
    LIMIT 1
  `).get();
  if (invalid) throw new Error("Cannot migrate passage drafts with invalid acceptance audit lineage");
}

function assertValidRepairApplicationLineage(database: StoryDatabase): void {
  if (!hasTable(database, "repair_applications")) return;
  const invalidApplication = database.prepare(`
    SELECT applications.id
    FROM repair_applications applications
    LEFT JOIN artifact_versions proposals
      ON proposals.project_id = applications.project_id
      AND proposals.id = applications.proposal_artifact_version_id
      AND proposals.artifact_type = 'repair-proposal'
    LEFT JOIN artifact_versions plans
      ON plans.project_id = applications.project_id
      AND plans.id = applications.repair_plan_artifact_version_id
      AND plans.artifact_type = 'repair-plan'
    WHERE proposals.id IS NULL OR plans.id IS NULL
      OR json_extract(proposals.content_json, '$.id') != applications.proposal_id
      OR json_extract(applications.content_json, '$.id') != applications.id
      OR json_extract(applications.content_json, '$.projectId') != applications.project_id
      OR json_extract(applications.content_json, '$.proposalArtifactVersionId') != applications.proposal_artifact_version_id
      OR json_extract(applications.content_json, '$.repairPlanArtifactVersionId') != applications.repair_plan_artifact_version_id
    LIMIT 1
  `).get();
  if (invalidApplication) throw new Error("Cannot migrate repair applications with invalid proposal lineage");
  const invalidDraft = database.prepare(`
    SELECT links.draft_version_id
    FROM repair_application_draft_links links
    LEFT JOIN repair_applications applications
      ON applications.project_id = links.project_id AND applications.id = links.application_id
    LEFT JOIN passage_draft_versions drafts
      ON drafts.project_id = links.project_id AND drafts.id = links.draft_version_id
      AND drafts.passage_id = links.passage_id AND drafts.lifecycle_status = 'candidate'
    WHERE applications.id IS NULL OR drafts.id IS NULL
      OR json_extract(links.provenance_json, '$.applicationId') != links.application_id
      OR json_extract(links.provenance_json, '$.operationId') != links.operation_id
      OR json_extract(links.provenance_json, '$.draftVersionId') != links.draft_version_id
      OR NOT EXISTS (
        SELECT 1 FROM json_each(applications.content_json, '$.operationIds')
        WHERE value = links.operation_id
      )
    LIMIT 1
  `).get();
  if (invalidDraft) throw new Error("Cannot migrate repair applications with invalid draft lineage");
  const invalidResult = database.prepare(`
    SELECT results.version_id
    FROM repair_application_result_versions results
    LEFT JOIN repair_applications applications
      ON applications.project_id = results.project_id AND applications.id = results.application_id
    WHERE applications.id IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM json_each(applications.content_json, '$.resultingVersions') items
        WHERE json_extract(items.value, '$.operationId') = results.operation_id
          AND json_extract(items.value, '$.entityKind') = results.entity_kind
          AND json_extract(items.value, '$.entityId') = results.entity_id
          AND json_extract(items.value, '$.versionId') = results.version_id
      )
    LIMIT 1
  `).get();
  if (invalidResult) throw new Error("Cannot migrate repair applications with invalid result lineage");
}

function assertValidRepairDraftProvenance(database: StoryDatabase): void {
  if (!hasTable(database, "repair_application_draft_links")) return;
  const rows = database.prepare(`SELECT
      links.project_id, links.application_id, links.operation_id, links.passage_id,
      links.draft_version_id, links.provenance_json,
      applications.content_json AS application_json,
      proposals.content_json AS proposal_json,
      drafts.based_on_passage_plan_version_id, drafts.prose_markdown,
      drafts.lifecycle_status, drafts.source_kind
    FROM repair_application_draft_links links
    LEFT JOIN repair_applications applications
      ON applications.project_id = links.project_id AND applications.id = links.application_id
    LEFT JOIN artifact_versions proposals
      ON proposals.project_id = links.project_id
      AND proposals.id = applications.proposal_artifact_version_id
      AND proposals.artifact_type = 'repair-proposal'
    LEFT JOIN passage_draft_versions drafts
      ON drafts.project_id = links.project_id AND drafts.id = links.draft_version_id
      AND drafts.passage_id = links.passage_id`)
    .all() as Array<{
      project_id: string; application_id: string; operation_id: string; passage_id: string;
      draft_version_id: string; provenance_json: string; application_json: string | null;
      proposal_json: string | null; based_on_passage_plan_version_id: string | null;
      prose_markdown: string | null; lifecycle_status: string | null; source_kind: string | null;
    }>;
  for (const row of rows) {
    try {
      if (!row.application_json || !row.proposal_json || !row.based_on_passage_plan_version_id) throw new Error("missing lineage row");
      const application = RepairApplicationRecordSchema.parse(JSON.parse(row.application_json));
      const proposal = RepairProposalRecordSchema.parse(JSON.parse(row.proposal_json));
      const storedProvenance = JSON.parse(row.provenance_json) as Record<string, unknown>;
      const provenance = RepairDraftProvenanceSchema.parse({
        ...storedProvenance,
        passageId: storedProvenance.passageId ?? row.passage_id,
      });
      const operation = proposal.operations.find((item) => item.id === row.operation_id);
      const passageResult = application.resultingVersions.find((item) => item.entityKind === "passage" && item.entityId === row.passage_id);
      const effectivePassagePlanBaseVersionId = passageResult?.versionId
        ?? (operation?.expectedBase?.kind === "passage-prose-head" ? operation.expectedBase.passagePlanVersionId : null);
      if (!operation || operation.kind !== "create-passage-draft-candidate" || operation.expectedBase.kind !== "passage-prose-head"
        || application.id !== row.application_id || application.projectId !== row.project_id
        || application.proposalId !== proposal.id || application.proposalArtifactVersionId !== provenance.proposalArtifactVersionId
        || provenance.applicationId !== application.id
        || provenance.applicationDefinitionFingerprint !== application.definitionFingerprint
        || provenance.proposalId !== application.proposalId
        || provenance.proposalDefinitionFingerprint !== application.proposalDefinitionFingerprint
        || provenance.repairPlanId !== application.repairPlanId
        || provenance.repairPlanArtifactVersionId !== application.repairPlanArtifactVersionId
        || provenance.repairPlanDefinitionFingerprint !== application.repairPlanDefinitionFingerprint
        || provenance.operationId !== operation.id || provenance.passageId !== row.passage_id
        || provenance.draftVersionId !== row.draft_version_id
        || JSON.stringify(provenance.sourceFindingFingerprints) !== JSON.stringify(operation.sourceFindingFingerprints)
        || provenance.passagePlanBaseVersionId !== effectivePassagePlanBaseVersionId
        || provenance.expectedCurrentDraftVersionId !== operation.expectedBase.currentDraftVersionId
        || provenance.expectedAcceptedDraftVersionId !== operation.expectedBase.acceptedDraftVersionId
        || canonicalRecordJson(provenance.upstreamVersions) !== canonicalRecordJson(operation.expectedBase.upstreamVersions)
        || canonicalRecordJson(provenance.neighboringDraftVersions) !== canonicalRecordJson(operation.expectedBase.neighboringDraftVersions)
        || row.lifecycle_status !== "candidate" || row.source_kind !== "manual"
        || row.based_on_passage_plan_version_id !== provenance.passagePlanBaseVersionId
        || row.prose_markdown !== operation.after.proposedProse
        || canonicalRecordJson(draftUpstreamVersions(database, row.project_id, row.draft_version_id)) !== canonicalRecordJson(provenance.upstreamVersions)
        || canonicalRecordJson(draftNeighborVersions(database, row.project_id, row.draft_version_id)) !== canonicalRecordJson(provenance.neighboringDraftVersions)) {
        throw new Error("lineage mismatch");
      }
    } catch (error) {
      throw new Error("Cannot migrate repair drafts with invalid exact provenance", { cause: error });
    }
  }
}

function draftUpstreamVersions(database: StoryDatabase, projectId: string, draftVersionId: string): Record<string, string> {
  const rows = database.prepare(`SELECT artifact_id, artifact_version_id FROM passage_draft_upstream_artifacts
    WHERE project_id = ? AND draft_version_id = ? ORDER BY artifact_id`).all(projectId, draftVersionId) as Array<{ artifact_id: string; artifact_version_id: string }>;
  return Object.fromEntries(rows.map((row) => [row.artifact_id, row.artifact_version_id]));
}

function draftNeighborVersions(database: StoryDatabase, projectId: string, draftVersionId: string): Record<string, string> {
  const rows = database.prepare(`SELECT neighbor_passage_id, neighbor_draft_version_id FROM passage_draft_neighbor_versions
    WHERE project_id = ? AND draft_version_id = ? ORDER BY neighbor_passage_id`).all(projectId, draftVersionId) as Array<{ neighbor_passage_id: string; neighbor_draft_version_id: string }>;
  return Object.fromEntries(rows.map((row) => [row.neighbor_passage_id, row.neighbor_draft_version_id]));
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
