import { useEffect, useRef, useState } from 'react';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  AiSecurity02Icon, ArrowRight01Icon, CommandIcon, CpuIcon, DashboardSpeed01Icon,
  Home01Icon, Layers01Icon, Mic01Icon, Settings01Icon, ShieldCheckIcon, SparklesIcon,
  Add01Icon, Cancel01Icon, Search01Icon, Delete02Icon, Clock01Icon, Tick02Icon, Edit01Icon,
  Activity01Icon, ArrowUpRight01Icon, ChartLineData01Icon, Coins01Icon, Download01Icon,
  FileSearchIcon, FilterIcon, Refresh01Icon, Delete01Icon,
  PuzzleIcon, BookOpen01Icon, Upload01Icon,
} from '@hugeicons/core-free-icons';
import { AGENT_DESCRIPTORS, AGENT_TYPES, type AgentType } from '@koodu/protocol';
import type { WorkspaceRoute } from '@koodu/protocol';
import { kooduSocket, type SocketState } from '../lib/socket';
import { usePetController } from '../pet/pet-controller';

type PetActivity = 'idle' | 'listening' | 'thinking' | 'working' | 'talking' | 'happy' | 'confused' | 'error' | 'sleeping';
type Animation = { file: string; frameCount: number; frameWidth: number; frameHeight: number; fps: number; loop: boolean };
const fallbackIdleAnimation: Animation = { file: 'idle.png', frameCount: 6, frameWidth: 512, frameHeight: 512, fps: 8, loop: true };
type StartupPage = '/' | WorkspaceRoute;
type AppPreferences = { animateCompanion: boolean; showCommandHint: boolean; startupPage: StartupPage };
const PREFERENCES_KEY = 'koodu:settings:v1';
const MEMORY_KEY = 'koodu:memory:v1';
const AGENT_DRAFTS_KEY = 'koodu:agent-drafts:v1';
const LOGS_KEY = 'koodu:logs:v1';
const SKILLS_KEY = 'koodu:skills:v1';
const defaultPreferences: AppPreferences = { animateCompanion: true, showCommandHint: true, startupPage: '/' };
const homeCopy: Record<PetActivity, { lead: string; accent: string; detail: string }> = {
  idle: { lead: 'What are we', accent: 'working on?', detail: 'Open a page or enter a command.' },
  listening: { lead: 'I’m', accent: 'listening.', detail: 'Go ahead. I’m here.' },
  thinking: { lead: 'Let me', accent: 'think.', detail: 'I’m working out the next step.' },
  working: { lead: 'I’m', accent: 'on it.', detail: 'Your request is in progress.' },
  talking: { lead: 'Here’s', accent: 'what I found.', detail: 'Enter another command to continue.' },
  happy: { lead: 'All', accent: 'done.', detail: 'What should we work on next?' },
  confused: { lead: 'Let’s', accent: 'clarify that.', detail: 'Try a page name or a more specific command.' },
  error: { lead: 'Something', accent: 'went wrong.', detail: 'Try that command again.' },
  sleeping: { lead: 'Taking', accent: 'a pause.', detail: 'Enter a command when you’re ready.' },
};
type RoutePage = { route: WorkspaceRoute; label: string; icon: IconSvgElement; subtitle: string };
const pages: RoutePage[] = [
  { route: '/workspace/usage', label: 'Usage', icon: DashboardSpeed01Icon, subtitle: 'A clear view of your activity and resource use.' },
  { route: '/workspace/models', label: 'Models', icon: CpuIcon, subtitle: 'Manage the intelligence behind your companion.' },
  { route: '/workspace/agents', label: 'Agents', icon: AiSecurity02Icon, subtitle: 'Meet the agents working alongside Koodu.' },
  { route: '/workspace/memory', label: 'Memory', icon: Layers01Icon, subtitle: 'Review the context your companion remembers.' },
  { route: '/workspace/logs', label: 'Logs', icon: FileSearchIcon, subtitle: 'Inspect workspace events and connection diagnostics.' },
  { route: '/workspace/skills', label: 'Skills', icon: PuzzleIcon, subtitle: 'Manage reusable instructions for your agents.' },
  { route: '/workspace/settings', label: 'Settings', icon: Settings01Icon, subtitle: 'Manage your companion and workspace preferences.' },
];

type LogEntry = { id: string; at: number; level: 'info' | 'success' | 'warning'; source: string; message: string; detail?: string };
function appendLog(source: string, message: string, detail?: string, level: LogEntry['level'] = 'info') {
  try {
    const previous = readLocalList<LogEntry>(LOGS_KEY);
    localStorage.setItem(LOGS_KEY, JSON.stringify([{id:crypto.randomUUID(),at:Date.now(),level,source,message,detail},...previous].slice(0,250)));
    window.dispatchEvent(new CustomEvent('koodu:logs-updated'));
  } catch { /* Log storage is optional and must not interrupt app actions. */ }
}

function readPreferences(): AppPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? 'null') as Partial<AppPreferences> | null;
    const candidate = value?.startupPage;
    const startupPage: StartupPage = candidate === '/' || pages.some((page) => page.route === candidate) ? candidate as StartupPage : '/';
    return { animateCompanion: typeof value?.animateCompanion === 'boolean' ? value.animateCompanion : true, showCommandHint: typeof value?.showCommandHint === 'boolean' ? value.showCommandHint : true, startupPage };
  } catch { return defaultPreferences; }
}

function AppIcon({ icon, size, className }: { icon: IconSvgElement; size: number; className?: string }) {
  return <HugeiconsIcon icon={icon} size={size} className={className} aria-hidden="true"/>;
}

function pageFromPath(path: string) { return pages.find((page) => page.route === path); }

function useRoute() {
  const [path, setPath] = useState(() => {
    if (location.pathname !== '/') return location.pathname;
    const startupPage = readPreferences().startupPage;
    if (startupPage !== '/') history.replaceState({}, '', startupPage);
    return startupPage;
  });
  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = (next: string) => {
    if (location.pathname !== next) history.pushState({}, '', next);
    setPath(next);
  };
  return { path, navigate };
}

function useRealtime() {
  const [snapshot, setSnapshot] = useState(kooduSocket.snapshot);
  useEffect(() => {
    let previous: SocketState | null = null;
    const update = () => {
      const next = kooduSocket.snapshot;
      setSnapshot(next);
      if (next.state !== previous) {
        if (next.state === 'online') appendLog('connection', 'WebSocket connected', 'Central application data connection established.', 'success');
        if (next.state === 'offline') appendLog('connection', 'WebSocket disconnected', 'The client will retry automatically.', 'warning');
        previous = next.state;
      }
    };
    kooduSocket.connect();
    const unsubscribe = kooduSocket.subscribe(update);
    update();
    // Temporarily disable client heartbeat frames while inspecting application RPC traffic.
    // kooduSocket.ping();
    // const heartbeat = window.setInterval(() => kooduSocket.ping(), 5000);
    return () => {
      // window.clearInterval(heartbeat);
      unsubscribe();
    };
  }, []);
  return { ...snapshot, status: snapshot.state };
}

