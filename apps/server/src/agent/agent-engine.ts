import { randomUUID } from 'node:crypto';
import { actionArgsSchemas, actionNameSchema, agentTypeSchema, type AgentType } from '@koodu/protocol';
import type Database from 'better-sqlite3';
import type { InferenceResponse } from '../inference/types';
import type { SkillsEngine } from '../skills';
import type { MemoryPort, ToolRegistry } from './tools';
import { toolNamesFor } from './tools/policy';
import { TaskStore } from './task-store';
import type { AgentCheckpoint, AgentObservation, AgentRunInput, AgentRunResult } from './types';

const DEFAULT_MAX_ITERATIONS = 12;
const MAX_ITERATIONS_CAP = 40;
const DEFAULT_MAX_TOOL_CALLS = 24;
const MAX_TOOL_CALLS_CAP = 100;
const DEFAULT_MAX_RUN_MS = 75_000;
const MAX_RUN_MS_CAP = 600_000;
const MAX_CALLS_PER_TURN = 8;
const MAX_OBSERVATIONS_IN_CONTEXT = 8;
const MAX_OBSERVATION_CHARS = 2_000;
const MAX_CONVERSATION_MESSAGES = 16;
const MAX_CONVERSATION_CHARS = 2_000;
const MAX_SKILLS_IN_PROMPT = 3;

export interface AgentEngineDeps {
  database: Database.Database;
  memory: MemoryPort;
  skills: SkillsEngine;
  tools: ToolRegistry;
  workspaceRoot: string;
  tasks?: TaskStore;
  /** Optional override for tests or custom specialist agents. */
  toolPolicy?: (agentType: AgentType) => readonly string[];
}

interface LoopParams {
  taskId: string;
  input: AgentRunInput;
  agentType: AgentType;
  text: string;
  context: Record<string, unknown>;
  conversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
  observations: AgentObservation[];
  startIteration: number;
  startToolCalls: number;
  startPartialReply: string;
}

/**
 * Bounded, resumable reasoning loop. Tools are allowlisted and every mutation
 * is persisted through TaskStore so a long task can pause and continue.
 */
export class AgentEngine {
  private readonly database: Database.Database;
  private readonly memory: MemoryPort;
  private readonly skills: SkillsEngine;
  private readonly tools: ToolRegistry;
  private readonly tasks: TaskStore;
  private readonly workspaceRoot: string;
  private readonly toolPolicy: (agentType: AgentType) => readonly string[];

  constructor(deps: AgentEngineDeps) {
    this.database = deps.database;
    this.memory = deps.memory;
    this.skills = deps.skills;
    this.tools = deps.tools;
    this.tasks = deps.tasks ?? new TaskStore(deps.database);
    this.workspaceRoot = deps.workspaceRoot;
    this.toolPolicy = deps.toolPolicy ?? toolNamesFor;
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const agentType = agentTypeSchema.safeParse(input.agentType ?? 'organizer').data ?? 'organizer';
    if (input.resumeTaskId) return this.resume(input.resumeTaskId, input, agentType);

    const taskId = input.taskId ?? randomUUID();
    this.tasks.create({ id: taskId, agentType, task: input.text });
    this.emit(input, taskId, 'created', { agentType, task: input.text.slice(0, 200) });
    this.emit(input, taskId, 'started', { message: 'The companion started working on the request.' });
    return this.loop({
      taskId,
      input,
      agentType,
      text: input.text,
      context: input.context,
      conversation: readConversation(input.context),
      observations: [],
      startIteration: 0,
      startToolCalls: 0,
      startPartialReply: '',
    });
  }

  async resume(taskId: string, input: AgentRunInput, agentType: AgentType): Promise<AgentRunResult> {
    const checkpoint = this.tasks.resume(taskId);
    if (!checkpoint) throw new Error('task_not_resumable');
    this.emit(input, taskId, 'resumed', { message: 'The companion resumed the task from its checkpoint.' });
    return this.loop({
      taskId,
      input,
      agentType: checkpoint.agentType ?? agentType,
      text: checkpoint.text,
      context: checkpoint.context,
      conversation: checkpoint.conversation,
      observations: checkpoint.observations,
      startIteration: checkpoint.iteration,
      startToolCalls: checkpoint.toolCalls,
      startPartialReply: checkpoint.partialReply,
    });
  }

