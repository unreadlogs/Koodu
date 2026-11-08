import { ACTION_NAMES, isLocalAction, type ActionName } from '@koodu/protocol';
import { z } from 'zod';
import { buildSystemPrompt, buildUserPrompt } from './prompt';
import {
  InferenceError,
  type InferenceRequest,
  type InferenceResponse,
  type InferenceRuntime,
} from './types';

const chatCompletionSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string().nullable().optional(), reasoning: z.string().nullable().optional() }).passthrough() }))
    .min(1),
  usage: z.object({ total_tokens: z.number().int().nonnegative().optional() }).optional(),
}).passthrough();
const streamedChunkSchema = z.object({
  choices: z.array(z.object({ delta: z.object({ content: z.string().nullable().optional(), reasoning: z.string().nullable().optional() }).passthrough().optional() })).default([]),
  usage: z.object({ total_tokens: z.number().int().nonnegative().optional() }).nullable().optional(),
}).passthrough();

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
        const effectiveMaxTokens = Math.max(options.maxOutputTokens ?? 4096, 4096);
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
              max_tokens: effectiveMaxTokens,
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
          let detail = '';
          try { detail = (await response.text()).slice(0, 500).replace(/\s+/g, ' ').trim(); } catch { detail = ''; }
          const code = response.status === 429 ? 'rate_limited' : 'http_error';
          throw new InferenceError(
            code as any,
            `${options.id}_status_${response.status}${detail ? `_${detail.slice(0, 120)}` : ''}`,
          );
        }

        if (request.onTextDelta) {
          if (!response.body) throw new InferenceError('invalid_output', `${options.id}_missing_stream`);
          const streamed = await readStreamingCompletion(response.body, request.onTextDelta);
          const fallback = !streamed.content.trim() && streamed.reasoning && streamed.reasoning.includes('"reply"') && streamed.reasoning.includes('{') ? streamed.reasoning : streamed.content;
          return parseModelOutput(fallback, options, streamed.totalTokens);
        }

        const body: unknown = await response.json();
        const completion = chatCompletionSchema.safeParse(body);
        if (!completion.success) {
          throw new InferenceError('invalid_output', `${options.id}_bad_completion`);
        }

        const message = completion.data.choices[0]?.message;
        let content = typeof message?.content === 'string' ? message.content : '';
        if (!content.trim() && typeof message?.reasoning === 'string' && message.reasoning.includes('"reply"') && message.reasoning.includes('{')) {
          content = message.reasoning;
        }
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
): Promise<{ content: string; reasoning: string; totalTokens?: number }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let content = '';
  let reasoning = '';
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
    const delta = parsed.data.choices[0]?.delta;
    const chunk = typeof delta?.content === 'string' ? delta.content : '';
    if (typeof delta?.reasoning === 'string' && delta.reasoning) reasoning += delta.reasoning;
    if (chunk) {
      content += chunk;
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
  return { content, reasoning, ...(totalTokens === undefined ? {} : { totalTokens }) };
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
  // A truncated stream cuts mid-escape (e.g. "\u12" or a trailing "\"): drop at most
  // a few trailing chars so a long reply isn't re-parsed character by character.
  for (let attempts = 0; attempts <= 12 && raw.length; attempts += 1) {
    try { return JSON.parse(`"${raw}"`) as string; }
    catch { raw = raw.slice(0, -1); }
  }
  return '';
}

/**
 * Safety bound only — far above what max_output_tokens can produce, so legitimate
 * long replies are never clipped. Raised from a 4k/8k cut that truncated answers mid-sentence.
 */
const REPLY_MAX_CHARS = 64_000;
export function parseModelOutput(
  content: string,
  options: { id: string; kind: 'local' | 'cloud' },
  totalTokens?: number,
): InferenceResponse {
  const usage = totalTokens === undefined ? {} : { usage: { totalTokens } };
  const trimmed = content.trim();
  const plainFallback = (): InferenceResponse => {
    // Truncated JSON (model hit its output limit mid-string): recover the clean
    // partial reply instead of leaking the raw `{ "action": ... }` blob to the UI.
    const recovered = readPartialReply(trimmed);
    if (recovered.trim()) return { provider: options.id, confidence: 0.5, proposal: null, reply: recovered.slice(0, REPLY_MAX_CHARS), ...usage };
    const candidate = extractJson(trimmed);
    const looksLikeJson = candidate.startsWith('{') || candidate.startsWith('[');
    if (looksLikeJson) {
      // No recoverable reply yet: the streaming path already emitted any clean
      // text, so a null reply falls back to that instead of showing raw JSON.
      return { provider: options.id, confidence: 0.5, proposal: null, reply: null, ...usage };
    }
    return {
      provider: options.id,
      confidence: 0.5,
      proposal: null,
      reply: trimmed ? trimmed.slice(0, REPLY_MAX_CHARS) : null,
      ...usage,
    };
  };

  let decoded: unknown;
  try {
    decoded = JSON.parse(extractJson(content));
  } catch {
    return plainFallback();
  }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    return plainFallback();
  }
  const obj = decoded as Record<string, unknown>;

  const rawAction = obj.action;
  const action: ActionName | null = typeof rawAction === 'string' && (ACTION_NAMES as readonly string[]).includes(rawAction)
    ? rawAction as ActionName
    : null;
  const rawArgs = obj.args;
  const args: Record<string, unknown> = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? rawArgs as Record<string, unknown> : {};

  let confidence = 0.5;
  const rawConfidence = obj.confidence;
  if (typeof rawConfidence === 'number' && Number.isFinite(rawConfidence)) {
    confidence = rawConfidence > 1 ? Math.max(0, Math.min(1, rawConfidence / 100)) : Math.max(0, Math.min(1, rawConfidence));
  } else if (typeof rawConfidence === 'string') {
    const parsedNumber = Number(rawConfidence);
    if (Number.isFinite(parsedNumber)) confidence = parsedNumber > 1 ? Math.max(0, Math.min(1, parsedNumber / 100)) : Math.max(0, Math.min(1, parsedNumber));
  }

  const rawReply = obj.reply ?? obj.message ?? obj.text ?? obj.answer ?? obj.content;
  let reply: string | null = null;
  if (typeof rawReply === 'string' && rawReply.trim()) reply = rawReply.slice(0, REPLY_MAX_CHARS);
  else if (typeof rawReply === 'number' && Number.isFinite(rawReply)) reply = String(rawReply);

  const rawToolCalls = obj.tool_calls ?? obj.toolCalls ?? obj.tools;
  const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  if (Array.isArray(rawToolCalls)) {
    for (const entry of rawToolCalls.slice(0, 4)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const candidate = entry as Record<string, unknown>;
      const name = candidate.name;
      if (typeof name !== 'string' || !name.trim() || name.length > 40) continue;
      const callArgs = candidate.args;
      toolCalls.push({ name: name.slice(0, 40), args: callArgs && typeof callArgs === 'object' && !Array.isArray(callArgs) ? callArgs as Record<string, unknown> : {} });
    }
  }

  if (action && options.kind === 'local' && !isLocalAction(action)) {
    return {
      provider: options.id,
      confidence: 0,
      proposal: null,
      reply: 'That action needs cloud reasoning and your approval.',
      ...usage,
    };
  }

  return {
    provider: options.id,
    confidence,
    proposal: action ? { action, args } : null,
    reply,
    ...(toolCalls.length ? { toolCalls } : {}),
    ...usage,
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
