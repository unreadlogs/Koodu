import { z } from 'zod';
import { actionNameSchema } from './actions';
import { agentTaskSchema } from './agents';
import { workspaceRouteSchema } from './routes';
import {
  MAX_TABS,
  aiStatusSchema,
  petActivitySchema,
  petEmotionSchema,
  petModeSchema,
  tabWindowStateSchema,
} from './state';

export const IFRAME_PROTOCOL_VERSION = 1 as const;

const v = z.literal(IFRAME_PROTOCOL_VERSION);

export const frameTabSchema = z.object({
  id: z.string().min(1),
  route: workspaceRouteSchema,
  title: z.string(),
  active: z.boolean(),
  windowState: tabWindowStateSchema,
});
export type FrameTab = z.infer<typeof frameTabSchema>;

/** Read-only projection of app state that a workspace iframe may receive. */
export const frameStateSchema = z.object({
  protocolVersion: v,
  activeRoute: workspaceRouteSchema.nullable(),
  tabs: z.array(frameTabSchema).max(MAX_TABS),
  pet: z.object({
    mode: petModeSchema,
    activity: petActivitySchema,
    emotion: petEmotionSchema,
  }),
  tasks: z.array(agentTaskSchema).max(50),
  aiStatus: aiStatusSchema,
});
export type FrameState = z.infer<typeof frameStateSchema>;

export const parentToFrameSchema = z.discriminatedUnion('type', [
  z.object({
    v,
    type: z.literal('navigate'),
    requestId: z.string().min(1),
    route: workspaceRouteSchema,
  }),
  z.object({ v, type: z.literal('ping'), requestId: z.string().min(1) }),
  z.object({ v, type: z.literal('state.push'), state: frameStateSchema }),
  z.object({
    v,
    type: z.literal('command.result'),
    requestId: z.string().min(1),
    ok: z.boolean(),
    message: z.string(),
  }),
  z.object({
    v,
    type: z.literal('ws.pong'),
    requestId: z.string().min(1),
    ms: z.number().min(0),
    serverAt: z.number().int(),
  }),
  z.object({
    v,
    type: z.literal('ws.error'),
    requestId: z.string().min(1).optional(),
    message: z.string(),
  }),
]);
export type ParentToFrameMessage = z.infer<typeof parentToFrameSchema>;

export const frameToParentSchema = z.discriminatedUnion('type', [
  z.object({
    v,
    type: z.literal('ready'),
    route: workspaceRouteSchema,
    title: z.string().max(80),
  }),
  z.object({ v, type: z.literal('navigated'), route: workspaceRouteSchema }),
  z.object({ v, type: z.literal('pong'), requestId: z.string().min(1) }),
  z.object({ v, type: z.literal('ws.ping'), requestId: z.string().min(1) }),
  z.object({
    v,
    type: z.literal('state.request'),
    requestId: z.string().min(1),
  }),
  z.object({
    v,
    type: z.literal('command.request'),
    requestId: z.string().min(1),
    action: actionNameSchema,
    args: z.unknown(),
  }),
  z.object({ v, type: z.literal('error'), message: z.string().max(500) }),
]);
export type FrameToParentMessage = z.infer<typeof frameToParentSchema>;

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

export interface InboundFrameEvent {
  origin: string;
  data: unknown;
  /** MessageEvent.source; when provided it must match the expected frame window. */
  source?: unknown;
}

/**
 * The parent trusts nothing from an iframe: origin, framing window and schema
 * are all checked, and unknown message types are ignored rather than actioned.
 */
export function validateInboundFrameMessage(
  event: InboundFrameEvent,
  expected: { origin: string; window?: unknown },
): ValidationResult<FrameToParentMessage> {
  if (event.origin !== expected.origin) {
    return { ok: false, reason: 'origin_mismatch' };
  }
  if (expected.window !== undefined && event.source !== undefined) {
    if (event.source !== expected.window) return { ok: false, reason: 'unexpected_source' };
  }
  const parsed = frameToParentSchema.safeParse(event.data);
  if (!parsed.success) return { ok: false, reason: 'schema' };
  return { ok: true, value: parsed.data };
}