  getTask(taskId: string) {
    return this.tasks.get(taskId);
  }

  listTasks(limit?: number) {
    return this.tasks.list(limit);
  }

  taskEvents(taskId: string, limit?: number) {
    return this.tasks.events(taskId, limit);
  }

  cancelTask(taskId: string) {
    this.tasks.cancel(taskId);
  }

  private async loop(params: LoopParams): Promise<AgentRunResult> {
    const { taskId, input, agentType, text, context, conversation } = params;
    const maxIterations = clamp(input.maxIterations ?? DEFAULT_MAX_ITERATIONS, 1, MAX_ITERATIONS_CAP);
    const maxToolCalls = clamp(input.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS, 1, MAX_TOOL_CALLS_CAP);
    const maxRunMs = clamp(input.maxRunMs ?? DEFAULT_MAX_RUN_MS, 5_000, MAX_RUN_MS_CAP);
    const runStartedAt = Date.now();
    const tools = this.tools.subset(this.toolPolicy(agentType));
    const observations = [...params.observations];
    const callSignatures = new Map<string, number>();
    for (const observation of params.observations) {
      callSignatures.set(`${observation.tool}:${stableArgs(observation.args)}`, 1);
    }
    let partialReply = params.startPartialReply;
    let toolCalls = params.startToolCalls;
    let runToolCalls = 0;
    let duplicateOnlyTurns = 0;
    let response: InferenceResponse | null = null;
    let lastIteration = params.startIteration;

    try {
      for (let offset = 1; offset <= maxIterations; offset += 1) {
        if (input.signal?.aborted) throw new Error('cancelled');
        if (Date.now() - runStartedAt >= maxRunMs) {
          const checkpoint = this.checkpoint(agentType, text, context, conversation, observations, lastIteration, toolCalls);
          this.pauseTask(taskId, checkpoint, input, 'time_budget', lastIteration, toolCalls);
          return this.pausedResult(taskId, response, checkpoint, lastIteration, toolCalls);
        }
        const iteration = params.startIteration + offset;
        lastIteration = iteration;

        const selectedSkills = this.skills.select(text, { limit: MAX_SKILLS_IN_PROMPT });
        const skillBlock = this.skills.renderForPrompt(selectedSkills, { maxSkills: MAX_SKILLS_IN_PROMPT });
        const promptContext = {
          currentPath: typeof context.currentPath === 'string' ? context.currentPath.slice(0, 120) : undefined,
          conversation,
          agentMode: true,
          agentType,
          availableTools: tools.describe(),
          activeSkills: skillBlock || undefined,
          selectedSkills: selectedSkills.map(({ id, name, category }) => ({ id, name, category })),
          observations: observations.slice(-MAX_OBSERVATIONS_IN_CONTEXT).map((observation) => ({
            tool: observation.tool,
            args: observation.args,
            ok: observation.ok,
            result: observation.result.slice(0, MAX_OBSERVATION_CHARS),
          })),
          iteration,
          maxIterations,
          remainingToolCalls: Math.max(0, maxToolCalls - runToolCalls),
          workspace: 'sandboxed workspace; file tools accept relative paths only',
        };

        response = await input.runtime.complete(
          {
            text,
            context: promptContext,
            onTextDelta: (delta) => {
              partialReply += delta;
              input.onTextDelta?.(delta);
            },
          },
          input.signal,
        );

        if (response.reply?.trim()) partialReply = response.reply;
        const calls = (response.toolCalls ?? []).slice(0, MAX_CALLS_PER_TURN);
        if (!calls.length) {
          const reply = (response.reply ?? partialReply).trim() || this.fallbackReply(response, observations);
          this.tasks.touch(taskId, { progress: 100, steps: iteration, toolCalls });
          this.tasks.complete(taskId, reply);
          this.emit(input, taskId, 'completed', { message: 'The companion finished the request.', steps: iteration, toolCalls });
          return {
            taskId,
            status: 'completed',
            reply,
            proposal: validateProposal(response.proposal),
            provider: response.provider,
            iterations: iteration,
            toolCalls,
          };
        }

        input.onTextReset?.();
        partialReply = '';

        const signatureOf = (call: { name: string; args: Record<string, unknown> }): string =>
          `${call.name.slice(0, 40)}:${stableArgs(call.args ?? {})}`;
        const pendingCalls = calls.filter((call) => (callSignatures.get(signatureOf(call)) ?? 0) === 0);

        // A model sometimes repeats a tool call while also supplying the answer.
        // Treat that as the final answer instead of spending another provider turn.
        if (!pendingCalls.length) {
          if (response.reply?.trim()) {
            const reply = response.reply.trim();
            this.tasks.touch(taskId, { progress: 100, steps: iteration, toolCalls });
            this.tasks.complete(taskId, reply);
            this.emit(input, taskId, 'completed', { message: 'The companion finished the request.', steps: iteration, toolCalls });
            return {
              taskId,
              status: 'completed',
              reply,
              proposal: validateProposal(response.proposal),
              provider: response.provider,
              iterations: iteration,
              toolCalls,
            };
          }
          duplicateOnlyTurns += 1;
          const repeated = calls[0];
          observations.push({
            tool: repeated?.name.slice(0, 40) ?? 'unknown',
            args: repeated?.args ?? {},
            ok: false,
            result: 'All requested tool calls were already executed. Answer using the observations above instead of repeating them.',
            at: new Date().toISOString(),
          });
          if (duplicateOnlyTurns >= 2) {
            const reply = this.fallbackReply(response, observations);
            this.tasks.touch(taskId, { progress: 100, steps: iteration, toolCalls });
            this.tasks.complete(taskId, reply);
            this.emit(input, taskId, 'completed', { message: 'The companion stopped repeating tool calls.', steps: iteration, toolCalls });
            return {
              taskId,
              status: 'completed',
              reply,
              proposal: validateProposal(response.proposal),
              provider: response.provider,
              iterations: iteration,
              toolCalls,
            };
          }
          continue;
        }
        duplicateOnlyTurns = 0;

        if (runToolCalls + pendingCalls.length > maxToolCalls) {
          const checkpoint = this.checkpoint(agentType, text, context, conversation, observations, iteration, toolCalls);
          this.pauseTask(taskId, checkpoint, input, 'tool_call_budget', iteration, toolCalls);
          return this.pausedResult(taskId, response, checkpoint, iteration, toolCalls);
        }

        for (const call of pendingCalls) {
          if (input.signal?.aborted) throw new Error('cancelled');
          const name = call.name.slice(0, 40);
          const args = call.args ?? {};
          const signature = signatureOf(call);
          callSignatures.set(signature, (callSignatures.get(signature) ?? 0) + 1);
          const record = await tools.runRecorded(name, args, {
            taskId,
            signal: input.signal,
            database: this.database,
            memory: this.memory,
            skills: this.skills,
            workspaceRoot: this.workspaceRoot,
          });
          observations.push({
            tool: name,
            args: record.args,
            ok: record.ok,
            result: record.result,
            at: new Date().toISOString(),
          });
          toolCalls += 1;
          runToolCalls += 1;
          this.tasks.touch(taskId, { steps: iteration, toolCalls, progress: Math.min(95, Math.round((offset / maxIterations) * 80)) });
          this.tasks.event(taskId, 'tool', {
            tool: name,
            ok: record.ok,
            summary: record.result.slice(0, 240),
          });
          this.emit(input, taskId, 'tool', { tool: name, ok: record.ok });
        }

        this.tasks.saveCheckpoint(
          taskId,
          this.checkpoint(agentType, text, context, conversation, observations, iteration, toolCalls),
        );
      }

      const checkpoint = this.checkpoint(agentType, text, context, conversation, observations, lastIteration, toolCalls);
      this.pauseTask(taskId, checkpoint, input, 'step_budget', lastIteration, toolCalls);
      return this.pausedResult(taskId, response, checkpoint, lastIteration, toolCalls);
    } catch (error) {
      const cancelled = input.signal?.aborted || (error instanceof Error && error.message === 'cancelled');
      if (cancelled) {
        this.tasks.cancel(taskId);
        this.emit(input, taskId, 'cancelled', { message: 'The request was cancelled.' });
      } else {
        const reason = error instanceof Error ? error.message : 'unknown_error';
        this.tasks.fail(taskId, reason);
        this.emit(input, taskId, 'failed', { message: 'The companion could not complete the request.', detail: reason.slice(0, 240) });
      }
      throw error;
    }
  }

