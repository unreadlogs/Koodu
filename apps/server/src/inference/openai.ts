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
  tool_calls: z.array(z.object({ name: z.string().min(1).max(40), args: z.record(z.unknown()) })).max(4).default([]),
});

const chatCompletionSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string() }) }))
    .min(1),
  usage: z.object({ total_tokens: z.number().int().nonnegative().optional() }).optional(),
});
const streamedChunkSchema = z.object({
  choices: z.array(z.object({ delta: z.object({ content: z.string().optional() }).optional() })).default([]),
  usage: z.object({ total_tokens: z.number().int().nonnegative().optional() }).nullable().optional(),
});

export interface OpenAiRuntimeOptions {
  id: string;
  kind: 'local' | 'cloud';
  baseUrl: string | null;
  model: string;
  apiKey?: string | null;
  timeoutMs?: number;
  maxOutputTokens?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Any OpenAI-compatible runtime works (llama.cpp server, Ollama, vLLM).
 * Any OpenAI-compatible runtime (Ollama, llama.cpp, vLLM) works.
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
              max_tokens: options.maxOutputTokens ?? 300,
              response_format: { type: 'json_object' },
              ...(request.onTextDelta ? { stream: true } : {}),
              messages: [
                { role: 'system', content: buildSystemPrompt(options.kind, request.context) },
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

        if (request.onTextDelta) {
          if (!response.body) throw new InferenceError('invalid_output', `${options.id}_missing_stream`);
          const streamed = await readStreamingCompletion(response.body, request.onTextDelta);
          return parseModelOutput(streamed.content, options, streamed.totalTokens);
        }

        const body: unknown = await response.json();
        const completion = chatCompletionSchema.safeParse(body);
        if (!completion.success) {
          throw new InferenceError('invalid_output', `${options.id}_bad_completion`);
        }

        const content = completion.data.choices[0]?.message.content ?? '';
        return parseModelOutput(content, options, completion.data.usage?.total_tokens);
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

async function readStreamingCompletion(
  body: ReadableStream<Uint8Array>,
  onTextDelta: (delta: string) => void,
): Promise<{ content: string; totalTokens?: number }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let content = '';
  let emittedReply = '';
  let totalTokens: number | undefined;
  const consume = (line: string): void => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let value: unknown;
    try { value = JSON.parse(data); } catch { return; }
    const parsed = streamedChunkSchema.safeParse(value);
    if (!parsed.success) return;
    const delta = parsed.data.choices[0]?.delta?.content ?? '';
    if (delta) {
      content += delta;
      const currentReply = readPartialReply(content);
      if (currentReply.startsWith(emittedReply) && currentReply.length > emittedReply.length) {
        onTextDelta(currentReply.slice(emittedReply.length));
        emittedReply = currentReply;
      }
    }
    if (parsed.data.usage?.total_tokens !== undefined) totalTokens = parsed.data.usage.total_tokens;
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) consume(line);
    }
    pending += decoder.decode();
    if (pending.trim()) consume(pending);
  } finally {
    reader.releaseLock();
  }
  return { content, ...(totalTokens === undefined ? {} : { totalTokens }) };
}

/** Decode the reply JSON string while the enclosing JSON object is still arriving. */
function readPartialReply(content: string): string {
  const match = /"reply"\s*:\s*"/.exec(content);
  if (!match || match.index === undefined) return '';
  const start = match.index + match[0].length;
  let escaped = false;
  let end = content.length;
  for (let index = start; index < content.length; index += 1) {
    const char = content[index];
    if (escaped) escaped = false;
    else if (char === '\\') escaped = true;
    else if (char === '"') { end = index; break; }
  }
  let raw = content.slice(start, end);
  while (raw.length) {
    try { return JSON.parse(`"${raw}"`) as string; }
    catch { raw = raw.slice(0, -1); }
  }
  return '';
}

/** Exported for tests: a model reply is untrusted text, not an action. */
export function parseModelOutput(
  content: string,
  options: { id: string; kind: 'local' | 'cloud' },
  totalTokens?: number,
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
      ...(totalTokens === undefined ? {} : { usage: { totalTokens } }),
    };
  }

  return {
    provider: options.id,
    confidence: parsed.data.confidence,
    proposal: action ? { action, args: parsed.data.args } : null,
    reply: parsed.data.reply,
    ...(parsed.data.tool_calls.length ? { toolCalls: parsed.data.tool_calls } : {}),
    ...(totalTokens === undefined ? {} : { usage: { totalTokens } }),
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
