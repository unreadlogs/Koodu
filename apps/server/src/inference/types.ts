import type { ActionName } from '@koodu/protocol';

export interface InferenceRequest {
  text: string;
  context: unknown;
  onTextDelta?: (delta: string) => void;
}

export interface InferenceProposal {
  action: ActionName;
  args: unknown;
}

export interface InferenceToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface InferenceResponse {
  provider: string;
  confidence: number;
  proposal: InferenceProposal | null;
  reply: string | null;
  toolCalls?: InferenceToolCall[];
  usage?: { totalTokens?: number };
}

export type InferenceErrorCode =
  | 'not_configured'
  | 'timeout'
  | 'http_error'
  | 'rate_limited'
  | 'invalid_output'
  | 'unavailable';

export class InferenceError extends Error {
  readonly code: InferenceErrorCode;

  constructor(code: InferenceErrorCode, message: string) {
    super(message);
    this.name = 'InferenceError';
    this.code = code;
  }
}

/**
 * Models live on the server. The browser only ever talks to /api/intelligence/*,
 * so provider keys and model weights never reach the client.
 */
export interface InferenceRuntime {
  id: string;
  kind: 'local' | 'cloud';
  model: string;
  configured(): boolean;
  complete(request: InferenceRequest, signal?: AbortSignal): Promise<InferenceResponse>;
}
