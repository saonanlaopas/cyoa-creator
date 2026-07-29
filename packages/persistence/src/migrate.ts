import type { StoryDatabase } from "./database.js";
import { schemaSql } from "./schema.js";

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
}

function addColumn(database: StoryDatabase, table: string, column: string, definition: string): void {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
