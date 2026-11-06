import { z } from 'zod';

export const WORKSPACE_ROUTES = [
  '/workspace/usage',
  '/workspace/models',
  '/workspace/agents',
  '/workspace/memory',
  '/workspace/settings',
] as const;

export const workspaceRouteSchema = z.enum(WORKSPACE_ROUTES);
export type WorkspaceRoute = (typeof WORKSPACE_ROUTES)[number];

export interface WorkspaceRouteMeta {
  title: string;
  hint: string;
}

export const WORKSPACE_ROUTE_META: Record<WorkspaceRoute, WorkspaceRouteMeta> = {
  '/workspace/usage': { title: 'Usage', hint: 'Tokens, latency and cost' },
  '/workspace/models': { title: 'Models', hint: 'Inference providers and models' },
  '/workspace/agents': { title: 'Agents', hint: 'Tasks and sub-agents' },
  '/workspace/memory': { title: 'Memory', hint: 'Persistent context' },
  '/workspace/settings': { title: 'Settings', hint: 'Workspace and pet options' },
};

export function isWorkspaceRoute(value: string): value is WorkspaceRoute {
  return (WORKSPACE_ROUTES as readonly string[]).includes(value);
}

/**
 * Accepts `/workspace/usage`, `workspace/usage`, `/workspace/usage/`, `usage`, `USAGE?x=1`.
 * Anything else resolves to null so callers never invent routes.
 */
export function normalizeRoute(input: string): WorkspaceRoute | null {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
  if (cleaned.length === 0) return null;
  // Reject schemes, hostnames and multi-segment prose; only app routes pass.
  if (/^[a-z][a-z0-9+.-]*:/.test(cleaned)) return null;
  if (/\s/.test(cleaned)) return null;

  const absolute = cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
  const segments = absolute.split('/').filter(Boolean);
  if (segments.length === 0 || segments.length > 2) return null;

  for (const route of WORKSPACE_ROUTES) {
    if (route === absolute) return route;
  }

  const slug = segments[segments.length - 1];
  if (!slug) return null;
  for (const route of WORKSPACE_ROUTES) {
    if (route.endsWith(`/${slug}`)) return route;
  }
  return null;
}
