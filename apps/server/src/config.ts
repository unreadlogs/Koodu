export interface ProviderConfig {
  provider: 'openai' | 'needle' | null;
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
  local: ProviderConfig & {
    needleModelPath: string | null;
    needleCacheDir: string | null;
  };
  cloud: ProviderConfig;
}

const nonEmpty = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
};

function localProvider(env: Record<string, string | undefined>): ProviderConfig['provider'] {
  const raw = nonEmpty(env.LOCAL_LLM_PROVIDER)?.toLowerCase() ?? null;
  if (raw === null) return nonEmpty(env.LOCAL_LLM_BASE_URL) ? 'openai' : null;
  if (['needle', 'openai'].includes(raw)) return raw as 'needle' | 'openai';
  if (['off', 'none', 'disabled'].includes(raw)) return null;
  throw new Error(
    `Invalid LOCAL_LLM_PROVIDER "${raw}". Use "needle", "openai" or omit it to disable local inference.`,
  );
}

export function readConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  return {
    port: Number.parseInt(env.PORT ?? '8787', 10) || 8787,
    host: env.HOST ?? '127.0.0.1',
    allowedOrigins: (env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    timeoutMs: Number.parseInt(env.LLM_TIMEOUT_MS ?? '15000', 10) || 15000,
    auth: {
      password: nonEmpty(env.KOODU_AUTH_PASSWORD),
    },
    local: {
      provider: localProvider(env),
      baseUrl: nonEmpty(env.LOCAL_LLM_BASE_URL),
      model:
        nonEmpty(env.LOCAL_LLM_MODEL) ??
        (nonEmpty(env.LOCAL_LLM_PROVIDER)?.toLowerCase() === 'needle' ? 'needle3' : 'needle'),
      apiKey: nonEmpty(env.LOCAL_LLM_API_KEY),
      needleModelPath: nonEmpty(env.NEEDLE_MODEL_PATH),
      needleCacheDir: nonEmpty(env.NEEDLE_CACHE_DIR),
    },
    cloud: {
      provider: nonEmpty(env.CLOUD_LLM_BASE_URL) ? 'openai' : null,
      baseUrl: nonEmpty(env.CLOUD_LLM_BASE_URL),
      model: nonEmpty(env.CLOUD_LLM_MODEL) ?? 'cloud-model',
      apiKey: nonEmpty(env.CLOUD_LLM_API_KEY),
    },
  };
}
