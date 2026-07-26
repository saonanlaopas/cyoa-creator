import type { StoryDatabase } from "./database.js";
import { schemaSql } from "./schema.js";

export function migrate(database: StoryDatabase): void {
  database.exec(schemaSql);
}
