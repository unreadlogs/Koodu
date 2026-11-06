import { useStore } from 'zustand';
import type { App } from '../app/createApp';

const RISK_STYLES: Record<string, string> = {
  confirm: 'bg-amber-500/15 text-amber-200 ring-amber-400/30',
  dangerous: 'bg-rose-500/15 text-rose-200 ring-rose-400/30',
  safe: 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/30',
};

export function ApprovalDialog({ app }: { app: App }) {
  const pending = useStore(app.store, (state) => state.ui.pendingApproval);
  if (!pending) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-title"
        className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="approval-title" className="text-base font-semibold text-slate-100">
            Approval needed
          </h2>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ring-1 ${
              RISK_STYLES[pending.risk] ?? RISK_STYLES.safe
            }`}
          >
            {pending.risk}
          </span>
        </div>

        <p className="mt-2 text-sm text-slate-300">
          The middleware wants to run{' '}
          <span className="font-mono text-emerald-300">{pending.action}</span>. A model cannot
          approve this on its own.
        </p>

        <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-slate-950/80 p-3 text-xs text-slate-300">
          {JSON.stringify(pending.args, null, 2)}
        </pre>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => app.deny()}
            className="rounded-lg bg-white/5 px-3 py-2 text-sm text-slate-200 hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void app.approve()}
            className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}
