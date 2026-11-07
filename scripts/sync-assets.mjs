#!/usr/bin/env node
/**
 * sync-assets.mjs — Single source of truth: assets/companion/
 * Copies (idempotently) into generated public folders so Vite (web) and
 * Fastify (server) serve the same bytes without duplicating them in git.
 *
 * Generated outputs (git-ignored):
 *   apps/web/public/companion/
 *   apps/server/public/companion/
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(rootDir, 'assets', 'companion');
const destinations = [
  join(rootDir, 'apps', 'web', 'public', 'companion'),
  join(rootDir, 'apps', 'server', 'public', 'companion'),
];

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

const kitsuFiles = readdirSync(src).length;
console.log(`[assets:sync] ${kitsuFiles} characters synced`);
