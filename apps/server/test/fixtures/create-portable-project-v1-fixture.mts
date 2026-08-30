import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openDatabase, PortableProjectRepository } from "@story-to-cyoa/persistence";
import { PublicationExportService } from "../../src/services/publication-export-service.js";

const database = openDatabase();
try {
  database.prepare(`INSERT INTO projects (id, name, mode, archived, created_at, updated_at)
    VALUES (?, ?, 'long-form', 0, ?, ?)`)
    .run("portable-v1-fixture", "Cerita 日本語 e\u0301moji 🧭", "2026-08-30T00:00:00.000Z", "2026-08-30T00:00:00.000Z");
  const service = new PublicationExportService(new PortableProjectRepository(database), undefined);
  const exported = service.exportPortable("portable-v1-fixture");
  writeFileSync(fileURLToPath(new URL("./portable-project-v1.cyoa.zip", import.meta.url)), exported.bytes);
} finally {
  database.close();
}
