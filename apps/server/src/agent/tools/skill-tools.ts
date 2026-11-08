import { z } from 'zod';
import type { ToolDefinition } from './types';

export const skillTools: ToolDefinition[] = [
  {
    name: 'list_skills',
    description: 'List enabled skills (reusable instruction packs) with their ids, categories, and short descriptions.',
    risk: 'safe',
    parameters: {},
    schema: z.object({}).strict(),
    async execute(_args, context) {
      const skills = context.skills.listEnabled();
      if (!skills.length) return 'No enabled skills are available.';
      return skills
        .map((skill) => `- ${skill.id} · ${skill.name} [${skill.category}] — ${skill.description}`)
        .join('\n');
    },
  },
  {
    name: 'read_skill',
    description: 'Read the full instructions for one enabled skill before following it.',
    risk: 'safe',
    parameters: {
      name: 'string — skill id or exact skill name (required)',
    },
    schema: z.object({ name: z.string().trim().min(1).max(120) }).strict(),
    async execute(args, context) {
      const skill = context.skills.resolve(String(args.name));
      if (!skill) return `No skill matches "${String(args.name)}". Use list_skills to see available skills.`;
      if (!skill.enabled) return `Skill "${skill.name}" is disabled. Enable it in the Skills page before using it.`;
      return `# ${skill.name} (${skill.category})\n${skill.description}\n\n${skill.instructions}`;
    },
  },
];
