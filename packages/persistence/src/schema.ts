export const schemaSql = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'quick' CHECK(mode IN ('quick', 'long-form')),
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS source_manifests (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  body_path TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS artifact_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  artifact_id TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  version INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  content_json TEXT NOT NULL,
  stale INTEGER NOT NULL DEFAULT 0,
  restored_from_version_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, artifact_id, version)
);
CREATE INDEX IF NOT EXISTS artifact_versions_lookup
  ON artifact_versions(project_id, artifact_id, version DESC);
CREATE TABLE IF NOT EXISTS artifact_workflow_state (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  artifact_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('empty', 'draft', 'reviewed', 'approved', 'stale')),
  approved_version_id TEXT REFERENCES artifact_versions(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(project_id, artifact_id)
);
CREATE TABLE IF NOT EXISTS artifact_dependencies (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  upstream_artifact_id TEXT NOT NULL,
  dependent_artifact_id TEXT NOT NULL,
  PRIMARY KEY(project_id, upstream_artifact_id, dependent_artifact_id)
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  checkpoint_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS job_units (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  unit_key TEXT NOT NULL,
  status TEXT NOT NULL,
  checkpoint_json TEXT,
  UNIQUE(job_id, unit_key)
);
CREATE TABLE IF NOT EXISTS usage_records (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  prompt_tokens INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  cost REAL NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Project discussion',
  scope_json TEXT NOT NULL DEFAULT '{}',
  summary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  intent TEXT NOT NULL DEFAULT 'discuss',
  scope_json TEXT NOT NULL DEFAULT '{}',
  context_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_conversation_order
  ON messages(conversation_id, created_at, id);
CREATE TABLE IF NOT EXISTS change_sets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  artifact_id TEXT NOT NULL,
  base_version_id TEXT NOT NULL REFERENCES artifact_versions(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK(status IN ('proposed', 'applied', 'rejected', 'superseded')),
  summary TEXT NOT NULL,
  rationale TEXT NOT NULL,
  candidate_json TEXT NOT NULL,
  proposal_json TEXT,
  validation_json TEXT NOT NULL DEFAULT '[]',
  invalidations_json TEXT NOT NULL DEFAULT '[]',
  applied_version_id TEXT REFERENCES artifact_versions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS change_sets_conversation_order
  ON change_sets(conversation_id, created_at, id);
CREATE TABLE IF NOT EXISTS instruction_commands (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK(scope IN ('global', 'project')),
  name TEXT NOT NULL,
  instruction TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((scope = 'global' AND project_id IS NULL) OR (scope = 'project' AND project_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS instruction_commands_scope_order
  ON instruction_commands(scope, project_id, position, created_at);
CREATE TABLE IF NOT EXISTS passage_structure_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content_json TEXT NOT NULL,
  restored_from_version_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, version)
);
CREATE TABLE IF NOT EXISTS passage_structure_heads (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES passage_structure_versions(id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS passage_entity_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  entity_kind TEXT NOT NULL CHECK(entity_kind IN ('passage', 'choice', 'thread')),
  entity_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  content_json TEXT NOT NULL,
  restored_from_version_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, entity_kind, entity_id, version)
);
CREATE INDEX IF NOT EXISTS passage_entity_versions_lookup
  ON passage_entity_versions(project_id, entity_kind, entity_id, version DESC);
CREATE TABLE IF NOT EXISTS passage_entity_heads (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  entity_kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  version_id TEXT NOT NULL REFERENCES passage_entity_versions(id) ON DELETE RESTRICT,
  tombstoned INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(project_id, entity_kind, entity_id)
);
CREATE TABLE IF NOT EXISTS passage_plan_snapshots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  structure_version_id TEXT NOT NULL REFERENCES passage_structure_versions(id) ON DELETE RESTRICT,
  upstream_versions_json TEXT NOT NULL,
  validation_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft', 'approved')),
  created_at TEXT NOT NULL,
  UNIQUE(project_id, version)
);
CREATE TABLE IF NOT EXISTS passage_plan_snapshot_items (
  snapshot_id TEXT NOT NULL REFERENCES passage_plan_snapshots(id) ON DELETE CASCADE,
  entity_kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  version_id TEXT NOT NULL REFERENCES passage_entity_versions(id) ON DELETE RESTRICT,
  PRIMARY KEY(snapshot_id, entity_kind, entity_id)
);
CREATE TABLE IF NOT EXISTS passage_plan_state (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('empty', 'draft', 'approved', 'stale')),
  approved_snapshot_id TEXT REFERENCES passage_plan_snapshots(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS passage_finding_overrides (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  rationale TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(project_id, code, entity_id)
);
`;

export const artifactChain = ["source", "bible", "adaptation", "routes", "drafts", "review", "export"] as const;

export const generationKernelMigrationSql = `
CREATE UNIQUE INDEX IF NOT EXISTS passage_plan_snapshots_project_identity
  ON passage_plan_snapshots(project_id, id);

CREATE TABLE generation_plans (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  passage_snapshot_id TEXT NOT NULL,
  structure_version_id TEXT NOT NULL,
  upstream_versions_json TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  estimated_input_tokens INTEGER NOT NULL CHECK(estimated_input_tokens >= 0),
  estimated_output_tokens INTEGER NOT NULL CHECK(estimated_output_tokens >= 0),
  cost_estimate_json TEXT NOT NULL,
  validation_stages_json TEXT NOT NULL,
  execution_policy_id TEXT NOT NULL,
  execution_policy_json TEXT NOT NULL,
  authorization_state TEXT NOT NULL CHECK(authorization_state IN ('planned', 'authorized')),
  authorization_fingerprint TEXT,
  authorized_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, id),
  FOREIGN KEY(project_id, passage_snapshot_id)
    REFERENCES passage_plan_snapshots(project_id, id) ON DELETE RESTRICT
);
CREATE INDEX generation_plans_project_created
  ON generation_plans(project_id, created_at DESC);

CREATE TABLE generation_plan_units (
  plan_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK(position >= 0),
  sequence_id TEXT NOT NULL,
  passage_ids_json TEXT NOT NULL,
  passage_version_ids_json TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  estimated_input_tokens INTEGER NOT NULL CHECK(estimated_input_tokens >= 0),
  estimated_output_tokens INTEGER NOT NULL CHECK(estimated_output_tokens >= 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY(plan_id, unit_id),
  UNIQUE(plan_id, position),
  UNIQUE(project_id, plan_id, unit_id),
  FOREIGN KEY(project_id, plan_id) REFERENCES generation_plans(project_id, id) ON DELETE CASCADE
);

CREATE TABLE generation_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL UNIQUE,
  plan_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('planned', 'authorized', 'running', 'completed', 'partially_failed', 'failed', 'cancelled')),
  execution_policy_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  authorized_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, id),
  FOREIGN KEY(project_id, plan_id) REFERENCES generation_plans(project_id, id) ON DELETE CASCADE
);

CREATE TABLE generation_job_units (
  job_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  attempt_number INTEGER NOT NULL DEFAULT 0 CHECK(attempt_number >= 0),
  retry_of_attempt_id TEXT,
  normalized_error_json TEXT,
  usage_json TEXT,
  input_fingerprint TEXT NOT NULL,
  execution_policy_id TEXT NOT NULL,
  candidate_reference TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(job_id, unit_id),
  UNIQUE(project_id, job_id, unit_id),
  FOREIGN KEY(project_id, job_id) REFERENCES generation_jobs(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, plan_id, unit_id)
    REFERENCES generation_plan_units(project_id, plan_id, unit_id) ON DELETE CASCADE
);

CREATE TABLE generation_unit_attempts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK(attempt_number > 0),
  retry_of_attempt_id TEXT REFERENCES generation_unit_attempts(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  normalized_error_json TEXT,
  usage_json TEXT,
  input_fingerprint TEXT NOT NULL,
  execution_policy_id TEXT NOT NULL,
  candidate_reference TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(job_id, unit_id, attempt_number),
  FOREIGN KEY(project_id, job_id, unit_id)
    REFERENCES generation_job_units(project_id, job_id, unit_id) ON DELETE CASCADE
);
`;

export const generationJobParentLineageTriggerSql = `
CREATE TRIGGER IF NOT EXISTS generation_jobs_lineage_update
BEFORE UPDATE OF project_id, id, plan_id ON generation_jobs
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM generation_job_units
  WHERE project_id = OLD.project_id AND job_id = OLD.id
    AND (project_id != NEW.project_id OR job_id != NEW.id OR plan_id != NEW.plan_id)
)
BEGIN
  SELECT RAISE(ABORT, 'Generation job lineage update would orphan attached units');
