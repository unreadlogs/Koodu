import type Database from 'better-sqlite3';
import { SKILL_CATEGORIES, type SkillCategory, type SkillRecord, type SkillSelection, type SkillSummary } from './types';

const STARTER_SEED_KEY = 'skills.starter-seeded.v1';

/** Instructions shipped with a fresh Koodu install. */
export const STARTER_SKILLS: ReadonlyArray<Omit<SkillRecord, 'updatedAt'>> = [
  {
    id: 'starter-research-brief',
    name: 'Research brief',
    description: 'Turn a question into a concise, sourced research outline.',
    category: 'Research',
    instructions:
      'Clarify the question and scope. Gather evidence from reliable sources. Separate verified facts from interpretation, cite sources, and finish with a short summary and open questions.',
    enabled: true,
    source: 'Koodu starter',
  },
  {
    id: 'starter-code-review',
    name: 'Code review',
    description: 'Review a change for correctness, risk, and maintainability.',
    category: 'Development',
    instructions:
      'Inspect the changed code and its surrounding context. Prioritize concrete bugs and regressions, include file and line references, explain impact, and avoid speculative style feedback.',
    enabled: true,
    source: 'Koodu starter',
  },
  {
    id: 'starter-task-plan',
    name: 'Task planner',
    description: 'Break a larger request into clear, verifiable steps.',
    category: 'Organization',
    instructions:
      'Restate the desired outcome, identify dependencies, split the work into small ordered steps, call out unresolved decisions, and define how completion can be verified.',
    enabled: true,
    source: 'Koodu starter',
  },
];

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'could', 'do', 'does', 'for',
  'from', 'has', 'have', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'me', 'my', 'of', 'on',
  'or', 'please', 'should', 'so', 'that', 'the', 'their', 'them', 'then', 'there', 'this', 'to',
  'us', 'was', 'we', 'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with', 'would',
  'you', 'your',
]);

function tokenize(input: string): string[] {
  return Array.from(
    new Set(
      input
        .toLowerCase()
        .match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu)
        ?.filter((token) => token.length >= 3 && !STOP_WORDS.has(token)) ?? [],
    ),
  ).slice(0, 40);
}

function rowToSkill(row: Record<string, unknown>): SkillRecord {
  const category = SKILL_CATEGORIES.includes(row.category as SkillCategory)
    ? (row.category as SkillCategory)
    : 'Custom';
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description),
    category,
    instructions: String(row.instructions),
    enabled: Boolean(row.enabled),
    source: String(row.source),
    updatedAt: Number(row.updatedAt ?? row.updated_at ?? Date.now()),
  };
}

/**
 * Owns skill persistence, starter seeding, and prompt-time skill selection.
 * Skills are instruction packs, not executable code: they are injected into the
 * agent prompt and can be read in full through the `read_skill` tool.
 */
export class SkillsEngine {
  constructor(private readonly database: Database.Database) {}

  /** Seed starter skills once. Safe to call on every server start. */
  seedStarter(): void {
    const seeded = this.database.prepare('SELECT 1 FROM app_settings WHERE key = ?').get(STARTER_SEED_KEY);
    if (seeded) return;
    const seed = this.database.transaction(() => {
      for (const skill of STARTER_SKILLS) {
        this.database
          .prepare(
            `INSERT OR IGNORE INTO skills (id,name,description,category,instructions,enabled,source,updated_at)
             VALUES (?,?,?,?,?,?,?,?)`,
          )
          .run(skill.id, skill.name, skill.description, skill.category, skill.instructions, Number(skill.enabled), skill.source, Date.now());
      }
      this.database.prepare('INSERT INTO app_settings (key,value_json) VALUES (?,?)').run(STARTER_SEED_KEY, 'true');
    });
    seed();
  }

  list(): SkillRecord[] {
    const rows = this.database
      .prepare('SELECT id,name,description,category,instructions,enabled,source,updated_at AS updatedAt FROM skills ORDER BY updated_at DESC,name COLLATE NOCASE')
      .all() as Array<Record<string, unknown>>;
    return rows.map(rowToSkill);
  }

  listEnabled(): SkillRecord[] {
    return this.list().filter((skill) => skill.enabled);
  }

