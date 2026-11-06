import type { ActionName, WorkspaceRoute } from '@koodu/protocol';
import type { IntentInput, IntentProvider, IntentResult } from './types';

const ROUTE_WORDS: Record<string, WorkspaceRoute> = {
  usage: '/workspace/usage',
  models: '/workspace/models',
  agents: '/workspace/agents',
  memory: '/workspace/memory',
  settings: '/workspace/settings',
};

const ROUTE_PATTERN = '(usage|models|agents|memory|settings)';

export function normalizeCommand(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[!?.,;:]/g, ' ')
    .replace(/^(?:hey\s+)?(?:koodu|assistant)\b/, '')
    .replace(/^(?:could|can|would|will)\s+you\s+/, '')
    .replace(/^i\s+(?:want|need)\s+to\s+/, '')
    .replace(/\bplease\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface Match {
  action: ActionName;
  args: unknown;
  reply: string;
  confidence: number;
}

function match(text: string, input: IntentInput): Match | null {
  const route = (word: string | undefined): WorkspaceRoute | null =>
    word ? (ROUTE_WORDS[word] ?? null) : null;

  let found = new RegExp(
    `^(?:open|show|go to|go|switch to|display|bring up)\\s+(?:the\\s+)?${ROUTE_PATTERN}(?:\\s+(?:tab|window|page|workspace))?$`,
  ).exec(text);
  if (found) {
    const target = route(found[1]);
    if (target) {
      return {
        action: 'open_tab',
        args: { route: target },
        reply: `Opening ${target.split('/').pop()}.`,
        confidence: 0.96,
      };
    }
  }

  found = new RegExp(
    `^(?:close|dismiss|kill|hide)\\s+(?:the\\s+)?${ROUTE_PATTERN}(?:\\s+(?:tab|window|page))?$`,
  ).exec(text);
  if (found) {
    const target = route(found[1]);
    if (target) {
      return {
        action: 'close_tab',
        args: { route: target },
        reply: `Closing ${target.split('/').pop()}.`,
        confidence: 0.94,
      };
    }
  }

  if (/^(?:close|dismiss|kill)\s+(?:this|the current|the active)?\s*(?:tab|window)$/.test(text)) {
    return {
      action: 'close_tab',
      args: {},
      reply: 'Closing the active tab.',
      confidence: 0.93,
    };
  }

  if (
    /^(?:minimi[sz]e|collapse)\s+(?:this|the current|the active)?\s*(?:tab|window)?$/.test(text) &&
    text.length > 0
  ) {
    return {
      action: 'minimize_window',
      args: {},
      reply: 'Minimizing the active tab.',
      confidence: 0.93,
    };
  }

  found = new RegExp(
    `^(?:minimi[sz]e|collapse)\\s+(?:the\\s+)?${ROUTE_PATTERN}(?:\\s+(?:tab|window))?$`,
  ).exec(text);
  if (found) {
    const target = route(found[1]);
    if (target) {
      return {
        action: 'minimize_window',
        args: { route: target },
        reply: `Minimizing ${target.split('/').pop()}.`,
        confidence: 0.92,
      };
    }
  }

  if (/^(?:maximi[sz]e|expand|fullscreen)\s+(?:this|the current|the active)?\s*(?:tab|window)?$/.test(text)) {
    return {
      action: 'maximize_window',
      args: {},
      reply: 'Maximizing the active tab.',
      confidence: 0.93,
    };
  }

  found = new RegExp(
    `^(?:maximi[sz]e|expand)\\s+(?:the\\s+)?${ROUTE_PATTERN}(?:\\s+(?:tab|window))?$`,
  ).exec(text);
  if (found) {
    const target = route(found[1]);
    if (target) {
      return {
        action: 'maximize_window',
        args: { route: target },
        reply: `Maximizing ${target.split('/').pop()}.`,
        confidence: 0.92,
      };
    }
  }

  if (
    /^(?:restore|bring back|recover|reopen)\s+(?:my\s+)?(?:workspace|tabs|session|windows)$/.test(
      text,
    )
  ) {
    return {
      action: 'restore_workspace',
      args: {},
      reply: 'Restoring your saved workspace.',
      confidence: 0.9,
    };
  }

  found = /^(?:switch|put|move|set)\s+(?:the\s+)?pet\s+(?:to|in|into)?\s*(embedded|floating|hidden)(?:\s+mode)?$/.exec(
    text,
  );
  if (!found) {
    found = /^(?:make)\s+(?:the\s+)?pet\s+(embedded|floating|hidden)$/.exec(text);
  }
  if (found) {
    return {
      action: 'switch_pet_mode',
      args: { mode: found[1] },
      reply: `Pet switched to ${found[1]} mode.`,
      confidence: 0.95,
    };
  }

  found = /^(?:make|set)\s+(?:the\s+)?pet\s+(happy|curious|confused|neutral)$/.exec(text);
  if (found) {
    return {
      action: 'set_pet_emotion',
      args: { emotion: found[1] },
      reply: `Pet is now ${found[1]}.`,
      confidence: 0.9,
    };
  }

  if (
    /^(?:whats?|which)\s+(?:the\s+)?(?:active\s+)?(?:tab|window)\s*(?:am i|is)?\s*(?:on|active|open)?$/.test(
      text,
    ) ||
    /^(?:whats?|which is)\s+the\s+active\s+tab$/.test(text)
  ) {
    return {
      action: 'get_active_tab',
      args: {},
      reply: input.context.activeRoute
        ? `You are on ${input.context.activeRoute.split('/').pop()}.`
        : 'No tab is active.',
      confidence: 0.92,
    };
  }

  if (/^(?:show|list|check)\s+(?:my\s+)?(?:active\s+)?tasks?$/.test(text) || text === 'task status') {
    return {
      action: 'get_task_status',
      args: {},
      reply: 'Listing agent tasks.',
      confidence: 0.9,
    };
  }

  // Fuzzy fallback: verb + route word in a longer sentence.
  const verb = /^(open|show|go|switch|close|minimi[sz]e|maximi[sz]e)\b/.exec(text);
  const routeHit = /(usage|models|agents|memory|settings)\b/.exec(text);
  if (verb && routeHit) {
    const target = route(routeHit[1]);
    if (target) {
      const action =
        verb[1] === 'close'
          ? 'close_tab'
          : verb[1] === 'minimise' || verb[1] === 'minimize'
            ? 'minimize_window'
            : verb[1] === 'maximise' || verb[1] === 'maximize'
              ? 'maximize_window'
              : 'open_tab';
      return {
        action,
        args: action === 'open_tab' ? { route: target } : { route: target },
        reply: `${action.replace('_', ' ')}: ${target.split('/').pop()}.`,
        confidence: 0.68,
      };
    }
  }

  return null;
}

export function proposeWithRules(input: IntentInput): IntentResult {
  const text = normalizeCommand(input.text);
  if (text.length === 0) {
    return { provider: 'rules', confidence: 0, proposal: null, reply: null };
  }

  const matched = match(text, input);
  if (!matched) {
    return { provider: 'rules', confidence: 0, proposal: null, reply: null };
  }

  return {
    provider: 'rules',
    confidence: matched.confidence,
    proposal: { action: matched.action, args: matched.args },
    reply: matched.reply,
  };
}

/** Zero-latency path for the canonical commands. Always runs before any model. */
export function createRuleProvider(): IntentProvider {
  return {
    id: 'rules',
    kind: 'rules',
    propose(input) {
      return Promise.resolve(proposeWithRules(input));
    },
  };
}
