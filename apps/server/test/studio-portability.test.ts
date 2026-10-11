import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { createHash } from "node:crypto";
import { stableFingerprint } from "@story-to-cyoa/runtime";
import { ArtifactRepository, AuthorMemoryRepository, ConversationRepository, PortableProjectRepository, ProjectRepository, SourceAnalysisRepository, openDatabase } from "@story-to-cyoa/persistence";
import { isUnavailableSource, planSourceAnalysis, unavailableSource, type SourceDossier } from "@story-to-cyoa/domain";
import { PublicationExportService } from "../src/services/publication-export-service.js";
import { RecoveryService } from "../src/services/recovery-service.js";
import { validatePortableAuthoringProject } from "../src/services/portable-project-validator.js";
import { analysisFixture, completeFixture, smallSource } from "../../../packages/persistence/test/source-analysis-fixture.js";
import { createHistoryHeavyProjectFixture } from "./fixtures/history-heavy-project.js";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { ProjectHealthService } from "../src/services/project-health-service.js";

function context() {
  const db = openDatabase(), portable = new PortableProjectRepository(db), publication = new PublicationExportService(portable, undefined);
  return { db, portable, publication, recovery: new RecoveryService(db, portable, publication) };
}

describe("A7 Studio archives", () => {
  it("bounds unavailable-source listings to twenty metadata records", () => {
    const source = context();
    try {
      const project = new ProjectRepository(source.db).create("Unavailable sources", undefined, "long-form"), artifacts = new ArtifactRepository(source.db);
      for (let index = 0; index < 26; index++) artifacts.saveArtifact({ projectId: project.id, artifactId: "source", artifactType: "source", content: unavailableSource(smallSource) });
      const first = source.publication.unavailableSourcePage(project.id, 0), second = source.publication.unavailableSourcePage(project.id, 20);
      expect(first.evidence).toHaveLength(20); expect(first.hasMore).toBe(true);
      expect(second.evidence).toHaveLength(6); expect(second.hasMore).toBe(false);
      expect(new Set([...first.evidence, ...second.evidence].map((item: any) => item.sourceVersionId)).size).toBe(26);
      expect(JSON.stringify(first)).not.toContain(smallSource.chapters[0]!.blocks[0]!.text);
    } finally { source.db.close(); }
  });
  it("preserves coexisting production histories through full backup and transactional duplication", async () => {
    const fixture = await createHistoryHeavyProjectFixture();
    try {
      const response = await fixture.app.inject({ method: "POST", url: `/api/projects/${fixture.projectId}/duplicate`, payload: { name: "Independent production copy" } });
      expect(response.statusCode, response.body).toBe(201);
      const copyId = response.json().id;
      const backup = await fixture.app.inject({ method: "POST", url: `/api/projects/${copyId}/recovery/backups` });
      expect(backup.statusCode, backup.body).toBe(200);
      const health = await fixture.app.inject({ method: "GET", url: `/api/long-form/projects/${copyId}/health` });
      expect(health.statusCode, health.body).toBe(200);
      const database = openDatabase(join(fixture.directory, "restored.sqlite")), target = context();
      try {
        const redacted = new PublicationExportService(new PortableProjectRepository(database), undefined).exportStudioPortable(fixture.projectId, "privacy-redacted");
        target.publication.importPortable(redacted.bytes);
        validatePortableAuthoringProject(target.db, fixture.projectId);
      } finally { database.close(); target.db.close(); }
    } finally {
      for (const app of fixture.apps) await app.close();
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });
  it.each(["full-fidelity", "privacy-redacted"] as const)("round trips source, dossier, attempts and explicit evidence availability: %s", (mode) => {
    const source = context(), target = context();
    try {
      const f = analysisFixture(source.db), completed = completeFixture(f), dossier = f.artifacts.getVersion<SourceDossier>(completed.dossierVersionId!)!;
      const conversations = new ConversationRepository(source.db), conversation = conversations.create(f.projectId, { kind: "project", projectId: f.projectId });
      const message = conversations.addMessage({ conversationId: conversation.id, role: "user", content: "PRIVATE-CONVERSATION-BODY", intent: "discuss", scope: conversation.scope, context: {}, metadata: {} });
      const archive = source.publication.exportStudioPortable(f.projectId, mode);
      expect(archive.manifest).toMatchObject({ exportContractVersion: 2, exportMode: mode, evidence: [{ sourceVersionId: dossier.content.binding.sourceVersionId, sourceFingerprint: f.plan.binding.sourceFingerprint, availability: mode === "full-fidelity" ? "present" : "redacted" }] });
      target.publication.importPortable(archive.bytes);
      expect(new SourceAnalysisRepository(target.db).getJob(f.projectId, completed.id)).toEqual(completed);
      expect(new ArtifactRepository(target.db).getVersion(dossier.id)?.content).toEqual(dossier.content);
      const imported = new ArtifactRepository(target.db).getCurrent(f.projectId, "source")!;
      const health = new ProjectHealthService(target.db, new ProjectRepository(target.db));
      expect(health.usage(f.projectId).groups.find((group) => group.workflow === "source-analysis")).toMatchObject({
        attemptCount: completed.units.length, providerRequestCountStatus: "known",
      });
      expect(health.resume(f.projectId).actions.some((action) => action.id === "source-unavailable")).toBe(mode === "privacy-redacted");
      expect(isUnavailableSource(imported.content)).toBe(mode === "privacy-redacted");
      if (mode === "full-fidelity") {
        expect(imported.content).toEqual(smallSource);
        expect(new ConversationRepository(target.db).getMessage(message.id)?.content).toBe(message.content);
        expect(target.publication.exportStudioPortable(f.projectId).manifest.projectFingerprint).toBe(archive.manifest.projectFingerprint);
      } else {
        const json = strFromU8(unzipSync(archive.bytes)["project.json"]!);
        expect(json).not.toContain("PRIVATE-CONVERSATION-BODY");
        for (const block of smallSource.chapters.flatMap((c) => c.blocks)) expect(json).not.toContain(block.text);
        expect(new ConversationRepository(target.db).getMessage(message.id)).toBeUndefined();
        expect(new ArtifactRepository(target.db).getCurrent(f.projectId, "studio-archive-evidence")?.content).toMatchObject({ omissions: expect.arrayContaining([expect.objectContaining({ id: message.id, kind: "messages", availability: "redacted" })]) });
        expect(() => new SourceAnalysisRepository(target.db).fresh(f.projectId, f.plan.id)).toThrow(/source_evidence_unavailable/);
        expect(() => target.publication.exportStudioPortable(f.projectId)).toThrow(/full_fidelity_source_unavailable/);
      }
    } finally { source.db.close(); target.db.close(); }
  });

  it("reattaches only exact material to the existing source identity and revalidates the complete history", async () => {
    const source = context(), target = context(), restored = context();
    try {
      const f = analysisFixture(source.db), completed = completeFixture(f), sourceId = f.plan.binding.sourceVersionId;
      const initial = f.artifacts.getVersion<SourceDossier>(completed.dossierVersionId!)!;
      const corrected = f.repository.correct(f.projectId, initial.id, { kind: "reject", intent: "source-analysis-correction", reason: "Reviewer correction", previousVersionId: initial.id, recordId: initial.content.records[0]!.id });
      target.publication.importPortable(source.publication.exportStudioPortable(f.projectId, "privacy-redacted").bytes);
      await expect(target.recovery.createVerifiedBackup(f.projectId)).rejects.toThrow(/full_fidelity_source_unavailable/);
      const before = target.publication.studioProjectFingerprint(f.projectId);
      expect(() => target.publication.reattachSource(f.projectId, sourceId, { ...smallSource, metadata: { ...smallSource.metadata, title: "Wrong title" } })).toThrow(/fingerprint_mismatch/);
      expect(target.publication.studioProjectFingerprint(f.projectId)).toBe(before);
      expect(() => target.publication.reattachSource("wrong-project", sourceId, smallSource)).toThrow();
      target.publication.reattachSource(f.projectId, sourceId, smallSource);
      expect(target.publication.sourceAvailability(f.projectId)).toEqual([{ sourceVersionId: sourceId, sourceFingerprint: f.plan.binding.sourceFingerprint, availability: "present" }]);
      new SourceAnalysisRepository(target.db).fresh(f.projectId, f.plan.id);
      expect(new ArtifactRepository(target.db).getVersion(corrected.id)?.content).toEqual(corrected.content);
      const backup = await target.recovery.createVerifiedBackup(f.projectId);
      await restored.recovery.restoreBackup(backup.bytes);
      expect(new ArtifactRepository(restored.db).getVersion(sourceId)?.content).toEqual(smallSource);
      expect(() => target.publication.reattachSource(f.projectId, sourceId, smallSource)).toThrow(/not_required/);
    } finally { source.db.close(); target.db.close(); restored.db.close(); }
  });

  it("does not verify a redacted archive as a full backup and keeps the source project unchanged", () => {
    const source = context();
    try {
      const f = analysisFixture(source.db); completeFixture(f);
      const before = source.publication.studioProjectFingerprint(f.projectId);
      const redacted = source.publication.exportStudioPortable(f.projectId, "privacy-redacted");
      expect(redacted.manifest.evidence?.every((item) => item.availability === "redacted")).toBe(true);
      expect(source.publication.studioProjectFingerprint(f.projectId)).toBe(before);
      expect(source.publication.exportStudioPortable(f.projectId).manifest.evidence?.every((item) => item.availability === "present")).toBe(true);
    } finally { source.db.close(); }
  });

  it("rejects a checksummed redacted archive disguised as a verified full backup", async () => {
    const source = context(), target = context();
    try {
      const f = analysisFixture(source.db); completeFixture(f);
      const full = await source.recovery.createVerifiedBackup(f.projectId), redacted = source.publication.exportStudioPortable(f.projectId, "privacy-redacted");
      const record = JSON.parse(strFromU8(unzipSync(full.bytes)["backup-record.json"]!));
      Object.assign(record, { portableProjectFingerprint: redacted.manifest.projectFingerprint, sourceChangeFingerprint: redacted.manifest.projectFingerprint,
        restoredSemanticFingerprint: redacted.manifest.projectFingerprint, portableArchiveSha256: createHash("sha256").update(redacted.bytes).digest("hex"), portableArchiveByteCount: redacted.bytes.length });
      const disguised = zipSync({ "backup-record.json": strToU8(JSON.stringify(record)), "portable-project.cyoa.zip": redacted.bytes });
      await expect(target.recovery.restoreBackup(disguised)).rejects.toThrow(/redacted_archive_forbidden/);
      expect(new ProjectRepository(target.db).list()).toHaveLength(0);
    } finally { source.db.close(); target.db.close(); }
  });

  it.each(["future-contract", "future-schema", "unexpected-table", "foreign-message", "source-fingerprint"])("rejects hostile Studio archives atomically even with repaired transport hashes: %s", (attack) => {
    const source = context(), target = context();
    try {
      const f = analysisFixture(source.db); completeFixture(f);
      const conversations = new ConversationRepository(source.db), conversation = conversations.create(f.projectId, { kind: "project", projectId: f.projectId });
      conversations.addMessage({ conversationId: conversation.id, role: "user", content: "Archive ownership test", intent: "discuss", scope: conversation.scope, context: {}, metadata: {} });
      const files = unzipSync(source.publication.exportStudioPortable(f.projectId).bytes), manifest = JSON.parse(strFromU8(files["manifest.json"]!)), payload = JSON.parse(strFromU8(files["project.json"]!));
      if (attack === "future-contract") manifest.exportContractVersion = 3;
      if (attack === "future-schema") payload.schemaVersion = manifest.schemaVersion = 99;
      if (attack === "unexpected-table") payload.rows.studio.unrecognized = [];
      if (attack === "foreign-message") payload.rows.studio.messages[0].conversation_id = "foreign-conversation";
      if (attack === "source-fingerprint") {
        const row = payload.rows.tables.artifact_versions.find((item: { artifact_id: string }) => item.artifact_id === "source");
        const value = JSON.parse(row.content_json); value.chapters[0].blocks[0].text += " forged"; row.content_json = JSON.stringify(value);
      }
      payload.projectFingerprint = stableFingerprint({ schemaId: payload.schemaId, schemaVersion: payload.schemaVersion, exportContractVersion: manifest.exportContractVersion,
        historyMode: manifest.historyMode, exportMode: manifest.exportMode, evidence: manifest.evidence, rows: payload.rows });
      manifest.projectFingerprint = payload.projectFingerprint;
      const bytes = strToU8(JSON.stringify(payload)); manifest.files[0].bytes = bytes.length; manifest.files[0].sha256 = createHash("sha256").update(bytes).digest("hex");
      expect(() => target.publication.importPortable(zipSync({ "manifest.json": strToU8(JSON.stringify(manifest)), "project.json": bytes }))).toThrow();
      expect(new ProjectRepository(target.db).list()).toHaveLength(0);
    } finally { source.db.close(); target.db.close(); }
  });

  it("preserves append-only author memory progression in full-fidelity archives", () => {
    const source = context(), target = context();
    try {
      new ProjectRepository(source.db).create("Memory", "memory-project", "long-form");
      const memory = new AuthorMemoryRepository(source.db), first = memory.createDecision({ projectId: "memory-project", scope: { kind: "project" }, content: "Keep the ending hopeful." });
      memory.reviseDecision("memory-project", first.stableId, { content: "Keep the ending open." });
      const archive = source.publication.exportStudioPortable("memory-project");
      target.publication.importPortable(archive.bytes);
      expect(target.publication.exportStudioPortable("memory-project").manifest.projectFingerprint).toBe(archive.manifest.projectFingerprint);
    } finally { source.db.close(); target.db.close(); }
  });

  it.each(["full-fidelity", "privacy-redacted"] as const)("duplicates source/provenance identities transactionally with honest availability: %s", (mode) => {
    const source = context(), target = context();
    try {
      const f = analysisFixture(source.db), completed = completeFixture(f);
      target.publication.importPortable(source.publication.exportStudioPortable(f.projectId, mode).bytes);
      const copy = new ProjectRepository(target.db).duplicate(f.projectId, "Copied adaptation", validatePortableAuthoringProject);
      const artifacts = new ArtifactRepository(target.db), dossier = artifacts.getCurrent<SourceDossier>(copy.id, "source-dossier")!;
      expect(dossier.content.projectId).toBe(copy.id);
      expect(dossier.content.binding).toMatchObject({ projectId: copy.id, sourceFingerprint: f.plan.binding.sourceFingerprint });
      expect(dossier.content.binding.sourceVersionId).not.toBe(f.plan.binding.sourceVersionId);
      expect(dossier.content.binding.scopeVersionId).not.toBe(f.plan.binding.scopeVersionId);
      expect(dossier.content.planId).not.toBe(f.plan.id);
      expect(dossier.content.jobId).not.toBe(completed.id);
      const originals = new Set(f.artifacts.getVersion<SourceDossier>(completed.dossierVersionId!)!.content.provenance.map((p) => p.attemptId));
      expect(dossier.content.provenance.every((p) => !originals.has(p.attemptId) && p.original.evidence.every((e) => e.projectId === copy.id && e.sourceFingerprint === f.plan.binding.sourceFingerprint))).toBe(true);
      new SourceAnalysisRepository(target.db).validateProject(copy.id);
      if (mode === "privacy-redacted") {
        expect(target.publication.sourceAvailability(copy.id)[0]!.availability).toBe("redacted");
        expect(() => target.publication.exportStudioPortable(copy.id)).toThrow(/source_unavailable/);
        target.publication.reattachSource(copy.id, dossier.content.binding.sourceVersionId, smallSource);
        new SourceAnalysisRepository(target.db).validateProject(copy.id);
        expect(target.publication.sourceAvailability(copy.id)[0]!.availability).toBe("present");
        expect(new SourceAnalysisRepository(target.db).getPlan(copy.id, dossier.content.planId).copiedContextBinding).toEqual(f.plan.binding);
        // Copied attempts retain real historical context commitments. A new authorized request needs a new preview.
        const plan = planSourceAnalysis(dossier.content.binding, smallSource, "offline-source-analysis", "offline-source-v1");
        new SourceAnalysisRepository(target.db).savePlan(plan);
        new SourceAnalysisRepository(target.db).fresh(copy.id, plan.id);
      }
    } finally { source.db.close(); target.db.close(); }
  });

  it("rolls duplication back when immutable dossier provenance is invalid", () => {
    const source = context();
    try {
      const f = analysisFixture(source.db), completed = completeFixture(f), dossier = f.artifacts.getVersion<SourceDossier>(completed.dossierVersionId!)!;
      const invalid = structuredClone(dossier.content); invalid.records[0]!.claim = "Not derived from an immutable observation";
      source.db.prepare(`INSERT INTO artifact_versions (id,project_id,artifact_id,artifact_type,version,schema_version,content_json,stale,created_at)
        VALUES ('invalid-dossier',?,'source-dossier','source-dossier',2,1,?,0,?)`).run(f.projectId, JSON.stringify(invalid), dossier.createdAt);
      expect(() => new ProjectRepository(source.db).duplicate(f.projectId, "Must not exist", validatePortableAuthoringProject)).toThrow();
      expect(new ProjectRepository(source.db).list()).toHaveLength(1);
    } finally { source.db.close(); }
  });
});
