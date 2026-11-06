import { useStore } from 'zustand';
import { WORKSPACE_ROUTES, WORKSPACE_ROUTE_META } from '@koodu/protocol';
import { sortedTabs } from '../engines/workspace';
import type { App } from '../app/createApp';

export function TabStrip({ app }: { app: App }) {
  const workspace = useStore(app.store, (state) => state.workspace);
  const tabs = sortedTabs(workspace);
  const active = workspace.tabs.find((tab) => tab.id === workspace.activeTabId) ?? null;

  const run = (action: string, args: unknown): void => {
    void app.dispatchAction(action, args, { source: 'user' });
  };

  return (
    <div className="border-b border-white/10 bg-slate-900/70">
      <div className="flex items-center gap-1 overflow-x-auto px-2 py-1.5">
        {tabs.length === 0 && (
          <span className="px-2 py-1 text-xs text-slate-400">No tabs — open a route below.</span>
        )}

        {tabs.map((tab) => {
          const isActive = tab.id === workspace.activeTabId;
          return (
            <div
              key={tab.id}
              className={`flex shrink-0 items-center rounded-md border text-sm transition ${
                isActive
                  ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100'
                  : 'border-transparent bg-white/5 text-slate-300 hover:bg-white/10'
              }`}
            >
              <button
                type="button"
                onClick={() => run('open_tab', { route: tab.route })}
                className="flex items-center gap-2 px-2 py-1"
                title={tab.route}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    tab.windowState === 'minimized'
                      ? 'bg-amber-400'
                      : isActive
                        ? 'bg-emerald-400'
                        : 'bg-slate-500'
                  }`}
                />
                <span className="max-w-32 truncate">{tab.title}</span>
                {tab.windowState === 'maximized' && (
                  <span className="rounded bg-white/10 px-1 text-[10px] uppercase">max</span>
                )}
                {tab.windowState === 'minimized' && (
                  <span className="rounded bg-white/10 px-1 text-[10px] uppercase">min</span>
                )}
              </button>
              <button
                type="button"
                onClick={() => run('minimize_window', { tabId: tab.id })}
                className="px-1.5 py-1 text-slate-400 hover:text-slate-100"
                title="Minimize tab"
                aria-label={`Minimize ${tab.title}`}
              >
                −
              </button>
              <button
                type="button"
                onClick={() => run('close_tab', { tabId: tab.id })}
                className="px-1.5 py-1 text-slate-400 hover:text-rose-300"
                title="Close tab"
                aria-label={`Close ${tab.title}`}
              >
                ×
              </button>
            </div>
          );
        })}

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {active && (
            <>
              <button
                type="button"
                onClick={() => run('maximize_window', { tabId: active.id })}
                className="rounded bg-white/5 px-2 py-1 text-xs text-slate-300 hover:bg-white/10"
              >
                {active.windowState === 'maximized' ? 'Restore' : 'Maximize'}
              </button>
              <button
                type="button"
                onClick={() => run('restore_workspace', {})}
                className="rounded bg-white/5 px-2 py-1 text-xs text-slate-300 hover:bg-white/10"
                title="Reload the last persisted workspace"
              >
                Restore saved
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 overflow-x-auto px-2 pb-1.5">
        {WORKSPACE_ROUTES.map((route) => (
          <button
            key={route}
            type="button"
            onClick={() => run('open_tab', { route })}
            className="shrink-0 rounded px-2 py-0.5 text-xs text-slate-400 hover:bg-white/5 hover:text-slate-100"
            title={WORKSPACE_ROUTE_META[route].hint}
          >
            + {WORKSPACE_ROUTE_META[route].title}
          </button>
        ))}
      </div>
    </div>
  );
}
