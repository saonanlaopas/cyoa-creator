import { z } from "zod";
import { WorldDefinitionSchema, emptyWorld, sourceDigest, type WorldDefinition, LongFormMechanicsPlanSchema } from "@story-to-cyoa/domain";
import { ArtifactRepository, PassagePlanRepository, ProjectRepository, validateWorld, type StoryDatabase } from "@story-to-cyoa/persistence";
import { stableFingerprint, NativeWorldSchema, NativeRuntimeStateSchema, previewChapterTransition, progressionDiagnostics, projectWorldProgression, projectWorldPeople, peopleDiagnostics, inspectWorldPresence, projectWorldEconomy, inspectWorldEconomy, projectWorldJournal, inspectWorldJournal, assertProgressionState, assertPeopleState, assertEconomyState, type JournalMechanics } from "@story-to-cyoa/runtime";
import { PassageStructureSchema, type ResolvedNativeCompilationInput } from "@story-to-cyoa/pipeline";
import { resolveApprovedImage } from "./illustrated-scene-service.js";

const project = { projectId: z.string().min(1).max(200) };
export const WorldInputs = {
  read_world: z.object(project).strict(),
  inspect_world_journal: z.object({ ...project, state: NativeRuntimeStateSchema }).strict(),
  inspect_world_economy: z.object({ ...project, state: NativeRuntimeStateSchema }).strict(),
  inspect_world_presence: z.object({ ...project, state: NativeRuntimeStateSchema }).strict(),
  preview_chapter_transition: z.object({ ...project, transitionId: z.string().min(1).max(200), state: NativeRuntimeStateSchema }).strict(),
  review_world: z.object({ ...project, world: WorldDefinitionSchema }).strict(),
  apply_world: z.object({ ...project, world: WorldDefinitionSchema, fingerprint: z.string().regex(/^[a-f0-9]{64}$/), operationId: z.string().uuid(), approved: z.literal(true) }).strict(),
};
export class WorldService {
  private readonly artifacts: ArtifactRepository;
  private readonly plans: PassagePlanRepository;
  constructor(private readonly database: StoryDatabase) { this.artifacts = new ArtifactRepository(database); this.plans = new PassagePlanRepository(database); }
  read(projectId: string) {
    const project = new ProjectRepository(this.database).get(projectId);
    if (!project || project.archived || project.mode !== "long-form") throw new Error("world_project_unavailable");
    const current = this.artifacts.getCurrent<WorldDefinition>(projectId, "world-definition");
    const mechanics = this.artifacts.getCurrent(projectId, "mechanics");
    const relationshipOptions = mechanics ? LongFormMechanicsPlanSchema.parse(mechanics.content).relationships.map(({ key, label, minimum, maximum, initial }) => ({ key, label, minimum, maximum, initial })) : [];
    const statOptions = mechanics ? LongFormMechanicsPlanSchema.parse(mechanics.content).visibleStats.map(({ key, label, minimum, maximum, initial }) => ({ key, label, minimum, maximum, initial })) : [];
    return { statOptions, relationshipOptions, mechanicsVersionId: mechanics?.id ?? null, versionId: current?.id ?? null, world: current?.content ?? emptyWorld(), providerCalls: 0 };
  }
  review(projectId: string, value: unknown) {
    const current = this.read(projectId), world = validateWorld(this.database, projectId, value);
    for (const l of [...world.locations, ...(world.progression?.events ?? []), ...(world.progression?.transitions ?? [])]) if (l.passage && this.plans.currentEntity(projectId, "passage", l.passage.passageId)?.id !== l.passage.versionId) throw new Error("world_passage_stale_reload_and_review");
    const structure = this.plans.currentStructure(projectId);
    if (world.enabled && world.locations.find((l) => l.id === world.startLocationId)?.passage?.passageId !== (structure && PassageStructureSchema.parse(structure.content).startPassageId)) throw new Error("world_start_passage_must_match_game");
    const findings = [...(world.progression ? progressionDiagnostics(projectWorldProgression(world.progression), world.initialMinutes, world.economy ? projectWorldEconomy(world.economy, current.relationshipOptions) : undefined) : []), ...(world.people ? peopleDiagnostics(projectWorldPeople(world.people), world.progression ? projectWorldProgression(world.progression) : undefined) : [])];
    const result = { ...(world.journal ? { journalMechanicsVersionId: current.mechanicsVersionId } : {}), ...(world.economy ? { economyMechanicsVersionId: current.mechanicsVersionId } : {}), ...(world.progression || world.people ? { diagnostics: { findings: findings.slice(0, 50), total: findings.length, omitted: Math.max(0, findings.length - 50), exhaustive: false as const } } : {}), world, previous: current.versionId ? current.world : null, versionId: current.versionId,
      structureVersionId: structure?.id ?? null, providerCalls: 0 };
    return { ...result, fingerprint: sourceDigest({ projectId, ...result }) };
  }
  preview(projectId: string, transitionId: string, state: unknown) {
    const current = this.read(projectId); this.review(projectId, current.world);
    const refs = [...current.world.locations, ...(current.world.progression?.events ?? []), ...(current.world.progression?.transitions ?? [])].flatMap((item) => item.passage ? [{ entityId: item.passage.passageId, versionId: item.passage.versionId }] : []);
    const world = resolveWorld(this.artifacts, projectId, refs)?.presentation;
    if (!world) throw new Error("progression_world_required");
    return { preview: previewChapterTransition(world, NativeRuntimeStateSchema.parse(state), transitionId), worldVersionId: current.versionId, providerCalls: 0 };
  }
  inspectPresence(projectId: string, state: unknown) {
    const current = this.read(projectId); this.review(projectId, current.world);
    const refs = [...current.world.locations, ...(current.world.progression?.events ?? []), ...(current.world.progression?.transitions ?? [])].flatMap((item) => item.passage ? [{ entityId: item.passage.passageId, versionId: item.passage.versionId }] : []);
    const world = resolveWorld(this.artifacts, projectId, refs)?.presentation;
    if (!world?.people) throw new Error("people_world_required");
    return { ...inspectWorldPresence(world, NativeRuntimeStateSchema.parse(state)), worldVersionId: current.versionId, providerCalls: 0 };
  }
  inspectJournal(projectId: string, state: unknown) {
    const current = this.read(projectId); this.review(projectId, current.world);
    const refs = [...current.world.locations, ...(current.world.progression?.events ?? []), ...(current.world.progression?.transitions ?? [])].flatMap((item) => item.passage ? [{ entityId: item.passage.passageId, versionId: item.passage.versionId }] : []);
    const world = resolveWorld(this.artifacts, projectId, refs)?.presentation;
    if (!world?.journal) throw new Error("journal_world_required");
    const parsed = NativeRuntimeStateSchema.parse(state); assertProgressionState(world, parsed); assertPeopleState(world, parsed); assertEconomyState(world, parsed);
    return { ...inspectWorldJournal(world, parsed), worldVersionId: current.versionId, providerCalls: 0 };
  }
  inspectEconomy(projectId: string, state: unknown) {
    const current = this.read(projectId); this.review(projectId, current.world);
    const refs = [...current.world.locations, ...(current.world.progression?.events ?? []), ...(current.world.progression?.transitions ?? [])].flatMap((item) => item.passage ? [{ entityId: item.passage.passageId, versionId: item.passage.versionId }] : []);
    const world = resolveWorld(this.artifacts, projectId, refs)?.presentation;
    if (!world) throw new Error("economy_world_required");
    return { ...inspectWorldEconomy(world, NativeRuntimeStateSchema.parse(state)), worldVersionId: current.versionId, providerCalls: 0 };
  }
  apply(projectId: string, value: unknown, fingerprint: string) {
    const review = this.review(projectId, value);
    if (review.fingerprint !== fingerprint) throw new Error("world_review_stale_reload_and_review");
    const version = this.artifacts.saveArtifactInTransaction({ projectId, artifactId: "world-definition", artifactType: "world-definition", content: review.world, markDependentsStale: false });
    return { versionId: version.id, status: "applied", providerCalls: 0 };
  }
}

