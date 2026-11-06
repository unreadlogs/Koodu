import { useState } from 'react';
import { useStore } from 'zustand';
import type { App } from '../app/createApp';
import { PetAvatar } from './PetAvatar';

/** Floating mode: draggable, position persisted through the store. */
export function FloatingPet({ app }: { app: App }) {
  const pet = useStore(app.store, (state) => state.pet);
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);

  if (pet.mode !== 'floating') return null;

  const clamp = (value: number, max: number): number =>
    Math.max(8, Math.min(max - 8, value));

  return (
    <div
      className="fixed z-40 touch-none"
      style={{ left: pet.position.x, top: pet.position.y }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        setOffset({ x: event.clientX - pet.position.x, y: event.clientY - pet.position.y });
      }}
      onPointerMove={(event) => {
        if (!offset) return;
        const x = clamp(event.clientX - offset.x, window.innerWidth - 160);
        const y = clamp(event.clientY - offset.y, window.innerHeight - 160);
        app.store.setState((state) => ({ pet: { ...state.pet, position: { x, y } } }));
      }}
      onPointerUp={() => setOffset(null)}
      onPointerCancel={() => setOffset(null)}
    >
      <div className="rounded-2xl border border-emerald-400/20 bg-slate-900/80 p-2 shadow-2xl shadow-black/50 backdrop-blur">
        <PetAvatar activity={pet.activity} emotion={pet.emotion} size={136} />
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="px-1 text-[11px] text-slate-300">{pet.emotion}</span>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              void app.dispatchAction(
                'switch_pet_mode',
                { mode: 'embedded' },
                { source: 'user' },
              );
            }}
            className="rounded bg-white/10 px-2 py-1 text-[11px] text-slate-200 hover:bg-white/20"
          >
            Dock
          </button>
        </div>
      </div>
    </div>
  );
}
