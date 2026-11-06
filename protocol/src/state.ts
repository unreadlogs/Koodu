import { z } from 'zod';
import { agentTaskSchema } from './agents';
import { workspaceRouteSchema } from './routes';

export const MAX_TABS = 8;

export const petActivitySchema = z.enum([
  'idle',
  'listening',
  'thinking',
  'working',
  'talking',
  'sleeping',
]);
export type PetActivity = z.infer<typeof petActivitySchema>;

export const petEmotionSchema = z.enum(['neutral', 'happy', 'curious', 'confused', 'error']);
export type PetEmotion = z.infer<typeof petEmotionSchema>;

export const petModeSchema = z.enum(['embedded', 'floating', 'hidden']);
export type PetMode = z.infer<typeof petModeSchema>;

export const petPositionSchema = z.object({ x: z.number(), y: z.number() });
export type PetPosition = z.infer<typeof petPositionSchema>;

export const petStateSchema = z.object({
  mode: petModeSchema,
  activity: petActivitySchema,
  emotion: petEmotionSchema,
  position: petPositionSchema,
});
export type PetState = z.infer<typeof petStateSchema>;

/**
 * Window state is a single enum on purpose: a tab cannot be minimized *and*
 * maximized, and `active` is derived from `activeTabId` instead of duplicated.
 */
export const tabWindowStateSchema = z.enum(['normal', 'minimized', 'maximized']);
export type TabWindowState = z.infer<typeof tabWindowStateSchema>;

export const workspaceTabSchema = z.object({
  id: z.string().min(1),
  route: workspaceRouteSchema,
  title: z.string().min(1).max(60),
  windowState: tabWindowStateSchema,
  pinned: z.boolean(),
  /** Reserved for split view; null means the tab stands alone. */
  groupId: z.string().nullable(),
  order: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
});
export type WorkspaceTab = z.infer<typeof workspaceTabSchema>;

export const workspaceLayoutSchema = z.enum(['single', 'split']);
export type WorkspaceLayout = z.infer<typeof workspaceLayoutSchema>;

export const workspaceStateSchema = z.object({
  tabs: z.array(workspaceTabSchema).max(MAX_TABS),
  activeTabId: z.string().nullable(),
  layout: workspaceLayoutSchema,
  splitTabId: z.string().nullable(),
});
export type WorkspaceState = z.infer<typeof workspaceStateSchema>;

export const aiStatusSchema = z.enum(['unknown', 'online', 'offline']);
export type AiStatus = z.infer<typeof aiStatusSchema>;

export const appStateSchema = z.object({
  workspace: workspaceStateSchema,
  pet: petStateSchema,
  agents: z.object({ tasks: z.array(agentTaskSchema) }),
  ui: z.object({
    commandOpen: z.boolean(),
    aiStatus: aiStatusSchema,
    notice: z.string().nullable(),
  }),
  persistence: z.object({
    status: z.enum(['idle', 'restored', 'failed']),
    revision: z.number().int().nonnegative(),
    detail: z.string().nullable(),
  }),
});
export type AppState = z.infer<typeof appStateSchema>;

export const initialAppState: AppState = {
  workspace: { tabs: [], activeTabId: null, layout: 'single', splitTabId: null },
  pet: {
    mode: 'embedded',
    activity: 'idle',
    emotion: 'neutral',
    position: { x: 24, y: 24 },
  },
  agents: { tasks: [] },
  ui: { commandOpen: false, aiStatus: 'unknown', notice: null },
  persistence: { status: 'idle', revision: 0, detail: null },
};
