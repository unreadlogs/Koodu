import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative as relativePath, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { ToolDefinition } from './types';

export const MAX_FILE_BYTES = 200_000;
const MAX_LIST_ENTRIES = 200;
const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', '.cache']);

/**
 * Resolve a model-supplied path inside the workspace root. Absolute paths,
 * null bytes, and traversal outside the root are rejected.
 */
export function resolveWorkspacePath(root: string, input: string): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed.includes('\0') || isAbsolute(trimmed)) return null;
  const normalizedRoot = resolve(root);
  const resolved = resolve(normalizedRoot, trimmed);
  if (resolved !== normalizedRoot && !resolved.startsWith(`${normalizedRoot}${sep}`)) return null;
  return resolved;
}

function displayPath(root: string, absolute: string): string {
  const rel = relativePath(resolve(root), absolute);
  return rel ? rel.split(sep).join('/') : '.';
}

async function assertTextFile(path: string): Promise<string> {
  const info = await stat(path);
  if (!info.isFile()) throw new Error('Path is not a regular file.');
  if (info.size > MAX_FILE_BYTES) throw new Error(`File is larger than the ${MAX_FILE_BYTES}-byte limit.`);
  const content = await readFile(path, 'utf8');
  if (content.includes('\0')) throw new Error('File appears to be binary; only text files are supported.');
  return content;
}

async function walk(root: string, start: string, recursive: boolean, output: string[]): Promise<void> {
  if (output.length >= MAX_LIST_ENTRIES) return;
  const entries = await readdir(start, { withFileTypes: true });
  entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (output.length >= MAX_LIST_ENTRIES) return;
    if (entry.name.startsWith('.') || SKIP_DIRECTORIES.has(entry.name)) continue;
    const absolute = resolve(start, entry.name);
    const shown = displayPath(root, absolute);
    output.push(`${entry.isDirectory() ? 'dir ' : 'file'}  ${shown}`);
    if (recursive && entry.isDirectory()) await walk(root, absolute, true, output);
  }
}

