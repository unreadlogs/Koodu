import { z } from 'zod';
import { riskSchema } from './risk';

export const AGENT_TYPES = ['research', 'coding', 'organizer', 'memory'] as const;
export const agentTypeSchema = z.enum(AGENT_TYPES);
export type AgentType = (typeof AGENT_TYPES)[number];

export interface AgentDescriptor {
  title: string;
  description: string;
  risk: z.infer<typeof riskSchema>;
}

export const AGENT_DESCRIPTORS: Record<AgentType, AgentDescriptor> = {
  research: {
    title: 'Research Agent',
    description: 'Gathers and summarises external information.',
    risk: 'confirm',
  },
  coding: {
    title: 'Coding Agent',
    description: 'Works on repository changes inside an isolated task.',
    risk: 'dangerous',
  },
  organizer: {
    title: 'Organizer Agent',
    description: 'Schedules, groups and tracks user tasks.',
    risk: 'confirm',
  },
  memory: {
    title: 'Memory Agent',
    description: 'Curates durable project and user context.',
    risk: 'confirm',
  },
};

export const agentTaskStatusSchema = z.enum([
  'queued',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
]);
export type AgentTaskStatus = z.infer<typeof agentTaskStatusSchema>;

export const agentTaskSchema = z.object({
  id: z.string().min(1),
  agentType: agentTypeSchema,
  title: z.string().min(1).max(200),
  status: agentTaskStatusSchema,
  progress: z.number().min(0).max(100),
  result: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type AgentTask = z.infer<typeof agentTaskSchema>;
