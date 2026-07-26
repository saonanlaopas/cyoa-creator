import { randomUUID } from "node:crypto";
import type { StoryDatabase } from "./database.js";

export type CommandScope = "global" | "project";

export interface InstructionCommand {
  id: string;
  scope: CommandScope;
  projectId: string | null;
  name: string;
  instruction: string;
  enabled: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

type CommandRow = {
  id: string;
  scope: CommandScope;
  project_id: string | null;
  name: string;
  instruction: string;
  enabled: number;
  position: number;
  created_at: string;
  updated_at: string;
};

type CreateCommandInput = {
  scope: CommandScope;
  projectId?: string;
  name: string;
  instruction: string;
  enabled?: boolean;
  position?: number;
};

type CommandFilter = { scope: "global" } | { scope: "project"; projectId: string };

const mapCommand = (row: CommandRow): InstructionCommand => ({
  id: row.id,
  scope: row.scope,
  projectId: row.project_id,
  name: row.name,
  instruction: row.instruction,
  enabled: Boolean(row.enabled),
  position: row.position,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const requireText = (value: string, message: string): string => {
  const clean = value.trim();
  if (!clean) throw new Error(message);
  return clean;
};

export class CommandRepository {
  constructor(private readonly database: StoryDatabase) {}

  create(input: CreateCommandInput): InstructionCommand {
    const name = requireText(input.name, "Command name is required");
    const instruction = requireText(input.instruction, "Command instruction is required");
    const projectId = this.validateScope(input.scope, input.projectId);
    const now = new Date().toISOString();
    const id = randomUUID();
    this.database.prepare(`
      INSERT INTO instruction_commands
        (id, project_id, scope, name, instruction, enabled, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, projectId, input.scope, name, instruction, input.enabled === false ? 0 : 1, input.position ?? 0, now, now);
    return this.get(id)!;
  }

  list(filter: CommandFilter): InstructionCommand[] {
    const rows = filter.scope === "global"
      ? this.database.prepare("SELECT * FROM instruction_commands WHERE scope = 'global' ORDER BY position, created_at, id").all()
      : this.database.prepare("SELECT * FROM instruction_commands WHERE scope = 'project' AND project_id = ? ORDER BY position, created_at, id").all(filter.projectId);
    return (rows as CommandRow[]).map(mapCommand);
  }

  listEffective(projectId: string): InstructionCommand[] {
    const rows = this.database.prepare(`
      SELECT * FROM instruction_commands
      WHERE enabled = 1 AND (scope = 'global' OR (scope = 'project' AND project_id = ?))
      ORDER BY CASE scope WHEN 'global' THEN 0 ELSE 1 END, position, created_at, id
    `).all(projectId) as CommandRow[];
    return rows.map(mapCommand);
  }

  update(id: string, patch: Partial<Pick<InstructionCommand, "name" | "instruction" | "enabled" | "position">>): InstructionCommand {
    const existing = this.get(id);
    if (!existing) throw new Error("Command not found");
    const name = patch.name === undefined ? existing.name : requireText(patch.name, "Command name is required");
    const instruction = patch.instruction === undefined
      ? existing.instruction
      : requireText(patch.instruction, "Command instruction is required");
    const enabled = patch.enabled === undefined ? existing.enabled : patch.enabled;
    const position = patch.position === undefined ? existing.position : patch.position;
    this.database.prepare(`
      UPDATE instruction_commands
      SET name = ?, instruction = ?, enabled = ?, position = ?, updated_at = ?
      WHERE id = ?
    `).run(name, instruction, enabled ? 1 : 0, position, new Date().toISOString(), id);
    return this.get(id)!;
  }

  delete(id: string): void {
    this.database.prepare("DELETE FROM instruction_commands WHERE id = ?").run(id);
  }

  private get(id: string): InstructionCommand | undefined {
    const row = this.database.prepare("SELECT * FROM instruction_commands WHERE id = ?").get(id) as CommandRow | undefined;
    return row ? mapCommand(row) : undefined;
  }

  private validateScope(scope: CommandScope, projectId: string | undefined): string | null {
    if (scope === "global") {
      if (projectId !== undefined) throw new Error("Global command cannot have a project ID");
      return null;
    }
    if (scope !== "project") throw new Error("Command scope is invalid");
    if (!projectId) throw new Error("Project command requires a project ID");
    const project = this.database.prepare("SELECT id FROM projects WHERE id = ?").get(projectId);
    if (!project) throw new Error("Project not found");
    return projectId;
  }
}
