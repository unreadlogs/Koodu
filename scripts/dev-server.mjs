#!/usr/bin/env node
/**
 * dev-server.mjs — Runs the Fastify dev server under `tsx watch` and forwards
 * Ctrl+C / SIGTERM to the whole child process tree. `tsx watch` spawns its own
 * child process; killing only the watcher can leave the HTTP server behind.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const serverDir = new URL('../apps/server/', import.meta.url);
const tsxCli = fileURLToPath(new URL('../apps/server/node_modules/tsx/dist/cli.mjs', import.meta.url));
const isWindows = process.platform === 'win32';

const child = spawn(process.execPath, [tsxCli, 'watch', 'src/index.ts'], {
  cwd: serverDir,
  stdio: 'inherit',
  detached: !isWindows,
});

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  try {
    if (!isWindows && child.pid) {
      // Child is a process-group leader, so this kills tsx and the server child.
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch {
    // Child already exited.
  }
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

child.once('error', (error) => {
  console.error('[koodu-server] failed to start tsx watch:', error);
  process.exit(1);
});

child.once('exit', (code, signal) => {
  if (signal) {
    // Make the exit signal observable to pnpm/concurrently.
    process.kill(process.pid, signal);
    process.exit(code ?? 0);
  }
  process.exit(code ?? 0);
});
