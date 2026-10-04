export const FOUNDATION_BOOTSTRAP_TABLES = ["foundation_bootstrap_plans", "foundation_bootstrap_jobs", "foundation_bootstrap_candidates", "foundation_bootstrap_applications"] as const;

export const foundationBootstrapMigrationSql = `
CREATE TABLE IF NOT EXISTS foundation_bootstrap_plans (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 content_json TEXT NOT NULL CHECK(json_valid(content_json)),
 UNIQUE(project_id,id)
);
CREATE TABLE IF NOT EXISTS foundation_bootstrap_jobs (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, plan_id TEXT NOT NULL,
 content_json TEXT NOT NULL CHECK(json_valid(content_json)), UNIQUE(project_id,id),
 FOREIGN KEY(project_id,plan_id) REFERENCES foundation_bootstrap_plans(project_id,id)
);
CREATE TABLE IF NOT EXISTS foundation_bootstrap_candidates (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, job_id TEXT NOT NULL,
 attempt_id TEXT NOT NULL, content_json TEXT NOT NULL CHECK(json_valid(content_json)), UNIQUE(project_id,job_id),
 FOREIGN KEY(project_id,job_id) REFERENCES foundation_bootstrap_jobs(project_id,id)
);
CREATE TABLE IF NOT EXISTS foundation_bootstrap_applications (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, job_id TEXT NOT NULL,
 content_json TEXT NOT NULL CHECK(json_valid(content_json)),
 FOREIGN KEY(project_id,job_id) REFERENCES foundation_bootstrap_jobs(project_id,id)
);
${FOUNDATION_BOOTSTRAP_TABLES.map((table) => `
CREATE TRIGGER IF NOT EXISTS ${table}_immutable_delete BEFORE DELETE ON ${table}
 WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id)
 BEGIN SELECT RAISE(ABORT,'Foundation bootstrap history is immutable'); END;
${table === "foundation_bootstrap_jobs" ? "" : `CREATE TRIGGER IF NOT EXISTS ${table}_immutable_update BEFORE UPDATE ON ${table}
 BEGIN SELECT RAISE(ABORT,'Foundation bootstrap records are immutable'); END;`}`).join("\n")}
CREATE TRIGGER IF NOT EXISTS foundation_bootstrap_jobs_identity BEFORE UPDATE ON foundation_bootstrap_jobs
 WHEN NEW.id != OLD.id OR NEW.project_id != OLD.project_id OR NEW.plan_id != OLD.plan_id
 BEGIN SELECT RAISE(ABORT,'Foundation bootstrap job identity is immutable'); END;
CREATE TRIGGER IF NOT EXISTS foundation_bootstrap_jobs_history BEFORE UPDATE OF content_json ON foundation_bootstrap_jobs
 WHEN json_extract(OLD.content_json,'$.status') IN ('completed','cancelled')
 OR json_extract(NEW.content_json,'$.id') != json_extract(OLD.content_json,'$.id')
 OR json_extract(NEW.content_json,'$.projectId') != json_extract(OLD.content_json,'$.projectId')
 OR json_extract(NEW.content_json,'$.planId') != json_extract(OLD.content_json,'$.planId')
 OR json_extract(NEW.content_json,'$.authorizedFingerprint') != json_extract(OLD.content_json,'$.authorizedFingerprint')
 OR json_extract(NEW.content_json,'$.createdAt') != json_extract(OLD.content_json,'$.createdAt')
 OR json_array_length(NEW.content_json,'$.units[0].attempts') < json_array_length(OLD.content_json,'$.units[0].attempts')
 OR json_array_length(NEW.content_json,'$.units[0].attempts') > json_array_length(OLD.content_json,'$.units[0].attempts') + 1
 OR EXISTS(SELECT 1 FROM json_each(OLD.content_json,'$.units[0].attempts') prior
   WHERE json_extract(prior.value,'$.status') != 'running'
   AND prior.value != json_extract(NEW.content_json,'$.units[0].attempts[' || prior.key || ']'))
 OR EXISTS(SELECT 1 FROM json_each(OLD.content_json,'$.units[0].attempts') prior
   WHERE json_extract(prior.value,'$.status') = 'running' AND (
     json_extract(prior.value,'$.id') != json_extract(NEW.content_json,'$.units[0].attempts[' || prior.key || '].id')
     OR json_extract(prior.value,'$.number') != json_extract(NEW.content_json,'$.units[0].attempts[' || prior.key || '].number')
     OR json_extract(prior.value,'$.startedAt') != json_extract(NEW.content_json,'$.units[0].attempts[' || prior.key || '].startedAt')
     OR json_extract(prior.value,'$.contextFingerprint') != json_extract(NEW.content_json,'$.units[0].attempts[' || prior.key || '].contextFingerprint')))
 BEGIN SELECT RAISE(ABORT,'Foundation bootstrap attempt history is append-only'); END;
${["INSERT", "UPDATE"].map((operation) => `
CREATE TRIGGER IF NOT EXISTS foundation_bootstrap_jobs_valid_${operation.toLowerCase()} BEFORE ${operation} ON foundation_bootstrap_jobs
 WHEN json_extract(NEW.content_json,'$.id') IS NOT NEW.id
 OR json_extract(NEW.content_json,'$.projectId') IS NOT NEW.project_id
 OR json_extract(NEW.content_json,'$.planId') IS NOT NEW.plan_id
 OR json_extract(NEW.content_json,'$.status') IS NOT json_extract(NEW.content_json,'$.units[0].status')
 OR json_array_length(NEW.content_json,'$.units') != 1
 OR json_array_length(NEW.content_json,'$.units[0].attempts') > 4
 OR (json_extract(NEW.content_json,'$.status') IN ('running','failed','completed')
   AND json_extract(NEW.content_json,'$.status') IS NOT json_extract(NEW.content_json,'$.units[0].attempts[#-1].status'))
 OR (json_extract(NEW.content_json,'$.status') = 'pending' AND json_array_length(NEW.content_json,'$.units[0].attempts') > 0
   AND json_extract(NEW.content_json,'$.units[0].attempts[#-1].status') != 'failed')
 OR EXISTS(SELECT 1 FROM json_each(NEW.content_json,'$.units[0].attempts') attempt
   WHERE json_extract(attempt.value,'$.number') != attempt.key + 1
   OR (attempt.key < json_array_length(NEW.content_json,'$.units[0].attempts') - 1 AND json_extract(attempt.value,'$.status') != 'failed')
   OR (json_extract(attempt.value,'$.status') = 'running') != (json_extract(attempt.value,'$.finishedAt') IS NULL))
 BEGIN SELECT RAISE(ABORT,'Foundation bootstrap lifecycle is invalid'); END;`).join("\n")}
`;
