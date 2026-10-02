import { describe, expect, it } from "vitest";
import { ArtifactRepository, PortableProjectRepository, ProjectRepository, WorkflowRepository, openDatabase, validateAdaptationDatabase } from "@story-to-cyoa/persistence";
import { newAdaptationIntent, normalizeAdaptationIntent, type AdaptationIntent, type SourceDossier } from "@story-to-cyoa/domain";
import { analysisFixture, completeFixture } from "../../../packages/persistence/test/source-analysis-fixture.js";
import { RecoveryService } from "../src/services/recovery-service.js";
import { PublicationExportService } from "../src/services/publication-export-service.js";
import { AdaptationIntentService } from "../src/services/adaptation-intent-service.js";
import { DeterministicAdaptationIntentProvider } from "../src/services/adaptation-intent-provider.js";

describe("A4 verified recovery", () => {
  it("round-trips every origin category, exact evidence, version/approval history and applied proposals through verified backup", async () => {
    const f = analysisFixture(); completeFixture(f); const target = openDatabase();
    try {
      const workflow = new WorkflowRepository(f.database), dossier = f.artifacts.getCurrent<SourceDossier>(f.projectId, "source-dossier")!;
      workflow.approve(f.projectId, "source-dossier", dossier.id);
      const record = dossier.content.records.find((r) => r.category === "character")!, common = { scope: "project", rationale: "Reviewed author preference", provenance: { origin: "manual" as const, projectId: f.projectId } };
      const intent = normalizeAdaptationIntent({ ...newAdaptationIntent(f.projectId, { dossierVersionId: dossier.id, dossierMaterialFingerprint: dossier.content.materialFingerprint, source: dossier.content.binding }),
        overrides: [{ ...common, id: "override", authority: "author-override", targetIds: [record.id], aspect: "state", effect: "Different adaptation state", active: true, reviewed: true }],
        inventions: [{ ...common, id: "new-scene", origin: "adaptation-only", kind: "scene", description: "New scene", dependencyIds: ["override"] }],
        obligations: [{ ...common, id: "obligation", kind: "character-state", status: "requested", targetIds: [record.id], evidence: [record.evidence[0]!], requirement: "Request the source identity", strength: "required", transformations: ["change-delivery"] }],
        exceptions: [{ ...common, id: "exception", obligationId: "obligation", targetIds: [record.id], evidence: [record.evidence[0]!], permission: "Change delivery", reviewed: true }],
        expansion: (["source-elaboration", "override-consequence", "adaptation-only", "branching", "connective"] as const).map((origin) => ({ ...common, id: origin, origin, description: origin,
          sourceRecordIds: origin === "source-elaboration" ? [record.id] : [], overrideIds: origin === "override-consequence" ? ["override"] : [], inventionIds: origin === "adaptation-only" ? ["new-scene"] : [], dependencyIds: [], allocation: { kind: "unknown" as const } })) });
      const first = f.artifacts.saveArtifact({ projectId: f.projectId, artifactId: "adaptation-intent", content: intent });
      const provider = new DeterministicAdaptationIntentProvider(), service = new AdaptationIntentService(f.database, f.artifacts, workflow, [provider]);
      const p = service.preview(f.projectId, { request: "Keep source identity; flexible structure", recordIds: [record.id], providerId: provider.id, modelId: "offline" });
      const suggestion = await service.generate(f.projectId, p.id, p.fingerprint); service.apply(f.projectId, suggestion.versionId);
      workflow.approve(f.projectId, "adaptation-intent", f.artifacts.getCurrent(f.projectId, "adaptation-intent")!.id);
      const portable = new PortableProjectRepository(f.database), publication = new PublicationExportService(portable, undefined);
      const recovery = new RecoveryService(f.database, portable, publication, {});
      const backup = await recovery.createVerifiedBackup(f.projectId); expect(backup.record.verificationStatus).toBe("verified");
      const destination = new PortableProjectRepository(target), restore = new RecoveryService(target, destination, new PublicationExportService(destination, undefined), {});
      await restore.restoreBackup(backup.bytes); validateAdaptationDatabase(target);
      const artifacts = new ArtifactRepository(target), current = artifacts.getCurrent<AdaptationIntent>(f.projectId, "adaptation-intent")!;
      expect(current.content.expansion.map((v) => v.origin)).toEqual(intent.expansion.map((v) => v.origin));
      expect(artifacts.getVersion(first.id)!.content).toEqual(intent); expect(current.content.obligations[0]!.evidence).toEqual(intent.obligations[0]!.evidence);
      expect(new WorkflowRepository(target).get(f.projectId, "adaptation-intent").status).toBe("approved");
      const copy = new ProjectRepository(target).duplicate(f.projectId); new ProjectRepository(target).remove(f.projectId); validateAdaptationDatabase(target, copy.id);
      expect(new ArtifactRepository(target).getCurrent<AdaptationIntent>(copy.id, "adaptation-intent")!.content.binding.dossierVersionId).not.toBe(dossier.id);
      expect(provider.calls).toHaveLength(1);
    } finally { f.database.close(); target.close(); }
  });
});
