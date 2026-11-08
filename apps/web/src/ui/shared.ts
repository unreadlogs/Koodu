import type { AgentType, WorkspaceRoute } from '@koodu/protocol';
import type { IconSvgElement } from '@hugeicons/react';
import {
  AiSecurity02Icon, CpuIcon, DashboardSpeed01Icon, FileSearchIcon,
  Layers01Icon, Message01Icon, PuzzleIcon, Settings01Icon,
} from '@hugeicons/core-free-icons';
import { defaultWorkspaceSettings, workspaceSettingsSchema, type WorkspaceSettings } from '@koodu/protocol';

export type PetActivity = 'idle' | 'listening' | 'thinking' | 'working' | 'talking' | 'happy' | 'confused' | 'error' | 'sleeping';

export type Animation = { file: string; frameCount: number; frameWidth: number; frameHeight: number; fps: number; loop: boolean };

export const fallbackIdleAnimation: Animation = { file: 'idle.png', frameCount: 6, frameWidth: 512, frameHeight: 512, fps: 8, loop: true };

export type StartupPage = '/' | WorkspaceRoute;

export type AppPreferences = Pick<WorkspaceSettings, 'animateCompanion' | 'showCommandHint' | 'startupPage'>;

export const PREFERENCES_KEY = 'koodu:settings:v1';
export const COMPANION_KEY = 'koodu:companion';

export function readCachedSettings(): WorkspaceSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? 'null') as Partial<WorkspaceSettings> | null;
    const candidate = stored?.startupPage;
    const startupPage: StartupPage = candidate === '/' || (typeof candidate === 'string' && candidate.startsWith('/workspace/')) ? (candidate as StartupPage) : '/';
    const cachedCharacter = stored?.character ?? localStorage.getItem(COMPANION_KEY);
    return {
      character: cachedCharacter === 'kitsu' || cachedCharacter === 'kumo' ? cachedCharacter : defaultWorkspaceSettings.character,
      animateCompanion: typeof stored?.animateCompanion === 'boolean' ? stored.animateCompanion : defaultWorkspaceSettings.animateCompanion,
      showCommandHint: typeof stored?.showCommandHint === 'boolean' ? stored.showCommandHint : defaultWorkspaceSettings.showCommandHint,
      startupPage,
      petMode: stored?.petMode === 'floating' || stored?.petMode === 'hidden' || stored?.petMode === 'embedded' ? stored.petMode : defaultWorkspaceSettings.petMode,
    };
  } catch { return defaultWorkspaceSettings; }
}

export function writeCachedSettings(settings: WorkspaceSettings) {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ animateCompanion: settings.animateCompanion, showCommandHint: settings.showCommandHint, startupPage: settings.startupPage, petMode: settings.petMode }));
    localStorage.setItem(COMPANION_KEY, settings.character);
  } catch { /* Cache is best-effort; the server copy remains authoritative. */ }
}

export type ModelProvider = 'openai' | 'openrouter' | 'google' | 'custom';

export type ModelProfile = { id: string; name: string; provider: ModelProvider; model: string; baseUrl: string; role: 'local' | 'cloud'; maxOutputTokens: number; monthlyTokenLimit: number; enabled: boolean; active: boolean; apiKeySet: boolean };

export type RoutePage = { route: WorkspaceRoute; label: string; icon: IconSvgElement; subtitle: string };

export const pages: RoutePage[] = [
  { route: '/workspace/chats', label: 'Chats', icon: Message01Icon, subtitle: 'Continue a conversation with your companion.' },
  { route: '/workspace/usage', label: 'Usage', icon: DashboardSpeed01Icon, subtitle: 'A clear view of your activity and resource use.' },
  { route: '/workspace/models', label: 'Models', icon: CpuIcon, subtitle: 'Manage the intelligence behind your companion.' },
  { route: '/workspace/agents', label: 'Agents', icon: AiSecurity02Icon, subtitle: 'Meet the agents working alongside Koodu.' },
  { route: '/workspace/memory', label: 'Memory', icon: Layers01Icon, subtitle: 'Review the context your companion remembers.' },
  { route: '/workspace/logs', label: 'Logs', icon: FileSearchIcon, subtitle: 'Inspect workspace events and connection diagnostics.' },
  { route: '/workspace/skills', label: 'Skills', icon: PuzzleIcon, subtitle: 'Manage reusable instructions for your agents.' },
  { route: '/workspace/settings', label: 'Settings', icon: Settings01Icon, subtitle: 'Manage your companion and workspace preferences.' },
];

export function pageFromPath(path: string) { return pages.find((page) => page.route === path); }

export type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string; createdAt: string };

export type ChatConversation = { id: string; title: string; createdAt: string; updatedAt: string; messageCount: number };

export type AgentTaskStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export type AgentObservation = { tool: string; args: Record<string, unknown>; result: string; ok: boolean; at: string };

export type AgentTask = {
  id: string;
  agentType: AgentType;
  task: string;
  status: AgentTaskStatus;
  progress: number;
  result: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  steps: number;
  toolCalls: number;
  parentTaskId: string | null;
  checkpoint: { iteration: number; toolCalls: number; observations: AgentObservation[]; context?: Record<string, unknown> } | null;
};

export type AgentRunResult = {
  taskId: string;
  status: 'completed' | 'paused';
  reply: string;
  proposal: { action: string; args: unknown } | null;
  provider: string;
  iterations: number;
  toolCalls: number;
};

export type AgentTaskEvent = { id: number; taskId: string; occurredAt: string; type: string; payload: Record<string, unknown> };

export type LogEntry = { id: string; at: number; level: 'info' | 'success' | 'warning' | 'error'; source: string; message: string; detail: string | null };

export type SettingsStatus = 'loading' | 'ready' | 'saving' | 'error';

export type SettingsControls = { meta: { updatedAt: string | null; persistence: string }; status: SettingsStatus; error: string; notice: string; onRefresh: () => void; onReset: () => void; onExport: () => void; onImport: (file: File) => void };

export type SkillCategory = 'Research' | 'Development' | 'Organization' | 'Custom';
export type SkillRecord = { id: string; name: string; description: string; category: SkillCategory; instructions: string; enabled: boolean; source: string; updatedAt: number };

export type MemoryNote = { id: string; content: string; category: 'preference' | 'fact' | 'task'; updatedAt: number };

export type UsageRange = '24H' | '7D' | '30D';

export type RpcLogEntry = { id: string; at: number; level: 'info' | 'success' | 'warning' | 'error'; source: string; message: string; detail: string | null };

export { defaultWorkspaceSettings, workspaceSettingsSchema };
export type { IconSvgElement };
export type { WorkspaceSettings };
