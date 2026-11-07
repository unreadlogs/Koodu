export {
  VectorMemoryStore,
  bufferToFloat32,
  cosineSimilarity,
  estimateNeedleTokens,
  float32ToBuffer,
  MAX_MEMORY_TEXT_CHARS,
  MAX_MEMORY_TEXT_TOKENS,
  sanitizeMemoryText,
} from './vector-memory-store';
export type { MemorySearchOptions, MemorySearchResult } from './vector-memory-store';
export { EmbeddingEngine, sanitizeEmbeddingText, MAX_EMBEDDING_TEXT_CHARS, MAX_EMBEDDING_TEXT_TOKENS } from '../inference/embedding';
export type { TextEmbeddingProvider } from '../inference/embedding';