END;
`;

export const generationLineageMigrationSql = `
CREATE TRIGGER generation_job_units_lineage_insert
BEFORE INSERT ON generation_job_units
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM generation_jobs
  WHERE project_id = NEW.project_id AND id = NEW.job_id AND plan_id = NEW.plan_id
)
BEGIN
  SELECT RAISE(ABORT, 'Generation job unit lineage mismatch');
END;

CREATE TRIGGER generation_job_units_lineage_update
BEFORE UPDATE OF project_id, job_id, plan_id ON generation_job_units
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM generation_jobs
  WHERE project_id = NEW.project_id AND id = NEW.job_id AND plan_id = NEW.plan_id
)
BEGIN
  SELECT RAISE(ABORT, 'Generation job unit lineage mismatch');
END;

${generationJobParentLineageTriggerSql}
`;

export const passagePlanningCandidatesMigrationSql = `
ALTER TABLE generation_plan_units ADD COLUMN context_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE generation_plan_units ADD COLUMN context_diagnostics_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE generation_plan_units ADD COLUMN context_fingerprint TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX generation_unit_attempts_lineage_identity
  ON generation_unit_attempts(project_id, id, job_id, unit_id);

CREATE TABLE generation_unit_candidates (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  context_fingerprint TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  execution_policy_id TEXT NOT NULL,
  output_schema_id TEXT NOT NULL,
  output_schema_version INTEGER NOT NULL CHECK(output_schema_version > 0),
  content_json TEXT NOT NULL,
  validation_json TEXT NOT NULL,
  usage_json TEXT,
  repair_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, id),
  UNIQUE(attempt_id),
  FOREIGN KEY(project_id, plan_id, unit_id)
    REFERENCES generation_plan_units(project_id, plan_id, unit_id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, job_id, unit_id)
    REFERENCES generation_job_units(project_id, job_id, unit_id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, attempt_id, job_id, unit_id)
    REFERENCES generation_unit_attempts(project_id, id, job_id, unit_id) ON DELETE CASCADE
);
CREATE INDEX generation_unit_candidates_job_order
  ON generation_unit_candidates(project_id, job_id, unit_id, created_at);

CREATE TRIGGER generation_unit_candidates_immutable_update
BEFORE UPDATE ON generation_unit_candidates
BEGIN
  SELECT RAISE(ABORT, 'Generation unit candidates are immutable');
END;

CREATE TRIGGER generation_plan_unit_context_immutable
BEFORE UPDATE OF context_json, context_diagnostics_json, context_fingerprint ON generation_plan_units
BEGIN
  SELECT RAISE(ABORT, 'Generation plan unit context is immutable');
END;

CREATE TRIGGER generation_unit_candidates_immutable_delete
BEFORE DELETE ON generation_unit_candidates
WHEN EXISTS (SELECT 1 FROM generation_jobs WHERE project_id = OLD.project_id AND id = OLD.job_id)
BEGIN
  SELECT RAISE(ABORT, 'Generation unit candidates are append-only');
END;
`;

export const generationCandidateLineageMigrationSql = `
CREATE TRIGGER generation_unit_candidates_lineage_insert
BEFORE INSERT ON generation_unit_candidates
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM generation_job_units units
  JOIN generation_jobs jobs
    ON jobs.project_id = units.project_id
    AND jobs.id = units.job_id
    AND jobs.plan_id = units.plan_id
  WHERE units.project_id = NEW.project_id
    AND units.job_id = NEW.job_id
    AND units.plan_id = NEW.plan_id
    AND units.unit_id = NEW.unit_id
)
BEGIN
  SELECT RAISE(ABORT, 'Generation unit candidate lineage mismatch');
END;
`;

export const passageProposalMigrationSql = `
CREATE TABLE passage_proposal_sets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  generation_plan_id TEXT NOT NULL,
  generation_job_id TEXT NOT NULL,
  generation_plan_fingerprint TEXT NOT NULL,
  passage_snapshot_id TEXT NOT NULL,
  proposal_schema_id TEXT NOT NULL,
  proposal_schema_version INTEGER NOT NULL CHECK(proposal_schema_version > 0),
  candidate_ids_json TEXT NOT NULL,
  candidate_provenance_json TEXT NOT NULL,
  consolidation_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('proposed', 'applied', 'rejected', 'stale')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, id),
  UNIQUE(project_id, generation_job_id),
  FOREIGN KEY(project_id, generation_plan_id)
    REFERENCES generation_plans(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, generation_job_id)
    REFERENCES generation_jobs(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, passage_snapshot_id)
    REFERENCES passage_plan_snapshots(project_id, id) ON DELETE RESTRICT
);

CREATE TABLE passage_proposal_candidates (
  proposal_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  generation_job_id TEXT NOT NULL,
  generation_unit_id TEXT NOT NULL,
  unit_position INTEGER NOT NULL CHECK(unit_position >= 0),
  attempt_id TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  context_fingerprint TEXT NOT NULL,
  candidate_fingerprint TEXT NOT NULL,
  PRIMARY KEY(proposal_id, candidate_id),
  FOREIGN KEY(project_id, proposal_id)
    REFERENCES passage_proposal_sets(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, candidate_id)
    REFERENCES generation_unit_candidates(project_id, id) ON DELETE RESTRICT
);

CREATE TABLE passage_proposal_groups (
  proposal_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK(position >= 0),
  generation_unit_id TEXT NOT NULL,
  label TEXT NOT NULL,
  summary TEXT NOT NULL,
  operation_ids_json TEXT NOT NULL,
  depends_on_group_ids_json TEXT NOT NULL,
  affected_entity_ids_json TEXT NOT NULL,
  downstream_invalidations_json TEXT NOT NULL,
  validation_finding_ids_json TEXT NOT NULL,
  safe_independently INTEGER NOT NULL CHECK(safe_independently IN (0, 1)),
  status TEXT NOT NULL CHECK(status IN ('proposed', 'applied', 'rejected', 'stale')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(proposal_id, id),
  UNIQUE(project_id, proposal_id, id),
  FOREIGN KEY(project_id, proposal_id)
    REFERENCES passage_proposal_sets(project_id, id) ON DELETE CASCADE
);

CREATE TABLE passage_proposal_operations (
  proposal_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK(position >= 0),
  operation_kind TEXT NOT NULL CHECK(operation_kind IN ('add-entity', 'update-entity')),
  entity_kind TEXT NOT NULL CHECK(entity_kind IN ('passage', 'choice', 'thread')),
  entity_id TEXT NOT NULL,
  base_version_id TEXT,
  before_json TEXT,
  after_json TEXT NOT NULL,
  field_diffs_json TEXT NOT NULL,
  source_candidate_ids_json TEXT NOT NULL,
  PRIMARY KEY(proposal_id, id),
  UNIQUE(project_id, proposal_id, id),
  FOREIGN KEY(project_id, proposal_id, group_id)
    REFERENCES passage_proposal_groups(project_id, proposal_id, id) ON DELETE CASCADE,
  FOREIGN KEY(base_version_id) REFERENCES passage_entity_versions(id) ON DELETE RESTRICT,
  CHECK((operation_kind = 'add-entity' AND base_version_id IS NULL AND before_json IS NULL)
    OR (operation_kind = 'update-entity' AND base_version_id IS NOT NULL AND before_json IS NOT NULL))
);

CREATE TABLE passage_proposal_previews (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  selected_group_ids_json TEXT NOT NULL,
  selected_operation_ids_json TEXT NOT NULL,
  head_versions_json TEXT NOT NULL,
  validation_json TEXT NOT NULL,
  affected_entity_ids_json TEXT NOT NULL,
  downstream_invalidations_json TEXT NOT NULL,
  before_after_json TEXT NOT NULL,
  preview_fingerprint TEXT NOT NULL,
  valid INTEGER NOT NULL CHECK(valid IN (0, 1)),
  created_at TEXT NOT NULL,
  UNIQUE(project_id, id),
  FOREIGN KEY(project_id, proposal_id)
    REFERENCES passage_proposal_sets(project_id, id) ON DELETE CASCADE
);
CREATE INDEX passage_proposal_previews_lookup
  ON passage_proposal_previews(project_id, proposal_id, created_at DESC, id DESC);

CREATE TABLE passage_proposal_applications (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  selected_group_ids_json TEXT NOT NULL,
  applied_operation_ids_json TEXT NOT NULL,
  candidate_provenance_json TEXT NOT NULL,
  previous_version_ids_json TEXT NOT NULL,
  resulting_version_ids_json TEXT NOT NULL,
  affected_entity_ids_json TEXT NOT NULL,
  validation_preview_fingerprint TEXT NOT NULL,
  validation_json TEXT NOT NULL,
  downstream_invalidations_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, id),
  FOREIGN KEY(project_id, proposal_id)
    REFERENCES passage_proposal_sets(project_id, id) ON DELETE CASCADE
);

