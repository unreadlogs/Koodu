import { timingSafeEqual, randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { AUTH_HEADER, loginRequestSchema, rpcPayloadSchemas, rpcRequestSchema } from '@koodu/protocol';
import { defaultWorkspaceSettings, workspaceSettingsKey, workspaceSettingsSchema, type SettingsSnapshot } from '@koodu/protocol';
import type { ServerConfig } from './config';
import { createOpenAiRuntime } from './inference/openai';
import { InferenceError, type InferenceRuntime } from './inference/types';
import Database from 'better-sqlite3';
import { initializeDatabase } from './storage/database';
import { MainAgent } from './agent/main-agent';
import { AgentEngine } from './agent/agent-engine';
import { createDefaultToolRegistry } from './agent/tools';
import { SkillsEngine } from './skills';
import { sanitizeEmbeddingText } from './inference/embedding';

/** Bound both the byte size and the shape of untrusted request bodies. */
const contextSchema = z
  .record(z.string().max(64), z.unknown())
  .refine((value) => Object.keys(value).length <= 32, { message: 'too_many_keys' });

const requestSchema = z.object({
  text: z.string().min(1).max(1_000),
  context: contextSchema.optional().default({}),
});

const managedModelSchema = z.object({
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
type ManagedModel = Omit<z.infer<typeof managedModelSchema>, 'apiKey'> & { apiKey: string | null };

export interface ServerDeps {
  local?: InferenceRuntime;
  cloud?: InferenceRuntime;
  database?: Database.Database;
  logFilePath?: string;
  workspaceDir?: string;
}

type ServerLogEntry = { id: string; at: number; level: 'info' | 'success' | 'warning' | 'error'; source: string; message: string; detail: string | null };

export function createServer(config: ServerConfig, deps: ServerDeps = {}): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 16 * 1024 });
  const ownsDatabase = !deps.database;
  const database = deps.database ?? initializeDatabase(':memory:');
  const mainAgent = new MainAgent({ database });
  const skills = new SkillsEngine(database);
  skills.seedStarter();
  const workspaceRoot = deps.workspaceDir
    ?? (isAbsolute(config.workspaceDir) ? config.workspaceDir : resolve(process.cwd(), config.workspaceDir));
  mkdirSync(workspaceRoot, { recursive: true });
  const toolRegistry = createDefaultToolRegistry();
  const agentEngine = new AgentEngine({
    database,
    memory: mainAgent,
    skills,
    tools: toolRegistry,
    workspaceRoot,
  });
  const managedModels = new Map<string, ManagedModel>();
  const managedModelUsage = new Map<string, { month: string; tokens: number }>();
  /** In-flight agent runs, so `tasks.cancel` can actually abort the provider call. */
  const taskControllers = new Map<string, AbortController>();
  const storedProfiles = database.prepare('SELECT * FROM model_profiles').all() as Array<Record<string, any>>;
  for (const row of storedProfiles) managedModels.set(row.id, { id: row.id, name: row.name, provider: row.provider, model: row.model, baseUrl: row.base_url, role: row.role, maxOutputTokens: row.max_output_tokens, monthlyTokenLimit: row.monthly_token_limit, enabled: Boolean(row.enabled), active: Boolean(row.active), apiKey: row.api_key });
  const storedUsage = database.prepare('SELECT model_id, month, tokens FROM model_usage').all() as Array<{model_id:string;month:string;tokens:number}>;
  for (const row of storedUsage) managedModelUsage.set(row.model_id, { month: row.month, tokens: row.tokens });
  const persistModel = database.prepare(`INSERT INTO model_profiles
    (id,name,provider,model,base_url,role,max_output_tokens,monthly_token_limit,enabled,active,api_key,updated_at)
    VALUES (@id,@name,@provider,@model,@baseUrl,@role,@maxOutputTokens,@monthlyTokenLimit,@enabled,@active,@apiKey,CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,provider=excluded.provider,model=excluded.model,base_url=excluded.base_url,role=excluded.role,max_output_tokens=excluded.max_output_tokens,monthly_token_limit=excluded.monthly_token_limit,enabled=excluded.enabled,active=excluded.active,api_key=excluded.api_key,updated_at=CURRENT_TIMESTAMP`);
  const saveProfile = (profile: ManagedModel) => persistModel.run({ ...profile, enabled: Number(profile.enabled), active: Number(profile.active) });
  // Server-authoritative settings: SQLite app_settings, versioned JSON.
  // The browser cache is never read or migrated into this table.
  const readSettings = (): SettingsSnapshot => {
    const row = database.prepare('SELECT value_json, updated_at FROM app_settings WHERE key = ?').get(workspaceSettingsKey) as { value_json: string; updated_at?: string | null } | undefined;
    if (!row) return { settings: defaultWorkspaceSettings, updatedAt: null, persistence: 'sqlite' as const };
    try {
      const parsed = workspaceSettingsSchema.safeParse(JSON.parse(String(row.value_json)));
      if (!parsed.success) return { settings: defaultWorkspaceSettings, updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null, persistence: 'sqlite' as const };
      return { settings: parsed.data, updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null, persistence: 'sqlite' as const };
    } catch {
      return { settings: defaultWorkspaceSettings, updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null, persistence: 'sqlite' as const };
    }
  };
  const writeSettings = (settings: typeof defaultWorkspaceSettings): SettingsSnapshot => {
    database.prepare(`INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = CURRENT_TIMESTAMP`).run(workspaceSettingsKey, JSON.stringify(settings));
    return readSettings();
  };
  const logFilePath = deps.logFilePath ?? (config.databasePath === ':memory:' ? null : resolve(dirname(config.databasePath), 'koodu.log.jsonl'));
  const logSubscribers = new Set<WebSocket>();
  const logCache: ServerLogEntry[] = [];
  const reloadLogCache = () => {
    if (!logFilePath || !existsSync(logFilePath)) return;
    const loaded: ServerLogEntry[] = [];
    const previous = new Map(logCache.map((entry) => [entry.id, entry]));
    const lines = readFileSync(logFilePath, 'utf8').split('\n');
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex] ?? '';
      if (!line.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        parsed = { message: line.trim() };
      }
      if (typeof parsed === 'string') parsed = { message: parsed };
      if (!parsed || typeof parsed !== 'object' || !('message' in parsed) || typeof parsed.message !== 'string') continue;
      const candidate = parsed as Record<string, unknown>;
      const id = typeof candidate.id === 'string' ? candidate.id : `manual-line-${lineIndex}`;
      const prior = previous.get(id);
      const level: ServerLogEntry['level'] = candidate.level === 'info' || candidate.level === 'success' || candidate.level === 'warning' || candidate.level === 'error' ? candidate.level : prior?.level ?? 'info';
      loaded.push({
        id,
        at: typeof candidate.at === 'number' && Number.isFinite(candidate.at) ? candidate.at : prior?.at ?? Date.now(),
        level,
        source: typeof candidate.source === 'string' ? candidate.source : prior?.source ?? 'manual',
        message: candidate.message as string,
        detail: typeof candidate.detail === 'string' ? candidate.detail : prior?.detail ?? null,
      });
    }
    logCache.splice(0, logCache.length, ...loaded.slice(-5000));
  };
  const publishLogEntry = (entry: ServerLogEntry) => {
    const event = JSON.stringify({ type: 'event', event: 'logs.entry', payload: entry });
    for (const subscriber of logSubscribers) {
      if (subscriber.readyState === WebSocket.OPEN) { try { subscriber.send(event); } catch { logSubscribers.delete(subscriber); } }
    }
  };
  let logFileWatcher: FSWatcher | null = null;
  if (logFilePath) {
    mkdirSync(dirname(logFilePath), { recursive: true });
    if (!existsSync(logFilePath)) writeFileSync(logFilePath, '');
    reloadLogCache();
    logFileWatcher = watch(dirname(logFilePath), (_event, filename) => {
      if (filename && basename(String(filename)) !== basename(logFilePath)) return;
      try {
        const previous = new Map(logCache.map((entry) => [entry.id, JSON.stringify(entry)]));
        reloadLogCache();
        for (const entry of logCache) if (previous.get(entry.id) !== JSON.stringify(entry)) publishLogEntry(entry);
      } catch { /* Ignore transient file reads during append/rotation. */ }
    });
  }
  const recordServerLog = (level: 'info' | 'success' | 'warning' | 'error', source: string, message: string, detail?: string) => {
    try {
      const entry: ServerLogEntry = { id: randomUUID(), at: Date.now(), level, source, message, detail: detail ?? null };
      const compact = logCache.length >= 5000;
      logCache.push(entry);
      if (logCache.length > 5000) logCache.shift();
      if (logFilePath) {
        mkdirSync(dirname(logFilePath), { recursive: true });
        if (compact) writeFileSync(logFilePath, `${logCache.map((item) => JSON.stringify(item)).join('\n')}\n`);
        else appendFileSync(logFilePath, `${JSON.stringify(entry)}\n`);
      }
      publishLogEntry(entry);
    } catch { /* Logging must not break server requests. */ }
  };

  // Static assets: server serves public/companion/ (auto-synced from assets/companion/).
  // Generated by scripts/sync-assets.mjs (prestart/predev) — git-ignored.
  const publicRoot = fileURLToPath(new URL('../public', import.meta.url));
  const publicDir = config.publicDir === 'public' ? publicRoot : resolve(publicRoot, config.publicDir);
  if (existsSync(publicDir)) {
    app.register(fastifyStatic, {
      root: publicDir,
      prefix: '/companion/',
      decorateReply: false,
      setHeaders(reply: { header(name: string, value: string): unknown }, path: string) {
        reply.header('Cache-Control', 'public, max-age=3600');
        if (path.endsWith('.json')) reply.header('Content-Type', 'application/json');
      },
    });
  }

  const local = deps.local ?? createLocalRuntime(config);
  const cloud = deps.cloud ?? createCloudRuntime(config);

  /** Resolve the active managed profile for a route, or fall back to env runtime. */
  const selectRuntime = (role: 'local' | 'cloud'): { runtime: InferenceRuntime; managed: ManagedModel | null; blocked: 'monthly_token_limit_reached' | null } => {
    const base = role === 'local' ? local : cloud;
    const managed = [...managedModels.values()].find((item) => item.enabled && item.active && item.role === base.kind) ?? null;
    const runtime = managed
      ? createOpenAiRuntime({
          id: managed.id,
          kind: base.kind,
          baseUrl: managed.baseUrl,
          model: managed.model,
          apiKey: managed.apiKey,
          timeoutMs: Math.max(config.timeoutMs, 30_000),
          maxOutputTokens: managed.maxOutputTokens,
        })
      : base;
    if (managed && managed.monthlyTokenLimit > 0) {
      const month = new Date().toISOString().slice(0, 7);
      const usage = managedModelUsage.get(managed.id);
      if (usage?.month === month && usage.tokens >= managed.monthlyTokenLimit) {
        return { runtime, managed, blocked: 'monthly_token_limit_reached' };
      }
    }
    return { runtime, managed, blocked: null };
  };

  const recordModelUsage = (managed: ManagedModel | null, totalTokens?: number): void => {
    if (!managed || !totalTokens) return;
    const month = new Date().toISOString().slice(0, 7);
    const previous = managedModelUsage.get(managed.id);
    managedModelUsage.set(managed.id, { month, tokens: (previous?.month === month ? previous.tokens : 0) + totalTokens });
  };

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

    // Public endpoints: health, auth status, login, static companion assets
    const isPublic = request.url.startsWith('/companion/') || new Set(['/api/health', '/api/auth/status', '/api/auth/login']).has(request.url.split('?')[0] ?? request.url);
    if (isPublic) return;

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

  app.get('/api/model-profiles', async () => ({
    persistence: 'process-memory',
    profiles: [...managedModels.values()].map(({ apiKey, ...profile }) => ({ ...profile, apiKeySet: Boolean(apiKey) })),
  }));

  app.put('/api/model-profiles/:id', async (request, reply) => {
    const params = z.object({ id: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/) }).safeParse(request.params);
    const parsed = managedModelSchema.safeParse(request.body);
    if (!params.success || !parsed.success || params.data.id !== parsed.data.id) {
      return reply.status(400).send({ error: 'invalid_model_profile' });
    }
    const previous = managedModels.get(parsed.data.id);
    const apiKey = parsed.data.clearApiKey ? null : parsed.data.apiKey?.trim() || previous?.apiKey || null;
    const { apiKey: _submittedKey, clearApiKey: _clearKey, ...profile } = parsed.data;
    if (profile.active) {
      for (const [id, item] of managedModels) if (item.role === profile.role && id !== profile.id) managedModels.set(id, { ...item, active: false });
    for (const item of managedModels.values()) if (item.role === profile.role && item.id !== profile.id) saveProfile(item);
    }
    managedModels.set(profile.id, { ...profile, apiKey });
    saveProfile({ ...profile, apiKey });
    return reply.send({ ...profile, apiKeySet: Boolean(apiKey) });
  });

  app.delete('/api/model-profiles/:id', async (request, reply) => {
    const params = z.object({ id: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/) }).safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'invalid_model_profile' });
    const deleted = managedModels.delete(params.data.id);
    database.prepare('DELETE FROM model_profiles WHERE id = ?').run(params.data.id);
    return reply.send({ ok: deleted });
  });

  app.post('/api/model-profiles/:id/test', async (request, reply) => {
    const params = z.object({ id: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/) }).safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'invalid_model_profile' });
    const profile = managedModels.get(params.data.id);
    if (!profile) return reply.status(404).send({ error: 'model_profile_not_found' });
    if (!profile.apiKey) return reply.status(400).send({ error: 'api_key_missing' });
    try {
      const response = await fetch(`${profile.baseUrl.replace(/\/+$/, '')}/models`, {
        headers: { authorization: `Bearer ${profile.apiKey}` },
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      if (!response.ok) return reply.status(502).send({ error: 'provider_rejected_request', status: response.status });
      return reply.send({ ok: true, provider: profile.provider, model: profile.model });
    } catch {
      return reply.status(502).send({ error: 'provider_unreachable' });
    }
  });

  const register = (path: string, runtime: InferenceRuntime): void => {
    app.post(path, async (request, reply) => {
      const parsed = requestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'invalid_request' });
      }
      const managed = [...managedModels.values()].find((item) => item.enabled && item.active && item.role === runtime.kind);
      const selectedRuntime = managed
        ? createOpenAiRuntime({ id: managed.id, kind: runtime.kind, baseUrl: managed.baseUrl, model: managed.model, apiKey: managed.apiKey, timeoutMs: config.timeoutMs, maxOutputTokens: managed.maxOutputTokens })
        : runtime;
      if (managed && managed.monthlyTokenLimit > 0) {
        const month = new Date().toISOString().slice(0, 7);
        const usage = managedModelUsage.get(managed.id);
        if (usage?.month === month && usage.tokens >= managed.monthlyTokenLimit) {
          return reply.status(429).send({ error: 'monthly_token_limit_reached', provider: managed.id });
        }
      }
      if (!selectedRuntime.configured()) {
        return reply
          .status(501)
          .send({ error: 'not_configured', provider: selectedRuntime.id });
      }
      try {
        const result = await selectedRuntime.complete({
          text: parsed.data.text,
          context: parsed.data.context ?? {},
        });
        if (managed && result.usage?.totalTokens) {
          const month = new Date().toISOString().slice(0, 7);
          const previous = managedModelUsage.get(managed.id);
          managedModelUsage.set(managed.id, { month, tokens: (previous?.month === month ? previous.tokens : 0) + result.usage.totalTokens });
        }
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

  // ---- Central JSON WebSocket ----
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1_048_576 });
  const controlSchema = z.object({ type: z.literal('ping'), id: z.string().min(1), at: z.number().int() });

  app.server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '', 'http://dummy');
    if (url.pathname !== '/ws') {
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
    let authenticated = !authRequired();
    let connectionToken: string | null = null;
    const reply = (obj: unknown) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
    };
    reply({ type: 'hello', protocol: 1, at: Date.now(), authRequired: authRequired() });

    ws.on('message', (data: RawData) => {
        void (async () => {
        const raw = data instanceof ArrayBuffer ? Buffer.from(data) : Array.isArray(data) ? Buffer.concat(data) : data;
        if (raw.byteLength > 1_048_576) return;
        let json: unknown;
        try { json = JSON.parse(raw.toString()); } catch { return; }
        const control = controlSchema.safeParse(json);
        if (control.success) {
          reply({ type: 'pong', id: control.data.id, at: control.data.at, serverAt: Date.now() });
          return;
        }
        const request = rpcRequestSchema.safeParse(json);
        if (!request.success) return;
        const { id, method } = request.data;
        const parsed = rpcPayloadSchemas[method].safeParse(request.data.payload);
        if (!parsed.success) {
          reply({ type: 'response', id, ok: false, error: 'The request payload is invalid.', error_code: 'invalid_request', details: parsed.error.flatten() });
          return;
        }
        const ok = (result: unknown) => reply({ type: 'response', id, ok: true, result });
        const defaultErrorMessages: Record<string, string> = {
          unauthorized: 'Authentication is required for this action.',
          internal_error: 'The server could not complete the request.',
          invalid_request: 'The request payload is invalid.',
          invalid_memory: 'The memory text is empty after applying the safe length limit.',
          not_configured: 'The requested model provider is not configured. Add an active profile in Models or set a provider endpoint, then try again.',
          timeout: 'The AI provider timed out. Please try again.',
          rate_limited: 'The AI provider is rate-limiting requests. Please wait a moment and try again.',
          http_error: 'The AI provider returned an error. Please try again in a moment.',
          invalid_output: 'The AI returned an unexpected format. Please try again.',
          conversation_not_found: 'That conversation no longer exists.',
          agent_failed: 'The companion could not complete the request.',
          monthly_token_limit_reached: 'Monthly token limit reached for this model profile.',
          task_not_found: 'That agent task no longer exists.',
          task_not_resumable: 'That agent task is not paused, so it cannot be resumed.',
          cancelled: 'The request was cancelled.',
        };
        const fail = (code: string, message?: string, details?: unknown) => reply({ type: 'response', id, ok: false, error: message ?? defaultErrorMessages[code] ?? 'The request could not be completed.', error_code: code, ...(details === undefined ? {} : { details }) });
        const requireAuth = () => { if (authenticated) return true; fail('unauthorized'); return false; };
        try {
          switch (method) {
            case 'system.ping': ok({ serverAt: Date.now(), at: (parsed.data as { at: number }).at }); return;
            case 'system.health': ok({ ok: true, service: 'koodu-server', inference: { local: { id: local.id, kind: local.kind, model: local.model, configured: local.configured(), location: 'server' }, cloud: { id: cloud.id, kind: cloud.kind, model: cloud.model, configured: cloud.configured(), location: 'server' } }, ws: { path: '/ws', clients: wss.clients.size } }); return;
            case 'auth.status': ok({ authRequired: authRequired(), authenticated }); return;
            case 'auth.login': {
              const payload = parsed.data as z.infer<typeof loginRequestSchema>;
              if (!passwordMatches(payload.password)) { fail('invalid_password'); return; }
              const token = createToken(); connectionToken = token; authenticated = true; ok({ token }); return;
            }
            case 'auth.authenticate': {
              const token = (parsed.data as { token: string }).token;
              authenticated = !authRequired() || authTokens.has(token);
              if (!authenticated) { fail('unauthorized'); return; }
              connectionToken = token;
              ok({ authenticated: true }); return;
            }
            case 'auth.logout': {
              if (!requireAuth()) return;
              if (connectionToken) authTokens.delete(connectionToken);
              connectionToken = null;
              authenticated = !authRequired(); ok({ ok: true }); return;
            }
            case 'models.list': {
              if (!requireAuth()) return;
              ok({ persistence: 'sqlite', profiles: [...managedModels.values()].map(({ apiKey, ...profile }) => ({ ...profile, apiKeySet: Boolean(apiKey) })) }); return;
            }
            case 'models.save': {
              if (!requireAuth()) return;
              const payload = parsed.data as z.infer<typeof managedModelSchema>;
              const previous = managedModels.get(payload.id);
              const apiKey = payload.clearApiKey ? null : payload.apiKey?.trim() || previous?.apiKey || null;
              const { apiKey: _submittedKey, clearApiKey: _clearKey, ...profile } = payload;
              if (profile.active) for (const [profileId, item] of managedModels) if (item.role === profile.role && profileId !== profile.id) { const inactive = { ...item, active: false }; managedModels.set(profileId, inactive); saveProfile(inactive); }
              const saved = { ...profile, apiKey } as ManagedModel;
              managedModels.set(profile.id, saved);
              saveProfile(saved);
              recordServerLog('success', 'models', `Model profile “${profile.name}” was ${previous ? 'updated' : 'created'}.`, `Provider: ${profile.provider} · Model: ${profile.model} · Route: ${profile.role}.`);
              ok({ ...profile, apiKeySet: Boolean(apiKey) }); return;
            }
            case 'models.delete': {
              if (!requireAuth()) return;
              { const id = (parsed.data as { id: string }).id; const profile = managedModels.get(id); const deleted = managedModels.delete(id); database.prepare('DELETE FROM model_profiles WHERE id = ?').run(id); managedModelUsage.delete(id); if (deleted && profile) recordServerLog('warning', 'models', `Model profile “${profile.name}” was deleted.`, `Route: ${profile.role}.`); ok({ ok: deleted }); } return;
            }
            case 'models.test': {
              if (!requireAuth()) return;
              const profile = managedModels.get((parsed.data as { id: string }).id);
              if (!profile) { fail('model_profile_not_found'); return; }
              if (!profile.apiKey) { fail('api_key_missing'); return; }
              try {
                const response = await fetch(`${profile.baseUrl.replace(/\/+$/, '')}/models`, { headers: { authorization: `Bearer ${profile.apiKey}` }, signal: AbortSignal.timeout(config.timeoutMs) });
                if (!response.ok) { recordServerLog('warning', 'models', `Connection test failed for “${profile.name}”.`, `Provider returned HTTP ${response.status}.`); fail('provider_rejected_request', undefined, { status: response.status }); return; }
                recordServerLog('success', 'models', `Connection test succeeded for “${profile.name}”.`, `Provider: ${profile.provider} · Model: ${profile.model}.`);
                ok({ ok: true, provider: profile.provider, model: profile.model });
              } catch { recordServerLog('error', 'models', `Connection test failed for “${profile.name}”.`, 'The provider endpoint could not be reached.'); fail('provider_unreachable'); }
              return;
            }
            case 'usage.summary': {
              if (!requireAuth()) return;
              const range = (parsed.data as {range:'24H'|'7D'|'30D'}).range;
              const windowMs = range === '24H' ? 86_400_000 : range === '7D' ? 7 * 86_400_000 : 30 * 86_400_000;
              const since = Date.now() - windowMs;
              const summary = database.prepare(`SELECT COUNT(*) calls, COALESCE(SUM(input_tokens+output_tokens),0) tokens,
                COALESCE(AVG(latency_ms),0) latency, COALESCE(100.0*SUM(outcome='success')/NULLIF(COUNT(*),0),0) successRate
                FROM usage_events WHERE occurred_at >= ?`).get(since) as {calls:number;tokens:number;latency:number;successRate:number};
              const recent = database.prepare('SELECT id,occurred_at,model_id,provider,route,input_tokens,output_tokens,latency_ms,outcome,error_code FROM usage_events WHERE occurred_at >= ? ORDER BY occurred_at DESC LIMIT 20').all(since);
              const daily = database.prepare(`SELECT strftime('%Y-%m-%d', occurred_at/1000, 'unixepoch') day, COUNT(*) calls, SUM(input_tokens+output_tokens) tokens FROM usage_events WHERE occurred_at >= ? GROUP BY day ORDER BY day`).all(since);
              ok({ range, since, summary, recent, daily }); return;
            }
            case 'logs.watch': {
              if (!requireAuth()) return;
              reloadLogCache();
              logSubscribers.add(ws);
              ok({ entries: logCache.slice(-500).reverse() }); return;
            }
            case 'logs.unwatch': {
              logSubscribers.delete(ws);
              ok({ ok: true }); return;
            }
            case 'logs.clear': {
              if (!requireAuth()) return;
              logCache.length = 0;
              if (logFilePath) { mkdirSync(dirname(logFilePath), { recursive: true }); writeFileSync(logFilePath, ''); }
              ok({ ok: true }); return;
            }
            case 'memory.list': {
              if (!requireAuth()) return;
              ok({ memories: await mainAgent.memory.list() }); return;
            }
            case 'memory.save': {
              if (!requireAuth()) return;
              const payload = parsed.data as { id?: number; content: string; category: 'preference' | 'fact' | 'task' };
              const clean = sanitizeEmbeddingText(payload.content);
              if (!clean) { fail('invalid_memory', 'Memory content is empty after applying the embedding safety limit.'); return; }
              if (payload.id) {
                await mainAgent.memory.update(payload.id, clean, payload.category);
                recordServerLog('success', 'memory', 'A memory was updated.', `Category: ${payload.category} · Record: ${payload.id}.`);
              } else {
                const id = await mainAgent.memory.add(clean, payload.category);
                recordServerLog('success', 'memory', 'A memory was created.', `Category: ${payload.category} · Record: ${id}.`);
              }
              ok({ memories: await mainAgent.memory.list() }); return;
            }
            case 'memory.delete': {
              if (!requireAuth()) return;
              const id = (parsed.data as { id: number }).id;
              const existed = database.prepare('SELECT 1 FROM memories WHERE id = ?').get(id);
              mainAgent.memory.delete(id);
              if (existed) recordServerLog('warning', 'memory', 'A memory was deleted.', `Record: ${id}.`);
              ok({ memories: await mainAgent.memory.list() }); return;
            }
            case 'skills.list': {
              if (!requireAuth()) return;
              ok({ skills: skills.list(), persistence: 'sqlite' }); return;
            }
            case 'skills.save': {
              if (!requireAuth()) return;
              const skill = parsed.data as {id:string;name:string;description:string;category:'Research'|'Development'|'Organization'|'Custom';instructions:string;enabled:boolean;source:string};
              const existed = database.prepare('SELECT 1 FROM skills WHERE id = ?').get(skill.id);
              const list = skills.save(skill);
              recordServerLog('success', 'skills', `Skill “${skill.name}” was ${existed ? 'updated' : 'created'}.`, `Category: ${skill.category} · ${skill.enabled ? 'Enabled' : 'Disabled'}.`);
              ok({ skills: list }); return;
            }
            case 'skills.delete': {
              if (!requireAuth()) return;
              const id = (parsed.data as {id:string}).id;
              const skill = database.prepare('SELECT name FROM skills WHERE id = ?').get(id) as {name:string}|undefined;
              const list = skills.remove(id);
              if (skill) recordServerLog('warning', 'skills', `Skill “${skill.name}” was deleted.`);
              ok({ skills: list }); return;
            }
            case 'skills.import': {
              if (!requireAuth()) return;
              const incoming = (parsed.data as {skills:Array<{id:string;name:string;description:string;category:'Research'|'Development'|'Organization'|'Custom';instructions:string;enabled:boolean;source:string}>}).skills;
              const list = skills.importMany(incoming);
              recordServerLog('success', 'skills', `${incoming.length} skill${incoming.length === 1 ? '' : 's'} were imported.`, 'Skill definitions were added to the server library.');
              ok({ skills: list, imported: incoming.length }); return;
            }
            case 'intelligence.complete': {
              if (!requireAuth()) return;
              const payload = parsed.data as { role: 'local' | 'cloud'; text: string; context: Record<string, unknown> };
              const { runtime: selectedRuntime, managed, blocked } = selectRuntime(payload.role);
              if (blocked) { fail(blocked, undefined, { provider: managed?.id }); return; }
              if (!selectedRuntime.configured()) { fail('not_configured', undefined, { provider: selectedRuntime.id }); return; }
              try {
                const result = await selectedRuntime.complete({ text: payload.text, context: payload.context });
                recordModelUsage(managed, result.usage?.totalTokens);
                recordServerLog('success', 'inference', `${payload.role === 'cloud' ? 'Cloud' : 'Local'} inference completed.`, `Provider: ${selectedRuntime.id}.`);
                ok(result);
              } catch (error) {
                const code = error instanceof InferenceError ? error.code : 'unavailable';
                recordServerLog('error', 'inference', `${payload.role === 'cloud' ? 'Cloud' : 'Local'} inference failed.`, `Error code: ${code}.`);
                fail(code, undefined, { provider: selectedRuntime.id });
              }
              return;
            }
            case 'chats.list': {
              if (!requireAuth()) return;
              const conversations = database.prepare(`SELECT c.id,c.title,c.created_at AS createdAt,c.updated_at AS updatedAt,COUNT(m.id) AS messageCount
                FROM chat_conversations c LEFT JOIN chat_messages m ON m.conversation_id=c.id GROUP BY c.id ORDER BY c.updated_at DESC`).all();
              ok({ conversations }); return;
            }
            case 'chats.create': {
              if (!requireAuth()) return;
              const payload = parsed.data as { title?: string };
              const id = randomUUID(); const now = new Date().toISOString();
              database.prepare('INSERT INTO chat_conversations (id,title,created_at,updated_at) VALUES (?,?,?,?)').run(id, payload.title?.trim() || 'New chat', now, now);
              ok({ conversation: { id, title: payload.title?.trim() || 'New chat', createdAt: now, updatedAt: now, messageCount: 0 } }); return;
            }
            case 'chats.delete': {
              if (!requireAuth()) return;
              const { conversationId } = parsed.data as { conversationId: string };
              const result = database.prepare('DELETE FROM chat_conversations WHERE id=?').run(conversationId);
              ok({ deleted: result.changes > 0 }); return;
            }
            case 'chats.messages': {
              if (!requireAuth()) return;
              const { conversationId } = parsed.data as { conversationId: string };
              const messages = database.prepare('SELECT id,role,content,created_at AS createdAt FROM chat_messages WHERE conversation_id=? ORDER BY created_at,id').all(conversationId);
              ok({ messages }); return;
            }
            case 'chats.send': {
              if (!requireAuth()) return;
              const payload = parsed.data as { conversationId: string; role: 'local' | 'cloud'; text: string };
              const conversation = database.prepare('SELECT id,title FROM chat_conversations WHERE id=?').get(payload.conversationId) as { id: string; title: string } | undefined;
              if (!conversation) { fail('conversation_not_found'); return; }
              const now = new Date().toISOString();
              database.prepare('INSERT INTO chat_messages (id,conversation_id,role,content,created_at) VALUES (?,?,\'user\',?,?)').run(randomUUID(), conversation.id, payload.text, now);
              if (conversation.title === 'New chat') {
                const title = payload.text.replace(/\s+/g, ' ').slice(0, 56) || 'New chat';
                database.prepare('UPDATE chat_conversations SET title=?,updated_at=? WHERE id=?').run(title, now, conversation.id);
              } else database.prepare('UPDATE chat_conversations SET updated_at=? WHERE id=?').run(now, conversation.id);
              const recent = database.prepare(`SELECT role,content FROM chat_messages WHERE conversation_id=? ORDER BY created_at DESC,id DESC LIMIT 20`).all(conversation.id) as Array<{role:'user'|'assistant';content:string}>;
              const context = { conversationId: conversation.id, conversation: recent.reverse().map((message) => ({ role: message.role, content: message.content.slice(0, 4_000) })) };
              const { runtime: selectedRuntime, managed, blocked } = selectRuntime(payload.role);
              if (blocked) { fail(blocked, undefined, { provider: managed?.id }); return; }
              if (!selectedRuntime.configured()) { fail('not_configured', undefined, { provider: selectedRuntime.id }); return; }
              const controller = new AbortController(); const abortOnClose = () => controller.abort(); ws.once('close', abortOnClose);
              const taskId = randomUUID();
              taskControllers.set(taskId, controller);
              try {
                const result = await agentEngine.run({ taskId, text: payload.text, context, runtime: selectedRuntime, signal: controller.signal,
                  onTextDelta: (text) => reply({ type: 'event', event: 'agent.stream', requestId: id, payload: { kind: 'delta', text } }),
                  onTextReset: () => reply({ type: 'event', event: 'agent.stream', requestId: id, payload: { kind: 'reset' } }),
                });
                const createdAt = new Date().toISOString();
                database.prepare('INSERT INTO chat_messages (id,conversation_id,role,content,created_at) VALUES (?,?,\'assistant\',?,?)').run(randomUUID(), conversation.id, result.reply, createdAt);
                database.prepare('UPDATE chat_conversations SET updated_at=? WHERE id=?').run(createdAt, conversation.id);
                if (result.status === 'paused') {
                  recordServerLog('warning', 'chats', 'A chat task paused at its safe step limit.', `Task: ${result.taskId}. Steps: ${result.iterations}. Tools: ${result.toolCalls}.`);
                }
                ok({ ...result, conversationId: conversation.id, createdAt });
              } catch (error) {
                const code = error instanceof InferenceError ? error.code : controller.signal.aborted ? 'cancelled' : 'agent_failed';
                recordServerLog(controller.signal.aborted ? 'warning' : 'error', 'chats', controller.signal.aborted ? 'A chat request was cancelled.' : 'A chat request failed.', `Error code: ${code} · Provider: ${selectedRuntime.id} · ${error instanceof Error ? error.message.slice(0, 200) : 'unknown'}`);
                fail(code, undefined, { provider: selectedRuntime.id, detail: error instanceof Error ? error.message.slice(0, 300) : undefined });
              } finally { ws.removeListener('close', abortOnClose); taskControllers.delete(taskId); }
              return;
            }
            case 'agent.run': {
              if (!requireAuth()) return;
              const payload = parsed.data as { role: 'local' | 'cloud'; agentType?: 'research' | 'coding' | 'organizer' | 'memory'; text: string; context: Record<string, unknown> };
              const { runtime: selectedRuntime, managed, blocked } = selectRuntime(payload.role);
              if (blocked) { fail(blocked, undefined, { provider: managed?.id }); return; }
              if (!selectedRuntime.configured()) { fail('not_configured', undefined, { provider: selectedRuntime.id }); return; }
              const controller = new AbortController();
              const abortOnClose = () => controller.abort();
              ws.once('close', abortOnClose);
              const taskId = randomUUID();
              taskControllers.set(taskId, controller);
              try {
                const result = await agentEngine.run({
                  taskId,
                  text: payload.text,
                  context: payload.context,
                  runtime: selectedRuntime,
                  agentType: payload.agentType,
                  signal: controller.signal,
                  onTextDelta: (text) => reply({ type: 'event', event: 'agent.stream', requestId: id, payload: { kind: 'delta', text } }),
                  onTextReset: () => reply({ type: 'event', event: 'agent.stream', requestId: id, payload: { kind: 'reset' } }),
                });
                recordServerLog(result.status === 'paused' ? 'warning' : 'success', 'agent', result.status === 'paused' ? 'The companion paused a task at its safe step limit.' : 'The companion completed a request.', `Task: ${result.taskId}. Steps: ${result.iterations}. Tools: ${result.toolCalls}.`);
                ok(result);
              } catch (error) {
                const code = error instanceof InferenceError ? error.code : controller.signal.aborted ? 'cancelled' : 'agent_failed';
                recordServerLog(controller.signal.aborted ? 'warning' : 'error', 'agent', controller.signal.aborted ? 'The companion request was cancelled.' : 'The companion could not complete a request.', `Error code: ${code} · Provider: ${selectedRuntime.id} · ${error instanceof Error ? error.message.slice(0, 200) : 'unknown'}`);
                fail(code, undefined, { provider: selectedRuntime.id, detail: error instanceof Error ? error.message.slice(0, 300) : undefined });
              } finally {
                ws.removeListener('close', abortOnClose);
                taskControllers.delete(taskId);
              }
              return;
            }
            case 'agent.resume': {
              if (!requireAuth()) return;
              const payload = parsed.data as { taskId: string; role: 'local' | 'cloud' };
              const task = agentEngine.getTask(payload.taskId);
              if (!task) { fail('task_not_found', undefined, { taskId: payload.taskId }); return; }
              if ((task.status !== 'paused' && task.status !== 'failed') || !task.checkpoint) { fail('task_not_resumable', undefined, { taskId: payload.taskId, status: task.status }); return; }
              const { runtime: selectedRuntime, managed, blocked } = selectRuntime(payload.role);
              if (blocked) { fail(blocked, undefined, { provider: managed?.id }); return; }
              if (!selectedRuntime.configured()) { fail('not_configured', undefined, { provider: selectedRuntime.id }); return; }
              const controller = new AbortController();
              const abortOnClose = () => controller.abort();
              ws.once('close', abortOnClose);
              taskControllers.set(payload.taskId, controller);
              try {
                const result = await agentEngine.resume(payload.taskId, {
                  text: task.task,
                  context: task.checkpoint.context,
                  runtime: selectedRuntime,
                  agentType: task.agentType,
                  signal: controller.signal,
                  onTextDelta: (text) => reply({ type: 'event', event: 'agent.stream', requestId: id, payload: { kind: 'delta', text } }),
                  onTextReset: () => reply({ type: 'event', event: 'agent.stream', requestId: id, payload: { kind: 'reset' } }),
                }, task.checkpoint.agentType);
                // A chat task remembers its conversation, so a resumed reply lands in the same thread.
                const conversationId = task.checkpoint.context.conversationId;
                if (typeof conversationId === 'string' && result.reply.trim()) {
                  const conversation = database.prepare('SELECT id FROM chat_conversations WHERE id=?').get(conversationId) as { id: string } | undefined;
                  if (conversation) {
                    const createdAt = new Date().toISOString();
                    database.prepare('INSERT INTO chat_messages (id,conversation_id,role,content,created_at) VALUES (?,?,\'assistant\',?,?)').run(randomUUID(), conversationId, result.reply, createdAt);
                    database.prepare('UPDATE chat_conversations SET updated_at=? WHERE id=?').run(createdAt, conversationId);
                  }
                }
                recordServerLog(result.status === 'paused' ? 'warning' : 'success', 'agent', result.status === 'paused' ? 'A resumed task paused again at its safe step limit.' : 'A resumed task completed.', `Task: ${result.taskId}. Steps: ${result.iterations}. Tools: ${result.toolCalls}.`);
                ok(result);
              } catch (error) {
                const code = error instanceof InferenceError ? error.code : controller.signal.aborted ? 'cancelled' : 'agent_failed';
                recordServerLog(controller.signal.aborted ? 'warning' : 'error', 'agent', controller.signal.aborted ? 'A resumed task was cancelled.' : 'A resumed task could not complete.', `Error code: ${code} · Provider: ${selectedRuntime.id} · ${error instanceof Error ? error.message.slice(0, 200) : 'unknown'}`);
                fail(code, undefined, { provider: selectedRuntime.id, detail: error instanceof Error ? error.message.slice(0, 300) : undefined });
              } finally {
                ws.removeListener('close', abortOnClose);
                taskControllers.delete(payload.taskId);
              }
              return;
            }
            case 'tasks.list': {
              if (!requireAuth()) return;
              const { limit } = parsed.data as { limit?: number };
              ok({ tasks: agentEngine.listTasks(limit) }); return;
            }
            case 'tasks.get': {
              if (!requireAuth()) return;
              const { taskId } = parsed.data as { taskId: string };
              const task = agentEngine.getTask(taskId);
              if (!task) { fail('task_not_found', undefined, { taskId }); return; }
              ok({ task }); return;
            }
            case 'tasks.events': {
              if (!requireAuth()) return;
              const { taskId, limit } = parsed.data as { taskId: string; limit?: number };
              const task = agentEngine.getTask(taskId);
              if (!task) { fail('task_not_found', undefined, { taskId }); return; }
              ok({ task, events: agentEngine.taskEvents(taskId, limit) }); return;
            }
            case 'tasks.cancel': {
              if (!requireAuth()) return;
              const { taskId } = parsed.data as { taskId: string };
              const task = agentEngine.getTask(taskId);
              if (!task) { fail('task_not_found', undefined, { taskId }); return; }
              taskControllers.get(taskId)?.abort();
              agentEngine.cancelTask(taskId);
              recordServerLog('warning', 'agent', 'An agent task was cancelled.', `Task: ${taskId}.`);
              ok({ ok: true, task: agentEngine.getTask(taskId) }); return;
            }
            case 'settings.get': {
              if (!requireAuth()) return;
              ok(readSettings()); return;
            }
            case 'settings.save': {
              if (!requireAuth()) return;
              const snapshot = writeSettings(parsed.data as typeof defaultWorkspaceSettings);
              recordServerLog('success', 'settings', 'User settings were updated.', `Companion: ${snapshot.settings.character === 'kumo' ? 'Kumo' : 'Kitsu'} · Startup: ${snapshot.settings.startupPage} · Pet mode: ${snapshot.settings.petMode}.`);
              ok(snapshot); return;
            }
            case 'settings.reset': {
              if (!requireAuth()) return;
              const snapshot = writeSettings(defaultWorkspaceSettings);
              recordServerLog('warning', 'settings', 'User settings were reset to defaults.');
              ok(snapshot); return;
            }
          }
        } catch { fail('internal_error'); }
        })().catch(() => { /* Keep this socket's dispatcher alive after malformed input. */ });
    });

    ws.on('error', () => {
      // ignore
    });
    ws.on('close', () => logSubscribers.delete(ws));
  });

  app.addHook('onClose', async () => {
    for (const client of wss.clients) client.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    logFileWatcher?.close();
    await mainAgent.close();
    if (ownsDatabase) database.close();
  });

  return app;
}

/** Local inference is opt-in: no baseUrl => 501. */
function createLocalRuntime(config: ServerConfig): InferenceRuntime {
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
