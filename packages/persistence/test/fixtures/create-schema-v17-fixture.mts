import { copyFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
// Run this only from the accepted schema-v17 build before compiling schema v18.
import { openDatabase } from "../../dist/index.js";

const source = fileURLToPath(new URL("./schema-v16.sqlite", import.meta.url));
const output = fileURLToPath(new URL("./schema-v17.sqlite", import.meta.url));
rmSync(output, { force: true });
copyFileSync(source, output);
const database = openDatabase(output);
const version = (database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version;
if (version !== 17) throw new Error(`Expected accepted schema v17, received v${version}`);
database.exec("VACUUM");
database.close();
