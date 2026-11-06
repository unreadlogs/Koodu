import type { PetActivity, PetEmotion } from '@koodu/protocol';
import { SpriteRenderer } from './SpriteRenderer';

export interface PetAvatarProps {
  activity: PetActivity;
  emotion: PetEmotion;
  size?: number;
  character?: string;
}

/**
 * Pet renderer — spritesheet canvas when assets load, CSS placeholder fallback.
 * Activity (what it's doing) and emotion (expression clip) stay orthogonal.
 */
export function PetAvatar({ activity, emotion, size = 168, character = 'kumo' }: PetAvatarProps) {
  return (
    <div
      className="relative select-none"
      style={{ width: size, height: size }}
      title={`Pet: ${activity} • ${emotion}`}
    >
      <SpriteRenderer activity={activity} emotion={emotion} size={size} character={character} />
      <div className="absolute bottom-2 right-3 rounded-full bg-slate-950/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-300">
        {activity}
      </div>
    </div>
  );
}
