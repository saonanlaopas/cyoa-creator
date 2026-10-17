import { z } from "zod";
import { sourceCanonicalJson, sourceDigest } from "@story-to-cyoa/domain";
import { planningArtifactIds } from "@story-to-cyoa/pipeline";
import { ArtifactRepository, PassageDraftAcceptanceRepository, PassageDraftRepository, PassagePlanRepository, type DraftAcceptanceApplication, type StoryDatabase } from "@story-to-cyoa/persistence";
import type { ConversationalEditService } from "./conversational-edit-service.js";
import type { PassagePlanService } from "./passage-plan-service.js";
import type { PassageDraftService } from "./passage-draft-service.js";
import type { SimulationService } from "./simulation-service.js";
import type { NativeCompilationService } from "./native-compilation-service.js";

const id = z.string().trim().min(1).max(240), digest = z.string().regex(/^[a-f0-9]{64}$/);
const project = { projectId: id }, operation = { ...project, operationId: z.string().uuid() };
const bound = { ...operation, headFingerprint: digest, approved: z.literal(true) };
const selections = z.array(z.object({ passageId: id, candidateDraftVersionId: id }).strict()).min(1).max(12);
export const ConnectedGameInputs = {
  game_state: z.object({ ...project, kind: z.enum(["passage", "choice", "thread"]).default("passage"), offset: z.number().int().min(0).max(50000).default(0) }).strict(),
  read_game_record: z.object({ ...project, kind: z.enum(["structure", "passage", "choice", "thread", "draft"]), entityId: id.default("root"), versionId: id.optional() }).strict(),
  initialize_game_plan: z.object(bound).strict(),
  review_game_plan: z.object(project).strict(),
  approve_game_plan: z.object({ ...bound, fingerprint: digest }).strict(),
  submit_draft: z.object({ ...bound, passageId: id, passageVersionId: id, request: z.string().trim().min(1).max(6000), proseMarkdown: z.string().min(1).max(96000) }).strict(),
  review_drafts: z.object({ ...project, selections }).strict(),
  accept_drafts: z.object({ ...operation, selections, fingerprint: digest, approved: z.literal(true) }).strict(),
  publication_readiness: z.object(project).strict(),
  compile_game: z.object({ ...bound, fingerprint: digest }).strict(),
  simulate_game: z.object({ ...bound, choiceIds: z.array(id).max(100), expectedEndingId: id.optional() }).strict(),
  read_simulation: z.object({ ...project, versionId: id, offset: z.number().int().min(0).max(10000).default(0) }).strict(),
  export_game: z.object({ ...project, buildVersionId: id, format: z.enum(["standalone", "static", "markdown"]), allowHistorical: z.boolean().default(false) }).strict(),
};
export type ConnectedGameTool = keyof typeof ConnectedGameInputs;
export const connectedGameMutations = new Set<ConnectedGameTool>(["initialize_game_plan", "approve_game_plan", "submit_draft", "accept_drafts", "compile_game", "simulate_game"]);

