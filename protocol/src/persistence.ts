import { z } from 'zod';
import {
  MAX_TABS,
  petModeSchema,
  petPositionSchema,
  workspaceLayoutSchema,
  workspaceTabSchema,
} from './state';

export const STORAGE_KEY = 'agent-harness:workspace:v1';
export const SNAPSHOT_VERSION = 1 as const;

export const workspaceSnapshotSchema = z.object({
  version: z.literal(SNAPSHOT_VERSION),
  revision: z.number().int().nonnegative(),
  savedAt: z.number().int().nonnegative(),
  tabs: z.array(workspaceTabSchema).max(MAX_TABS),
  activeTabId: z.string().nullable(),
  layout: workspaceLayoutSchema,
  splitTabId: z.string().nullable(),
  pet: z.object({
    mode: petModeSchema,
    position: petPositionSchema,
  }),
});
export type WorkspaceSnapshot = z.infer<typeof workspaceSnapshotSchema>;

export interface DecodeResult {
  ok: boolean;
  snapshot: WorkspaceSnapshot | null;
  warnings: string[];
  reason?: string;
}
