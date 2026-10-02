export const sourceAnalysisMigrationSql = `
CREATE TABLE IF NOT EXISTS source_analysis_plans (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_version_id TEXT NOT NULL REFERENCES artifact_versions(id) ON DELETE RESTRICT,
  scope_version_id TEXT NOT NULL REFERENCES artifact_versions(id) ON DELETE RESTRICT,
  content_json TEXT NOT NULL CHECK(json_valid(content_json)), created_at TEXT NOT NULL,
  UNIQUE(project_id, id)
);
CREATE TABLE IF NOT EXISTS source_analysis_jobs (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','running','completed','failed','cancelled')),
  authorized_fingerprint TEXT NOT NULL, dossier_version_id TEXT REFERENCES artifact_versions(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(project_id, id),
  FOREIGN KEY(project_id, plan_id) REFERENCES source_analysis_plans(project_id, id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS source_analysis_units (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, job_id TEXT NOT NULL,
  unit_id TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','running','completed','failed','cancelled')),
  PRIMARY KEY(project_id, job_id, unit_id),
  FOREIGN KEY(project_id, job_id) REFERENCES source_analysis_jobs(project_id, id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS source_analysis_attempts (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, job_id TEXT NOT NULL, unit_id TEXT NOT NULL,
  number INTEGER NOT NULL CHECK(number BETWEEN 1 AND 3),
  status TEXT NOT NULL CHECK(status IN ('running','completed','failed','cancelled')),
  context_fingerprint TEXT NOT NULL, repair_count INTEGER NOT NULL CHECK(repair_count BETWEEN 0 AND 1),
  usage_json TEXT NOT NULL CHECK(json_valid(usage_json)), diagnostic TEXT NOT NULL,
  started_at TEXT NOT NULL, finished_at TEXT, UNIQUE(project_id, id), UNIQUE(job_id, unit_id, number),
  FOREIGN KEY(project_id, job_id, unit_id) REFERENCES source_analysis_units(project_id, job_id, unit_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS source_analysis_one_running_attempt
 ON source_analysis_attempts(project_id,job_id,unit_id) WHERE status = 'running';
CREATE TABLE IF NOT EXISTS source_analysis_outputs (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, job_id TEXT NOT NULL, unit_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL, content_json TEXT NOT NULL CHECK(json_valid(content_json)),
  UNIQUE(project_id,job_id,unit_id),
  FOREIGN KEY(project_id,job_id,unit_id) REFERENCES source_analysis_units(project_id,job_id,unit_id) ON DELETE CASCADE,
  FOREIGN KEY(project_id,attempt_id) REFERENCES source_analysis_attempts(project_id,id) ON DELETE CASCADE
);
CREATE TRIGGER IF NOT EXISTS source_analysis_plans_immutable_update
 BEFORE UPDATE ON source_analysis_plans BEGIN SELECT RAISE(ABORT,'Source analysis plans are immutable'); END;
CREATE TRIGGER IF NOT EXISTS source_analysis_outputs_immutable_update
 BEFORE UPDATE ON source_analysis_outputs BEGIN SELECT RAISE(ABORT,'Source observations are immutable'); END;
CREATE TRIGGER IF NOT EXISTS source_analysis_attempts_terminal_immutable
 BEFORE UPDATE ON source_analysis_attempts WHEN OLD.status != 'running'
 BEGIN SELECT RAISE(ABORT,'Source analysis terminal attempts are immutable'); END;
CREATE TRIGGER IF NOT EXISTS source_analysis_attempts_definition_immutable
 BEFORE UPDATE ON source_analysis_attempts WHEN NEW.id != OLD.id OR NEW.project_id != OLD.project_id
 OR NEW.job_id != OLD.job_id OR NEW.unit_id != OLD.unit_id OR NEW.number != OLD.number
 OR NEW.context_fingerprint != OLD.context_fingerprint OR NEW.started_at != OLD.started_at
 BEGIN SELECT RAISE(ABORT,'Source analysis attempt lineage is immutable'); END;
CREATE TRIGGER IF NOT EXISTS source_analysis_jobs_definition_immutable
 BEFORE UPDATE ON source_analysis_jobs WHEN NEW.id != OLD.id OR NEW.project_id != OLD.project_id
 OR NEW.plan_id != OLD.plan_id OR NEW.authorized_fingerprint != OLD.authorized_fingerprint OR NEW.created_at != OLD.created_at
 BEGIN SELECT RAISE(ABORT,'Source analysis authorization is immutable'); END;
CREATE TRIGGER IF NOT EXISTS source_analysis_units_terminal_immutable
 BEFORE UPDATE ON source_analysis_units WHEN OLD.status IN ('completed','cancelled')
 OR NEW.project_id != OLD.project_id OR NEW.job_id != OLD.job_id OR NEW.unit_id != OLD.unit_id
 BEGIN SELECT RAISE(ABORT,'Source analysis terminal units are immutable'); END;
CREATE TRIGGER IF NOT EXISTS source_analysis_artifact_content_immutable
 BEFORE UPDATE OF content_json,project_id,artifact_id,artifact_type,version,schema_version,restored_from_version_id ON artifact_versions
 WHEN OLD.artifact_id IN ('source','source-scope','source-dossier')
 BEGIN SELECT RAISE(ABORT,'Source evidence and dossiers are immutable'); END;
CREATE TRIGGER IF NOT EXISTS source_analysis_artifact_delete
 BEFORE DELETE ON artifact_versions WHEN OLD.artifact_id IN ('source','source-scope','source-dossier')
 AND EXISTS(SELECT 1 FROM projects WHERE id = OLD.project_id)
 BEGIN SELECT RAISE(ABORT,'Source evidence and dossiers are immutable'); END;
${["plans", "jobs", "units", "attempts", "outputs"].map((table) => `
CREATE TRIGGER IF NOT EXISTS source_analysis_${table}_immutable_delete
 BEFORE DELETE ON source_analysis_${table} WHEN EXISTS(SELECT 1 FROM projects WHERE id = OLD.project_id)
 BEGIN SELECT RAISE(ABORT,'Source analysis history is immutable'); END;`).join("\n")}
`;
