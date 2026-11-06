import type { ReactNode } from 'react';
import type { ActionName, FrameState } from '@koodu/protocol';

export interface PageProps {
  state: FrameState | null;
  send: (action: ActionName, args: unknown) => void;
}

export function Card({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
        {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/60 p-3">
      <p className="text-[11px] uppercase tracking-widest text-slate-500">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold text-slate-100" title={value}>
        {value}
      </p>
    </div>
  );
}

export function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'muted'; children: ReactNode }) {
  const styles = {
    ok: 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/30',
    warn: 'bg-amber-500/15 text-amber-200 ring-amber-400/30',
    muted: 'bg-white/5 text-slate-300 ring-white/10',
  } as const;
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] ring-1 ${styles[tone]}`}>
      {children}
    </span>
  );
}

export function ActionButton({
  onClick,
  children,
  tone = 'default',
}: {
  onClick: () => void;
  children: ReactNode;
  tone?: 'default' | 'primary';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        tone === 'primary'
          ? 'rounded-md bg-emerald-500 px-2.5 py-1 text-xs font-medium text-slate-950 hover:bg-emerald-400'
          : 'rounded-md bg-white/5 px-2.5 py-1 text-xs text-slate-200 hover:bg-white/10'
      }
    >
      {children}
    </button>
  );
}
