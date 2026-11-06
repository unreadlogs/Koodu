import type { DispatchSource, Risk } from '@koodu/protocol';

export type AuditDecision = 'executed' | 'denied' | 'approval_required' | 'failed';

export interface AuditEntry {
  id: string;
  at: number;
  action: string;
  args: unknown;
  source: DispatchSource;
  risk: Risk | null;
  decision: AuditDecision;
  message: string;
  correlationId: string;
}

export type AuditListener = (entry: AuditEntry) => void;

export interface AuditLog {
  record(entry: AuditEntry): void;
  all(): readonly AuditEntry[];
  subscribe(listener: AuditListener): () => void;
}

export function createAuditLog(limit = 200): AuditLog {
  const entries: AuditEntry[] = [];
  const listeners = new Set<AuditListener>();

  return {
    record(entry) {
      entries.push(entry);
      if (entries.length > limit) entries.splice(0, entries.length - limit);
      for (const listener of [...listeners]) {
        try {
          listener(entry);
        } catch {
          // Auditing must never break dispatch.
        }
      }
    },
    all() {
      return entries;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