CREATE TRIGGER passage_proposal_sets_lineage_insert
BEFORE INSERT ON passage_proposal_sets
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM generation_jobs jobs
  JOIN generation_plans plans
    ON plans.project_id = jobs.project_id AND plans.id = jobs.plan_id
  WHERE jobs.project_id = NEW.project_id
    AND jobs.id = NEW.generation_job_id
    AND jobs.plan_id = NEW.generation_plan_id
    AND plans.fingerprint = NEW.generation_plan_fingerprint
    AND plans.passage_snapshot_id = NEW.passage_snapshot_id
)
BEGIN
  SELECT RAISE(ABORT, 'Passage proposal generation lineage mismatch');
END;

CREATE TRIGGER passage_proposal_candidates_lineage_insert
BEFORE INSERT ON passage_proposal_candidates
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM passage_proposal_sets proposals
  JOIN generation_unit_candidates candidates
    ON candidates.project_id = proposals.project_id
    AND candidates.plan_id = proposals.generation_plan_id
    AND candidates.job_id = proposals.generation_job_id
  WHERE proposals.project_id = NEW.project_id
    AND proposals.id = NEW.proposal_id
    AND candidates.id = NEW.candidate_id
    AND candidates.job_id = NEW.generation_job_id
    AND candidates.unit_id = NEW.generation_unit_id
    AND candidates.attempt_id = NEW.attempt_id
    AND candidates.input_fingerprint = NEW.input_fingerprint
    AND candidates.context_fingerprint = NEW.context_fingerprint
)
BEGIN
  SELECT RAISE(ABORT, 'Passage proposal candidate lineage mismatch');
END;

CREATE TRIGGER passage_proposal_groups_lineage_insert
BEFORE INSERT ON passage_proposal_groups
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM passage_proposal_candidates candidates
  WHERE candidates.project_id = NEW.project_id
    AND candidates.proposal_id = NEW.proposal_id
    AND candidates.generation_unit_id = NEW.generation_unit_id
)
BEGIN
  SELECT RAISE(ABORT, 'Passage proposal group unit lineage mismatch');
END;

CREATE TRIGGER passage_proposal_operations_base_insert
BEFORE INSERT ON passage_proposal_operations
FOR EACH ROW
WHEN NEW.operation_kind = 'update-entity' AND NOT EXISTS (
  SELECT 1 FROM passage_entity_versions versions
  WHERE versions.id = NEW.base_version_id
    AND versions.project_id = NEW.project_id
    AND versions.entity_kind = NEW.entity_kind
    AND versions.entity_id = NEW.entity_id
)
BEGIN
  SELECT RAISE(ABORT, 'Passage proposal operation base lineage mismatch');
END;

CREATE TRIGGER passage_proposal_sets_immutable_definition
BEFORE UPDATE OF project_id, generation_plan_id, generation_job_id,
  generation_plan_fingerprint, passage_snapshot_id, proposal_schema_id,
  proposal_schema_version, candidate_ids_json, candidate_provenance_json,
  consolidation_fingerprint, created_at ON passage_proposal_sets
BEGIN
  SELECT RAISE(ABORT, 'Passage proposal definitions are immutable');
END;

CREATE TRIGGER passage_proposal_groups_immutable_definition
BEFORE UPDATE OF proposal_id, project_id, id, position, generation_unit_id,
  label, summary, operation_ids_json, depends_on_group_ids_json,
  affected_entity_ids_json, downstream_invalidations_json,
  validation_finding_ids_json, safe_independently, created_at ON passage_proposal_groups
BEGIN
  SELECT RAISE(ABORT, 'Passage proposal group definitions are immutable');
END;

CREATE TRIGGER passage_proposal_candidates_immutable_update
BEFORE UPDATE ON passage_proposal_candidates
BEGIN SELECT RAISE(ABORT, 'Passage proposal candidate provenance is immutable'); END;

CREATE TRIGGER passage_proposal_operations_immutable_update
BEFORE UPDATE ON passage_proposal_operations
BEGIN SELECT RAISE(ABORT, 'Passage proposal operations are immutable'); END;

CREATE TRIGGER passage_proposal_previews_immutable_update
BEFORE UPDATE ON passage_proposal_previews
BEGIN SELECT RAISE(ABORT, 'Passage proposal previews are immutable'); END;

CREATE TRIGGER passage_proposal_applications_immutable_update
BEFORE UPDATE ON passage_proposal_applications
BEGIN SELECT RAISE(ABORT, 'Passage proposal applications are immutable'); END;

CREATE TRIGGER passage_proposal_sets_immutable_delete
BEFORE DELETE ON passage_proposal_sets
WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'Passage proposal sets are immutable'); END;

CREATE TRIGGER passage_proposal_candidates_immutable_delete
BEFORE DELETE ON passage_proposal_candidates
WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'Passage proposal candidate provenance is immutable'); END;

CREATE TRIGGER passage_proposal_groups_immutable_delete
BEFORE DELETE ON passage_proposal_groups
WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'Passage proposal group definitions are immutable'); END;

CREATE TRIGGER passage_proposal_operations_immutable_delete
BEFORE DELETE ON passage_proposal_operations
WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'Passage proposal operations are immutable'); END;

CREATE TRIGGER passage_proposal_previews_immutable_delete
BEFORE DELETE ON passage_proposal_previews
WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'Passage proposal previews are immutable'); END;

CREATE TRIGGER passage_proposal_applications_immutable_delete
BEFORE DELETE ON passage_proposal_applications
WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'Passage proposal applications are immutable'); END;
`;

export const passageDraftArchitectureMigrationSql = `
CREATE UNIQUE INDEX IF NOT EXISTS passage_entity_versions_draft_lineage
  ON passage_entity_versions(project_id, id, entity_kind, entity_id);
CREATE UNIQUE INDEX IF NOT EXISTS artifact_versions_draft_lineage
  ON artifact_versions(project_id, id, artifact_id);

CREATE TABLE IF NOT EXISTS passage_draft_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  passage_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version > 0),
  based_on_passage_plan_version_id TEXT NOT NULL REFERENCES passage_entity_versions(id) ON DELETE RESTRICT,
  prose_markdown TEXT NOT NULL,
  word_count INTEGER NOT NULL CHECK(word_count >= 0),
  lifecycle_status TEXT NOT NULL CHECK(lifecycle_status IN ('candidate', 'accepted', 'reviewed', 'locked')),
  source_kind TEXT NOT NULL CHECK(source_kind IN ('manual', 'generated', 'restore', 'lifecycle')),
  generation_plan_id TEXT,
  generation_job_id TEXT,
  generation_unit_id TEXT,
  author_note TEXT NOT NULL DEFAULT '',
  restored_from_version_id TEXT REFERENCES passage_draft_versions(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, passage_id, version),
  UNIQUE(project_id, id),
  UNIQUE(project_id, id, passage_id),
  CHECK((source_kind = 'generated' AND generation_plan_id IS NOT NULL
      AND generation_job_id IS NOT NULL AND generation_unit_id IS NOT NULL)
    OR (source_kind = 'lifecycle'
      AND ((generation_plan_id IS NULL AND generation_job_id IS NULL AND generation_unit_id IS NULL)
        OR (generation_plan_id IS NOT NULL AND generation_job_id IS NOT NULL AND generation_unit_id IS NOT NULL)))
    OR (source_kind IN ('manual', 'restore') AND generation_plan_id IS NULL
      AND generation_job_id IS NULL AND generation_unit_id IS NULL))
);
CREATE INDEX IF NOT EXISTS passage_draft_versions_history
  ON passage_draft_versions(project_id, passage_id, version DESC);

