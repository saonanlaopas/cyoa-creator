import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ADAPTATION_INTENT_LIMITS, AdaptationIntentSchema, AdaptationPreviewInputSchema, AdaptationSuggestionSchema, FidelityPolicySchema, PlannedWordsSchema,
  FIDELITY_PRESETS, adaptationBudget, adaptationOverrideConflicts, applyAdaptationOperations, assertRequestedSemantics, expandFidelityPreset, legacyFidelityPreset,
  newAdaptationIntent, normalizeAdaptationIntent, sourceCanonicalJson, sourceDigest, type AdaptationIntent, type AdaptationProposal } from "@story-to-cyoa/domain";
import { ArtifactRepository, WorkflowRepository, adaptationSuggestionContext, assertAdaptationFresh, assertAdaptationProposalBudget, transaction, validateAdaptationIntent, type ArtifactVersion, type StoryDatabase } from "@story-to-cyoa/persistence";
import type { AdaptationIntentProvider } from "./adaptation-intent-provider.js";

const createSchema = z.object({ preset: z.enum(FIDELITY_PRESETS).default("meaningful-divergence"), legacyBriefVersionId: z.string().min(1).optional() }).strict();
const patchSchema = z.object({ baseVersionId: z.string().min(1), preset: z.enum(FIDELITY_PRESETS).optional(), dimensions: FidelityPolicySchema.optional(),
  preserveCanonRoute: z.boolean().optional(), endingIntent: z.enum(["preserve-ending", "preserve-result-alter-mechanism", "allow-alternates", "not-required", "specific-state"]).optional(),
  budget: z.object({ sourceEquivalent: PlannedWordsSchema, target: PlannedWordsSchema, discrepancyReviewed: z.boolean() }).strict().optional(),
  operations: AdaptationSuggestionSchema.shape.operations.optional() }).strict();
type Preview = { id: string; projectId: string; baseVersionId: string | null; binding: AdaptationIntent["binding"]; input: AdaptationProposal["input"];
  fingerprint: string; expiresAt: number; context: unknown; bytes: number };
