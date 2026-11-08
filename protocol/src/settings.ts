import { z } from 'zod';
import { workspaceRouteSchema } from './routes';
import { petModeSchema } from './state';

/**
 * Server-authoritative workspace preferences.
 *
 * Stored in the server SQLite `app_settings` table under `workspaceSettingsKey`
 * as versioned JSON. The browser may keep a validated write-through cache for
 * instant startup, but the server value always wins on `settings.get`.
 */
export const companionSchema = z.enum(['kumo', 'kitsu']);
export type CompanionId = z.infer<typeof companionSchema>;

export const workspaceSettingsSchema = z
  .object({
    character: companionSchema,
    animateCompanion: z.boolean(),
    showCommandHint: z.boolean(),
    startupPage: z.union([z.literal('/'), workspaceRouteSchema]),
    petMode: petModeSchema,
  })
  .strict();
export type WorkspaceSettings = z.infer<typeof workspaceSettingsSchema>;

export const defaultWorkspaceSettings: WorkspaceSettings = {
  character: 'kumo',
  animateCompanion: true,
  showCommandHint: true,
  startupPage: '/',
  petMode: 'embedded',
};

export const workspaceSettingsKey = 'settings.preferences.v1' as const;

export const settingsSnapshotSchema = z.object({
  settings: workspaceSettingsSchema,
  updatedAt: z.string().nullable(),
  persistence: z.literal('sqlite'),
});
export type SettingsSnapshot = z.infer<typeof settingsSnapshotSchema>;
