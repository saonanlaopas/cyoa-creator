import type { Project } from "@story-to-cyoa/domain";

export function buildNarrativeReviewPrompt(project: Project, storyBible: unknown): string {
  const playable = project.passages.map((passage) => ({
    id: passage.id,
    purpose: passage.purpose,
    prose: passage.prose,
    choices: passage.choices.map((choice) => ({ id: choice.id, label: choice.label, destinationId: choice.destinationId })),
    requiredKnowledge: passage.requiredKnowledge,
    incomingAssumptions: passage.incomingAssumptions,
  }));
  return [
    "Review this interactive story. Findings are advisory only.",
    "Check false knowledge, forgotten consequences, voice drift, repetitive prose, pacing, and indistinguishable choices.",
    "Every finding must cite at least one generated passage ID and one source excerpt ID from the story bible.",
    `STORY_BIBLE\n${JSON.stringify(storyBible)}`,
    `PASSAGES\n${JSON.stringify(playable)}`,
  ].join("\n\n");
}