CREATE TABLE IF NOT EXISTS passage_draft_upstream_artifacts (
  draft_version_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  artifact_version_id TEXT NOT NULL,
  PRIMARY KEY(draft_version_id, artifact_id),
  FOREIGN KEY(project_id, draft_version_id)
    REFERENCES passage_draft_versions(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, artifact_version_id, artifact_id)
    REFERENCES artifact_versions(project_id, id, artifact_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS passage_draft_neighbor_versions (
  draft_version_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  neighbor_passage_id TEXT NOT NULL,
  neighbor_draft_version_id TEXT NOT NULL,
  PRIMARY KEY(draft_version_id, neighbor_passage_id),
  FOREIGN KEY(project_id, draft_version_id)
    REFERENCES passage_draft_versions(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, neighbor_draft_version_id, neighbor_passage_id)
    REFERENCES passage_draft_versions(project_id, id, passage_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS passage_draft_heads (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  passage_id TEXT NOT NULL,
  current_version_id TEXT NOT NULL,
  accepted_version_id TEXT,
  accepted_locked INTEGER NOT NULL DEFAULT 0 CHECK(accepted_locked IN (0, 1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(project_id, passage_id),
  FOREIGN KEY(project_id, current_version_id, passage_id)
    REFERENCES passage_draft_versions(project_id, id, passage_id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, accepted_version_id, passage_id)
    REFERENCES passage_draft_versions(project_id, id, passage_id) ON DELETE RESTRICT,
  CHECK(accepted_locked = 0 OR accepted_version_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS passage_draft_staleness_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  passage_id TEXT NOT NULL,
  draft_version_id TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  source_entity_kind TEXT NOT NULL,
  source_entity_id TEXT NOT NULL,
  from_version_id TEXT,
  to_version_id TEXT,
  changed_fields_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(draft_version_id, reason_code, source_entity_kind, source_entity_id, to_version_id),
  FOREIGN KEY(project_id, draft_version_id, passage_id)
    REFERENCES passage_draft_versions(project_id, id, passage_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS passage_draft_staleness_lookup
  ON passage_draft_staleness_events(project_id, passage_id, draft_version_id, created_at);

CREATE TABLE IF NOT EXISTS drafting_plans (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  passage_snapshot_id TEXT NOT NULL,
  structure_version_id TEXT NOT NULL,
  upstream_versions_json TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  estimated_input_tokens INTEGER NOT NULL CHECK(estimated_input_tokens >= 0),
  estimated_output_tokens INTEGER NOT NULL CHECK(estimated_output_tokens >= 0),
  cost_estimate_json TEXT NOT NULL,
  execution_policy_id TEXT NOT NULL,
  execution_policy_json TEXT NOT NULL,
  authorization_state TEXT NOT NULL CHECK(authorization_state IN ('planned', 'authorized')),
  authorization_fingerprint TEXT,
  authorized_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, id),
  FOREIGN KEY(project_id, passage_snapshot_id)
    REFERENCES passage_plan_snapshots(project_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS drafting_plans_project_created
  ON drafting_plans(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS drafting_plan_units (
  plan_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK(position >= 0),
  input_fingerprint TEXT NOT NULL,
  estimated_input_tokens INTEGER NOT NULL CHECK(estimated_input_tokens >= 0),
  estimated_output_tokens INTEGER NOT NULL CHECK(estimated_output_tokens >= 0),
  context_diagnostics_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(plan_id, unit_id),
  UNIQUE(plan_id, position),
  UNIQUE(project_id, plan_id, unit_id),
  FOREIGN KEY(project_id, plan_id) REFERENCES drafting_plans(project_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS drafting_plan_unit_passages (
  plan_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK(position >= 0),
  passage_id TEXT NOT NULL,
  passage_plan_version_id TEXT NOT NULL,
  PRIMARY KEY(plan_id, unit_id, passage_id),
  UNIQUE(plan_id, unit_id, position),
  FOREIGN KEY(project_id, plan_id, unit_id)
    REFERENCES drafting_plan_units(project_id, plan_id, unit_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS drafting_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL UNIQUE,
  plan_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('planned', 'authorized', 'running', 'completed', 'partially_failed', 'failed', 'cancelled')),
  execution_policy_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  authorized_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, id),
  FOREIGN KEY(project_id, plan_id) REFERENCES drafting_plans(project_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS drafting_job_units (
  job_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  attempt_number INTEGER NOT NULL DEFAULT 0 CHECK(attempt_number >= 0),
  retry_of_attempt_id TEXT,
  normalized_error_json TEXT,
  usage_json TEXT,
  input_fingerprint TEXT NOT NULL,
  execution_policy_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(job_id, unit_id),
  UNIQUE(project_id, job_id, unit_id),
  FOREIGN KEY(project_id, job_id) REFERENCES drafting_jobs(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, plan_id, unit_id)
    REFERENCES drafting_plan_units(project_id, plan_id, unit_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS drafting_unit_attempts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK(attempt_number > 0),
  retry_of_attempt_id TEXT REFERENCES drafting_unit_attempts(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed', 'cancelled')),
  normalized_error_json TEXT,
  usage_json TEXT,
  input_fingerprint TEXT NOT NULL,
  execution_policy_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(job_id, unit_id, attempt_number),
  UNIQUE(project_id, id, job_id, unit_id),
  FOREIGN KEY(project_id, job_id, unit_id)
    REFERENCES drafting_job_units(project_id, job_id, unit_id) ON DELETE CASCADE
);

CREATE TRIGGER IF NOT EXISTS passage_draft_versions_base_lineage_insert
BEFORE INSERT ON passage_draft_versions
WHEN NOT EXISTS (
  SELECT 1 FROM passage_entity_versions
  WHERE project_id = NEW.project_id AND id = NEW.based_on_passage_plan_version_id
    AND entity_kind = 'passage' AND entity_id = NEW.passage_id
)
BEGIN SELECT RAISE(ABORT, 'Passage draft base version lineage mismatch'); END;

CREATE TRIGGER IF NOT EXISTS passage_draft_versions_immutable_update
BEFORE UPDATE ON passage_draft_versions
BEGIN SELECT RAISE(ABORT, 'Passage draft versions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS passage_draft_versions_immutable_delete
BEFORE DELETE ON passage_draft_versions
WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'Passage draft versions are immutable'); END;

CREATE TRIGGER IF NOT EXISTS passage_draft_upstream_immutable_update
BEFORE UPDATE ON passage_draft_upstream_artifacts
BEGIN SELECT RAISE(ABORT, 'Passage draft upstream provenance is immutable'); END;
CREATE TRIGGER IF NOT EXISTS passage_draft_upstream_immutable_delete
BEFORE DELETE ON passage_draft_upstream_artifacts
WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'Passage draft upstream provenance is immutable'); END;
CREATE TRIGGER IF NOT EXISTS passage_draft_neighbor_immutable_update
BEFORE UPDATE ON passage_draft_neighbor_versions
BEGIN SELECT RAISE(ABORT, 'Passage draft neighbor provenance is immutable'); END;
CREATE TRIGGER IF NOT EXISTS passage_draft_neighbor_immutable_delete
BEFORE DELETE ON passage_draft_neighbor_versions
WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'Passage draft neighbor provenance is immutable'); END;
CREATE TRIGGER IF NOT EXISTS passage_draft_staleness_immutable_update
BEFORE UPDATE ON passage_draft_staleness_events
BEGIN SELECT RAISE(ABORT, 'Passage draft staleness provenance is immutable'); END;
CREATE TRIGGER IF NOT EXISTS passage_draft_staleness_immutable_delete
BEFORE DELETE ON passage_draft_staleness_events
WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'Passage draft staleness provenance is append-only'); END;

CREATE TRIGGER IF NOT EXISTS passage_draft_heads_current_lineage_insert
BEFORE INSERT ON passage_draft_heads
WHEN NOT EXISTS (
  SELECT 1 FROM passage_draft_versions
  WHERE project_id = NEW.project_id AND id = NEW.current_version_id AND passage_id = NEW.passage_id
)
BEGIN SELECT RAISE(ABORT, 'Passage draft current-head lineage mismatch'); END;
CREATE TRIGGER IF NOT EXISTS passage_draft_heads_lineage_update
BEFORE UPDATE OF project_id, passage_id, current_version_id, accepted_version_id ON passage_draft_heads
WHEN NOT EXISTS (
  SELECT 1 FROM passage_draft_versions
  WHERE project_id = NEW.project_id AND id = NEW.current_version_id AND passage_id = NEW.passage_id
) OR (NEW.accepted_version_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM passage_draft_versions
  WHERE project_id = NEW.project_id AND id = NEW.accepted_version_id AND passage_id = NEW.passage_id
    AND lifecycle_status IN ('accepted', 'reviewed', 'locked')
))
BEGIN SELECT RAISE(ABORT, 'Passage draft head lineage mismatch'); END;
CREATE TRIGGER IF NOT EXISTS passage_draft_heads_accepted_lineage_insert
BEFORE INSERT ON passage_draft_heads
WHEN NEW.accepted_version_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM passage_draft_versions
  WHERE project_id = NEW.project_id AND id = NEW.accepted_version_id AND passage_id = NEW.passage_id
    AND lifecycle_status IN ('accepted', 'reviewed', 'locked')
)
BEGIN SELECT RAISE(ABORT, 'Passage draft accepted-head lineage mismatch'); END;
CREATE TRIGGER IF NOT EXISTS passage_draft_heads_locked_replace
BEFORE UPDATE OF accepted_version_id ON passage_draft_heads
WHEN OLD.accepted_locked = 1 AND NEW.accepted_version_id IS NOT OLD.accepted_version_id
BEGIN SELECT RAISE(ABORT, 'Locked accepted prose must be explicitly unlocked before replacement'); END;

CREATE TRIGGER IF NOT EXISTS drafting_unit_passage_snapshot_lineage_insert
BEFORE INSERT ON drafting_plan_unit_passages
WHEN NOT EXISTS (
  SELECT 1 FROM drafting_plans plans
  JOIN passage_plan_snapshot_items items
    ON items.snapshot_id = plans.passage_snapshot_id
    AND items.entity_kind = 'passage'
  JOIN passage_entity_versions versions
    ON versions.project_id = plans.project_id
    AND versions.id = items.version_id
    AND versions.entity_kind = 'passage'
    AND versions.entity_id = items.entity_id
  WHERE plans.project_id = NEW.project_id AND plans.id = NEW.plan_id
    AND items.entity_id = NEW.passage_id AND items.version_id = NEW.passage_plan_version_id
)
BEGIN SELECT RAISE(ABORT, 'Drafting unit passage snapshot lineage mismatch'); END;

CREATE TRIGGER IF NOT EXISTS drafting_job_units_lineage_insert
BEFORE INSERT ON drafting_job_units
WHEN NOT EXISTS (
  SELECT 1 FROM drafting_jobs
  WHERE project_id = NEW.project_id AND id = NEW.job_id AND plan_id = NEW.plan_id
)
BEGIN SELECT RAISE(ABORT, 'Drafting job unit lineage mismatch'); END;
CREATE TRIGGER IF NOT EXISTS drafting_job_units_lineage_update
BEFORE UPDATE OF project_id, job_id, plan_id ON drafting_job_units
WHEN NOT EXISTS (
  SELECT 1 FROM drafting_jobs
  WHERE project_id = NEW.project_id AND id = NEW.job_id AND plan_id = NEW.plan_id
)
BEGIN SELECT RAISE(ABORT, 'Drafting job unit lineage mismatch'); END;
CREATE TRIGGER IF NOT EXISTS drafting_jobs_lineage_update
BEFORE UPDATE OF project_id, id, plan_id ON drafting_jobs
WHEN EXISTS (
  SELECT 1 FROM drafting_job_units
  WHERE project_id = OLD.project_id AND job_id = OLD.id
    AND (project_id != NEW.project_id OR job_id != NEW.id OR plan_id != NEW.plan_id)
)
BEGIN SELECT RAISE(ABORT, 'Drafting job lineage update would orphan attached units'); END;

CREATE TRIGGER IF NOT EXISTS passage_draft_generation_lineage_insert
BEFORE INSERT ON passage_draft_versions
WHEN NEW.generation_plan_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM drafting_job_units
  WHERE project_id = NEW.project_id AND job_id = NEW.generation_job_id
    AND plan_id = NEW.generation_plan_id AND unit_id = NEW.generation_unit_id
)
BEGIN SELECT RAISE(ABORT, 'Passage draft generation lineage mismatch'); END;
CREATE TRIGGER IF NOT EXISTS drafting_job_units_draft_provenance_delete
BEFORE DELETE ON drafting_job_units
WHEN EXISTS (
  SELECT 1 FROM passage_draft_versions
  WHERE project_id = OLD.project_id AND generation_job_id = OLD.job_id
    AND generation_plan_id = OLD.plan_id AND generation_unit_id = OLD.unit_id
) AND EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'Drafting unit is retained by passage draft provenance'); END;

CREATE TRIGGER IF NOT EXISTS drafting_plans_immutable_definition
BEFORE UPDATE OF project_id, fingerprint, passage_snapshot_id, structure_version_id,
  upstream_versions_json, scope_json, provider_id, model_id, estimated_input_tokens,
  estimated_output_tokens, cost_estimate_json, execution_policy_id, execution_policy_json,
  created_at ON drafting_plans
BEGIN SELECT RAISE(ABORT, 'Drafting plan definitions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS drafting_plans_immutable_delete
BEFORE DELETE ON drafting_plans
WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'Drafting plans are immutable'); END;
CREATE TRIGGER IF NOT EXISTS drafting_plan_units_immutable_update
BEFORE UPDATE ON drafting_plan_units
BEGIN SELECT RAISE(ABORT, 'Drafting plan units are immutable'); END;
CREATE TRIGGER IF NOT EXISTS drafting_plan_units_immutable_delete
BEFORE DELETE ON drafting_plan_units
WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'Drafting plan units are immutable'); END;
CREATE TRIGGER IF NOT EXISTS drafting_plan_unit_passages_immutable_update
BEFORE UPDATE ON drafting_plan_unit_passages
BEGIN SELECT RAISE(ABORT, 'Drafting unit passage inputs are immutable'); END;
CREATE TRIGGER IF NOT EXISTS drafting_plan_unit_passages_immutable_delete
BEFORE DELETE ON drafting_plan_unit_passages
WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'Drafting unit passage inputs are immutable'); END;
CREATE TRIGGER IF NOT EXISTS drafting_jobs_immutable_definition
BEFORE UPDATE OF plan_fingerprint, execution_policy_id, created_at ON drafting_jobs
BEGIN SELECT RAISE(ABORT, 'Drafting job definitions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS drafting_job_units_immutable_definition
BEFORE UPDATE OF unit_id, input_fingerprint, execution_policy_id, created_at
ON drafting_job_units
BEGIN SELECT RAISE(ABORT, 'Drafting job unit definitions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS drafting_unit_attempts_lineage_update
BEFORE UPDATE OF project_id, job_id, unit_id, attempt_number, retry_of_attempt_id,
  input_fingerprint, execution_policy_id, created_at ON drafting_unit_attempts
BEGIN SELECT RAISE(ABORT, 'Drafting attempt lineage is immutable'); END;
CREATE TRIGGER IF NOT EXISTS drafting_unit_attempts_immutable_delete
BEFORE DELETE ON drafting_unit_attempts
WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'Drafting attempts are append-only'); END;
`;

export const passageDraftProvenanceMigrationSql = `
CREATE TRIGGER passage_draft_generation_input_insert
BEFORE INSERT ON passage_draft_versions
WHEN NEW.generation_plan_id IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM drafting_job_units job_units
  JOIN drafting_plan_unit_passages passage_inputs
    ON passage_inputs.project_id = job_units.project_id
    AND passage_inputs.plan_id = job_units.plan_id
    AND passage_inputs.unit_id = job_units.unit_id
  WHERE job_units.project_id = NEW.project_id
    AND job_units.job_id = NEW.generation_job_id
    AND job_units.plan_id = NEW.generation_plan_id
    AND job_units.unit_id = NEW.generation_unit_id
    AND passage_inputs.passage_id = NEW.passage_id
    AND passage_inputs.passage_plan_version_id = NEW.based_on_passage_plan_version_id
)
BEGIN SELECT RAISE(ABORT, 'Passage draft generation input provenance mismatch'); END;

CREATE TRIGGER passage_draft_generation_upstream_insert
BEFORE INSERT ON passage_draft_upstream_artifacts
WHEN EXISTS (
  SELECT 1 FROM passage_draft_versions drafts
  WHERE drafts.project_id = NEW.project_id AND drafts.id = NEW.draft_version_id
    AND drafts.generation_plan_id IS NOT NULL
) AND NOT EXISTS (
  SELECT 1
  FROM passage_draft_versions drafts
  JOIN drafting_plans plans
    ON plans.project_id = drafts.project_id AND plans.id = drafts.generation_plan_id
  WHERE drafts.project_id = NEW.project_id AND drafts.id = NEW.draft_version_id
    AND json_extract(plans.upstream_versions_json, '$.' || NEW.artifact_id) = NEW.artifact_version_id
)
BEGIN SELECT RAISE(ABORT, 'Passage draft generation upstream provenance mismatch'); END;
`;

export const passageDraftGenerationMigrationSql = `
ALTER TABLE drafting_plan_units ADD COLUMN context_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE drafting_plan_units ADD COLUMN context_fingerprint TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX drafting_plan_unit_passage_generation_identity
  ON drafting_plan_unit_passages(project_id, plan_id, unit_id, passage_id, passage_plan_version_id);

CREATE TABLE drafting_unit_outputs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  context_fingerprint TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  execution_policy_id TEXT NOT NULL,
  output_schema_id TEXT NOT NULL,
  output_schema_version INTEGER NOT NULL CHECK(output_schema_version > 0),
  content_json TEXT NOT NULL,
  validation_json TEXT NOT NULL,
  usage_json TEXT,
  repair_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, id),
  UNIQUE(attempt_id),
  FOREIGN KEY(project_id, plan_id, unit_id)
    REFERENCES drafting_plan_units(project_id, plan_id, unit_id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, job_id, unit_id)
    REFERENCES drafting_job_units(project_id, job_id, unit_id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, attempt_id, job_id, unit_id)
    REFERENCES drafting_unit_attempts(project_id, id, job_id, unit_id) ON DELETE CASCADE
);
CREATE INDEX drafting_unit_outputs_job_order
  ON drafting_unit_outputs(project_id, job_id, unit_id, created_at);

CREATE TABLE passage_draft_generation_provenance (
  draft_version_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  output_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  passage_id TEXT NOT NULL,
  passage_plan_version_id TEXT NOT NULL,
  context_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(output_id, passage_id),
  FOREIGN KEY(project_id, draft_version_id, passage_id)
    REFERENCES passage_draft_versions(project_id, id, passage_id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, output_id)
    REFERENCES drafting_unit_outputs(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, plan_id, unit_id, passage_id, passage_plan_version_id)
    REFERENCES drafting_plan_unit_passages(project_id, plan_id, unit_id, passage_id, passage_plan_version_id)
      ON DELETE CASCADE
);

CREATE TRIGGER drafting_unit_outputs_lineage_insert
BEFORE INSERT ON drafting_unit_outputs
WHEN NOT EXISTS (
  SELECT 1
  FROM drafting_job_units job_units
  JOIN drafting_jobs jobs
    ON jobs.project_id = job_units.project_id AND jobs.id = job_units.job_id
      AND jobs.plan_id = job_units.plan_id
  JOIN drafting_plan_units plan_units
    ON plan_units.project_id = job_units.project_id AND plan_units.plan_id = job_units.plan_id
      AND plan_units.unit_id = job_units.unit_id
  JOIN drafting_plans plans
    ON plans.project_id = jobs.project_id AND plans.id = jobs.plan_id
  JOIN drafting_unit_attempts attempts
    ON attempts.project_id = job_units.project_id AND attempts.job_id = job_units.job_id
      AND attempts.unit_id = job_units.unit_id
  WHERE job_units.project_id = NEW.project_id
    AND job_units.job_id = NEW.job_id
    AND job_units.plan_id = NEW.plan_id
    AND job_units.unit_id = NEW.unit_id
    AND job_units.status = 'running'
    AND attempts.id = NEW.attempt_id
    AND attempts.status = 'running'
    AND attempts.input_fingerprint = NEW.input_fingerprint
    AND plan_units.input_fingerprint = NEW.input_fingerprint
    AND plan_units.context_fingerprint = NEW.context_fingerprint
    AND plan_units.context_fingerprint != ''
    AND plan_units.context_json != '{}'
    AND plans.provider_id = NEW.provider_id
    AND plans.model_id = NEW.model_id
    AND plans.execution_policy_id = NEW.execution_policy_id
)
BEGIN SELECT RAISE(ABORT, 'Drafting unit output lineage mismatch'); END;

CREATE TRIGGER passage_draft_generation_provenance_insert
BEFORE INSERT ON passage_draft_generation_provenance
WHEN NOT EXISTS (
  SELECT 1
  FROM passage_draft_versions drafts
  JOIN drafting_unit_outputs outputs
    ON outputs.project_id = drafts.project_id AND outputs.id = NEW.output_id
  JOIN drafting_plan_unit_passages inputs
    ON inputs.project_id = outputs.project_id AND inputs.plan_id = outputs.plan_id
      AND inputs.unit_id = outputs.unit_id
  WHERE drafts.project_id = NEW.project_id
    AND drafts.id = NEW.draft_version_id
    AND drafts.passage_id = NEW.passage_id
    AND drafts.source_kind = 'generated'
    AND drafts.generation_plan_id = NEW.plan_id
    AND drafts.generation_job_id = NEW.job_id
    AND drafts.generation_unit_id = NEW.unit_id
    AND drafts.based_on_passage_plan_version_id = NEW.passage_plan_version_id
    AND outputs.plan_id = NEW.plan_id
    AND outputs.job_id = NEW.job_id
    AND outputs.unit_id = NEW.unit_id
    AND outputs.attempt_id = NEW.attempt_id
    AND outputs.context_fingerprint = NEW.context_fingerprint
    AND inputs.passage_id = NEW.passage_id
    AND inputs.passage_plan_version_id = NEW.passage_plan_version_id
)
BEGIN SELECT RAISE(ABORT, 'Generated passage candidate provenance mismatch'); END;

CREATE TRIGGER drafting_unit_outputs_immutable_update
BEFORE UPDATE ON drafting_unit_outputs
BEGIN SELECT RAISE(ABORT, 'Drafting unit outputs are immutable'); END;
CREATE TRIGGER drafting_unit_outputs_immutable_delete
BEFORE DELETE ON drafting_unit_outputs
WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'Drafting unit outputs are append-only'); END;
CREATE TRIGGER passage_draft_generation_provenance_immutable_update
BEFORE UPDATE ON passage_draft_generation_provenance
BEGIN SELECT RAISE(ABORT, 'Generated passage candidate provenance is immutable'); END;
CREATE TRIGGER passage_draft_generation_provenance_immutable_delete
BEFORE DELETE ON passage_draft_generation_provenance
WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'Generated passage candidate provenance is append-only'); END;
`;

export const passageDraftAcceptanceMigrationSql = `
CREATE TABLE passage_draft_acceptance_applications (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  preview_fingerprint TEXT NOT NULL,
  selected_candidates_json TEXT NOT NULL,
  previous_accepted_versions_json TEXT NOT NULL,
  resulting_accepted_versions_json TEXT NOT NULL,
  downstream_staleness_json TEXT NOT NULL,
  accepted_word_delta INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, id),
  UNIQUE(project_id, preview_fingerprint)
);

CREATE TABLE passage_draft_acceptance_items (
  application_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  passage_id TEXT NOT NULL,
  candidate_version_id TEXT NOT NULL,
  previous_accepted_version_id TEXT,
  resulting_accepted_version_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(application_id, passage_id),
  FOREIGN KEY(project_id, application_id)
    REFERENCES passage_draft_acceptance_applications(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, candidate_version_id, passage_id)
    REFERENCES passage_draft_versions(project_id, id, passage_id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, previous_accepted_version_id, passage_id)
    REFERENCES passage_draft_versions(project_id, id, passage_id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, resulting_accepted_version_id, passage_id)
    REFERENCES passage_draft_versions(project_id, id, passage_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX passage_draft_acceptance_result
  ON passage_draft_acceptance_items(project_id, resulting_accepted_version_id);
CREATE INDEX passage_draft_acceptance_history
  ON passage_draft_acceptance_items(project_id, passage_id, created_at);

CREATE TRIGGER passage_draft_acceptance_items_lineage_insert
BEFORE INSERT ON passage_draft_acceptance_items
WHEN NOT EXISTS (
  SELECT 1
  FROM passage_draft_acceptance_applications applications
  JOIN passage_draft_versions candidates
    ON candidates.project_id = applications.project_id
    AND candidates.id = NEW.candidate_version_id
    AND candidates.passage_id = NEW.passage_id
    AND candidates.lifecycle_status = 'candidate'
  JOIN passage_draft_versions results
    ON results.project_id = applications.project_id
    AND results.id = NEW.resulting_accepted_version_id
    AND results.passage_id = NEW.passage_id
    AND results.lifecycle_status = 'accepted'
  WHERE applications.project_id = NEW.project_id
    AND applications.id = NEW.application_id
    AND (NEW.previous_accepted_version_id IS NULL OR EXISTS (
      SELECT 1 FROM passage_draft_versions previous
      WHERE previous.project_id = NEW.project_id
        AND previous.id = NEW.previous_accepted_version_id
        AND previous.passage_id = NEW.passage_id
        AND previous.lifecycle_status IN ('accepted', 'reviewed', 'locked')
    ))
)
BEGIN SELECT RAISE(ABORT, 'Passage draft acceptance audit lineage mismatch'); END;

CREATE TRIGGER passage_draft_acceptance_applications_immutable_update
BEFORE UPDATE ON passage_draft_acceptance_applications
BEGIN SELECT RAISE(ABORT, 'Passage draft acceptance applications are immutable'); END;
CREATE TRIGGER passage_draft_acceptance_applications_immutable_delete
BEFORE DELETE ON passage_draft_acceptance_applications
WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'Passage draft acceptance applications are append-only'); END;
CREATE TRIGGER passage_draft_acceptance_items_immutable_update
BEFORE UPDATE ON passage_draft_acceptance_items
BEGIN SELECT RAISE(ABORT, 'Passage draft acceptance items are immutable'); END;
CREATE TRIGGER passage_draft_acceptance_items_immutable_delete
BEFORE DELETE ON passage_draft_acceptance_items
WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'Passage draft acceptance items are append-only'); END;
`;

export const repairApplicationMigrationSql = `
CREATE TABLE repair_applications (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  proposal_id TEXT NOT NULL,
  proposal_artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id) ON DELETE CASCADE,
  repair_plan_artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id) ON DELETE CASCADE,
  definition_fingerprint TEXT NOT NULL,
  preview_fingerprint TEXT NOT NULL,
  content_json TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  UNIQUE(project_id, id),
  UNIQUE(project_id, proposal_id),
  UNIQUE(project_id, definition_fingerprint),
  UNIQUE(project_id, preview_fingerprint)
);

