import { useStore } from 'zustand';
import type { PetMode } from '@koodu/protocol';
import type { App } from '../app/createApp';
import { PetAvatar } from './PetAvatar';

function ModeButtons({ app, current }: { app: App; current: PetMode }) {
  const modes: Array<{ mode: PetMode; label: string }> = [
    { mode: 'embedded', label: 'Docked' },
    { mode: 'floating', label: 'Floating' },
    { mode: 'hidden', label: 'Hidden' },
  ];

  return (
    <div className="flex flex-wrap gap-1">
      {modes.map(({ mode, label }) => (
        <button
          key={mode}
          type="button"
          onClick={() => void app.dispatchAction('switch_pet_mode', { mode }, { source: 'user' })}
          className={`rounded-md px-2 py-1 text-xs transition ${
            current === mode
              ? 'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/40'
              : 'bg-white/5 text-slate-300 hover:bg-white/10'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function PetDock({ app }: { app: App }) {
  const pet = useStore(app.store, (state) => state.pet);
  if (pet.mode !== 'embedded') return null;

  return (
    <aside className="hidden w-64 shrink-0 flex-col gap-4 border-l border-white/10 bg-slate-900/50 p-4 lg:flex">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Companion</p>
        <p className="mt-1 text-sm text-slate-300">Deterministic state, independent of the model.</p>
      </div>

      <div className="flex justify-center rounded-2xl border border-white/5 bg-slate-950/60 py-4">
        <PetAvatar activity={pet.activity} emotion={pet.emotion} size={176} />
      </div>

      <dl className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-white/5 p-2">
          <dt className="text-slate-400">Activity</dt>
          <dd className="font-medium text-slate-100">{pet.activity}</dd>
        </div>
        <div className="rounded-lg bg-white/5 p-2">
          <dt className="text-slate-400">Emotion</dt>
          <dd className="font-medium text-slate-100">{pet.emotion}</dd>
        </div>
      </dl>

      <div className="mt-auto space-y-2">
        <p className="text-xs text-slate-400">Display mode</p>
        <ModeButtons app={app} current={pet.mode} />
      </div>
    </aside>
  );
}
