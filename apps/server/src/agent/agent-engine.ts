import { randomUUID } from 'node:crypto';
import { actionNameSchema, actionArgsSchemas, agentTypeSchema } from '@koodu/protocol';
import type Database from 'better-sqlite3';
import type { InferenceRuntime, InferenceResponse } from '../inference/types';
import type { MainAgent } from './main-agent';

const MAX_ITERATIONS = 4;
const MAX_TOOL_CALLS = 6;
const toolNames = ['search_memory', 'list_skills', 'workspace_pages'] as const;
type ToolName = (typeof toolNames)[number];
const toolDescriptions = [
  { name: 'search_memory', description: 'Find relevant saved user memories.', parameters: { query: 'string' } },
  { name: 'list_skills', description: 'List enabled skill names and short descriptions.', parameters: {} },
  { name: 'workspace_pages', description: 'List the Koodu pages available to open.', parameters: {} },
];

export interface AgentRunResult {
  taskId: string;
  reply: string;
  proposal: InferenceResponse['proposal'];
  provider: string;
  iterations: number;
  toolCalls: number;
}

/** Bounded server-side reasoning loop. Tools are read-only and explicitly allowlisted. */
export class AgentEngine {
  constructor(private readonly database: Database.Database, private readonly memory: MainAgent) {}

  async run(input: { text: string; context: Record<string, unknown>; runtime: InferenceRuntime; agentType?: string; signal?: AbortSignal; onTextDelta?: (text: string) => void; onTextReset?: () => void }): Promise<AgentRunResult> {
    const taskId = randomUUID();
    const agentType = agentTypeSchema.safeParse(input.agentType ?? 'organizer').data ?? 'organizer';
    const now = new Date().toISOString();
    this.database.prepare(`INSERT INTO agent_tasks (id,agent_type,task,status,progress,created_at,updated_at) VALUES (?, ?, ?, 'running', 0, ?, ?)`).run(taskId, agentType, input.text, now, now);
    this.event(taskId, 'started', { message: 'The companion started working on the request.' });
    let toolCalls = 0;
    let response: InferenceResponse | null = null;
    const observations: Array<{ tool: string; result: string }> = [];
    const conversation = Array.isArray(input.context.conversation)
      ? input.context.conversation
          .filter((item): item is { role: 'user' | 'assistant'; content: string } => Boolean(item) && typeof item === 'object' && ((item as { role?: unknown }).role === 'user' || (item as { role?: unknown }).role === 'assistant') && typeof (item as { content?: unknown }).content === 'string')
          .slice(-12)
          .map((item) => ({ role: item.role, content: item.content.slice(0, 1_200) }))
      : undefined;
    try {
      for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration += 1) {
        if (input.signal?.aborted) throw new Error('cancelled');
        const context = {
          currentPath: typeof input.context.currentPath === 'string' ? input.context.currentPath.slice(0, 120) : undefined,
          conversation,
          agentMode: true,
          agentType,
          availableTools: toolDescriptions,
          iteration,
          observations,
        };
        response = await input.runtime.complete({ text: input.text, context, onTextDelta: input.onTextDelta }, input.signal);
        const calls = response.toolCalls ?? [];
        if (!calls.length) {
          const reply = (response.reply ?? '').trim() || (response.proposal ? `I can ${response.proposal.action.replaceAll('_', ' ')} to help with that.` : 'I couldn’t determine a useful next step. Could you clarify what you’d like me to do?');
          this.finish(taskId, 'completed', { result: reply, progress: 100 });
          this.event(taskId, 'completed', { message: 'The companion finished the request.' });
          return { taskId, reply, proposal: validateProposal(response.proposal), provider: response.provider, iterations: iteration, toolCalls };
        }
        input.onTextReset?.();
        if (toolCalls + calls.length > MAX_TOOL_CALLS) throw new Error('tool_call_limit_reached');
        for (const call of calls) {
          const name = toolNames.find((candidate) => candidate === call.name);
          if (!name) {
            observations.push({ tool: call.name.slice(0, 40), result: 'Tool unavailable.' });
            continue;
          }
          const result = await this.execute(name, call.args);
          observations.push({ tool: name, result: result.slice(0, 2_000) });
          toolCalls += 1;
          this.event(taskId, 'tool', { message: this.toolMessage(name), tool: name });
        }
        this.database.prepare('UPDATE agent_tasks SET progress=?, updated_at=? WHERE id=?').run(Math.round((iteration / MAX_ITERATIONS) * 80), new Date().toISOString(), taskId);
      }
      const reply = 'I reached the safe step limit before completing that request. Please narrow it down or split it into smaller steps.';
      this.finish(taskId, 'completed', { result: reply, progress: 100 });
      this.event(taskId, 'completed', { message: 'The companion stopped at its safe step limit.' });
      return { taskId, reply, proposal: null, provider: response?.provider ?? input.runtime.id, iterations: MAX_ITERATIONS, toolCalls };
    } catch (error) {
      const cancelled = input.signal?.aborted || (error instanceof Error && error.message === 'cancelled');
      const reason = cancelled ? 'Request cancelled.' : 'The companion could not complete the request.';
      this.finish(taskId, cancelled ? 'cancelled' : 'failed', { error: cancelled ? null : reason });
      this.event(taskId, cancelled ? 'cancelled' : 'failed', { message: reason });
      throw error;
    }
  }

  private async execute(name: ToolName, args: Record<string, unknown>): Promise<string> {
    if (name === 'search_memory') {
      const query = typeof args.query === 'string' ? args.query.trim().slice(0, 350) : '';
      if (!query) return 'A non-empty query is required.';
      return this.memory.search_memory(query, { topK: 4, threshold: 0.15 });
    }
    if (name === 'list_skills') {
      const rows = this.database.prepare('SELECT name,description FROM skills WHERE enabled=1 ORDER BY name COLLATE NOCASE LIMIT 30').all() as Array<{name:string;description:string}>;
      return rows.length ? rows.map((row) => `${row.name}: ${row.description}`).join('\n') : 'No enabled skills are available.';
    }
    return 'Usage, Models, Agents, Chats, Memory, Logs, Skills, and Settings are available at /workspace/<page>.';
  }

  private toolMessage(name: ToolName): string {
    return name === 'search_memory' ? 'The companion searched saved memory.' : name === 'list_skills' ? 'The companion checked enabled skills.' : 'The companion checked available workspace pages.';
  }

  private event(taskId: string, type: string, payload: Record<string, unknown>): void {
    this.database.prepare('INSERT INTO agent_task_events (task_id,event_type,payload_json) VALUES (?,?,?)').run(taskId, type, JSON.stringify(payload));
  }
  private finish(taskId: string, status: string, extra: { result?: string; error?: string | null; progress?: number }): void {
    this.database.prepare('UPDATE agent_tasks SET status=?, progress=COALESCE(?,progress), updated_at=? WHERE id=?').run(status, extra.progress ?? null, new Date().toISOString(), taskId);
    if (extra.result !== undefined) this.event(taskId, 'result', { result: extra.result });
    if (extra.error) this.event(taskId, 'error', { message: extra.error });
  }
}

function validateProposal(proposal: InferenceResponse['proposal']): InferenceResponse['proposal'] {
  if (!proposal) return null;
  const action = actionNameSchema.safeParse(proposal.action);
  if (!action.success) return null;
  const args = actionArgsSchemas[action.data].safeParse(proposal.args);
  return args.success ? { action: action.data, args: args.data } : null;
}
