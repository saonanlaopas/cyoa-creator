import { z } from "zod";
export const ChangeProposalSchema = z.object({ id: z.string(), message: z.string(), preview: z.string(), relationshipThresholds: z.array(z.string()), affectedArtifacts: z.array(z.string()), invalidations: z.array(z.string()), approved: z.boolean().default(false) });
export type ChangeProposal = z.infer<typeof ChangeProposalSchema>;
