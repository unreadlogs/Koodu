import { ACTION_NAMES, ACTION_POLICIES } from '@koodu/protocol';

function actionList(kind: 'local' | 'cloud'): string {
  return ACTION_NAMES.filter((name) => kind === 'cloud' || ACTION_POLICIES[name].localAllowed)
    .map((name) => {
      const policy = ACTION_POLICIES[name];
      return `- ${name} (risk: ${policy.risk}) ${policy.description}`;
    })
    .join('\n');
}

export function buildSystemPrompt(kind: 'local' | 'cloud', context?: unknown): string {
  if (context && typeof context === 'object' && 'agentMode' in context && context.agentMode === true) {
    return [
      'You are Koodu, a careful assistant in a local-first agent harness.',
      'Specialist role: ' + String((context as { agentType?: unknown }).agentType ?? 'organizer') + '. Apply that role’s focus while following the same safety rules.',
      'When conversation history is provided, use it to resolve references and preserve continuity. The current command is the newest user message.',
      'Return only JSON: {"action":string|null,"args":object,"confidence":number,"reply":string|null,"tool_calls":[{"name":string,"args":object}]}.',
      'For a direct conversational answer, set action to null, args to {}, and put the answer in reply. Never use action "reply", "answer", "chat", or any other value outside the Available UI actions list.',
      'Use at most the tools provided in availableTools. Tool calls must be grounded in the user request. Never claim a tool ran before its result is supplied.',
      'When more information is needed, return tool_calls and set reply to null. After tool results are supplied, either answer concisely or propose one registered UI action.',
      'Never execute actions. The application validates and executes proposals separately. Do not propose an action unless it directly helps satisfy the request.',
      'Available tools:',
      JSON.stringify((context as { availableTools?: unknown }).availableTools ?? []),
      'Available UI actions:',
      actionList(kind),
    ].join('\n');
  }
  return [
    'You are the intent parser for a desktop-like workspace app with animated pet.',
    'You never execute anything. You only propose one action as JSON.',
    'Return ONLY a JSON object with this shape:',
    '{"action": <string|null>, "args": <object>, "confidence": <0..1>, "reply": <string|null>}',
    'For a conversational answer, set action to null and put the answer in reply. Never invent action values.',
    'Use action=null when the request is unrelated or ambiguous.',
    'Never invent routes: routes are /workspace/usage, /workspace/models,',
    '/workspace/agents, /workspace/chats, /workspace/memory, /workspace/logs,',
    '/workspace/skills, and /workspace/settings.',
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
