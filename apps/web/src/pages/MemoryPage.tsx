import { Card, Pill, type PageProps } from './shared';

const LAYERS = [
  {
    name: 'Workspace snapshot',
    where: 'localStorage',
    status: 'implemented',
    detail: 'Tabs, active tab, pet mode and pet position survive a refresh.',
  },
  {
    name: 'Task checkpoints',
    where: 'IndexedDB (planned)',
    status: 'planned',
    detail: 'Long-running agent tasks need durable checkpoints before recovery is possible.',
  },
  {
    name: 'Account sync',
    where: 'Server + PostgreSQL (planned)',
    status: 'planned',
    detail: 'Cross-device workspaces require an account model and backend persistence.',
  },
] as const;

const CONTEXT = [
  { key: 'project', value: 'Koodu prototype', source: 'session' },
  { key: 'workspace', value: 'restored tabs', source: 'middleware' },
  { key: 'pet', value: 'activity + emotion', source: 'pet-engine' },
  { key: 'secrets', value: 'never stored', source: 'policy' },
] as const;

export function MemoryPage({ state }: PageProps) {
  return (
    <div className="space-y-4">
      <Card
        title="Retention layers"
        hint="Only the workspace snapshot exists today; the rest is planned."
      >
        <ul className="space-y-2 text-xs">
          {LAYERS.map((layer) => (
            <li key={layer.name} className="rounded-lg bg-slate-950/50 p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-100">{layer.name}</span>
                <Pill tone={layer.status === 'implemented' ? 'ok' : 'muted'}>
                  {layer.status}
                </Pill>
                <span className="ml-auto font-mono text-[10px] text-slate-500">
                  {layer.where}
                </span>
              </div>
              <p className="mt-1 text-slate-500">{layer.detail}</p>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="What the companion can see right now">
        <dl className="divide-y divide-white/5 text-xs">
          {CONTEXT.map((entry) => (
            <div key={entry.key} className="flex items-center justify-between gap-3 py-1.5">
              <dt className="font-mono text-slate-400">{entry.key}</dt>
              <dd className="text-slate-200">
                {entry.key === 'workspace' ? `${state?.tabs.length ?? 0} tab(s)` : entry.value}
                <span className="ml-2 rounded bg-white/5 px-1 text-[10px] uppercase tracking-wide text-slate-500">
                  {entry.source}
                </span>
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[11px] text-slate-500">
          Context is assembled by the middleware per command. Nothing here is sent to a model
          without being part of a validated request.
        </p>
      </Card>

      <Card title="No semantic memory yet" hint="Deliberately deferred">
        <p className="text-xs leading-5 text-slate-400">
          There is no vector store, embedding index or retention editor in this prototype. When
          memory lands it must define retention controls, deletion, and which engine is allowed to
          read which layer. Storing credentials in local storage remains forbidden.
        </p>
      </Card>
    </div>
  );
}
