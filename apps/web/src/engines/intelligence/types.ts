import type { ActionName, PetMode, WorkspaceRoute } from '@koodu/protocol';

export interface IntentContext {
  activeRoute: WorkspaceRoute | null;
  tabs: WorkspaceRoute[];
  petMode: PetMode;
}

export interface IntentInput {
  text: string;
  context: IntentContext;
}

export interface IntentProposal {
  action: ActionName;
  /** Untrusted: middleware validates against the action's schema. */
  args: unknown;
}

export interface IntentResult {
  provider: string;
  confidence: number;
  proposal: IntentProposal | null;
  reply: string | null;
}

export type ProviderKind = 'rules' | 'local-model' | 'cloud';

export interface IntentProvider {
  id: string;
  kind: ProviderKind;
  propose(input: IntentInput, signal?: AbortSignal): Promise<IntentResult>;
}

export type ProviderErrorCode =
  | 'unavailable'
  | 'timeout'
  | 'http_error'
  | 'invalid_output'
  | 'not_configured';

export class IntentProviderError extends Error {
  readonly code: ProviderErrorCode;

  constructor(code: ProviderErrorCode, message: string) {
    super(message);
    this.name = 'IntentProviderError';
    this.code = code;
  }
}
