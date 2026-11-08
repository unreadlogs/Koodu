import type { AgentType } from '@koodu/protocol';
import type { InferenceResponse, InferenceRuntime } from '../inference/types';

export interface AgentObservation {
  tool: string;
  args: Record<string, unknown>;
  result: string;
  ok: boolean;
  at: string;
}

/** Durable resume point for a paused long-running task. */
export interface AgentCheckpoint {
  version: 1;
  agentType: AgentType;
  text: string;
  context: Record<string, unknown>;
  conversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
  observations: AgentObservation[];
  iteration: number;
  toolCalls: number;
  partialReply: string;
  createdAt: string;
}

export interface AgentTaskEvent {
  taskId: string;
  type: string;
  payload: Record<string, unknown>;
}

export interface AgentRunInput {
  /** Optional pre-generated task id, so callers can register cancellation first. */
  taskId?: string;
  text: string;
  context: Record<string, unknown>;
  runtime: InferenceRuntime;
  agentType?: string;
  signal?: AbortSignal;
  onTextDelta?: (text: string) => void;
  onTextReset?: () => void;
  onTaskEvent?: (event: AgentTaskEvent) => void;
  maxIterations?: number;
  maxToolCalls?: number;
  /** Wall-clock budget for one run; long tasks pause and resume instead of blocking. */
  maxRunMs?: number;
  /** Continue a previously paused task instead of creating a new one. */
  resumeTaskId?: string;
}

export interface AgentRunResult {
  taskId: string;
  status: 'completed' | 'paused';
  reply: string;
  proposal: InferenceResponse['proposal'];
  provider: string;
  iterations: number;
  toolCalls: number;
  checkpoint?: AgentCheckpoint;
}
