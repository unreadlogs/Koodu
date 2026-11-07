import { createServer } from './server';
import { readConfig } from './config';
import { initializeDatabase } from './storage/database';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Node 20.12+ can load a .env file without a dependency.
const loadEnvFile = (
  process as unknown as { loadEnvFile?: (path?: string) => void }
).loadEnvFile;
if (typeof loadEnvFile === 'function') {
  try {
    loadEnvFile.call(process, new URL('../../../.env', import.meta.url).pathname);
  } catch {
    // No .env file: environment variables only.
  }
}

const config = readConfig();
const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const databasePath = isAbsolute(config.databasePath) ? config.databasePath : resolve(projectRoot, config.databasePath);
const database = initializeDatabase(databasePath);
console.log(`[koodu-server] SQLite ready: ${databasePath}`);
const app = createServer(config, { database });
app.addHook('onClose', async () => { database.close(); });

app
  .listen({ port: config.port, host: config.host })
  .then((address) => {
    console.log(`[koodu-server] listening on ${address}`);
    console.log(
      `[koodu-server] local model: ${config.local.model} (${config.local.baseUrl ? 'configured' : 'disabled'})`,
    );
    console.log(
      `[koodu-server] cloud model: ${config.cloud.model} (${config.cloud.baseUrl ? 'configured' : 'disabled'})`,
    );
    console.log(
      `[koodu-server] auth: ${config.auth.password ? 'enabled (env password)' : 'disabled'}`,
    );
  })
  .catch((error: unknown) => {
    console.error('[koodu-server] failed to start', error);
    process.exitCode = 1;
  });