CREATE TABLE repair_application_draft_links (
  project_id TEXT NOT NULL,
  application_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  passage_id TEXT NOT NULL,
  draft_version_id TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  PRIMARY KEY(project_id, application_id, operation_id),
  UNIQUE(project_id, draft_version_id),
  FOREIGN KEY(project_id, application_id)
    REFERENCES repair_applications(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, draft_version_id, passage_id)
    REFERENCES passage_draft_versions(project_id, id, passage_id) ON DELETE CASCADE
);

CREATE TABLE repair_application_result_versions (
  project_id TEXT NOT NULL,
  application_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  entity_kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  PRIMARY KEY(project_id, application_id, operation_id),
  UNIQUE(project_id, version_id, operation_id),
  FOREIGN KEY(project_id, application_id)
    REFERENCES repair_applications(project_id, id) ON DELETE CASCADE
);

CREATE INDEX repair_applications_history
  ON repair_applications(project_id, applied_at DESC, id);

CREATE TRIGGER repair_applications_lineage_insert
BEFORE INSERT ON repair_applications
WHEN NOT EXISTS (
  SELECT 1 FROM artifact_versions proposal
  JOIN artifact_versions repair_plan
    ON repair_plan.project_id = proposal.project_id
    AND repair_plan.id = NEW.repair_plan_artifact_version_id
    AND repair_plan.artifact_type = 'repair-plan'
  WHERE proposal.project_id = NEW.project_id
    AND proposal.id = NEW.proposal_artifact_version_id
    AND proposal.artifact_type = 'repair-proposal'
    AND json_extract(proposal.content_json, '$.id') = NEW.proposal_id
    AND json_extract(proposal.content_json, '$.definitionFingerprint') = json_extract(NEW.content_json, '$.proposalDefinitionFingerprint')
    AND json_extract(proposal.content_json, '$.repairPlanArtifactVersionId') = NEW.repair_plan_artifact_version_id
    AND json_extract(NEW.content_json, '$.schemaId') = 'cyoa.repair-application'
    AND json_extract(NEW.content_json, '$.schemaVersion') = 1
    AND json_extract(NEW.content_json, '$.id') = NEW.id
    AND json_extract(NEW.content_json, '$.projectId') = NEW.project_id
    AND json_extract(NEW.content_json, '$.proposalId') = NEW.proposal_id
    AND json_extract(NEW.content_json, '$.proposalArtifactVersionId') = NEW.proposal_artifact_version_id
    AND json_extract(NEW.content_json, '$.repairPlanArtifactVersionId') = NEW.repair_plan_artifact_version_id
    AND json_extract(NEW.content_json, '$.definitionFingerprint') = NEW.definition_fingerprint
    AND json_extract(NEW.content_json, '$.previewFingerprint') = NEW.preview_fingerprint
    AND json_extract(NEW.content_json, '$.result') = 'applied'
)
BEGIN SELECT RAISE(ABORT, 'Repair application lineage mismatch'); END;

