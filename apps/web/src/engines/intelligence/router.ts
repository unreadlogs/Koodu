import { ACTION_POLICIES, isLocalAction } from '@koodu/protocol';
import {
  IntentProviderError,
  type IntentInput,
  type IntentProposal,
  type IntentProvider,
} from './types';

export type IntentSource = 'rules' | 'local-model' | 'cloud' | 'none';

export interface RouterDecision {
  source: IntentSource;
  proposal: IntentProposal | null;
  provider: string | null;
  confidence: number;
  reply: string | null;
  notes: string[];
}

export interface RouterOptions {
  providers: IntentProvider[];
  /** Proposals below this confidence are ignored. */
  minConfidence?: number;
  /** Disable cloud routing (offline mode, privacy mode). */
  localOnly?: boolean;
  onProviderError?: (provider: string, code: string) => void;
}

const DEFAULT_MIN_CONFIDENCE = 0.55;

/**
 * Rules -> server-side local model -> cloud. Each step is optional and failure
 * of one provider degrades to the next instead of blocking the command.
 */
export async function routeIntent(
  input: IntentInput,
  options: RouterOptions,
  signal?: AbortSignal,
): Promise<RouterDecision> {
  const notes: string[] = [];
  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;

  for (const provider of options.providers) {
    if (signal?.aborted) {
      notes.push('aborted');
      break;
    }
    if (provider.kind === 'cloud' && options.localOnly) {
      notes.push(`skipped:${provider.id}:local_only`);
      continue;
    }

    let result;
    try {
      result = await provider.propose(input, signal);
    } catch (error) {
      const code = error instanceof IntentProviderError ? error.code : 'error';
      notes.push(`failed:${provider.id}:${code}`);
      options.onProviderError?.(provider.id, code);
      continue;
    }

    if (!result.proposal) {
      if (result.reply) {
        return {
          source: 'none',
          proposal: null,
          provider: result.provider,
          confidence: 0,
          reply: result.reply,
          notes,
        };
      }
      notes.push(`empty:${provider.id}`);
      continue;
    }

    if (result.confidence < minConfidence) {
      notes.push(`low_confidence:${provider.id}:${result.confidence.toFixed(2)}`);
      continue;
    }

    const localSource = provider.kind !== 'cloud';
    if (localSource && !isLocalAction(result.proposal.action)) {
      notes.push(`not_local_allowed:${result.proposal.action}`);
      continue;
    }

    if (!ACTION_POLICIES[result.proposal.action]) {
      notes.push(`unknown_action:${result.proposal.action}`);
      continue;
    }

    return {
      source: provider.kind,
      proposal: result.proposal,
      provider: result.provider,
      confidence: result.confidence,
      reply: result.reply,
      notes,
    };
  }

  return {
    source: 'none',
    proposal: null,
    provider: null,
    confidence: 0,
    reply: null,
    notes,
  };
}
