import { ACTION_NAMES, ACTION_POLICIES } from '@koodu/protocol';

function actionList(kind: 'local' | 'cloud'): string {
  return ACTION_NAMES.filter((name) => kind === 'cloud' || ACTION_POLICIES[name].localAllowed)
    .map((name) => {
      const policy = ACTION_POLICIES[name];
      return `- ${name} (risk: ${policy.risk}) ${policy.description}`;
    })
    .join('\n');
}

export function buildSystemPrompt(kind: 'local' | 'cloud'): string {
  return [
    'You are the intent parser for a desktop-like workspace app with animated pet.',
    'You never execute anything. You only propose one action as JSON.',
    'Return ONLY a JSON object with this shape:',
    '{"action": <string|null>, "args": <object>, "confidence": <0..1>, "reply": <string|null>}',
    'Use action=null when the request is unrelated or ambiguous.',
    'Never invent routes: routes are /workspace/usage, /workspace/models,',
    '/workspace/agents, /workspace/memory, /workspace/settings.',
    'Never invent tab ids or task ids. Omit them to target the active tab.',
    'Available actions:',
    actionList(kind),
  ].join('\n');
}

export function buildUserPrompt(request: { text: string; context: unknown }): string {
  return JSON.stringify({
    command: request.text,
    context: request.context,
  });
}