function App() {
  const { path, navigate } = useRoute();
  const realtime = useRealtime();
  const currentPage = pageFromPath(path);
  const [character, setCharacter] = useState<'kumo' | 'kitsu'>(() => localStorage.getItem('koodu:companion') === 'kitsu' ? 'kitsu' : 'kumo');
  const [preferences, setPreferences] = useState<AppPreferences>(readPreferences);
  const activity = usePetController((state) => state.activity);
  const dispatchPetAction = usePetController((state) => state.dispatchAction);
  const [animations, setAnimations] = useState<Record<string, Animation>>({});
  const [command, setCommand] = useState('');
  const [feedback, setFeedback] = useState('');
  const lastPath = useRef(path);

  useEffect(() => {
    if (lastPath.current !== path) {
      appendLog('workspace', 'Route changed', path);
      lastPath.current = path;
    }
  }, [path]);

  useEffect(() => {
    let cancelled = false;
    kooduSocket.request<{ animations?: Record<string, Animation> } & Record<string, Animation>>('companion.manifest', { character })
      .then((manifest) => {
        if (!cancelled) setAnimations(manifest?.animations ?? manifest ?? {});
      })
      .catch(() => { if (!cancelled) setAnimations({}); });
    return () => { cancelled = true; };
  }, [character]);

  useEffect(() => { localStorage.setItem('koodu:companion', character); }, [character]);
  useEffect(() => { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences)); }, [preferences]);
  const updatePreferences = (changes: Partial<AppPreferences>) => setPreferences((current) => ({ ...current, ...changes }));

  const submit = () => {
    const text = command.trim();
    if (!text) return;
    appendLog('command', 'Command received', text);
    setCommand('');
    dispatchPetAction('think');
    const requested = pages.find((page) => text.toLowerCase().includes(page.label.toLowerCase()));
    window.setTimeout(() => {
      if (requested) {
        navigate(requested.route);
        setFeedback(`Opening ${requested.label}`);
        dispatchPetAction('celebrate');
      } else {
        setFeedback('Try a page name: Usage, Models, Agents, Memory, Logs, Skills, or Settings.');
        dispatchPetAction('speak');
      }
      window.setTimeout(() => { dispatchPetAction('reset'); setFeedback(''); }, 2200);
    }, 350);
  };

  return <main className="app-shell rail-collapsed">
    <aside className="rail">
      <div className="brand-mark" aria-label="Koodu"><span className="koodu-mark"><i/><i/><i/></span></div>
      <div className="rail-section-label">WORKSPACE</div>
      <nav className="route-nav">
        <NavItem label="Home" icon={Home01Icon} selected={!currentPage} onClick={() => navigate('/')} />
        {pages.map((page) => <NavItem key={page.route} label={page.label} icon={page.icon} selected={currentPage?.route === page.route} onClick={() => navigate(page.route)} />)}
      </nav>
      <div className="rail-bottom"><div className="rail-divider"/></div>
    </aside>

    <section className="main-column">
      <section className={`page-canvas ${currentPage ? 'route-page' : 'home-page'}`}>
        <div className="canvas-grain"/>
        {currentPage ? <ModulePage page={currentPage} character={character} setCharacter={setCharacter} preferences={preferences} updatePreferences={updatePreferences} connection={realtime}/> : <HomePage activity={activity} character={character} animations={animations} animateCompanion={preferences.animateCompanion}/>}
        {feedback && <div className="command-feedback"><span className="feedback-spark"><AppIcon icon={SparklesIcon} size={13}/></span>{feedback}</div>}
        {!currentPage && <CommandBar value={command} setValue={setCommand} submit={submit} showHint={preferences.showCommandHint}/>}
        <div className="bottom-status"><span><i className={realtime.status}/> {realtime.status === 'online' ? 'CONNECTED' : realtime.status === 'connecting' ? 'CONNECTING' : 'RECONNECTING'}</span><span>WS <b/> PING: {realtime.ping === null ? '—' : `${realtime.ping}ms`} <span className="ping-bars"><i/><i/><i/><i/></span></span></div>
      </section>
    </section>

  </main>;
}

function NavItem({ label, icon, selected, onClick }: { label: string; icon: IconSvgElement; selected: boolean; onClick: () => void }) {
  return <button className={`nav-item ${selected ? 'selected' : ''}`} title={label} aria-label={label} onClick={onClick}><AppIcon icon={icon} size={17}/><span className="nav-tooltip">{label}</span></button>;
}

function HomePage({ activity, character, animations, animateCompanion }: { activity: PetActivity; character: 'kumo' | 'kitsu'; animations: Record<string, Animation>; animateCompanion: boolean }) {
  const copy = homeCopy[activity];
  return <>
    <div className="home-heading"><div><span className="eyebrow">KOODU / HOME</span><h1 aria-live="polite"><span>{copy.lead} </span><em>{copy.accent}</em></h1><p>{copy.detail}</p></div></div>
    <div className="home-scene">
      <div className="ambient ambient-left"/><div className="ambient ambient-right"/>
      <div className="scene-mark scene-mark-one"/><div className="scene-mark scene-mark-two"/>
      <PetCharacter activity={activity} character={character} animations={animations} animate={animateCompanion}/>
      <div className="pet-nameplate"><span className="character-name">{character === 'kumo' ? 'KUMO' : 'KITSU'}</span></div>
    </div>
  </>;
}

function PetCharacter({ activity, character, animations, animate }: { activity: PetActivity; character: 'kumo' | 'kitsu'; animations: Record<string, Animation>; animate: boolean }) {
  const animation = animations[activity] ?? animations.idle ?? fallbackIdleAnimation;
  return <div className="pet-character" title={`${character === 'kumo' ? 'Kumo' : 'Kitsu'} · ${activity}`}>
    <SpriteSheet key={`${character}-${activity}-${animation.file}`} character={character} animation={animation} animate={animate}/>
  </div>;
}

function SpriteSheet({ character, animation, size = 250, animate = true, loop }: { character: 'kumo' | 'kitsu'; animation: Animation; size?: number; animate?: boolean; loop?: boolean }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    setFrame(0);
    if (!animate) return;
    const count = Math.max(1, animation.frameCount);
    const repeats = loop ?? animation.loop;
    const interval = window.setInterval(() => setFrame((current) => repeats ? (current + 1) % count : current >= count - 1 ? current : current + 1), 1000 / Math.max(1, animation.fps));
    return () => window.clearInterval(interval);
  }, [animation, animate, loop]);
  const framePercent = animation.frameCount > 1 ? frame / (animation.frameCount - 1) * 100 : 0;
  return <span className="sprite-sheet" role="img" aria-label={`${character} companion animation`} style={{ width: size, height: size * animation.frameHeight / animation.frameWidth, backgroundImage: `url(/companion/${character}/${animation.file})`, backgroundPosition: `${framePercent}% 0`, backgroundSize: `${animation.frameCount * 100}% 100%` }}/>;
}

function ModulePage({ page, character, setCharacter, preferences, updatePreferences, connection }: { page: RoutePage; character: 'kumo' | 'kitsu'; setCharacter: (value: 'kumo' | 'kitsu') => void; preferences: AppPreferences; updatePreferences: (changes: Partial<AppPreferences>) => void; connection: { status: 'connecting' | 'online' | 'offline'; ping: number | null } }) {
  return <div className={`module-page-content ${page.label === 'Settings' ? 'settings-page-content' : ''}`}>
    <div className="module-heading">
      <div><div className="eyebrow">KOODU / WORKSPACE / {page.label.toUpperCase()}</div><h1>{page.label}</h1><p>{page.subtitle}</p></div>
      <span className="module-page-icon"><AppIcon icon={page.icon} size={19}/></span>
    </div>
    {page.label === 'Settings' ? <SettingsPage character={character} setCharacter={setCharacter} preferences={preferences} updatePreferences={updatePreferences} connection={connection}/>
    : page.label === 'Memory' ? <MemoryPage/>
    : page.label === 'Agents' ? <AgentsPage/>
    : page.label === 'Usage' ? <UsagePage/>
    : page.label === 'Logs' ? <LogsPage/>
    : page.label === 'Skills' ? <SkillsPage/>
    : page.label === 'Models' ? <ModelsPage/>
    : <>
      <div className="module-overview">
        <div className="module-card-heading"><span><AppIcon icon={page.icon} size={15}/>{page.label} overview</span><span className="live-label"><i/> LIVE</span></div>
        <div className="module-placeholder"><span className="placeholder-icon"><AppIcon icon={page.icon} size={23}/></span><strong>Your {page.label.toLowerCase()} page is ready</strong><span>This workspace section is connected and ready for its next feature.</span></div>
      </div>
      <div className="module-stats"><div><small>WORKSPACE</small><strong>Personal</strong></div><div><small>STATUS</small><strong><i/> Connected</strong></div><div><small>COMPANION</small><strong>By your side</strong></div></div>
    </>}
  </div>;
}