export class AdaptationIntentService {
  private readonly previews = new Map<string, Preview>();
  private readonly running = new Map<string, AbortController>();
  constructor(private readonly database: StoryDatabase, private readonly artifacts: ArtifactRepository,
    private readonly workflow: WorkflowRepository, private readonly providers: AdaptationIntentProvider[]) {}
  private binding(projectId: string): AdaptationIntent["binding"] {
    const dossier = this.artifacts.getCurrent<import("@story-to-cyoa/domain").SourceDossier>(projectId, "source-dossier");
    if (!dossier) throw new Error("adaptation_approved_dossier_required");
    const binding = { dossierVersionId: dossier.id, dossierMaterialFingerprint: dossier.content.materialFingerprint, source: dossier.content.binding };
    assertAdaptationFresh(this.database, newAdaptationIntent(projectId, binding));
    return binding;
  }
  state(projectId: string) {
    const current = this.artifacts.getCurrent<AdaptationIntent>(projectId, "adaptation-intent");
    let approvedDossier: AdaptationIntent["binding"] | null = null;
    try { approvedDossier = this.binding(projectId); } catch { /* Source-specific adoption remains explicit and gated. */ }
    let stale = current?.stale ?? false;
    if (current) try { assertAdaptationFresh(this.database, current.content); } catch { stale = true; }
    const brief = this.artifacts.getCurrent<{ adaptationFidelity?: string }>(projectId, "brief");
    const legacy = brief?.content.adaptationFidelity;
    const legacyProjection = legacy && ["canon-centered", "balanced", "expansive"].includes(legacy) ? {
      briefVersionId: brief!.id, value: legacy, dimensions: expandFidelityPreset(legacyFidelityPreset(legacy as "canon-centered" | "balanced" | "expansive")), adopted: Boolean(current) } : null;
    if (!current) return { current: null, approvedDossier, workflow: this.workflow.get(projectId, "adaptation-intent"), legacyProjection };
    const { overrides, inventions, obligations, exceptions, expansion, ...policy } = current.content;
    return { current: { id: current.id, version: current.version, stale, policy, counts: { overrides: overrides.length, inventions: inventions.length, obligations: obligations.length, exceptions: exceptions.length, expansion: expansion.length },
      reconciliation: adaptationBudget(current.content), conflicts: adaptationOverrideConflicts(overrides) }, approvedDossier,
      workflow: { ...this.workflow.get(projectId, "adaptation-intent"), ...(stale ? { status: "stale" } : {}) }, legacyProjection };
  }
  create(projectId: string, value: unknown) {
    const input = createSchema.parse(value);
    if (this.artifacts.getCurrent(projectId, "adaptation-intent")) throw new Error("adaptation_already_exists");
    const intent = newAdaptationIntent(projectId, this.binding(projectId), input.preset);
    if (input.legacyBriefVersionId) {
      const brief = this.artifacts.getCurrent<{ adaptationFidelity: "canon-centered" | "balanced" | "expansive" }>(projectId, "brief");
      if (!brief || brief.id !== input.legacyBriefVersionId) throw new Error("adaptation_legacy_brief_stale");
      intent.preset = legacyFidelityPreset(brief.content.adaptationFidelity); intent.dimensions = expandFidelityPreset(intent.preset);
      intent.revision = { kind: "legacy-adoption", previousVersionId: null, legacyBriefVersionId: brief.id, legacyFidelity: brief.content.adaptationFidelity };
    }
    this.artifacts.saveArtifact({ projectId, artifactId: "adaptation-intent", content: normalizeAdaptationIntent(intent) });
    return this.state(projectId);
  }
  patch(projectId: string, value: unknown) {
    const input = patchSchema.parse(value), current = this.artifacts.getCurrent<AdaptationIntent>(projectId, "adaptation-intent");
    if (!current || current.id !== input.baseVersionId) throw new Error("adaptation_base_stale");
    let next = structuredClone(current.content);
    if (input.operations) {
      next = applyAdaptationOperations(next, { schemaVersion: 1, intent: "adaptation-preference", operations: input.operations }, sourceDigest(input));
      const changed = new Set(input.operations.flatMap((o) => "value" in o ? [o.value.id] : []));
      for (const item of [...next.overrides, ...next.inventions, ...next.obligations, ...next.exceptions, ...next.expansion]) if (changed.has(item.id)) item.provenance = { origin: "manual", projectId };
    }
    if (input.preset) { next.preset = input.preset; next.dimensions = expandFidelityPreset(input.preset); }
    if (input.dimensions) { next.dimensions = input.dimensions; next.preset = null; }
    if (input.preserveCanonRoute !== undefined) next.preserveCanonRoute = input.preserveCanonRoute;
    if (input.endingIntent !== undefined) next.endingIntent = input.endingIntent;
    if (input.budget) next.budget = input.budget;
    next.revision = { kind: "manual", previousVersionId: current.id };
    this.artifacts.saveArtifact({ projectId, artifactId: "adaptation-intent", content: normalizeAdaptationIntent(next) });
    return this.state(projectId);
  }
  validate(projectId: string) {
    const current = this.current(projectId);
    validateAdaptationIntent(this.database, projectId, current.content); assertAdaptationFresh(this.database, current.content);
    return { valid: true, reconciliation: adaptationBudget(current.content), reviewRequired: current.content.overrides.filter((o) => o.active && !o.reviewed).map((o) => o.id).concat(current.content.exceptions.filter((e) => !e.reviewed).map((e) => e.id)) };
  }
  current(projectId: string) {
    const current = this.artifacts.getCurrent<AdaptationIntent>(projectId, "adaptation-intent");
    if (!current) throw new Error("adaptation_intent_missing");
    return current;
  }
  collection(projectId: string, collection: "overrides" | "inventions" | "obligations" | "exceptions" | "expansion", offset: number, search: string, versionId?: string) {
    const version = versionId ? this.artifacts.getVersion<AdaptationIntent>(versionId) : this.current(projectId);
    if (!version || version.projectId !== projectId || version.artifactId !== "adaptation-intent") throw new Error("adaptation_version_missing");
    const items = version.content[collection].filter((v) => JSON.stringify(v).toLowerCase().includes(search.toLowerCase()));
    return { total: items.length, items: items.slice(offset, offset + 20).map((item) => ({ id: item.id, scope: item.scope, rationale: item.rationale.slice(0, 200),
      ...("effect" in item ? { effect: item.effect, active: item.active, reviewed: item.reviewed } : "requirement" in item ? { requirement: item.requirement, kind: item.kind } : "permission" in item ? { permission: item.permission, reviewed: item.reviewed } : { description: item.description, origin: item.origin }) })) };
  }
  item(projectId: string, collection: "overrides" | "inventions" | "obligations" | "exceptions" | "expansion", id: string) {
    const item = this.current(projectId).content[collection].find((v) => v.id === id);
    if (!item) throw new Error("adaptation_item_missing");
    return item;
  }
  sourceRecords(projectId: string, offset: number, search: string) {
    const binding = this.artifacts.getCurrent<AdaptationIntent>(projectId, "adaptation-intent")?.content.binding ?? this.binding(projectId);
    const dossier = this.artifacts.getVersion<import("@story-to-cyoa/domain").SourceDossier>(binding.dossierVersionId)!;
    const items = dossier.content.records.filter((r) => r.status === "supported" && `${r.id} ${r.identityKey} ${r.field} ${r.claim}`.toLowerCase().includes(search.toLowerCase()));
    return { total: items.length, items: items.slice(offset, offset + 20).map((r) => ({ id: r.id, identityKey: r.identityKey, field: r.field, classification: r.classification })) };
  }
  proposals(projectId: string, offset: number) {
    const rows = this.database.prepare(`SELECT id,content_json FROM artifact_versions v WHERE project_id = ? AND artifact_type = 'adaptation-intent-proposal'
      AND version = (SELECT MAX(version) FROM artifact_versions WHERE project_id = v.project_id AND artifact_id = v.artifact_id)
      ORDER BY created_at DESC,id LIMIT 20 OFFSET ?`).all(projectId, offset) as Array<{ id: string; content_json: string }>;
    return { items: rows.map((r) => { const p = JSON.parse(r.content_json) as AdaptationProposal; return { versionId: r.id, status: p.status, request: p.input.request.slice(0, 200), baseVersionId: p.baseVersionId }; }) };
  }
  proposalReview(projectId: string, versionId: string) {
    const p = this.artifacts.getVersion<AdaptationProposal>(versionId);
    if (!p || p.projectId !== projectId || p.artifactType !== "adaptation-intent-proposal") throw new Error("adaptation_proposal_missing");
    return { versionId: p.id, operations: p.content.suggestion.operations, reconciliation: adaptationBudget(p.content.candidate), status: p.content.status };
  }
  history(projectId: string, offset: number) {
    const items = this.artifacts.listVersions<AdaptationIntent>(projectId, "adaptation-intent");
    return { total: items.length, items: items.slice(offset, offset + 20).map((v) => ({ id: v.id, version: v.version, createdAt: v.createdAt, stale: v.stale, revision: v.content.revision, materialFingerprint: v.content.materialFingerprint, provenanceFingerprint: v.content.provenanceFingerprint })) };
  }
  compare(projectId: string, fromId: string, toId: string) {
    const compared = this.artifacts.compare(projectId, "adaptation-intent", fromId, toId);
    const from = AdaptationIntentSchema.parse(compared.from.content), to = AdaptationIntentSchema.parse(compared.to.content);
    return { materialEqual: from.materialFingerprint === to.materialFingerprint, provenanceEqual: from.provenanceFingerprint === to.provenanceFingerprint,
      dimensions: { from: from.dimensions, to: to.dimensions }, budget: { from: from.budget, to: to.budget },
      changedIds: ["overrides", "inventions", "obligations", "exceptions", "expansion"].flatMap((key) => {
        const a = from[key as "overrides"], b = to[key as "overrides"];
        return [...new Set([...a, ...b].map((v) => v.id))].filter((id) => sourceCanonicalJson(a.find((v) => v.id === id) ?? null) !== sourceCanonicalJson(b.find((v) => v.id === id) ?? null));
      }) };
  }
  restore(projectId: string, versionId: string) { this.artifacts.restore(projectId, "adaptation-intent", versionId); return this.state(projectId); }
  review(projectId: string, versionId: string) { this.workflow.markReviewed(projectId, "adaptation-intent", versionId); return this.state(projectId); }
  approve(projectId: string, versionId: string) { this.workflow.approve(projectId, "adaptation-intent", versionId); return this.state(projectId); }
  preview(projectId: string, value: unknown) {
    assertAdaptationProposalBudget(this.database, projectId, undefined, true);
    const input = AdaptationPreviewInputSchema.parse(value);
    if (/\b(?:source actually says|correct (?:the )?(?:source|analysis|dossier))\b/i.test(input.request)) throw new Error("adaptation_source_correction_requires_a3");
    if (!this.providers.some((p) => p.id === input.providerId)) throw new Error("adaptation_provider_invalid");
    const binding = this.binding(projectId), current = this.artifacts.getCurrent<AdaptationIntent>(projectId, "adaptation-intent");
    if (current && sourceCanonicalJson(current.content.binding) !== sourceCanonicalJson(binding)) throw new Error("adaptation_dossier_stale");
    const context = adaptationSuggestionContext(this.database, projectId, binding, current?.id ?? null, input);
    for (const [id, preview] of this.previews) if (preview.expiresAt <= Date.now()) this.previews.delete(id);
    if (this.previews.size >= 32) this.previews.delete(this.previews.keys().next().value!);
    const preview: Preview = { id: randomUUID(), projectId, baseVersionId: current?.id ?? null, binding, input,
      fingerprint: context.fingerprint, expiresAt: Date.now() + 10 * 60_000, context: context.context, bytes: Buffer.byteLength(context.serialized) };
    this.previews.set(preview.id, preview);
    return { id: preview.id, fingerprint: preview.fingerprint, baseVersionId: preview.baseVersionId, precondition: preview.baseVersionId ? "exact-base" : "must-not-exist",
      binding, providerId: input.providerId, modelId: input.modelId, promptVersion: "adaptation-intent-v1", schemaVersion: 1,
      records: context.context.records, budget: context.context.budget, bytes: preview.bytes, maximumContextBytes: ADAPTATION_INTENT_LIMITS.contextBytes,
      maximumOutputBytes: ADAPTATION_INTENT_LIMITS.outputBytes, maximumOutputTokens: 4000, estimatedInputTokens: Math.ceil(preview.bytes / 4),
      cost: input.providerId === "offline-adaptation-intent" ? 0 : null, costStatus: input.providerId === "offline-adaptation-intent" ? "known" : "unknown" };
  }
  private fresh(preview: Preview) {
    assertAdaptationProposalBudget(this.database, preview.projectId, undefined, true);
    assertAdaptationFresh(this.database, newAdaptationIntent(preview.projectId, preview.binding));
    const current = this.artifacts.getCurrent(preview.projectId, "adaptation-intent");
    if ((current?.id ?? null) !== preview.baseVersionId || preview.expiresAt <= Date.now()) throw new Error("adaptation_proposal_stale");
    const context = adaptationSuggestionContext(this.database, preview.projectId, preview.binding, preview.baseVersionId, preview.input);
    if (context.fingerprint !== preview.fingerprint) throw new Error("adaptation_proposal_stale");
    return context;
  }
  async generate(projectId: string, previewId: string, fingerprint: string) {
    const preview = this.previews.get(previewId);
    if (!preview || preview.projectId !== projectId || preview.fingerprint !== fingerprint) throw new Error("adaptation_preview_invalid");
    if (this.running.has(projectId)) throw new Error("adaptation_generation_running");
    this.fresh(preview); this.previews.delete(previewId);
    const controller = new AbortController(); this.running.set(projectId, controller);
    const timeout = setTimeout(() => controller.abort(), 60_000);
    const provider = this.providers.find((p) => p.id === preview.input.providerId)!;
    const parse = (raw: string) => {
      if (Buffer.byteLength(raw) > ADAPTATION_INTENT_LIMITS.outputBytes) throw new Error("adaptation_output_overflow");
      assertRequestedSemantics(raw); return AdaptationSuggestionSchema.parse(JSON.parse(raw));
    };
    try {
      this.fresh(preview);
      const raw = await provider.generate({ context: preview.context, modelId: preview.input.modelId, mode: "suggest", signal: controller.signal });
      this.fresh(preview);
      let suggestion;
      try { suggestion = parse(raw); } catch (error) {
        if ((error as Error).message.startsWith("adaptation_")) throw error;
        this.fresh(preview);
        const repaired = await provider.generate({ context: preview.context, modelId: preview.input.modelId, mode: "repair", malformedOutput: raw, signal: controller.signal });
        this.fresh(preview);
        try { suggestion = parse(repaired); } catch { throw new Error("adaptation_repair_exhausted"); }
      }
      if (controller.signal.aborted) throw new Error("adaptation_generation_cancelled");
      const context = this.fresh(preview);
      const candidate = normalizeAdaptationIntent({ ...applyAdaptationOperations(context.base, suggestion, sourceDigest(preview.input.request)),
        revision: { kind: "proposal", previousVersionId: preview.baseVersionId, requestDigest: sourceDigest(preview.input.request) } });
      validateAdaptationIntent(this.database, projectId, candidate);
      const reconciliation = adaptationBudget(candidate);
      if (reconciliation.difference !== null && reconciliation.difference < 0) throw new Error("adaptation_provider_budget_exceeded");
      // Persist only a reviewable proposal. No canonical version changes until the separate Apply transaction.
      return transaction(this.database, () => {
        this.fresh(preview);
        const content: AdaptationProposal = { schemaId: "adaptation-intent-proposal", schemaVersion: 1, projectId, baseVersionId: preview.baseVersionId,
          input: preview.input, binding: preview.binding, contextFingerprint: preview.fingerprint, promptVersion: "adaptation-intent-v1", suggestion, candidate, status: "pending", appliedVersionId: null };
        const version = this.artifacts.saveArtifactInTransaction({ projectId, artifactId: `adaptation-intent-proposal-${randomUUID()}`, artifactType: "adaptation-intent-proposal", content, markDependentsStale: false });
        return { versionId: version.id, operations: suggestion.operations, reconciliation, status: "pending" };
      });
    } finally { clearTimeout(timeout); this.running.delete(projectId); }
  }
  proposal(projectId: string, versionId: string) {
    const proposal = this.artifacts.getVersion<AdaptationProposal>(versionId);
    if (!proposal || proposal.projectId !== projectId || proposal.artifactType !== "adaptation-intent-proposal") throw new Error("adaptation_proposal_missing");
    const current = this.artifacts.getCurrent(proposal.projectId, proposal.artifactId);
    if (current?.id !== proposal.id || proposal.content.status !== "pending") throw new Error("adaptation_proposal_not_pending");
    return proposal;
  }
  apply(projectId: string, versionId: string) {
    return transaction(this.database, () => {
      const proposal = this.proposal(projectId, versionId);
      const current = this.artifacts.getCurrent(projectId, "adaptation-intent");
      if ((current?.id ?? null) !== proposal.content.baseVersionId) throw new Error("adaptation_proposal_stale");
      assertAdaptationFresh(this.database, proposal.content.candidate);
      const context = adaptationSuggestionContext(this.database, projectId, proposal.content.binding, proposal.content.baseVersionId, proposal.content.input);
      if (context.fingerprint !== proposal.content.contextFingerprint) throw new Error("adaptation_proposal_stale");
      const version = this.artifacts.saveArtifactInTransaction({ projectId, artifactId: "adaptation-intent", content: proposal.content.candidate });
      this.artifacts.saveArtifactInTransaction({ projectId, artifactId: proposal.artifactId, artifactType: proposal.artifactType,
        content: { ...proposal.content, status: "applied", appliedVersionId: version.id }, markDependentsStale: false });
      return this.state(projectId);
    });
  }
  reject(projectId: string, versionId: string) {
    const proposal = this.proposal(projectId, versionId);
    this.artifacts.saveArtifact({ projectId, artifactId: proposal.artifactId, artifactType: proposal.artifactType, content: { ...proposal.content, status: "rejected" }, markDependentsStale: false });
    return { status: "rejected" };
  }
  close() { for (const controller of this.running.values()) controller.abort(); this.previews.clear(); }
  export(projectId: string, versionId?: string): ArtifactVersion<AdaptationIntent> {
    const version = versionId ? this.artifacts.getVersion<AdaptationIntent>(versionId) : this.current(projectId);
    if (!version || version.projectId !== projectId || version.artifactId !== "adaptation-intent") throw new Error("adaptation_version_missing");
    return version;
  }
}