  private checkpoint(
    agentType: AgentType,
    text: string,
    context: Record<string, unknown>,
    conversation: Array<{ role: 'user' | 'assistant'; content: string }> | undefined,
    observations: AgentObservation[],
    iteration: number,
    toolCalls: number,
  ): AgentCheckpoint {
    return {
      version: 1,
      agentType,
      text,
      context,
      conversation,
      observations: observations.slice(-40),
      iteration,
      toolCalls,
      partialReply: '',
      createdAt: new Date().toISOString(),
    };
  }

  private pauseTask(
    taskId: string,
    checkpoint: AgentCheckpoint,
    input: AgentRunInput,
    reason: string,
    steps: number,
    toolCalls: number,
  ): void {
    this.tasks.pause(taskId, checkpoint);
    this.tasks.event(taskId, 'paused', { reason, steps, toolCalls });
    this.emit(input, taskId, 'paused', { reason, steps, toolCalls });
  }

  private pausedResult(
    taskId: string,
    response: InferenceResponse | null,
    checkpoint: AgentCheckpoint,
    iterations: number,
    toolCalls: number,
  ): AgentRunResult {
    const reason = 'I paused at a safe step limit so this long task can continue without losing progress.';
    return {
      taskId,
      status: 'paused',
      reply: reason,
      proposal: response ? validateProposal(response.proposal) : null,
      provider: response?.provider ?? 'agent',
      iterations,
      toolCalls,
      checkpoint,
    };
  }

