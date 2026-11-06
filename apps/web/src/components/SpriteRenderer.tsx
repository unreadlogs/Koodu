import { useEffect, useRef, useState } from 'react';
import type { PetActivity, PetEmotion } from '@koodu/protocol';
import {
  clipFor,
  frameOffset,
  normalizeRawManifest,
  parseManifest,
  type CharacterManifest,
} from '../engines/pet';

export interface SpriteRendererProps {
  activity: PetActivity;
  emotion: PetEmotion;
  size?: number;
  character?: string;
  className?: string;
}

/**
 * Canvas spritesheet player. Loads the manifest + frames from
 * /companion/<character>/, normalises kumo/kitsu shapes, and animates
 * independently of model latency (requestAnimationFrame + manifest fps).
 */
export function SpriteRenderer({
  activity,
  emotion,
  size = 192,
  character = 'kumo',
  className,
}: SpriteRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef(performance.now());
  const [manifest, setManifest] = useState<CharacterManifest | null>(null);
  const [images, setImages] = useState<Map<string, HTMLImageElement>>(new Map());
  const [error, setError] = useState<string | null>(null);

  // Load manifest + images
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/companion/${character}/animation_manifest.json`);
        if (!res.ok) throw new Error(`manifest ${res.status}`);
        const raw = await res.json();
        const normalized = normalizeRawManifest(raw);
        const parsed = parseManifest(normalized);
        if (!parsed.ok) {
          throw new Error(parsed.issues.map((i) => i.message).join('; '));
        }
        if (cancelled) return;
        setManifest(parsed.manifest);

        const map = new Map<string, HTMLImageElement>();
        const files = new Set<string>();
        for (const clip of Object.values(parsed.manifest.animations)) files.add(clip.file);
        for (const clip of Object.values(parsed.manifest.expressions)) files.add(clip.file);

        await Promise.all(
          [...files].map(
            (file) =>
              new Promise<void>((resolve, reject) => {
                const img = new Image();
                img.onload = () => {
                  map.set(file, img);
                  resolve();
                };
                img.onerror = () => reject(new Error(`image_${file}`));
                img.src = `/companion/${character}/${file}`;
              }),
          ),
        );
        if (!cancelled) setImages(map);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'load_failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [character]);

  // Heartbeat + frame repaint
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !manifest) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = (now: number) => {
      const clip = clipFor(manifest, activity, emotion);
      const img = images.get(clip.file);
      if (img) {
        const elapsed = (now - startRef.current) / 1000;
        const frameFloat = elapsed * clip.fps;
        let idx = Math.floor(frameFloat) % clip.frameCount;
        if (!clip.loop && frameFloat >= clip.frameCount) {
          idx = clip.frameCount - 1;
        }
        const offset = frameOffset(clip, idx);
        if (offset) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          const scale = canvas.width / clip.frameWidth;
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(
            img,
            offset.x,
            offset.y,
            clip.frameWidth,
            clip.frameHeight,
            0,
            0,
            canvas.width,
            canvas.height * (clip.frameHeight / clip.frameWidth) * (1 / scale) * scale * (canvas.height / canvas.width),
          );
          // Actually draw proportionally: use square canvas, draw full frame scaled to canvas
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(
            img,
            offset.x,
            offset.y,
            clip.frameWidth,
            clip.frameHeight,
            0,
            0,
            canvas.width,
            canvas.height,
          );
        }
      } else {
        // Loading placeholder
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [manifest, images, activity, emotion]);

  // Reset clock on activity change so animation restarts cleanly
  useEffect(() => {
    startRef.current = performance.now();
  }, [activity, emotion]);

  if (error) {
    return (
      <div
        role="img"
        aria-label={`${activity} ${emotion} (sprite failed to load)`}
        style={{ width: size, height: size }}
        className={`grid place-items-center rounded-xl bg-slate-800/80 text-xs text-slate-400 ${className ?? ''}`}
      >
        <div className="text-center">
          <p>Sprite failed to load</p>
          <p className="font-mono text-[10px] leading-tight">{error}</p>
          <p className="mt-1 text-[10px]">Check /companion/{character}/</p>
        </div>
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      width={512}
      height={512}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Pet is ${activity} and looks ${emotion}`}
      className={className ?? 'drop-shadow-xl'}
    />
  );
}
