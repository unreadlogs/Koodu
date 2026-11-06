import { useState } from 'react';
import { useStore } from 'zustand';
import type { App } from '../app/createApp';

function toneFor(type: string): string {
  if (type.startsWith('workspace.')) return 'text-emerald-300';
  if (type.startsWith('pet.')) return 'text-violet-300';
  if (type.startsWith('action.')) return 'text-sky-300';
  if (type.startsWith('agent.')) return 'text-amber-300';
  if (type.startsWith('persistence.')) return 'text-cyan-300';
  if (type.startsWith('iframe.')) return 'text-rose-300';
  return 'text-slate-300';
}

export function EventLog({ app }: { app: App }) {
  const [open, setOpen] = useState(false);
  const events = useStore(app.store, (state) => state.events);
  const recent = [...events].reverse().slice(0, 14);

  return (
    <div className="border-t border-white/10 bg-slate-950/90">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] uppercase tracking-widest text-slate-500 hover:text-slate-300"
        aria-expanded={open}
      >
        <span>{open ? '▾' : '▸'}</span>
        Event log
        <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">
          {events.length}
        </span>
        <span className="ml-auto normal-case tracking-normal text-slate-600">
          middleware → engines → UI
        </span>
      </button>

      {open && (
        <ul className="max-h-40 overflow-auto px-3 pb-2 font-mono text-[11px] leading-5">
          {recent.length === 0 && <li className="text-slate-500">No events yet.</li>}
          {recent.map((event) => (
            <li key={event.id} className="flex gap-2">
              <span className="text-slate-600">
                {new Date(event.at).toLocaleTimeString([], { hour12: false })}
              </span>
              <span className={toneFor(event.type)}>{event.type}</span>
              <span className="truncate text-slate-500">
                {JSON.stringify(event.payload).slice(0, 120)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
