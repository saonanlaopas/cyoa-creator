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
