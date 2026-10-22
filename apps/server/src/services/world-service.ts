import { z } from "zod";
import { WorldDefinitionSchema, emptyWorld, sourceDigest, type WorldDefinition } from "@story-to-cyoa/domain";
import { ArtifactRepository, PassagePlanRepository, ProjectRepository, validateWorld, type StoryDatabase } from "@story-to-cyoa/persistence";
import { stableFingerprint, NativeWorldSchema } from "@story-to-cyoa/runtime";
import { PassageStructureSchema, type ResolvedNativeCompilationInput } from "@story-to-cyoa/pipeline";
import { resolveApprovedImage } from "./illustrated-scene-service.js";

const project = { projectId: z.string().min(1).max(200) };
export const WorldInputs = {
  read_world: z.object(project).strict(),
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
    return { versionId: current?.id ?? null, world: current?.content ?? emptyWorld(), providerCalls: 0 };
  }
  review(projectId: string, value: unknown) {
    const current = this.read(projectId), world = validateWorld(this.database, projectId, value);
    for (const l of world.locations) if (l.passage && this.plans.currentEntity(projectId, "passage", l.passage.passageId)?.id !== l.passage.versionId) throw new Error("world_passage_stale_reload_and_review");
    const structure = this.plans.currentStructure(projectId);
    if (world.enabled && world.locations.find((l) => l.id === world.startLocationId)?.passage?.passageId !== (structure && PassageStructureSchema.parse(structure.content).startPassageId)) throw new Error("world_start_passage_must_match_game");
    const result = { world, previous: current.versionId ? current.world : null, versionId: current.versionId,
      structureVersionId: structure?.id ?? null, providerCalls: 0 };
    return { ...result, fingerprint: sourceDigest({ projectId, ...result }) };
  }
  apply(projectId: string, value: unknown, fingerprint: string) {
    const review = this.review(projectId, value);
    if (review.fingerprint !== fingerprint) throw new Error("world_review_stale_reload_and_review");
    const version = this.artifacts.saveArtifactInTransaction({ projectId, artifactId: "world-definition", artifactType: "world-definition", content: review.world, markDependentsStale: false });
    return { versionId: version.id, status: "applied", providerCalls: 0 };
  }
}

export function resolveWorld(artifacts: Pick<ArtifactRepository, "getCurrent" | "getVersion">, projectId: string,
  passages: Array<{ entityId: string; versionId: string }>, ref?: { versionId: string; contentFingerprint: string }): ResolvedNativeCompilationInput["world"] {
  const version = ref ? artifacts.getVersion<WorldDefinition>(ref.versionId) : artifacts.getCurrent<WorldDefinition>(projectId, "world-definition");
  if (!version) { if (ref) throw new Error("world_input_missing"); return undefined; }
  if (version.projectId !== projectId || version.artifactId !== "world-definition" || version.artifactType !== "world-definition" || version.schemaVersion !== 1
    || ref && stableFingerprint(version.content) !== ref.contentFingerprint) throw new Error("world_input_lineage_invalid");
  const content = WorldDefinitionSchema.parse(version.content);
  const maps = new Map<string, ReturnType<typeof resolveApprovedImage>>();
  for (const l of content.locations) {
    if (l.passage && !passages.some((p) => p.entityId === l.passage!.passageId && p.versionId === l.passage!.versionId)) throw new Error("world_passage_stale_reload_and_review");
    if (l.mapImage && !maps.has(l.mapImage.versionId)) maps.set(l.mapImage.versionId, resolveApprovedImage(artifacts, projectId, l.mapImage));
  }
  const presentation = content.enabled ? NativeWorldSchema.parse({ schemaId: "cyoa.native-world", schemaVersion: 1,
    startLocationId: content.startLocationId, initialMinutes: content.initialMinutes, waitMinutes: content.waitMinutes,
    locations: content.locations.map(({ passage, mapImage, ...l }) => ({ ...l, passageId: passage?.passageId ?? null, mapImage: mapImage?.versionId ?? null })),
    connections: content.connections, actions: content.actions, assets: [...maps.values()] }) : null;
  return { versionId: version.id, content, presentation };
}
export function worldReference(world: NonNullable<ResolvedNativeCompilationInput["world"]>) {
  return { schemaVersion: 1 as const, versionId: world.versionId, contentFingerprint: stableFingerprint(world.content), presentationFingerprint: stableFingerprint(world.presentation) };
}
