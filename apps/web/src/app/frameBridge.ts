import {
  validateInboundFrameMessage,
} from '@koodu/protocol';
import type { AppEvent, EventDraft, FrameState, ParentToFrameMessage } from '@koodu/protocol';
import type { PublishMeta } from '../engines/middleware';
import type { App } from './createApp';

export interface FrameWindowLike {
  postMessage(message: unknown, targetOrigin: string): void;
}

export interface FrameLike {
  contentWindow: FrameWindowLike | null;
}

export interface MessageTarget {
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

export interface FrameBridgeApp {
  store: App['store'];
  publish: (draft: EventDraft, meta?: PublishMeta) => AppEvent;
  snapshot: () => FrameState;
  runFrameCommand: (action: string, args: unknown) => Promise<{ ok: boolean; message: string }>;
  ping(): Promise<{ ms: number; serverAt: number }>;
}

export interface FrameBridge {
  register(tabId: string, frame: FrameLike | null): void;
  forget(tabId: string): void;
  broadcast(): void;
  dispose(): void;
}

/**
 * Parent side of the iframe protocol. Every message is matched to a registered
 * frame window, then origin + schema validated. Unknown senders are ignored.
 * WebSocket ping intents from iframes are forwarded through the ONE main
 * WebSocket (no per-iframe sockets).
 */
export function attachFrameBridge(
  app: FrameBridgeApp,
  target: MessageTarget,
  origin: string,
): FrameBridge {
  const frames = new Map<string, FrameLike>();

  const post = (tabId: string, message: ParentToFrameMessage): void => {
    frames.get(tabId)?.contentWindow?.postMessage(message, origin);
  };

  const broadcast = (): void => {
    const state = app.snapshot();
    for (const tabId of frames.keys()) {
      post(tabId, { v: 1, type: 'state.push', state });
    }
  };

  const handler = (event: MessageEvent): void => {
    let tabId: string | null = null;
    for (const [id, frame] of frames) {
      if (frame.contentWindow && frame.contentWindow === event.source) {
        tabId = id;
        break;
      }
    }
    if (tabId === null) return;

    const source = tabId;
    const result = validateInboundFrameMessage(
      { origin: event.origin, data: event.data, source: event.source },
      { origin, window: event.source },
    );
    if (!result.ok) {
      app.publish(
        { type: 'iframe.rejected', payload: { reason: result.reason } },
        { source: 'iframe' },
      );
      return;
    }

    const message = result.value;
    switch (message.type) {
      case 'ready':
        app.publish(
          { type: 'iframe.ready', payload: { tabId: source, route: message.route } },
          { source: 'iframe' },
        );
        post(source, { v: 1, type: 'state.push', state: app.snapshot() });
        break;

      case 'state.request':
        post(source, { v: 1, type: 'state.push', state: app.snapshot() });
        break;

      case 'command.request':
        void app.runFrameCommand(message.action, message.args).then((outcome) => {
          post(source, {
            v: 1,
            type: 'command.result',
            requestId: message.requestId,
            ok: outcome.ok,
            message: outcome.message,
          });
          broadcast();
        });
        break;

      case 'ws.ping':
        void app.ping()
          .then(({ ms, serverAt }) => {
            post(source, { v: 1, type: 'ws.pong', requestId: message.requestId, ms, serverAt });
          })
          .catch((err) => {
            post(source, {
              v: 1,
              type: 'ws.error',
              requestId: message.requestId,
              message: err instanceof Error ? err.message : 'ws_ping_failed',
            });
          });
        break;

      case 'error':
        app.publish(
          { type: 'iframe.rejected', payload: { reason: message.message } },
          { source: 'iframe' },
        );
        break;

      default:
        break;
    }
  };

  target.addEventListener('message', handler);
  const unsubscribe = app.store.subscribe(() => broadcast());

  return {
    register(tabId, frame) {
      if (frame) frames.set(tabId, frame);
      else frames.delete(tabId);
    },
    forget(tabId) {
      frames.delete(tabId);
    },
    broadcast,
    dispose() {
      target.removeEventListener('message', handler);
      unsubscribe();
      frames.clear();
    },
  };
}