type UsageRange = '24H' | '7D' | '30D';
const usagePreview: Record<UsageRange, { labels: string[]; requests: number[]; tokens: number[]; calls: string; tokenTotal: string; latency: string; success: string }> = {
  '24H': { labels:['12a','4a','8a','12p','4p','8p','Now'], requests:[20,12,32,55,43,71,38], tokens:[18,11,31,47,36,62,34], calls:'1,284', tokenTotal:'842.6K', latency:'1.24s', success:'98.7%' },
  '7D': { labels:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'], requests:[48,71,58,86,62,39,54], tokens:[42,65,51,77,56,32,48], calls:'8,942', tokenTotal:'6.18M', latency:'1.31s', success:'98.4%' },
  '30D': { labels:['Wk 1','Wk 2','Wk 3','Wk 4','Wk 5'], requests:[58,79,63,91,72], tokens:[50,69,54,82,64], calls:'34,761', tokenTotal:'24.9M', latency:'1.28s', success:'98.6%' },
};
function UsagePage() {
  const [range, setRange] = useState<UsageRange>('7D');
  const [usage, setUsage] = useState<{summary:{calls:number;tokens:number;latency:number;successRate:number};recent:Array<{id:string;occurred_at:number;model_id:string|null;provider:string|null;route:string;input_tokens:number;output_tokens:number;latency_ms:number;outcome:string}>;daily:Array<{day:string;calls:number;tokens:number}>}|null>(null);
  const [error, setError] = useState('');
  useEffect(() => { let live=true; setUsage(null); kooduSocket.request<any>('usage.summary',{range}).then(result=>{if(live){setUsage(result);setError('');}}).catch(reason=>{if(live)setError(reason instanceof Error?reason.message:'Usage data unavailable.');}); return ()=>{live=false;}; },[range]);
  const summary=usage?.summary;
  const labels=usage?.daily.map(row=>row.day)??[];
  const maxCalls=Math.max(1,...(usage?.daily.map(row=>row.calls)??[]));
  const exportPreview = () => {
    const csv = ['date,requests,tokens', ...(usage?.daily??[]).map(row=>`${row.day},${row.calls},${row.tokens}`)].join('\n');
    const url = URL.createObjectURL(new Blob([csv], {type:'text/csv'})); const anchor = document.createElement('a'); anchor.href=url; anchor.download=`koodu-usage-${range.toLowerCase()}.csv`; anchor.click(); URL.revokeObjectURL(url);
  };
  const formatTime=(at:number)=>new Date(at).toLocaleString();
  return <div className="product-page usage-page">
    <div className="usage-toolbar"><div className="usage-window"><AppIcon icon={Clock01Icon} size={15}/><span>Activity window</span>{(['24H','7D','30D'] as UsageRange[]).map(option=><button key={option} className={range===option?'active':''} onClick={()=>setRange(option)}>{option}</button>)}</div><button className="product-secondary" onClick={exportPreview}><AppIcon icon={Download01Icon} size={14}/> Export CSV</button></div>
    {error&&<div className="model-error">{error}</div>}
    <div className="usage-metric-grid">
      <UsageMetric icon={ChartLineData01Icon} label="TOTAL REQUESTS" value={(summary?.calls??0).toLocaleString()} delta="" detail="selected period"/>
      <UsageMetric icon={Coins01Icon} label="TOKENS PROCESSED" value={(summary?.tokens??0).toLocaleString()} delta="" detail="input + output"/>
      <UsageMetric icon={Clock01Icon} label="AVG. RESPONSE TIME" value={`${Math.round(summary?.latency??0)} ms`} delta="" detail="recorded requests"/>
      <UsageMetric icon={Activity01Icon} label="SUCCESS RATE" value={`${(summary?.successRate??0).toFixed(1)}%`} delta="" detail="successful requests"/>
    </div>
    <section className="usage-panel usage-chart-panel"><div className="usage-panel-heading"><div><strong>Request volume</strong><span>Recorded requests · {range}</span></div></div><div className="chart-area"><div className="chart-y-axis"><span>{maxCalls}</span><span>{Math.round(maxCalls*.75)}</span><span>{Math.round(maxCalls*.5)}</span><span>{Math.round(maxCalls*.25)}</span><span>0</span></div><div className="chart-columns" style={{gridTemplateColumns:`repeat(${labels.length||1},minmax(0,1fr))`}}>{(usage?.daily??[]).map(row=><div className="chart-column" key={row.day}><div className="chart-bar-track"><i className="chart-bar" style={{height:`${row.calls/maxCalls*100}%`}}/></div><span>{row.day}</span></div>)}</div></div>{!usage?.daily.length&&<p>No requests recorded for this period.</p>}</section>
    <div className="usage-lower-grid"><section className="usage-panel breakdown-panel"><div className="usage-panel-heading"><div><strong>Usage by model</strong><span>Request share · preview distribution</span></div><button className="quiet-action">All models <AppIcon icon={ArrowUpRight01Icon} size={13}/></button></div>{[{name:'Local model',meta:'On-device · Koodu runtime',share:54,amount:'4,829',color:'green'},{name:'Cloud reasoning',meta:'Provider adapter · configured',share:33,amount:'2,951',color:'lavender'},{name:'Other requests',meta:'Embeddings and utilities',share:13,amount:'1,162',color:'blue'}].map(row=><div className="model-usage-row" key={row.name}><span className={`model-usage-mark ${row.color}`}/><div className="model-usage-copy"><strong>{row.name}</strong><small>{row.meta}</small><i><b className={row.color} style={{width:`${row.share}%`}}/></i></div><span className="model-usage-count"><strong>{row.amount}</strong><small>{row.share}%</small></span></div>)}</section>
      <section className="usage-panel activity-panel"><div className="usage-panel-heading"><div><strong>Recent activity</strong><span>Example request log</span></div><button className="quiet-action">View log <AppIcon icon={ArrowUpRight01Icon} size={13}/></button></div><div className="activity-table"><div className="activity-row activity-table-head"><span>REQUEST</span><span>MODEL</span><span>TIME</span><span>STATUS</span></div>{[['Summarize my recent notes','Local · Koodu','2m ago','Success'],['Compare model responses','Cloud · Reasoning','18m ago','Success'],['Open workspace usage','Local · Koodu','41m ago','Success'],['Organize project context','Cloud · Reasoning','1h ago','Retried']].map(([title,model,time,status])=><div className="activity-row" key={title}><span className="activity-request">{title}</span><span>{model}</span><span>{time}</span><span className={`activity-state ${status==='Success'?'ok':'retry'}`}><i/>{status}</span></div>)}</div></section></div>
    <div className="usage-disclaimer">Usage is calculated from server-recorded inference requests.</div>
  </div>;
}
function UsageMetric({icon,label,value,delta,detail}:{icon:IconSvgElement;label:string;value:string;delta:string;detail:string}) {
  return <article className="usage-metric"><div className="usage-metric-top"><span><AppIcon icon={icon} size={15}/>{label}</span><AppIcon icon={ArrowUpRight01Icon} size={13}/></div><strong>{value}</strong><div className="usage-metric-bottom"><span>{delta}</span><small>{detail}</small></div></article>;
}

function LogsPage() {
  const [entries, setEntries] = useState<LogEntry[]>(() => readLocalList<LogEntry>(LOGS_KEY));
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const refresh = () => setEntries(readLocalList<LogEntry>(LOGS_KEY));
  useEffect(() => {
    window.addEventListener('koodu:logs-updated', refresh);
    const poll = window.setInterval(refresh, 1500);
    return () => { window.removeEventListener('koodu:logs-updated', refresh); window.clearInterval(poll); };
  }, []);
  const sources = [...new Set(entries.map((entry) => entry.source))];
  const filtered = entries.filter((entry) => (source === 'all' || entry.source === source) && `${entry.message} ${entry.detail ?? ''} ${entry.source}`.toLowerCase().includes(query.toLowerCase()));
  const exportLogs = () => {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], {type:'application/json'}); const url=URL.createObjectURL(blob); const anchor=document.createElement('a'); anchor.href=url; anchor.download='koodu-workspace-logs.json'; anchor.click(); URL.revokeObjectURL(url);
  };
  const clearLogs = () => { localStorage.removeItem(LOGS_KEY); setEntries([]); setExpanded(null); };
  return <div className="product-page logs-page">
    <div className="logs-summary"><div className="logs-summary-icon"><AppIcon icon={Activity01Icon} size={18}/></div><div><strong>Workspace event log</strong><small>Client-side navigation, commands, and WebSocket connection events.</small></div><span className="logs-live"><i/> CAPTURING</span></div>
    <div className="logs-toolbar"><label className="product-search"><AppIcon icon={Search01Icon} size={16}/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search events, details, or source"/></label><label className="logs-filter"><AppIcon icon={FilterIcon} size={14}/><select aria-label="Filter event source" value={source} onChange={(e)=>setSource(e.target.value)}><option value="all">All sources</option>{sources.map(item=><option key={item} value={item}>{item}</option>)}</select></label><button className="product-secondary logs-export" onClick={exportLogs} disabled={!filtered.length}><AppIcon icon={Download01Icon} size={14}/> Export</button><button className="product-secondary logs-clear" onClick={clearLogs} disabled={!entries.length}><AppIcon icon={Delete01Icon} size={14}/> Clear</button></div>
    <div className="logs-table-wrap"><div className="logs-table-head"><span>EVENT</span><span>SOURCE</span><span>TIME</span><span>LEVEL</span></div>{filtered.length ? filtered.map((entry)=><article className={`log-entry ${expanded===entry.id?'expanded':''}`} key={entry.id}><button className="log-entry-main" onClick={()=>setExpanded(expanded===entry.id?null:entry.id)} aria-expanded={expanded===entry.id}><span className={`log-indicator ${entry.level}`}/><span className="log-event-copy"><strong>{entry.message}</strong><small>{entry.detail ?? 'No additional event details.'}</small></span><span className="log-source">{entry.source}</span><span className="log-time" title={new Date(entry.at).toLocaleString()}>{new Date(entry.at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span><span className={`log-level ${entry.level}`}>{entry.level}</span></button>{expanded===entry.id && <div className="log-entry-detail"><span>EVENT ID <b>{entry.id}</b></span><span>OCCURRED <b>{new Date(entry.at).toLocaleString()}</b></span><span>DETAIL <b>{entry.detail ?? '—'}</b></span></div>}</article>) : <div className="logs-empty"><AppIcon icon={FileSearchIcon} size={22}/><strong>{entries.length ? 'No matching events' : 'Waiting for workspace events'}</strong><span>{entries.length ? 'Change the search or source filter.' : 'Route changes, commands, and connection status changes will appear here.'}</span></div>}</div>
    <div className="logs-footer"><span>{filtered.length} {filtered.length===1?'EVENT':'EVENTS'} SHOWN</span><span>LOCAL ONLY · MOST RECENT 250 EVENTS</span></div>
    <div className="page-footnote">This page shows client events saved in this browser. Server, model-provider, and agent execution logs are not connected yet.</div>
  </div>;
}

type SkillCategory = 'Research' | 'Development' | 'Organization' | 'Custom';
type LocalSkill = { id: string; name: string; description: string; category: SkillCategory; instructions: string; enabled: boolean; source: string; updatedAt: number };
const starterSkills: LocalSkill[] = [
  {id:'starter-research-brief',name:'Research brief',description:'Turn a question into a concise, sourced research outline.',category:'Research',instructions:'Clarify the question and scope. Gather evidence from reliable sources. Separate verified facts from interpretation, cite sources, and finish with a short summary and open questions.',enabled:true,source:'Koodu starter',updatedAt:0},
  {id:'starter-code-review',name:'Code review',description:'Review a change for correctness, risk, and maintainability.',category:'Development',instructions:'Inspect the changed code and its surrounding context. Prioritize concrete bugs and regressions, include file and line references, explain impact, and avoid speculative style feedback.',enabled:true,source:'Koodu starter',updatedAt:0},
  {id:'starter-task-plan',name:'Task planner',description:'Break a larger request into clear, verifiable steps.',category:'Organization',instructions:'Restate the desired outcome, identify dependencies, split the work into small ordered steps, call out unresolved decisions, and define how completion can be verified.',enabled:true,source:'Koodu starter',updatedAt:0},
];
const skillCategories: SkillCategory[] = ['Research','Development','Organization','Custom'];
function readSkills(): LocalSkill[] {
  try {
    const raw=localStorage.getItem(SKILLS_KEY);
    if(raw===null){localStorage.setItem(SKILLS_KEY,JSON.stringify(starterSkills));return starterSkills;}
    const parsed=JSON.parse(raw);
    if(!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is LocalSkill => item && typeof item.id==='string' && typeof item.name==='string' && typeof item.description==='string' && typeof item.instructions==='string' && skillCategories.includes(item.category) && typeof item.enabled==='boolean' && typeof item.source==='string' && typeof item.updatedAt==='number');
  } catch { return []; }
}
function SkillsPage() {
  const [skills,setSkills]=useState<LocalSkill[]>(readSkills);
  const [query,setQuery]=useState('');
  const [category,setCategory]=useState<'All'|SkillCategory>('All');
  const [stateFilter,setStateFilter]=useState<'all'|'enabled'|'disabled'>('all');
  const [editing,setEditing]=useState<LocalSkill|null>(null);
  const [details,setDetails]=useState<string|null>(null);
  const [notice,setNotice]=useState('');
  const importRef=useRef<HTMLInputElement>(null);
  const persist=(next:LocalSkill[])=>{setSkills(next);localStorage.setItem(SKILLS_KEY,JSON.stringify(next));};
  const beginCreate=()=>{setEditing({id:'new',name:'',description:'',category:'Custom',instructions:'',enabled:true,source:'Custom',updatedAt:Date.now()});setDetails(null);};
  const saveSkill=(skill:LocalSkill)=>{const value={...skill,name:skill.name.trim(),description:skill.description.trim(),instructions:skill.instructions.trim(),updatedAt:Date.now()};if(!value.name||!value.description||!value.instructions)return;const next=skill.id==='new'?[value,...skills]:skills.map(item=>item.id===skill.id?value:item);persist(next);setEditing(null);setNotice(`“${value.name}” saved to your local skill library.`);appendLog('skills','Skill saved',value.name,'success');};
  const toggle=(skill:LocalSkill)=>{persist(skills.map(item=>item.id===skill.id?{...item,enabled:!item.enabled,updatedAt:Date.now()}:item));appendLog('skills',skill.enabled?'Skill disabled':'Skill enabled',skill.name);};
  const remove=(skill:LocalSkill)=>{persist(skills.filter(item=>item.id!==skill.id));setDetails(null);setNotice(`“${skill.name}” removed.`);appendLog('skills','Skill removed',skill.name,'warning');};
  const visible=skills.filter(skill=>(category==='All'||skill.category===category)&&(stateFilter==='all'||(stateFilter==='enabled'?skill.enabled:!skill.enabled))&&`${skill.name} ${skill.description} ${skill.instructions}`.toLowerCase().includes(query.toLowerCase()));
  const exportSkills=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(skills,null,2)],{type:'application/json'}));const anchor=document.createElement('a');anchor.href=url;anchor.download='koodu-skills.json';anchor.click();URL.revokeObjectURL(url);};
  const importSkills=async(file:File)=>{try{const parsed=JSON.parse(await file.text());const incoming=Array.isArray(parsed)?parsed:parsed.skills;if(!Array.isArray(incoming))throw new Error('Expected a skill array.');const valid=incoming.filter((item:any)=>item&&typeof item.name==='string'&&typeof item.description==='string'&&typeof item.instructions==='string');if(!valid.length)throw new Error('No valid skills found.');const additions:LocalSkill[]=valid.map((item:any)=>({id:crypto.randomUUID(),name:item.name.trim().slice(0,80),description:item.description.trim().slice(0,180),category:skillCategories.includes(item.category)?item.category:'Custom',instructions:item.instructions.trim(),enabled:typeof item.enabled==='boolean'?item.enabled:true,source:'Imported',updatedAt:Date.now()})).filter(item=>item.name&&item.description&&item.instructions);persist([...additions,...skills]);setNotice(`${additions.length} skill${additions.length===1?'':'s'} imported.`);appendLog('skills','Skills imported',`${additions.length} definitions`,'success');}catch(error){setNotice(error instanceof Error?`Import failed: ${error.message}`:'Import failed. Check the JSON file.');}finally{if(importRef.current)importRef.current.value='';}};
  return <div className="product-page skills-page">
    <div className="skills-summary"><span className="skills-summary-icon"><AppIcon icon={PuzzleIcon} size={19}/></span><div><strong>Your skill library</strong><small>Reusable playbooks with instructions and preferences for agent tasks.</small></div><span className="skills-count"><b>{skills.filter(skill=>skill.enabled).length}</b> ENABLED</span></div>
    <div className="skills-toolbar"><label className="product-search"><AppIcon icon={Search01Icon} size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search your skills"/></label><button className="product-secondary" onClick={()=>importRef.current?.click()}><AppIcon icon={Upload01Icon} size={14}/> Import</button><input ref={importRef} type="file" accept="application/json,.json" hidden onChange={e=>{const file=e.target.files?.[0];if(file)void importSkills(file);}}/><button className="product-secondary" onClick={exportSkills}><AppIcon icon={Download01Icon} size={14}/> Export</button><button className="product-primary" onClick={beginCreate}><AppIcon icon={Add01Icon} size={15}/> New skill</button></div>
    <div className="skills-controls"><div className="skill-categories">{(['All',...skillCategories] as const).map(item=><button key={item} className={category===item?'active':''} onClick={()=>setCategory(item)}>{item}</button>)}</div><div className="skill-state-filter"><button className={stateFilter==='all'?'active':''} onClick={()=>setStateFilter('all')}>All {skills.length}</button><button className={stateFilter==='enabled'?'active':''} onClick={()=>setStateFilter('enabled')}>Enabled {skills.filter(skill=>skill.enabled).length}</button><button className={stateFilter==='disabled'?'active':''} onClick={()=>setStateFilter('disabled')}>Disabled {skills.filter(skill=>!skill.enabled).length}</button></div></div>
    {notice&&<div className="skill-notice"><AppIcon icon={Tick02Icon} size={14}/>{notice}<button aria-label="Dismiss notice" onClick={()=>setNotice('')}><AppIcon icon={Cancel01Icon} size={13}/></button></div>}
    {editing&&<SkillEditor key={editing.id} value={editing} onSave={saveSkill} onCancel={()=>setEditing(null)}/>}
    {visible.length?<div className="skill-grid">{visible.map(skill=><article className={`skill-card ${!skill.enabled?'disabled':''} ${details===skill.id?'open':''}`} key={skill.id}><div className="skill-card-head"><span className="skill-card-icon"><AppIcon icon={skill.category==='Research'?Search01Icon:skill.category==='Development'?CpuIcon:skill.category==='Organization'?DashboardSpeed01Icon:BookOpen01Icon} size={18}/></span><span className="skill-source">{skill.source}</span><button className={`skill-switch ${skill.enabled?'on':''}`} role="switch" aria-checked={skill.enabled} aria-label={`${skill.enabled?'Disable':'Enable'} ${skill.name}`} onClick={()=>toggle(skill)}><i/></button></div><button className="skill-card-info" onClick={()=>setDetails(details===skill.id?null:skill.id)} aria-expanded={details===skill.id}><span className="skill-meta">{skill.category.toUpperCase()}</span><strong>{skill.name}</strong><small>{skill.description}</small></button>{details===skill.id&&<div className="skill-instructions"><span>INSTRUCTIONS</span><p>{skill.instructions}</p></div>}<div className="skill-card-footer"><span className={`skill-enabled-state ${skill.enabled?'enabled':''}`}><i/>{skill.enabled?'Enabled':'Disabled'}</span><div><button aria-label={`Edit ${skill.name}`} title="Edit" onClick={()=>{setEditing(skill);setDetails(null);}}><AppIcon icon={Edit01Icon} size={14}/></button><button aria-label={`Delete ${skill.name}`} title="Delete" onClick={()=>remove(skill)}><AppIcon icon={Delete02Icon} size={14}/></button></div></div></article>)}</div>:<div className="product-empty"><span className="empty-mark"><AppIcon icon={PuzzleIcon} size={21}/></span><strong>{skills.length?'No skills match these filters':'No skills yet'}</strong><p>Try a different filter or create a skill for your library.</p><button className="product-secondary" onClick={beginCreate}><AppIcon icon={Add01Icon} size={14}/> Create a skill</button></div>}
    <div className="skills-runtime-note"><AppIcon icon={Activity01Icon} size={14}/><span><strong>Local skill library</strong> Skills can be managed here now. Agent task execution does not consume these instructions until the AgentEngine integration is connected.</span></div>
  </div>;
}
function SkillEditor({value,onSave,onCancel}:{value:LocalSkill;onSave:(skill:LocalSkill)=>void;onCancel:()=>void}) {
  const [draft,setDraft]=useState(value);
  return <section className="skill-editor"><div className="skill-editor-heading"><div><strong>{value.id==='new'?'Create a skill':'Edit skill'}</strong><small>Write clear steps an agent can follow.</small></div><button aria-label="Close editor" onClick={onCancel}><AppIcon icon={Cancel01Icon} size={16}/></button></div><div className="skill-form-grid"><label>Skill name<input value={draft.name} maxLength={80} onChange={e=>setDraft({...draft,name:e.target.value})} placeholder="e.g. Release checklist"/></label><label>Category<select value={draft.category} onChange={e=>setDraft({...draft,category:e.target.value as SkillCategory})}>{skillCategories.map(category=><option key={category}>{category}</option>)}</select></label><label className="skill-description-field">Description<input value={draft.description} maxLength={180} onChange={e=>setDraft({...draft,description:e.target.value})} placeholder="What does this skill help with?"/></label><label className="skill-instructions-field">Instructions<textarea rows={5} value={draft.instructions} onChange={e=>setDraft({...draft,instructions:e.target.value})} placeholder="Write the steps, constraints, and expected output…"/></label></div><div className="skill-editor-actions"><button className="product-secondary" onClick={onCancel}>Cancel</button><button className="product-primary" disabled={!draft.name.trim()||!draft.description.trim()||!draft.instructions.trim()} onClick={()=>onSave(draft)}><AppIcon icon={Tick02Icon} size={14}/> Save skill</button></div></section>;
}

