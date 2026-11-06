import type { ActionName, FrameState, WorkspaceRoute } from '@koodu/protocol';
import { AgentsPage } from '../pages/AgentsPage';
import { MemoryPage } from '../pages/MemoryPage';
import { ModelsPage } from '../pages/ModelsPage';
import { SettingsPage } from '../pages/SettingsPage';
import { UsagePage } from '../pages/UsagePage';

export interface FramePageProps {
  state: FrameState | null;
  send: (action: ActionName, args: unknown) => void;
}

/** Route table for the workspace iframe. Unknown routes never reach this point. */
export function FrameRouter({ route, state, send }: FramePageProps & { route: WorkspaceRoute }) {
  switch (route) {
    case '/workspace/usage':
      return <UsagePage state={state} send={send} />;
    case '/workspace/models':
      return <ModelsPage state={state} send={send} />;
    case '/workspace/agents':
      return <AgentsPage state={state} send={send} />;
    case '/workspace/memory':
      return <MemoryPage state={state} send={send} />;
    case '/workspace/settings':
      return <SettingsPage state={state} send={send} />;
  }
}
