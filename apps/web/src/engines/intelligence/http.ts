import { actionNameSchema } from '@koodu/protocol';
import { z } from 'zod';
import {
  IntentProviderError,
  type IntentInput,
  type IntentProvider,
  type IntentResult,
  type ProviderKind,
} from './types';

const remoteResultSchema = z.object({
  confidence: z.number().min(0).max(1),
  proposal: z
    .object({ action: actionNameSchema, args: z.unknown() })
    .nullable()
    .default(null),
  reply: z.string().nullable().default(null),
  provider: z.string().optional(),
});

export interface HttpProviderOptions {
  id: string;
  kind: Extract<ProviderKind, 'local-model' | 'cloud'>;
  url: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  headers?: Record<string, string>;
}

const DEFAULT_TIMEOUT_MS = 8_000;

/**
 * Talks to the app server, which owns the model and the credentials. The
 * browser never runs inference and never sees a provider API key.
 */
export function createHttpProvider(options: HttpProviderOptions): IntentProvider {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    id: options.id,
    kind: options.kind,

    async propose(input: IntentInput, signal?: AbortSignal): Promise<IntentResult> {
      if (typeof doFetch !== 'function') {
        throw new IntentProviderError('unavailable', 'fetch_unavailable');
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const forwardAbort = (): void => controller.abort();
      signal?.addEventListener('abort', forwardAbort, { once: true });

      try {
        const headers: Record<string, string> = { 'content-type': 'application/json', ...options.headers };
        // Attach auth token if present (browser-side only; tests use no storage)
        try {
          const token = globalThis.localStorage?.getItem('koodu:auth:token');
          if (token) headers['x-koodu-auth'] = token;
        } catch {
          // no storage
        }
        const response = await doFetch(options.url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ text: input.text, context: input.context }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new IntentProviderError(
            response.status === 501 ? 'not_configured' : 'http_error',
            `${options.id}_status_${response.status}`,
          );
        }

        const parsed = remoteResultSchema.safeParse(await response.json());
        if (!parsed.success) {
          throw new IntentProviderError('invalid_output', `${options.id}_invalid_output`);
        }

        return {
          provider: parsed.data.provider ?? options.id,
          confidence: parsed.data.confidence,
          proposal: parsed.data.proposal
            ? { action: parsed.data.proposal.action, args: parsed.data.proposal.args ?? {} }
            : null,
          reply: parsed.data.reply,
        };
      } catch (error) {
        if (error instanceof IntentProviderError) throw error;
        if (error instanceof Error && error.name === 'AbortError') {
          throw new IntentProviderError('timeout', `${options.id}_timeout`);
        }
        throw new IntentProviderError(
          'unavailable',
          error instanceof Error ? error.message : `${options.id}_failed`,
        );
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', forwardAbort);
      }
    },
  };
}
