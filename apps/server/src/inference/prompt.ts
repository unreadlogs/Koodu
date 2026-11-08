import { ACTION_NAMES, ACTION_POLICIES } from '@koodu/protocol';

function actionList(kind: 'local' | 'cloud'): string {
  return ACTION_NAMES.filter((name) => kind === 'cloud' || ACTION_POLICIES[name].localAllowed)
    .map((name) => {
      const policy = ACTION_POLICIES[name];
      return `- ${name} (risk: ${policy.risk}) ${policy.description}`;
    })
    .join('\n');
}

function contextRecord(context: unknown): Record<string, unknown> | null {
  return context && typeof context === 'object' && !Array.isArray(context)
    ? (context as Record<string, unknown>)
    : null;
}

export function buildSystemPrompt(kind: 'local' | 'cloud', context?: unknown): string {
  const record = contextRecord(context);
  if (record?.agentMode === true) {
    const activeSkills = typeof record.activeSkills === 'string' && record.activeSkills.trim()
      ? record.activeSkills.trim()
      : '';
    const remainingToolCalls = typeof record.remainingToolCalls === 'number' ? record.remainingToolCalls : null;
    const maxIterations = typeof record.maxIterations === 'number' ? record.maxIterations : null;
    return [
      'You are Koodu, a careful assistant running inside a local-first agent harness.',
      `Specialist role: ${String(record.agentType ?? 'organizer')}. Apply that role’s focus while following the same safety rules.`,
      'When conversation history is provided, use it to resolve references and preserve continuity. The current command is the newest user message.',
      'Return only JSON: {"action":string|null,"args":object,"confidence":number,"reply":string|null,"tool_calls":[{"name":string,"args":object}]}.',
      'For a direct conversational answer, set action to null, args to {}, and put the answer in reply. Never use action "reply", "answer", "chat", or any other value outside the Available UI actions list.',
      'You may call tools to gather information or perform workspace work. Tool calls are executed by the harness after your turn, and their results are returned as observations on the next turn.',
      'Use only the tools listed in availableTools, and only with arguments matching their parameter hints. Never invent tool names.',
      'Never claim a tool ran before its result is supplied. If a tool fails, read the error and adapt; do not repeat the exact same call.',
      'When more information is needed, return tool_calls and set reply to null. After tool results are supplied, either answer concisely or propose one registered UI action.',
      remainingToolCalls === null ? 'Stay within the provided tool budget.' : `You have ${remainingToolCalls} tool call(s) left in this run.`,
      maxIterations === null ? 'Long tasks are checkpointed automatically; work in clear steps.' : `This run allows at most ${maxIterations} model turns; long tasks are checkpointed and can resume.`,
      'File tools operate in a sandboxed workspace. Use relative paths only; never try to escape the workspace root.',
      'Never execute actions. The application validates and executes proposals separately. Do not propose an action unless it directly helps satisfy the request.',
      activeSkills ? 'Active skills (follow these instructions when relevant):' : '',
      activeSkills,
      'Available tools:',
      JSON.stringify(record.availableTools ?? []),
      'Available UI actions:',
      actionList(kind),
    ]
      .filter((line) => line !== '')
      .join('\n');
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
