import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDefaultToolRegistry, resolveWorkspacePath } from './index';
import type { ToolContext } from './types';

const contexts: string[] = [];

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'koodu-workspace-'));
  contexts.push(dir);
  return dir;
}

function context(root: string): ToolContext {
  return {
    taskId: 'test-task',
    database: {} as Database.Database,
    memory: {
      search_memory: async () => 'No relevant memories found.',
      save_memory: async () => 1,
    },
    skills: { listEnabled: () => [], resolve: () => null } as unknown as ToolContext['skills'],
    workspaceRoot: root,
  };
}

afterEach(() => {
  for (const dir of contexts.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('workspace path safety', () => {
  it('accepts relative paths and rejects escapes or absolute paths', () => {
    const root = workspace();
    expect(resolveWorkspacePath(root, 'notes/a.txt')).toBe(join(root, 'notes/a.txt'));
    expect(resolveWorkspacePath(root, 'notes/../a.txt')).toBe(join(root, 'a.txt'));
    expect(resolveWorkspacePath(root, '../outside.txt')).toBeNull();
    expect(resolveWorkspacePath(root, '/etc/passwd')).toBeNull();
    expect(resolveWorkspacePath(root, 'a\0b')).toBeNull();
  });
});

describe('file tools', () => {
  it('writes, reads, appends, replaces, and lists workspace files', async () => {
    const root = workspace();
    const tools = createDefaultToolRegistry();
    const ctx = context(root);

    const written = await tools.run('write_file', { path: 'notes/todo.txt', content: 'one\ntwo\n' }, ctx);
    expect(written.ok).toBe(true);
    expect(await readFile(join(root, 'notes/todo.txt'), 'utf8')).toBe('one\ntwo\n');

    const read = await tools.run('read_file', { path: 'notes/todo.txt' }, ctx);
    expect(read.ok).toBe(true);
    expect(read.content).toContain('one\ntwo');

    const appended = await tools.run('append_file', { path: 'notes/todo.txt', content: 'three\n' }, ctx);
    expect(appended.ok).toBe(true);

    const replaced = await tools.run('replace_in_file', { path: 'notes/todo.txt', oldText: 'two', newText: '2' }, ctx);
    expect(replaced.ok).toBe(true);
    expect(await readFile(join(root, 'notes/todo.txt'), 'utf8')).toBe('one\n2\nthree\n');

    const listed = await tools.run('list_files', { path: 'notes' }, ctx);
    expect(listed.ok).toBe(true);
    expect(listed.content).toContain('file  notes/todo.txt');
  });

  it('returns a structured error instead of reading outside the workspace', async () => {
    const root = workspace();
    const tools = createDefaultToolRegistry();
    const result = await tools.run('read_file', { path: '../../etc/passwd' }, context(root));
    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/Invalid path/);
  });

  it('rejects ambiguous replacements unless replaceAll is set', async () => {
    const root = workspace();
    const tools = createDefaultToolRegistry();
    const ctx = context(root);
    await tools.run('write_file', { path: 'a.txt', content: 'x x' }, ctx);
    const ambiguous = await tools.run('replace_in_file', { path: 'a.txt', oldText: 'x', newText: 'y' }, ctx);
    expect(ambiguous.ok).toBe(false);
    const all = await tools.run('replace_in_file', { path: 'a.txt', oldText: 'x', newText: 'y', replaceAll: true }, ctx);
    expect(all.ok).toBe(true);
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('y y');
  });

  it('validates tool arguments through the registry', async () => {
    const root = workspace();
    const tools = createDefaultToolRegistry();
    const result = await tools.run('write_file', { path: 'a.txt' }, context(root));
    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/Invalid arguments/);
  });
});
