import type { ActionArgs, ActionName, EventDraft } from '@koodu/protocol';
import type { ZodType } from 'zod';

export interface ActionResult {
  ok: boolean;
  message: string;
  data?: unknown;
  /** Emitted by the dispatcher after the handler succeeds. */
  events?: EventDraft[];
}

/**
 * Actions are defined at the composition root (the app), never inside the
 * middleware. Middleware owns validation, permissions and publishing.
 */
export interface ActionDefinition<A extends ActionName, TCtx> {
  name: A;
  argsSchema: ZodType<ActionArgs<A>>;
  /** Target validation (tab exists, task exists, ...). Return a reason to reject. */
  validate?: (args: ActionArgs<A>, ctx: TCtx) => string | null;
  execute: (args: ActionArgs<A>, ctx: TCtx) => ActionResult | Promise<ActionResult>;
}

export function defineAction<A extends ActionName, TCtx>(
  definition: ActionDefinition<A, TCtx>,
): ActionDefinition<A, TCtx> {
  return definition;
}

export type AnyActionDefinition<TCtx> = {
  [A in ActionName]: ActionDefinition<A, TCtx>;
}[ActionName];

/** Internally widened so the dispatcher can call any definition uniformly. */
export interface RegisteredAction<TCtx> {
  name: ActionName;
  argsSchema: ZodType<unknown>;
  validate: ((args: unknown, ctx: TCtx) => string | null) | undefined;
  execute: (args: unknown, ctx: TCtx) => ActionResult | Promise<ActionResult>;
}

export interface ActionRegistry<TCtx> {
  get(name: string): RegisteredAction<TCtx> | null;
  all(): RegisteredAction<TCtx>[];
}

export function createActionRegistry<TCtx>(
  definitions: AnyActionDefinition<TCtx>[],
): ActionRegistry<TCtx> {
  const actions = new Map<string, RegisteredAction<TCtx>>();

  for (const definition of definitions) {
    if (actions.has(definition.name)) {
      throw new Error(`duplicate_action:${definition.name}`);
    }
    actions.set(definition.name, {
      name: definition.name,
      argsSchema: definition.argsSchema as unknown as ZodType<unknown>,
      validate: definition.validate as
        | ((args: unknown, ctx: TCtx) => string | null)
        | undefined,
      execute: definition.execute as (
        args: unknown,
        ctx: TCtx,
      ) => ActionResult | Promise<ActionResult>,
    });
  }

  return {
    get(name) {
      return actions.get(name) ?? null;
    },
    all() {
      return [...actions.values()];
    },
  };
}
