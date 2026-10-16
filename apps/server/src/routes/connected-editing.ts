import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ConnectedEditInputs, boundedConnectedResult, type ConnectedEditService, type ConnectedEditTool } from "../services/connected-edit-service.js";
import type { ConnectedEditingConfig } from "../config.js";

const descriptions: Record<ConnectedEditTool, string> = {
  list_projects: "List only configured Long-form projects and explicitly enabled empty creation slots. No provider generation, passage authoring, or export tools are exposed.",
  create_project: "Create an original-premise Long-form project only in a configured empty UUID slot, with creation enabled by the server and approved=true from the author. Creates default brief/Creative Direction drafts, not approved content. Retry identical arguments with the same operation UUID.",
  initialize_foundation: "Create a missing bible/routes/endings/mechanics default draft through Creator's service after its prerequisites are approved. Requires the exact project head and author approval. Inspect its schema-shaped content with read_foundation, then propose real content with prepare_edit/submit_edit. Never replaces existing work.",
  read_foundation: "Read a current foundation artifact or stable-ID section, bounded to 64KB. Use section:<field> or an entity ID to narrow a large artifact. Returns exact version, staleness, content and project head; no provider call.",
  review_foundation_approval: "Review an exact fresh current artifact version, shared canonical validation and approval prerequisites. Show content/findings to the author before requesting approval. Applying a proposal does not approve it. Large results require browser review.",
  approve_foundation: "Only after explicit author approval, approve the exact reviewed artifact version and fingerprint with approved=true. Uses Creator's prerequisite/validation service, never approves historical or stale versions. Approval is separate from Apply, generation and publication. Retry identical operation UUID/arguments after a lost response.",
  project_state: "Read current project version fingerprint and approval/draft state before preparing an edit.",
  list_edit_targets: "Discover editable stable target keys and exact versions; 50 records per page. Use narrow explicit scope.",
  list_edits: "Discover saved proposal IDs and statuses, 50 metadata-only records per page. Resume without the original assistant chat, then get_edit or review_edit for exact details.",
  prepare_edit: "Capture bounded context for exact target versions and project head. Supply a new UUID operationId; retry identical arguments after a lost response. Stores the author request, but changes no canonical content.",
  submit_edit: "Submit assistant-authored groups for the captured plan/fingerprint, without a provider call. Use only scoped operations; new item IDs use $new:<logical-key>. Do not invent lifecycle states or fingerprints. Changes remain proposals until reviewed and explicitly approved.",
  get_edit: "Read a saved proposal and its status, including truthful connected-assistant provenance. Recover after reconnect without relying on the original chat.",
  review_edit: "Review the exact selected group diff, validation, dependencies and staleness. Show the author this result before Apply. A stale base requires a fresh project_state/prepare_edit and a new proposal, never overwrite.",
  apply_edit: "Apply only the author's explicitly approved batch using the exact review fingerprint/groupIds and approved=true. Draft creation is NOT artifact approval or publication. Retry the same UUID and arguments after a lost response; changed arguments require a new UUID.",
  reject_edit: "Reject a saved pending proposal; changes no canonical content. Use a retry-safe UUID.",
};
const reads = new Set<ConnectedEditTool>(["list_projects", "project_state", "list_edit_targets", "list_edits", "get_edit", "review_edit", "read_foundation", "review_foundation_approval"]);

export function registerConnectedEditing(app: FastifyInstance, service: ConnectedEditService, config: ConnectedEditingConfig) {
  const token = Buffer.from(`Bearer ${config.token}`);
  app.route({ method: ["POST", "GET", "DELETE"], url: "/mcp", bodyLimit: 196_000,
    onRequest: async (req, reply) => {
      const authorization = Buffer.from(req.headers.authorization ?? "");
      if (authorization.length !== token.length || !timingSafeEqual(authorization, token)) {
        return reply.code(401).header("WWW-Authenticate", 'Bearer realm="cyoa-connected-editing"').send({ error: "connected_auth_required" });
      }
      if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.ip)
        || !/^(127\.0\.0\.1|localhost|\[::1\])(:[0-9]{1,5})?$/.test(req.headers.host ?? "") || req.headers.origin !== undefined) {
        return reply.code(403).send({ error: "connected_loopback_client_required" });
      }
    },
    handler: async (req, reply) => {
      if (req.method !== "POST") return reply.code(405).header("Allow", "POST").send({ error: "connected_stateless_post_required" });
      const server = new McpServer({ name: "cyoa-connected-editing", version: "1.0.0" });
      for (const name of Object.keys(ConnectedEditInputs) as ConnectedEditTool[]) {
        server.registerTool(name, { description: descriptions[name], inputSchema: ConnectedEditInputs[name],
          annotations: { readOnlyHint: reads.has(name), destructiveHint: name === "apply_edit" || name === "reject_edit" || name === "approve_foundation", idempotentHint: true, openWorldHint: false } },
        async (args: unknown): Promise<CallToolResult> => {
          try {
            const result = boundedConnectedResult(service.call(name, args)) as Record<string, unknown>;
            return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
          } catch (error) {
            const message = error instanceof Error ? error.message.slice(0, 1000) : "connected_operation_failed";
            return { isError: true, content: [{ type: "text", text: message }] };
          }
        });
      }
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      try {
        await server.connect(transport);
        reply.hijack();
        await transport.handleRequest(req.raw, reply.raw, req.body);
      } finally { await server.close(); }
    },
  });
}
