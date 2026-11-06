import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import type { PetMode } from '@koodu/protocol';
import type { App } from '../app/createApp';
import type { FrameBridge } from '../app/frameBridge';
import { ApprovalDialog } from './ApprovalDialog';
import { CommandBar } from './CommandBar';
import { EventLog } from './EventLog';
import { FloatingPet } from './FloatingPet';
import { Notice } from './Notice';
import { PetDock } from './PetDock';
import { PetStage } from './PetStage';
import { TabStrip } from './TabStrip';
import { WorkspaceHost } from './WorkspaceHost';
import { logout } from '../app/auth';

const MODE_ORDER: PetMode[] = ['embedded', 'floating', 'hidden'];

const AI_STYLES = {
  online: 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/30',
  offline: 'bg-rose-500/15 text-rose-200 ring-rose-400/30',
  unknown: 'bg-slate-500/15 text-slate-300 ring-slate-400/30',
} as const;

const WS_COLOR: Record<string, string> = {
  open: 'bg-emerald-400',
  connecting: 'bg-amber-400',
  closed: 'bg-slate-500',
  error: 'bg-rose-400',
};

export function AppShell({ app, bridge }: { app: App; bridge: FrameBridge }) {
  const aiStatus = useStore(app.store, (state) => state.ui.aiStatus);
  const petMode = useStore(app.store, (state) => state.pet.mode);
  const persistence = useStore(app.store, (state) => state.persistence);
  const ws = useStore(app.store, (state) => state.ws);
  const activeTab = useStore(app.store, (s) => s.workspace.tabs.find((t) => t.id === s.workspace.activeTabId) ?? null);
  const [pinging, setPinging] = useState(false);
  const [pingError, setPingError] = useState<string | null>(null);

  const nextMode =
    MODE_ORDER[(MODE_ORDER.indexOf(petMode) + 1) % MODE_ORDER.length] ?? 'embedded';

  const onPing = async () => {
    setPinging(true);
    setPingError(null);
    try {
      const res = await app.ping();
      app.store.setState((state) => ({
        ws: { ...state.ws, lastPingMs: res.ms, lastPongAt: res.serverAt },
      }));
    } catch (err) {
      setPingError(err instanceof Error ? err.message : 'ping_failed');
    } finally {
      setPinging(false);
    }
  };

  useEffect(() => {
    if (!pingError) return;
    const t = setTimeout(() => setPingError(null), 3000);
    return () => clearTimeout(t);
  }, [pingError]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center gap-3 border-b border-white/10 bg-slate-900/80 px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-500 text-sm font-bold text-slate-950">
            K
          </div>
          <div>
            <p className="text-sm font-semibold leading-4">Koodu</p>
            <p className="text-[10px] uppercase tracking-widest text-slate-500">
              Agent operating environment
            </p>
          </div>
        </div>

        <span className="hidden rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-slate-400 sm:inline">
          prototype
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          {/* WS + ping */}
          <button
            type="button"
            onClick={() => void onPing()}
            disabled={pinging}
            className="flex items-center gap-1.5 rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-white/10 disabled:opacity-60"
            title={`WebSocket: ${ws.status}. Click to ping server.`}
          >
            <span className={`inline-block h-2 w-2 rounded-full ${WS_COLOR[ws.status] ?? 'bg-slate-500'}`} />
            <span>ws {ws.status}</span>
            {ws.lastPingMs !== null && <span className="text-slate-400">{ws.lastPingMs}ms</span>}
            {pinging ? '…' : 'ping'}
          </button>

          <button
            type="button"
            onClick={() => void app.health()}
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${AI_STYLES[aiStatus]}`}
            title="Re-check the server and inference providers"
          >
            AI {aiStatus}
          </button>

          <span
            className="hidden rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-slate-300 sm:inline"
            title={
              persistence.detail ??
              'Workspace and pet mode are persisted to localStorage after each change.'
            }
          >
            {persistence.status === 'failed'
              ? 'save failed'
              : persistence.status === 'restored'
                ? 'restored'
                : 'local'}
          </span>

          <button
            type="button"
            onClick={() =>
              void app.dispatchAction('switch_pet_mode', { mode: nextMode }, { source: 'user' })
            }
            className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-white/10"
            title="Cycle embedded → floating → hidden"
          >
            pet: {petMode}
          </button>

          <button
            type="button"
            onClick={() => void logout().then(() => window.location.assign('/session/auth'))}
            className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-rose-500/20 hover:text-rose-200"
            title="Log out and clear auth token"
          >
            logout
          </button>
        </div>
      </header>

      {pingError && (
        <div className="bg-rose-500/10 px-4 py-1 text-xs text-rose-200">{pingError}</div>
      )}

      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          <TabStrip app={app} />

          {/* Center stage: pet companion with sprite renderer + sample action testing.
              Visible on the homepage centre; when a tab is active, workspace takes full height. */}
          {!activeTab && (
            <div className="flex flex-1 items-center justify-center overflow-y-auto p-4">
              <PetStage app={app} />
            </div>
          )}

          <WorkspaceHost app={app} bridge={bridge} />
          <CommandBar app={app} />
        </main>
        <PetDock app={app} />
      </div>

      <EventLog app={app} />
      <FloatingPet app={app} />
      <ApprovalDialog app={app} />
      <Notice app={app} />
    </div>
  );
}
