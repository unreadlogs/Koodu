import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { sanitizeEmbeddingText, type TextEmbeddingProvider } from '../inference/embedding';

export interface MemorySearchOptions {
  topK?: number;
  threshold?: number;
  category?: string;
}

export interface MemorySearchResult {
  id: number;
  content: string;
  score: number;
  category: string;
}

export { MAX_EMBEDDING_TEXT_CHARS as MAX_MEMORY_TEXT_CHARS, MAX_EMBEDDING_TEXT_TOKENS as MAX_MEMORY_TEXT_TOKENS } from '../inference/embedding';

interface MemoryRow {
  id: number;
  content: string;
  category: string;
  embedding: Buffer;
}

/**
 * SQLite-backed local vector memory. It delegates embedding to the reusable
 * inference adapter and owns only durable metadata and vector blobs.
 */
export class VectorMemoryStore {
  private readonly db: Database.Database;
  private readonly embeddings: TextEmbeddingProvider;
  private closed = false;

  constructor(dbPath: string, embeddings: TextEmbeddingProvider) {
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.embeddings = embeddings;
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY,
        content TEXT NOT NULL,
        category TEXT NOT NULL,
        embedding BLOB NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_accessed DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS memories_category_idx ON memories(category);
      CREATE INDEX IF NOT EXISTS memories_created_at_idx ON memories(created_at);
    `);
  }

  async add(content: string, category: string): Promise<number> {
    this.assertOpen();
    const cleanContent = sanitizeEmbeddingText(content);
    const cleanCategory = sanitizeCategory(category);
    if (!cleanContent) throw new Error('Memory content cannot be empty.');
    if (!cleanCategory) throw new Error('Memory category cannot be empty.');

    const embedding = await this.embeddings.embedText(cleanContent);
    const result = this.db
      .prepare('INSERT INTO memories (content, category, embedding) VALUES (?, ?, ?)')
      .run(cleanContent, cleanCategory, float32ToBuffer(embedding));
    return Number(result.lastInsertRowid);
  }

  async search(
    query: string,
    options: MemorySearchOptions = {},
  ): Promise<MemorySearchResult[]> {
    this.assertOpen();
    const cleanQuery = sanitizeEmbeddingText(query);
    if (!cleanQuery) return [];

    const requestedTopK = options.topK ?? 5;
    if (!Number.isFinite(requestedTopK) || requestedTopK <= 0) return [];
    const topK = clampInteger(requestedTopK, 1, 100);
    const threshold = Number.isFinite(options.threshold) ? options.threshold ?? 0 : 0;
    const queryVector = await this.embeddings.embedText(cleanQuery);

    const category = options.category ? sanitizeCategory(options.category) : undefined;
    const rows = category
      ? (this.db.prepare('SELECT id, content, category, embedding FROM memories WHERE category = ?').all(category) as MemoryRow[])
      : (this.db.prepare('SELECT id, content, category, embedding FROM memories').all() as MemoryRow[]);

    const matches = rows
      .map((row) => ({
        id: row.id,
        content: row.content,
        category: row.category,
        score: cosineSimilarity(queryVector, bufferToFloat32(row.embedding)),
      }))
      .filter((match) => match.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    if (matches.length) {
      const touch = this.db.prepare('UPDATE memories SET last_accessed = CURRENT_TIMESTAMP WHERE id = ?');
      const updateAccessTimes = this.db.transaction((ids: number[]) => {
        for (const id of ids) touch.run(id);
      });
      updateAccessTimes(matches.map((match) => match.id));
    }
    return matches;
  }

  delete(id: number): void {
    this.assertOpen();
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Memory id must be a positive integer.');
    this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
  }

  close(): void {
    if (this.closed) return;
    this.db.close();
    this.closed = true;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('VectorMemoryStore is closed.');
  }
}

/** Backwards-compatible aliases for callers that used the memory barrel. */
export { sanitizeEmbeddingText as sanitizeMemoryText, estimateEmbeddingTokens as estimateNeedleTokens } from '../inference/embedding';

function sanitizeCategory(category: string): string {
  return category.normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, 64);
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const valueA = a[index] ?? 0;
    const valueB = b[index] ?? 0;
    dot += valueA * valueB;
    magnitudeA += valueA * valueA;
    magnitudeB += valueB * valueB;
  }
  const denominator = Math.sqrt(magnitudeA * magnitudeB);
  return denominator === 0 ? 0 : Math.max(-1, Math.min(1, dot / denominator));
}

export function float32ToBuffer(vector: Float32Array): Buffer {
  return Buffer.from(new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength));
}

export function bufferToFloat32(buffer: Buffer | Uint8Array): Float32Array {
  if (buffer.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error('Embedding BLOB byte length is not aligned to Float32 values.');
  }
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  return new Float32Array(bytes.buffer);
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
