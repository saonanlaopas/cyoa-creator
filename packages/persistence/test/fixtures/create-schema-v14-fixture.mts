import { copyFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../../dist/index.js";

const source = fileURLToPath(new URL("./schema-v13.sqlite", import.meta.url));
const output = fileURLToPath(new URL("./schema-v14.sqlite", import.meta.url));
rmSync(output, { force: true });
copyFileSync(source, output);
const database = openDatabase(output);
database.exec("DROP TRIGGER repair_application_draft_links_provenance_v15_insert");
database.prepare("DELETE FROM schema_migrations WHERE version = 15").run();
database.exec("VACUUM");
database.close();
