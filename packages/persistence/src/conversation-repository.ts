import { randomUUID } from "node:crypto";
import type { StoryDatabase } from "./database.js";

export interface AssistantScope {
  kind: "project" | "artifact";
  projectId: string;
  stage?: "brief";
  artifactId?: "brief";
  versionId?: string;
}

export interface ConversationRecord {
  id: string;
  projectId: string;
  title: string;
  scope: AssistantScope;
  summary: string;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  intent: "discuss" | "propose";
  scope: AssistantScope;
  context: { briefVersionId?: string };
  metadata: Record<string, unknown>;
  createdAt: string;
}

type ConversationRow = {
  id: string; project_id: string; title: string; scope_json: string;
  summary: string; created_at: string; updated_at: string;
};
type MessageRow = {
  id: string; conversation_id: string; role: MessageRecord["role"]; content: string;
  intent: MessageRecord["intent"]; scope_json: string; context_json: string;
  metadata_json: string; created_at: string;
};

const parse = <T>(value: string): T => JSON.parse(value) as T;
const mapConversation = (row: ConversationRow): ConversationRecord => ({
  id: row.id,
  projectId: row.project_id,
  title: row.title,
  scope: parse(row.scope_json),
  summary: row.summary,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
const mapMessage = (row: MessageRow): MessageRecord => ({
  id: row.id,
  conversationId: row.conversation_id,
  role: row.role,
  content: row.content,
  intent: row.intent,
  scope: parse(row.scope_json),
  context: parse(row.context_json),
  metadata: parse(row.metadata_json),
  createdAt: row.created_at,
});

export class ConversationRepository {
  public constructor(private readonly database: StoryDatabase) {}

  create(projectId: string, scope: AssistantScope, title = "Project brief discussion"): ConversationRecord {
    if (scope.projectId !== projectId) throw new Error("Conversation scope must belong to its project");
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO conversations (id, project_id, title, scope_json, summary, created_at, updated_at)
      VALUES (?, ?, ?, ?, '', ?, ?)
    `).run(id, projectId, title.trim() || "Project discussion", JSON.stringify(scope), now, now);
    return this.get(id)!;
  }

  get(id: string): ConversationRecord | undefined {
    const row = this.database.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as ConversationRow | undefined;
    return row ? mapConversation(row) : undefined;
  }

  list(projectId: string): ConversationRecord[] {
    return (this.database.prepare(`
      SELECT * FROM conversations WHERE project_id = ? ORDER BY updated_at DESC, id
    `).all(projectId) as ConversationRow[]).map(mapConversation);
  }

  updateScope(id: string, scope: AssistantScope): ConversationRecord {
    const conversation = this.get(id);
    if (!conversation) throw new Error("Conversation not found");
    if (scope.projectId !== conversation.projectId) throw new Error("Conversation scope must belong to its project");
    this.database.prepare("UPDATE conversations SET scope_json = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(scope), new Date().toISOString(), id);
    return this.get(id)!;
  }

  addMessage(input: Omit<MessageRecord, "id" | "createdAt">): MessageRecord {
    const conversation = this.get(input.conversationId);
    if (!conversation) throw new Error("Conversation not found");
    if (input.scope.projectId !== conversation.projectId) throw new Error("Message scope must belong to its project");
    const content = input.content.trim();
    if (!content) throw new Error("Message is required");
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO messages
        (id, conversation_id, role, content, intent, scope_json, context_json, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, input.conversationId, input.role, content, input.intent,
      JSON.stringify(input.scope), JSON.stringify(input.context), JSON.stringify(input.metadata), now,
    );
    this.database.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now, input.conversationId);
    return this.getMessage(id)!;
  }

  listMessages(conversationId: string): MessageRecord[] {
    return (this.database.prepare(`
      SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid
    `).all(conversationId) as MessageRow[]).map(mapMessage);
  }

  private getMessage(id: string): MessageRecord | undefined {
    const row = this.database.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MessageRow | undefined;
    return row ? mapMessage(row) : undefined;
  }
}
