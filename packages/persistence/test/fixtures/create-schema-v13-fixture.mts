import { copyFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  openDatabase,
} from "../../dist/index.js";

const source = fileURLToPath(new URL("./schema-v12.sqlite", import.meta.url));
const output = fileURLToPath(new URL("./schema-v13.sqlite", import.meta.url));
rmSync(output, { force: true });
copyFileSync(source, output);
const database = openDatabase(output);
for (const trigger of [
  "repair_applications_lineage_insert",
  "repair_application_draft_links_lineage_insert",
  "repair_applications_immutable_update",
  "repair_applications_immutable_delete",
  "repair_application_draft_links_immutable_update",
  "repair_application_draft_links_immutable_delete",
  "repair_application_result_versions_lineage_insert",
  "repair_application_result_versions_immutable_update",
  "repair_application_result_versions_immutable_delete",
]) database.exec(`DROP TRIGGER ${trigger}`);
database.exec("DROP INDEX repair_applications_history");
database.exec("DROP TABLE repair_application_draft_links");
database.exec("DROP TABLE repair_application_result_versions");
database.exec("DROP TABLE repair_applications");
database.prepare("DELETE FROM schema_migrations WHERE version = 14").run();
database.exec("VACUUM");
database.close();