export class ConnectedGameService {
  private readonly passages: PassagePlanRepository;
  private readonly drafts: PassageDraftRepository;
  private readonly artifacts: ArtifactRepository;
  constructor(private readonly database: StoryDatabase, private readonly edits: ConversationalEditService,
    private readonly plans: PassagePlanService, private readonly prose: PassageDraftService,
    private readonly simulations: SimulationService, private readonly compilation: NativeCompilationService) {
    this.passages = new PassagePlanRepository(database); this.drafts = new PassageDraftRepository(database); this.artifacts = new ArtifactRepository(database);
  }
  private head(projectId: string) {
    return sourceDigest({ project: this.edits.connectedState(projectId).headFingerprint,
      drafts: this.database.prepare("SELECT passage_id,current_version_id,accepted_version_id,accepted_locked FROM passage_draft_heads WHERE project_id=? ORDER BY passage_id").all(projectId),
      playerConfig: this.artifacts.getCurrent(projectId, "native-player-config")?.id ?? null,
      overrides: this.passages.listOverrides(projectId) });
  }
  private fresh(projectId: string, fingerprint: string) {
    if (this.head(projectId) !== fingerprint) throw new Error("connected_game_head_stale_read_state_and_repreview");
  }
  private approvedFoundations(projectId: string) {
    const state = this.edits.connectedState(projectId);
    if (state.workflow.some(({ artifactId, currentVersionId, workflow }) => planningArtifactIds.includes(artifactId)
      && (!currentVersionId || workflow.status !== "approved" || workflow.approvedVersionId !== currentVersionId || this.artifacts.getCurrent(projectId, artifactId)?.stale))) {
      throw new Error("connected_current_foundation_approvals_required");
    }
  }
  private planReview(projectId: string) {
    this.approvedFoundations(projectId);
    const report = this.plans.validate(projectId), headFingerprint = this.head(projectId);
    return { headFingerprint, fingerprint: sourceDigest({ headFingerprint, report }), report: { ...report, findings: report.findings.slice(0, 50), totalFindings: report.findings.length, omittedFindings: Math.max(0, report.findings.length - 50) }, providerCalls: 0 };
  }
  private readiness(projectId: string) {
    const full = this.compilation.readiness(projectId), headFingerprint = this.head(projectId);
    const { inputPreview: _input, diagnostics, blockers, warnings, acknowledgedWarnings, ...summary } = full;
    return { ...summary, headFingerprint, fingerprint: sourceDigest({ headFingerprint, readiness: full }),
      blockers: blockers.slice(0, 50), warnings: warnings.slice(0, 50), acknowledgedWarnings: acknowledgedWarnings.slice(0, 50),
      counts: { blockers: blockers.length, warnings: warnings.length, acknowledgedWarnings: acknowledgedWarnings.length, diagnostics: diagnostics.length },
      omittedFindings: Math.max(0, blockers.length - 50) + Math.max(0, warnings.length - 50) + Math.max(0, acknowledgedWarnings.length - 50) };
  }
  call(tool: ConnectedGameTool, value: unknown): unknown {
    switch (tool) {
      case "game_state": {
        const i = ConnectedGameInputs.game_state.parse(value);
        const rows = this.database.prepare(`SELECT h.entity_id AS entityId,h.version_id AS versionId,
          substr(COALESCE(json_extract(v.content_json,'$.title'),json_extract(v.content_json,'$.label'),h.entity_id),1,300) AS label,
          d.current_version_id AS candidateOrCurrentDraftVersionId,d.accepted_version_id AS acceptedDraftVersionId,d.accepted_locked AS acceptedLocked
          FROM passage_entity_heads h JOIN passage_entity_versions v ON v.id=h.version_id
          LEFT JOIN passage_draft_heads d ON d.project_id=h.project_id AND d.passage_id=h.entity_id AND h.entity_kind='passage'
          WHERE h.project_id=? AND h.entity_kind=? AND h.tombstoned=0 ORDER BY h.entity_id LIMIT 50 OFFSET ?`).all(i.projectId, i.kind, i.offset);
        const total = this.database.prepare("SELECT COUNT(*) total FROM passage_entity_heads WHERE project_id=? AND entity_kind=? AND tombstoned=0").get(i.projectId, i.kind) as { total: number };
        return { headFingerprint: this.head(i.projectId), structureVersionId: this.passages.currentStructure(i.projectId)?.id ?? null, state: this.passages.state(i.projectId), kind: i.kind, offset: i.offset, total: total.total, items: rows };
      }
      case "read_game_record": {
        const i = ConnectedGameInputs.read_game_record.parse(value);
        if (i.kind === "structure") {
          const version = i.versionId ? this.passages.getStructureVersion(i.versionId) : this.passages.currentStructure(i.projectId);
          if (!version || version.projectId !== i.projectId || i.entityId !== "root") throw new Error("connected_game_record_not_found");
          return { record: version, headFingerprint: this.head(i.projectId) };
        }
        if (i.kind === "draft") {
          const head = this.drafts.getHead(i.projectId, i.entityId);
          const draft = i.versionId ? this.drafts.getVersion(i.projectId, i.versionId) : head?.current;
          if (!draft || draft.passageId !== i.entityId) throw new Error("connected_draft_not_found");
          return { draft, head: head ? { currentVersionId: head.current.id, acceptedVersionId: head.accepted?.id ?? null, acceptedLocked: head.acceptedLocked } : null, headFingerprint: this.head(i.projectId) };
        }
        const record = i.versionId ? this.passages.getEntityVersion(i.versionId) : this.passages.currentEntity(i.projectId, i.kind, i.entityId);
        if (!record || record.projectId !== i.projectId || record.entityKind !== i.kind || record.entityId !== i.entityId) throw new Error("connected_game_record_not_found");
        return { record, headFingerprint: this.head(i.projectId) };
      }
      case "initialize_game_plan": {
        const i = ConnectedGameInputs.initialize_game_plan.parse(value); this.fresh(i.projectId, i.headFingerprint); this.approvedFoundations(i.projectId);
        this.plans.create(i.projectId, { inTransaction: true });
        return { structureVersionId: this.passages.currentStructure(i.projectId)!.id, status: "draft", providerCalls: 0 };
      }
      case "review_game_plan": return this.planReview(ConnectedGameInputs.review_game_plan.parse(value).projectId);
      case "approve_game_plan": {
        const i = ConnectedGameInputs.approve_game_plan.parse(value); this.fresh(i.projectId, i.headFingerprint);
        if (this.planReview(i.projectId).fingerprint !== i.fingerprint) throw new Error("connected_plan_review_stale_repreview");
        const snapshot = this.plans.createSnapshot(i.projectId, { inTransaction: true });
        this.plans.approve(i.projectId, snapshot.id, { inTransaction: true });
        return { snapshotId: snapshot.id, structureVersionId: snapshot.structureVersionId, fingerprint: i.fingerprint, status: "approved", providerCalls: 0 };
      }
      case "submit_draft": {
        const i = ConnectedGameInputs.submit_draft.parse(value); this.fresh(i.projectId, i.headFingerprint); this.approvedFoundations(i.projectId);
        if (this.passages.state(i.projectId).status !== "approved") throw new Error("connected_approved_current_plan_required");
        if (this.passages.currentEntity(i.projectId, "passage", i.passageId)?.id !== i.passageVersionId) throw new Error("connected_passage_version_stale");
        const result = this.prose.saveManual(i.projectId, i.passageId, { proseMarkdown: i.proseMarkdown, authorNote: `Connected assistant; no provider generation. Author request: ${i.request}` }, { inTransaction: true });
        return { draftVersionId: result.draft.id, passageId: i.passageId, status: "candidate", provenance: "connected-assistant", providerCalls: 0 };
      }
      case "review_drafts": {
        const i = ConnectedGameInputs.review_drafts.parse(value), preview = this.prose.previewAcceptance(i.projectId, i);
        const texts = i.selections.map((s) => ({ ...s, candidate: this.drafts.getVersion(i.projectId, s.candidateDraftVersionId)?.proseMarkdown ?? null,
          previousAccepted: this.drafts.getHead(i.projectId, s.passageId)?.accepted?.proseMarkdown ?? null }));
        return { ...preview, texts, providerCalls: 0 };
      }
      case "accept_drafts": {
        const i = ConnectedGameInputs.accept_drafts.parse(value); this.approvedFoundations(i.projectId);
        if (this.passages.state(i.projectId).status !== "approved") throw new Error("connected_approved_current_plan_required");
        const result = this.prose.acceptInTransaction(i.projectId, { selections: i.selections, previewFingerprint: i.fingerprint });
        return { application: result.application, providerCalls: 0 };
      }
      case "publication_readiness": return this.readiness(ConnectedGameInputs.publication_readiness.parse(value).projectId);
      case "compile_game": {
        const i = ConnectedGameInputs.compile_game.parse(value); this.fresh(i.projectId, i.headFingerprint); this.approvedFoundations(i.projectId);
        if (this.readiness(i.projectId).fingerprint !== i.fingerprint) throw new Error("connected_publication_review_stale_repreview");
        const result = this.compilation.compile(i.projectId, undefined, { inTransaction: true });
        return { inputVersionId: result.input.id, buildVersionId: result.build.id, build: result.build.content, providerCalls: 0 };
      }
      case "simulate_game": {
        const i = ConnectedGameInputs.simulate_game.parse(value); this.fresh(i.projectId, i.headFingerprint); this.approvedFoundations(i.projectId);
        const input = this.simulations.createInput(i.projectId, { inTransaction: true });
        const run = this.simulations.run(i.projectId, { inputArtifactVersionId: input.id, choiceIds: i.choiceIds, ...(i.expectedEndingId ? { expectedEndingId: i.expectedEndingId } : {}) }, { inTransaction: true });
        return { inputVersionId: input.id, runVersionId: run.id, result: run.content.trace.result, providerCalls: 0 };
      }
      case "read_simulation": {
        const i = ConnectedGameInputs.read_simulation.parse(value), run = this.simulations.getRun(i.projectId, i.versionId);
        const { steps, ...trace } = run.content.trace;
        return { versionId: run.id, inputVersionId: run.content.inputArtifactVersionId, trace: { ...trace, steps: steps.slice(i.offset, i.offset + 50) }, totalSteps: steps.length, offset: i.offset, omittedSteps: Math.max(0, steps.length - i.offset - 50) };
      }
      case "export_game": {
        const i = ConnectedGameInputs.export_game.parse(value), build = this.compilation.validateBuild(i.projectId, i.buildVersionId);
        const historical = this.compilation.readiness(i.projectId).sourceInputFingerprint !== build.content.sourceInputFingerprint;
        if (historical && !i.allowHistorical) throw new Error("connected_build_historical_recompile_or_explicitly_allow_history");
        return { buildVersionId: build.id, inputVersionId: build.content.compilationInputArtifactVersionId, bundleFingerprint: build.content.bundleFingerprint, historical,
          format: i.format, downloadPath: `/api/long-form/projects/${encodeURIComponent(i.projectId)}/publication/exports/${i.format}?inputArtifactVersionId=${encodeURIComponent(build.content.compilationInputArtifactVersionId)}`,
          playerConfigPolicy: "current-player-config", delivery: "download-link-rendered-on-fetch", providerCalls: 0 };
      }
    }
  }
  assertReceipt(tool: ConnectedGameTool, value: unknown, result: unknown) {
    const equal = (a: unknown, b: unknown) => sourceCanonicalJson(a) === sourceCanonicalJson(b);
    const r = result as Record<string, any>, input = ConnectedGameInputs[tool].parse(value);
    if (r.providerCalls !== 0) throw new Error("connected_receipt_lineage_invalid");
    if (tool === "initialize_game_plan") {
      const version = this.passages.getStructureVersion(r.structureVersionId);
      if (!version || version.projectId !== input.projectId || version.version !== 1 || r.status !== "draft") throw new Error("connected_receipt_lineage_invalid");
    } else if (tool === "approve_game_plan") {
      const i = ConnectedGameInputs.approve_game_plan.parse(value), snapshot = this.passages.getSnapshot(r.snapshotId);
      if (!snapshot || snapshot.projectId !== i.projectId || snapshot.status !== "approved" || snapshot.structureVersionId !== r.structureVersionId || r.fingerprint !== i.fingerprint || r.status !== "approved") throw new Error("connected_receipt_lineage_invalid");
    } else if (tool === "submit_draft") {
      const i = ConnectedGameInputs.submit_draft.parse(value), draft = this.drafts.getVersion(i.projectId, r.draftVersionId);
      if (!draft || draft.passageId !== i.passageId || r.passageId !== i.passageId || draft.basedOnPassagePlanVersionId !== i.passageVersionId || draft.proseMarkdown !== i.proseMarkdown
        || draft.lifecycleStatus !== "candidate" || draft.sourceKind !== "manual" || draft.authorNote !== `Connected assistant; no provider generation. Author request: ${i.request}` || r.provenance !== "connected-assistant" || r.status !== "candidate") throw new Error("connected_receipt_lineage_invalid");
    } else if (tool === "accept_drafts") {
      const i = ConnectedGameInputs.accept_drafts.parse(value), application = r.application as DraftAcceptanceApplication;
      const selected = [...i.selections].sort((a, b) => a.passageId.localeCompare(b.passageId));
      if (!application || application.projectId !== i.projectId || application.previewFingerprint !== i.fingerprint || !equal(application.selectedCandidates, selected)) throw new Error("connected_receipt_lineage_invalid");
      if (application.id) {
        const saved = new PassageDraftAcceptanceRepository(this.database, this.drafts).listApplications(i.projectId).find((row) => row.id === application.id);
        if (!saved || !equal(saved, application)) throw new Error("connected_receipt_lineage_invalid");
      } else for (const selection of i.selections) {
        const rows = this.database.prepare("SELECT resulting_accepted_version_id id FROM passage_draft_acceptance_items WHERE project_id=? AND passage_id=? AND candidate_version_id=?").all(i.projectId, selection.passageId, selection.candidateDraftVersionId) as { id: string }[];
        const target = application.resultingAcceptedVersions[selection.passageId];
        if (!target || !rows.some((row) => this.drafts.acceptedVersionsAreEquivalent(i.projectId, row.id, target))) throw new Error("connected_receipt_lineage_invalid");
      }
    } else if (tool === "simulate_game") {
      const i = ConnectedGameInputs.simulate_game.parse(value), run = this.simulations.validateRun(i.projectId, r.runVersionId);
      if (run.content.inputArtifactVersionId !== r.inputVersionId || !equal(run.content.path.choiceIds, i.choiceIds) || run.content.path.expectedEndingId !== i.expectedEndingId || !equal(run.content.trace.result, r.result)) throw new Error("connected_receipt_lineage_invalid");
    } else if (tool === "compile_game") {
      const build = this.compilation.validateBuild(input.projectId, r.buildVersionId);
      if (build.content.compilationInputArtifactVersionId !== r.inputVersionId || !equal(build.content, r.build)) throw new Error("connected_receipt_lineage_invalid");
    }
  }
}