CREATE TRIGGER repair_application_draft_links_lineage_insert
BEFORE INSERT ON repair_application_draft_links
WHEN NOT EXISTS (
  SELECT 1 FROM repair_applications applications
  JOIN passage_draft_versions drafts
    ON drafts.project_id = applications.project_id
    AND drafts.id = NEW.draft_version_id
    AND drafts.passage_id = NEW.passage_id
    AND drafts.lifecycle_status = 'candidate'
  WHERE applications.project_id = NEW.project_id
    AND applications.id = NEW.application_id
    AND EXISTS (
      SELECT 1 FROM json_each(applications.content_json, '$.operationIds')
      WHERE value = NEW.operation_id
    )
    AND json_extract(NEW.provenance_json, '$.applicationId') = NEW.application_id
    AND json_extract(NEW.provenance_json, '$.operationId') = NEW.operation_id
    AND json_extract(NEW.provenance_json, '$.draftVersionId') = NEW.draft_version_id
)
BEGIN SELECT RAISE(ABORT, 'Repair draft provenance lineage mismatch'); END;

CREATE TRIGGER repair_application_result_versions_lineage_insert
BEFORE INSERT ON repair_application_result_versions
WHEN NOT EXISTS (
  SELECT 1 FROM repair_applications applications
  WHERE applications.project_id = NEW.project_id
    AND applications.id = NEW.application_id
    AND EXISTS (
      SELECT 1 FROM json_each(applications.content_json, '$.resultingVersions') results
      WHERE json_extract(results.value, '$.operationId') = NEW.operation_id
        AND json_extract(results.value, '$.entityKind') = NEW.entity_kind
        AND json_extract(results.value, '$.entityId') = NEW.entity_id
        AND json_extract(results.value, '$.versionId') = NEW.version_id
    )
    AND (
      (NEW.entity_kind = 'passage-prose' AND EXISTS (
        SELECT 1 FROM passage_draft_versions drafts
        WHERE drafts.project_id = NEW.project_id AND drafts.id = NEW.version_id
          AND drafts.passage_id = NEW.entity_id AND drafts.lifecycle_status = 'candidate'
      ))
      OR (NEW.entity_kind IN ('passage', 'choice', 'thread') AND EXISTS (
        SELECT 1 FROM passage_entity_versions versions
        WHERE versions.project_id = NEW.project_id AND versions.id = NEW.version_id
          AND versions.entity_kind = NEW.entity_kind AND versions.entity_id = NEW.entity_id
      ))
      OR (NEW.entity_kind IN ('relationship', 'canon-fact') AND EXISTS (
        SELECT 1 FROM artifact_versions versions
        WHERE versions.project_id = NEW.project_id AND versions.id = NEW.version_id AND versions.artifact_id = 'bible'
      ))
      OR (NEW.entity_kind IN ('route', 'route-act', 'route-decision', 'route-reconvergence', 'route-ending-hook') AND EXISTS (
        SELECT 1 FROM artifact_versions versions
        WHERE versions.project_id = NEW.project_id AND versions.id = NEW.version_id AND versions.artifact_id = 'routes'
      ))
      OR (NEW.entity_kind = 'ending' AND EXISTS (
        SELECT 1 FROM artifact_versions versions
        WHERE versions.project_id = NEW.project_id AND versions.id = NEW.version_id AND versions.artifact_id = 'endings'
      ))
      OR (NEW.entity_kind = 'mechanic' AND EXISTS (
        SELECT 1 FROM artifact_versions versions
        WHERE versions.project_id = NEW.project_id AND versions.id = NEW.version_id AND versions.artifact_id = 'mechanics'
      ))
    )
)
BEGIN SELECT RAISE(ABORT, 'Repair application result version lineage mismatch'); END;

