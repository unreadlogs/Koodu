import type { PetEmotion, PetMode } from '@koodu/protocol';
import { ActionButton, Card, Pill, type PageProps } from './shared';

const MODES: Array<{ mode: PetMode; label: string; detail: string }> = [
  { mode: 'embedded', label: 'Embedded', detail: 'Docked beside the workspace.' },
  { mode: 'floating', label: 'Floating', detail: 'Draggable overlay above tabs.' },
  { mode: 'hidden', label: 'Hidden', detail: 'Commands still work; nothing renders.' },
];

const EMOTIONS: PetEmotion[] = ['neutral', 'happy', 'curious', 'confused', 'error'];

export function SettingsPage({ state, send }: PageProps) {
  const mode = state?.pet.mode ?? 'embedded';
  const emotion = state?.pet.emotion ?? 'neutral';

  return (
    <div className="space-y-4">
      <Card title="Pet display mode" hint="Handled by the switch_pet_mode action.">
        <div className="grid gap-2 sm:grid-cols-3">
          {MODES.map((option) => (
            <button
              key={option.mode}
              type="button"
              onClick={() => send('switch_pet_mode', { mode: option.mode })}
              className={`rounded-lg border p-2.5 text-left text-xs transition ${
                mode === option.mode
                  ? 'border-emerald-400/40 bg-emerald-500/10'
                  : 'border-white/10 bg-slate-950/50 hover:bg-white/5'
              }`}
            >
              <span className="flex items-center gap-2">
                <span className="font-medium text-slate-100">{option.label}</span>
                {mode === option.mode && <Pill tone="ok">current</Pill>}
              </span>
              <span className="mt-1 block text-slate-500">{option.detail}</span>
            </button>
          ))}
        </div>
      </Card>

      <Card title="Emotion" hint="Activity stays separate from emotion.">
        <div className="flex flex-wrap gap-1.5">
          {EMOTIONS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => send('set_pet_emotion', { emotion: value })}
              className={`rounded-md px-2.5 py-1 text-xs transition ${
                emotion === value
                  ? 'bg-violet-500/20 text-violet-100 ring-1 ring-violet-400/40'
                  : 'bg-white/5 text-slate-300 hover:bg-white/10'
              }`}
            >
              {value}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          Emotions decay back to neutral. Activity is driven by action lifecycle events, not by the
          model directly.
        </p>
      </Card>

      <Card title="Workspace recovery" hint="Reads the persisted snapshot, drops invalid tabs.">
        <div className="flex flex-wrap items-center gap-3">
          <ActionButton tone="primary" onClick={() => send('restore_workspace', {})}>
            Restore saved workspace
          </ActionButton>
          <span className="text-[11px] text-slate-500">
            {state?.tabs.length ?? 0} tab(s) open in this window.
          </span>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          Restoring is a confirm-risk action, so the middleware asks before replacing the current
          workspace.
        </p>
      </Card>

      <Card title="Current state" hint="Projection of the authoritative store.">
        <dl className="grid gap-2 text-xs sm:grid-cols-3">
          {[
            ['Mode', mode],
            ['Activity', state?.pet.activity ?? 'idle'],
            ['Emotion', emotion],
            ['AI status', state?.aiStatus ?? 'unknown'],
            ['Active route', state?.activeRoute ?? '—'],
            ['Tabs', String(state?.tabs.length ?? 0)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-slate-950/50 p-2">
              <dt className="text-[10px] uppercase tracking-widest text-slate-500">{label}</dt>
              <dd className="mt-0.5 truncate font-medium text-slate-200" title={value}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
