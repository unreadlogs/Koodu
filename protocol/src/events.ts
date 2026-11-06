import { z } from 'zod';
import { actionNameSchema } from './actions';
import { agentTaskStatusSchema, agentTypeSchema } from './agents';
import { riskSchema } from './risk';
import { workspaceRouteSchema } from './routes';
import {
  petActivitySchema,
  petEmotionSchema,
  petModeSchema,
  tabWindowStateSchema,
} from './state';

export const EVENT_VERSION = 1 as const;

export const eventSourceSchema = z.enum([
  'user',
  'middleware',
  'workspace',
  'pet',
  'agent',
  'intelligence',
  'persistence',
  'iframe',
  'system',
]);
export type EventSource = z.infer<typeof eventSourceSchema>;

export const EVENT_TYPES = [
  'intent.received',
  'intent.proposed',
  'intent.rejected',
  'action.approval.requested',
  'action.started',
  'action.completed',
  'action.failed',
  'action.denied',
  'workspace.tab.opened',
  'workspace.tab.closed',
  'workspace.tab.activated',
  'workspace.tab.window',
  'workspace.tab.pinned',
  'pet.activity.changed',
  'pet.emotion.changed',
  'pet.mode.changed',
  'agent.task.created',
  'agent.task.updated',
  'intelligence.status',
  'persistence.restored',
  'persistence.failed',
  'iframe.ready',
  'iframe.rejected',
  'system.notice',
] as const;
export const eventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = (typeof EVENT_TYPES)[number];

export const dispatchSourceSchema = z.enum(['user', 'local', 'cloud']);
export type DispatchSource = z.infer<typeof dispatchSourceSchema>;

const argsRecord = z.record(z.unknown());

export const eventPayloadSchemas = {
  'intent.received': z.object({ inputId: z.string().min(1), text: z.string() }),
  'intent.proposed': z.object({
    inputId: z.string().min(1),
    text: z.string(),
    provider: z.string().min(1),
    confidence: z.number().min(0).max(1),
    action: actionNameSchema.nullable(),
  }),
  'intent.rejected': z.object({
    inputId: z.string().min(1),
    text: z.string(),
    reason: z.string(),
  }),
  'action.approval.requested': z.object({
    action: actionNameSchema,
    args: argsRecord,
    risk: riskSchema,
    source: dispatchSourceSchema,
  }),
  'action.started': z.object({
    action: actionNameSchema,
    args: argsRecord,
    source: dispatchSourceSchema,
    risk: riskSchema,
  }),
  'action.completed': z.object({
    action: actionNameSchema,
    durationMs: z.number().nonnegative(),
    message: z.string(),
  }),
  'action.failed': z.object({ action: actionNameSchema, reason: z.string() }),
  'action.denied': z.object({ action: actionNameSchema, reason: z.string() }),
  'workspace.tab.opened': z.object({
    tabId: z.string().min(1),
    route: workspaceRouteSchema,
    title: z.string(),
  }),
  'workspace.tab.closed': z.object({ tabId: z.string().min(1) }),
  'workspace.tab.activated': z.object({ tabId: z.string().min(1) }),
  'workspace.tab.window': z.object({
    tabId: z.string().min(1),
    windowState: tabWindowStateSchema,
  }),
  'workspace.tab.pinned': z.object({ tabId: z.string().min(1), pinned: z.boolean() }),
  'pet.activity.changed': z.object({ from: petActivitySchema, to: petActivitySchema }),
  'pet.emotion.changed': z.object({ from: petEmotionSchema, to: petEmotionSchema }),
  'pet.mode.changed': z.object({ from: petModeSchema, to: petModeSchema }),
  'agent.task.created': z.object({
    taskId: z.string().min(1),
    agentType: agentTypeSchema,
    title: z.string(),
  }),
  'agent.task.updated': z.object({
    taskId: z.string().min(1),
    status: agentTaskStatusSchema,
    progress: z.number().min(0).max(100),
  }),
  'intelligence.status': z.object({
    status: z.enum(['online', 'offline']),
    provider: z.string(),
    detail: z.string(),
  }),
  'persistence.restored': z.object({
    tabCount: z.number().int().nonnegative(),
    dropped: z.number().int().nonnegative(),
  }),
  'persistence.failed': z.object({ reason: z.string() }),
  'iframe.ready': z.object({ tabId: z.string().min(1), route: workspaceRouteSchema }),
  'iframe.rejected': z.object({ reason: z.string() }),
  'system.notice': z.object({
    level: z.enum(['info', 'warn', 'error']),
    message: z.string(),
  }),
} satisfies Record<EventType, z.ZodTypeAny>;

export type EventPayload<K extends EventType> = z.infer<(typeof eventPayloadSchemas)[K]>;

/** What an engine is allowed to hand back. Middleware publishes it. */
export type EventDraft = {
  [K in EventType]: { type: K; payload: EventPayload<K> };
}[EventType];

export interface EventEnvelope {
  id: string;
  type: EventType;
  version: typeof EVENT_VERSION;
  at: number;
  source: EventSource;
  correlationId: string | null;
  causationId: string | null;
}

export type AppEvent = {
  [K in EventType]: EventEnvelope & { type: K; payload: EventPayload<K> };
}[EventType];

export const appEventEnvelopeSchema = z.object({
  id: z.string().min(1),
  type: eventTypeSchema,
  version: z.literal(EVENT_VERSION),
  at: z.number(),
  source: eventSourceSchema,
  correlationId: z.string().nullable(),
  causationId: z.string().nullable(),
  payload: z.unknown(),
});

/**
 * Validates an event that came from outside the trusted core (persistence,
 * iframe, dev tools). Unknown event types or payload shapes are dropped.
 */
export function parseAppEvent(input: unknown): AppEvent | null {
  const envelope = appEventEnvelopeSchema.safeParse(input);
  if (!envelope.success) return null;
  const payloadSchema = eventPayloadSchemas[envelope.data.type];
  const payload = payloadSchema.safeParse(envelope.data.payload);
  if (!payload.success) return null;
  return { ...envelope.data, payload: payload.data } as AppEvent;
}
