import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { InferenceRuntime } from '../inference/types';
import { initializeDatabase } from '../storage/database';
import { SkillsEngine } from '../skills';
import { AgentEngine } from './agent-engine';
import { ToolRegistry } from './tools';
import type { MemoryPort } from './tools';

const workspaces: string[] = [];

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'koodu-agent-'));
  workspaces.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of workspaces.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const memory: MemoryPort = {
  search_memory: async () => 'No relevant memories found.',
  save_memory: async () => 1,
};

function tools(): ToolRegistry {
  return new ToolRegistry([
    {
      name: 'echo',
      description: 'Echo text back.',
      risk: 'safe',
      parameters: { text: 'string' },
      schema: z.object({ text: z.string() }).strict(),
      execute: async (args) => `echo:${String(args.text)}`,
    },
  ]);
}

function fakeRuntime(complete: InferenceRuntime['complete']): InferenceRuntime {
  return { id: 'fake', kind: 'cloud', model: 'fake-model', configured: () => true, complete };
}

describe('AgentEngine', () => {
  it('runs a tool call, records it, and finishes with the model reply', async () => {
    const database = initializeDatabase(':memory:');
    const skills = new SkillsEngine(database);
    skills.seedStarter();
    const engine = new AgentEngine({ database, memory, skills, tools: tools(), workspaceRoot: workspace(), toolPolicy: () => ['echo'] });
    let calls = 0;
    const contexts: unknown[] = [];
    const runtime = fakeRuntime(async (request) => {
      calls += 1;
      contexts.push(request.context);
      if (calls === 1) {
        return { provider: 'fake', confidence: 1, proposal: null, reply: null, toolCalls: [{ name: 'echo', args: { text: 'hi' } }] };
      }
      return { provider: 'fake', confidence: 1, proposal: null, reply: 'done' };
    });

    const result = await engine.run({ text: 'do the thing', context: {}, runtime });
    expect(result.status).toBe('completed');
    expect(result.reply).toBe('done');
    expect(result.iterations).toBe(2);
    expect(result.toolCalls).toBe(1);

    const task = engine.getTask(result.taskId);
    expect(task?.status).toBe('completed');
    expect(task?.toolCalls).toBe(1);
    expect(task?.result).toBe('done');
    expect(engine.taskEvents(result.taskId).map((event) => event.type)).toContain('tool');

    const firstContext = contexts[0] as { availableTools?: Array<{ name: string }>; activeSkills?: string };
    expect(firstContext.availableTools?.some((tool) => tool.name === 'echo')).toBe(true);
    expect(firstContext.activeSkills).toBeUndefined();
    database.close();
  });

  it('pauses at the step budget and resumes from the checkpoint', async () => {
    const database = initializeDatabase(':memory:');
    const skills = new SkillsEngine(database);
    const engine = new AgentEngine({ database, memory, skills, tools: tools(), workspaceRoot: workspace(), toolPolicy: () => ['echo'] });
    let phase = 0;
    const runtime = fakeRuntime(async () => {
      if (phase === 0) {
        return { provider: 'fake', confidence: 1, proposal: null, reply: null, toolCalls: [{ name: 'echo', args: { text: 'step' } }] };
      }
      return { provider: 'fake', confidence: 1, proposal: null, reply: 'resumed answer' };
    });

    const paused = await engine.run({ text: 'long task', context: {}, runtime, maxIterations: 1 });
    expect(paused.status).toBe('paused');
    expect(paused.reply).toMatch(/paused/i);
    expect(engine.getTask(paused.taskId)?.status).toBe('paused');
    expect(engine.getTask(paused.taskId)?.checkpoint?.observations.length).toBe(1);

    phase = 1;
    const resumed = await engine.resume(paused.taskId, { text: 'long task', context: {}, runtime }, 'organizer');
    expect(resumed.status).toBe('completed');
    expect(resumed.reply).toBe('resumed answer');
    expect(engine.getTask(paused.taskId)?.status).toBe('completed');
    expect(engine.taskEvents(paused.taskId).map((event) => event.type)).toContain('resumed');
    database.close();
  });

  it('turns an unknown tool into an observation and keeps the loop alive', async () => {
    const database = initializeDatabase(':memory:');
    const skills = new SkillsEngine(database);
    const engine = new AgentEngine({ database, memory, skills, tools: tools(), workspaceRoot: workspace(), toolPolicy: () => ['echo'] });
    let calls = 0;
    const runtime = fakeRuntime(async () => {
      calls += 1;
      if (calls === 1) {
        return { provider: 'fake', confidence: 1, proposal: null, reply: null, toolCalls: [{ name: 'invented_tool', args: {} }] };
      }
      return { provider: 'fake', confidence: 1, proposal: null, reply: 'adapted' };
    });

    const result = await engine.run({ text: 'try it', context: {}, runtime });
    expect(result.status).toBe('completed');
    expect(result.reply).toBe('adapted');
    expect(result.toolCalls).toBe(1);
    const task = engine.getTask(result.taskId);
    expect(task?.checkpoint).toBeNull();
    expect(engine.taskEvents(result.taskId).some((event) => event.type === 'tool' && String(event.payload.tool) === 'invented_tool')).toBe(true);
    database.close();
  });

  it('accepts an answer that arrives alongside a repeated tool call', async () => {
    const database = initializeDatabase(':memory:');
    const skills = new SkillsEngine(database);
    const engine = new AgentEngine({ database, memory, skills, tools: tools(), workspaceRoot: workspace(), toolPolicy: () => ['echo'] });
    let calls = 0;
    const repeated = { name: 'echo', args: { text: 'hi' } };
    const runtime = fakeRuntime(async () => {
      calls += 1;
      if (calls === 1) {
        return { provider: 'fake', confidence: 1, proposal: null, reply: null, toolCalls: [repeated] };
      }
      return { provider: 'fake', confidence: 1, proposal: null, reply: 'eight', toolCalls: [repeated] };
    });

    const result = await engine.run({ text: 'count them', context: {}, runtime });
    expect(result.status).toBe('completed');
    expect(result.reply).toBe('eight');
    expect(result.iterations).toBe(2);
    expect(result.toolCalls).toBe(1);
    expect(calls).toBe(2);
    database.close();
  });

  it('pauses when the tool-call budget is exhausted', async () => {
    const database = initializeDatabase(':memory:');
    const skills = new SkillsEngine(database);
    const engine = new AgentEngine({ database, memory, skills, tools: tools(), workspaceRoot: workspace(), toolPolicy: () => ['echo'] });
    let calls = 0;
    const runtime = fakeRuntime(async () => {
      calls += 1;
      return { provider: 'fake', confidence: 1, proposal: null, reply: null, toolCalls: [{ name: 'echo', args: { text: `step-${calls}` } }] };
    });

    const result = await engine.run({ text: 'keep going', context: {}, runtime, maxToolCalls: 1 });
    expect(result.status).toBe('paused');
    expect(result.toolCalls).toBe(1);
    const task = engine.getTask(result.taskId);
    expect(task?.status).toBe('paused');
    expect(task?.checkpoint?.observations.length).toBe(1);
    expect(engine.taskEvents(result.taskId).some((event) => event.type === 'paused' && event.payload.reason === 'tool_call_budget')).toBe(true);
    database.close();
  });

  it('resumes a failed task that still has a checkpoint', async () => {
    const database = initializeDatabase(':memory:');
    const skills = new SkillsEngine(database);
    const engine = new AgentEngine({ database, memory, skills, tools: tools(), workspaceRoot: workspace(), toolPolicy: () => ['echo'] });
    let calls = 0;
    const failingRuntime = fakeRuntime(async () => {
      calls += 1;
      if (calls === 1) {
        return { provider: 'fake', confidence: 1, proposal: null, reply: null, toolCalls: [{ name: 'echo', args: { text: 'first' } }] };
      }
      throw new Error('429 rate limited');
    });

    await expect(engine.run({ text: 'transient task', context: {}, runtime: failingRuntime })).rejects.toThrow(/429/);
    const failed = engine.listTasks().find((task) => task.task === 'transient task');
    expect(failed?.status).toBe('failed');
    expect(failed?.checkpoint?.observations.length).toBe(1);

    const healthyRuntime = fakeRuntime(async () => ({ provider: 'fake', confidence: 1, proposal: null, reply: 'recovered' }));
    const resumed = await engine.resume(failed!.id, { text: 'transient task', context: {}, runtime: healthyRuntime }, 'organizer');
    expect(resumed.status).toBe('completed');
    expect(resumed.reply).toBe('recovered');
    expect(engine.getTask(failed!.id)?.status).toBe('completed');
    database.close();
  });

  it('marks a task cancelled when its abort signal fires', async () => {
    const database = initializeDatabase(':memory:');
    const skills = new SkillsEngine(database);
    const engine = new AgentEngine({ database, memory, skills, tools: tools(), workspaceRoot: workspace(), toolPolicy: () => ['echo'] });
    const runtime = fakeRuntime(async () => ({ provider: 'fake', confidence: 1, proposal: null, reply: 'never used' }));
    const controller = new AbortController();
    controller.abort();

    await expect(engine.run({ taskId: 'task-cancel-1', text: 'cancel me', context: {}, runtime, signal: controller.signal })).rejects.toThrow(/cancelled/);
    const task = engine.getTask('task-cancel-1');
    expect(task?.status).toBe('cancelled');
    expect(engine.taskEvents('task-cancel-1').map((event) => event.type)).toContain('cancelled');
    database.close();
  });
});
