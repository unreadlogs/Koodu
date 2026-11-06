import {
  petActivitySchema,
  petEmotionSchema,
  type PetActivity,
  type PetEmotion,
} from '@koodu/protocol';
import { z } from 'zod';

export const animationClipSchema = z.object({
  file: z.string().min(1),
  frameCount: z.number().int().positive(),
  frameWidth: z.number().int().positive(),
  frameHeight: z.number().int().positive(),
  fps: z.number().positive().max(60),
  loop: z.boolean(),
  /** `strip` = one row, `grid` = rows of `columns` frames. */
  layout: z.enum(['strip', 'grid']).default('strip'),
  columns: z.number().int().positive().optional(),
  margin: z.number().int().nonnegative().default(0),
  spacing: z.number().int().nonnegative().default(0),
  anchor: z.enum(['bottom', 'center']).default('bottom'),
});
export type AnimationClip = z.infer<typeof animationClipSchema>;

/**
 * The manifest is the only source of frame metadata.
 * - `animations` is keyed by pet activity, so the state machine and renderer
 *   cannot drift; unknown keys are rejected.
 * - `expressions` is keyed by pet emotion and is optional; an expression clip
 *   overrides the activity clip while the emotion is active.
 */
export const characterManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.literal(1),
  scale: z.number().positive().default(1),
  animations: z.record(z.string(), animationClipSchema),
  expressions: z.record(z.string(), animationClipSchema).default({}),
});
export type CharacterManifest = z.infer<typeof characterManifestSchema>;

export interface ManifestIssue {
  severity: 'error' | 'warning';
  message: string;
}

const ACTIVITIES = new Set<string>(petActivitySchema.options);
const EMOTIONS = new Set<string>(petEmotionSchema.options);

/**
 * Accept the raw asset-manifest shapes and map them onto the canonical schema.
 *
 * Two asset formats exist in `assets/companion/<name>/animation_manifest.json`:
 * - kumo: `{ character: "panda", animations: { idle: …, happy: …, … } }`
 * - kitsu: a flat clip map `{ idle: clip, happy: clip, … }`
 *
 * Both mix activity and emotion clips in one map. Normalisation splits them into
 * `animations` (activities) and `expressions` (emotions); unknown keys pass
 * through into `animations` so `parseManifest` rejects them with a clear error.
 */
export function normalizeRawManifest(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {};

  const source = raw as Record<string, unknown>;
  const flat = isRecord(source.animations) ? source.animations : source;
  const id =
    (typeof source.character === 'string' && source.character) ||
    (typeof source.id === 'string' && source.id) ||
    'character';
  const name =
    (typeof source.name === 'string' && source.name) ||
    id.charAt(0).toUpperCase() + id.slice(1);

  const animations: Record<string, unknown> = {};
  const expressions: Record<string, unknown> = {};

  for (const [key, clip] of Object.entries(flat)) {
    if (EMOTIONS.has(key)) {
      expressions[key] = clip;
    } else {
      // Activities and unknowns; the validator rejects unknown activity names.
      animations[key] = clip;
    }
  }

  return { id, name, version: 1, scale: 1, animations, expressions };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateManifest(manifest: CharacterManifest): ManifestIssue[] {
  const issues: ManifestIssue[] = [];

  if (!manifest.animations.idle) {
    issues.push({ severity: 'error', message: 'manifest requires an "idle" animation' });
  }

  if (manifest.expressions.neutral) {
    issues.push({
      severity: 'warning',
      message: 'expressions.neutral is ignored; neutral uses the activity clip',
    });
  }

  for (const [name, clip] of Object.entries(manifest.expressions)) {
    if (!EMOTIONS.has(name)) {
      issues.push({ severity: 'error', message: `expression "${name}": not a pet emotion` });
    }
    if (clip.fps > 30) {
      issues.push({ severity: 'warning', message: `${name}: fps above 30 is usually unnecessary` });
    }
  }

  for (const [name, clip] of Object.entries(manifest.animations)) {
    if (!clip) continue;
    if (!ACTIVITIES.has(name)) {
      issues.push({
        severity: 'error',
        message: `${name}: not a pet activity (${[...ACTIVITIES].join(', ')})`,
      });
    }
    if (clip.layout === 'grid') {
      if (clip.columns === undefined) {
        issues.push({
          severity: 'error',
          message: `${name}: grid layout requires "columns"`,
        });
      } else if (clip.frameCount > clip.columns * 64) {
        issues.push({
          severity: 'warning',
          message: `${name}: ${clip.frameCount} frames on ${clip.columns} columns looks wrong`,
        });
      }
    }
    if (!clip.file.endsWith('.png') && !clip.file.endsWith('.webp')) {
      issues.push({
        severity: 'warning',
        message: `${name}: expected a png or webp spritesheet`,
      });
    }
    if (clip.fps > 30) {
      issues.push({ severity: 'warning', message: `${name}: fps above 30 is usually unnecessary` });
    }
  }

  return issues;
}

export function parseManifest(input: unknown):
  | { ok: true; manifest: CharacterManifest; issues: ManifestIssue[] }
  | { ok: false; issues: ManifestIssue[] } {
  const parsed = characterManifestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        severity: 'error' as const,
        message: `${issue.path.join('.') || 'manifest'}: ${issue.message}`,
      })),
    };
  }
  const issues = validateManifest(parsed.data);
  if (issues.some((issue) => issue.severity === 'error')) {
    return { ok: false, issues };
  }
  return { ok: true, manifest: parsed.data, issues };
}

/** Top-left pixel offset of a frame inside its spritesheet. */
export function frameOffset(
  clip: AnimationClip,
  index: number,
): { x: number; y: number } | null {
  if (!Number.isInteger(index) || index < 0 || index >= clip.frameCount) return null;
  const columns =
    clip.layout === 'grid' ? (clip.columns ?? clip.frameCount) : clip.frameCount;
  if (columns <= 0) return null;
  const column = index % columns;
  const row = Math.floor(index / columns);
  return {
    x: clip.margin + column * (clip.frameWidth + clip.spacing),
    y: clip.margin + row * (clip.frameHeight + clip.spacing),
  };
}

/** Expression clips win while an emotion is active, then activity art. */
export function clipFor(
  manifest: CharacterManifest,
  activity: PetActivity,
  emotion: PetEmotion = 'neutral',
): AnimationClip {
  const expression = emotion === 'neutral' ? undefined : manifest.expressions[emotion];
  return (
    expression ??
    manifest.animations[activity] ??
    manifest.animations.idle ??
    missingIdle()
  );
}

function missingIdle(): AnimationClip {
  throw new Error('manifest has no idle animation');
}
