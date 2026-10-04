import { z } from "zod";
import { AnalysisSourceSchema, SourceDossierSchema, resolveSourceEvidence, collectStableIds, CREATIVE_DIRECTION_LIMITS, CreativeDirectionInputSchema, creativeDirectionFingerprints, creativeDirectionReferenceIssues, sourceCanonicalJson, sourceDigest, type FoundationBootstrapCandidate } from "@story-to-cyoa/domain";
import { applyPlanningOperations, enrichOperationGroups, planningSection, planningArtifactIds, validateLongFormProject,
  ProjectBriefSchema, CreativeDirectionSchema, LongFormStoryBibleSchema, LongFormRoutePlanSchema, LongFormEndingPlanSchema, LongFormMechanicsPlanSchema,
  PassagePlanSchema, ChoicePlanSchema, NarrativeThreadSchema, PassageStructureSchema, validatePassagePlan,
  type PlanningArtifact, type PlanningArtifactId, type ProposedPlanningOperation, type PassagePlanBundle, type PlanningFinding, type PassagePlanFinding } from "@story-to-cyoa/pipeline";
import { ArtifactRepository, ChangeSetRepository, ConversationRepository, AuthorMemoryRepository, PassagePlanRepository, PassageDraftRepository,
  WorkflowRepository, transaction, classifyPassageDraftStaleness, type DraftStalenessImpact, type StoryDatabase } from "@story-to-cyoa/persistence";
import type { LongFormProjectService } from "./long-form-project-service.js";
import { StructuredMutationService } from "./structured-mutation-service.js";
import { EDIT_LIMITS, EditRequestSchema, EditResponseSchema, type EditOwner, type EditPlan, type EditProvider, type EditResponse, type EditTarget } from "./conversational-edit-contract.js";
import { editMessages } from "./conversational-edit-provider.js";

const schemas = { brief: ProjectBriefSchema, "creative-direction": CreativeDirectionSchema, bible: LongFormStoryBibleSchema, routes: LongFormRoutePlanSchema,
  endings: LongFormEndingPlanSchema, mechanics: LongFormMechanicsPlanSchema, "passage-structure": PassageStructureSchema,
  passage: PassagePlanSchema, choice: ChoicePlanSchema, thread: NarrativeThreadSchema };
const dependencies: Record<string, string[]> = { brief: ["source"], "creative-direction": ["brief"], bible: ["brief", "creative-direction"], routes: ["brief", "creative-direction", "bible"],
  endings: ["routes", "creative-direction"], mechanics: ["bible", "routes", "endings", "creative-direction"], "passage-structure": [...planningArtifactIds],
  passage: [...planningArtifactIds, "passage-structure"], choice: [...planningArtifactIds, "passage"], thread: [...planningArtifactIds, "passage"] };
