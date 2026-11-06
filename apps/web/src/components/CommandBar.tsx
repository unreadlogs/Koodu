import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { App } from '../app/createApp';

const EXAMPLES = [
  'Open Usage',
  'Open Models',
  'Minimize this window',
  'Close Agents',
  'Switch pet to floating mode',
  'Make the pet happy',
  'Show active tasks',
  'What tab am I on?',
];

export function CommandBar({ app }: { app: App }) {
  const [text, setText] = useState('');
  const busy = useStore(app.store, (state) => state.ui.busy);
  const reply = useStore(app.store, (state) => state.ui.reply);
  const aiStatus = useStore(app.store, (state) => state.ui.aiStatus);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const submit = async (command: string): Promise<void> => {
    if (command.trim().length === 0 || busy) return;
    const result = await app.submitCommand(command);
    if (result.status === 'dispatched' || result.status === 'no_proposal') setText('');
  };

  return (
    <div className="border-t border-white/10 bg-slate-900/80 px-3 py-2">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit(text);
        }}
        className="flex items-center gap-2"
      >
        <span className="hidden shrink-0 text-xs text-slate-500 sm:inline">⌘K</span>
        <input
          ref={inputRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Ask for a workspace action…"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-emerald-400/50"
          aria-label="Command"
        />
        <button
          type="submit"
          disabled={busy || text.trim().length === 0}
          className="shrink-0 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? 'Thinking…' : 'Run'}
        </button>
      </form>

      <div className="mt-1.5 flex items-center gap-2 overflow-x-auto">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => void submit(example)}
            className="shrink-0 rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-slate-400 hover:border-emerald-400/30 hover:text-emerald-200"
          >
            {example}
          </button>
        ))}
      </div>

      {reply && (
        <p className="mt-1.5 truncate text-xs text-slate-300" title={reply}>
          <span className="text-emerald-400">pet ›</span> {reply}
          {aiStatus === 'offline' && (
            <span className="ml-2 text-amber-400">(server offline — rules only)</span>
          )}
        </p>
      )}
    </div>
  );
}
