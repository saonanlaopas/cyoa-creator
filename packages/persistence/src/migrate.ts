import type { StoryDatabase } from "./database.js";
import { schemaSql } from "./schema.js";

export function migrate(database: StoryDatabase): void {
  database.exec(schemaSql);
  const projectColumns = database.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
  if (!projectColumns.some((column) => column.name === "mode")) {
    database.exec("ALTER TABLE projects ADD COLUMN mode TEXT NOT NULL DEFAULT 'quick'");
  }
  database.prepare(`
    INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (1, ?)
  `).run(new Date().toISOString());
}
