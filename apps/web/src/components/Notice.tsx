import { useEffect } from 'react';
import { useStore } from 'zustand';
import type { App } from '../app/createApp';

const LEVEL_STYLES = {
  info: 'border-sky-400/30 bg-sky-500/10 text-sky-100',
  warn: 'border-amber-400/30 bg-amber-500/10 text-amber-100',
  error: 'border-rose-400/30 bg-rose-500/10 text-rose-100',
} as const;

export function Notice({ app }: { app: App }) {
  const notice = useStore(app.store, (state) => state.ui.notice);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => app.clearNotice(), 4_500);
    return () => clearTimeout(timer);
  }, [notice, app]);

  if (!notice) return null;

  return (
    <div
      role="status"
      className={`fixed bottom-4 left-4 z-40 max-w-sm rounded-lg border px-3 py-2 text-sm shadow-xl backdrop-blur ${
        LEVEL_STYLES[notice.level]
      }`}
    >
      {notice.message}
    </div>
  );
}
