import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IFRAME_PROTOCOL_VERSION,
  WORKSPACE_ROUTE_META,
  isWorkspaceRoute,
  parentToFrameSchema,
  type ActionName,
  type FrameState,
  type FrameToParentMessage,
  type WorkspaceRoute,
} from '@koodu/protocol';
import { FrameRouter } from './FrameRouter';

const PROTOCOL = IFRAME_PROTOCOL_VERSION;

function initialRoute(): WorkspaceRoute {
  const raw = new URLSearchParams(window.location.search).get('route');
  return raw && isWorkspaceRoute(raw) ? raw : '/workspace/usage';
}

function titleFor(route: WorkspaceRoute): string {
  return `${WORKSPACE_ROUTE_META[route].title} — Koodu`;
}

/**
 * One workspace tab running inside a same-origin iframe. The frame holds no
 * authority: it asks the parent for state and posts command requests, which the
 * middleware validates exactly like any other untrusted proposal.
 */
export function FrameApp() {
  const [route, setRoute] = useState<WorkspaceRoute>(initialRoute);
  const [state, setState] = useState<FrameState | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [pingErr, setPingErr] = useState<string | null>(null);
  const [pinging, setPinging] = useState(false);
  const counter = useRef(0);
  const routeRef = useRef(route);
  routeRef.current = route;
  const pendingPing = useRef<Map<string, { resolve: (ms: number) => void; reject: (e: Error) => void }>>(new Map());

  const post = useCallback((message: FrameToParentMessage): void => {
    window.parent.postMessage(message, window.location.origin);
  }, []);

  const nextId = useCallback((prefix: string): string => {
    counter.current += 1;
    return `${prefix}-${counter.current}`;
  }, []);

  const send = useCallback(
    (action: ActionName, args: unknown): void => {
      setResult(null);
      post({
        v: PROTOCOL,
        type: 'command.request',
        requestId: nextId('cmd'),
        action,
        args,
      });
    },
    [nextId, post],
  );

  const pingViaParent = useCallback(async (): Promise<number> => {
    const id = nextId('ws');
    return new Promise<number>((resolve, reject) => {
      pendingPing.current.set(id, { resolve, reject });
      post({ v: PROTOCOL, type: 'ws.ping', requestId: id });
      setTimeout(() => {
        if (pendingPing.current.has(id)) {
          pendingPing.current.delete(id);
          reject(new Error('ws_timeout'));
        }
      }, 8000);
    });
  }, [nextId, post]);

  const onPing = async () => {
    setPinging(true);
    setPingErr(null);
    try {
      const ms = await pingViaParent();
      setPingMs(ms);
    } catch (err) {
      setPingErr(err instanceof Error ? err.message : 'ws_ping_failed');
    } finally {
      setPinging(false);
    }
  };

  useEffect(() => {
    const handler = (event: MessageEvent): void => {
      // Same-origin only; anything else is ignored rather than logged.
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      const parsed = parentToFrameSchema.safeParse(event.data);
      if (!parsed.success) return;

      const message = parsed.data;
      switch (message.type) {
        case 'state.push':
          setState(message.state);
          break;

        case 'navigate':
          if (message.route !== routeRef.current) {
            routeRef.current = message.route;
            setRoute(message.route);
            const url = new URL(window.location.href);
            url.searchParams.set('route', message.route);
            window.history.replaceState(null, '', url);
            document.title = titleFor(message.route);
            post({ v: PROTOCOL, type: 'navigated', route: message.route });
          }
          break;

        case 'ping':
          post({ v: PROTOCOL, type: 'pong', requestId: message.requestId });
          break;

        case 'command.result':
          setResult({ ok: message.ok, message: message.message });
          if (!message.ok) {
            const fresh = nextId('state');
            post({ v: PROTOCOL, type: 'state.request', requestId: fresh });
          }
          break;

        case 'ws.pong':
          {
            const p = pendingPing.current.get(message.requestId);
            if (p) {
              pendingPing.current.delete(message.requestId);
              p.resolve(message.ms);
            }
          }
          break;

        case 'ws.error':
          {
            const id = message.requestId;
            const p = id ? pendingPing.current.get(id) : undefined;
            if (p) {
              pendingPing.current.delete(id as string);
              p.reject(new Error(message.message));
            } else {
              setPingErr(message.message);
            }
          }
          break;
      }
    };

    window.addEventListener('message', handler);
    document.title = titleFor(routeRef.current);
    post({
      v: PROTOCOL,
      type: 'ready',
      route: routeRef.current,
      title: WORKSPACE_ROUTE_META[routeRef.current].title,
    });
    post({ v: PROTOCOL, type: 'state.request', requestId: nextId('state') });

    return () => window.removeEventListener('message', handler);
  }, [nextId, post]);

  const meta = WORKSPACE_ROUTE_META[route];
  const activeTab = state?.tabs.find((tab) => tab.active) ?? null;

  return (
    <div className="flex h-full flex-col bg-slate-950">
      <header className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-slate-900/70 px-3 py-2">
        <div>
          <p className="text-sm font-semibold leading-4 text-slate-100">{meta.title}</p>
          <p className="text-[10px] uppercase tracking-widest text-slate-500">{meta.hint}</p>
        </div>

        <button
          type="button"
          onClick={() => void onPing()}
          disabled={pinging}
          className="ml-auto rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-slate-300 hover:bg-white/10 disabled:opacity-60"
          title="Ping server via parent's main WebSocket"
        >
          {pinging ? 'ping…' : pingMs !== null ? `ping ${pingMs}ms` : 'ping'}
        </button>

        <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-widest text-slate-400">
          {state ? 'synced' : 'waiting for state'}
        </span>
        {activeTab && (
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-200 ring-1 ring-emerald-400/30">
            active: {activeTab.title}
          </span>
        )}
        {state && (
          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-slate-300">
            pet {state.pet.activity}/{state.pet.emotion}
          </span>
        )}
        {pingErr && (
          <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] text-rose-200 ring-1 ring-rose-400/30">
            {pingErr}
          </span>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-4">
        <FrameRouter route={route} state={state} send={send} />

        {result && (
          <p
            role="status"
            className={`mt-3 rounded-lg border px-2.5 py-1.5 text-xs ${
              result.ok
                ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'
                : 'border-amber-400/30 bg-amber-500/10 text-amber-100'
            }`}
          >
            {result.ok ? '✓' : '!'} {result.message}
          </p>
        )}
      </div>

      <footer className="border-t border-white/10 px-3 py-1.5 text-[10px] text-slate-600">
        Requests go to the parent middleware · protocol v{PROTOCOL} · WS ping via parent socket
      </footer>
    </div>
  );
}
