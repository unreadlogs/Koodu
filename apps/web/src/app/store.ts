import type {
  AgentTask,
  AiStatus,
  ActionName,
  AppEvent,
  PetState,
  Risk,
  WorkspaceState,
} from '@koodu/protocol';
import { createStore, type StoreApi } from 'zustand/vanilla';

export interface PendingApproval {
  action: ActionName;
  args: unknown;
  risk: Risk;
  correlationId: string;
}

export interface Notice {
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface WebState {
  workspace: WorkspaceState;
  pet: PetState;
  tasks: AgentTask[];
  /** Recent bus history, newest last. Purely for the dev event log. */
  events: AppEvent[];
  ui: {
    commandOpen: boolean;
    aiStatus: AiStatus;
    notice: Notice | null;
    pendingApproval: PendingApproval | null;
    reply: string | null;
    busy: boolean;
  };
  persistence: {
    status: 'idle' | 'restored' | 'failed';
    detail: string | null;
  };
  ws: {
    status: 'closed' | 'connecting' | 'open' | 'error';
    lastPingMs: number | null;
    lastPongAt: number | null;
  };
}

export const initialWebState: WebState = {
  workspace: { tabs: [], activeTabId: null, layout: 'single', splitTabId: null },
  pet: {
    mode: 'embedded',
    activity: 'idle',
    emotion: 'neutral',
    position: { x: 32, y: 96 },
  },
  tasks: [],
  events: [],
  ui: {
    commandOpen: true,
    aiStatus: 'unknown',
    notice: null,
    pendingApproval: null,
    reply: null,
    busy: false,
  },
  persistence: { status: 'idle', detail: null },
  ws: { status: 'closed', lastPingMs: null, lastPongAt: null },
};

export type AppStore = StoreApi<WebState>;

export function createAppStore(initial: WebState = initialWebState): AppStore {
  return createStore<WebState>()(() => initial);
}
