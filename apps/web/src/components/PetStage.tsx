import { useStore } from 'zustand';
import type { PetActivity, PetEmotion } from '@koodu/protocol';
import type { App } from '../app/createApp';
import { PetAvatar } from './PetAvatar';

const ACTIVITIES: PetActivity[] = ['idle', 'listening', 'thinking', 'working', 'talking', 'sleeping'];
const EMOTIONS: PetEmotion[] = ['neutral', 'happy', 'curious', 'confused', 'error'];

/**
 * Center homepage stage — large pet + sample action testing controls.
 * Sits above the workspace when no tab is focused, demonstrating the sprite
 * renderer end-to-end (manifest -> canvas -> activity/emotion).
 */
export function PetStage({ app }: { app: App }) {
  const pet = useStore(app.store, (state) => state.pet);

  const setEmotion = (emotion: PetEmotion) => {
    // Route through middleware action for authority
    void app.dispatchAction('set_pet_emotion', { emotion }, { source: 'user' });
  };

  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-white/10 bg-gradient-to-b from-slate-900/70 to-slate-950 p-4">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-slate-950">
          Companion
        </span>
        <span className="text-xs text-slate-400">
          {pet.activity} • {pet.emotion} • {pet.mode}
        </span>
      </div>

      <div className="rounded-2xl bg-slate-900/40 p-2">
        <PetAvatar activity={pet.activity} emotion={pet.emotion} size={240} character="kumo" />
      </div>

      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {ACTIVITIES.map((a) => (
          <span
            key={a}
            title={a === pet.activity ? 'Active (driven by middleware events)' : 'Activity is event-driven; cycle via intent/action'}
            className={`rounded-full px-2 py-1 text-[11px] ${
              a === pet.activity
                ? 'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/40'
                : 'bg-white/5 text-slate-400'
            }`}
          >
            {a}
          </span>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <span className="text-[11px] uppercase tracking-widest text-slate-500">Emotion:</span>
        {EMOTIONS.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => setEmotion(e)}
            className={`rounded-full px-2 py-1 text-[11px] transition ${
              e === pet.emotion
                ? 'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/40'
                : 'bg-white/5 text-slate-300 hover:bg-white/10'
            }`}
          >
            {e}
          </button>
        ))}
      </div>

      <p className="text-center text-[11px] text-slate-500">
        Sample test: command bar actions + WS ping drive activity. Emotions override the clip for their duration.
      </p>
    </div>
  );
}
