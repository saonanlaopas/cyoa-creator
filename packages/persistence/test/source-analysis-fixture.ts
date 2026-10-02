import { planSourceAnalysis, sourceBinding, type AnalysisSource, type SourceAnalysisPlan, type SourceUnitOutput } from "@story-to-cyoa/domain";
import { ArtifactRepository, ProjectRepository, SourceAnalysisRepository, openDatabase, type StoryDatabase } from "../src/index.js";

export const smallSource: AnalysisSource = { metadata: { title: "The harbor", sourceFormat: "txt" }, chapters: [
  { id: "ch_one", title: "Chapter 1", order: 0, blocks: [
    { type: "paragraph", excerptId: "ex_one", text: "Alex and Mira are friends. Alex is twenty. Alexander watched the harbor." },
    { type: "paragraph", excerptId: "ex_two", text: "Alex is twenty-one. Mira is Alex's sister. Ren is Mira's rival. Jules and Ren are lovers." },
  ] },
  { id: "ch_two", title: "Chapter 2", order: 1, blocks: [{ type: "paragraph", excerptId: "ex_three", text: "Mira left the harbor before dawn. He remained behind. Perhaps he feared the sea." }] },
] };
export function analysisFixture(database: StoryDatabase = openDatabase(), source = smallSource, projectId = "source-project") {
  const projects = new ProjectRepository(database), artifacts = new ArtifactRepository(database), repository = new SourceAnalysisRepository(database);
  projects.create("Source analysis", projectId, "long-form");
  const imported = artifacts.saveArtifact({ projectId, artifactId: "source", content: source });
  const scope = artifacts.saveArtifact({ projectId, artifactId: "source-scope", content: { chapterIds: source.chapters.map((c) => c.id), sourceVersionId: imported.id }, dependencies: ["source"] });
  const binding = sourceBinding(projectId, imported.id, scope.id, source, source.chapters.map((c) => c.id));
  const plan = repository.savePlan(planSourceAnalysis(binding, source, "offline-source-analysis", "offline-source-v1"));
  return { database, projects, artifacts, repository, source, plan, projectId };
}
export function fixtureOutput(plan: SourceAnalysisPlan, index: number): SourceUnitOutput {
  const evidence = plan.units[index]!.ranges;
  return { schemaVersion: 1, observations: [
    { id: "alex", category: "character", identityKey: "Alex", field: "identity", claim: "Alex", classification: "source-canon", aliases: [], references: [], evidence: [evidence[0]!], uncertainty: "" },
    { id: "age", category: "character", identityKey: "Alex", field: "age", claim: index === 0 ? "Twenty" : "Twenty-one", classification: "source-canon", aliases: [], references: ["alex"], evidence: [evidence[0]!], uncertainty: "" },
    { id: "theme", category: "theme", identityKey: "Sea", field: "fear", claim: "The sea may represent fear", classification: "inference", aliases: [], references: ["alex"], evidence: [evidence[0]!], uncertainty: "Interpretation" },
  ] };
}
export function completeFixture(fixture: ReturnType<typeof analysisFixture>, jobId?: string) {
  const { repository, projectId, plan } = fixture;
  const job = jobId ? repository.getJob(projectId, jobId) : repository.createJob(projectId, plan.id, plan.fingerprint);
  for (const [index, unit] of plan.units.entries()) {
    if (repository.getJob(projectId, job.id).units.find((u) => u.id === unit.id)?.status === "completed") continue;
    const attempt = repository.beginAttempt(projectId, job.id, unit.id);
    repository.finishAttempt(projectId, job.id, unit.id, attempt.id, { status: "completed", output: fixtureOutput(plan, index) });
  }
  return repository.settle(projectId, job.id);
}
