import type { Needle as NeedleModel } from 'cactus-needle';
import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { VectorMemoryStore } from '../memory/vector-memory-store';
import { EmbeddingEngine, sanitizeEmbeddingText } from '../inference/embedding';

export type MemoryCategory = 'preference' | 'fact' | 'task';

export interface MainAgentOptions {
  dbPath?: string;
  database?: Database.Database;
  /** Pass a shared instance when the server already owns a Needle lifecycle. */
  needle?: NeedleModel;
  /** Pass a shared engine when other server features also need embeddings. */
  embeddingEngine?: EmbeddingEngine;
  logger?: Pick<Console, 'info'>;
}

/** Agent-facing API over the local SQLite memory store and Needle model. */
export class MainAgent {
  readonly memory: VectorMemoryStore;
  readonly embeddings: EmbeddingEngine;
  private readonly ownsEmbeddings: boolean;
  private readonly logger: Pick<Console, 'info'>;

  constructor(options: MainAgentOptions) {
    this.ownsEmbeddings = options.embeddingEngine === undefined;
    this.embeddings = options.embeddingEngine ?? new EmbeddingEngine(options.needle);
    if (!options.database && !options.dbPath) throw new Error('MainAgent requires a database or dbPath.');
    this.memory = new VectorMemoryStore(options.database ?? options.dbPath!, this.embeddings);
    this.logger = options.logger ?? console;
  }

  async search_memory(
    query: string,
    options: { topK?: number; threshold?: number } = {},
  ): Promise<string> {
    const startedAt = performance.now();
    const results = await this.memory.search(query, options);
    this.logger.info(
      `[MainAgent] memory search: ${results.length} result(s) in ${(performance.now() - startedAt).toFixed(1)}ms`,
    );
    if (!results.length) return 'No relevant memories found.';
    return results
      .map((item) => `- [${item.category}] ${item.content} (relevance ${item.score.toFixed(2)})`)
      .join('\n');
  }

  async save_memory(fact: string, category: MemoryCategory = 'fact'): Promise<number> {
    return this.memory.add(fact, category);
  }

  /**
   * Extract atomic durable statements from the user's own message. The reply
   * is accepted for runtime-loop compatibility, but is never stored as fact.
   */
  async remember_interaction(userMessage: string, assistantReply: string): Promise<number> {
    void assistantReply;
    const candidates = extractUserFacts(userMessage);
    let saved = 0;
    for (const candidate of candidates) {
      await this.memory.add(candidate.content, candidate.category);
      saved += 1;
    }
    return saved;
  }

  async close(): Promise<void> {
    try {
      this.memory.close();
    } finally {
      if (this.ownsEmbeddings) await this.embeddings.close();
    }
  }
}

function extractUserFacts(message: string): Array<{ content: string; category: MemoryCategory }> {
  const parts = message
    .replace(/\r/g, '\n')
    .split(/(?<=[.!?])\s+|\n+|\s+[•;]\s+/)
    .map((part) => sanitizeEmbeddingText(part))
    .filter(Boolean);
  const extracted: Array<{ content: string; category: MemoryCategory }> = [];

  for (const part of parts) {
    if (part.endsWith('?') || /^(?:what|when|where|why|how|who|can you|could you)\b/i.test(part)) continue;
    if (/\b(api[\s_-]?key|password|passphrase|secret|access token|credit card|social security number)\b/i.test(part)) continue;
    const preference = /\b(prefer|like|love|hate|avoid|favorite|favourite|always|never|want)\b/i.test(part);
    const task = /\b(need to|plan to|working on|task is|todo|to-do|must)\b/i.test(part);
    const durableSubject = /^(?:i\b|i'm\b|i am\b|my\b|we\b|we're\b|we are\b|our\b|remember that\b|please remember\b)/i.test(part);
    if (!preference && !task && !durableSubject) continue;
    const category: MemoryCategory = preference ? 'preference' : task ? 'task' : 'fact';
    const predicate = /^(.*\b(?:prefer|likes?|loves?|hates?|avoid|wants?)\b)\s+(.+)$/i.exec(part);
    const conjunction = predicate?.[2] ? /^(.*?)\s+and\s+(.+)$/i.exec(predicate[2]) : null;
    const atomicFacts = predicate?.[1] && conjunction?.[1] && conjunction[2]
      ? [`${predicate[1]} ${conjunction[1].replace(/[.!?]+$/, '')}.`, `${predicate[1]} ${conjunction[2].replace(/[.!?]+$/, '')}.`]
      : [part];
    for (const content of atomicFacts) {
      const cleaned = content.replace(/^(?:please\s+)?remember that\s+/i, '').trim();
      if (cleaned) extracted.push({ content: cleaned, category });
    }
  }
  return extracted;
}

/** Runnable from apps/server: `node --import tsx src/agent/main-agent.ts`. */
export async function runMemoryExample(): Promise<void> {
  const dbPath = process.env.KOODU_MEMORY_DB ?? resolve(process.cwd(), '.data/memory-example.sqlite');
  const agent = new MainAgent({ dbPath });
  try {
    await agent.save_memory('The user prefers a dark interface with restrained green accents.', 'preference');
    await agent.save_memory('The user prefers the Nova Square typeface for the Koodu interface.', 'preference');
    await agent.save_memory('The command input should appear on the Home page only.', 'preference');
    await agent.save_memory('The user is building Koodu as a local-first AI companion harness.', 'fact');

    console.log("\nInterface preference search:\n");
    console.log(await agent.search_memory("What are the user's interface preferences?", { topK: 4, threshold: 0.15 }));
  } finally {
    await agent.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runMemoryExample().catch((error: unknown) => {
    console.error('[MainAgent] memory example failed', error);
    process.exitCode = 1;
  });
}
