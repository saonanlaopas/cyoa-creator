import type { StoryDatabase } from "./database.js";
import {
  RepairApplicationRecordSchema,
  RepairDraftProvenanceSchema,
  RepairProposalRecordSchema,
} from "@story-to-cyoa/domain";
import {
  generationCandidateLineageMigrationSql,
  generationJobParentLineageTriggerSql,
  generationKernelMigrationSql,
  generationLineageMigrationSql,
  passagePlanningCandidatesMigrationSql,
  passageDraftArchitectureMigrationSql,
  passageDraftAcceptanceMigrationSql,
  repairApplicationMigrationSql,
  repairDraftProvenanceLineageMigrationSql,
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
  const passageDraftAcceptanceApplied = database.prepare(
    "SELECT version FROM schema_migrations WHERE version = 13",
  ).get();
  if (!passageDraftAcceptanceApplied) {
    database.exec("BEGIN IMMEDIATE");
    try {
      assertValidPassageDraftLineage(database);
      assertValidDraftingGenerationLineage(database);
      database.exec(passageDraftAcceptanceMigrationSql);
      assertValidPassageDraftAcceptanceLineage(database);
      database.prepare(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (13, ?)",
      ).run(new Date().toISOString());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  const repairApplicationApplied = database.prepare(
    "SELECT version FROM schema_migrations WHERE version = 14",
  ).get();
  if (!repairApplicationApplied) {
    database.exec("BEGIN IMMEDIATE");
    try {
      assertValidRepairApplicationLineage(database);
      database.exec(repairApplicationMigrationSql);
      assertValidRepairApplicationLineage(database);
      database.prepare(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (14, ?)",
      ).run(new Date().toISOString());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  const repairDraftProvenanceApplied = database.prepare(
    "SELECT version FROM schema_migrations WHERE version = 15",
  ).get();
  if (!repairDraftProvenanceApplied) {
    database.exec("BEGIN IMMEDIATE");
    try {
      assertValidRepairDraftProvenance(database);
      database.exec(repairDraftProvenanceLineageMigrationSql);
      assertValidRepairDraftProvenance(database);
      database.prepare(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (15, ?)",
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
