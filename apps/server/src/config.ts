export interface ProviderConfig {
  baseUrl: string | null;
  model: string;
  apiKey: string | null;
}

export interface ServerConfig {
  port: number;
  host: string;
  allowedOrigins: string[];
  timeoutMs: number;
  auth: {
    password: string | null;
  };
  local: ProviderConfig;
  cloud: ProviderConfig;
  publicDir: string;
  databasePath: string;
  /** Sandboxed root for agent file tools. */
  workspaceDir: string;
}

const nonEmpty = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
};

function localProvider(env: Record<string, string | undefined>): boolean {
  const raw = nonEmpty(env.LOCAL_LLM_PROVIDER)?.toLowerCase() ?? null;
  if (raw === null) return Boolean(nonEmpty(env.LOCAL_LLM_BASE_URL));
  if (['openai'].includes(raw)) return true;
  if (['off', 'none', 'disabled'].includes(raw)) return false;
  throw new Error(
    `Invalid LOCAL_LLM_PROVIDER "${raw}". Use "openai" or omit it to disable local inference.`,
  );
}

export function readConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  if (env.CODESPACE_NAME) {
    const forwardingDomain = env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN ?? 'app.github.dev';
    allowedOrigins.push(`https://${env.CODESPACE_NAME}-5173.${forwardingDomain}`);
  }
  return {
    port: Number.parseInt(env.PORT ?? '8787', 10) || 8787,
    host: env.HOST ?? '127.0.0.1',
    allowedOrigins: [...new Set(allowedOrigins)],
    timeoutMs: Number.parseInt(env.LLM_TIMEOUT_MS ?? '15000', 10) || 15000,
    auth: {
      password: nonEmpty(env.KOODU_AUTH_PASSWORD),
    },
    local: {
      baseUrl: nonEmpty(env.LOCAL_LLM_BASE_URL),
      model: nonEmpty(env.LOCAL_LLM_MODEL) ?? 'local-model',
      apiKey: nonEmpty(env.LOCAL_LLM_API_KEY),
    },
    cloud: {
      baseUrl: nonEmpty(env.CLOUD_LLM_BASE_URL),
      model: nonEmpty(env.CLOUD_LLM_MODEL) ?? 'cloud-model',
      apiKey: nonEmpty(env.CLOUD_LLM_API_KEY),
    },
    publicDir: nonEmpty(env.SERVER_PUBLIC_DIR) ?? 'public',
    databasePath: nonEmpty(env.KOODU_DATABASE_PATH) ?? 'assets/database/koodu.sqlite',
    workspaceDir: nonEmpty(env.KOODU_WORKSPACE_DIR) ?? 'assets/workspace',
  };
}
