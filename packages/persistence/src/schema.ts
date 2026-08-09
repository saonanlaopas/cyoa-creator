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
