import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { AppEvent } from '@koodu/protocol';
import {
  SLEEP_AFTER_MS,
  createPetMachineState,
  normalizeRawManifest,
  parseManifest,
  frameOffset,
  reducePet,
  tickPet,
  type PetMachineState,
} from './index';

/** The real asset manifest — normalised at the boundary, like the renderer will. */
const raw = JSON.parse(
  readFileSync(
    new URL('../../../../../assets/companion/kumo/animation_manifest.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>;

const panda = normalizeRawManifest(raw) as {
  id: string;
  name: string;
  version: 1;
  animations: Record<string, { frameCount: number }>;
  expressions: Record<string, { frameCount: number }>;
};

const T0 = 1_700_000_000_000;

function event<K extends AppEvent['type']>(
  type: K,
  payload: Extract<AppEvent, { type: K }>['payload'],
  at = T0,
): AppEvent {
  return {
    id: `evt-${type}`,
    type,
    version: 1,
    at,
    source: 'middleware',
    correlationId: null,
    causationId: null,
    payload,
  } as AppEvent;
}

function state(overrides: Partial<PetMachineState> = {}): PetMachineState {
  return createPetMachineState(T0, overrides);
}

describe('pet reactions', () => {
  it('listens on input, thinks on a proposal, works on action start', () => {
    const listened = reducePet(state(), event('intent.received', { inputId: 'i1', text: 'hi' }), T0);
    expect(listened.state.activity).toBe('listening');

    const thought = reducePet(
      listened.state,
      event('intent.proposed', {
        inputId: 'i1',
        text: 'hi',
        provider: 'rules',
        confidence: 1,
        action: 'open_tab',
      }),
      T0,
    );
    expect(thought.state.activity).toBe('thinking');

    const started = reducePet(
      thought.state,
      event('action.started', {
        action: 'open_tab',
        args: {},
        source: 'local',
        risk: 'safe',
      }),
      T0,
    );
    expect(started.state.activity).toBe('working');
    expect(started.state.activityUntil).toBeNull();
    expect(started.events.map((e) => e.type)).toContain('pet.activity.changed');
  });

  it('becomes happy then decays to neutral', () => {
    const completed = reducePet(
      state({ activity: 'working' }),
      event('action.completed', { action: 'open_tab', durationMs: 5, message: 'ok' }),
      T0,
    );
    expect(completed.state.activity).toBe('idle');
    expect(completed.state.emotion).toBe('happy');

    const later = tickPet(completed.state, T0 + 10_000);
    expect(later.state.emotion).toBe('neutral');
  });

  it('shows error on failure and confusion on denial', () => {
    const failed = reducePet(
      state({ activity: 'working' }),
      event('action.failed', { action: 'open_tab', reason: 'boom' }),
      T0,
    );
    expect(failed.state.emotion).toBe('error');

    const denied = reducePet(
      state(),
      event('action.denied', { action: 'close_tab', reason: 'approval_required' }),
      T0,
    );
    expect(denied.state.emotion).toBe('confused');
  });

  it('does not react to its own derived events', () => {
    const before = state({ activity: 'working', emotion: 'happy' });
    const noop = reducePet(
      before,
      event('pet.activity.changed', { from: 'idle', to: 'working' }),
      T0,
    );
    expect(noop.events).toHaveLength(0);
    expect(noop.state).toBe(before);
  });

  it('tracks display mode independently of activity', () => {
    const floating = reducePet(
      state({ activity: 'working' }),
      event('pet.mode.changed', { from: 'embedded', to: 'floating' }),
      T0,
    );
    expect(floating.state.mode).toBe('floating');
    expect(floating.state.activity).toBe('working');
  });
});

describe('pet timers', () => {
  it('returns a timed-out activity to idle', () => {
    const listening = reducePet(
      state(),
      event('intent.received', { inputId: 'i1', text: 'hi' }),
      T0,
    );
    const still = tickPet(listening.state, T0 + 1_000);
    expect(still.state.activity).toBe('listening');
    const expired = tickPet(listening.state, T0 + 6_000);
    expect(expired.state.activity).toBe('idle');
  });

  it('sleeps after prolonged inactivity', () => {
    const slept = tickPet(state(), T0 + SLEEP_AFTER_MS + 1);
    expect(slept.state.activity).toBe('sleeping');
    const woke = reducePet(
      slept.state,
      event('intent.received', { inputId: 'i2', text: 'wake' }),
      T0 + SLEEP_AFTER_MS + 2,
    );
    expect(woke.state.activity).toBe('listening');
  });

  it('is a no-op before any deadline', () => {
    const result = tickPet(state(), T0 + 10);
    expect(result.events).toHaveLength(0);
  });
});

describe('manifest', () => {
  it('accepts the panda fixture', () => {
    const parsed = parseManifest(panda);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.manifest.animations.idle?.frameCount).toBe(6);
  });

  it('requires an idle animation', () => {
    const { idle: _idle, ...rest } = panda.animations;
    const parsed = parseManifest({ ...panda, animations: rest });
    expect(parsed.ok).toBe(false);
  });

  it('rejects unknown animation names', () => {
    const parsed = parseManifest({
      ...panda,
      animations: { ...panda.animations, dancing: panda.animations.idle },
    });
    expect(parsed.ok).toBe(false);
  });

  it('keeps expressions separate from activities', () => {
    const parsed = parseManifest({
      ...panda,
      expressions: { ...panda.expressions, angry: panda.animations.idle },
    });
    expect(parsed.ok).toBe(false);
  });

  it('computes strip and grid frame offsets from the manifest', () => {
    const clip = {
      file: 'x.png',
      frameCount: 6,
      frameWidth: 64,
      frameHeight: 64,
      fps: 8,
      loop: true,
      layout: 'strip' as const,
      margin: 2,
      spacing: 4,
      anchor: 'bottom' as const,
    };
    expect(frameOffset(clip, 0)).toEqual({ x: 2, y: 2 });
    expect(frameOffset(clip, 2)).toEqual({ x: 2 + 2 * 68, y: 2 });
    expect(frameOffset(clip, 6)).toBeNull();

    const grid = { ...clip, layout: 'grid' as const, columns: 3 };
    expect(frameOffset(grid, 3)).toEqual({ x: 2, y: 2 + 68 });
  });
});