const bytes = (value: unknown) => Buffer.byteLength(sourceCanonicalJson(value));
const isArtifact = (owner: string): owner is PlanningArtifactId => (planningArtifactIds as readonly string[]).includes(owner);
const strings = (value: unknown, found = new Set<string>()): Set<string> => {
  if (typeof value === "string") found.add(value);
  else if (value && typeof value === "object") Object.values(value).forEach((child) => strings(child, found));
  return found;
};
const directionAt = (value: unknown, path: string) => path.split("/").filter(Boolean).reduce<unknown>((v, segment) => {
  const key = segment.replaceAll("~1", "/").replaceAll("~0", "~");
  return Array.isArray(v) ? v.find((item) => item?.id === key) : v && typeof v === "object" ? (v as Record<string, unknown>)[key] : undefined;
}, value);
const directionPaths = (value: unknown, path = "", stableEntityId?: string): Array<{ path: string; stableEntityId?: string }> => {
  if (Array.isArray(value)) {
    if (["/scopedVariations", "/relationshipPresentation/profiles"].includes(path) && value.length) return value.flatMap((item: { id: string }) => directionPaths(item, `${path}/${item.id.replaceAll("~", "~0").replaceAll("/", "~1")}`, item.id));
    return [{ path, ...(stableEntityId ? { stableEntityId } : {}) }];
  }
  if (value && typeof value === "object") return Object.entries(value).filter(([key]) => !["schemaId", "schemaVersion", "fieldProvenance"].includes(key))
    .flatMap(([key, child]) => directionPaths(child, `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`, stableEntityId));
  return [{ path, ...(stableEntityId ? { stableEntityId } : {}) }];
};
const unsafe = (value: unknown): void => {
  if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) {
    if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("edit_unsafe_field"); unsafe(child);
  }
};
const protectLocks = (before: unknown, after: unknown): void => {
  if (!before || typeof before !== "object") return;
  if ((before as { planningStatus?: string }).planningStatus === "locked" && sourceCanonicalJson(before) !== sourceCanonicalJson(after)) throw new Error("edit_planning_lock_protected");
  if (after && typeof after === "object") for (const field of ["planningStatus", "lifecycleStatus", "proseMarkdown"]) {
    if (field in before && sourceCanonicalJson((before as Record<string, unknown>)[field]) !== sourceCanonicalJson((after as Record<string, unknown>)[field])) throw new Error("edit_protected_field");
  }
  if (Array.isArray(before)) for (const [index, child] of before.entries()) {
    const id = child && typeof child === "object" ? (child as { id?: string }).id : undefined;
    protectLocks(child, Array.isArray(after) ? id ? after.find((v) => v?.id === id) : after[index] : undefined);
  } else for (const [key, child] of Object.entries(before)) protectLocks(child, after && typeof after === "object" ? (after as Record<string, unknown>)[key] : undefined);
};
const identityCounts = (value: unknown, counts = new Map<string, number>()): Map<string, number> => {
  if (value && typeof value === "object") {
    if (!Array.isArray(value) && typeof (value as { id?: unknown }).id === "string") {
      const id = (value as { id: string }).id; counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    Object.values(value).forEach((child) => identityCounts(child, counts));
  }
  return counts;
};
const protectInitialLifecycle = (before: unknown, after: unknown): void => {
  if (!after || typeof after !== "object") return;
  const old = before && typeof before === "object" ? before as Record<string, unknown> : undefined;
  const next = after as Record<string, unknown>;
  if (!old && ("planningStatus" in next && !["outline", "planned"].includes(String(next.planningStatus))
    || "lifecycleStatus" in next || "proseMarkdown" in next)) throw new Error("edit_initial_lifecycle_protected");
  if (Array.isArray(after)) for (const [index, child] of after.entries()) {
    const id = child && typeof child === "object" ? (child as { id?: string }).id : undefined;
    protectInitialLifecycle(Array.isArray(before) ? id ? before.find((v) => v?.id === id) : before[index] : undefined, child);
  } else for (const [key, child] of Object.entries(after)) protectInitialLifecycle(old?.[key], child);
};
const entityPath = (value: unknown, id: string, path = ""): string | null => {
  if (!value || typeof value !== "object") return null;
  if ((value as { id?: string }).id === id) return path;
  for (const [key, child] of Object.entries(value)) { const found = entityPath(child, id, `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`); if (found !== null) return found; }
  return null;
};
interface StoredEdit { kind: "conversational-edit-v1"; plan: EditPlan; response: EditResponse; generatedIds: Record<string, string>; expectedStaleness: string[]; expectedDraftImpacts?: DraftStalenessImpact[]; fingerprint: string }
type EditOutput = { owner: EditOwner; targetId: string; before: unknown; after: unknown };
const materialOwners = (outputs: EditOutput[]) => outputs.filter((o) => sourceCanonicalJson(o.before) !== sourceCanonicalJson(o.after))
  .filter((o) => o.owner !== "creative-direction" || (o.before as { materialFingerprint: string }).materialFingerprint !== (o.after as { materialFingerprint: string }).materialFingerprint).map((o) => o.owner);

export class ConversationalEditService {
  private readonly artifacts: ArtifactRepository;
  private readonly changes: ChangeSetRepository;
  private readonly conversations: ConversationRepository;
  private readonly memory: AuthorMemoryRepository;
  private readonly passages: PassagePlanRepository;
  private readonly drafts: PassageDraftRepository;
  private readonly workflow: WorkflowRepository;
  private readonly running = new Map<string, AbortController>();
  private closing = false;
  constructor(private readonly database: StoryDatabase, private readonly longForm: LongFormProjectService, private readonly providers: EditProvider[]) {
    this.artifacts = new ArtifactRepository(database); this.changes = new ChangeSetRepository(database); this.conversations = new ConversationRepository(database);
    this.memory = new AuthorMemoryRepository(database); this.drafts = new PassageDraftRepository(database);
    this.passages = new PassagePlanRepository(database, (mutation) => this.drafts.handlePassagePlanMutationInTransaction(mutation)); this.workflow = new WorkflowRepository(database);
  }
  private heads(projectId: string) {
    this.longForm.project(projectId);
    return sourceDigest({ artifacts: [...planningArtifactIds, "source", "source-scope", "source-dossier", "adaptation-intent"].map((id) => ({ id, current: this.artifacts.getCurrent(projectId, id)?.id ?? null, workflow: this.workflow.get(projectId, id) })),
      structure: this.passages.currentStructure(projectId)?.id ?? null, state: this.passages.state(projectId),
      entities: ["passage", "choice", "thread"].flatMap((kind) => this.passages.currentEntities(projectId, kind as "passage").map((v) => [kind, v.entityId, v.id])),
      locks: this.database.prepare("SELECT passage_id,current_version_id,accepted_version_id,accepted_locked FROM passage_draft_heads WHERE project_id=? ORDER BY passage_id").all(projectId) });
  }
  private allTargets(projectId: string): EditTarget[] {
    this.longForm.project(projectId); const targets: EditTarget[] = [];
    const add = (owner: EditOwner, versionId: string, value: unknown) => {
      const visit = (v: unknown, path: string) => {
        if (!v || typeof v !== "object") return;
        if (!Array.isArray(v)) {
          const record = v as Record<string, unknown>, targetId = path === "" ? "root" : typeof record.id === "string" ? record.id : path.split("/").length === 2 ? `section:${path.slice(1)}` : null;
          if (targetId) targets.push({ key: `${owner}:${targetId}`, owner, targetId, path, versionId, label: `${owner} / ${String(record.name ?? record.title ?? record.label ?? targetId)}`.slice(0, 300), value: v });
        }
        for (const [key, child] of Object.entries(v)) if (!["fieldProvenance", "materialFingerprint", "provenanceFingerprint"].includes(key)) visit(child, `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`);
      };
      visit(value, "");
      if (owner === "creative-direction" && !(value as Record<string, unknown>).relationshipPresentation) targets.push({ key: "creative-direction:section:relationshipPresentation", owner, targetId: "section:relationshipPresentation", path: "/relationshipPresentation", versionId, label: "creative-direction / relationshipPresentation", value: { projectDefault: { mechanicsVisibility: "subtle", customGuidance: "" }, profiles: [] } });
    };
    for (const id of planningArtifactIds) { const v = this.artifacts.getCurrent(projectId, id); if (v) add(id, v.id, v.content); }
    const structure = this.passages.currentStructure(projectId); if (structure) add("passage-structure", structure.id, structure.content);
    for (const kind of ["passage", "choice", "thread"] as const) for (const v of this.passages.currentEntities(projectId, kind)) {
      const content = v.content as Record<string, unknown>;
      targets.push({ key: `${kind}:${v.entityId}`, owner: kind, targetId: v.entityId, path: "", versionId: v.id, label: `${kind} / ${String(content.title ?? content.label ?? v.entityId)}`.slice(0, 300), value: content });
    }
    if (new Set(targets.map((t) => t.key)).size !== targets.length) throw new Error("edit_ambiguous_identity");
    return targets;
  }
  catalogue(projectId: string, search = "", offset = 0) {
    const records = this.allTargets(projectId).filter((t) => `${t.label} ${t.key}`.toLowerCase().includes(search.toLowerCase()));
    return { total: records.length, offset, items: records.slice(offset, offset + 50).map(({ value: _value, ...t }) => t) };
  }
  private resolve(message: string, keys: string[], targets: EditTarget[]) {
    if (new Set(keys).size !== keys.length) throw new Error("edit_duplicate_scope");
    if (keys.length) return keys.map((key) => { const t = targets.find((t) => t.key === key); if (!t) throw new Error("edit_target_not_found"); return t; });
    const text = message.toLowerCase();
    const named = targets.filter((t) => t.targetId !== "root" && !t.targetId.startsWith("section:") && (text.includes(t.targetId.toLowerCase()) ||
      typeof (t.value as Record<string, unknown>).name === "string" && Boolean((t.value as Record<string, unknown>).name) && text.includes(String((t.value as Record<string, unknown>).name).toLowerCase())));
    if (named.length) return named;
    if (/\b(tone|pacing|prose guidance|mechanics visibility)\b/.test(text)) {
      const section = /mechanics visibility/.test(text) ? "relationshipPresentation" : /pacing/.test(text) ? "pacing" : /prose guidance/.test(text) ? "prose" : "tone";
      return targets.filter((t) => t.key === `creative-direction:section:${section}`);
    }
    const owner = /\bending\b/.test(text) ? "endings" : /\broute\b/.test(text) ? "routes" : /\bcharacter\b/.test(text) ? "bible" : /\bmechanic\b/.test(text) ? "mechanics" : /\bpassage\b/.test(text) ? "passage" : /\bbrief|premise\b/.test(text) ? "brief" : null;
    return targets.filter((t) => t.owner === owner && (owner === "brief" ? t.targetId === "root" : t.targetId !== "root" && !t.targetId.startsWith("section:")));
  }
  preview(projectId: string, value: unknown) {
    return transaction(this.database, () => this.previewInTransaction(projectId, value));
  }
  private previewInTransaction(projectId: string, value: unknown) {
    const request = EditRequestSchema.parse(value), all = this.allTargets(projectId), targets = this.resolve(request.message, request.targetKeys, all);
    const prose = /\b(rewrite|draft|write)\b.*\b(prose|scene|dialogue|paragraph|passage)\b|\b(replace|revise|edit|improve|change)\b.*\b(prose(?!\s+(guidance|style))|dialogue|paragraph|passage text|scene text)\b|\bpassage prose\b/i.test(request.message);
    if (!targets.length || !request.targetKeys.length && targets.length !== 1 || targets.length > EDIT_LIMITS.targets) return {
      status: "clarification" as const, question: "Which exact planning record should change? Select a visible scope.", candidates: targets.slice(0, 50).map(({ value: _v, ...t }) => t), canonicalMutations: 0, providerCalls: 0,
    };
    if (prose) return { status: "draft-workflow" as const, passageId: targets.find((t) => t.owner === "passage")?.targetId ?? null, canonicalMutations: 0, providerCalls: 0 };
    const provider = this.providers.find((p) => p.id === request.providerId);
    if (!provider || request.providerId === "offline-edit" && request.modelId !== "offline-edit-v1" || request.providerId === "openrouter-edit" && request.modelId.startsWith("offline")) throw new Error("edit_provider_invalid");
    const scope = { kind: "project" as const, projectId };
    const conversation = request.conversationId ? this.conversations.get(request.conversationId) : this.conversations.list(projectId).find((c) => c.title === "Conversational editing" && c.scope.kind === "project");
    if (request.conversationId && (!conversation || conversation.projectId !== projectId || conversation.purpose !== "planning" || conversation.scope.kind !== "project")) throw new Error("edit_conversation_not_found");
    const currentConversation = conversation ?? this.conversations.create(projectId, scope, "Conversational editing");
    const memory = this.authorContext(projectId, currentConversation.id, targets);
    const references = new Set(targets.flatMap((t) => [...strings(t.value)]));
    const relevant: EditTarget[] = [];
    const queue = [...references];
    const seen = new Set(targets.map((t) => t.key));
    while (queue.length) {
      const ref = queue.shift()!;
      for (const dependency of all.filter((t) => t.targetId === ref && !seen.has(t.key))) {
        seen.add(dependency.key); relevant.push(dependency);
        if (relevant.length > EDIT_LIMITS.dependencies) throw new Error("edit_dependency_overflow_narrow_scope");
      }
    }
    const evidence = this.sourceEvidence(projectId, [...targets, ...relevant]);
    const context = { targets, references: relevant, evidence, memory };
    const definition = { projectId, conversationId: currentConversation.id, request, targets, context, contextBytes: bytes(context), headFingerprint: this.heads(projectId) };
    const candidate = { ...definition, id: "preview", fingerprint: sourceDigest(definition) }; editMessages(candidate);
    const message = this.conversations.addMessage({ conversationId: currentConversation.id, role: "user", content: request.message, intent: request.intent, scope, context: this.canonicalContext(projectId), metadata: { editPlan: definition, editFingerprint: candidate.fingerprint } });
    const plan = { ...candidate, id: message.id };
    return { status: "ready" as const, plan, impact: this.impact(projectId, targets.map((t) => t.owner)), estimatedInputTokens: Math.ceil(bytes(editMessages(plan)) / 4), cost: provider.id === "offline-edit" ? 0 : null, canonicalMutations: 0, providerCalls: 0 };
  }
  private plan(projectId: string, id: string): EditPlan {
    const message = this.conversations.getMessage(id), conversation = message && this.conversations.get(message.conversationId);
    if (!message || conversation?.projectId !== projectId || message.role !== "user" || !message.metadata.editPlan) throw new Error("edit_plan_not_found");
    const definition = message.metadata.editPlan as Omit<EditPlan, "id" | "fingerprint">;
    if (sourceDigest(definition) !== message.metadata.editFingerprint || definition.projectId !== projectId || definition.conversationId !== message.conversationId || definition.request.message !== message.content) throw new Error("edit_plan_identity_invalid");
    return { ...definition, id, fingerprint: String(message.metadata.editFingerprint) };
  }
  private fresh(plan: EditPlan) { if (this.heads(plan.projectId) !== plan.headFingerprint) throw new Error("edit_base_stale_repreview"); }
  private canonicalContext(projectId: string) {
    return Object.fromEntries([...planningArtifactIds].sort().flatMap((id) => { const v = this.artifacts.getCurrent(projectId, id); return v ? [[`${id}VersionId`, v.id]] : []; }));
  }
  private sourceEvidence(projectId: string, targets: EditTarget[]) {
    const version = this.artifacts.getCurrent(projectId, "source-dossier"); if (!version) return [];
    const dossier = SourceDossierSchema.parse(version.content), source = this.artifacts.getCurrent(projectId, "source");
    if (dossier.projectId !== projectId || !source || source.id !== dossier.binding.sourceVersionId) throw new Error("edit_source_evidence_unavailable");
    const references = strings(targets.map((t) => t.value));
    // Follow accepted bootstrap field lineage by stable identity, not by a possibly shifted array index.
    const rows = this.database.prepare(`SELECT c.content_json FROM foundation_bootstrap_applications a JOIN foundation_bootstrap_candidates c
      ON c.id=json_extract(a.content_json,'$.candidateId') AND c.project_id=a.project_id WHERE a.project_id=? ORDER BY a.rowid DESC LIMIT 40`).all(projectId) as { content_json: string }[];
    for (const row of rows) {
      const candidate = JSON.parse(row.content_json) as FoundationBootstrapCandidate;
      for (const target of targets.filter((t) => isArtifact(t.owner))) {
        const path = target.targetId === "root" ? "" : target.targetId.startsWith("section:") ? target.path : entityPath(candidate.artifacts[target.owner as PlanningArtifactId], target.targetId);
        if (path === null) continue;
        for (const field of candidate.provenance) if (field.artifactId === target.owner && (!path || field.fieldPath === path || field.fieldPath.startsWith(`${path}/`))) field.sourceRecordIds.forEach((id) => references.add(id));
      }
    }
    const content = AnalysisSourceSchema.parse(source.content);
    return dossier.records.filter((r) => references.has(r.id) || references.has(r.claim)).map((record) => ({ record, excerpts: record.evidence.map((reference) => ({ reference, text: resolveSourceEvidence(content, dossier.binding, reference) })) }));
  }
  private authorContext(projectId: string, conversationId: string, targets: EditTarget[], excludeMessageIds: string[] = []) {
    const scope = { kind: "project" as const, projectId }, memory = this.memory.buildContext(projectId, conversationId, scope, { excludeMessageIds });
    const relevant = new Map(memory.decisions.map((d) => [d.id, d]));
    for (const target of targets) {
      const rows = this.database.prepare(`SELECT v.decision_id FROM pinned_decision_versions v JOIN pinned_decision_heads h ON h.current_version_id=v.id
        WHERE v.project_id=? AND v.status='active' AND v.artifact_id=? AND (v.scope_kind='artifact' OR (v.scope_kind='entity' AND v.entity_id=?))
        ORDER BY v.created_at DESC, v.id LIMIT 25`).all(projectId, target.owner, target.targetId) as { decision_id: string }[];
      for (const row of rows) { const decision = this.memory.getDecision(projectId, row.decision_id)!; relevant.set(decision.id, decision); }
    }
    let used = 0;
    const decisions = [...relevant.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)).filter((d, index) => {
      used += Buffer.byteLength(d.content) + bytes(d.relatedIds); return index < 24 && used <= 12_000;
    });
    return { summary: memory.summary, decisions, recentMessages: memory.recentMessages.map((m) => ({ role: m.role, content: m.content })), diagnostics: { ...memory.diagnostics, omittedScopedDecisionCount: relevant.size - decisions.length } };
  }
  private freshMemory(plan: EditPlan) {
    if (sourceCanonicalJson(plan.context.memory) !== sourceCanonicalJson(this.authorContext(plan.projectId, plan.conversationId, plan.targets, [plan.id]))) throw new Error("edit_author_memory_stale_repreview");
  }
  private freshDecisions(plan: EditPlan) {
    const frozen = plan.context.memory as { decisions: unknown[] };
    if (sourceCanonicalJson(frozen.decisions) !== sourceCanonicalJson(this.authorContext(plan.projectId, plan.conversationId, plan.targets).decisions)) throw new Error("edit_author_decisions_stale_repreview");
  }
  async generate(projectId: string, id: string, fingerprint: string) {
    const plan = this.plan(projectId, id); this.fresh(plan); this.freshMemory(plan);
    if (fingerprint !== plan.fingerprint) throw new Error("edit_preview_stale");
    if (this.closing || this.running.has(id)) throw new Error("edit_already_running");
    const controller = new AbortController(); this.running.set(id, controller);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const raw = await Promise.race([this.providers.find((p) => p.id === plan.request.providerId)!.generate(plan, controller.signal), new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () => reject(new Error("edit_cancelled")), { once: true }); timer = setTimeout(() => controller.abort(), 60_000);
      })]);
      controller.signal.throwIfAborted(); this.fresh(plan); this.freshMemory(plan);
      if (bytes(raw) > EDIT_LIMITS.outputBytes) throw new Error("edit_output_overflow"); unsafe(raw);
      const response = EditResponseSchema.parse(raw);
      if (sourceCanonicalJson(response) !== sourceCanonicalJson(raw)) throw new Error("edit_output_not_closed");
      if (plan.request.intent === "discuss" && response.groups.length) throw new Error("edit_discussion_cannot_mutate");
      const result = transaction(this.database, () => this.persistResponse(plan, response));
      this.memory.ensureSummary(projectId, plan.conversationId);
      return result;
    } finally { if (timer) clearTimeout(timer); this.running.delete(id); }
  }
  private persistResponse(plan: EditPlan, response: EditResponse) {
      const { projectId, id } = plan;
      this.fresh(plan); this.freshMemory(plan);
      const scope = { kind: "project" as const, projectId };
      if (!response.groups.length) {
        this.conversations.addMessage({ conversationId: plan.conversationId, role: "assistant", content: response.message, intent: plan.request.intent, scope, context: this.canonicalContext(projectId), metadata: { planId: id } });
        return { message: response.message, proposal: null };
      }
      const generatedIds: Record<string, string> = {};
      for (const group of response.groups) for (const op of group.operations) if (op.kind === "add-item") {
        const logical = op.item?.id;
        if (typeof logical !== "string" || !/^\$new:[a-zA-Z0-9_-]{1,80}$/.test(logical) || generatedIds[logical]) throw new Error("edit_generated_id_invalid");
        generatedIds[logical] = `a6_${sourceDigest({ plan: plan.fingerprint, logical }).slice(0, 24)}`;
      }
      const remap = (v: unknown): unknown => typeof v === "string" && v.startsWith("$new:") ? generatedIds[v] ?? (() => { throw new Error("edit_generated_reference_invalid"); })()
        : Array.isArray(v) ? v.map(remap) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, child]) => [k, remap(child)])) : v;
      const mapped = EditResponseSchema.parse(remap(response));
      const stored: StoredEdit = { kind: "conversational-edit-v1", plan, response: mapped, generatedIds, expectedStaleness: [], fingerprint: "" };
      const effective = this.effective(stored, mapped.groups.map((g) => g.id));
      stored.expectedStaleness = this.impact(projectId, materialOwners(effective.outputs), effective.draftImpacts);
      stored.expectedDraftImpacts = effective.draftImpacts;
      stored.fingerprint = sourceDigest({ plan, response: mapped, generatedIds, expectedStaleness: stored.expectedStaleness, expectedDraftImpacts: stored.expectedDraftImpacts });
      this.fresh(plan);
      const anchor = this.artifacts.getCurrent(projectId, "brief")!;
      const proposal = this.changes.createOperations({ projectId, conversationId: plan.conversationId, artifactId: "brief", baseVersionId: anchor.id, summary: mapped.message, rationale: plan.request.message, proposal: stored,
        invalidations: stored.expectedStaleness });
      this.conversations.addMessage({ conversationId: plan.conversationId, role: "assistant", content: mapped.message, intent: "propose", scope, context: this.canonicalContext(projectId), metadata: { proposalId: proposal.id, planId: id } });
      return { message: mapped.message, proposal };
  }
  cancel(projectId: string, id: string) { this.plan(projectId, id); this.running.get(id)?.abort(); return { cancelled: true }; }
  shutdown() { this.closing = true; for (const controller of this.running.values()) controller.abort(); }
  conversationsForProject(projectId: string) {
    this.longForm.project(projectId);
    return this.conversations.list(projectId).filter((c) => c.title === "Conversational editing" && c.purpose === "planning" && c.scope.kind === "project").slice(0, 40);
  }
  history(projectId: string, conversationId: string) {
    if (this.conversations.get(conversationId)?.projectId !== projectId) throw new Error("edit_conversation_not_found");
    return { conversation: this.conversations.get(conversationId), messages: this.conversations.listRecentMessages(conversationId, 40).map(({ id, role, content }) => ({ id, role, content })),
      proposals: this.changes.listRecent(conversationId, 40).filter((p) => (p.proposal as StoredEdit)?.kind === "conversational-edit-v1").map(({ id, status, summary, createdAt }) => ({ id, status, summary, createdAt })) };
  }
  proposal(projectId: string, id: string) { return this.stored(projectId, id).record; }
  private stored(projectId: string, id: string) {
    const record = this.changes.get(id), edit = record?.proposal as StoredEdit;
    if (!record || record.projectId !== projectId || edit?.kind !== "conversational-edit-v1" || edit.fingerprint !== sourceDigest({ plan: edit.plan, response: edit.response, generatedIds: edit.generatedIds, expectedStaleness: edit.expectedStaleness,
      ...(edit.expectedDraftImpacts === undefined ? {} : { expectedDraftImpacts: edit.expectedDraftImpacts }) })) throw new Error("edit_proposal_not_found");
    if (sourceCanonicalJson(this.plan(projectId, edit.plan.id)) !== sourceCanonicalJson(edit.plan)) throw new Error("edit_proposal_lineage_invalid");
    EditResponseSchema.parse(edit.response); return { record, edit };
  }
  reject(projectId: string, id: string) { this.stored(projectId, id); return this.changes.reject(id); }
  private impact(projectId: string, owners: string[], draftImpacts?: DraftStalenessImpact[]) {
    if (!owners.length) return [];
    const impacted = new Set<string>(); const queue = owners.filter(isArtifact);
    while (queue.length) {
      const owner = queue.shift()!;
      for (const row of this.database.prepare("SELECT dependent_artifact_id id FROM artifact_dependencies WHERE project_id=? AND upstream_artifact_id=?").all(projectId, owner) as { id: PlanningArtifactId }[]) if (!impacted.has(row.id)) { impacted.add(row.id); queue.push(row.id); }
    }
    if (owners.some(isArtifact) && this.passages.currentStructure(projectId)) impacted.add("passage-plan");
    if ((draftImpacts === undefined || draftImpacts.length || owners.some(isArtifact))
      && this.database.prepare("SELECT 1 FROM passage_draft_heads WHERE project_id=? LIMIT 1").get(projectId)) impacted.add("passage-drafts-on-approval-or-plan-change");
    return [...impacted].sort();
  }
  private effective(edit: StoredEdit, selected: string[]) {
    const { plan, response } = edit; this.fresh(plan); this.freshDecisions(plan);
    if (!selected.length || new Set(selected).size !== selected.length || selected.some((id) => !response.groups.some((g) => g.id === id))) throw new Error("edit_selection_invalid");
    if (new Set(response.groups.map((g) => g.id)).size !== response.groups.length || response.groups.flatMap((g) => g.operations).length > EDIT_LIMITS.operations) throw new Error("edit_groups_invalid");
    const groups = response.groups.filter((g) => selected.includes(g.id));
    for (const group of response.groups) if (group.dependsOnGroupIds.some((id) => id === group.id || !response.groups.some((g) => g.id === id))) throw new Error("edit_dependency_invalid");
    const visit = (id: string, active = new Set<string>()): void => { if (active.has(id)) throw new Error("edit_dependency_cycle"); const next = new Set(active).add(id); response.groups.find((g) => g.id === id)!.dependsOnGroupIds.forEach((dep) => visit(dep, next)); };
    response.groups.forEach((g) => visit(g.id));
    const required = new Set(groups.flatMap((g) => g.dependsOnGroupIds));
    for (const group of groups) for (const operation of group.operations) {
      const target = plan.targets.find((t) => t.key === operation.targetKey); if (!target) throw new Error("edit_scope_exceeded");
      for (const logical of Object.values(edit.generatedIds)) if (strings(operation).has(logical)) {
        const producer = response.groups.find((g) => g.operations.some((o) => o.kind === "add-item" && o.item?.id === logical)); if (producer && producer.id !== group.id) required.add(producer.id);
      }
    }
    if ([...required].some((id) => !selected.includes(id))) throw new Error("edit_dependency_selection_incomplete");
    const originalSnapshot = this.longForm.snapshot(plan.projectId), snapshot = { ...originalSnapshot }, outputs = new Map<string, EditOutput>();
    const existingIds = new Set(this.allTargets(plan.projectId).flatMap((t) => [...collectStableIds(t.value)]));
    for (const target of plan.targets) {
      const relevantGroups = groups.filter((g) => g.operations.some((op) => op.targetKey === target.key)); if (!relevantGroups.length) continue;
      const storageKey = isArtifact(target.owner) || target.owner === "passage-structure" ? target.owner : target.key;
      if (outputs.has(storageKey)) continue;
      const current = isArtifact(target.owner) ? snapshot[target.owner] : target.owner === "passage-structure" ? this.passages.currentStructure(plan.projectId)?.content : this.passages.currentEntity(plan.projectId, target.owner, target.targetId)?.content;
      const applicable = groups.map((g) => ({ id: g.id, label: g.label, summary: g.explanation, dependsOnGroupIds: g.dependsOnGroupIds, safeToApplyIndependently: true,
        operations: g.operations.filter((op) => { const t = plan.targets.find((t) => t.key === op.targetKey); return t && (t.owner === target.owner) && (isArtifact(target.owner) || target.owner === "passage-structure" || t.targetId === target.targetId); }).map((op): ProposedPlanningOperation => {
          const t = plan.targets.find((t) => t.key === op.targetKey)!;
          if ((t.value as { planningStatus?: string }).planningStatus === "locked") throw new Error("edit_planning_lock_protected");
          if (op.kind === "add-item") protectInitialLifecycle(undefined, op.item);
          if (op.changes && Object.keys(op.changes).some((key) => ["id", "schemaId", "schemaVersion", "materialFingerprint", "provenanceFingerprint", "fieldProvenance", "planningStatus", "lifecycleStatus", "proseMarkdown"].includes(key))) throw new Error("edit_protected_field");
          return { ...op, targetId: isArtifact(t.owner) || t.owner === "passage-structure" ? t.targetId : "root" };
        }) })).filter((g) => g.operations.length);
      const operationBase = target.owner === "creative-direction" && !(current as Record<string, unknown>).relationshipPresentation && applicable.some((g) => g.operations.some((op) => op.targetId === "section:relationshipPresentation"))
        ? { ...current as object, relationshipPresentation: { projectDefault: { mechanicsVisibility: "subtle", customGuidance: "" }, profiles: [] } } : current;
      const enriched = enrichOperationGroups(operationBase as PlanningArtifact, applicable);
      let after: unknown = applyPlanningOperations(operationBase as PlanningArtifact, enriched);
      protectInitialLifecycle(current, after);
      protectLocks(current, after);
      const oldCounts = identityCounts(current);
      for (const [id, count] of identityCounts(after)) if (count > Math.max(1, oldCounts.get(id) ?? 0)) throw new Error("edit_duplicate_identity");
      const beforeIds = collectStableIds(current), afterIds = collectStableIds(after), generated = new Set(Object.values(edit.generatedIds));
      if ([...afterIds].some((id) => !beforeIds.has(id) && !generated.has(id))) throw new Error("edit_generated_id_invalid");
      if ([...afterIds].some((id) => !beforeIds.has(id) && existingIds.has(id))) throw new Error("edit_generated_id_collision");
      if ([...beforeIds].some((id) => !afterIds.has(id) && !applicable.some((g) => g.operations.some((op) => op.kind === "remove-item" && op.targetId === id)))) throw new Error("edit_identity_changed");
      if (target.owner === "creative-direction") {
        const raw = after as Record<string, unknown>, { materialFingerprint: _m, provenanceFingerprint: _p, ...input } = raw;
        const direction = CreativeDirectionInputSchema.parse(input), paths = directionPaths(direction), old = current as typeof direction;
        direction.fieldProvenance = direction.fieldProvenance.filter((p) => directionAt(direction, p.fieldPath) !== undefined);
        for (const { path, stableEntityId } of paths) if (sourceCanonicalJson(directionAt(direction, path)) !== sourceCanonicalJson(directionAt(old, path))) {
          direction.fieldProvenance = direction.fieldProvenance.filter((p) => p.fieldPath !== path);
          const excerpt = Buffer.from(plan.request.message).subarray(0, CREATIVE_DIRECTION_LIMITS.explanationExcerptBytes).toString("utf8").replace(/\uFFFD+$/, "");
          direction.fieldProvenance.push({ fieldPath: path, ...(stableEntityId ? { stableEntityId } : {}), reference: { kind: "user-message", targetId: plan.id, excerpt } });
        }
        after = { ...direction, ...creativeDirectionFingerprints(direction) };
      }
      const parsed = schemas[target.owner].parse(after);
      if (sourceCanonicalJson(parsed) !== sourceCanonicalJson(after)) throw new Error("edit_candidate_not_closed");
      if (isArtifact(target.owner)) { this.longForm.assertPresentationAuthorityWrite(plan.projectId, target.owner, parsed as PlanningArtifact); Object.assign(snapshot, { [target.owner]: parsed }); }
      outputs.set(storageKey, { owner: target.owner, targetId: target.targetId, before: current, after: parsed });
    }
    const findings: Array<PlanningFinding | PassagePlanFinding> = validateLongFormProject(snapshot), original = validateLongFormProject(this.longForm.snapshot(plan.projectId));
    const baseline = new Set(original.filter((f) => f.severity === "error").map((f) => sourceDigest(f)));
    const errors = findings.filter((f) => f.severity === "error" && !baseline.has(sourceDigest(f))).map((f) => f.message);
    const directionIssues = (state: typeof snapshot) => state["creative-direction"] ? creativeDirectionReferenceIssues(state["creative-direction"], {
      characterIds: state.bible?.characters.map((c) => c.id) ?? [], relationships: state.bible?.relationships.map((r) => ({ id: r.id, characterIds: r.characterIds })) ?? [],
      routeIds: state.routes?.routes.map((r) => r.id) ?? [], acts: state.routes?.acts.map((a) => ({ id: a.id, routeId: a.routeId })) ?? [],
    }) : [];
    const oldDirectionIssues = new Set(directionIssues(originalSnapshot));
    errors.push(...directionIssues(snapshot).filter((issue) => !oldDirectionIssues.has(issue)));
    const structure = this.passages.currentStructure(plan.projectId);
    if (structure && snapshot.bible && snapshot.routes && snapshot.endings && snapshot.mechanics) {
      const bundle: PassagePlanBundle = { schemaVersion: 1, structure: structure.content as PassagePlanBundle["structure"], passages: [], choices: [], threads: [] };
      for (const [kind, collection] of [["passage", "passages"], ["choice", "choices"], ["thread", "threads"]] as const) Object.assign(bundle, { [collection]: this.passages.currentEntities(plan.projectId, kind).map((v) => v.content) });
      const before = validatePassagePlan({ bundle, bible: originalSnapshot.bible!, routes: originalSnapshot.routes!, endings: originalSnapshot.endings!, mechanics: originalSnapshot.mechanics! });
      for (const [key, output] of outputs) {
        if (output.owner === "passage-structure") bundle.structure = output.after as PassagePlanBundle["structure"];
        else if (["passage", "choice", "thread"].includes(output.owner)) {
          const collection = output.owner === "passage" ? "passages" : output.owner === "choice" ? "choices" : "threads";
          Object.assign(bundle, { [collection]: bundle[collection].map((v) => v.id === output.targetId ? output.after : v) });
        }
        void key;
      }
      const checked = validatePassagePlan({ bundle, bible: snapshot.bible, routes: snapshot.routes, endings: snapshot.endings, mechanics: snapshot.mechanics });
      findings.push(...checked.findings);
      const previous = new Set(before.findings.filter((f) => f.severity === "error").map((f) => sourceDigest(f)));
      errors.push(...checked.findings.filter((f) => f.severity === "error" && !previous.has(sourceDigest(f))).map((f) => f.message));
    }
    if (errors.length) throw new Error(`edit_validation_failed: ${errors.slice(0, 10).join("; ")}`);
    const draftImpacts = [...outputs.values()].flatMap((output) => isArtifact(output.owner) ? [] : classifyPassageDraftStaleness({ projectId: plan.projectId,
      kind: output.owner === "passage-structure" ? "structure" : output.owner, entityId: output.targetId, beforeVersionId: null, afterVersionId: null, before: output.before, after: output.after,
      passages: this.passages.currentEntities<{ id: string; sequenceId: string }>(plan.projectId, "passage").map((v) => v.content) }));
    return { outputs: [...outputs.values()], groups, requiredGroupIds: [...required].sort(), findings, draftImpacts };
  }
  private reviewEffective(projectId: string, id: string, selected: string[]) {
    const { record, edit } = this.stored(projectId, id); if (record.status !== "proposed") throw new Error("edit_proposal_terminal");
    const effective = this.effective(edit, selected);
    const preview = { proposalId: id, proposalFingerprint: edit.fingerprint, selectedGroupIds: selected, ...effective, wouldStale: this.impact(projectId, materialOwners(effective.outputs), effective.draftImpacts), expectedAllGroupStaleness: edit.expectedStaleness,
      protectedProse: "Accepted and locked prose is never replaced; prose requests use ordinary candidate drafting.", evidence: { conversationId: edit.plan.conversationId, messageId: edit.plan.id, request: edit.plan.request.message, sourceRecords: edit.plan.context.evidence }, generatedIds: edit.generatedIds };
    return { ...preview, fingerprint: sourceDigest(preview), providerCalls: 0, canonicalMutations: 0 };
  }
  review(projectId: string, id: string, selected: string[]) {
    const preview = this.reviewEffective(projectId, id, selected), { edit } = this.stored(projectId, id);
    const outputs = edit.plan.targets.flatMap((target) => {
      if (!preview.groups.some((g) => g.operations.some((op) => op.targetKey === target.key))) return [];
      const output = preview.outputs.find((o) => o.owner === target.owner && (isArtifact(o.owner) || o.owner === "passage-structure" || o.targetId === target.targetId));
      const content = (value: unknown) => { if (target.path === "") return value; try { return planningSection(value as PlanningArtifact, target.targetId).content; } catch { return null; } };
      return output ? [{ owner: target.owner, targetId: target.targetId, before: content(output.before), after: content(output.after) }] : [];
    });
    return { ...preview, outputs, findings: preview.findings.slice(0, 50), validation: { totalFindings: preview.findings.length, omittedFindings: Math.max(0, preview.findings.length - 50) } };
  }
  apply(projectId: string, id: string, selected: string[], fingerprint: string, options: { simulateFailure?: boolean; beforeTransaction?: () => void } = {}) {
    options.beforeTransaction?.();
    return transaction(this.database, () => {
      const preview = this.reviewEffective(projectId, id, selected); if (preview.fingerprint !== fingerprint) throw new Error("edit_apply_preview_stale");
      const { edit } = this.stored(projectId, id);
      const writer = new StructuredMutationService(this.artifacts, this.workflow, this.passages), results: Record<string, string> = {};
      const ordered = [...preview.outputs].sort((a, b) => [...planningArtifactIds, "passage-structure", "passage", "choice", "thread"].indexOf(a.owner) - [...planningArtifactIds, "passage-structure", "passage", "choice", "thread"].indexOf(b.owner));
      for (const output of ordered) {
        if (sourceCanonicalJson(output.before) === sourceCanonicalJson(output.after)) continue;
        if (isArtifact(output.owner)) results[output.owner] = writer.artifact(projectId, output.owner, output.after, schemas[output.owner], [...new Set([...dependencies[output.owner]!, ...(this.database.prepare("SELECT upstream_artifact_id id FROM artifact_dependencies WHERE project_id=? AND dependent_artifact_id=?").all(projectId, output.owner) as { id: string }[]).map((r) => r.id)])],
          output.owner !== "creative-direction" || (output.before as { materialFingerprint: string }).materialFingerprint !== (output.after as { materialFingerprint: string }).materialFingerprint).id;
        else if (output.owner === "passage-structure") { results[output.owner] = this.passages.insertStructureVersionInTransaction(projectId, output.after).id; this.passages.markDraftInTransaction(projectId); }
        else results[`${output.owner}:${output.targetId}`] = writer.entity(projectId, output.owner, output.targetId, output.after).id;
      }
      if (preview.wouldStale.includes("passage-plan")) this.passages.markStale(projectId);
      if (options.simulateFailure) throw new Error("Simulated edit transaction failure");
      const audit = this.artifacts.saveArtifactInTransaction({ projectId, artifactId: `conversational-edit-application-${id}`, artifactType: "conversational-edit-application", content: {
        proposalId: id, proposalFingerprint: preview.proposalFingerprint, previewFingerprint: fingerprint, selectedGroupIds: selected, generatedIds: preview.generatedIds, resultingVersions: results, evidence: preview.evidence,
        groups: preview.groups, expectedStaleness: preview.wouldStale, draftImpacts: preview.draftImpacts, expectedBases: edit.plan.targets.map(({ key, versionId }) => ({ key, versionId })), baseFingerprint: edit.plan.headFingerprint,
        outputs: preview.outputs, appliedAt: new Date().toISOString(),
      } });
      this.changes.markApplied(id, audit.id); return { application: audit, resultingVersions: results, providerCalls: 0 };
    });
  }
}
