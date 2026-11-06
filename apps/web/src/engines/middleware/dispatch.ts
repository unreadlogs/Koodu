import {
  ACTION_POLICIES,
  actionNameSchema,
  requiresApproval,
  type ActionName,
  type DispatchSource,
  type Risk,
} from '@koodu/protocol';
import { createAuditLog, type AuditLog } from './audit';
import type { EventBus } from './eventBus';
import { createIdFactory } from './ids';
import type { ActionRegistry, ActionResult } from './registry';

export type DeniedReason =
  | 'unknown_action'
  | 'invalid_args'
  | 'target_invalid'
  | 'not_local_allowed'
  | 'approval_required';

export type DispatchOutcome =
  | { status: 'ok'; result: ActionResult; correlationId: string }
  | {
      status: 'needs_approval';
      action: ActionName;
      args: unknown;
      risk: Risk;
      correlationId: string;
    }
  | { status: 'denied'; reason: DeniedReason; message: string; correlationId: string }
  | { status: 'failed'; reason: string; correlationId: string };

export interface DispatchRequest {
  action: string;
  args: unknown;
  source: DispatchSource;
  /** Set only after the user explicitly approved a confirm/dangerous action. */
  approved?: boolean;
  correlationId?: string;
}

export interface DispatcherOptions<TCtx> {
  registry: ActionRegistry<TCtx>;
  bus: EventBus;
  context: () => TCtx;
  audit?: AuditLog;
  now?: () => number;
  newId?: (prefix: string) => string;
  timeoutMs?: number;
}

export interface Dispatcher<TCtx> {
  dispatch(request: DispatchRequest): Promise<DispatchOutcome>;
  registry: ActionRegistry<TCtx>;
  audit: AuditLog;
}

const DEFAULT_TIMEOUT_MS = 8_000;

export function createDispatcher<TCtx>(options: DispatcherOptions<TCtx>): Dispatcher<TCtx> {
  const { registry, bus } = options;
  const audit = options.audit ?? createAuditLog();
  const now = options.now ?? (() => Date.now());
  const newId = options.newId ?? createIdFactory();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const context = options.context;

  function deny(
    action: string,
    args: unknown,
    source: DispatchSource,
    reason: DeniedReason,
    message: string,
    correlationId: string,
    risk: Risk | null,
  ): DispatchOutcome {
    const parsedAction = actionNameSchema.safeParse(action);
    if (parsedAction.success) {
      bus.publish(
        { type: 'action.denied', payload: { action: parsedAction.data, reason: message } },
        { source: 'middleware', correlationId },
      );
    }
    audit.record({
      id: newId('audit'),
      at: now(),
      action,
      args,
      source,
      risk,
      decision: 'denied',
      message,
      correlationId,
    });
    return { status: 'denied', reason, message, correlationId };
  }

  return {
    registry,
    audit,

    async dispatch(request) {
      const correlationId = request.correlationId ?? newId('corr');
      const action = registry.get(request.action);

      if (!action) {
        return deny(
          request.action,
          request.args,
          request.source,
          'unknown_action',
          `unknown_action:${request.action}`,
          correlationId,
          null,
        );
      }

      const policy = ACTION_POLICIES[action.name];
      const parsedArgs = action.argsSchema.safeParse(request.args);
      if (!parsedArgs.success) {
        return deny(
          action.name,
          request.args,
          request.source,
          'invalid_args',
          `invalid_args:${parsedArgs.error.issues[0]?.message ?? 'unknown'}`,
          correlationId,
          policy.risk,
        );
      }

      if (request.source === 'local' && !policy.localAllowed) {
        return deny(
          action.name,
          parsedArgs.data,
          request.source,
          'not_local_allowed',
          `not_local_allowed:${action.name}`,
          correlationId,
          policy.risk,
        );
      }

      if (requiresApproval(policy.risk, request.approved === true)) {
        bus.publish(
          {
            type: 'action.approval.requested',
            payload: {
              action: action.name,
              args: parsedArgs.data as Record<string, unknown>,
              risk: policy.risk,
              source: request.source,
            },
          },
          { source: 'middleware', correlationId },
        );
        audit.record({
          id: newId('audit'),
          at: now(),
          action: action.name,
          args: parsedArgs.data,
          source: request.source,
          risk: policy.risk,
          decision: 'approval_required',
          message: `risk:${policy.risk}`,
          correlationId,
        });
        return {
          status: 'needs_approval',
          action: action.name,
          args: parsedArgs.data,
          risk: policy.risk,
          correlationId,
        };
      }

      const ctx = context();
      if (action.validate) {
        const problem = action.validate(parsedArgs.data, ctx);
        if (problem) {
          return deny(
            action.name,
            parsedArgs.data,
            request.source,
            'target_invalid',
            problem,
            correlationId,
            policy.risk,
          );
        }
      }

      const started = bus.publish(
        {
          type: 'action.started',
          payload: {
            action: action.name,
            args: parsedArgs.data as Record<string, unknown>,
            source: request.source,
            risk: policy.risk,
          },
        },
        { source: 'middleware', correlationId },
      );

      const startedAt = now();
      let timer: ReturnType<typeof setTimeout> | undefined;

      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('action_timeout')), timeoutMs);
        });
        const result = await Promise.race([
          Promise.resolve(action.execute(parsedArgs.data, ctx)),
          timeout,
        ]);

        for (const draft of result.events ?? []) {
          bus.publish(draft, {
            source: 'middleware',
            correlationId,
            causationId: started.id,
          });
        }

        bus.publish(
          {
            type: 'action.completed',
            payload: {
              action: action.name,
              durationMs: Math.max(0, now() - startedAt),
              message: result.message,
            },
          },
          { source: 'middleware', correlationId, causationId: started.id },
        );

        audit.record({
          id: newId('audit'),
          at: now(),
          action: action.name,
          args: parsedArgs.data,
          source: request.source,
          risk: policy.risk,
          decision: 'executed',
          message: result.message,
          correlationId,
        });

        return { status: 'ok', result, correlationId };
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'action_failed';
        bus.publish(
          { type: 'action.failed', payload: { action: action.name, reason } },
          { source: 'middleware', correlationId, causationId: started.id },
        );
        audit.record({
          id: newId('audit'),
          at: now(),
          action: action.name,
          args: parsedArgs.data,
          source: request.source,
          risk: policy.risk,
          decision: 'failed',
          message: reason,
          correlationId,
        });
        return { status: 'failed', reason, correlationId };
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}