export function resolveWorld(artifacts: Pick<ArtifactRepository, "getCurrent" | "getVersion">, projectId: string,
  passages: Array<{ entityId: string; versionId: string }>, ref?: { versionId: string; contentFingerprint: string }, relationshipDefinitions?: Array<{ key: string; minimum: number; maximum: number; initial: number }>, journalMechanics?: JournalMechanics): ResolvedNativeCompilationInput["world"] {
  const version = ref ? artifacts.getVersion<WorldDefinition>(ref.versionId) : artifacts.getCurrent<WorldDefinition>(projectId, "world-definition");
  if (!version) { if (ref) throw new Error("world_input_missing"); return undefined; }
  if (version.projectId !== projectId || version.artifactId !== "world-definition" || version.artifactType !== "world-definition" || version.schemaVersion !== 1
    || ref && stableFingerprint(version.content) !== ref.contentFingerprint) throw new Error("world_input_lineage_invalid");
  const content = WorldDefinitionSchema.parse(version.content);
  for (const item of [...(content.progression?.events ?? []), ...(content.progression?.transitions ?? [])]) if (item.passage && !passages.some((p) => p.entityId === item.passage!.passageId && p.versionId === item.passage!.versionId)) throw new Error("progression_passage_stale_reload_and_review");
  const relationshipOptions = relationshipDefinitions ?? (artifacts.getCurrent(projectId, "mechanics") ? LongFormMechanicsPlanSchema.parse(artifacts.getCurrent(projectId, "mechanics")!.content).relationships : []);
  const exactMechanics = journalMechanics ?? (artifacts.getCurrent(projectId, "mechanics") ? LongFormMechanicsPlanSchema.parse(artifacts.getCurrent(projectId, "mechanics")!.content) : { visibleStats: [], relationships: [] });
  const maps = new Map<string, ReturnType<typeof resolveApprovedImage>>();
  for (const l of content.locations) {
    if (l.passage && !passages.some((p) => p.entityId === l.passage!.passageId && p.versionId === l.passage!.versionId)) throw new Error("world_passage_stale_reload_and_review");
    if (l.mapImage && !maps.has(l.mapImage.versionId)) maps.set(l.mapImage.versionId, resolveApprovedImage(artifacts, projectId, l.mapImage));
  }
  const presentation = content.enabled ? NativeWorldSchema.parse({ schemaId: "cyoa.native-world", schemaVersion: 1,
    startLocationId: content.startLocationId, initialMinutes: content.initialMinutes, waitMinutes: content.waitMinutes,
    locations: content.locations.map(({ passage, mapImage, ...l }) => ({ ...l, passageId: passage?.passageId ?? null, mapImage: mapImage?.versionId ?? null })),
    connections: content.connections, actions: content.actions, ...(content.journal ? { journal: projectWorldJournal(content.journal, exactMechanics) } : {}), ...(content.economy ? { economy: projectWorldEconomy(content.economy, relationshipOptions) } : {}), assets: [...maps.values()], ...(content.progression ? { progression: projectWorldProgression(content.progression) } : {}), ...(content.people ? { people: projectWorldPeople(content.people) } : {}) }) : null;
  return { versionId: version.id, content, presentation };
}
export function worldReference(world: NonNullable<ResolvedNativeCompilationInput["world"]>) {
  return { schemaVersion: 1 as const, versionId: world.versionId, contentFingerprint: stableFingerprint(world.content), presentationFingerprint: stableFingerprint(world.presentation) };
}
