import { copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
// Run this only from the accepted schema-v18 build before compiling schema v19.
import { CURRENT_SCHEMA_VERSION, openDatabase } from "../../dist/index.js";

const source = fileURLToPath(new URL("./schema-v17.sqlite", import.meta.url));
const output = fileURLToPath(new URL("./schema-v18.sqlite", import.meta.url));
if (CURRENT_SCHEMA_VERSION !== 18) throw new Error("Freeze only from the accepted v18 build");
if (existsSync(output)) throw new Error("The frozen v18 fixture already exists; refusing to overwrite it");
copyFileSync(source, output);
const database = openDatabase(output);
const version = (database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version;
if (version !== 18) throw new Error(`Expected accepted schema v18, received v${version}`);
database.exec("VACUUM");
database.close();
