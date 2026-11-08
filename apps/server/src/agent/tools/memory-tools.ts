import { z } from 'zod';
import type { ToolDefinition } from './types';

export const memoryTools: ToolDefinition[] = [
  {
    name: 'search_memory',
    description: 'Search the user’s saved long-term memories for relevant preferences, facts, or tasks.',
    risk: 'safe',
    parameters: {
      query: 'string — natural-language search text (required, max 350 chars)',
      topK: 'number — optional result count, 1-8 (default 4)',
    },
    schema: z
      .object({
        query: z.string().trim().min(1).max(350),
        topK: z.number().int().min(1).max(8).optional(),
      })
      .strict(),
    async execute(args, context) {
      const query = String(args.query);
      const topK = typeof args.topK === 'number' ? args.topK : 4;
      return context.memory.search_memory(query, { topK, threshold: 0.15 });
    },
  },
  {
    name: 'save_memory',
    description: 'Save one durable user preference, fact, or task. Only use when the user explicitly asks to remember something or states a lasting preference.',
    risk: 'confirm',
    parameters: {
      content: 'string — one atomic statement to remember (required, max 350 chars)',
      category: 'string — preference | fact | task (default fact)',
    },
    schema: z
      .object({
        content: z.string().trim().min(3).max(350),
        category: z.enum(['preference', 'fact', 'task']).optional(),
      })
      .strict(),
    async execute(args, context) {
      const id = await context.memory.save_memory(
        String(args.content),
        (args.category as 'preference' | 'fact' | 'task' | undefined) ?? 'fact',
      );
      return `Saved memory #${id}: ${String(args.content)}`;
    },
  },
];
