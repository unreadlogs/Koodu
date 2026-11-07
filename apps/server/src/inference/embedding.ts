import { Needle } from 'cactus-needle';
import type { Needle as NeedleModel } from 'cactus-needle';

/** Reserve half of Needle 3's 256-token context for runtime overhead. */
export const MAX_EMBEDDING_TEXT_TOKENS = 128;
export const MAX_EMBEDDING_TEXT_CHARS = 350;

export interface TextEmbeddingProvider {
  embedText(text: string): Promise<Float32Array>;
}

/** Shared, validated embedding adapter for memory and other inference clients. */
export class EmbeddingEngine implements TextEmbeddingProvider {
  private readonly model: Pick<NeedleModel, 'embed' | 'close'>;
  private readonly ownsModel: boolean;

  constructor(model?: Pick<NeedleModel, 'embed' | 'close'>) {
    this.ownsModel = model === undefined;
    this.model = model ?? new Needle({ stateless: true });
  }

  async embedText(input: string): Promise<Float32Array> {
    const text = sanitizeEmbeddingText(input);
    if (!text) throw new Error('Embedding text cannot be empty.');
    const vector = await this.model.embed(text);
    if (!(vector instanceof Float32Array) || vector.length === 0 || !Array.from(vector).every(Number.isFinite)) {
      throw new Error('Needle returned an empty or invalid embedding.');
    }
    return vector;
  }

  async close(): Promise<void> {
    if (this.ownsModel) await this.model.close();
  }
}

/** Normalize and hard-bound text before sending it to Needle. */
export function sanitizeEmbeddingText(input: string): string {
  const normalized = input
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  const words = normalized.split(' ').slice(0, 120).join(' ');
  const bounded = Array.from(words).slice(0, MAX_EMBEDDING_TEXT_CHARS).join('');
  let accepted = '';
  for (const character of bounded) {
    const candidate = accepted + character;
    if (estimateEmbeddingTokens(candidate) > MAX_EMBEDDING_TEXT_TOKENS) break;
    accepted = candidate;
  }
  if (accepted.length < words.length) {
    const sentenceEnd = Math.max(accepted.lastIndexOf('.'), accepted.lastIndexOf('!'), accepted.lastIndexOf('?'));
    if (sentenceEnd >= accepted.length * 0.5) return accepted.slice(0, sentenceEnd + 1).trim();
    const wordEnd = accepted.lastIndexOf(' ');
    if (wordEnd > 0) accepted = accepted.slice(0, wordEnd);
  }
  return accepted.trim();
}

/** Conservative tokenizer-free estimate; Needle's exact tokenizer is not exposed here. */
export function estimateEmbeddingTokens(text: string): number {
  const chunks = text.match(/[\p{L}\p{N}]+|[^\s]/gu) ?? [];
  return chunks.reduce((total, chunk) => {
    if (/[^\x00-\x7f]/u.test(chunk)) return total + Array.from(chunk).length;
    if (/^[\p{L}\p{N}]+$/u.test(chunk)) return total + Math.ceil(chunk.length / 4);
    return total + 1;
  }, 0);
}
