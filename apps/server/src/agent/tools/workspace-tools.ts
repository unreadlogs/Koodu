import { WORKSPACE_ROUTES } from '@koodu/protocol';
import { z } from 'zod';
import type { ToolDefinition } from './types';

export const workspaceTools: ToolDefinition[] = [
  {
    name: 'list_workspace_pages',
    description: 'List the Koodu workspace routes that can be opened in a tab.',
    risk: 'safe',
    parameters: {},
    schema: z.object({}).strict(),
    async execute() {
      return WORKSPACE_ROUTES.map((route) => `- ${route}`).join('\n');
    },
  },
];