CREATE TRIGGER repair_applications_immutable_update
BEFORE UPDATE ON repair_applications
BEGIN SELECT RAISE(ABORT, 'Repair applications are immutable'); END;
CREATE TRIGGER repair_applications_immutable_delete
BEFORE DELETE ON repair_applications
WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'Repair applications are append-only'); END;
CREATE TRIGGER repair_application_draft_links_immutable_update
BEFORE UPDATE ON repair_application_draft_links
BEGIN SELECT RAISE(ABORT, 'Repair draft provenance is immutable'); END;
CREATE TRIGGER repair_application_draft_links_immutable_delete
BEFORE DELETE ON repair_application_draft_links
WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'Repair draft provenance is append-only'); END;
CREATE TRIGGER repair_application_result_versions_immutable_update
BEFORE UPDATE ON repair_application_result_versions
BEGIN SELECT RAISE(ABORT, 'Repair application result lineage is immutable'); END;
CREATE TRIGGER repair_application_result_versions_immutable_delete
BEFORE DELETE ON repair_application_result_versions
WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'Repair application result lineage is append-only'); END;
`;

export const repairDraftProvenanceLineageMigrationSql = `
CREATE TRIGGER repair_application_draft_links_provenance_v15_insert
BEFORE INSERT ON repair_application_draft_links
WHEN NOT EXISTS (
  SELECT 1
  FROM repair_applications applications
  JOIN artifact_versions proposals
    ON proposals.project_id = applications.project_id
    AND proposals.id = applications.proposal_artifact_version_id
    AND proposals.artifact_type = 'repair-proposal'
  JOIN passage_draft_versions drafts
    ON drafts.project_id = NEW.project_id
    AND drafts.id = NEW.draft_version_id
    AND drafts.passage_id = NEW.passage_id
    AND drafts.lifecycle_status = 'candidate'
    AND drafts.source_kind = 'manual'
  WHERE applications.project_id = NEW.project_id
    AND applications.id = NEW.application_id
    AND json_extract(NEW.provenance_json, '$.applicationId') = applications.id
    AND json_extract(NEW.provenance_json, '$.applicationDefinitionFingerprint') = applications.definition_fingerprint
    AND json_extract(NEW.provenance_json, '$.proposalId') = applications.proposal_id
    AND json_extract(NEW.provenance_json, '$.proposalArtifactVersionId') = applications.proposal_artifact_version_id
    AND json_extract(NEW.provenance_json, '$.proposalDefinitionFingerprint') = json_extract(applications.content_json, '$.proposalDefinitionFingerprint')
    AND json_extract(NEW.provenance_json, '$.repairPlanId') = json_extract(applications.content_json, '$.repairPlanId')
    AND json_extract(NEW.provenance_json, '$.repairPlanArtifactVersionId') = applications.repair_plan_artifact_version_id
    AND json_extract(NEW.provenance_json, '$.repairPlanDefinitionFingerprint') = json_extract(applications.content_json, '$.repairPlanDefinitionFingerprint')
    AND json_extract(NEW.provenance_json, '$.operationId') = NEW.operation_id
    AND json_extract(NEW.provenance_json, '$.passageId') = NEW.passage_id
    AND json_extract(NEW.provenance_json, '$.draftVersionId') = NEW.draft_version_id
    AND json_extract(NEW.provenance_json, '$.passagePlanBaseVersionId') = drafts.based_on_passage_plan_version_id
    AND EXISTS (
      SELECT 1 FROM json_each(proposals.content_json, '$.operations') operations
      WHERE json_extract(operations.value, '$.id') = NEW.operation_id
        AND json_extract(operations.value, '$.kind') = 'create-passage-draft-candidate'
        AND json_extract(operations.value, '$.entityId') = NEW.passage_id
        AND json_extract(operations.value, '$.after.proposedProse') = drafts.prose_markdown
        AND (
          json_extract(operations.value, '$.expectedBase.passagePlanVersionId') = drafts.based_on_passage_plan_version_id
          OR EXISTS (
            SELECT 1 FROM json_each(applications.content_json, '$.resultingVersions') passage_results
            WHERE json_extract(passage_results.value, '$.entityKind') = 'passage'
              AND json_extract(passage_results.value, '$.entityId') = NEW.passage_id
              AND json_extract(passage_results.value, '$.versionId') = drafts.based_on_passage_plan_version_id
          )
        )
        AND json_extract(operations.value, '$.expectedBase.currentDraftVersionId') IS json_extract(NEW.provenance_json, '$.expectedCurrentDraftVersionId')
        AND json_extract(operations.value, '$.expectedBase.acceptedDraftVersionId') IS json_extract(NEW.provenance_json, '$.expectedAcceptedDraftVersionId')
        AND json_extract(operations.value, '$.sourceFindingFingerprints') = json_extract(NEW.provenance_json, '$.sourceFindingFingerprints')
        AND json_extract(operations.value, '$.expectedBase.upstreamVersions') = json_extract(NEW.provenance_json, '$.upstreamVersions')
        AND json_extract(operations.value, '$.expectedBase.neighboringDraftVersions') = json_extract(NEW.provenance_json, '$.neighboringDraftVersions')
    )
    AND (SELECT COUNT(*) FROM passage_draft_upstream_artifacts WHERE project_id = NEW.project_id AND draft_version_id = NEW.draft_version_id)
      = (SELECT COUNT(*) FROM json_each(NEW.provenance_json, '$.upstreamVersions'))
    AND NOT EXISTS (
      SELECT 1 FROM json_each(NEW.provenance_json, '$.upstreamVersions') expected
      WHERE NOT EXISTS (
        SELECT 1 FROM passage_draft_upstream_artifacts actual
        WHERE actual.project_id = NEW.project_id AND actual.draft_version_id = NEW.draft_version_id
          AND actual.artifact_id = expected.key AND actual.artifact_version_id = expected.value
      )
    )
    AND (SELECT COUNT(*) FROM passage_draft_neighbor_versions WHERE project_id = NEW.project_id AND draft_version_id = NEW.draft_version_id)
      = (SELECT COUNT(*) FROM json_each(NEW.provenance_json, '$.neighboringDraftVersions'))
    AND NOT EXISTS (
      SELECT 1 FROM json_each(NEW.provenance_json, '$.neighboringDraftVersions') expected
      WHERE NOT EXISTS (
        SELECT 1 FROM passage_draft_neighbor_versions actual
        WHERE actual.project_id = NEW.project_id AND actual.draft_version_id = NEW.draft_version_id
          AND actual.neighbor_passage_id = expected.key AND actual.neighbor_draft_version_id = expected.value
      )
    )
)
BEGIN SELECT RAISE(ABORT, 'Repair draft provenance exact lineage mismatch'); END;
`;

export const recoveryMetadataMigrationSql = `
CREATE TABLE project_backup_records (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  schema_id TEXT NOT NULL CHECK(schema_id = 'cyoa.project-backup-record'),
  schema_version INTEGER NOT NULL CHECK(schema_version = 1),
  game_id TEXT NOT NULL,
  portable_schema_id TEXT NOT NULL CHECK(portable_schema_id = 'cyoa.portable-project'),
  portable_schema_version INTEGER NOT NULL CHECK(portable_schema_version = 1),
  portable_project_fingerprint TEXT NOT NULL CHECK(length(portable_project_fingerprint) = 32),
  portable_archive_sha256 TEXT NOT NULL CHECK(length(portable_archive_sha256) = 64),
  portable_archive_byte_count INTEGER NOT NULL CHECK(portable_archive_byte_count > 0 AND portable_archive_byte_count <= 128000000),
  source_sqlite_schema_version INTEGER NOT NULL CHECK(source_sqlite_schema_version >= 4),
  application_version TEXT,
  created_at TEXT NOT NULL,
  verification_status TEXT NOT NULL CHECK(verification_status = 'verified'),
  verified_at TEXT NOT NULL,
  verification_method TEXT NOT NULL CHECK(verification_method = 'isolated-portable-restore'),
  verification_method_version INTEGER NOT NULL CHECK(verification_method_version = 1),
  restored_semantic_fingerprint TEXT NOT NULL CHECK(length(restored_semantic_fingerprint) = 32),
  verification_diagnostics_json TEXT NOT NULL,
  source_change_fingerprint TEXT NOT NULL CHECK(length(source_change_fingerprint) = 32),
  UNIQUE(project_id, id),
  CHECK(game_id = project_id),
  CHECK(portable_project_fingerprint = restored_semantic_fingerprint),
  CHECK(portable_project_fingerprint = source_change_fingerprint)
);

