import { useStore } from 'zustand';
import { sortedTabs } from '../engines/workspace';
import type { App } from '../app/createApp';
import type { FrameBridge } from '../app/frameBridge';

/**
 * Every tab keeps its iframe mounted; inactive tabs are hidden with CSS so
 * in-memory page state survives tab switching.
 */
export function WorkspaceHost({ app, bridge }: { app: App; bridge: FrameBridge }) {
  const workspace = useStore(app.store, (state) => state.workspace);
  const tabs = sortedTabs(workspace);

  if (tabs.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-950 p-8">
        <div className="max-w-md rounded-xl border border-white/10 bg-slate-900/60 p-6 text-center">
          <p className="text-sm font-medium text-slate-200">Workspace is empty</p>
          <p className="mt-1 text-xs text-slate-400">
            Try the command bar: <span className="text-emerald-300">Open Usage</span>, then{' '}
            <span className="text-emerald-300">Open Models</span>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-0 flex-1 bg-slate-950">
      {tabs.map((tab) => {
        const visible = tab.id === workspace.activeTabId && tab.windowState !== 'minimized';
        return (
          <div
            key={tab.id}
            className={
              visible
                ? tab.windowState === 'maximized'
                  ? 'absolute inset-0 z-10'
                  : 'absolute inset-0'
                : 'hidden'
            }
            aria-hidden={!visible}
          >
            <iframe
              ref={(element) => bridge.register(tab.id, element)}
              src={`/?frame=1&route=${encodeURIComponent(tab.route)}`}
              title={`${tab.title} workspace`}
              className="h-full w-full border-0 bg-slate-900"
            />
          </div>
        );
      })}
    </div>
  );
}
