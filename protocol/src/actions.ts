import { z } from 'zod';
import { AGENT_TYPES } from './agents';
import { type ActionPolicy } from './risk';
import { workspaceRouteSchema } from './routes';
import { petEmotionSchema, petModeSchema } from './state';

export const ACTION_NAMES = [
  'open_tab',
  'close_tab',
  'minimize_window',
  'maximize_window',
  'restore_workspace',
  'switch_pet_mode',
  'set_pet_emotion',
  'get_active_tab',
  'get_task_status',
  'cancel_task',
  'spawn_subagent',
] as const;
export const actionNameSchema = z.enum(ACTION_NAMES);
export type ActionName = (typeof ACTION_NAMES)[number];

/** Tab target: explicit id, a route lookup, or the active tab when both are absent. */
const tabTargetShape = {
  tabId: z.string().min(1).optional(),
  route: workspaceRouteSchema.optional(),
};

export const actionArgsSchemas = {
  open_tab: z
    .object({
      route: workspaceRouteSchema,
      title: z.string().min(1).max(40).optional(),
    })
    .strict(),
  close_tab: z.object(tabTargetShape).strict(),
  minimize_window: z.object(tabTargetShape).strict(),
  maximize_window: z.object(tabTargetShape).strict(),
  restore_workspace: z.object({}).strict(),
  switch_pet_mode: z.object({ mode: petModeSchema }).strict(),
  set_pet_emotion: z.object({ emotion: petEmotionSchema }).strict(),
  get_active_tab: z.object({}).strict(),
  get_task_status: z.object({ taskId: z.string().min(1).optional() }).strict(),
  cancel_task: z.object({ taskId: z.string().min(1) }).strict(),
  spawn_subagent: z
    .object({
      agentType: z.enum(AGENT_TYPES),
      task: z.string().min(3).max(500),
    })
    .strict(),
} satisfies Record<ActionName, z.ZodTypeAny>;

export type ActionArgs<A extends ActionName> = z.infer<(typeof actionArgsSchemas)[A]>;

export type ActionInvocation = {
  [A in ActionName]: { action: A; args: ActionArgs<A> };
}[ActionName];

/**
 * Untrusted proposal shape. Arguments are validated against the per-action
 * schema inside the middleware, never at the edge.
 */
export const proposalSchema = z.object({
  action: actionNameSchema,
  args: z.unknown(),
});
export type Proposal = z.infer<typeof proposalSchema>;

export const ACTION_POLICIES: Record<ActionName, ActionPolicy> = {
  open_tab: {
    risk: 'safe',
    localAllowed: true,
    description: 'Open a workspace route in a tab, or focus it when already open.',
  },
  close_tab: {
    risk: 'confirm',
    localAllowed: true,
    description: 'Close a tab (the active tab when no target is given).',
  },
  minimize_window: {
    risk: 'safe',
    localAllowed: true,
    description: 'Minimize a tab window.',
  },
  maximize_window: {
    risk: 'safe',
    localAllowed: true,
    description: 'Maximize a tab window.',
  },
  restore_workspace: {
    risk: 'confirm',
    localAllowed: true,
    description: 'Replace the current workspace with the persisted snapshot.',
  },
  switch_pet_mode: {
    risk: 'safe',
    localAllowed: true,
    description: 'Switch the pet between embedded, floating and hidden mode.',
  },
  set_pet_emotion: {
    risk: 'safe',
    localAllowed: true,
    description: 'Set an explicit pet emotion.',
  },
  get_active_tab: {
    risk: 'safe',
    localAllowed: true,
    description: 'Read the currently active tab.',
  },
  get_task_status: {
    risk: 'safe',
    localAllowed: true,
    description: 'Read one agent task, or list all tasks.',
  },
  cancel_task: {
    risk: 'confirm',
    localAllowed: false,
    description: 'Cancel a running agent task. Not local-model allowed.',
  },
  spawn_subagent: {
    risk: 'dangerous',
    localAllowed: false,
    description: 'Spawn a specialised sub-agent. Cloud and explicit approval only.',
  },
};

export function policyFor(action: ActionName): ActionPolicy {
  return ACTION_POLICIES[action];
}

export function isLocalAction(action: string): action is ActionName {
  return (
    (ACTION_NAMES as readonly string[]).includes(action) &&
    ACTION_POLICIES[action as ActionName].localAllowed
  );
}

/**
 * Strict shape for anything a local provider is allowed to propose.
 * Used by the rule provider and by tests, so local output cannot target
 * `spawn_subagent` or `cancel_task` by accident.
 */
export const localProposalSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('open_tab'), args: actionArgsSchemas.open_tab }),
  z.object({ action: z.literal('close_tab'), args: actionArgsSchemas.close_tab }),
  z.object({ action: z.literal('minimize_window'), args: actionArgsSchemas.minimize_window }),
  z.object({ action: z.literal('maximize_window'), args: actionArgsSchemas.maximize_window }),
  z.object({ action: z.literal('restore_workspace'), args: actionArgsSchemas.restore_workspace }),
  z.object({ action: z.literal('switch_pet_mode'), args: actionArgsSchemas.switch_pet_mode }),
  z.object({ action: z.literal('set_pet_emotion'), args: actionArgsSchemas.set_pet_emotion }),
  z.object({ action: z.literal('get_active_tab'), args: actionArgsSchemas.get_active_tab }),
  z.object({ action: z.literal('get_task_status'), args: actionArgsSchemas.get_task_status }),
]);
export type LocalProposal = z.infer<typeof localProposalSchema>;