  get(id: string): SkillRecord | null {
    const row = this.database
      .prepare('SELECT id,name,description,category,instructions,enabled,source,updated_at AS updatedAt FROM skills WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? rowToSkill(row) : null;
  }

  /** Resolve by id or case-insensitive name. Used by `read_skill`. */
  resolve(idOrName: string): SkillRecord | null {
    const direct = this.get(idOrName);
    if (direct) return direct;
    const wanted = idOrName.trim().toLowerCase();
    if (!wanted) return null;
    return this.list().find((skill) => skill.name.toLowerCase() === wanted) ?? null;
  }

  save(skill: Omit<SkillRecord, 'updatedAt'>): SkillRecord[] {
    this.database
      .prepare(
        `INSERT INTO skills (id,name,description,category,instructions,enabled,source,updated_at)
         VALUES (@id,@name,@description,@category,@instructions,@enabled,@source,@updatedAt)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,category=excluded.category,instructions=excluded.instructions,enabled=excluded.enabled,source=excluded.source,updated_at=excluded.updated_at`,
      )
      .run({ ...skill, enabled: Number(skill.enabled), updatedAt: Date.now() });
    return this.list();
  }

  remove(id: string): SkillRecord[] {
    this.database.prepare('DELETE FROM skills WHERE id = ?').run(id);
    return this.list();
  }

  importMany(skills: Array<Omit<SkillRecord, 'updatedAt'>>): SkillRecord[] {
    const run = this.database.transaction(() => {
      for (const skill of skills) {
        this.database
          .prepare(
            `INSERT INTO skills (id,name,description,category,instructions,enabled,source,updated_at)
             VALUES (?,?,?,?,?,?,?,?)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,category=excluded.category,instructions=excluded.instructions,enabled=excluded.enabled,source=excluded.source,updated_at=excluded.updated_at`,
          )
          .run(skill.id, skill.name, skill.description, skill.category, skill.instructions, Number(skill.enabled), skill.source, Date.now());
      }
    });
    run();
    return this.list();
  }

  /** Lightweight keyword ranking; no embedding call, so prompt assembly stays fast. */
  select(query: string, options: { limit?: number; minScore?: number } = {}): SkillSelection[] {
    const limit = Math.max(1, Math.min(options.limit ?? 3, 8));
    const minScore = options.minScore ?? 2;
    const tokens = tokenize(query);
    if (!tokens.length) return [];
    const scored = this.listEnabled().map((skill) => {
      const name = skill.name.toLowerCase();
      const description = skill.description.toLowerCase();
      const category = skill.category.toLowerCase();
      const instructions = skill.instructions.toLowerCase();
      let score = 0;
      if (query.trim().length >= 3 && (name.includes(query.trim().toLowerCase()) || query.trim().toLowerCase().includes(name))) score += 8;
      for (const token of tokens) {
        if (name.includes(token)) score += 5;
        if (description.includes(token)) score += 2;
        if (category.includes(token)) score += 1;
        if (instructions.includes(token)) score += 1;
      }
      return {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        category: skill.category,
        score,
      } satisfies SkillSelection;
    });
    return scored
      .filter((skill) => skill.score >= minScore)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, limit);
  }

  summaries(skills: SkillRecord[] = this.listEnabled()): SkillSummary[] {
    return skills.map(({ id, name, description, category }) => ({ id, name, description, category }));
  }

  /**
   * Build the prompt block for selected skills. Full instructions are capped so
   * a large skill library cannot silently consume the model context window.
   */
  renderForPrompt(selection: SkillSelection[], options: { maxSkills?: number; maxInstructionsChars?: number } = {}): string {
    const maxSkills = Math.max(1, Math.min(options.maxSkills ?? 3, 6));
    const maxInstructions = Math.max(200, Math.min(options.maxInstructionsChars ?? 2_500, 8_000));
    const picked = selection.slice(0, maxSkills);
    if (!picked.length) return '';
    return picked
      .map((item) => {
        const skill = this.get(item.id);
        if (!skill) return '';
        const instructions = skill.instructions.length > maxInstructions
          ? `${skill.instructions.slice(0, maxInstructions).trimEnd()}\n…[skill instructions truncated]`
          : skill.instructions;
        return `### Skill: ${skill.name} (${skill.category})\n${skill.description}\n${instructions}`;
      })
      .filter(Boolean)
      .join('\n\n');
  }
}
