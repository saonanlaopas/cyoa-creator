import { ArtifactRepository, DraftingRepository, PassageDraftRepository, PassagePlanRepository, ProjectRepository, WorkflowRepository, type StoryDatabase } from "@story-to-cyoa/persistence";
import { PassageDraftingService } from "../../src/services/passage-drafting-service.js";
export function testDraftingContext(database: StoryDatabase) {
  return new PassageDraftingService(new ProjectRepository(database), new ArtifactRepository(database), new WorkflowRepository(database), new PassagePlanRepository(database), new PassageDraftRepository(database), new DraftingRepository(database), { id: "offline-drafting", capabilities: { structuredOutput: true }, generate: async () => { throw new Error("Provider calls forbidden"); } });
}