CREATE INDEX project_backup_records_history
  ON project_backup_records(project_id, verified_at DESC, id DESC);

CREATE TABLE project_restore_records (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  backup_id TEXT NOT NULL REFERENCES project_backup_records(id) ON DELETE CASCADE,
  schema_id TEXT NOT NULL CHECK(schema_id = 'cyoa.project-restore-record'),
  schema_version INTEGER NOT NULL CHECK(schema_version = 1),
  source_project_id TEXT NOT NULL,
  portable_project_fingerprint TEXT NOT NULL CHECK(length(portable_project_fingerprint) = 32),
  restored_semantic_fingerprint TEXT NOT NULL CHECK(length(restored_semantic_fingerprint) = 32),
  restored_at TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome = 'restored'),
  diagnostics_json TEXT NOT NULL,
  UNIQUE(project_id, id),
  CHECK(project_id = source_project_id),
  CHECK(portable_project_fingerprint = restored_semantic_fingerprint)
);

CREATE INDEX project_restore_records_history
  ON project_restore_records(project_id, restored_at DESC, id DESC);

CREATE TABLE project_recovery_state (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  reminder_dismissed_for_fingerprint TEXT CHECK(reminder_dismissed_for_fingerprint IS NULL OR length(reminder_dismissed_for_fingerprint) = 32),
  reminder_snoozed_until TEXT,
  last_verification_failure_at TEXT,
  last_verification_failure_fingerprint TEXT CHECK(last_verification_failure_fingerprint IS NULL OR length(last_verification_failure_fingerprint) = 32),
  last_verification_failure_code TEXT CHECK(last_verification_failure_code IS NULL OR length(last_verification_failure_code) <= 120),
  updated_at TEXT NOT NULL
);

CREATE TRIGGER project_backup_records_immutable_update
BEFORE UPDATE ON project_backup_records
BEGIN
  SELECT RAISE(ABORT, 'project backup records are immutable');
END;

CREATE TRIGGER project_restore_records_immutable_update
BEFORE UPDATE ON project_restore_records
BEGIN
  SELECT RAISE(ABORT, 'project restore records are immutable');
END;
`;
