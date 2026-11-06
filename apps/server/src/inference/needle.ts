import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  NeedleError,
  createNeedle,
  getModelPath,
  type NeedleOptions,
  type ToolDefinition,
} from 'cactus-needle';
import {
  WORKSPACE_ROUTES,
  localProposalSchema,
  type ActionName,
} from '@koodu/protocol';
import {
  InferenceError,
  type InferenceRequest,
  type InferenceResponse,
  type InferenceRuntime,
} from './types';

/**
 * Cactus Needle 3 as an opt-in, server-side local provider.
 *
 * It is a tool-calling engine, not a chat model. Only local-safe actions are
 * exposed as tools, and the middleware still validates every call it makes.
 * Weights are never committed or loaded on import: `createNeedle()` only works
 * when the model is already provisioned, or `NEEDLE_MODEL_PATH` points to it.
 */

export const NEEDLE_LOCAL_TOOLS: readonly ToolDefinition[] = [
  {
    name: 'open_tab',
    description: 'Open a built-in workspace route in a tab, or focus it when already open.',
    parameters: {
      type: 'object',
      properties: {
        route: { type: 'string', enum: [...WORKSPACE_ROUTES] },
        title: { type: 'string', minLength: 1, maxLength: 40 },
      },
      required: ['route'],
      additionalProperties: false,
    },
  },
  {
    name: 'close_tab',
    description: 'Close a tab; the active tab is used when no target is given.',
    parameters: {
      type: 'object',
      properties: {
        tabId: { type: 'string', minLength: 1 },
        route: { type: 'string', enum: [...WORKSPACE_ROUTES] },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'minimize_window',
    description: 'Minimize a tab window; the active tab is used when no target is given.',
    parameters: {
      type: 'object',
      properties: {
        tabId: { type: 'string', minLength: 1 },
        route: { type: 'string', enum: [...WORKSPACE_ROUTES] },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'maximize_window',
    description: 'Maximize a tab window; the active tab is used when no target is given.',
    parameters: {
      type: 'object',
      properties: {
        tabId: { type: 'string', minLength: 1 },
        route: { type: 'string', enum: [...WORKSPACE_ROUTES] },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'restore_workspace',
    description: 'Replace the current workspace with the persisted snapshot.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'switch_pet_mode',
    description: 'Switch the pet between embedded, floating and hidden mode.',
    parameters: {
      type: 'object',
      properties: { mode: { type: 'string', enum: ['embedded', 'floating', 'hidden'] } },
      required: ['mode'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_pet_emotion',
    description: 'Set an explicit pet emotion.',
    parameters: {
      type: 'object',
      properties: {
        emotion: { type: 'string', enum: ['neutral', 'happy', 'curious', 'confused', 'error'] },
      },
      required: ['emotion'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_active_tab',
    description: 'Read the currently active tab.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'get_task_status',
    description: 'Read one agent task, or list all tasks.',
    parameters: {
      type: 'object',
      properties: { taskId: { type: 'string', minLength: 1 } },
      additionalProperties: false,
    },
  },
];

export interface NeedleRuntimeConfig {
  /** Explicit .cact file or file: URL; defaults to the package's local cache. */
  modelPath?: string | null;
  /** Custom local cache root when `downloadModel` provisioned one. */
  cacheDir?: string | null;
  timeoutMs: number;
}

/** Where the default `downloadModel()` call puts the file. */
export function defaultNeedleModelPath(cacheDir?: string | null): string {
  return getModelPath(cacheDir ?? undefined, 'needle3');
}

/** Resolve whether the pinned weights are available locally; never downloads. */
export function isNeedleModelAvailable(config: NeedleRuntimeConfig): boolean {
  const resolved = resolveModelPath(config);
  return resolved !== null && existsSync(resolved);
}

export function createNeedleRuntime(config: NeedleRuntimeConfig): InferenceRuntime {
  const state = {
    session: null as Awaited<ReturnType<typeof createNeedle>> | null,
    loading: null as Promise<Awaited<ReturnType<typeof createNeedle>>> | null,
  };

  const reset = async (): Promise<void> => {
    const current = state.session;
    state.session = null;
    if (current) await current.close().catch(() => undefined);
  };

  const load = (): Promise<Awaited<ReturnType<typeof createNeedle>>> => {
    if (state.session) return Promise.resolve(state.session);
    if (state.loading) return state.loading;

    const resolvedPath = resolveModelPath(config);
    if (resolvedPath === null) {
      return Promise.reject(new InferenceError('not_configured', 'needle_model_path_invalid'));
    }

    const options: NeedleOptions = {
      modelPath: resolvedPath,
      stateless: true,
      tools: [...NEEDLE_LOCAL_TOOLS],
      system:
        'Desktop workspace intent parser. Choose exactly one local tool when the command maps to it, ' +
        'otherwise produce no tool call. Never invent routes, tab ids or task ids.',
    };

    state.loading = createNeedle(options).then((session) => {
      state.session = session;
      state.loading = null;
      return session;
    }).catch((error: unknown) => {
      state.loading = null;
      throw toInferenceError(error);
    });
    return state.loading;
  };

  return {
    id: 'needle',
    kind: 'local',
    model: 'needle3',

    configured(): boolean {
      return isNeedleModelAvailable(config);
    },

    async complete(request: InferenceRequest, signal?: AbortSignal): Promise<InferenceResponse> {
      const controller = combineAbortSignals(signal, AbortSignal.timeout(config.timeoutMs));
      try {
        const session = await load();
        const result = await session.complete(buildPrompt(request), {
          abortSignal: controller,
        });

        if (!result.success) {
          throw new InferenceError(
            'unavailable',
            `needle_engine:${String(result.error ?? result.error_code ?? 'error')}`,
          );
        }

        const confidence = normalizeConfidence(result.confidence);
        for (const call of result.function_calls) {
          const parsed = localProposalSchema.safeParse({
            action: call.name,
            args: call.arguments ?? {},
          });
          if (parsed.success) {
            return {
              provider: 'needle',
              confidence,
              proposal: {
                action: parsed.data.action as ActionName,
                args: parsed.data.args,
              },
              reply: null,
            };
          }
        }

        return { provider: 'needle', confidence: 0, proposal: null, reply: null };
      } catch (error) {
        await reset();
        throw toInferenceError(error);
      } finally {
        controller?.removeEventListener('abort', noop);
      }
    },
  };
}

function resolveModelPath(config: NeedleRuntimeConfig): string | null {
  const explicit = config.modelPath?.trim();
  if (explicit) return explicit.startsWith('file:') ? fileURLToPath(explicit) : explicit;

  try {
    return defaultNeedleModelPath(config.cacheDir);
  } catch {
    return null;
  }
}

function buildPrompt(request: InferenceRequest): string {
  return [
    'Map this desktop command to one local tool, or produce no tool call.',
    `Command: ${request.text}`,
    `Context: ${JSON.stringify(request.context ?? {})}`,
  ].join('\n');
}

function normalizeConfidence(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.65;
  return Math.min(1, Math.max(0, value));
}

function combineAbortSignals(
  first: AbortSignal | undefined,
  second: AbortSignal,
): AbortSignal {
  if (!first) return second;
  return AbortSignal.any([first, second]);
}

const noop = (): void => undefined;

function toInferenceError(error: unknown): InferenceError {
  if (error instanceof InferenceError) return error;
  if (error instanceof NeedleError) {
    if (error.code === 'MODEL_NOT_FOUND' || error.code === 'INTEGRITY_ERROR') {
      return new InferenceError('not_configured', `needle_${error.code.toLowerCase()}`);
    }
    if (error.code === 'INVALID_MODEL' || error.code === 'INVALID_ARGUMENT') {
      return new InferenceError('invalid_output', `needle_${error.code.toLowerCase()}`);
    }
    const timeout = /timed? ?out|aborted/i.test(error.message);
    return new InferenceError(timeout ? 'timeout' : 'unavailable', `needle_${error.code.toLowerCase()}`);
  }
  if (error instanceof Error) {
    if (error.name === 'TimeoutError') return new InferenceError('timeout', 'needle_timeout');
    if (error.name === 'AbortError') return new InferenceError('timeout', 'needle_aborted');
    return new InferenceError('unavailable', `needle_unavailable:${error.message}`);
  }
  return new InferenceError('unavailable', 'needle_unavailable');
}