  private fallbackReply(response: InferenceResponse | null, observations: AgentObservation[]): string {
    if (response?.proposal) {
      return `I can ${response.proposal.action.replaceAll('_', ' ')} to help with that.`;
    }
    if (observations.length) {
      const lines = observations
        .slice(-3)
        .map((observation) => `- ${observation.tool}: ${observation.result.split('\n')[0]?.slice(0, 200) ?? ''}`);
      return `I completed ${observations.length} step${observations.length === 1 ? '' : 's'}:\n${lines.join('\n')}`;
    }
    return 'I couldn’t determine a useful next step. Could you clarify what you’d like me to do?';
  }

  private emit(input: AgentRunInput, taskId: string, type: string, payload: Record<string, unknown>): void {
    input.onTaskEvent?.({ taskId, type, payload });
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function stableArgs(value: unknown): string {
  try {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map(stableArgs).join(',')}]`;
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableArgs(object[key])}`)
      .join(',')}}`;
  } catch {
    return '{}';
  }
}

function readConversation(context: Record<string, unknown>): Array<{ role: 'user' | 'assistant'; content: string }> | undefined {
  if (!Array.isArray(context.conversation)) return undefined;
  return context.conversation
    .filter(
      (item): item is { role: 'user' | 'assistant'; content: string } =>
        Boolean(item) &&
        typeof item === 'object' &&
        ((item as { role?: unknown }).role === 'user' || (item as { role?: unknown }).role === 'assistant') &&
        typeof (item as { content?: unknown }).content === 'string',
    )
    .slice(-MAX_CONVERSATION_MESSAGES)
    .map((item) => ({ role: item.role, content: item.content.slice(0, MAX_CONVERSATION_CHARS) }));
}

function validateProposal(proposal: InferenceResponse['proposal']): InferenceResponse['proposal'] {
  if (!proposal) return null;
  const action = actionNameSchema.safeParse(proposal.action);
  if (!action.success) return null;
  const args = actionArgsSchemas[action.data].safeParse(proposal.args);
  return args.success ? { action: action.data, args: args.data } : null;
}
