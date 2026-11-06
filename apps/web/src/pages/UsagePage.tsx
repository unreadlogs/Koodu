import { Card, Pill, Stat, type PageProps } from './shared';

export function UsagePage({ state }: PageProps) {
  const tabs = state?.tabs ?? [];
  const active = state?.activeRoute?.split('/').pop() ?? '—';

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Open tabs" value={String(tabs.length)} />
        <Stat label="Active route" value={active} />
        <Stat label="AI status" value={state?.aiStatus ?? 'unknown'} />
      </div>

      <Card title="Inference usage" hint="Sample data — usage metering is not implemented yet.">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="pb-2 font-medium">Provider</th>
                <th className="pb-2 font-medium">Runs on</th>
                <th className="pb-2 font-medium">Requests</th>
                <th className="pb-2 font-medium">p95 latency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              <tr>
                <td className="py-2 text-slate-200">Rules</td>
                <td className="py-2 text-slate-400">Browser</td>
                <td className="py-2 text-slate-300">—</td>
                <td className="py-2 text-slate-300">&lt; 1 ms</td>
              </tr>
              <tr>
                <td className="py-2 text-slate-200">Cactus Needle 3 (candidate)</td>
                <td className="py-2 text-slate-400">Server</td>
                <td className="py-2 text-slate-300">not metered</td>
                <td className="py-2 text-slate-300">not metered</td>
              </tr>
              <tr>
                <td className="py-2 text-slate-200">Cloud model</td>
                <td className="py-2 text-slate-400">Server</td>
                <td className="py-2 text-slate-300">not metered</td>
                <td className="py-2 text-slate-300">not metered</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Tab activity">
        {tabs.length === 0 ? (
          <p className="text-xs text-slate-400">No open tabs reported by the middleware.</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {tabs.map((tab) => (
              <li
                key={tab.id}
                className="flex items-center justify-between rounded-md bg-slate-950/50 px-2 py-1"
              >
                <span className="text-slate-200">{tab.title}</span>
                <span className="flex items-center gap-2 text-slate-500">
                  <span className="font-mono text-[10px]">{tab.route}</span>
                  <Pill tone={tab.active ? 'ok' : 'muted'}>
                    {tab.active ? 'active' : tab.windowState}
                  </Pill>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
