import { timingSafeEqual, randomBytes } from 'node:crypto';
import { z } from 'zod';
import Fastify, { type FastifyInstance } from 'fastify';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { AUTH_HEADER, loginRequestSchema } from '@koodu/protocol';
import type { ServerConfig } from './config';
import { createNeedleRuntime } from './inference/needle';
import { createOpenAiRuntime } from './inference/openai';
import { InferenceError, type InferenceRuntime } from './inference/types';

/** Bound both the byte size and the shape of untrusted request bodies. */
const contextSchema = z
  .record(z.string().max(64), z.unknown())
  .refine((value) => Object.keys(value).length <= 32, { message: 'too_many_keys' });

const requestSchema = z.object({
  text: z.string().min(1).max(1_000),
  context: contextSchema.optional().default({}),
});

export interface ServerDeps {
  local?: InferenceRuntime;
  cloud?: InferenceRuntime;
}

export function createServer(config: ServerConfig, deps: ServerDeps = {}): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 16 * 1024 });

  const local = deps.local ?? createLocalRuntime(config);
  const cloud = deps.cloud ?? createCloudRuntime(config);

  const authTokens = new Set<string>();
  const authRequired = () => config.auth.password !== null;

  const verifyAuthHeader = (header: string | string[] | undefined): boolean => {
    if (!authRequired()) return true;
    const token = Array.isArray(header) ? header[0] : header;
    if (!token) return false;
    return authTokens.has(token);
  };

  const createToken = (): string => {
    const token = randomBytes(32).toString('hex');
    authTokens.add(token);
    return token;
  };

  const passwordMatches = (input: string): boolean => {
    if (!config.auth.password) return true;
    const a = Buffer.from(input);
    const b = Buffer.from(config.auth.password);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  };

  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && config.allowedOrigins.includes(origin)) {
      reply.header('access-control-allow-origin', origin);
      reply.header('vary', 'origin');
      reply.header('access-control-allow-methods', 'GET,POST,OPTIONS');
      reply.header('access-control-allow-headers', 'content-type, x-koodu-auth');
    }
    if (request.method === 'OPTIONS') {
      await reply.status(204).send();
      return;
    }

    // Public endpoints: health, auth status, login
    const publicPaths = new Set(['/api/health', '/api/auth/status', '/api/auth/login']);
    if (publicPaths.has(request.url)) return;

    // WebSocket upgrade is handled separately (below). Skip HTTP auth for it.
    if (request.url.startsWith('/ws')) return;

    if (authRequired() && !verifyAuthHeader(request.headers[AUTH_HEADER.toLowerCase()])) {
      return reply.status(401).send({ error: 'unauthorized' });
    }
  });

  // Auth status + login/logout
  app.get('/api/auth/status', async () => ({
    authRequired: authRequired(),
    // health signals login requirement; token presence is checked via header
  }));

  app.post('/api/auth/login', async (request, reply) => {
    const parsed = loginRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_request' });
    }
    if (!authRequired()) {
      const token = createToken();
      return { token };
    }
    if (!passwordMatches(parsed.data.password)) {
      return reply.status(401).send({ error: 'invalid_password' });
    }
    const token = createToken();
    return { token };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = (request.headers[AUTH_HEADER.toLowerCase()] as string | undefined)
      ?? (request.headers['x-koodu-auth'] as string | undefined);
    if (token) authTokens.delete(token);
    return { ok: true };
  });

  app.get('/api/auth/me', async (request, reply) => {
    const token = request.headers['x-koodu-auth'] as string | undefined;
    if (!authRequired()) return { authenticated: true, authRequired: false };
    if (!verifyAuthHeader(token as any)) return reply.status(401).send({ error: 'unauthorized' });
    return { authenticated: true, authRequired: true };
  });

  app.get('/api/health', async () => ({
    ok: true,
    service: 'koodu-server',
    inference: {
      local: {
        id: local.id,
        kind: local.kind,
        model: local.model,
        configured: local.configured(),
        location: 'server',
      },
      cloud: {
        id: cloud.id,
        kind: cloud.kind,
        model: cloud.model,
        configured: cloud.configured(),
        location: 'server',
      },
    },
    ws: { path: '/ws', clients: wss.clients.size },
  }));

  const register = (path: string, runtime: InferenceRuntime): void => {
    app.post(path, async (request, reply) => {
      const parsed = requestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'invalid_request' });
      }
      if (!runtime.configured()) {
        return reply
          .status(501)
          .send({ error: 'not_configured', provider: runtime.id });
      }
      try {
        const result = await runtime.complete({
          text: parsed.data.text,
          context: parsed.data.context ?? {},
        });
        return reply.send(result);
      } catch (error) {
        const code = error instanceof InferenceError ? error.code : 'unavailable';
        const status = code === 'not_configured' ? 501 : code === 'timeout' ? 504 : 502;
        return reply.status(status).send({ error: code, provider: runtime.id });
      }
    });
  };

  register('/api/intelligence/local', local);
  register('/api/intelligence/cloud', cloud);

  // ---- WebSocket (Slice 2) ----
  // Raw ws server on Fastify's underlying HTTP server. Path: /ws?token=...
  const wss = new WebSocketServer({ noServer: true });
  const wsSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('ping'), id: z.string().min(1), at: z.number().int() }).passthrough(),
    z.object({ type: z.literal('hello'), at: z.number().int().optional() }).passthrough(),
  ]);

  app.server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '', 'http://dummy');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    const token = url.searchParams.get('token');
    if (authRequired() && (!token || !authTokens.has(token))) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    // Origin check: accept only allowed origins (Vite dev port by default)
    const origin = request.headers.origin;
    if (origin && !config.allowedOrigins.includes(origin) && origin !== `http://${config.host}:${config.port}`) {
      // Still allow same-origin + configured origins + localhost variants
      // For dev, be permissive on localhost
      const isLocalhost = /^https?:\/\/((localhost|127\.0\.0\.1)(:\d+)?)$/.test(origin);
      if (!isLocalhost) {
        socket.destroy();
        return;
      }
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws: WebSocket) => {
    const reply = (obj: unknown) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
    };
    reply({ type: 'hello', at: Date.now(), ok: true });

    ws.on('message', (data: RawData) => {
      let json: unknown;
      try {
        json = JSON.parse(data.toString());
      } catch {
        return;
      }
      const parsed = wsSchema.safeParse(json);
      if (!parsed.success) return;
      if (parsed.data.type === 'ping') {
        reply({ type: 'pong', id: parsed.data.id, at: parsed.data.at, serverAt: Date.now() });
      }
    });

    ws.on('error', () => {
      // ignore
    });
  });

  app.addHook('onClose', async () => {
    for (const client of wss.clients) client.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });

  return app;
}

