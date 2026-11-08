#!/usr/bin/env node
/**
 * sync-assets.mjs — Single source of truth: assets/companion/
 * Copies (idempotently) into generated public folders so Vite (web) and
 * Fastify (server) serve the same bytes without duplicating them in git.
 *
 * Generated outputs (git-ignored):
 *   apps/web/public/companion/
 *   apps/server/public/companion/
 *
 * Usage:
 *   node scripts/sync-assets.mjs          # sync both destinations
 *   node scripts/sync-assets.mjs web      # only apps/web/public/companion
 *   node scripts/sync-assets.mjs server   # only apps/server/public/companion
 *
 * `pnpm dev` runs the web and server processes in parallel. If both
 * invoked this script with no argument, both would rmSync + cpSync the
 * same two shared destinations, racing each other (one deleting a
 * directory the other is copying into -> ENOENT). Each dev process is
 * therefore scoped to its own destination; a standalone run with no
 * argument still syncs both.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(rootDir, 'assets', 'companion');
const allDestinations = {
  web: join(rootDir, 'apps', 'web', 'public', 'companion'),
  server: join(rootDir, 'apps', 'server', 'public', 'companion'),
};

const target = process.argv[2];
if (target !== undefined && target !== 'all' && !(target in allDestinations)) {
  console.error(`[assets:sync] unknown target "${target}" — expected "web", "server", or no argument`);
  process.exit(1);
}
const destinations =
  target === undefined || target === 'all' ? Object.values(allDestinations) : [allDestinations[target]];

if (!existsSync(src)) {
  console.log('[assets:sync] no assets/companion — nothing to do');
  process.exit(0);
}

for (const dest of destinations) {
  mkdirSync(dirname(dest), { recursive: true });
  // Clean destination companion dir so stale files don't linger; then copy fresh.
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
  console.log(`[assets:sync] copied assets/companion -> ${dest.replace(rootDir + '/', '')}`);
}

const characterCount = readdirSync(src).length;
console.log(`[assets:sync] ${characterCount} characters synced`);
