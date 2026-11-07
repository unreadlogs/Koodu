import { z } from 'zod';
import { loginRequestSchema } from './auth';

/** JSON request/response contract used by the single application WebSocket. */
export const rpcMethods = [
  'system.health',
  'system.ping',
  'companion.manifest',
  'auth.status',
  'auth.login',
  'auth.authenticate',
  'auth.logout',
  'models.list',
  'models.save',
  'models.delete',
  'models.test',
  'usage.summary',
  'intelligence.complete',
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

export const rpcPayloadSchemas = {
  'system.health': z.object({}),
  'system.ping': z.object({ at: z.number().int() }),
  'companion.manifest': z.object({ character: z.enum(['kumo', 'kitsu']) }),
  'auth.status': z.object({}),
  'auth.login': loginRequestSchema,
  'auth.authenticate': z.object({ token: z.string().min(1).max(256) }),
  'auth.logout': z.object({}),
  'models.list': z.object({}),
  'models.save': modelProfileSchema,
  'models.delete': z.object({ id: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/) }),
  'models.test': z.object({ id: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/) }),
  'usage.summary': z.object({ range: z.enum(['24H', '7D', '30D']) }),
  'intelligence.complete': z.object({
    role: z.enum(['local', 'cloud']),
    text: z.string().min(1).max(1_000),
    context: z.record(z.string().max(64), z.unknown()).optional().default({}),
  }).refine((value) => Object.keys(value.context).length <= 32, { message: 'too_many_context_keys' }),
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
  z.object({ type: z.literal('response'), id: z.string(), ok: z.literal(false), error: z.object({ code: z.string(), message: z.string().optional(), details: z.unknown().optional() }) }),
]);

export const rpcHelloSchema = z.object({
  type: z.literal('hello'),
  protocol: z.literal(1),
  at: z.number(),
  authRequired: z.boolean(),
});

export const rpcPingSchema = z.object({ type: z.literal('ping'), id: z.string().min(1), at: z.number().int() });
export const rpcPongSchema = z.object({ type: z.literal('pong'), id: z.string(), at: z.number(), serverAt: z.number() });