type ModelProvider='openai'|'openrouter'|'google'|'custom';
type ModelProfile={id:string;name:string;provider:ModelProvider;model:string;baseUrl:string;role:'local'|'cloud';maxOutputTokens:number;monthlyTokenLimit:number;enabled:boolean;active:boolean;apiKeySet:boolean};
const providerNames:Record<ModelProvider,string>={openai:'OpenAI',openrouter:'OpenRouter',google:'Google AI Studio',custom:'Custom OpenAI-compatible'};
const providerUrls:Record<ModelProvider,string>={openai:'https://api.openai.com/v1',openrouter:'https://openrouter.ai/api/v1',google:'https://generativelanguage.googleapis.com/v1beta/openai',custom:''};
function ModelsPage(){
  const [profiles,setProfiles]=useState<ModelProfile[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [editor,setEditor]=useState<ModelProfile|null>(null);
  const [notice,setNotice]=useState('');
  const [testing,setTesting]=useState<string|null>(null);
  const [testStatus,setTestStatus]=useState<Record<string,string>>({});
  const load=()=>{setLoading(true);kooduSocket.request<{profiles:ModelProfile[]}>('models.list',{}).then(body=>{setProfiles(Array.isArray(body.profiles)?body.profiles:[]);setError('');}).catch(reason=>setError(reason instanceof Error?reason.message:'Could not load model profiles.')).finally(()=>setLoading(false));};
  useEffect(()=>{load();},[]);
  const save=async(value:Omit<ModelProfile,'apiKeySet'>&{apiKey?:string;clearApiKey?:boolean})=>{await kooduSocket.request('models.save',value);setEditor(null);setNotice('Model profile saved securely on the server.');appendLog('models','Model profile saved',value.name,'success');load();};
  const remove=async(profile:ModelProfile)=>{try{await kooduSocket.request('models.delete',{id:profile.id});setProfiles(items=>items.filter(item=>item.id!==profile.id));setNotice(`${profile.name} removed.`);appendLog('models','Model profile removed',profile.name,'warning');}catch(reason){setError(reason instanceof Error?reason.message:'Could not remove profile.');}};
  const activate=async(profile:ModelProfile)=>{try{await save({...profile,active:true,enabled:true});setNotice(`${profile.name} is now the active ${profile.role} profile.`);}catch(reason){setError(reason instanceof Error?reason.message:'Could not activate profile.');}};
  const test=async(profile:ModelProfile)=>{setTesting(profile.id);setTestStatus(current=>({...current,[profile.id]:''}));try{await kooduSocket.request('models.test',{id:profile.id});setTestStatus(current=>({...current,[profile.id]:'Connected'}));}catch(reason){const message=reason instanceof Error?reason.message:'Connection failed.';setTestStatus(current=>({...current,[profile.id]:message==='api_key_missing'?'Add an API key first.':message==='provider_unreachable'?'Provider endpoint could not be reached.':message}));}finally{setTesting(null);}};
  const create=()=>{setError('');setEditor({id:`model-${crypto.randomUUID().slice(0,8)}`,name:'',provider:'openai',model:'',baseUrl:providerUrls.openai,role:'cloud',maxOutputTokens:1024,monthlyTokenLimit:0,enabled:true,active:false,apiKeySet:false});};
  return <div className="product-page models-page">
    <div className="models-summary"><span className="models-summary-icon"><AppIcon icon={CpuIcon} size={19}/></span><div><strong>Model providers</strong><small>Add multiple provider profiles and choose which one handles each inference route.</small></div><span className="models-summary-count">{profiles.length} PROFILE{profiles.length===1?'':'S'}</span></div>
    <div className="models-toolbar"><div className="models-runtime-status"><i className={error?'offline':'online'}/>{error?'SERVICE UNAVAILABLE':'SERVER-SIDE CONFIGURATION'}</div><button className="product-secondary" onClick={load}><AppIcon icon={Refresh01Icon} size={14}/> Refresh</button><button className="product-primary" onClick={create}><AppIcon icon={Add01Icon} size={15}/> Add model</button></div>
    {error&&<div className="model-error"><AppIcon icon={Cancel01Icon} size={15}/>{error}<button onClick={load}>Retry</button></div>}{notice&&<div className="skill-notice"><AppIcon icon={Tick02Icon} size={14}/>{notice}<button aria-label="Dismiss notice" onClick={()=>setNotice('')}><AppIcon icon={Cancel01Icon} size={13}/></button></div>}
    <div className="model-route-grid">{(['cloud','local'] as const).map(role=>{const current=profiles.find(item=>item.role===role&&item.active&&item.enabled);return <div className="model-route-card" key={role}><span className="model-route-icon"><AppIcon icon={role==='cloud'?SparklesIcon:CpuIcon} size={16}/></span><span><small>{role==='cloud'?'CLOUD REASONING':'LOCAL INFERENCE'}</small><strong>{current?current.name:'Using server environment config'}</strong></span><span className={`route-state ${current?'configured':''}`}><i/>{current?'ACTIVE':'DEFAULT'}</span></div>;})}</div>
    {editor&&<ModelEditor key={editor.id} value={editor} onSave={save} onCancel={()=>setEditor(null)} onError={setError}/>}
    <div className="models-section-head"><div><strong>Configured models</strong><span>Provider keys remain on the server and are never sent back to the browser.</span></div><span>{profiles.length.toString().padStart(2,'0')}</span></div>
    {loading?<div className="model-loading"><i/>Loading provider profiles…</div>:profiles.length?<div className="model-profile-list">{profiles.map(profile=><article className={`model-profile ${!profile.enabled?'disabled':''}`} key={profile.id}><span className="model-provider-mark"><AppIcon icon={profile.provider==='google'?SparklesIcon:profile.provider==='custom'?Settings01Icon:CpuIcon} size={18}/></span><div className="model-profile-main"><div className="model-name-row"><strong>{profile.name}</strong><span className="provider-chip">{providerNames[profile.provider]}</span>{profile.active&&profile.enabled&&<span className="active-chip">ACTIVE</span>}</div><div className="model-identifiers"><span>{profile.model}</span><span>·</span><span>{profile.role==='cloud'?'Cloud':'Local'} route</span><span>·</span><span>{profile.apiKeySet?'Key configured':'No API key'}</span></div><div className="model-limits"><span>Output max <b>{profile.maxOutputTokens.toLocaleString()} tokens</b></span><span>Monthly cap <b>{profile.monthlyTokenLimit?`${profile.monthlyTokenLimit.toLocaleString()} tokens`:'Unlimited'}</b></span></div>{testStatus[profile.id]&&<div className={`model-test-result ${testStatus[profile.id]==='Connected'?'success':'failure'}`}>{testStatus[profile.id]}</div>}</div><div className="model-profile-actions"><button className="product-secondary" onClick={()=>void test(profile)} disabled={testing!==null}>{testing===profile.id?<i className="tiny-spinner"/>:<AppIcon icon={Activity01Icon} size={14}/>} Test</button>{!profile.active&&<button className="product-secondary activate-button" onClick={()=>void activate(profile)}>Use for {profile.role}</button>}<button className="icon-action" title="Edit profile" aria-label="Edit profile" onClick={()=>setEditor(profile)}><AppIcon icon={Edit01Icon} size={15}/></button><button className="icon-action danger" title="Delete profile" aria-label="Delete profile" onClick={()=>void remove(profile)}><AppIcon icon={Delete01Icon} size={15}/></button></div></article>)}</div>:!error?<div className="models-empty"><span className="empty-mark"><AppIcon icon={CpuIcon} size={21}/></span><strong>No model profiles added</strong><p>Add OpenAI, OpenRouter, Google AI Studio, or any OpenAI-compatible endpoint.</p><button className="product-primary" onClick={create}><AppIcon icon={Add01Icon} size={14}/> Add your first model</button></div>:null}
    <div className="models-security-note"><AppIcon icon={ShieldCheckIcon} size={15}/><span><strong>Credential handling</strong> API keys are held in server memory only. They are not written to localStorage or returned by the server; restarting Koodu clears managed profiles and keys. Existing environment-based provider settings remain available as the fallback.</span></div>
  </div>;
}
function ModelEditor({value,onSave,onCancel,onError}:{value:ModelProfile;onSave:(model:Omit<ModelProfile,'apiKeySet'>&{apiKey?:string;clearApiKey?:boolean})=>Promise<void>;onCancel:()=>void;onError:(message:string)=>void}){
  const [draft,setDraft]=useState(value);const [apiKey,setApiKey]=useState('');const [clearKey,setClearKey]=useState(false);const [saving,setSaving]=useState(false);
  const updateProvider=(provider:ModelProvider)=>setDraft(current=>({...current,provider,baseUrl:current.baseUrl===providerUrls[current.provider]?providerUrls[provider]:current.baseUrl}));
  const submit=async()=>{setSaving(true);onError('');try{await onSave({...draft,...(apiKey?{apiKey}:{}),...(clearKey?{clearApiKey:true}:{})});}catch(error){onError(error instanceof Error?error.message:'Could not save this profile.');}finally{setSaving(false);}};
  return <section className="model-editor"><div className="skill-editor-heading"><div><strong>{value.apiKeySet?'Edit provider profile':'Add provider profile'}</strong><small>Configure an OpenAI-compatible API endpoint for Koodu inference.</small></div><button aria-label="Close editor" onClick={onCancel}><AppIcon icon={Cancel01Icon} size={16}/></button></div><div className="model-form-grid"><label>Profile name<input value={draft.name} maxLength={80} onChange={e=>setDraft({...draft,name:e.target.value})} placeholder="e.g. OpenRouter · Fast model"/></label><label>Provider<select value={draft.provider} onChange={e=>updateProvider(e.target.value as ModelProvider)}>{Object.entries(providerNames).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label><label>Model ID<input value={draft.model} onChange={e=>setDraft({...draft,model:e.target.value})} placeholder="Provider model identifier"/></label><label>API base URL<input value={draft.baseUrl} onChange={e=>setDraft({...draft,baseUrl:e.target.value})} placeholder="https://api.example.com/v1"/></label><label>Inference route<select value={draft.role} onChange={e=>setDraft({...draft,role:e.target.value as 'local'|'cloud',active:false})}><option value="cloud">Cloud reasoning</option><option value="local">Local inference</option></select></label><label>Max output tokens<input type="number" min={64} max={32768} step={64} value={draft.maxOutputTokens} onChange={e=>setDraft({...draft,maxOutputTokens:Number(e.target.value)})}/></label><label>Monthly token cap <small>0 means unlimited</small><input type="number" min={0} max={1000000000} step={1000} value={draft.monthlyTokenLimit} onChange={e=>setDraft({...draft,monthlyTokenLimit:Number(e.target.value)})}/></label><label>API key <small>{draft.apiKeySet&&!apiKey?'Saved on server · leave blank to keep':''}</small><input type="password" autoComplete="new-password" value={apiKey} onChange={e=>{setApiKey(e.target.value);setClearKey(false);}} placeholder={draft.apiKeySet?'Enter a new key to replace':'Paste provider API key'}/></label></div><div className="model-form-options"><label className="model-enabled-toggle"><input type="checkbox" checked={draft.enabled} onChange={e=>setDraft({...draft,enabled:e.target.checked,active:e.target.checked?draft.active:false})}/> Enabled</label>{draft.apiKeySet&&<label className="model-enabled-toggle"><input type="checkbox" checked={clearKey} onChange={e=>setClearKey(e.target.checked)}/> Remove saved key</label>}<label className="model-enabled-toggle"><input type="checkbox" checked={draft.active} onChange={e=>setDraft({...draft,active:e.target.checked,enabled:true})}/> Make active for this route</label></div><div className="model-editor-footer"><span>Compatible with OpenAI Chat Completions APIs. Google AI Studio’s OpenAI-compatible endpoint is supported.</span><div><button className="product-secondary" onClick={onCancel}>Cancel</button><button className="product-primary" disabled={saving||!draft.name.trim()||!draft.model.trim()||!draft.baseUrl.trim()||draft.maxOutputTokens<64||draft.monthlyTokenLimit<0} onClick={()=>void submit()}>{saving?<i className="tiny-spinner"/>:<AppIcon icon={Tick02Icon} size={14}/>} Save profile</button></div></div></section>;
}

type MemoryNote = { id: string; content: string; category: 'preference' | 'fact' | 'task'; updatedAt: number };
function estimateMemoryTokens(text: string): number {
  const chunks = text.match(/[\p{L}\p{N}]+|[^\s]/gu) ?? [];
  return chunks.reduce((total, chunk) => total + (/[^\x00-\x7f]/u.test(chunk) ? Array.from(chunk).length : /^[\p{L}\p{N}]+$/u.test(chunk) ? Math.ceil(chunk.length / 4) : 1), 0);
}
function boundMemoryText(text: string): string {
  const normalized = text.normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
  let accepted = '';
  for (const character of Array.from(normalized).slice(0, 350)) {
    const candidate = accepted + character;
    if (estimateMemoryTokens(candidate) > 128) break;
    accepted = candidate;
  }
  if (accepted.length < normalized.length) {
    const sentenceEnd = Math.max(accepted.lastIndexOf('.'), accepted.lastIndexOf('!'), accepted.lastIndexOf('?'));
    if (sentenceEnd >= accepted.length * 0.5) return accepted.slice(0, sentenceEnd + 1).trim();
    const wordEnd = accepted.lastIndexOf(' ');
    if (wordEnd > 0) accepted = accepted.slice(0, wordEnd);
  }
  return accepted.trim();
}
function readLocalList<T>(key: string): T[] {
  try { const parsed = JSON.parse(localStorage.getItem(key) ?? '[]'); return Array.isArray(parsed) ? parsed as T[] : []; }
  catch { return []; }
}
function MemoryPage() {
  const [notes, setNotes] = useState<MemoryNote[]>(() => readLocalList<MemoryNote>(MEMORY_KEY).filter((note) => note && typeof note.id === 'string' && typeof note.content === 'string' && ['preference','fact','task'].includes(note.category) && typeof note.updatedAt === 'number'));
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [category, setCategory] = useState<MemoryNote['category']>('fact');
  const persist = (next: MemoryNote[]) => { setNotes(next); localStorage.setItem(MEMORY_KEY, JSON.stringify(next)); };
  const startNew = () => { setEditing('new'); setContent(''); setCategory('fact'); };
  const startEdit = (note: MemoryNote) => { setEditing(note.id); setContent(note.content); setCategory(note.category); };
  const save = () => {
    const cleanContent = boundMemoryText(content);
    if (!cleanContent) return;
    const note: MemoryNote = { id: editing === 'new' ? crypto.randomUUID() : editing!, content: cleanContent, category, updatedAt: Date.now() };
    persist(editing === 'new' ? [note, ...notes] : notes.map((item) => item.id === editing ? note : item)); setEditing(null);
    appendLog('memory', editing === 'new' ? 'Memory saved' : 'Memory updated', category, 'success');
  };
  const visible = notes.filter((note) => `${note.content} ${note.category}`.toLowerCase().includes(query.toLowerCase())).sort((a,b) => b.updatedAt-a.updatedAt);
  const remove = (note: MemoryNote) => { persist(notes.filter((item) => item.id !== note.id)); appendLog('memory', 'Memory deleted', note.category, 'warning'); };
  return <div className="product-page memory-page">
    <div className="product-toolbar"><label className="product-search"><AppIcon icon={Search01Icon} size={16}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search saved memories"/></label><button className="product-primary" onClick={startNew}><AppIcon icon={Add01Icon} size={15}/> New memory</button></div>
    <div className="local-data-banner"><span className="local-dot"/> Local browser records <span>·</span> Embedding vectors are generated by the server memory engine.</div>
    <div className="memory-limit-note">Memory text is limited to 350 characters. The server also applies a 128 estimated-token safety limit before embedding.</div>
    {editing !== null && <section className="memory-editor"><div className="editor-heading"><strong>{editing === 'new' ? 'New memory' : 'Edit memory'}</strong><button aria-label="Close editor" onClick={() => setEditing(null)}><AppIcon icon={Cancel01Icon} size={16}/></button></div><div className="memory-editor-row"><input className="memory-content-input" value={content} onChange={(e) => setContent(e.target.value)} placeholder="Write one clear memory…" maxLength={350}/><select aria-label="Memory category" value={category} onChange={(e) => setCategory(e.target.value as MemoryNote['category'])}><option value="preference">Preference</option><option value="fact">Fact</option><option value="task">Task</option></select></div><div className="editor-actions"><span className="memory-token-count">{Array.from(content).length} / 350 characters</span><button className="product-secondary" onClick={() => setEditing(null)}>Cancel</button><button className="product-primary" disabled={!content.trim()} onClick={save}><AppIcon icon={Tick02Icon} size={15}/> Save memory</button></div></section>}
    {visible.length ? <div className="memory-list">{visible.map((note) => <article className="memory-row" key={note.id}><span className="memory-row-content" title={note.content}>{note.content}</span><span className={`memory-category-pill ${note.category}`}>{note.category}</span><time className="memory-row-time" title={new Date(note.updatedAt).toLocaleString()}>{new Date(note.updatedAt).toLocaleDateString()}</time><span className="memory-row-actions"><button title="Edit memory" aria-label="Edit memory" onClick={() => startEdit(note)}><AppIcon icon={Edit01Icon} size={14}/></button><button title="Delete memory" aria-label="Delete memory" onClick={() => remove(note)}><AppIcon icon={Delete02Icon} size={14}/></button></span></article>)}</div> : <div className="product-empty"><span className="empty-mark"><AppIcon icon={Layers01Icon} size={21}/></span><strong>{query ? 'No matching memories' : 'Your memory is ready'}</strong><p>{query ? 'Try a different search.' : 'Save a preference, fact, or task as one concise memory.'}</p>{!query && <button className="product-secondary" onClick={startNew}><AppIcon icon={Add01Icon} size={14}/> Create your first memory</button>}</div>}
    <div className="page-footnote">Memory entries are stored locally in this browser. The UI is not yet connected to the server SQLite store.</div>
  </div>;
}

type AgentDraft = { id: string; type: AgentType; task: string; createdAt: number };
function AgentsPage() {
  const [drafts, setDrafts] = useState<AgentDraft[]>(() => readLocalList<AgentDraft>(AGENT_DRAFTS_KEY));
  const [selected, setSelected] = useState<AgentType | null>(null);
  const [task, setTask] = useState('');
  const [notice, setNotice] = useState('');
  const saveDraft = () => { if (!selected || !task.trim()) return; const next = [{id:crypto.randomUUID(),type:selected,task:task.trim(),createdAt:Date.now()},...drafts]; setDrafts(next); localStorage.setItem(AGENT_DRAFTS_KEY,JSON.stringify(next)); setTask(''); setNotice('Request saved as a local draft. Agent execution is not connected yet.'); };
  return <div className="product-page agents-page">
    <div className="agents-runtime"><span className="runtime-icon"><AppIcon icon={AiSecurity02Icon} size={18}/></span><div><strong>Agent runtime not connected</strong><small>Role catalog is ready. Tasks are saved as local drafts until the AgentEngine is available.</small></div><span className="runtime-badge"><i/> PREVIEW</span></div>
    <div className="section-label-row"><div><strong>Specialists</strong><span>Choose a role to prepare a task request.</span></div><span>{AGENT_TYPES.length} ROLES</span></div>
    <div className="agent-grid">{AGENT_TYPES.map((type,index) => {const info=AGENT_DESCRIPTORS[type];return <button className={`agent-card ${selected===type?'selected':''}`} key={type} onClick={() => setSelected(type)}><span className="agent-avatar"><AppIcon icon={[AiSecurity02Icon, CpuIcon, DashboardSpeed01Icon, Layers01Icon][index] ?? AiSecurity02Icon} size={20}/></span><span className="agent-card-copy"><strong>{info.title}</strong><small>{info.description}</small></span><span className={`risk-pill ${info.risk}`}>{info.risk.toUpperCase()}</span></button>;})}</div>
    {selected && <section className="task-composer"><div className="composer-title"><div><strong>Prepare a task</strong><small>{AGENT_DESCRIPTORS[selected].title}</small></div><button aria-label="Close task composer" onClick={() => setSelected(null)}><AppIcon icon={Cancel01Icon} size={15}/></button></div><textarea rows={3} value={task} onChange={(e)=>setTask(e.target.value)} placeholder={`Describe a task for the ${AGENT_DESCRIPTORS[selected].title}…`}/><div className="composer-bottom"><span>Saved locally as a draft. No agent will run yet.</span><button className="product-primary" disabled={!task.trim()} onClick={saveDraft}><AppIcon icon={Add01Icon} size={15}/> Save request</button></div></section>}
    {notice && <div className="draft-notice"><AppIcon icon={Tick02Icon} size={14}/>{notice}<button onClick={()=>setNotice('')} aria-label="Dismiss"><AppIcon icon={Cancel01Icon} size={13}/></button></div>}
    <div className="section-label-row task-list-heading"><div><strong>Task requests</strong><span>{drafts.length ? 'Local drafts awaiting the agent runtime.' : 'Requests you prepare will appear here.'}</span></div><span>{drafts.length.toString().padStart(2,'0')}</span></div>
    {drafts.length ? <div className="draft-list">{drafts.map((draft)=><article className="draft-row" key={draft.id}><span className="draft-status"/><div><strong>{draft.task}</strong><small>{AGENT_DESCRIPTORS[draft.type].title} · Draft · {new Date(draft.createdAt).toLocaleString()}</small></div><button title="Remove draft" aria-label="Remove draft" onClick={()=>{const next=drafts.filter(d=>d.id!==draft.id);setDrafts(next);localStorage.setItem(AGENT_DRAFTS_KEY,JSON.stringify(next));}}><AppIcon icon={Delete02Icon} size={15}/></button></article>)}</div>:<div className="agent-empty">No task requests yet <span>·</span> select a specialist above to prepare one.</div>}
    <div className="page-footnote">Requests remain drafts; task execution, progress, and cancellation require the AgentEngine integration.</div>
  </div>;
}

function SettingsPage({ character, setCharacter, preferences, updatePreferences, connection }: { character: 'kumo' | 'kitsu'; setCharacter: (value: 'kumo' | 'kitsu') => void; preferences: AppPreferences; updatePreferences: (changes: Partial<AppPreferences>) => void; connection: { status: 'connecting' | 'online' | 'offline'; ping: number | null } }) {
  return <div className="settings-layout">
    <CharacterPicker character={character} setCharacter={setCharacter}/>
    <div className="settings-grid">
      <section className="settings-section">
        <header><span><strong>Companion</strong><small>Animation and motion</small></span><AppIcon icon={SparklesIcon} size={16}/></header>
        <div className="setting-info-row"><span><b>Selected character</b><small>Changed from the companion strip above.</small></span><strong>{character === 'kumo' ? 'Kumo' : 'Kitsu'}</strong></div>
        <SettingToggle label="Animate companion" detail="Play the character’s sprite animations." checked={preferences.animateCompanion} onChange={(checked) => updatePreferences({ animateCompanion: checked })}/>
      </section>
      <section className="settings-section">
        <header><span><strong>Workspace</strong><small>Startup and command bar</small></span><AppIcon icon={DashboardSpeed01Icon} size={16}/></header>
        <label className="setting-select-row"><span><b>Open on startup</b><small>Choose the first page when Koodu starts.</small></span><select value={preferences.startupPage} onChange={(event) => updatePreferences({ startupPage: event.target.value as StartupPage })}><option value="/">Home</option>{pages.map((page) => <option key={page.route} value={page.route}>{page.label}</option>)}</select></label>
        <SettingToggle label="Show keyboard hint" detail="Display the Enter hint in the command bar." checked={preferences.showCommandHint} onChange={(checked) => updatePreferences({ showCommandHint: checked })}/>
      </section>
      <section className="settings-section">
        <header><span><strong>Connection</strong><small>Local server status</small></span><span className={`settings-status ${connection.status}`}><i/>{connection.status}</span></header>
        <div className="setting-info-row"><span><b>WebSocket</b><small>Central workspace connection</small></span><strong>{connection.ping === null ? 'Waiting for ping' : `${connection.ping} ms`}</strong></div>
        <div className="setting-info-row"><span><b>Endpoint</b><small>Development server</small></span><strong className="setting-code">/ws</strong></div>
      </section>
      <section className="settings-section">
        <header><span><strong>Privacy & data</strong><small>Browser storage</small></span><AppIcon icon={ShieldCheckIcon} size={16}/></header>
        <div className="setting-info-row"><span><b>Companion and preferences</b><small>Saved locally in this browser.</small></span><strong>LOCAL</strong></div>
        <div className="setting-info-row"><span><b>Credentials</b><small>API secrets are not stored here.</small></span><strong>SECURE</strong></div>
      </section>
    </div>
  </div>;
}

function SettingToggle({ label, detail, checked, onChange }: { label: string; detail: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <div className="setting-toggle-row"><span><b>{label}</b><small>{detail}</small></span><button type="button" role="switch" aria-checked={checked} aria-label={label} className={`setting-switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}><i/></button></div>;
}

function CharacterPicker({ character, setCharacter }: { character: 'kumo' | 'kitsu'; setCharacter: (value: 'kumo' | 'kitsu') => void }) {
  return <section className="settings-card" aria-label="Choose companion">
    <div className="settings-title"><div><strong>Companion character</strong><small>Select the character shown in your workspace.</small></div><span className="companion-count">2 CHARACTERS</span></div>
    <div className="character-options">
      {(['kumo', 'kitsu'] as const).map((id) => <CharacterOption key={id} id={id} selected={character === id} onSelect={() => setCharacter(id)}/>)}
    </div>
  </section>;
}

function CharacterOption({ id, selected, onSelect }: { id: 'kumo' | 'kitsu'; selected: boolean; onSelect: () => void }) {
  const [happy, setHappy] = useState<Animation | null>(null);
  useEffect(() => {
    let cancelled = false;
    kooduSocket.request<{ animations?: Record<string, Animation> } & Record<string, Animation>>('companion.manifest', { character: id }).then((manifest) => {
      const animations = manifest?.animations ?? manifest;
      if (!cancelled && animations?.happy) setHappy(animations.happy as Animation);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [id]);
  const name = id === 'kumo' ? 'Kumo' : 'Kitsu';
  return <button type="button" className={`character-option ${selected ? 'chosen' : ''}`} aria-pressed={selected} onClick={onSelect}>
    <span className="character-preview" aria-hidden="true">{happy ? <SpriteSheet key={`${id}-${happy.file}`} character={id} animation={happy} size={116} loop/> : <AppIcon icon={SparklesIcon} size={28}/>}</span>
    <span className="character-copy"><b>{name}</b><small>{id === 'kumo' ? 'Panda companion' : 'Kitsune companion'}</small></span>
    <span className={`character-choice ${selected ? 'active' : ''}`}>{selected ? 'ACTIVE' : 'SELECT'}</span>
  </button>;
}

function CommandBar({ value, setValue, submit, showHint }: { value: string; setValue: (value: string) => void; submit: () => void; showHint: boolean }) {
  return <div className="command-bar"><button title="Voice input" className="command-mic"><AppIcon icon={Mic01Icon} size={17}/></button><span className="command-prompt">›</span><input value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submit(); }} placeholder="Type a command, open a page, or ask Koodu…"/>{showHint && <span className="command-hint"><AppIcon icon={CommandIcon} size={10}/> ENTER</span>}<button className="command-send" onClick={submit} title="Send command"><AppIcon icon={ArrowRight01Icon} size={20}/></button></div>;
}

export default App;
