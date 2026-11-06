import type {
  AppEvent,
  EventDraft,
  EventType,
  PetActivity,
  PetEmotion,
  PetMode,
} from '@koodu/protocol';

export interface PetMachineState {
  activity: PetActivity;
  emotion: PetEmotion;
  mode: PetMode;
  /** Wall clock deadline for the current activity, null means event-driven. */
  activityUntil: number | null;
  emotionUntil: number | null;
  lastActiveAt: number;
}

export interface PetTransition {
  state: PetMachineState;
  events: EventDraft[];
}

export const DEFAULT_ACTIVITY_MS = 6_000;
export const DEFAULT_EMOTION_MS = 2_500;
export const SLEEP_AFTER_MS = 180_000;

export function createPetMachineState(
  now: number,
  overrides: Partial<PetMachineState> = {},
): PetMachineState {
  return {
    activity: 'idle',
    emotion: 'neutral',
    mode: 'embedded',
    activityUntil: null,
    emotionUntil: null,
    lastActiveAt: now,
    ...overrides,
  };
}

interface Reaction {
  activity?: PetActivity;
  activityMs?: number | null;
  emotion?: PetEmotion;
  emotionMs?: number | null;
}

/** Deterministic mapping from app events to pet behaviour. */
const REACTIONS: Partial<Record<EventType, Reaction>> = {
  'intent.received': { activity: 'listening', activityMs: 5_000 },
  'intent.proposed': { activity: 'thinking', activityMs: 12_000 },
  'intent.rejected': { activity: 'idle', emotion: 'confused' },
  'action.approval.requested': { activity: 'idle', emotion: 'curious', emotionMs: 8_000 },
  'action.started': { activity: 'working', activityMs: null },
  'action.completed': { activity: 'idle', emotion: 'happy' },
  'action.failed': { activity: 'idle', emotion: 'error', emotionMs: 6_000 },
  'action.denied': { activity: 'idle', emotion: 'confused' },
  'agent.task.created': { activity: 'working', activityMs: null },
  'persistence.restored': { activity: 'idle', emotion: 'happy' },
  'persistence.failed': { activity: 'idle', emotion: 'error', emotionMs: 8_000 },
  'intelligence.status': { activity: 'idle', emotion: 'confused', emotionMs: 3_000 },
};

function reactionFor(event: AppEvent): Reaction | null {
  if (event.type === 'agent.task.updated') {
    if (event.payload.status === 'completed') return { activity: 'idle', emotion: 'happy' };
    if (event.payload.status === 'failed') {
      return { activity: 'idle', emotion: 'error', emotionMs: 6_000 };
    }
    if (event.payload.status === 'running') return { activity: 'working', activityMs: null };
    return { activity: 'idle' };
  }
  if (event.type === 'system.notice') {
    return event.payload.level === 'error'
      ? { activity: 'idle', emotion: 'error', emotionMs: 6_000 }
      : null;
  }
  return REACTIONS[event.type] ?? null;
}

function changeActivity(
  state: PetMachineState,
  to: PetActivity,
  until: number | null,
): PetTransition {
  if (state.activity === to) {
    return { state: { ...state, activityUntil: until }, events: [] };
  }
  return {
    state: { ...state, activity: to, activityUntil: until },
    events: [{ type: 'pet.activity.changed', payload: { from: state.activity, to } }],
  };
}

function changeEmotion(
  state: PetMachineState,
  to: PetEmotion,
  until: number | null,
): PetTransition {
  if (state.emotion === to) {
    return { state: { ...state, emotionUntil: until }, events: [] };
  }
  return {
    state: { ...state, emotion: to, emotionUntil: until },
    events: [{ type: 'pet.emotion.changed', payload: { from: state.emotion, to } }],
  };
}

function changeMode(state: PetMachineState, to: PetMode): PetTransition {
  if (state.mode === to) return { state, events: [] };
  return {
    state: { ...state, mode: to },
    events: [{ type: 'pet.mode.changed', payload: { from: state.mode, to } }],
  };
}

/** Imperative mode change for the `switch_pet_mode` action. */
export function setPetMode(state: PetMachineState, mode: PetMode): PetTransition {
  return changeMode(state, mode);
}

/** Imperative emotion change for the `set_pet_emotion` action. */
export function setPetEmotion(
  state: PetMachineState,
  emotion: PetEmotion,
  now: number,
  durationMs: number = DEFAULT_EMOTION_MS,
): PetTransition {
  const until = emotion === 'neutral' ? null : now + durationMs;
  return changeEmotion(state, emotion, until);
}

export function reducePet(
  state: PetMachineState,
  event: AppEvent,
  now: number,
): PetTransition {
  if (event.type === 'pet.mode.changed') {
    return changeMode(state, event.payload.to);
  }
  // Never let our own derived events feed back into the reaction table.
  if (event.type === 'pet.activity.changed' || event.type === 'pet.emotion.changed') {
    return { state, events: [] };
  }

  const reaction = reactionFor(event);
  if (!reaction) return { state, events: [] };

  let current: PetMachineState = { ...state, lastActiveAt: now };
  const events: EventDraft[] = [];

  if (reaction.activity) {
    const activityUntil =
      reaction.activityMs === null
        ? null
        : now + (reaction.activityMs ?? DEFAULT_ACTIVITY_MS);
    const step = changeActivity(current, reaction.activity, activityUntil);
    current = step.state;
    events.push(...step.events);
  }

  if (reaction.emotion) {
    const emotionUntil =
      reaction.emotionMs === null ? null : now + (reaction.emotionMs ?? DEFAULT_EMOTION_MS);
    const step = changeEmotion(current, reaction.emotion, emotionUntil);
    current = step.state;
    events.push(...step.events);
  }

  return { state: current, events };
}

/** Advances timers: activity/emotion decay back to idle/neutral, then sleep. */
export function tickPet(state: PetMachineState, now: number): PetTransition {
  let current = state;
  const events: EventDraft[] = [];

  if (
    current.activityUntil !== null &&
    now >= current.activityUntil &&
    current.activity !== 'idle' &&
    current.activity !== 'sleeping'
  ) {
    const step = changeActivity(current, 'idle', null);
    current = step.state;
    events.push(...step.events);
  }

  if (
    current.emotionUntil !== null &&
    now >= current.emotionUntil &&
    current.emotion !== 'neutral'
  ) {
    const step = changeEmotion(current, 'neutral', null);
    current = step.state;
    events.push(...step.events);
  }

  if (current.activity === 'idle' && now - current.lastActiveAt >= SLEEP_AFTER_MS) {
    const step = changeActivity(current, 'sleeping', null);
    current = step.state;
    events.push(...step.events);
  }

  return { state: current, events };
}
