import { z } from "zod";

export const ProjectBriefSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  workingTitle: z.string().trim().min(1).max(200),
  premise: z.string().max(20_000).default(""),
  sourceMode: z.enum(["imported-source", "original-premise"]).default("imported-source"),
  protagonist: z.string().max(200).default(""),
  pointOfView: z.enum(["first-person", "second-person", "third-person"]).default("second-person"),
  adaptationFidelity: z.enum(["canon-centered", "balanced", "expansive"]).default("balanced"),
  tone: z.string().max(2_000).default(""),
  contentBoundaries: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  totalWordTarget: z.number().int().min(50_000).max(1_000_000).default(175_000),
  typicalPlaythroughWordTarget: z.number().int().min(10_000).max(500_000).default(50_000),
  routeTarget: z.number().int().min(2).max(20).default(5),
  endingTarget: z.number().int().min(3).max(30).default(10),
  passageWordTarget: z.number().int().min(100).max(1_500).default(500),
  branchingStyle: z.enum(["braided", "route-focused", "wide-tree"]).default("braided"),
  priorityCharacters: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  priorityRelationships: z.array(z.string().trim().min(1).max(300)).max(50).default([]),
  projectConstraints: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
  unresolvedQuestions: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
}).superRefine((brief, context) => {
  if (brief.typicalPlaythroughWordTarget >= brief.totalWordTarget) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["typicalPlaythroughWordTarget"],
      message: "Typical playthrough target must be smaller than the total project target",
    });
  }
});

export type ProjectBrief = z.infer<typeof ProjectBriefSchema>;

export function defaultProjectBrief(workingTitle = "Untitled long-form CYOA"): ProjectBrief {
  return ProjectBriefSchema.parse({ workingTitle });
}
