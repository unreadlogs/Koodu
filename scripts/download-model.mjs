import path from 'node:path';
import { spawnSync } from 'node:child_process';

/** Root entry point for the Needle 3 model provisioner. */
const target = path.resolve(process.cwd(), process.argv[2] ?? 'assets/models/needle3.cact');
const serverScript = path.resolve(process.cwd(), 'apps/server/scripts/download-model.mjs');
const result = spawnSync(process.execPath, [serverScript, target], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
