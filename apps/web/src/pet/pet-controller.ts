import { create } from 'zustand';

export const PET_ACTIVITIES = ['idle', 'listening', 'thinking', 'working', 'talking', 'happy', 'confused', 'error', 'sleeping'] as const;
export type PetActivity = (typeof PET_ACTIVITIES)[number];
export type PetEmotion = 'neutral' | 'happy' | 'confused' | 'sad' | 'excited';
export type PetMode = 'floating' | 'embedded' | 'hidden';

type PetControllerState = {
  activity: PetActivity;
  emotion: PetEmotion;
  mode: PetMode;
  setActivity: (activity: PetActivity) => void;
  setEmotion: (emotion: PetEmotion) => void;
  setMode: (mode: PetMode) => void;
  dispatchAction: (action: 'listen' | 'think' | 'work' | 'speak' | 'celebrate' | 'reset') => void;
};

/** Frontend authority for pet presentation state; engines/UI can dispatch named actions. */
export const usePetController = create<PetControllerState>((set) => ({
  activity: 'idle',
  emotion: 'neutral',
  mode: 'embedded',
  setActivity: (activity) => set({ activity }),
  setEmotion: (emotion) => set({ emotion }),
  setMode: (mode) => set({ mode }),
  dispatchAction: (action) => set((state) => {
    switch (action) {
      case 'listen': return { activity: 'listening' };
      case 'think': return { activity: 'thinking' };
      case 'work': return { activity: 'working' };
      case 'speak': return { activity: 'talking' };
      case 'celebrate': return { activity: 'happy', emotion: 'happy' };
      case 'reset': return { activity: 'idle', emotion: 'neutral' };
      default: return state;
    }
  }),
}));
