import { createServer } from './server';
import { readConfig } from './config';

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
const app = createServer(config);

app
  .listen({ port: config.port, host: config.host })
  .then((address) => {
    console.log(`[koodu-server] listening on ${address}`);
    console.log(
      `[koodu-server] local model: ${config.local.model} (${config.local.provider ?? 'disabled'})`,
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
