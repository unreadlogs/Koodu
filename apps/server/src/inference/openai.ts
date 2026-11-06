import { actionNameSchema, isLocalAction, type ActionName } from '@koodu/protocol';
import { z } from 'zod';
import { buildSystemPrompt, buildUserPrompt } from './prompt';
import {
  InferenceError,
  type InferenceRequest,
  type InferenceResponse,
  type InferenceRuntime,
} from './types';

const modelOutputSchema = z.object({
  action: actionNameSchema.nullable().default(null),
  args: z.record(z.unknown()).default({}),
  confidence: z.number().min(0).max(1).default(0.5),
  reply: z.string().max(500).nullable().default(null),
});

const chatCompletionSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string() }) }))
    .min(1),
});

export interface OpenAiRuntimeOptions {
  id: string;
  kind: 'local' | 'cloud';
  baseUrl: string | null;
  model: string;
  apiKey?: string | null;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Any OpenAI-compatible runtime works (llama.cpp server, Ollama, vLLM).
 * This is the transport for Cactus Needle 3 running server-side.
 */
export function createOpenAiRuntime(options: OpenAiRuntimeOptions): InferenceRuntime {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;

  const runtime: InferenceRuntime = {
    id: options.id,
    kind: options.kind,
    model: options.model,

    configured() {
      return Boolean(options.baseUrl && options.model);
    },

    async complete(
      request: InferenceRequest,
      signal?: AbortSignal,
    ): Promise<InferenceResponse> {
      if (!options.baseUrl) {
        throw new InferenceError('not_configured', `${options.id}_not_configured`);
      }
      if (typeof doFetch !== 'function') {
        throw new InferenceError('unavailable', 'fetch_unavailable');
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const forwardAbort = (): void => controller.abort();
      signal?.addEventListener('abort', forwardAbort, { once: true });

      try {
        const response = await doFetch(
          `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
            },
            body: JSON.stringify({
              model: options.model,
              temperature: 0,
              max_tokens: 300,
              response_format: { type: 'json_object' },
              messages: [
                { role: 'system', content: buildSystemPrompt(options.kind) },
                { role: 'user', content: buildUserPrompt(request) },
              ],
            }),
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          throw new InferenceError(
            'http_error',
            `${options.id}_status_${response.status}`,
          );
        }

        const body: unknown = await response.json();
        const completion = chatCompletionSchema.safeParse(body);
        if (!completion.success) {
          throw new InferenceError('invalid_output', `${options.id}_bad_completion`);
        }

        const content = completion.data.choices[0]?.message.content ?? '';
        return parseModelOutput(content, options);
      } catch (error) {
        if (error instanceof InferenceError) throw error;
        if (error instanceof Error && error.name === 'AbortError') {
          throw new InferenceError('timeout', `${options.id}_timeout`);
        }
        throw new InferenceError(
          'unavailable',
          error instanceof Error ? error.message : `${options.id}_failed`,
        );
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', forwardAbort);
      }
    },
  };

  return runtime;
}

/** Exported for tests: a model reply is untrusted text, not an action. */
export function parseModelOutput(
  content: string,
  options: { id: string; kind: 'local' | 'cloud' },
): InferenceResponse {
  let decoded: unknown;
  try {
    decoded = JSON.parse(extractJson(content));
  } catch {
    throw new InferenceError('invalid_output', `${options.id}_not_json`);
  }

  const parsed = modelOutputSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new InferenceError('invalid_output', `${options.id}_bad_shape`);
  }

  const action: ActionName | null = parsed.data.action;
  if (action && options.kind === 'local' && !isLocalAction(action)) {
    return {
      provider: options.id,
      confidence: 0,
      proposal: null,
      reply: 'That action needs cloud reasoning and your approval.',
    };
  }

  return {
    provider: options.id,
    confidence: parsed.data.confidence,
    proposal: action ? { action, args: parsed.data.args } : null,
    reply: parsed.data.reply,
  };
}

/** Small models sometimes wrap JSON in prose or fences. */
function extractJson(content: string): string {
  const trimmed = content.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return candidate;
  return candidate.slice(first, last + 1);
}
