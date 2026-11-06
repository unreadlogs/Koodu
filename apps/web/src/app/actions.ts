import { actionArgsSchemas } from '@koodu/protocol';
import type { AgentEngine } from '../engines/agent';
import {
  defineAction,
  type ActionResult,
  type AnyActionDefinition,
} from '../engines/middleware';
import {
  closeTab,
  openTab,
  resolveTargetTab,
  setWindowState,
  workspaceFromSnapshot,
  type WorkspaceResult,
} from '../engines/workspace';
import type { PersistenceService } from '../engines/persistence';
import type { PetController } from './petController';
import type { AppStore } from './store';

export interface AppContext {
  store: AppStore;
  agents: AgentEngine;
  persistence: PersistenceService;
  pet: PetController;
  now: () => number;
  newId: (prefix: string) => string;
}

function commitWorkspace(
  ctx: AppContext,
  result: WorkspaceResult,
  message: string,
): ActionResult {
  if (!result.ok) return { ok: false, message: result.reason };
  ctx.store.setState({ workspace: result.transition.state });
  return { ok: true, message, events: result.transition.events };
}

/**
 * Every state-changing action lives here and is executed by the dispatcher
 * after schema, policy, approval and target validation. Handlers mutate only
 * the state authority (store/engines), never React components.
 */
export function createActions(): AnyActionDefinition<AppContext>[] {
  return [
    defineAction({
      name: 'open_tab',
      argsSchema: actionArgsSchemas.open_tab,
      execute: (args, ctx) => {
        const result = openTab(ctx.store.getState().workspace, {
          id: ctx.newId('tab'),
          route: args.route,
          ...(args.title ? { title: args.title } : {}),
          now: ctx.now(),
        });
        const label = args.route.split('/').pop() ?? args.route;
        return commitWorkspace(ctx, result, `Opened ${label}.`);
      },
    }),

    defineAction({
      name: 'close_tab',
      argsSchema: actionArgsSchemas.close_tab,
      validate: (args, ctx) => {
        const target = resolveTargetTab(ctx.store.getState().workspace, args);
        return target.ok ? null : target.reason;
      },
      execute: (args, ctx) => {
        const target = resolveTargetTab(ctx.store.getState().workspace, args);
        if (!target.ok) return { ok: false, message: target.reason };
        const result = closeTab(ctx.store.getState().workspace, target.tab.id);
        return commitWorkspace(ctx, result, `Closed ${target.tab.title}.`);
      },
    }),

    defineAction({
      name: 'minimize_window',
      argsSchema: actionArgsSchemas.minimize_window,
      validate: (args, ctx) => {
        const target = resolveTargetTab(ctx.store.getState().workspace, args);
        return target.ok ? null : target.reason;
      },
      execute: (args, ctx) => {
        const target = resolveTargetTab(ctx.store.getState().workspace, args);
        if (!target.ok) return { ok: false, message: target.reason };
        const result = setWindowState(
          ctx.store.getState().workspace,
          target.tab.id,
          'minimized',
        );
        return commitWorkspace(ctx, result, `Minimized ${target.tab.title}.`);
      },
    }),

    defineAction({
      name: 'maximize_window',
      argsSchema: actionArgsSchemas.maximize_window,
      validate: (args, ctx) => {
        const target = resolveTargetTab(ctx.store.getState().workspace, args);
        return target.ok ? null : target.reason;
      },
      execute: (args, ctx) => {
        const workspace = ctx.store.getState().workspace;
        const target = resolveTargetTab(workspace, args);
        if (!target.ok) return { ok: false, message: target.reason };
        // Maximize toggles: the same command restores the tab.
        const next = target.tab.windowState === 'maximized' ? 'normal' : 'maximized';
        const result = setWindowState(workspace, target.tab.id, next);
        return commitWorkspace(
          ctx,
          result,
          next === 'maximized'
            ? `Maximized ${target.tab.title}.`
            : `Restored ${target.tab.title}.`,
        );
      },
    }),

    defineAction({
      name: 'restore_workspace',
      argsSchema: actionArgsSchemas.restore_workspace,
      execute: (_args, ctx) => {
        const decoded = ctx.persistence.load();
        if (!decoded.ok || !decoded.snapshot) {
          return { ok: false, message: decoded.reason ?? 'no_saved_workspace' };
        }
        const { state, dropped } = workspaceFromSnapshot(decoded.snapshot);
        ctx.store.setState({
          workspace: state,
          pet: { ...ctx.store.getState().pet, position: decoded.snapshot.pet.position },
        });
        ctx.pet.restoreMode(decoded.snapshot.pet.mode);
        return {
          ok: true,
          message: `Restored ${state.tabs.length} tab(s), dropped ${dropped}.`,
          events: [
            {
              type: 'persistence.restored',
              payload: { tabCount: state.tabs.length, dropped },
            },
          ],
        };
      },
    }),

    defineAction({
      name: 'switch_pet_mode',
      argsSchema: actionArgsSchemas.switch_pet_mode,
      execute: (args, ctx) => ({
        ok: true,
        message: `Pet is now ${args.mode}.`,
        events: ctx.pet.setMode(args.mode),
      }),
    }),

    defineAction({
      name: 'set_pet_emotion',
      argsSchema: actionArgsSchemas.set_pet_emotion,
      execute: (args, ctx) => ({
        ok: true,
        message: `Pet feels ${args.emotion}.`,
        events: ctx.pet.setEmotion(args.emotion),
      }),
    }),

    defineAction({
      name: 'get_active_tab',
      argsSchema: actionArgsSchemas.get_active_tab,
      execute: (_args, ctx) => {
        const workspace = ctx.store.getState().workspace;
        const tab = workspace.tabs.find((candidate) => candidate.id === workspace.activeTabId);
        if (!tab) return { ok: false, message: 'no_active_tab' };
        return {
          ok: true,
          message: `${tab.title} (${tab.route}).`,
          data: { tabId: tab.id, route: tab.route, windowState: tab.windowState },
        };
      },
    }),

    defineAction({
      name: 'get_task_status',
      argsSchema: actionArgsSchemas.get_task_status,
      execute: (args, ctx) => {
        if (args.taskId) {
          const task = ctx.agents.get(args.taskId);
          if (!task) return { ok: false, message: 'unknown_task' };
          return { ok: true, message: `${task.agentType}: ${task.status}.`, data: task };
        }
        const tasks = ctx.agents.list();
        return {
          ok: true,
          message: tasks.length === 0 ? 'No agent tasks.' : `${tasks.length} agent task(s).`,
          data: { tasks },
        };
      },
    }),

    defineAction({
      name: 'cancel_task',
      argsSchema: actionArgsSchemas.cancel_task,
      validate: (args, ctx) => (ctx.agents.get(args.taskId) ? null : 'unknown_task'),
      execute: (args, ctx) => {
        const change = ctx.agents.cancel(args.taskId);
        if (!change) return { ok: false, message: 'task_not_cancellable' };
        return {
          ok: true,
          message: `Cancelled ${change.task.agentType} task.`,
          events: change.events,
          data: change.task,
        };
      },
    }),

    defineAction({
      name: 'spawn_subagent',
      argsSchema: actionArgsSchemas.spawn_subagent,
      execute: (args, ctx) => {
        const change = ctx.agents.create({ agentType: args.agentType, title: args.task });
        return {
          ok: true,
          // Honest: task lifecycle exists, execution does not.
          message: `Queued ${args.agentType} task (task execution is not implemented yet).`,
          events: change.events,
          data: change.task,
        };
      },
    }),
  ];
}
