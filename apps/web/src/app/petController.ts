import type { AppEvent, EventDraft, PetEmotion, PetMode } from '@koodu/protocol';
import {
  DEFAULT_EMOTION_MS,
  reducePet,
  setPetEmotion,
  setPetMode,
  tickPet,
  type PetMachineState,
} from '../engines/pet';
import type { AppStore } from './store';

export interface PetController {
  state(): PetMachineState;
  /** Reduce an app event into pet behaviour; returns events to publish. */
  apply(event: AppEvent, now: number): EventDraft[];
  tick(now: number): EventDraft[];
  setMode(mode: PetMode): EventDraft[];
  setEmotion(emotion: PetEmotion, durationMs?: number): EventDraft[];
  restoreMode(mode: PetMode): void;
}

/**
 * The pet machine is authoritative for activity/emotion/mode. The store is a
 * projection so React can render it; engines never write React state directly.
 */
export function createPetController(
  store: AppStore,
  initial: PetMachineState,
  clock: () => number,
): PetController {
  let machine = initial;

  const sync = (): void => {
    const current = store.getState().pet;
    if (
      current.mode === machine.mode &&
      current.activity === machine.activity &&
      current.emotion === machine.emotion
    ) {
      return;
    }
    store.setState({
      pet: {
        ...current,
        mode: machine.mode,
        activity: machine.activity,
        emotion: machine.emotion,
      },
    });
  };

  const commit = (next: PetMachineState, events: EventDraft[]): EventDraft[] => {
    machine = next;
    sync();
    return events;
  };

  return {
    state: () => machine,

    apply(event, now) {
      const transition = reducePet(machine, event, now);
      return commit(transition.state, transition.events);
    },

    tick(now) {
      const transition = tickPet(machine, now);
      return commit(transition.state, transition.events);
    },

    setMode(mode) {
      const transition = setPetMode(machine, mode);
      return commit(transition.state, transition.events);
    },

    setEmotion(emotion, durationMs = DEFAULT_EMOTION_MS) {
      const transition = setPetEmotion(machine, emotion, clock(), durationMs);
      return commit(transition.state, transition.events);
    },

    restoreMode(mode) {
      machine = { ...machine, mode };
      sync();
    },
  };
}
