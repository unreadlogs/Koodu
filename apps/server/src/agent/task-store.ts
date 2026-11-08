import type Database from 'better-sqlite3';
import type { AgentCheckpoint } from './types';

export interface StoredAgentTask {
  id: string;
  agentType: string;
  task: string;
  status: string;
  progress: number;
  result: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  steps: number;
  toolCalls: number;
  parentTaskId: string | null;
  checkpoint: AgentCheckpoint | null;
}

export interface StoredAgentEvent {
  id: number;
  taskId: string;
  occurredAt: string;
  type: string;
  payload: Record<string, unknown>;
}

function parseCheckpoint(raw: unknown): AgentCheckpoint | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const parsed = JSON.parse(raw) as AgentCheckpoint;
    return parsed && parsed.version === 1 && Array.isArray(parsed.observations) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Owns all SQLite writes for agent task lifecycle, events, and checkpoints.
 * The engine never builds SQL directly.
 */
export class TaskStore {
  constructor(private readonly database: Database.Database) {}

  create(input: { id: string; agentType: string; task: string; parentTaskId?: string | null }): StoredAgentTask {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO agent_tasks (id,agent_type,task,status,progress,created_at,updated_at,parent_task_id)
         VALUES (?, ?, ?, 'running', 0, ?, ?, ?)`,
      )
      .run(input.id, input.agentType, input.task, now, now, input.parentTaskId ?? null);
    return this.get(input.id)!;
  }

  get(taskId: string): StoredAgentTask | null {
    const row = this.database.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(taskId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      agentType: String(row.agent_type),
      task: String(row.task),
      status: String(row.status),
      progress: Number(row.progress ?? 0),
      result: typeof row.result === 'string' ? row.result : null,
      error: typeof row.error === 'string' ? row.error : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      steps: Number(row.steps ?? 0),
      toolCalls: Number(row.tool_calls ?? 0),
      parentTaskId: typeof row.parent_task_id === 'string' ? row.parent_task_id : null,
      checkpoint: parseCheckpoint(row.checkpoint_json),
    };
  }

  list(limit = 50): StoredAgentTask[] {
    const bounded = Math.max(1, Math.min(limit, 200));
    const rows = this.database
      .prepare('SELECT id FROM agent_tasks ORDER BY created_at DESC LIMIT ?')
      .all(bounded) as Array<{ id: string }>;
    return rows.map((row) => this.get(row.id)).filter((task): task is StoredAgentTask => task !== null);
  }

  events(taskId: string, limit = 200): StoredAgentEvent[] {
    const bounded = Math.max(1, Math.min(limit, 500));
    const rows = this.database
      .prepare('SELECT id,task_id,occurred_at,event_type,payload_json FROM agent_task_events WHERE task_id = ? ORDER BY id ASC LIMIT ?')
      .all(taskId, bounded) as Array<Record<string, unknown>>;
    return rows.map((row) => {
      let payload: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(String(row.payload_json));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
      } catch { /* keep empty payload */ }
      return {
        id: Number(row.id),
        taskId: String(row.task_id),
        occurredAt: String(row.occurred_at),
        type: String(row.event_type),
        payload,
      };
    });
  }

  event(taskId: string, type: string, payload: Record<string, unknown> = {}): void {
    this.database
      .prepare('INSERT INTO agent_task_events (task_id,event_type,payload_json) VALUES (?,?,?)')
      .run(taskId, type, JSON.stringify(payload));
  }

  touch(taskId: string, update: { progress?: number; steps?: number; toolCalls?: number }): void {
    this.database
      .prepare(
        `UPDATE agent_tasks SET progress=COALESCE(MAX(?,progress),progress), steps=COALESCE(?,steps),
         tool_calls=COALESCE(?,tool_calls), updated_at=? WHERE id=?`,
      )
      .run(
        update.progress ?? null,
        update.steps ?? null,
        update.toolCalls ?? null,
        new Date().toISOString(),
        taskId,
      );
  }

  saveCheckpoint(taskId: string, checkpoint: AgentCheckpoint): void {
    this.database
      .prepare('UPDATE agent_tasks SET checkpoint_json=?, updated_at=? WHERE id=?')
      .run(JSON.stringify(checkpoint), new Date().toISOString(), taskId);
  }

  complete(taskId: string, result: string): void {
    this.database
      .prepare("UPDATE agent_tasks SET status='completed', progress=100, result=?, error=NULL, checkpoint_json=NULL, updated_at=? WHERE id=?")
      .run(result, new Date().toISOString(), taskId);
    this.event(taskId, 'result', { result });
  }

  pause(taskId: string, checkpoint: AgentCheckpoint): void {
    this.database
      .prepare("UPDATE agent_tasks SET status='paused', checkpoint_json=?, updated_at=? WHERE id=?")
      .run(JSON.stringify(checkpoint), new Date().toISOString(), taskId);
  }

  fail(taskId: string, error: string): void {
    this.database
      .prepare("UPDATE agent_tasks SET status='failed', error=?, updated_at=? WHERE id=?")
      .run(error, new Date().toISOString(), taskId);
    this.event(taskId, 'error', { message: error });
  }

  cancel(taskId: string): void {
    this.database
      .prepare("UPDATE agent_tasks SET status='cancelled', updated_at=? WHERE id=?")
      .run(new Date().toISOString(), taskId);
    this.event(taskId, 'cancelled', { message: 'The task was cancelled.' });
  }

  /** Mark a paused (or transiently failed) task as running and return its checkpoint. */
  resume(taskId: string): AgentCheckpoint | null {
    const task = this.get(taskId);
    if (!task || !task.checkpoint || (task.status !== 'paused' && task.status !== 'failed')) return null;
    this.database
      .prepare("UPDATE agent_tasks SET status='running', updated_at=? WHERE id=?")
      .run(new Date().toISOString(), taskId);
    this.event(taskId, 'resumed', { message: 'The task resumed from its saved checkpoint.' });
    return task.checkpoint;
  }
}
