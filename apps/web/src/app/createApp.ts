import type {
  AiStatus,
  AppEvent,
  DispatchSource,
  EventDraft,
  FrameState,
} from '@koodu/protocol';
import { createAgentEngine, type AgentEngine } from '../engines/agent';
import {
  createHttpProvider,
  createRuleProvider,
  routeIntent,
  type IntentProvider,
} from '../engines/intelligence';
import {
  createActionRegistry,
  createDispatcher,
  createEventBus,
  createIdFactory,
  type Dispatcher,
  type DispatchOutcome,
  type EventBus,
  type PublishMeta,
} from '../engines/middleware';
import {
  createBrowserStorage,
  createMemoryStorage,
  createPersistenceService,
  type KeyValueStorage,
  type PersistenceService,
} from '../engines/persistence';
import { createPetMachineState } from '../engines/pet';
import { workspaceFromSnapshot } from '../engines/workspace';
import { createActions, type AppContext } from './actions';
import { createPetController, type PetController } from './petController';
import { createAppStore, type AppStore, type PendingApproval } from './store';
import { createWsClient, type WsClient } from './wsClient';
import { getApiHeaders } from './auth';

export interface CreateAppDeps {
  storage?: KeyValueStorage;
  fetchImpl?: typeof fetch;
  now?: () => number;
  newId?: (prefix: string) => string;
  /** Disable cloud routing (offline/privacy mode). Local model still runs. */
  localOnly?: boolean;
  checkHealth?: boolean;
  /** 0 disables the pet timer (useful in tests). */
  tickMs?: number;
  /** Prefix for API calls; empty means same origin. */
  baseUrl?: string;
}

export interface CommandResult {
  status: 'dispatched' | 'needs_approval' | 'denied' | 'failed' | 'no_proposal';
  message: string;
  reply: string | null;
}

export interface RunActionOptions {
  source?: DispatchSource;
  approved?: boolean;
}

export interface App {
  store: AppStore;
  bus: EventBus;
  agents: AgentEngine;
  persistence: PersistenceService;
  dispatcher: Dispatcher<AppContext>;
  start(): Promise<void>;
  stop(): void;
  dispatchAction(
    action: string,
    args: unknown,
    options?: RunActionOptions,
  ): Promise<DispatchOutcome>;
  submitCommand(text: string): Promise<CommandResult>;
  approve(): Promise<CommandResult | null>;
  deny(): CommandResult | null;
  /** Executed for iframe-originated commands: untrusted, local source only. */
  runFrameCommand(action: string, args: unknown): Promise<{ ok: boolean; message: string }>;
  snapshot(): FrameState;
  publish(draft: EventDraft, meta?: PublishMeta): AppEvent;
  setNotice(level: 'info' | 'warn' | 'error', message: string): void;
  clearNotice(): void;
  setCommandOpen(open: boolean): void;
  health(): Promise<void>;
  flushPersistence(): void;
  ping(): Promise<{ ms: number; serverAt: number }>;
  ws: WsClient;
}