export const fileTools: ToolDefinition[] = [
  {
    name: 'list_files',
    description: 'List files and directories inside the Koodu workspace. Paths are relative to the workspace root.',
    risk: 'safe',
    parameters: {
      path: 'string — optional relative directory (default ".")',
      recursive: 'boolean — optional, walk subdirectories (default false)',
    },
    schema: z
      .object({
        path: z.string().max(500).optional(),
        recursive: z.boolean().optional(),
      })
      .strict(),
    async execute(args, context) {
      const target = resolveWorkspacePath(context.workspaceRoot, String(args.path ?? '.'));
      if (!target) return { ok: false, content: 'Invalid path. Use a relative path inside the workspace.' };
      const info = await stat(target).catch(() => null);
      if (!info) return { ok: false, content: `Path not found: ${String(args.path ?? '.')}` };
      if (!info.isDirectory()) return { ok: false, content: 'Path is not a directory.' };
      const output: string[] = [];
      await walk(context.workspaceRoot, target, args.recursive === true, output);
      if (!output.length) return 'The directory is empty.';
      const suffix = output.length >= MAX_LIST_ENTRIES ? `\n…[showing first ${MAX_LIST_ENTRIES} entries]` : '';
      return `${output.join('\n')}${suffix}`;
    },
  },
  {
    name: 'read_file',
    description: 'Read a UTF-8 text file inside the Koodu workspace.',
    risk: 'safe',
    parameters: {
      path: 'string — relative file path (required)',
    },
    schema: z.object({ path: z.string().trim().min(1).max(500) }).strict(),
    async execute(args, context) {
      const target = resolveWorkspacePath(context.workspaceRoot, String(args.path));
      if (!target) return { ok: false, content: 'Invalid path. Use a relative path inside the workspace.' };
      const content = await assertTextFile(target).catch((error: unknown) => {
        throw new Error(error instanceof Error ? error.message : 'Could not read file.');
      });
      return `File: ${displayPath(context.workspaceRoot, target)} (${Buffer.byteLength(content, 'utf8')} bytes)\n---\n${content}`;
    },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a UTF-8 text file inside the Koodu workspace. Parent directories are created automatically.',
    risk: 'confirm',
    parameters: {
      path: 'string — relative file path (required)',
      content: 'string — full file content (required, max 200000 chars)',
    },
    schema: z
      .object({
        path: z.string().trim().min(1).max(500),
        content: z.string().max(MAX_FILE_BYTES),
      })
      .strict(),
    async execute(args, context) {
      const target = resolveWorkspacePath(context.workspaceRoot, String(args.path));
      if (!target) return { ok: false, content: 'Invalid path. Use a relative path inside the workspace.' };
      const content = String(args.content);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, 'utf8');
      return `Wrote ${Buffer.byteLength(content, 'utf8')} bytes to ${displayPath(context.workspaceRoot, target)}.`;
    },
  },
  {
    name: 'append_file',
    description: 'Append text to a file inside the Koodu workspace, creating it when missing.',
    risk: 'confirm',
    parameters: {
      path: 'string — relative file path (required)',
      content: 'string — text to append (required, max 200000 chars)',
    },
    schema: z
      .object({
        path: z.string().trim().min(1).max(500),
        content: z.string().min(1).max(MAX_FILE_BYTES),
      })
      .strict(),
    async execute(args, context) {
      const target = resolveWorkspacePath(context.workspaceRoot, String(args.path));
      if (!target) return { ok: false, content: 'Invalid path. Use a relative path inside the workspace.' };
      const content = String(args.content);
      const existing = await readFile(target, 'utf8').catch(() => '');
      if (Buffer.byteLength(existing + content, 'utf8') > MAX_FILE_BYTES) {
        return { ok: false, content: `Appending would exceed the ${MAX_FILE_BYTES}-byte file limit.` };
      }
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, existing + content, 'utf8');
      return `Appended ${Buffer.byteLength(content, 'utf8')} bytes to ${displayPath(context.workspaceRoot, target)}.`;
    },
  },
  {
    name: 'replace_in_file',
    description: 'Replace exact text inside an existing workspace file. Fails when the old text is absent or ambiguous.',
    risk: 'confirm',
    parameters: {
      path: 'string — relative file path (required)',
      oldText: 'string — exact text to find (required)',
      newText: 'string — replacement text (required)',
      replaceAll: 'boolean — optional, replace every occurrence (default false)',
    },
    schema: z
      .object({
        path: z.string().trim().min(1).max(500),
        oldText: z.string().min(1).max(20_000),
        newText: z.string().max(MAX_FILE_BYTES),
        replaceAll: z.boolean().optional(),
      })
      .strict(),
    async execute(args, context) {
      const target = resolveWorkspacePath(context.workspaceRoot, String(args.path));
      if (!target) return { ok: false, content: 'Invalid path. Use a relative path inside the workspace.' };
      const oldText = String(args.oldText);
      const newText = String(args.newText);
      const content = await assertTextFile(target);
      const occurrences = content.split(oldText).length - 1;
      if (!occurrences) return { ok: false, content: 'The old text was not found in the file.' };
      if (occurrences > 1 && args.replaceAll !== true) {
        return { ok: false, content: `The old text occurs ${occurrences} times. Provide more context or set replaceAll=true.` };
      }
      const updated = args.replaceAll === true ? content.split(oldText).join(newText) : content.replace(oldText, newText);
      if (Buffer.byteLength(updated, 'utf8') > MAX_FILE_BYTES) {
        return { ok: false, content: `The updated file would exceed the ${MAX_FILE_BYTES}-byte limit.` };
      }
      await writeFile(target, updated, 'utf8');
      return `Replaced ${args.replaceAll === true ? occurrences : 1} occurrence(s) in ${displayPath(context.workspaceRoot, target)}.`;
    },
  },
];
