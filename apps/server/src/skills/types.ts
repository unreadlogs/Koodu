export const SKILL_CATEGORIES = ['Research', 'Development', 'Organization', 'Custom'] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

/** Persisted skill record; mirrors the `skills` SQLite table. */
export interface SkillRecord {
  id: string;
  name: string;
  description: string;
  category: SkillCategory;
  instructions: string;
  enabled: boolean;
  source: string;
  updatedAt: number;
}

/** Compact shape used in prompts and tool output. */
export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  category: SkillCategory;
}

export interface SkillSelection extends SkillSummary {
  score: number;
}
