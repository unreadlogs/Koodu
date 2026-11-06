import {
  EVENT_VERSION,
  type AppEvent,
  type EventDraft,
  type EventSource,
  type EventType,
} from '@koodu/protocol';
import { createIdFactory } from './ids';

export type EventListener = (event: AppEvent) => void;

export interface PublishMeta {
  source?: EventSource;
  correlationId?: string | null;
  causationId?: string | null;
}

export interface EventBus {
  publish(draft: EventDraft, meta?: PublishMeta): AppEvent;
  subscribe(type: EventType | '*', listener: EventListener): () => void;
  history(): readonly AppEvent[];
  clearHistory(): void;
}

export interface EventBusOptions {
  now?: () => number;
  newId?: (prefix: string) => string;
  historyLimit?: number;
  onListenerError?: (error: unknown, event: AppEvent) => void;
}

const MAX_DEPTH = 12;

/**
 * Synchronous, ordered event bus.
 *
 * Loop guard: listeners may publish (the pet projector does), but publishing an
 * event of the type currently being delivered throws, and nesting is capped.
 * That keeps "pet reacts to workspace event" from turning into a cycle.
 */
export function createEventBus(options: EventBusOptions = {}): EventBus {
  const now = options.now ?? (() => Date.now());
  const newId = options.newId ?? createIdFactory();
  const historyLimit = options.historyLimit ?? 200;
  const onListenerError =
    options.onListenerError ??
    ((error: unknown) => {
      console.error('[event-bus] listener failed', error);
    });

  const typed = new Map<EventType, Set<EventListener>>();
  const wildcard = new Set<EventListener>();
  const log: AppEvent[] = [];

  let depth = 0;
  let delivering: EventType | null = null;

  function dispatch(event: AppEvent): void {
    const typeListeners = typed.get(event.type);
    const listeners = [
      ...(typeListeners ? [...typeListeners] : []),
      ...(wildcard ? [...wildcard] : []),
    ];
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error) {
        // Loop/depth violations are programming errors, not listener failures.
        const message = error instanceof Error ? error.message : '';
        if (message.startsWith('event_loop') || message.startsWith('event_depth_exceeded')) {
          throw error;
        }
        onListenerError(error, event);
      }
    }
  }

  return {
    publish(draft, meta = {}) {
      if (delivering === draft.type) {
        throw new Error(`event_loop:${draft.type}`);
      }
      if (depth >= MAX_DEPTH) {
        throw new Error(`event_depth_exceeded:${draft.type}`);
      }

      const event = {
        id: newId('evt'),
        type: draft.type,
        version: EVENT_VERSION,
        at: now(),
        source: meta.source ?? 'system',
        correlationId: meta.correlationId ?? null,
        causationId: meta.causationId ?? null,
        payload: draft.payload,
      } as AppEvent;

      log.push(event);
      if (log.length > historyLimit) log.splice(0, log.length - historyLimit);

      depth += 1;
      const previous = delivering;
      delivering = draft.type;
      try {
        dispatch(event);
      } finally {
        delivering = previous;
        depth -= 1;
      }
      return event;
    },

    subscribe(type, listener) {
      if (type === '*') {
        wildcard.add(listener);
        return () => {
          wildcard.delete(listener);
        };
      }
      const set = typed.get(type) ?? new Set<EventListener>();
      set.add(listener);
      typed.set(type, set);
      return () => {
        set.delete(listener);
        if (set.size === 0) typed.delete(type);
      };
    },

    history() {
      return log;
    },

    clearHistory() {
      log.length = 0;
    },
  };
}
