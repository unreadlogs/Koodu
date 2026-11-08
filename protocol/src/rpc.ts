import { z } from 'zod';
import { loginRequestSchema } from './auth';
import { workspaceSettingsSchema } from './settings';

/** JSON request/response contract used by the single application WebSocket. */
export const rpcMethods = [
  'system.health',
  'system.ping',
  'auth.status',
  'auth.login',
  'auth.authenticate',
  'auth.logout',
  'models.list',
  'models.save',
  'models.delete',
  'models.test',
  'usage.summary',
  'logs.watch',
  'logs.unwatch',
  'logs.clear',
  'memory.list',
  'memory.save',
  'memory.delete',
  'skills.list',
  'skills.save',
  'skills.delete',
  'skills.import',
  'intelligence.complete',
  'agent.run',
  'agent.resume',
  'tasks.list',
  'tasks.get',
  'tasks.events',
  'tasks.cancel',
  'chats.list',
  'chats.create',
  'chats.delete',
  'chats.messages',
  'chats.send',
  'settings.get',
  'settings.save',
  'settings.reset',
] as const;
export const rpcMethodSchema = z.enum(rpcMethods);
export type RpcMethod = (typeof rpcMethods)[number];

const modelProfileSchema = z.object({
  id: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/),
  name: z.string().min(1).max(80),
  provider: z.enum(['openai', 'openrouter', 'google', 'custom']),
  model: z.string().min(1).max(160),
  baseUrl: z.string().url().max(500),
  role: z.enum(['local', 'cloud']),
  maxOutputTokens: z.number().int().min(64).max(32768),
  monthlyTokenLimit: z.number().int().min(0).max(1_000_000_000),
  enabled: z.boolean(),
  active: z.boolean(),
  apiKey: z.string().max(4096).optional(),
  clearApiKey: z.boolean().optional(),
});
const skillSchema = z.object({
  id: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(180),
  category: z.enum(['Research', 'Development', 'Organization', 'Custom']),
  instructions: z.string().trim().min(1).max(12000),
  enabled: z.boolean(),
  source: z.string().trim().min(1).max(80),
});

export const rpcPayloadSchemas = {
  'system.health': z.object({}),
  'system.ping': z.object({ at: z.number().int() }),

  'auth.status': z.object({}),
  'auth.login': loginRequestSchema,
  'auth.authenticate': z.object({ token: z.string().min(1).max(256) }),
  'auth.logout': z.object({}),
  'models.list': z.object({}),
  'models.save': modelProfileSchema,
  'models.delete': z.object({ id: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/) }),
  'models.test': z.object({ id: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/) }),
  'usage.summary': z.object({ range: z.enum(['24H', '7D', '30D']) }),
  'logs.watch': z.object({}),
  'logs.unwatch': z.object({}),
  'logs.clear': z.object({}),
  'memory.list': z.object({}),
  'memory.save': z.object({ id: z.number().int().positive().optional(), content: z.string().min(1).max(350), category: z.enum(['preference', 'fact', 'task']) }),
  'memory.delete': z.object({ id: z.number().int().positive() }),
  'skills.list': z.object({}),
  'skills.save': skillSchema,
  'skills.delete': z.object({ id: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/) }),
  'skills.import': z.object({ skills: z.array(skillSchema).min(1).max(100) }),
  'intelligence.complete': z.object({
    role: z.enum(['local', 'cloud']),
    text: z.string().min(1).max(1_000),
    context: z.record(z.string().max(64), z.unknown()).optional().default({}),
  }).refine((value) => Object.keys(value.context).length <= 32, { message: 'too_many_context_keys' }),
  'agent.run': z.object({ role: z.enum(['local', 'cloud']), agentType: z.enum(['research', 'coding', 'organizer', 'memory']).optional(), text: z.string().trim().min(1).max(1_000), context: z.record(z.string().max(64), z.unknown()).optional().default({}) })
    .refine((value) => Object.keys(value.context).length <= 32, { message: 'too_many_context_keys' }),
  'agent.resume': z.object({ taskId: z.string().min(1).max(80), role: z.enum(['local', 'cloud']) }),
  'tasks.list': z.object({ limit: z.number().int().min(1).max(200).optional() }),
  'tasks.get': z.object({ taskId: z.string().min(1).max(80) }),
  'tasks.events': z.object({ taskId: z.string().min(1).max(80), limit: z.number().int().min(1).max(500).optional() }),
  'tasks.cancel': z.object({ taskId: z.string().min(1).max(80) }),
  'chats.list': z.object({}),
  'chats.create': z.object({ title: z.string().trim().min(1).max(80).optional() }),
  'chats.delete': z.object({ conversationId: z.string().uuid() }),
  'chats.messages': z.object({ conversationId: z.string().uuid() }),
  'chats.send': z.object({ conversationId: z.string().uuid(), role: z.enum(['local', 'cloud']), text: z.string().trim().min(1).max(1_000) }),
  'settings.get': z.object({}),
  'settings.save': workspaceSettingsSchema,
  'settings.reset': z.object({}),
} satisfies Record<RpcMethod, z.ZodTypeAny>;

export type RpcPayload<K extends RpcMethod> = z.infer<(typeof rpcPayloadSchemas)[K]>;
export type RpcRequest = { [K in RpcMethod]: { type: 'request'; id: string; method: K; payload: RpcPayload<K> } }[RpcMethod];

export const rpcRequestSchema = z.object({
  type: z.literal('request'),
  id: z.string().min(1).max(80),
  method: rpcMethodSchema,
  payload: z.unknown(),
});

// Both success and error responses intentionally share `type: "response"`;
// discriminate by `ok` with a regular union instead of Zod's `type` helper.
export const rpcResponseSchema = z.union([
  z.object({ type: z.literal('response'), id: z.string(), ok: z.literal(true), result: z.unknown() }),
  z.object({ type: z.literal('response'), id: z.string(), ok: z.literal(false), error: z.string(), error_code: z.string(), details: z.unknown().optional() }),
]);

export const rpcHelloSchema = z.object({
  type: z.literal('hello'),
  protocol: z.literal(1),
  at: z.number(),
  authRequired: z.boolean(),
});

export const rpcPingSchema = z.object({ type: z.literal('ping'), id: z.string().min(1), at: z.number().int() });
export const rpcPongSchema = z.object({ type: z.literal('pong'), id: z.string(), at: z.number(), serverAt: z.number() });
export const rpcLogEntrySchema = z.object({ id: z.string(), at: z.number(), level: z.enum(['info', 'success', 'warning', 'error']), source: z.string(), message: z.string(), detail: z.string().nullable() });
export const rpcEventSchema = z.union([
  z.object({ type: z.literal('event'), event: z.literal('logs.entry'), payload: rpcLogEntrySchema }),
  z.object({ type: z.literal('event'), event: z.literal('agent.stream'), requestId: z.string().min(1), payload: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('delta'), text: z.string().max(500) }),
    z.object({ kind: z.literal('reset') }),
  ]) }),
]);
export type RpcLogEntry = z.infer<typeof rpcLogEntrySchema>;
