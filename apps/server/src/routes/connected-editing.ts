import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ConnectedEditInputs, boundedConnectedResult, type ConnectedEditService, type ConnectedEditTool } from "../services/connected-edit-service.js";
import type { ConnectedEditingConfig } from "../config.js";

const descriptions: Record<ConnectedEditTool, string> = {
  read_world: "Read the durable location/time definition and current version. No gameplay mutation, provider call or transcript required. Maps bind exact approved image versions; passages bind exact plan versions.",
  review_world: "Review a complete authored location/time definition against the current world and passage structure. Includes hierarchy, approved maps, percentage markers, directed travel durations, daily opening hours, local actions and waiting. Ask for separate author approval of this exact fingerprint. No chapters, schedules, items or generation.",
  apply_world: "After explicit author approval, atomically store the exact reviewed world with retry-safe UUID and stale-base checks. No implicit compilation or publication. Disable by reviewing a cleared definition; historical worlds/builds remain immutable.",
  read_scene: "Read the current scene, exact passage binding and staleness. Text layout clears artwork. Asset references must name exact approved versions; expressions and dialogue are authored presentation, not gameplay or prose approval.",
  review_scene: "Review one authored scene against its previous version and exact current passage. Assign only approved image versions, up to three positioned portraits with explicit expressions, optional background and speaker dialogue. No generation. Ask the author to approve the returned exact fingerprint separately.",
  apply_scene: "After explicit author approval, apply the exact reviewed scene/fingerprint atomically with a retry-safe operation UUID. Does not approve prose, change choices or publish. Stale passage/scene bases require a new review. Historical approved assets remain pinned until explicitly reassigned.",
  list_assets: "List compact project image title/status summaries, approval heads and thumbnail URLs, 25 per page. Read full metadata with read_asset. No binary output or generation.",
  read_asset: "Read exact image-asset metadata/provenance, image URLs, retained approved version and paginated immutable history. No scene assignment or generation.",
  asset_usage: "Inspect exact library version references and paginated current scene assignments. Never infer usage from prose mentions.",
  list_staged_assets: "List bounded regular image filenames/digests only in the explicitly configured staging directory. No arbitrary paths, URLs or filesystem access. Disabled unless configured.",
  import_staged_asset: "After author consent, import one listed PNG/JPEG/WebP by basename and exact source digest as an unapproved candidate. No symlinks or paths. Bind replacements to assetId/expectedVersionId; retain approved history. Zero provider calls; identical UUID retry survives file removal.",
  revise_asset: "Create a new metadata candidate at an exact asset head. Never implicitly approve or replace the retained approved image. Requires author consent and retry-safe UUID.",
  review_asset: "Inspect an exact current candidate beside the retained approved version, metadata, provenance, license findings and usage before asking for approval. Returns a locally computed review fingerprint.",
  approve_asset: "Only after author approval of this exact image/metadata review, approve the current candidate version and fingerprint. Separate from upload/import. Retry identical UUID/arguments; stale heads require new review.",
  reject_asset: "Reject only the explicitly reviewed current candidate, preserving all immutable files and any earlier approved version. Requires exact review fingerprint, author consent and retry-safe UUID.",
  game_state: "Read exact game head, plan approval state and paginated passage/choice/thread metadata with draft IDs. No transcript required. Use read_game_record for bounded exact content.",
  read_game_record: "Read one exact structure/entity/draft version and current head. Omit versionId for current; supply it for saved candidate prose before acceptance. No generation or mutation.",
  initialize_game_plan: "Create Creator's default passage-plan skeleton once from current approved foundations, with exact game head and author consent. Revise using prepare_edit/submit_edit/review_edit/apply_edit; this does not approve the plan or write prose.",
  review_game_plan: "Validate the current passage graph using Creator's shared validator. Inspect findings and exact records before authorizing the returned fingerprint/head. Findings beyond 50 are counted, never silently omitted.",
  approve_game_plan: "Only after author approval, create and approve an exact snapshot of the reviewed current graph. Requires exact head/fingerprint, approved=true, no hard validation errors and current foundation approvals. Use the same operation UUID for identical retries.",
  submit_draft: "Submit externally authored prose as an immutable candidate only, bound to exact passage version/game head and an author request. Never overwrites accepted/locked prose and makes zero provider calls. Review the candidate and acceptance diff separately. Retry identical operation UUID/arguments.",
  review_drafts: "Read exact candidate/previous-accepted text and dependency-safe acceptance preview for 1-12 selected passages. Narrow the batch if response size is exceeded. Present the diff, issues and downstream staleness to the author.",
  accept_drafts: "Accept only the explicitly author-approved candidate selection and exact acceptance fingerprint. Shared Creator acceptance guards stale bases, neighbors and locks, preserving old versions. No automatic unlock or review/lock lifecycle promotion. Retry identical UUID/arguments.",
  publication_readiness: "Inspect current shared compiler readiness, blockers, warnings and counts without generating prose or compiling. Approve the exact fingerprint/head separately to compile. Omitted diagnostic counts remain explicit.",
  compile_game: "After explicit author approval, compile the exact current publication-ready game through Creator's native compiler, capturing immutable input/build versions. No silent staleness override. Use identical operation UUID/arguments for retry.",
  simulate_game: "Run a deterministic authored choice-ID path against an exact approved current plan, with optional expected ending. Stores reproducible input/trace, never provider narration. Inspect with read_simulation and revise through proposals. Requires consent and exact game head; retry identical UUID/arguments.",
  read_simulation: "Read and verify a stored deterministic simulation trace, paginated 50 steps, including actual result and final state. No claims of exhaustive correctness.",
  export_game: "Prepare a download link for one exact native build as standalone HTML, static ZIP or text-only manuscript Markdown. Illustrated scenes require native HTML/ZIP; incompatible Markdown is rejected. Fetch the returned same-server path to render/download through Creator's existing export service; this tool returns no file bytes and writes no file. Historical content requires allowHistorical=true. Creator uses current player configuration. Published games require no AI service.",
  list_projects: "List only configured Long-form projects and explicitly enabled empty creation slots. No provider generation, arbitrary filesystem, SQL or HTTP tools are exposed.",
  create_project: "Create an original-premise Long-form project only in a configured empty UUID slot, with creation enabled by the server and approved=true from the author. Creates default brief/Creative Direction drafts, not approved content. Retry identical arguments with the same operation UUID.",
  initialize_foundation: "Create a missing bible/routes/endings/mechanics default draft through Creator's service after its prerequisites are approved. Requires the exact project head and author approval. Inspect its schema-shaped content with read_foundation, then propose real content with prepare_edit/submit_edit. Never replaces existing work.",
  read_foundation: "Read a current foundation artifact or stable-ID section, bounded to 64KB. Use section:<field> or an entity ID to narrow a large artifact. Returns exact version, staleness, content and project head; no provider call.",
  review_foundation_approval: "Review an exact fresh current artifact version, shared canonical validation and approval prerequisites. Show content/findings to the author before requesting approval. Applying a proposal does not approve it. Large results require browser review.",
  approve_foundation: "Only after explicit author approval, approve the exact reviewed artifact version and fingerprint with approved=true. Uses Creator's prerequisite/validation service, never approves historical or stale versions. Approval is separate from Apply, generation and publication. Retry identical operation UUID/arguments after a lost response.",
  project_state: "Read current project version fingerprint and approval/draft state before preparing an edit.",
  list_edit_targets: "Discover editable stable target keys and exact versions; 50 records per page. Use narrow explicit scope.",
  list_edits: "Discover saved proposal IDs and statuses, 50 metadata-only records per page. Resume without the original assistant chat, then get_edit or review_edit for exact details.",
  prepare_edit: "Capture bounded context for exact target versions and project head. Supply a new UUID operationId; retry identical arguments after a lost response. Stores the author request, but changes no canonical content.",
  submit_edit: "Submit assistant-authored groups for the captured plan/fingerprint, without a provider call. Use only scoped operations; new IDs use $new:<logical-key>. add-entity creates a passage/choice/thread only against passage-structure:root with entityKind and a full schema-shaped item. Do not invent lifecycle states or fingerprints. Changes remain proposals until reviewed and explicitly approved.",
  get_edit: "Read a saved proposal and its status, including truthful connected-assistant provenance. Recover after reconnect without relying on the original chat.",
  review_edit: "Review the exact selected group diff, validation, dependencies and staleness. Show the author this result before Apply. A stale base requires a fresh project_state/prepare_edit and a new proposal, never overwrite.",
  apply_edit: "Apply only the author's explicitly approved batch using the exact review fingerprint/groupIds and approved=true. Draft creation is NOT artifact approval or publication. Retry the same UUID and arguments after a lost response; changed arguments require a new UUID.",
  reject_edit: "Reject a saved pending proposal; changes no canonical content. Use a retry-safe UUID.",
};
const reads = new Set<ConnectedEditTool>(["list_projects", "project_state", "list_edit_targets", "list_edits", "get_edit", "review_edit", "read_foundation", "review_foundation_approval"]);
for (const name of ["game_state", "read_game_record", "review_game_plan", "review_drafts", "publication_readiness", "read_simulation", "export_game"] as const) reads.add(name);
for (const name of ["list_assets", "read_asset", "asset_usage", "list_staged_assets", "review_asset"] as const) reads.add(name);
for (const name of ["read_scene", "review_scene"] as const) reads.add(name);
for (const name of ["read_world", "review_world"] as const) reads.add(name);

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
          annotations: { readOnlyHint: reads.has(name), destructiveHint: ["apply_world", "apply_scene", "apply_edit", "reject_edit", "approve_foundation", "approve_game_plan", "accept_drafts", "approve_asset", "reject_asset"].includes(name), idempotentHint: true, openWorldHint: false } },
        async (args: unknown): Promise<CallToolResult> => {
          try {
            const result = boundedConnectedResult(await service.call(name, args)) as Record<string, unknown>;
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
