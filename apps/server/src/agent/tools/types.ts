import type Database from 'better-sqlite3';
import type { z } from 'zod';
import type { MemoryCategory } from '../main-agent';
import type { SkillsEngine } from '../../skills';

export type ToolRisk = 'safe' | 'confirm' | 'dangerous';

/** Narrow memory port so tools and tests do not depend on the embedding stack. */
export interface MemoryPort {
  search_memory(query: string, options?: { topK?: number; threshold?: number }): Promise<string>;
  save_memory(fact: string, category?: MemoryCategory): Promise<number>;
}

export interface ToolContext {
  taskId: string;
  signal?: AbortSignal;
  database: Database.Database;
  memory: MemoryPort;
  skills: SkillsEngine;
  /** Absolute, sandboxed directory for file tools. */
  workspaceRoot: string;
}

export interface ToolResult {
  ok: boolean;
  /** Model-facing observation. */
  content: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  risk: ToolRisk;
  /** Human-readable parameter hints injected into the prompt. */
  parameters: Record<string, string>;
  schema: z.ZodTypeAny;
  timeoutMs?: number;
  execute(args: Record<string, unknown>, context: ToolContext): Promise<string | ToolResult>;
}

export interface ToolDescriptor {
  name: string;
  description: string;
  parameters: Record<string, string>;
  risk: ToolRisk;
}

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  result: string;
  ok: boolean;
}
