import { useEffect, useState } from "react";
import {
  AiSecurity02Icon, Cancel01Icon, CpuIcon, DashboardSpeed01Icon, Layers01Icon,
  Refresh01Icon, SparklesIcon, Tick02Icon,
} from "@hugeicons/core-free-icons";
import { kooduSocket } from "../../lib/socket";
import { AGENT_DESCRIPTORS, AGENT_TYPES, type AgentType } from "@koodu/protocol";
import * as Shared from "../shared";
import * as Components from "../components";

const agentIcons = [AiSecurity02Icon, CpuIcon, DashboardSpeed01Icon, Layers01Icon];

const statusLabel: Record<Shared.AgentTaskStatus, string> = {
  queued: 'QUEUED',
  running: 'RUNNING',
  paused: 'PAUSED',
  completed: 'COMPLETED',
  failed: 'FAILED',
  cancelled: 'CANCELLED',
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff) || diff < 0) return 'just now';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function canResume(task: Shared.AgentTask): boolean {
  return Boolean(task.checkpoint) && (task.status === 'paused' || task.status === 'failed');
}

export function AgentsPage() {
  const [selected, setSelected] = useState<AgentType | null>(null);
  const [task, setTask] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [result, setResult] = useState<Shared.AgentRunResult | null>(null);
  const [tasks, setTasks] = useState<Shared.AgentTask[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const loadTasks = async () => {
    try {
      const response = await kooduSocket.request<{ tasks: Shared.AgentTask[] }>('tasks.list', { limit: 20 });
      setTasks(Array.isArray(response.tasks) ? response.tasks : []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load agent tasks.');
    } finally {
      setLoadingTasks(false);
    }
  };

  useEffect(() => {
    let alive = true;
    kooduSocket.request<{ tasks: Shared.AgentTask[] }>('tasks.list', { limit: 20 })
      .then((response) => { if (alive) setTasks(Array.isArray(response.tasks) ? response.tasks : []); })
      .catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : 'Could not load agent tasks.'); })
      .finally(() => { if (alive) setLoadingTasks(false); });
    return () => { alive = false; };
  }, []);

  const runTask = async () => {
    if (!selected || !task.trim() || running) return;
    setRunning(true); setError(''); setNotice(''); setResult(null); setStreamText('');
    try {
      const response = await kooduSocket.request<Shared.AgentRunResult>(
        'agent.run', { role: 'cloud', agentType: selected, text: task.trim(), context: { source: 'agents-page' } },
        { onStream: (event) => setStreamText((current) => event.kind === 'reset' ? '' : current + event.text) },
      );
      setResult(response);
      setOpenTaskId(response.taskId);
      setNotice(response.status === 'paused'
        ? 'The task paused at a safe step limit. Continue it to keep the saved progress.'
        : 'Task completed and recorded on the server.');
      setTask('');
      await loadTasks();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The task could not be completed.');
      await loadTasks();
    } finally { setRunning(false); }
  };

  const resumeTask = async (taskId: string) => {
    if (running || busyTaskId) return;
    setBusyTaskId(taskId); setError(''); setStreamText(''); setNotice('');
    try {
      const response = await kooduSocket.request<Shared.AgentRunResult>(
        'agent.resume', { taskId, role: 'cloud' },
        { onStream: (event) => setStreamText((current) => event.kind === 'reset' ? '' : current + event.text) },
      );
      setResult(response);
      setOpenTaskId(taskId);
      setNotice(response.status === 'paused'
        ? 'The task paused again at its safe step limit. Continue it to keep going.'
        : 'The resumed task completed.');
      await loadTasks();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The task could not be resumed.');
      await loadTasks();
    } finally { setBusyTaskId(null); }
  };

  const cancelTask = async (taskId: string) => {
    if (busyTaskId) return;
    setBusyTaskId(taskId); setError(''); setNotice('');
    try {
      await kooduSocket.request('tasks.cancel', { taskId });
      setNotice('The task was cancelled.');
      await loadTasks();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The task could not be cancelled.');
    } finally { setBusyTaskId(null); }
  };

  return <div className="product-page agents-page">
    <div className="section-label-row"><div><strong>Specialists</strong><span>Choose an agent focus, then run a task through Koodu’s server agent loop.</span></div><span>{AGENT_TYPES.length} ROLES</span></div>
    <div className="agent-grid">{AGENT_TYPES.map((type, index) => {
      const info = AGENT_DESCRIPTORS[type];
      return <button className={`agent-card ${selected === type ? 'selected' : ''}`} key={type} onClick={() => setSelected(type)}>
        <span className="agent-avatar"><Components.AppIcon icon={agentIcons[index] ?? AiSecurity02Icon} size={20}/></span>
        <span className="agent-card-copy"><strong>{info.title}</strong><small>{info.description}</small></span>
        <span className={`risk-pill ${info.risk}`}>{info.risk.toUpperCase()}</span>
      </button>;
    })}</div>

    {selected && <section className="task-composer">
      <div className="composer-title"><div><strong>Run a task</strong><small>{AGENT_DESCRIPTORS[selected].title}</small></div><button aria-label="Close task composer" disabled={running} onClick={() => setSelected(null)}><Components.AppIcon icon={Cancel01Icon} size={15}/></button></div>
      <textarea rows={3} maxLength={1000} value={task} disabled={running} onChange={(event) => setTask(event.target.value)} placeholder={`Describe a task for the ${AGENT_DESCRIPTORS[selected].title}…`}/>
      <div className="composer-bottom"><span>Runs on the server · {task.length} / 1000</span><button className="product-primary" disabled={!task.trim() || running} onClick={() => void runTask()}>{running ? <i className="tiny-spinner"/> : <Components.AppIcon icon={SparklesIcon} size={15}/>} {running ? 'Working…' : 'Run task'}</button></div>
    </section>}

    {notice && <div className="draft-notice"><Components.AppIcon icon={Tick02Icon} size={14}/>{notice}<button onClick={() => setNotice('')} aria-label="Dismiss"><Components.AppIcon icon={Cancel01Icon} size={13}/></button></div>}
    {error && <div className="memory-error-toast" role="alert"><span className="memory-error-mark">!</span>{error}</div>}

    <div className="section-label-row task-list-heading">
      <div><strong>Latest run</strong><span>{running || busyTaskId ? 'A task is running on the server.' : 'Task output is recorded server-side and can be resumed.'}</span></div>
      {(result || streamText) && <span>{result ? `${result.iterations} STEPS · ${result.toolCalls} TOOLS` : 'STREAMING'}</span>}
    </div>
    {streamText && (running || busyTaskId)
      ? <article className="draft-row"><span className="draft-status"/><div><strong>{streamText}<i className="tiny-spinner"/></strong><small>Streaming response…</small></div></article>
      : result
        ? <article className={`draft-row run-result ${result.status}`}>
          <span className={`task-status ${result.status}`}>{statusLabel[result.status]}</span>
          <div><strong>{result.reply}</strong><small>Task {result.taskId.slice(0, 8)} · {result.iterations} steps · {result.toolCalls} tools · {result.provider}</small></div>
          {result.status === 'paused' && <button className="task-resume" disabled={Boolean(busyTaskId)} onClick={() => void resumeTask(result.taskId)}>{busyTaskId === result.taskId ? <i className="tiny-spinner"/> : 'Continue'}</button>}
        </article>
        : <div className="agent-empty">No task has run in this session <span>·</span> choose a specialist and submit a request.</div>}

    <div className="section-label-row task-list-heading">
      <div><strong>Task history</strong><span>Paused and failed tasks keep a checkpoint and can be resumed.</span></div>
      <button className="task-refresh" onClick={() => void loadTasks()} disabled={loadingTasks}><Components.AppIcon icon={Refresh01Icon} size={12}/> Refresh</button>
    </div>
    {loadingTasks
      ? <div className="agent-empty">Loading tasks…</div>
      : tasks.length
        ? <div className="task-history">{tasks.map((item) => {
          const busy = busyTaskId === item.id;
          const open = openTaskId === item.id;
          return <article className={`task-history-row ${open ? 'open' : ''}`} key={item.id}>
            <button className="task-history-main" onClick={() => setOpenTaskId(open ? null : item.id)} aria-expanded={open}>
              <span className={`task-status ${item.status}`}>{statusLabel[item.status] ?? item.status.toUpperCase()}</span>
              <span className="task-history-copy">
                <strong>{item.task}</strong>
                <small>{AGENT_DESCRIPTORS[item.agentType]?.title ?? item.agentType} · {item.steps} steps · {item.toolCalls} tools · {timeAgo(item.updatedAt)}</small>
              </span>
              {item.progress > 0 && item.status === 'running' ? <span className="task-progress"><i style={{ width: `${Math.min(100, item.progress)}%` }}/></span> : null}
            </button>
            <div className="task-history-actions">
              {canResume(item) && <button className="task-resume" disabled={busy} onClick={() => void resumeTask(item.id)}>{busy ? <i className="tiny-spinner"/> : item.status === 'failed' ? 'Retry' : 'Continue'}</button>}
              {(item.status === 'running' || item.status === 'paused') && <button className="task-cancel" disabled={busy} onClick={() => void cancelTask(item.id)} aria-label={`Cancel ${item.task}`}><Components.AppIcon icon={Cancel01Icon} size={13}/></button>}
            </div>
            {open && <div className="task-history-detail">
              {item.error ? <p className="task-detail-error">{item.error}</p> : null}
              {item.result ? <p className="task-detail-result">{item.result}</p> : null}
              {item.checkpoint?.observations.length
                ? <ul className="task-observations">{item.checkpoint.observations.slice(-5).map((observation, index) => <li key={`${observation.at}-${index}`}><b>{observation.tool}</b><span>{observation.result.split('\n')[0]?.slice(0, 160)}</span><i className={observation.ok ? 'ok' : 'fail'}>{observation.ok ? 'ok' : 'failed'}</i></li>)}</ul>
                : <p className="task-detail-muted">No tool observations were recorded for this task.</p>}
            </div>}
          </article>;
        })}</div>
        : <div className="agent-empty">No agent tasks yet <span>·</span> run one above to see its checkpointed history.</div>}
  </div>;
}
