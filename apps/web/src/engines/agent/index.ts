import {
  AGENT_DESCRIPTORS,
  AGENT_TYPES,
  type AgentTask,
  type AgentTaskStatus,
  type AgentType,
  type EventDraft,
} from '@koodu/protocol';

let fallbackCounter = 0;

function defaultIdFactory(prefix: string): string {
  const cryptoRef = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') {
    return `${prefix}_${cryptoRef.randomUUID()}`;
  }
  fallbackCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${fallbackCounter}`;
}

export interface CreateTaskInput {
  agentType: AgentType;
  title: string;
}

export interface TaskChange {
  task: AgentTask;
  events: EventDraft[];
}

export interface AgentEngine {
  list(): AgentTask[];
  get(id: string): AgentTask | null;
  create(input: CreateTaskInput): TaskChange;
  setStatus(
    id: string,
    status: AgentTaskStatus,
    patch?: { progress?: number; result?: string; error?: string },
  ): TaskChange | null;
  cancel(id: string): TaskChange | null;
  subscribe(listener: (tasks: AgentTask[]) => void): () => void;
  descriptors(): typeof AGENT_DESCRIPTORS;
}

export interface AgentEngineOptions {
  now?: () => number;
  newId?: (prefix: string) => string;
}

const TERMINAL: ReadonlySet<AgentTaskStatus> = new Set(['completed', 'failed', 'cancelled']);

/**
 * Task lifecycle only. Execution is intentionally not implemented yet: the
 * engine records state and emits events so orchestration can be added without
 * changing contracts.
 */
export function createAgentEngine(options: AgentEngineOptions = {}): AgentEngine {
  const now = options.now ?? (() => Date.now());
  const newId = options.newId ?? defaultIdFactory;
  const tasks = new Map<string, AgentTask>();
  const listeners = new Set<(tasks: AgentTask[]) => void>();

  const snapshot = (): AgentTask[] =>
    [...tasks.values()].sort((a, b) => a.createdAt - b.createdAt);

  const notify = (): void => {
    const current = snapshot();
    for (const listener of [...listeners]) {
      try {
        listener(current);
      } catch {
        // A bad subscriber must not break task state.
      }
    }
  };

  const isAgentType = (value: string): value is AgentType =>
    (AGENT_TYPES as readonly string[]).includes(value);

  function transition(
    task: AgentTask,
    status: AgentTaskStatus,
    patch: { progress?: number; result?: string; error?: string } = {},
  ): TaskChange {
    const progress =
      patch.progress === undefined
        ? status === 'completed'
          ? 100
          : task.progress
        : Math.min(100, Math.max(0, patch.progress));

    const updated: AgentTask = {
      ...task,
      status,
      progress,
      result: patch.result ?? task.result,
      error: patch.error ?? (status === 'failed' ? (task.error ?? 'failed') : task.error),
      updatedAt: now(),
    };
    tasks.set(updated.id, updated);
    notify();
    return {
      task: updated,
      events: [
        {
          type: 'agent.task.updated',
          payload: { taskId: updated.id, status: updated.status, progress: updated.progress },
        },
      ],
    };
  }

  return {
    list: snapshot,

    get(id) {
      return tasks.get(id) ?? null;
    },

    create(input) {
      if (!isAgentType(input.agentType)) {
        throw new Error(`unknown_agent_type:${String(input.agentType)}`);
      }
      const at = now();
      const task: AgentTask = {
        id: newId('task'),
        agentType: input.agentType,
        title: input.title.slice(0, 200),
        status: 'queued',
        progress: 0,
        result: null,
        error: null,
        createdAt: at,
        updatedAt: at,
      };
      tasks.set(task.id, task);
      notify();
      return {
        task,
        events: [
          {
            type: 'agent.task.created',
            payload: { taskId: task.id, agentType: task.agentType, title: task.title },
          },
        ],
      };
    },

    setStatus(id, status, patch) {
      const task = tasks.get(id);
      if (!task) return null;
      if (TERMINAL.has(task.status)) return null;
      const noop =
        status === task.status &&
        patch?.progress === undefined &&
        patch?.result === undefined &&
        patch?.error === undefined;
      if (noop) return { task, events: [] };
      return transition(task, status, patch);
    },

    cancel(id) {
      const task = tasks.get(id);
      if (!task || TERMINAL.has(task.status)) return null;
      return transition(task, 'cancelled');
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    descriptors() {
      return AGENT_DESCRIPTORS;
    },
  };
}
