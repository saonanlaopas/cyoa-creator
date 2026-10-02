import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { assertSourceDossier, sourceCanonicalJson, type SourceDossier } from "@story-to-cyoa/domain";
import { ArtifactRepository, CURRENT_SCHEMA_VERSION, openDatabase, PortableProjectRepository, SourceAnalysisRepository, WorkflowRepository } from "../src/index.js";
import { analysisFixture, completeFixture, fixtureOutput } from "./source-analysis-fixture.js";

describe("A3 durable source analysis", () => {
  it("binds authorization, append-only attempts, terminal outcomes and explicit retry preparation", () => {
    const f = analysisFixture();
    try {
      expect(() => f.repository.createJob(f.projectId, f.plan.id, "wrong")).toThrow(/authorization/);
      const job = f.repository.createJob(f.projectId, f.plan.id, f.plan.fingerprint), unit = f.plan.units[0]!;
      expect(() => f.repository.finishAttempt(f.projectId, job.id, unit.id, "none", { status: "completed", output: fixtureOutput(f.plan, 0) })).toThrow(/lifecycle/);
      const attempt = f.repository.beginAttempt(f.projectId, job.id, unit.id);
      expect(() => f.repository.beginAttempt(f.projectId, job.id, unit.id)).toThrow(/not_allowed/);
      f.repository.finishAttempt(f.projectId, job.id, unit.id, attempt.id, { status: "failed", diagnostic: "provider_failed" });
      expect(() => f.repository.finishAttempt(f.projectId, job.id, unit.id, attempt.id, { status: "completed", output: fixtureOutput(f.plan, 0) })).toThrow(/lifecycle/);
      f.repository.settle(f.projectId, job.id);
      expect(() => f.repository.beginAttempt(f.projectId, job.id, unit.id)).toThrow(/not_runnable/);
      f.repository.retry(f.projectId, job.id);
      const retry = f.repository.beginAttempt(f.projectId, job.id, unit.id);
      expect(retry.number).toBe(2);
      f.repository.finishAttempt(f.projectId, job.id, unit.id, retry.id, { status: "completed", output: fixtureOutput(f.plan, 0) });
      const done = completeFixture(f, job.id);
      expect(done.status).toBe("completed");
      expect(() => f.repository.beginAttempt(f.projectId, job.id, unit.id)).toThrow(/not_runnable/);
      expect(() => f.database.prepare("UPDATE source_analysis_outputs SET content_json = '{}'").run()).toThrow(/immutable/);
      expect(() => f.database.prepare("DELETE FROM source_analysis_attempts").run()).toThrow(/immutable/);
      expect(new WorkflowRepository(f.database).get(f.projectId, "source-dossier").status).toBe("draft");
      f.repository.validateProject(f.projectId);
    } finally { f.database.close(); }
  });
  it.each(["source", "source-scope"])("rejects late completion after %s changes without discarding completed history", (artifactId) => {
    const f = analysisFixture();
    try {
      const job = f.repository.createJob(f.projectId, f.plan.id, f.plan.fingerprint);
      const first = f.plan.units[0]!, second = f.plan.units[1]!;
      const a = f.repository.beginAttempt(f.projectId, job.id, first.id);
      f.repository.finishAttempt(f.projectId, job.id, first.id, a.id, { status: "completed", output: fixtureOutput(f.plan, 0) });
      const b = f.repository.beginAttempt(f.projectId, job.id, second.id);
      f.artifacts.saveArtifact({ projectId: f.projectId, artifactId, content: artifactId === "source" ? f.source : { chapterIds: ["ch_one"], sourceVersionId: f.plan.binding.sourceVersionId } });
      expect(() => f.repository.finishAttempt(f.projectId, job.id, second.id, b.id, { status: "completed", output: fixtureOutput(f.plan, 1) })).toThrow(/stale/);
      expect(f.repository.getJob(f.projectId, job.id).units.find((u) => u.id === first.id)?.status).toBe("completed");
      expect(f.artifacts.getCurrent(f.projectId, "source-dossier")).toBeUndefined();
      expect(() => f.database.prepare("UPDATE artifact_versions SET content_json = '{}' WHERE artifact_id = 'source'").run()).toThrow(/immutable/);
    } finally { f.database.close(); }
  });
  it("cancels pending/running/failed work, prevents retries and late commits, retains completed work", () => {
    const f = analysisFixture();
    try {
      const job = f.repository.createJob(f.projectId, f.plan.id, f.plan.fingerprint), unit = f.plan.units[0]!;
      const attempt = f.repository.beginAttempt(f.projectId, job.id, unit.id);
      const cancelled = f.repository.cancel(f.projectId, job.id);
      expect(cancelled.units.every((u) => u.status === "cancelled")).toBe(true);
      expect(() => f.repository.finishAttempt(f.projectId, job.id, unit.id, attempt.id, { status: "completed", output: fixtureOutput(f.plan, 0) })).toThrow(/lifecycle/);
      expect(() => f.repository.retry(f.projectId, job.id)).toThrow(/not_allowed/);
      f.repository.validateProject(f.projectId);
    } finally { f.database.close(); }
  });
  it("enforces attempt exhaustion", () => {
    const f = analysisFixture();
    try {
      const job = f.repository.createJob(f.projectId, f.plan.id, f.plan.fingerprint), unit = f.plan.units[0]!;
      for (let i = 0; i < 3; i++) {
        if (i) f.repository.retry(f.projectId, job.id);
        const attempt = f.repository.beginAttempt(f.projectId, job.id, unit.id);
        f.repository.finishAttempt(f.projectId, job.id, unit.id, attempt.id, { status: "failed" });
        f.repository.settle(f.projectId, job.id);
      }
      expect(() => f.repository.retry(f.projectId, job.id)).toThrow(/exhausted/);
    } finally { f.database.close(); }
  });
  it("corrects/rejects/reclassifies without rewriting observations; approval is exact and explicit", () => {
    const f = analysisFixture();
    try {
      const job = completeFixture(f);
      const initial = f.artifacts.getVersion<SourceDossier>(job.dossierVersionId!)!;
      const record = initial.content.records.find((r) => r.category === "theme")!;
      const corrected = f.repository.correct(f.projectId, initial.id, { kind: "classification", intent: "source-analysis-correction", reason: "Keep interpretation separate", previousVersionId: initial.id,
        recordId: record.id, classification: "inference", evidence: record.evidence });
      expect(f.artifacts.getVersion(initial.id)?.content).toEqual(initial.content);
      expect(() => f.repository.correct(f.projectId, corrected.id, { kind: "classification", intent: "author-override", reason: "Make them lovers", previousVersionId: corrected.id, recordId: record.id, classification: "source-canon", evidence: [] })).toThrow();
      expect(() => f.artifacts.saveArtifact({ projectId: f.projectId, artifactId: "source-dossier", content: { ...initial.content, records: [] } })).toThrow();
      const workflow = new WorkflowRepository(f.database);
      expect(() => workflow.approve(f.projectId, "source-dossier", initial.id)).toThrow(/current/);
      workflow.approve(f.projectId, "source-dossier", corrected.id);
      const rejected = f.repository.correct(f.projectId, corrected.id, { kind: "reject", intent: "source-analysis-correction", reason: "Unsupported interpretation", previousVersionId: corrected.id, recordId: record.id });
      expect(workflow.get(f.projectId, "source-dossier").status).toBe("draft");
      expect((rejected.content as SourceDossier).records.find((r) => r.id === record.id)?.status).toBe("rejected");
      expect((rejected.content as SourceDossier).provenance).toEqual(initial.content.provenance);
      f.repository.validateProject(f.projectId);
      const restored = f.artifacts.restore(f.projectId, "source-dossier", initial.id);
      expect(restored.content).toEqual(initial.content);
      f.repository.validateProject(f.projectId);
    } finally { f.database.close(); }
  });
  it("duplicates all source/evidence/job/correction/approval history and survives portable restore", () => {
    const f = analysisFixture(), target = openDatabase();
    try {
      const job = completeFixture(f), initial = f.artifacts.getVersion<SourceDossier>(job.dossierVersionId!)!;
      const record = initial.content.records[0]!;
      const corrected = f.repository.correct(f.projectId, initial.id, { kind: "evidence", intent: "source-analysis-correction", reason: "Exact excerpt", previousVersionId: initial.id, recordId: record.id, evidence: record.evidence });
      new WorkflowRepository(f.database).approve(f.projectId, "source-dossier", corrected.id);
      const copy = f.projects.duplicate(f.projectId);
      const dossier = f.artifacts.getCurrent<SourceDossier>(copy.id, "source-dossier")!;
      expect(dossier.content.projectId).toBe(copy.id);
      expect(dossier.content.binding.sourceVersionId).not.toBe(initial.content.binding.sourceVersionId);
      expect(dossier.content.provenance[0]?.jobId).not.toBe(job.id);
      assertSourceDossier(dossier.content, f.source, dossier.content.binding);
      f.repository.validateProject(copy.id);
      const exported = new PortableProjectRepository(f.database).exportRows(copy.id);
      expect(exported.tables.artifact_versions.some((v) => v.artifact_id === "source")).toBe(true);
      new PortableProjectRepository(target).importRows(exported, (db, id) => new SourceAnalysisRepository(db).validateProject(id));
      expect(new ArtifactRepository(target).getCurrent(copy.id, "source-dossier")?.content).toEqual(dossier.content);
      f.projects.remove(copy.id);
    } finally { f.database.close(); target.close(); }
  });
  it("freezes accepted schema-v19 bytes, migrates/reopens and resumes only incomplete units", () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-a3-migration-"));
    const fixture = new URL("./fixtures/schema-v19.sqlite", import.meta.url), path = join(directory, "v19.sqlite");
    try {
      expect(createHash("sha256").update(readFileSync(fixture)).digest("hex")).toBe("f7ebb621c20cc8e2666b512ea20476252bccc690e62c231b023263dd8038b171");
      copyFileSync(fixture, path);
      const f = analysisFixture(openDatabase(path));
      const job = f.repository.createJob(f.projectId, f.plan.id, f.plan.fingerprint);
      const unit = f.plan.units[0]!, next = f.plan.units[1]!;
      const attempt = f.repository.beginAttempt(f.projectId, job.id, unit.id);
      f.repository.finishAttempt(f.projectId, job.id, unit.id, attempt.id, { status: "completed", output: fixtureOutput(f.plan, 0) });
      f.repository.beginAttempt(f.projectId, job.id, next.id);
      f.database.close();
      const database = openDatabase(path), repository = new SourceAnalysisRepository(database);
      expect((database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(CURRENT_SCHEMA_VERSION);
      repository.recoverInterrupted(); repository.retry(f.projectId, job.id);
      completeFixture({ ...f, database, repository }, job.id);
      expect(repository.getJob(f.projectId, job.id).units.find((u) => u.id === unit.id)?.attempts).toHaveLength(1);
      expect(repository.getJob(f.projectId, job.id).units.find((u) => u.id === next.id)?.attempts).toHaveLength(2);
      repository.validateProject(f.projectId); database.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it("rolls back migration/trigger repair on corrupt analysis without modifying source bytes", () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-a3-corrupt-")), path = join(directory, "corrupt.sqlite");
    try {
      const f = analysisFixture(openDatabase(path)), job = completeFixture(f);
      f.database.exec("DROP TRIGGER source_analysis_units_terminal_immutable");
      f.database.prepare("UPDATE source_analysis_units SET status = 'running' WHERE job_id = ?").run(job.id);
      f.database.close();
      const before = createHash("sha256").update(readFileSync(path)).digest("hex");
      expect(() => openDatabase(path)).toThrow(/Migration/);
      expect(createHash("sha256").update(readFileSync(path)).digest("hex")).toBe(before);
      const db = new DatabaseSync(path);
      expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'source_analysis_units_terminal_immutable'").get()).toBeUndefined(); db.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