/** Local inference is opt-in: no baseUrl or no downloaded Needle model => 501. */
function createLocalRuntime(config: ServerConfig): InferenceRuntime {
  if (config.local.provider === 'needle') {
    return createNeedleRuntime({
      modelPath: config.local.needleModelPath,
      cacheDir: config.local.needleCacheDir,
      timeoutMs: config.timeoutMs,
    });
  }

  if (config.local.provider === 'openai') {
    if (!config.local.baseUrl) {
      return disabledRuntime('local', 'local', config.local.model, 'local_base_url_missing');
    }
    return createOpenAiRuntime({
      id: 'local',
      kind: 'local',
      baseUrl: config.local.baseUrl,
      model: config.local.model,
      apiKey: config.local.apiKey,
      timeoutMs: config.timeoutMs,
    });
  }

  return disabledRuntime('local', 'local', config.local.model, 'local_provider_disabled');
}

/** Cloud inference remains optional and requires an explicit OpenAI-compatible endpoint. */
function createCloudRuntime(config: ServerConfig): InferenceRuntime {
  if (!config.cloud.baseUrl) {
    return disabledRuntime('cloud', 'cloud', config.cloud.model, 'cloud_base_url_missing');
  }
  return createOpenAiRuntime({
    id: 'cloud',
    kind: 'cloud',
    baseUrl: config.cloud.baseUrl,
    model: config.cloud.model,
    apiKey: config.cloud.apiKey,
    timeoutMs: config.timeoutMs,
  });
}

function disabledRuntime(
  id: 'local' | 'cloud',
  kind: 'local' | 'cloud',
  model: string,
  detail: string,
): InferenceRuntime {
  return {
    id,
    kind,
    model,
    configured: () => false,
    async complete() {
      throw new InferenceError('not_configured', detail);
    },
  };
}
