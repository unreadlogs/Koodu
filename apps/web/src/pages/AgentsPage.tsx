import { ActionButton, Card, Pill, type PageProps } from './shared';

const STATUS_TONE = {
  queued: 'muted',
  running: 'warn',
  completed: 'ok',
  failed: 'warn',
  cancelled: 'muted',
} as const;

export function AgentsPage({ state, send }: PageProps) {
  const tasks = state?.tasks ?? [];

  return (
    <div className="space-y-4">
      <Card title="Sub-agent tasks" hint="Lifecycle exists; execution is not wired yet.">
        {tasks.length === 0 ? (
          <div className="space-y-3">
            <p className="text-xs text-slate-400">
              No tasks yet. Cloud proposals may queue a task, but nothing runs it in this
              prototype.
            </p>
            <ActionButton
              tone="primary"
              onClick={() =>
                send('spawn_subagent', {
                  agentType: 'research',
                  task: 'Summarise the current workspace state',
                })
              }
            >
              Propose a research task
            </ActionButton>
            <p className="text-[11px] text-slate-500">
              This is intentionally approval-gated; the iframe cannot self-authorize it.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {tasks.map((task) => (
              <li key={task.id} className="rounded-lg border border-white/5 bg-slate-950/50 p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-slate-100">{task.title}</span>
                  <Pill tone={STATUS_TONE[task.status]}>{task.status}</Pill>
                  <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                    {task.agentType}
                  </span>
                  <span className="ml-auto font-mono text-[10px] text-slate-500">{task.id}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/5">
                  <div
                    className="h-full rounded-full bg-emerald-400 transition-all"
                    style={{ width: `${task.progress}%` }}
                  />
                </div>
                <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                  <span>{task.progress}%</span>
                  {task.status !== 'completed' &&
                    task.status !== 'failed' &&
                    task.status !== 'cancelled' && (
                      <ActionButton onClick={() => send('cancel_task', { taskId: task.id })}>
                        Cancel
                      </ActionButton>
                    )}
                </div>
                {task.error && <p className="mt-1 text-[11px] text-rose-300">{task.error}</p>}
                {task.result && <p className="mt-1 text-[11px] text-emerald-300">{task.result}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Planned sub-agents" hint="Registry is typed; execution is future work.">
        <ul className="grid gap-2 text-xs sm:grid-cols-2">
          {[
            ['Research', 'Gathers and summarises external information.'],
            ['Coding', 'Works on repository changes inside an isolated task.'],
            ['Organizer', 'Schedules, groups and tracks user tasks.'],
            ['Memory', 'Curates durable project and user context.'],
          ].map(([name, description]) => (
            <li key={name} className="rounded-lg bg-slate-950/50 p-2.5">
              <p className="font-medium text-slate-200">{name} Agent</p>
              <p className="mt-0.5 text-slate-500">{description}</p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
