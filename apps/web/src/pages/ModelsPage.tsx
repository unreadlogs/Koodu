import { useEffect, useState } from 'react';
import { Card, Pill, type PageProps } from './shared';

interface ModelInfo {
  id?: string;
  kind?: string;
  model?: string;
  configured?: boolean;
  location?: string;
}

interface Health {
  ok?: boolean;
  inference?: { local?: ModelInfo; cloud?: ModelInfo };
}

export function ModelsPage({ state }: PageProps) {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as Health;
      })
      .then((body) => {
        if (!cancelled) setHealth(body);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'unreachable');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows: Array<{ label: string; info: ModelInfo | undefined }> = [
    { label: 'Local model', info: health?.inference?.local },
    { label: 'Cloud model', info: health?.inference?.cloud },
  ];

  return (
    <div className="space-y-4">
      <Card
        title="Server-side inference"
        hint="Cactus Needle 3 is a candidate, not a locked dependency."
      >
        <p className="text-xs leading-5 text-slate-400">
          Models and provider keys live behind <span className="font-mono">/api/intelligence/*</span>.
          This page never receives weights or credentials, and no inference runs in the browser.
        </p>
      </Card>

      {error && (
        <Card title="Server" hint="Health check failed">
          <p className="text-xs text-rose-300">
            Could not reach <span className="font-mono">/api/health</span>: {error}. Start the
            server with <span className="font-mono">pnpm dev:server</span>.
          </p>
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {rows.map(({ label, info }) => (
          <Card key={label} title={label}>
            <dl className="space-y-1.5 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Adapter</dt>
                <dd className="font-mono text-slate-200">{info?.id ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Model</dt>
                <dd className="font-mono text-slate-200">{info?.model ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Location</dt>
                <dd className="text-slate-200">{info?.location ?? 'server'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Status</dt>
                <dd>
                  <Pill tone={info?.configured ? 'ok' : 'warn'}>
                    {info?.configured ? 'configured' : 'not configured'}
                  </Pill>
                </dd>
              </div>
            </dl>
          </Card>
        ))}
      </div>

      <Card title="Routing order" hint="Falls through on failure or low confidence.">
        <ol className="list-decimal space-y-1 pl-5 text-xs text-slate-300">
          <li>Rules in the browser for canonical commands (zero latency).</li>
          <li>Server-side local model via <span className="font-mono">/api/intelligence/local</span>.</li>
          <li>Cloud model via <span className="font-mono">/api/intelligence/cloud</span>.</li>
        </ol>
        <p className="mt-3 text-xs text-slate-500">
          Local proposals are restricted to local-safe actions. Orchestration actions require cloud
          routing and explicit approval.
        </p>
      </Card>

      <p className="text-[11px] text-slate-500">
        Session AI status: <span className="text-slate-300">{state?.aiStatus ?? 'unknown'}</span>
      </p>
    </div>
  );
}