export function createApp(deps: CreateAppDeps = {}): App {
  const now = deps.now ?? (() => Date.now());
  const newId = deps.newId ?? createIdFactory();
  const baseUrl = deps.baseUrl ?? '';
  const tickMs = deps.tickMs ?? 1_000;
  const checkHealth = deps.checkHealth ?? typeof window !== 'undefined';

  const store = createAppStore();
  const bus = createEventBus({ now });
  const agents = createAgentEngine({ now, newId });

  const storage =
    deps.storage ??
    (typeof localStorage === 'undefined'
      ? createMemoryStorage()
      : createBrowserStorage(localStorage));
  const persistence = createPersistenceService({ storage, now });
  const pet: PetController = createPetController(
    store,
    createPetMachineState(now(), { mode: 'embedded' }),
    now,
  );

  const publish: App['publish'] = (draft, meta = {}) => bus.publish(draft, meta);

  const publishAll = (drafts: EventDraft[], meta: PublishMeta): void => {
    for (const draft of drafts) publish(draft, meta);
  };

  const ws = createWsClient(store, { baseUrl });

  // Single projection point: every event updates the log and the pet machine.
  bus.subscribe('*', (event) => {
    store.setState((state) => ({ events: [...state.events, event].slice(-40) }));
    const drafts = pet.apply(event, now());
    publishAll(drafts, { source: 'pet', correlationId: event.correlationId });
  });

  const syncTasks = (): void => {
    store.setState({ tasks: agents.list() });
  };
  bus.subscribe('agent.task.created', syncTasks);
  bus.subscribe('agent.task.updated', syncTasks);

  const context: AppContext = { store, agents, persistence, pet, now, newId };
  const registry = createActionRegistry<AppContext>(createActions());
  const dispatcher = createDispatcher<AppContext>({
    registry,
    bus,
    context: () => context,
    now,
    newId,
  });

  const rules = createRuleProvider();
  const localProvider = createHttpProvider({
    id: 'local-model',
    kind: 'local-model',
    url: `${baseUrl}/api/intelligence/local`,
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });
  const cloudProvider = createHttpProvider({
    id: 'cloud',
    kind: 'cloud',
    url: `${baseUrl}/api/intelligence/cloud`,
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });
  const providers: IntentProvider[] =
    deps.localOnly === true ? [rules, localProvider] : [rules, localProvider, cloudProvider];

  let started = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastSaved = '';
  let writeFailed = false;

  const setNotice: App['setNotice'] = (level, message) => {
    store.setState((state) => ({ ui: { ...state.ui, notice: { level, message } } }));
  };

  const persist = (): void => {
    if (!started) return;
    const { workspace, pet: petState } = store.getState();
    const fingerprint = JSON.stringify([workspace, petState.mode, petState.position]);
    if (fingerprint === lastSaved) return;

    const outcome = persistence.save({
      workspace,
      pet: { mode: petState.mode, position: petState.position },
    });
    if (outcome.ok) {
      lastSaved = fingerprint;
      return;
    }
    if (!writeFailed) {
      writeFailed = true;
      store.setState((state) => ({
        persistence: { status: 'failed', detail: outcome.reason ?? 'write_failed' },
      }));
      setNotice('warn', 'Workspace could not be saved. Changes stay in memory.');
    }
  };

  store.subscribe(persist);

  const restoreAtStartup = (): void => {
    const decoded = persistence.load();
    if (decoded.ok && decoded.snapshot) {
      const snapshot = decoded.snapshot;
      const { state, dropped } = workspaceFromSnapshot(snapshot);
      store.setState((current) => ({
        workspace: state,
        pet: { ...current.pet, mode: snapshot.pet.mode, position: snapshot.pet.position },
        persistence: {
          status: 'restored',
          detail: dropped > 0 ? `dropped ${dropped} invalid tab(s)` : null,
        },
      }));
      pet.restoreMode(snapshot.pet.mode);
      publish(
        { type: 'persistence.restored', payload: { tabCount: state.tabs.length, dropped } },
        { source: 'persistence' },
      );
      lastSaved = JSON.stringify([state, snapshot.pet.mode, snapshot.pet.position]);
      return;
    }

    if (decoded.reason && decoded.reason !== 'empty') {
      store.setState({ persistence: { status: 'failed', detail: decoded.reason } });
      publish(
        { type: 'persistence.failed', payload: { reason: decoded.reason } },
        { source: 'persistence' },
      );
      setNotice('warn', 'Saved workspace was unreadable and was not restored.');
    }
  };

  const fromOutcome = (outcome: DispatchOutcome, reply: string | null): CommandResult => {
    if (outcome.status === 'ok') {
      const message = outcome.result.message;
      const text = reply ?? message;
      store.setState((state) => ({ ui: { ...state.ui, reply: text } }));
      return { status: 'dispatched', message, reply: text };
    }

    if (outcome.status === 'needs_approval') {
      const pending: PendingApproval = {
        action: outcome.action,
        args: outcome.args,
        risk: outcome.risk,
        correlationId: outcome.correlationId,
      };
      const text = `Approve ${outcome.action} (${outcome.risk})?`;
      store.setState((state) => ({
        ui: { ...state.ui, pendingApproval: pending, reply: text },
      }));
      return { status: 'needs_approval', message: 'Approval required.', reply: text };
    }

    if (outcome.status === 'denied') {
      setNotice('warn', outcome.message);
      store.setState((state) => ({ ui: { ...state.ui, reply: outcome.message } }));
      return { status: 'denied', message: outcome.message, reply: outcome.message };
    }

    setNotice('error', outcome.reason);
    store.setState((state) => ({ ui: { ...state.ui, reply: outcome.reason } }));
    return { status: 'failed', message: outcome.reason, reply: outcome.reason };
  };

  const dispatchAction: App['dispatchAction'] = async (action, args, options = {}) => {
    const outcome = await dispatcher.dispatch({
      action,
      args,
      source: options.source ?? 'user',
      approved: options.approved === true,
    });
    persist();
    return outcome;
  };

  const submitCommand: App['submitCommand'] = async (raw) => {
    const text = raw.trim();
    if (text.length === 0) {
      return { status: 'no_proposal', message: 'Enter a command.', reply: null };
    }

    store.setState((state) => ({ ui: { ...state.ui, busy: true } }));
    const inputId = newId('input');
    publish({ type: 'intent.received', payload: { inputId, text } }, { source: 'user' });

    try {
      const workspace = store.getState().workspace;
      const active = workspace.tabs.find((tab) => tab.id === workspace.activeTabId) ?? null;
      const decision = await routeIntent(
        {
          text,
          context: {
            activeRoute: active?.route ?? null,
            tabs: workspace.tabs.map((tab) => tab.route),
            petMode: store.getState().pet.mode,
          },
        },
        {
          providers,
          localOnly: deps.localOnly === true,
          onProviderError: (provider, code) => {
            setNotice('warn', `${provider} unavailable (${code}); trying next provider.`);
          },
        },
      );

      if (!decision.proposal) {
        const reply = decision.reply ?? 'I could not map that to a supported action.';
        publish(
          {
            type: 'intent.rejected',
            payload: { inputId, text, reason: decision.notes.join(',') || 'no_match' },
          },
          { source: 'intelligence' },
        );
        store.setState((state) => ({ ui: { ...state.ui, reply } }));
        return { status: 'no_proposal', message: reply, reply };
      }

      publish(
        {
          type: 'intent.proposed',
          payload: {
            inputId,
            text,
            provider: decision.provider ?? 'rules',
            confidence: decision.confidence,
            action: decision.proposal.action,
          },
        },
        { source: 'intelligence' },
      );

      const outcome = await dispatchAction(decision.proposal.action, decision.proposal.args, {
        source: decision.source === 'cloud' ? 'cloud' : 'local',
      });
      return fromOutcome(outcome, decision.reply);
    } finally {
      store.setState((state) => ({ ui: { ...state.ui, busy: false } }));
    }
  };

  const approve: App['approve'] = async () => {
    const pending = store.getState().ui.pendingApproval;
    if (!pending) return null;
    store.setState((state) => ({ ui: { ...state.ui, pendingApproval: null } }));
    const outcome = await dispatchAction(pending.action, pending.args, {
      source: 'user',
      approved: true,
    });
    return fromOutcome(outcome, null);
  };

  const deny: App['deny'] = () => {
    if (!store.getState().ui.pendingApproval) return null;
    store.setState((state) => ({
      ui: { ...state.ui, pendingApproval: null, reply: 'Cancelled.' },
    }));
    setNotice('info', 'Action cancelled.');
    return { status: 'denied', message: 'Action cancelled.', reply: 'Cancelled.' };
  };

  const runFrameCommand: App['runFrameCommand'] = async (action, args) => {
    // An iframe is never trusted to authorize an action: use the local policy.
    const outcome = await dispatchAction(action, args, { source: 'local' });
    if (outcome.status === 'ok') return { ok: true, message: outcome.result.message };
    if (outcome.status === 'needs_approval') {
      store.setState((state) => ({
        ui: {
          ...state.ui,
          pendingApproval: {
            action: outcome.action,
            args: outcome.args,
            risk: outcome.risk,
            correlationId: outcome.correlationId,
          },
          reply: `Approve ${outcome.action} (${outcome.risk})?`,
        },
      }));
      return { ok: false, message: 'approval_required' };
    }
    if (outcome.status === 'denied') return { ok: false, message: outcome.message };
    return { ok: false, message: outcome.reason };
  };

  const snapshot: App['snapshot'] = () => {
    const { workspace, pet: petState, tasks, ui } = store.getState();
    const active = workspace.tabs.find((tab) => tab.id === workspace.activeTabId) ?? null;
    return {
      protocolVersion: 1,
      activeRoute: active?.route ?? null,
      tabs: workspace.tabs.map((tab) => ({
        id: tab.id,
        route: tab.route,
        title: tab.title,
        active: tab.id === workspace.activeTabId,
        windowState: tab.windowState,
      })),
      pet: {
        mode: petState.mode,
        activity: petState.activity,
        emotion: petState.emotion,
      },
      tasks: tasks.slice(0, 50),
      aiStatus: ui.aiStatus,
    };
  };

  const health: App['health'] = async () => {
    const doFetch = deps.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
    if (!doFetch) return;

    const previous = store.getState().ui.aiStatus;
    const apply = (next: AiStatus, detail: string): void => {
      store.setState((state) => ({ ui: { ...state.ui, aiStatus: next } }));
      if (next === 'offline' && previous !== 'offline') {
        publish(
          {
            type: 'intelligence.status',
            payload: { status: 'offline', provider: 'server', detail },
          },
          { source: 'intelligence' },
        );
      }
    };

    try {
      const headers = getApiHeaders();
      const response = await doFetch(`${baseUrl}/api/health`, { headers });
      if (!response.ok) throw new Error(`status_${response.status}`);
      const body = (await response.json()) as {
        inference?: {
          local?: { configured?: boolean };
          cloud?: { configured?: boolean };
        };
      };
      const configured = Boolean(
        body.inference?.local?.configured || body.inference?.cloud?.configured,
      );
      apply(
        configured ? 'online' : 'offline',
        configured ? 'Inference configured.' : 'Server is up but no model is configured.',
      );
    } catch (error) {
      apply('offline', error instanceof Error ? error.message : 'server_unreachable');
    }
  };

  return {
    store,
    bus,
    agents,
    persistence,
    dispatcher,
    publish,
    dispatchAction,
    submitCommand,
    approve,
    deny,
    runFrameCommand,
    snapshot,
    setNotice,
    clearNotice: () => {
      store.setState((state) => ({ ui: { ...state.ui, notice: null } }));
    },
    setCommandOpen: (open: boolean) => {
      store.setState((state) => ({ ui: { ...state.ui, commandOpen: open } }));
    },
    health,
    flushPersistence: persist,
    ping: () => ws.ping(),
    ws,

    async start() {
      if (started) return;
      restoreAtStartup();
      started = true;

      if (store.getState().workspace.tabs.length === 0) {
        await dispatchAction('open_tab', { route: '/workspace/usage' }, { source: 'user' });
      }

      if (tickMs > 0) {
        timer = setInterval(() => {
          publishAll(pet.tick(now()), { source: 'pet' });
        }, tickMs);
      }

      ws.start();

      if (checkHealth) void health();
    },

    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      ws.stop();
    },
  };
}

export type { PendingApproval };
