import { useEffect, useRef, useState, type ReactNode } from 'react';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  AiSecurity02Icon, ArrowRight01Icon, CommandIcon, CpuIcon, DashboardSpeed01Icon,
  Home01Icon, Layers01Icon, Mic01Icon, Settings01Icon, ShieldCheckIcon, SparklesIcon,
  Add01Icon, Cancel01Icon, Search01Icon, Delete02Icon, Clock01Icon, Tick02Icon, Edit01Icon,
  Activity01Icon, ArrowUpRight01Icon, ChartLineData01Icon, Coins01Icon, Download01Icon,
  FileSearchIcon, FilterIcon, Refresh01Icon, Delete01Icon,
  PuzzleIcon, BookOpen01Icon, Upload01Icon,
  Message01Icon,
} from '@hugeicons/core-free-icons';
import { AGENT_DESCRIPTORS, AGENT_TYPES, defaultWorkspaceSettings, workspaceSettingsSchema, type AgentType } from '@koodu/protocol';
import type { RpcLogEntry, SettingsSnapshot, WorkspaceRoute, WorkspaceSettings } from '@koodu/protocol';
import { kooduSocket, type SocketState } from '../lib/socket';
import { usePetController } from '../pet/pet-controller';

type PetActivity = 'idle' | 'listening' | 'thinking' | 'working' | 'talking' | 'happy' | 'confused' | 'error' | 'sleeping';
type Animation = { file: string; frameCount: number; frameWidth: number; frameHeight: number; fps: number; loop: boolean };
const fallbackIdleAnimation: Animation = { file: 'idle.png', frameCount: 6, frameWidth: 512, frameHeight: 512, fps: 8, loop: true };
type StartupPage = '/' | WorkspaceRoute;
type AppPreferences = Pick<WorkspaceSettings, 'animateCompanion' | 'showCommandHint' | 'startupPage'>;
const PREFERENCES_KEY = 'koodu:settings:v1';
const COMPANION_KEY = 'koodu:companion';
// Browser holds only a validated write-through cache for instant startup.
// The server SQLite row is authoritative; cache values are never auto-uploaded.
function readCachedSettings(): WorkspaceSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? 'null') as Partial<WorkspaceSettings> | null;
    const candidate = stored?.startupPage;
    const startupPage: StartupPage = candidate === '/' || pages.some((page) => page.route === candidate) ? candidate as StartupPage : '/';
    const cachedCharacter = stored?.character ?? localStorage.getItem(COMPANION_KEY);
    return {
      character: cachedCharacter === 'kitsu' || cachedCharacter === 'kumo' ? cachedCharacter : defaultWorkspaceSettings.character,
      animateCompanion: typeof stored?.animateCompanion === 'boolean' ? stored.animateCompanion : defaultWorkspaceSettings.animateCompanion,
      showCommandHint: typeof stored?.showCommandHint === 'boolean' ? stored.showCommandHint : defaultWorkspaceSettings.showCommandHint,
      startupPage,
      petMode: stored?.petMode === 'floating' || stored?.petMode === 'hidden' || stored?.petMode === 'embedded' ? stored.petMode : defaultWorkspaceSettings.petMode,
    };
  } catch { return defaultWorkspaceSettings; }
}
function writeCachedSettings(settings: WorkspaceSettings) {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ animateCompanion: settings.animateCompanion, showCommandHint: settings.showCommandHint, startupPage: settings.startupPage, petMode: settings.petMode }));
    localStorage.setItem(COMPANION_KEY, settings.character);
  } catch { /* Cache is best-effort; the server copy remains authoritative. */ }
}
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
  { route: '/workspace/chats', label: 'Chats', icon: Message01Icon, subtitle: 'Continue a conversation with your companion.' },
  { route: '/workspace/usage', label: 'Usage', icon: DashboardSpeed01Icon, subtitle: 'A clear view of your activity and resource use.' },
  { route: '/workspace/models', label: 'Models', icon: CpuIcon, subtitle: 'Manage the intelligence behind your companion.' },
  { route: '/workspace/agents', label: 'Agents', icon: AiSecurity02Icon, subtitle: 'Meet the agents working alongside Koodu.' },
  { route: '/workspace/memory', label: 'Memory', icon: Layers01Icon, subtitle: 'Review the context your companion remembers.' },
  { route: '/workspace/logs', label: 'Logs', icon: FileSearchIcon, subtitle: 'Inspect workspace events and connection diagnostics.' },
  { route: '/workspace/skills', label: 'Skills', icon: PuzzleIcon, subtitle: 'Manage reusable instructions for your agents.' },
  { route: '/workspace/settings', label: 'Settings', icon: Settings01Icon, subtitle: 'Manage your companion and workspace preferences.' },
];

type LogEntry = RpcLogEntry;

function AppIcon({ icon, size, className }: { icon: IconSvgElement; size: number; className?: string }) {
  return <HugeiconsIcon icon={icon} size={size} className={className} aria-hidden="true"/>;
}

function pageFromPath(path: string) { return pages.find((page) => page.route === path); }

function useRoute() {
  const [path, setPath] = useState(() => {
    if (location.pathname !== '/') return location.pathname;
    const startupPage = readCachedSettings().startupPage;
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
    const update = () => {
      setSnapshot(kooduSocket.snapshot);
    };
    kooduSocket.connect();
    const unsubscribe = kooduSocket.subscribe(update);
    update();
    kooduSocket.ping();
    const heartbeat = window.setInterval(() => kooduSocket.ping(), 5000);
    return () => {
      window.clearInterval(heartbeat);
      unsubscribe();
    };
  }, []);
  return { ...snapshot, status: snapshot.state };
}

type SettingsStatus = 'loading' | 'ready' | 'saving' | 'error';

function App() {
  const { path, navigate } = useRoute();
  const realtime = useRealtime();
  const currentPage = pageFromPath(path);
  // Server is source of truth; state starts from the validated cache for instant paint.
  const [settings, setSettings] = useState<WorkspaceSettings>(readCachedSettings);
  const settingsRef = useRef<WorkspaceSettings>(settings);
  const [settingsMeta, setSettingsMeta] = useState<{ updatedAt: string | null; persistence: string }>({ updatedAt: null, persistence: 'sqlite' });
  const [settingsStatus, setSettingsStatus] = useState<SettingsStatus>('loading');
  const [settingsError, setSettingsError] = useState('');
  const [settingsNotice, setSettingsNotice] = useState('');
  const character = settings.character;
  const activity = usePetController((state) => state.activity);
  const dispatchPetAction = usePetController((state) => state.dispatchAction);
  const petMode = usePetController((state) => state.mode);
  const setPetMode = usePetController((state) => state.setMode);
  const [animations, setAnimations] = useState<Record<string, Animation>>({});
  const [command, setCommand] = useState('');
  const [feedback, setFeedback] = useState('');
  useEffect(() => {
    let cancelled = false;
    fetch(`/companion/${character}/animation_manifest.json`)
      .then((response) => (response.ok ? response.json() : null))
      .then((manifest) => {
        if (!cancelled) setAnimations((manifest?.animations ?? manifest) ?? {});
      })
      .catch(() => { if (!cancelled) setAnimations({}); });
    return () => { cancelled = true; };
  }, [character]);

  const applyServerSettings = (snapshot: SettingsSnapshot) => {
    settingsRef.current = snapshot.settings;
    setSettings(snapshot.settings);
    setSettingsMeta({ updatedAt: snapshot.updatedAt, persistence: snapshot.persistence });
    writeCachedSettings(snapshot.settings);
    setPetMode(snapshot.settings.petMode);
  };
  const loadServerSettings = async () => {
    setSettingsStatus((current) => current === 'error' || current === 'ready' ? 'loading' : current);
    setSettingsError('');
    try {
      const snapshot = await kooduSocket.request<SettingsSnapshot>('settings.get');
      applyServerSettings(snapshot);
      setSettingsStatus('ready');
    } catch (error) {
      setSettingsStatus('error');
      setSettingsError(error instanceof Error ? error.message : 'Could not load settings from the server.');
    }
  };
  useEffect(() => { void loadServerSettings(); }, []);
  // If the server startup page differs from the cached one used for first paint, follow it once.
  const initialPathRef = useRef(path);
  const startupAppliedRef = useRef(false);
  useEffect(() => {
    if (startupAppliedRef.current || settingsStatus !== 'ready') return;
    startupAppliedRef.current = true;
    if (initialPathRef.current === '/' && settings.startupPage !== '/' && location.pathname === '/') navigate(settings.startupPage);
  }, [settingsStatus, settings.startupPage, navigate]);

  const saveSettings = async (next: WorkspaceSettings) => {
    const previous = settingsRef.current;
    settingsRef.current = next;
    setSettings(next);
    writeCachedSettings(next);
    setPetMode(next.petMode);
    setSettingsStatus('saving');
    setSettingsError('');
    setSettingsNotice('');
    try {
      const snapshot = await kooduSocket.request<SettingsSnapshot>('settings.save', next as unknown as Record<string, unknown>);
      applyServerSettings(snapshot);
      setSettingsStatus('ready');
    } catch (error) {
      settingsRef.current = previous;
      setSettings(previous);
      writeCachedSettings(previous);
      setPetMode(previous.petMode);
      setSettingsStatus('error');
      setSettingsError(error instanceof Error ? error.message : 'Could not save settings on the server.');
    }
  };
  const updatePreferences = (changes: Partial<AppPreferences>) => { void saveSettings({ ...settingsRef.current, ...changes }); };
  const setCharacter = (value: 'kumo' | 'kitsu') => { void saveSettings({ ...settingsRef.current, character: value }); };
  const resetSettings = async () => {
    setSettingsStatus('saving'); setSettingsError(''); setSettingsNotice('');
    try {
      const snapshot = await kooduSocket.request<SettingsSnapshot>('settings.reset');
      applyServerSettings(snapshot);
      setSettingsStatus('ready');
      setSettingsNotice('Settings reset to defaults on the server.');
    } catch (error) {
      setSettingsStatus('error');
      setSettingsError(error instanceof Error ? error.message : 'Could not reset settings on the server.');
    }
  };
  const exportSettings = () => {
    const payload = JSON.stringify({ ...settings, updatedAt: settingsMeta.updatedAt }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'koodu-settings.json'; anchor.click(); URL.revokeObjectURL(url);
  };
  const importSettings = async (file: File) => {
    setSettingsError(''); setSettingsNotice('');
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const candidate = parsed && typeof parsed === 'object' && 'settings' in (parsed as Record<string, unknown>)
        ? (parsed as { settings: unknown }).settings
        : parsed;
      const checked = workspaceSettingsSchema.safeParse(candidate);
      if (!checked.success) throw new Error('Import file does not contain valid Koodu settings.');
      await saveSettings(checked.data);
      setSettingsNotice('Settings imported and saved on the server.');
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : 'Import failed. Check the JSON file.');
      setSettingsStatus('error');
    }
  };

  const submit = async () => {
    const text = command.trim();
    if (!text) return;
    setCommand('');
    dispatchPetAction('think');
    setFeedback('');
    try {
      const result = await kooduSocket.request<{ reply: string; proposal: { action: string; args: unknown } | null }>(
        'agent.run', { role: 'cloud', text, context: { currentPath: path } },
        { onStream: (event) => setFeedback((current) => event.kind === 'reset' ? '' : current + event.text) },
      );
      if (result.proposal?.action === 'open_tab' && result.proposal.args && typeof result.proposal.args === 'object') {
        const route = (result.proposal.args as { route?: unknown }).route;
        const requested = pages.find((page) => page.route === route);
        if (requested) navigate(requested.route);
      }
      setFeedback(result.reply);
      dispatchPetAction(result.proposal ? 'celebrate' : 'speak');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'The companion could not complete that request.');
      dispatchPetAction('speak');
    }
    window.setTimeout(() => { dispatchPetAction('reset'); setFeedback(''); }, 5000);
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
        {currentPage ? <ModulePage page={currentPage} character={character} setCharacter={setCharacter} preferences={settings} updatePreferences={updatePreferences} settingsControls={{ meta: settingsMeta, status: settingsStatus, error: settingsError, notice: settingsNotice, onRefresh: () => void loadServerSettings(), onReset: () => void resetSettings(), onExport: exportSettings, onImport: (file) => void importSettings(file) }} connection={realtime}/> : <HomePage activity={activity} character={character} animations={animations} animateCompanion={settings.animateCompanion} petMode={petMode}/>}
        {feedback && <div className="command-feedback"><span className="feedback-spark"><AppIcon icon={SparklesIcon} size={13}/></span>{feedback}</div>}
        {!currentPage && <CommandBar value={command} setValue={setCommand} submit={submit} showHint={settings.showCommandHint}/>}
        <div className="bottom-status"><span><i className={realtime.status}/> {realtime.status === 'online' ? 'CONNECTED' : realtime.status === 'connecting' ? 'CONNECTING' : 'RECONNECTING'}</span><span>WS <b/> PING: {realtime.ping === null ? '—' : `${realtime.ping}ms`} <span className="ping-bars"><i/><i/><i/><i/></span></span></div>
      </section>
    </section>
    {petMode !== 'hidden' && <FloatingPet activity={activity} character={character} animations={animations} animate={settings.animateCompanion} mode={petMode} large={!currentPage} onModeChange={setPetMode} onCharacterChange={setCharacter}/>}
  </main>;
}

function NavItem({ label, icon, selected, onClick }: { label: string; icon: IconSvgElement; selected: boolean; onClick: () => void }) {
  return <button className={`nav-item ${selected ? 'selected' : ''}`} title={label} aria-label={label} onClick={onClick}><AppIcon icon={icon} size={17}/><span className="nav-tooltip">{label}</span></button>;
}

function HomePage({ activity, character, animations, animateCompanion, petMode }: { activity: PetActivity; character: 'kumo' | 'kitsu'; animations: Record<string, Animation>; animateCompanion: boolean; petMode: 'floating' | 'embedded' | 'hidden' }) {
  const copy = homeCopy[activity];
  return <>
    <div className="home-heading"><div><span className="eyebrow">KOODU / HOME</span><h1 aria-live="polite"><span>{copy.lead} </span><em>{copy.accent}</em></h1><p>{copy.detail}</p></div></div>
    <div className={`home-scene pet-mode-${petMode}`}>
      <div className="ambient ambient-left"/><div className="ambient ambient-right"/>
      <div className="scene-mark scene-mark-one"/><div className="scene-mark scene-mark-two"/>
      {petMode === 'hidden' ? <div className="pet-hidden-note"><strong>Companion hidden</strong><span>Change display mode in Settings.</span></div> : null}
      {petMode !== 'hidden' && petMode !== 'floating' && <div className="pet-nameplate"><span className="character-name">{character === 'kumo' ? 'KUMO' : 'KITSU'}</span></div>}
    </div>
  </>;
}

function PetCharacter({ activity, character, animations, animate }: { activity: PetActivity; character: 'kumo' | 'kitsu'; animations: Record<string, Animation>; animate: boolean }) {
  const animation = animations[activity] ?? animations.idle ?? fallbackIdleAnimation;
  return <div className="pet-character" title={`${character === 'kumo' ? 'Kumo' : 'Kitsu'} · ${activity}`}>
    <SpriteSheet key={`${character}-${activity}-${animation.file}`} character={character} animation={animation} size="clamp(112px, min(42vw, 29vh), 210px)" animate={animate}/>
  </div>;
}

function SpriteSheet({ character, animation, size = 250, animate = true, loop }: { character: 'kumo' | 'kitsu'; animation: Animation; size?: number | string; animate?: boolean; loop?: boolean }) {
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
  const dynamicSize = typeof size === 'string';
  return <span className="sprite-sheet" role="img" aria-label={`${character} companion animation`} style={{ width: dynamicSize ? size : `${size}px`, height: dynamicSize ? 'auto' : `${size * animation.frameHeight / animation.frameWidth}px`, aspectRatio: `${animation.frameWidth} / ${animation.frameHeight}`, backgroundImage: `url(/companion/${character}/${animation.file})`, backgroundPosition: `${framePercent}% 0`, backgroundSize: `${animation.frameCount * 100}% 100%` }}/>;
}

type SettingsControls = { meta: { updatedAt: string | null; persistence: string }; status: SettingsStatus; error: string; notice: string; onRefresh: () => void; onReset: () => void; onExport: () => void; onImport: (file: File) => void };

function ModulePage({ page, character, setCharacter, preferences, updatePreferences, settingsControls, connection }: { page: RoutePage; character: 'kumo' | 'kitsu'; setCharacter: (value: 'kumo' | 'kitsu') => void; preferences: WorkspaceSettings; updatePreferences: (changes: Partial<AppPreferences> & { petMode?: WorkspaceSettings['petMode'] }) => void; settingsControls: SettingsControls; connection: { status: 'connecting' | 'online' | 'offline'; ping: number | null } }) {
  if (page.label === 'Chats') {
    return <div className="module-page-content chats-fullbleed"><ChatsPage/></div>;
  }
  return <div className={`module-page-content ${page.label === 'Settings' ? 'settings-page-content' : ''}`}>
    <div className="module-heading">
      <div><div className="eyebrow">KOODU / WORKSPACE / {page.label.toUpperCase()}</div><h1>{page.label}</h1><p>{page.subtitle}</p></div>
      <span className="module-page-icon"><AppIcon icon={page.icon} size={19}/></span>
    </div>
    {page.label === 'Settings' ? <SettingsPage character={character} setCharacter={setCharacter} preferences={preferences} updatePreferences={updatePreferences} settingsControls={settingsControls} connection={connection}/>
    : page.label === 'Memory' ? <MemoryPage/>
    : page.label === 'Agents' ? <AgentsPage/>
    : page.label === 'Chats' ? <ChatsPage/>
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
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [clearing, setClearing] = useState(false);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const receive = (entry: LogEntry) => {
    setEntries((current) => [...new Map([...current, entry].map((item) => [item.id, item])).values()].sort((a,b) => b.at-a.at).slice(0,500));
  };
  const requestSnapshot = async () => {
    setError(''); setLoading(true);
    try {
      const result = await kooduSocket.request<{entries:LogEntry[]}>('logs.watch');
      setEntries(result.entries.sort((a,b) => b.at-a.at).slice(0,500));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load server logs.'); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    let active = true;
    let watching = false;
    const unlistenEntries = kooduSocket.subscribeLogEntries(receive);
    const startWatching = () => {
      if (!active || watching || kooduSocket.snapshot.state !== 'online') return;
      watching = true;
      void requestSnapshot().catch(() => { watching = false; });
    };
    const unlistenSocket = kooduSocket.subscribe(() => {
      if (kooduSocket.snapshot.state === 'online') startWatching();
      else watching = false;
    });
    startWatching();
    return () => {
      active = false;
      unlistenEntries(); unlistenSocket();
      if (watching && kooduSocket.snapshot.state === 'online') void kooduSocket.request('logs.unwatch').catch(() => {});
    };
  }, []);
  const sources = [...new Set(entries.map((entry) => entry.source))];
  const filtered = entries.filter((entry) => (source === 'all' || entry.source === source) && `${entry.message} ${entry.detail ?? ''} ${entry.source}`.toLowerCase().includes(query.toLowerCase()));
  const exportLogs = () => {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], {type:'application/json'}); const url=URL.createObjectURL(blob); const anchor=document.createElement('a'); anchor.href=url; anchor.download='koodu-workspace-logs.json'; anchor.click(); URL.revokeObjectURL(url);
  };
  const clearLogs = async () => {
    setClearing(true); setError('');
    try { await kooduSocket.request('logs.clear'); setEntries([]); setExpanded(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not clear server logs.'); }
    finally { setClearing(false); }
  };
  return <div className="product-page logs-page">
    <div className="logs-toolbar"><label className="product-search"><AppIcon icon={Search01Icon} size={16}/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search events, details, or source"/></label><LogSourceDropdown value={source} options={['all',...sources]} onChange={setSource}/><button className="product-secondary logs-export" onClick={exportLogs} disabled={!filtered.length}><AppIcon icon={Download01Icon} size={14}/> Export</button><button className="product-secondary" title="Refresh logs" aria-label="Refresh logs" onClick={()=>void requestSnapshot()} disabled={loading}><AppIcon icon={Refresh01Icon} size={14}/></button><button className="product-secondary logs-clear" onClick={()=>void clearLogs()} disabled={!entries.length||clearing}><AppIcon icon={Delete01Icon} size={14}/> Clear</button></div>
    {error&&<div className="model-error"><AppIcon icon={Cancel01Icon} size={15}/>{error}<button onClick={()=>void requestSnapshot()}>Retry</button></div>}
    <div className="logs-table-wrap"><div className="logs-table-head"><span>EVENT</span><span>SOURCE</span><span>TIME</span><span>LEVEL</span></div>{loading?<div className="logs-empty"><i className="tiny-spinner"/><strong>Loading server records</strong><span>Fetching the latest entries from the server.</span></div>:filtered.length ? filtered.map((entry)=><article className={`log-entry ${expanded===entry.id?'expanded':''}`} key={entry.id}><button className="log-entry-main" onClick={()=>setExpanded(expanded===entry.id?null:entry.id)} aria-expanded={expanded===entry.id}><span className={`log-indicator ${entry.level}`}/><span className="log-event-copy"><strong>{entry.message}</strong><small>{entry.detail ?? 'No additional details.'}</small></span><span className="log-source">{entry.source}</span><span className="log-time" title={new Date(entry.at).toLocaleString()}>{new Date(entry.at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span><span className={`log-level ${entry.level}`}>{entry.level}</span></button>{expanded===entry.id && <div className="log-entry-detail"><span>EVENT ID <b>{entry.id}</b></span><span>OCCURRED <b>{new Date(entry.at).toLocaleString()}</b></span><span>DETAIL <b>{entry.detail ?? '—'}</b></span></div>}</article>) : <div className="logs-empty"><AppIcon icon={FileSearchIcon} size={22}/><strong>{entries.length ? 'No matching events' : 'No server records yet'}</strong><span>{entries.length ? 'Change the search or source filter.' : 'Server requests and operations will appear here.'}</span></div>}</div>
  </div>;
}

function LogSourceDropdown({value,options,onChange}:{value:string;options:string[];onChange:(value:string)=>void}){
  const [open,setOpen]=useState(false);
  const root=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!open)return;
    const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false);};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
  },[open]);
  return <div className="logs-source-select" ref={root}>
    <button type="button" className="logs-source-trigger" aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(current=>!current)}><AppIcon icon={FilterIcon} size={14}/><span>{value==='all'?'All sources':value}</span><i/></button>
    {open&&<div className="logs-source-menu" role="menu" aria-label="Filter log source">{options.map(option=><button type="button" role="menuitemradio" aria-checked={value===option} className={value===option?'selected':''} key={option} onClick={()=>{onChange(option);setOpen(false);}}>{option==='all'?'All sources':option}</button>)}</div>}
  </div>;
}

type SkillCategory = 'Research' | 'Development' | 'Organization' | 'Custom';
type SkillRecord = { id: string; name: string; description: string; category: SkillCategory; instructions: string; enabled: boolean; source: string; updatedAt: number };
const skillCategories: SkillCategory[] = ['Research','Development','Organization','Custom'];
type SkillListResponse = { skills: SkillRecord[] };
function normalizeSkills(value: unknown): SkillRecord[] { return Array.isArray(value) ? value.filter((item): item is SkillRecord => Boolean(item && typeof item==='object' && typeof (item as SkillRecord).id==='string' && typeof (item as SkillRecord).name==='string' && typeof (item as SkillRecord).description==='string' && typeof (item as SkillRecord).instructions==='string' && skillCategories.includes((item as SkillRecord).category) && typeof (item as SkillRecord).enabled==='boolean' && typeof (item as SkillRecord).source==='string' && typeof (item as SkillRecord).updatedAt==='number')) : []; }
function SkillsPage() {
  const [skills,setSkills]=useState<SkillRecord[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [query,setQuery]=useState('');
  const [category,setCategory]=useState<'All'|SkillCategory>('All');
  const [stateFilter,setStateFilter]=useState<'all'|'enabled'|'disabled'>('all');
  const [editing,setEditing]=useState<SkillRecord|null>(null);
  const [details,setDetails]=useState<string|null>(null);
  const [notice,setNotice]=useState('');
  const importRef=useRef<HTMLInputElement>(null);
  const load=async()=>{setLoading(true);setError('');try{const body=await kooduSocket.request<SkillListResponse>('skills.list');setSkills(normalizeSkills(body.skills));}catch(reason){setError(reason instanceof Error?reason.message:'Could not load skills.');}finally{setLoading(false);}};
  useEffect(()=>{void load();},[]);
  const beginCreate=()=>{setEditing({id:'new',name:'',description:'',category:'Custom',instructions:'',enabled:true,source:'Custom',updatedAt:Date.now()});setDetails(null);};
  const saveSkill=async(skill:SkillRecord)=>{const value={...skill,id:skill.id==='new'?crypto.randomUUID():skill.id,name:skill.name.trim(),description:skill.description.trim(),instructions:skill.instructions.trim(),source:skill.source==='Koodu starter'?'Koodu starter':'Custom'};if(!value.name||!value.description||!value.instructions)return;setBusy(true);setError('');try{const result=await kooduSocket.request<SkillListResponse>('skills.save',value);setSkills(normalizeSkills(result.skills));setEditing(null);setNotice(`“${value.name}” saved.`);}catch(reason){setError(reason instanceof Error?reason.message:'Could not save skill.');}finally{setBusy(false);}};
  const toggle=async(skill:SkillRecord)=>{setBusy(true);setError('');try{const result=await kooduSocket.request<SkillListResponse>('skills.save',{...skill,enabled:!skill.enabled});setSkills(normalizeSkills(result.skills));}catch(reason){setError(reason instanceof Error?reason.message:'Could not update skill.');}finally{setBusy(false);}};
  const remove=async(skill:SkillRecord)=>{setBusy(true);setError('');try{const result=await kooduSocket.request<SkillListResponse>('skills.delete',{id:skill.id});setSkills(normalizeSkills(result.skills));setDetails(null);setNotice(`“${skill.name}” removed.`);}catch(reason){setError(reason instanceof Error?reason.message:'Could not delete skill.');}finally{setBusy(false);}};
  const visible=skills.filter(skill=>(category==='All'||skill.category===category)&&(stateFilter==='all'||(stateFilter==='enabled'?skill.enabled:!skill.enabled))&&`${skill.name} ${skill.description} ${skill.instructions}`.toLowerCase().includes(query.toLowerCase()));
  const exportSkills=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(skills,null,2)],{type:'application/json'}));const anchor=document.createElement('a');anchor.href=url;anchor.download='koodu-skills.json';anchor.click();URL.revokeObjectURL(url);};
  const importSkills=async(file:File)=>{try{const parsed=JSON.parse(await file.text());const incoming=Array.isArray(parsed)?parsed:parsed.skills;if(!Array.isArray(incoming))throw new Error('Expected a skill array.');const additions:SkillRecord[]=incoming.filter((item:any)=>item&&typeof item.name==='string'&&typeof item.description==='string'&&typeof item.instructions==='string').map((item:any)=>({id:crypto.randomUUID(),name:item.name.trim().slice(0,80),description:item.description.trim().slice(0,180),category:skillCategories.includes(item.category)?item.category:'Custom',instructions:item.instructions.trim().slice(0,12000),enabled:typeof item.enabled==='boolean'?item.enabled:true,source:'Imported',updatedAt:Date.now()})).filter(item=>item.name&&item.description&&item.instructions);if(!additions.length)throw new Error('No valid skills found.');setBusy(true);const result=await kooduSocket.request<SkillListResponse>('skills.import',{skills:additions});setSkills(normalizeSkills(result.skills));setNotice(`${additions.length} skill${additions.length===1?'':'s'} imported.`);}catch(reason){setError(reason instanceof Error?reason.message:'Import failed. Check the JSON file.');}finally{setBusy(false);if(importRef.current)importRef.current.value='';}};
  return <div className="product-page skills-page">
    <div className="skills-toolbar"><label className="product-search"><AppIcon icon={Search01Icon} size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search your skills"/></label><button className="product-secondary" onClick={()=>importRef.current?.click()} disabled={busy}><AppIcon icon={Upload01Icon} size={14}/> Import</button><input ref={importRef} type="file" accept="application/json,.json" hidden onChange={e=>{const file=e.target.files?.[0];if(file)void importSkills(file);}}/><button className="product-secondary" onClick={exportSkills} disabled={loading||!skills.length}><AppIcon icon={Download01Icon} size={14}/> Export</button><button className="product-secondary" onClick={()=>void load()} disabled={loading||busy}><AppIcon icon={Refresh01Icon} size={14}/></button><button className="product-primary" onClick={beginCreate}><AppIcon icon={Add01Icon} size={15}/> New skill</button></div>
    <div className="skills-controls"><div className="skill-categories">{(['All',...skillCategories] as const).map(item=><button key={item} className={category===item?'active':''} onClick={()=>setCategory(item)}>{item}</button>)}</div><div className="skill-state-filter"><button className={stateFilter==='all'?'active':''} onClick={()=>setStateFilter('all')}>All {skills.length}</button><button className={stateFilter==='enabled'?'active':''} onClick={()=>setStateFilter('enabled')}>Enabled {skills.filter(skill=>skill.enabled).length}</button><button className={stateFilter==='disabled'?'active':''} onClick={()=>setStateFilter('disabled')}>Disabled {skills.filter(skill=>!skill.enabled).length}</button></div></div>
    {error&&<div className="model-error"><AppIcon icon={Cancel01Icon} size={15}/>{error}<button onClick={()=>void load()}>Retry</button></div>}{notice&&<div className="skill-notice"><AppIcon icon={Tick02Icon} size={14}/>{notice}<button aria-label="Dismiss notice" onClick={()=>setNotice('')}><AppIcon icon={Cancel01Icon} size={13}/></button></div>}
    {editing&&<SkillEditor key={editing.id} value={editing} onSave={saveSkill} onCancel={()=>setEditing(null)}/>}
    {loading?<div className="product-empty">Loading skills…</div>:visible.length?<div className="skill-grid">{visible.map(skill=><article className={`skill-card ${!skill.enabled?'disabled':''} ${details===skill.id?'open':''}`} key={skill.id}><div className="skill-card-head"><span className="skill-card-icon"><AppIcon icon={skill.category==='Research'?Search01Icon:skill.category==='Development'?CpuIcon:skill.category==='Organization'?DashboardSpeed01Icon:BookOpen01Icon} size={18}/></span><span className="skill-source">{skill.source}</span><button className={`skill-switch ${skill.enabled?'on':''}`} role="switch" aria-checked={skill.enabled} aria-label={`${skill.enabled?'Disable':'Enable'} ${skill.name}`} disabled={busy} onClick={()=>void toggle(skill)}><i/></button></div><button className="skill-card-info" onClick={()=>setDetails(details===skill.id?null:skill.id)} aria-expanded={details===skill.id}><span className="skill-meta">{skill.category.toUpperCase()}</span><strong>{skill.name}</strong><small>{skill.description}</small></button>{details===skill.id&&<div className="skill-instructions"><span>INSTRUCTIONS</span><p>{skill.instructions}</p></div>}<div className="skill-card-footer"><span className={`skill-enabled-state ${skill.enabled?'enabled':''}`}><i/>{skill.enabled?'Enabled':'Disabled'}</span><div><button aria-label={`Edit ${skill.name}`} title="Edit" disabled={busy} onClick={()=>{setEditing(skill);setDetails(null);}}><AppIcon icon={Edit01Icon} size={14}/></button><button aria-label={`Delete ${skill.name}`} title="Delete" disabled={busy} onClick={()=>void remove(skill)}><AppIcon icon={Delete02Icon} size={14}/></button></div></div></article>)}</div>:<div className="product-empty"><span className="empty-mark"><AppIcon icon={PuzzleIcon} size={21}/></span><strong>{skills.length?'No skills match these filters':'No skills yet'}</strong><p>Try a different filter or create a skill for your library.</p><button className="product-secondary" onClick={beginCreate}><AppIcon icon={Add01Icon} size={14}/> Create a skill</button></div>}
  </div>;
}
function SkillEditor({value,onSave,onCancel}:{value:SkillRecord;onSave:(skill:SkillRecord)=>void|Promise<void>;onCancel:()=>void}) {
  const [draft,setDraft]=useState(value);
  return <section className="skill-editor"><div className="skill-editor-heading"><div><strong>{value.id==='new'?'Create a skill':'Edit skill'}</strong><small>Write clear steps an agent can follow.</small></div><button aria-label="Close editor" onClick={onCancel}><AppIcon icon={Cancel01Icon} size={16}/></button></div><div className="skill-form-grid"><label>Skill name<input value={draft.name} maxLength={80} onChange={e=>setDraft({...draft,name:e.target.value})} placeholder="e.g. Release checklist"/></label><label>Category<select value={draft.category} onChange={e=>setDraft({...draft,category:e.target.value as SkillCategory})}>{skillCategories.map(category=><option key={category}>{category}</option>)}</select></label><label className="skill-description-field">Description<input value={draft.description} maxLength={180} onChange={e=>setDraft({...draft,description:e.target.value})} placeholder="What does this skill help with?"/></label><label className="skill-instructions-field">Instructions<textarea rows={5} maxLength={12000} value={draft.instructions} onChange={e=>setDraft({...draft,instructions:e.target.value})} placeholder="Write the steps, constraints, and expected output…"/></label></div><div className="skill-editor-actions"><button className="product-secondary" onClick={onCancel}>Cancel</button><button className="product-primary" disabled={!draft.name.trim()||!draft.description.trim()||!draft.instructions.trim()} onClick={()=>void onSave(draft)}><AppIcon icon={Tick02Icon} size={14}/> Save skill</button></div></section>;
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
  const save=async(value:Omit<ModelProfile,'apiKeySet'>&{apiKey?:string;clearApiKey?:boolean})=>{await kooduSocket.request('models.save',value);setEditor(null);setNotice('Model profile saved securely on the server.');load();};
  const remove=async(profile:ModelProfile)=>{try{await kooduSocket.request('models.delete',{id:profile.id});setProfiles(items=>items.filter(item=>item.id!==profile.id));setNotice(`${profile.name} removed.`);}catch(reason){setError(reason instanceof Error?reason.message:'Could not remove profile.');}};
  const activate=async(profile:ModelProfile)=>{try{await save({...profile,active:true,enabled:true});setNotice(`${profile.name} is now the active ${profile.role} profile.`);}catch(reason){setError(reason instanceof Error?reason.message:'Could not activate profile.');}};
  const test=async(profile:ModelProfile)=>{setTesting(profile.id);setTestStatus(current=>({...current,[profile.id]:''}));try{await kooduSocket.request('models.test',{id:profile.id});setTestStatus(current=>({...current,[profile.id]:'Connected'}));}catch(reason){const message=reason instanceof Error?reason.message:'Connection failed.';setTestStatus(current=>({...current,[profile.id]:message==='api_key_missing'?'Add an API key first.':message==='provider_unreachable'?'Provider endpoint could not be reached.':message}));}finally{setTesting(null);}};
  const create=()=>{setError('');setEditor({id:`model-${crypto.randomUUID().slice(0,8)}`,name:'',provider:'openai',model:'',baseUrl:providerUrls.openai,role:'cloud',maxOutputTokens:1024,monthlyTokenLimit:0,enabled:true,active:false,apiKeySet:false});};
  return <div className="product-page models-page">
    <div className="models-toolbar"><div className="models-runtime-status"><i className={error?'offline':'online'}/>{error?'SERVICE UNAVAILABLE':'SERVER-SIDE CONFIGURATION'}</div><button className="product-secondary" onClick={load}><AppIcon icon={Refresh01Icon} size={14}/> Refresh</button><button className="product-primary" onClick={create}><AppIcon icon={Add01Icon} size={15}/> Add model</button></div>
    {error&&<div className="model-error"><AppIcon icon={Cancel01Icon} size={15}/>{error}<button onClick={load}>Retry</button></div>}{notice&&<div className="skill-notice"><AppIcon icon={Tick02Icon} size={14}/>{notice}<button aria-label="Dismiss notice" onClick={()=>setNotice('')}><AppIcon icon={Cancel01Icon} size={13}/></button></div>}
    {editor&&<ModelEditor key={editor.id} value={editor} onSave={save} onCancel={()=>setEditor(null)} onError={setError}/>}
    <div className="models-section-head"><div><strong>Configured models</strong><span>Provider keys remain on the server and are never sent back to the browser.</span></div><span>{profiles.length.toString().padStart(2,'0')}</span></div>
    {loading?<div className="model-loading"><i/>Loading provider profiles…</div>:profiles.length?<div className="model-profile-list">{profiles.map(profile=><article className={`model-profile ${!profile.enabled?'disabled':''}`} key={profile.id}><span className="model-provider-mark"><AppIcon icon={profile.provider==='google'?SparklesIcon:profile.provider==='custom'?Settings01Icon:CpuIcon} size={18}/></span><div className="model-profile-main"><div className="model-name-row"><strong>{profile.name}</strong><span className="provider-chip">{providerNames[profile.provider]}</span>{profile.active&&profile.enabled&&<span className="active-chip">ACTIVE</span>}</div><div className="model-identifiers"><span>{profile.model}</span><span>·</span><span>{profile.role==='cloud'?'Cloud':'Local'} route</span><span>·</span><span>{profile.apiKeySet?'Key configured':'No API key'}</span></div><div className="model-limits"><span>Output max <b>{profile.maxOutputTokens.toLocaleString()} tokens</b></span><span>Monthly cap <b>{profile.monthlyTokenLimit?`${profile.monthlyTokenLimit.toLocaleString()} tokens`:'Unlimited'}</b></span></div>{testStatus[profile.id]&&<div className={`model-test-result ${testStatus[profile.id]==='Connected'?'success':'failure'}`}>{testStatus[profile.id]}</div>}</div><div className="model-profile-actions"><button className="product-secondary" onClick={()=>void test(profile)} disabled={testing!==null}>{testing===profile.id?<i className="tiny-spinner"/>:<AppIcon icon={Activity01Icon} size={14}/>} Test</button>{!profile.active&&<button className="product-secondary activate-button" onClick={()=>void activate(profile)}>Use for {profile.role}</button>}<button className="icon-action" title="Edit profile" aria-label="Edit profile" onClick={()=>setEditor(profile)}><AppIcon icon={Edit01Icon} size={15}/></button><button className="icon-action danger" title="Delete profile" aria-label="Delete profile" onClick={()=>void remove(profile)}><AppIcon icon={Delete01Icon} size={15}/></button></div></article>)}</div>:!error?<div className="models-empty"><span className="empty-mark"><AppIcon icon={CpuIcon} size={21}/></span><strong>No model profiles added</strong><p>Add OpenAI, OpenRouter, Google AI Studio, or any OpenAI-compatible endpoint.</p><button className="product-primary" onClick={create}><AppIcon icon={Add01Icon} size={14}/> Add your first model</button></div>:null}
  </div>;
}
function ModelEditor({value,onSave,onCancel,onError}:{value:ModelProfile;onSave:(model:Omit<ModelProfile,'apiKeySet'>&{apiKey?:string;clearApiKey?:boolean})=>Promise<void>;onCancel:()=>void;onError:(message:string)=>void}){
  const [draft,setDraft]=useState(value);const [apiKey,setApiKey]=useState('');const [clearKey,setClearKey]=useState(false);const [saving,setSaving]=useState(false);
  const updateProvider=(provider:ModelProvider)=>setDraft(current=>({...current,provider,baseUrl:current.baseUrl===providerUrls[current.provider]?providerUrls[provider]:current.baseUrl}));
  const submit=async()=>{setSaving(true);onError('');try{await onSave({...draft,...(apiKey?{apiKey}:{}),...(clearKey?{clearApiKey:true}:{})});}catch(error){onError(error instanceof Error?error.message:'Could not save this profile.');}finally{setSaving(false);}};
  return <section className="model-editor"><div className="skill-editor-heading"><div><strong>{value.apiKeySet?'Edit provider profile':'Add provider profile'}</strong><small>Configure an OpenAI-compatible API endpoint for Koodu inference.</small></div><button aria-label="Close editor" onClick={onCancel}><AppIcon icon={Cancel01Icon} size={16}/></button></div><div className="model-form-grid"><label>Profile name<input value={draft.name} maxLength={80} onChange={e=>setDraft({...draft,name:e.target.value})} placeholder="e.g. OpenRouter · Fast model"/></label><label>Provider<select value={draft.provider} onChange={e=>updateProvider(e.target.value as ModelProvider)}>{Object.entries(providerNames).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label><label>Model ID<input value={draft.model} onChange={e=>setDraft({...draft,model:e.target.value})} placeholder="Provider model identifier"/></label><label>API base URL<input value={draft.baseUrl} onChange={e=>setDraft({...draft,baseUrl:e.target.value})} placeholder="https://api.example.com/v1"/></label><label>Inference route<select value={draft.role} onChange={e=>setDraft({...draft,role:e.target.value as 'local'|'cloud',active:false})}><option value="cloud">Cloud reasoning</option><option value="local">Local inference</option></select></label><label>Max output tokens<input type="number" min={64} max={32768} step={64} value={draft.maxOutputTokens} onChange={e=>setDraft({...draft,maxOutputTokens:Number(e.target.value)})}/></label><label>Monthly token cap <small>0 means unlimited</small><input type="number" min={0} max={1000000000} step={1000} value={draft.monthlyTokenLimit} onChange={e=>setDraft({...draft,monthlyTokenLimit:Number(e.target.value)})}/></label><label>API key <small>{draft.apiKeySet&&!apiKey?'Saved on server · leave blank to keep':''}</small><input type="password" autoComplete="new-password" value={apiKey} onChange={e=>{setApiKey(e.target.value);setClearKey(false);}} placeholder={draft.apiKeySet?'Enter a new key to replace':'Paste provider API key'}/></label></div><div className="model-form-options"><label className="model-enabled-toggle"><input type="checkbox" checked={draft.enabled} onChange={e=>setDraft({...draft,enabled:e.target.checked,active:e.target.checked?draft.active:false})}/> Enabled</label>{draft.apiKeySet&&<label className="model-enabled-toggle"><input type="checkbox" checked={clearKey} onChange={e=>setClearKey(e.target.checked)}/> Remove saved key</label>}<label className="model-enabled-toggle"><input type="checkbox" checked={draft.active} onChange={e=>setDraft({...draft,active:e.target.checked,enabled:true})}/> Make active for this route</label></div><div className="model-editor-footer"><span>Compatible with OpenAI Chat Completions APIs. Google AI Studio’s OpenAI-compatible endpoint is supported.</span><div><button className="product-secondary" onClick={onCancel}>Cancel</button><button className="product-primary" disabled={saving||!draft.name.trim()||!draft.model.trim()||!draft.baseUrl.trim()||draft.maxOutputTokens<64||draft.monthlyTokenLimit<0} onClick={()=>void submit()}>{saving?<i className="tiny-spinner"/>:<AppIcon icon={Tick02Icon} size={14}/>} Save profile</button></div></div></section>;
}

type MemoryNote = { id: string; content: string; category: 'preference' | 'fact' | 'task'; updatedAt: number };
function readableMemoryError(reason: unknown, fallback: string): string {
  const error = reason as { message?: unknown } | null;
  return typeof error?.message === 'string' ? error.message : fallback;
}
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
function MemoryPage() {
  const [notes, setNotes] = useState<MemoryNote[]>([]);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [category, setCategory] = useState<MemoryNote['category']>('fact');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errorToast, setErrorToast] = useState('');
  useEffect(() => { if (!errorToast) return; const timeout = window.setTimeout(() => setErrorToast(''), 5000); return () => window.clearTimeout(timeout); }, [errorToast]);
  const load = async () => {
    setLoading(true); setError('');
    try {
      const result = await kooduSocket.request<{ memories: Array<{id:number;content:string;category:MemoryNote['category'];createdAt:number}> }>('memory.list');
      setNotes(result.memories.map((item) => ({...item, id:String(item.id), updatedAt:item.createdAt})));
    } catch (reason) { const message = readableMemoryError(reason, 'Could not load memories.'); setError(message); setErrorToast(message); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const startNew = () => { setEditing('new'); setContent(''); setCategory('fact'); };
  const startEdit = (note: MemoryNote) => { setEditing(note.id); setContent(note.content); setCategory(note.category); };
  const save = async () => {
    const cleanContent = boundMemoryText(content);
    if (!cleanContent) return;
    setBusy(true); setError('');
    try {
      const result = await kooduSocket.request<{ memories: Array<{id:number;content:string;category:MemoryNote['category'];createdAt:number}> }>('memory.save', { ...(editing !== 'new' ? {id:Number(editing)} : {}), content:cleanContent, category });
      setNotes(result.memories.map((item) => ({...item, id:String(item.id), updatedAt:item.createdAt}))); setEditing(null);
    } catch (reason) { const message = readableMemoryError(reason, 'Could not save memory.'); setError(message); setErrorToast(message); }
    finally { setBusy(false); }
  };
  const visible = notes.filter((note) => `${note.content} ${note.category}`.toLowerCase().includes(query.toLowerCase())).sort((a,b) => b.updatedAt-a.updatedAt);
  const remove = async (note: MemoryNote) => {
    setBusy(true); setError('');
    try { const result = await kooduSocket.request<{ memories: Array<{id:number;content:string;category:MemoryNote['category'];createdAt:number}> }>('memory.delete', {id:Number(note.id)}); setNotes(result.memories.map((item) => ({...item, id:String(item.id), updatedAt:item.createdAt}))); }
    catch (reason) { const message = readableMemoryError(reason, 'Could not delete memory.'); setError(message); setErrorToast(message); }
    finally { setBusy(false); }
  };
  return <div className="product-page memory-page">
    <div className="memory-toolbar"><label className="product-search"><AppIcon icon={Search01Icon} size={16}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search saved memories"/></label><div className="memory-toolbar-actions"><span className="memory-total">{notes.length} SAVED</span><button className="product-secondary memory-refresh" title="Refresh memories" aria-label="Refresh memories" onClick={() => void load()} disabled={loading}><AppIcon icon={Refresh01Icon} size={14}/></button><button className="product-primary" onClick={startNew}><AppIcon icon={Add01Icon} size={15}/> New memory</button></div></div>
    {errorToast && <div className="memory-error-toast" role="alert"><span className="memory-error-mark">!</span><span>{errorToast}</span><button aria-label="Dismiss error" onClick={() => setErrorToast('')}><AppIcon icon={Cancel01Icon} size={14}/></button></div>}
    {editing !== null && <section className="memory-editor"><div className="editor-heading"><strong>{editing === 'new' ? 'New memory' : 'Edit memory'}</strong><button aria-label="Close editor" disabled={busy} onClick={() => setEditing(null)}><AppIcon icon={Cancel01Icon} size={16}/></button></div><div className="memory-editor-row"><input className="memory-content-input" value={content} onChange={(e) => setContent(e.target.value)} placeholder="Write one clear memory…" maxLength={350} disabled={busy}/><select aria-label="Memory category" value={category} onChange={(e) => setCategory(e.target.value as MemoryNote['category'])} disabled={busy}><option value="preference">Preference</option><option value="fact">Fact</option><option value="task">Task</option></select></div><div className="editor-actions"><span className="memory-token-count">{Array.from(content).length} / 350 characters</span><button className="product-secondary" disabled={busy} onClick={() => setEditing(null)}>Cancel</button><button className="product-primary" disabled={busy||!content.trim()} onClick={() => void save()}>{busy?<i className="tiny-spinner"/>:<AppIcon icon={Tick02Icon} size={15}/>} {busy?'Saving…':'Save memory'}</button></div></section>}
    {loading ? <div className="product-empty">Loading memories from server…</div> : visible.length ? <div className="memory-list">{visible.map((note) => <article className="memory-row" key={note.id}><span className="memory-row-content" title={note.content}>{note.content}</span><span className={`memory-category-pill ${note.category}`}>{note.category}</span><time className="memory-row-time" title={new Date(note.updatedAt).toLocaleString()}>{new Date(note.updatedAt).toLocaleDateString()}</time><span className="memory-row-actions"><button title="Edit memory" aria-label="Edit memory" disabled={busy} onClick={() => startEdit(note)}><AppIcon icon={Edit01Icon} size={14}/></button><button title="Delete memory" aria-label="Delete memory" disabled={busy} onClick={() => void remove(note)}><AppIcon icon={Delete02Icon} size={14}/></button></span></article>)}</div> : <div className="product-empty"><span className="empty-mark"><AppIcon icon={Layers01Icon} size={21}/></span><strong>{query ? 'No matching memories' : error ? 'Could not load memories' : 'Your memory is ready'}</strong><p>{query ? 'Try a different search.' : error ? 'Check the WebSocket connection and retry.' : 'Save a preference, fact, or task as one concise memory.'}</p>{!query && <button className="product-secondary" onClick={startNew}><AppIcon icon={Add01Icon} size={14}/> Create your first memory</button>}</div>}
  </div>;
}

type ChatConversation = { id: string; title: string; createdAt: string; updatedAt: string; messageCount: number };
type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string; createdAt: string };

const chatSuggestions = ['Could you introduce yourself?', 'What can you help me with?', 'Help me organize my workspace'];

function renderChatInline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return <span key={index}>{part}</span>;
  });
}

function AssistantContent({ content }: { content: string }) {
  const lines = content.split('\n');
  const nodes: ReactNode[] = [];
  let list: string[] = [];
  let listType: 'ol' | 'ul' | null = null;
  const flush = () => {
    if (!list.length) return;
    if (listType === 'ol') {
      nodes.push(<ol key={`list-${nodes.length}`}>{list.map((item, index) => <li key={index}>{renderChatInline(item)}</li>)}</ol>);
    } else {
      nodes.push(<ul key={`list-${nodes.length}`}>{list.map((item, index) => <li key={index}>{renderChatInline(item)}</li>)}</ul>);
    }
    list = [];
    listType = null;
  };
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) { flush(); return; }
    const numbered = trimmed.match(/^(\d+)[\.\)]\s+(.*)/);
    const bullet = trimmed.match(/^[-*•]\s+(.*)/);
    if (numbered) {
      if (listType !== 'ol') flush();
      listType = 'ol';
      list.push(numbered[2] ?? '');
    } else if (bullet) {
      if (listType !== 'ul') flush();
      listType = 'ul';
      list.push(bullet[1] ?? '');
    } else {
      flush();
      nodes.push(<p key={index}>{renderChatInline(line)}</p>);
    }
  });
  flush();
  return <div className="chat-assistant-body">{nodes}</div>;
}

function ChatsPage() {
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [role, setRole] = useState<'local' | 'cloud'>('cloud');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const messageListRef = useRef<HTMLDivElement>(null);
  const suppressLoadRef = useRef(false);
  useEffect(() => { const element = messageListRef.current; if (element) element.scrollTop = element.scrollHeight; }, [messages, sending]);

  const activeConversation = conversations.find((item) => item.id === activeId) ?? null;
  const visibleConversations = conversations.filter((item) => item.title.toLowerCase().includes(query.toLowerCase()));

  const loadConversations = async () => {
    const result = await kooduSocket.request<{ conversations: ChatConversation[] }>('chats.list');
    setConversations(result.conversations);
  };
  useEffect(() => {
    let alive = true;
    kooduSocket.request<{ conversations: ChatConversation[] }>('chats.list').then((result) => {
      if (alive) setConversations(result.conversations);
    }).catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : 'Could not load chats.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!activeId) { setMessages([]); return; }
    if (suppressLoadRef.current) { suppressLoadRef.current = false; return; }
    let alive = true;
    setMessages([]); setError('');
    kooduSocket.request<{ messages: ChatMessage[] }>('chats.messages', { conversationId: activeId })
      .then((result) => { if (alive) setMessages(result.messages); })
      .catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : 'Could not load this conversation.'); });
    return () => { alive = false; };
  }, [activeId]);

  const createConversation = async () => {
    setError('');
    try {
      const result = await kooduSocket.request<{ conversation: ChatConversation }>('chats.create', {});
      setConversations((items) => [result.conversation, ...items]);
      setActiveId(result.conversation.id);
      return result.conversation.id;
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not create a chat.'); return null; }
  };
  const deleteConversation = async (conversationId: string) => {
    setError('');
    try {
      await kooduSocket.request('chats.delete', { conversationId });
      const remaining = conversations.filter((item) => item.id !== conversationId);
      setConversations(remaining);
      if (activeId === conversationId) setActiveId(remaining[0]?.id ?? null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not delete this chat.'); }
  };
  const sendMessage = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true); setError('');
    let conversationId = activeId;
    try {
      if (!conversationId) {
        suppressLoadRef.current = true;
        const created = await kooduSocket.request<{ conversation: ChatConversation }>('chats.create', {});
        conversationId = created.conversation.id;
        setConversations((items) => [created.conversation, ...items]);
        setActiveId(conversationId);
      }
    } catch (reason) {
      suppressLoadRef.current = false;
      setSending(false);
      setError(reason instanceof Error ? reason.message : 'Could not create a chat.');
      return;
    }
    if (!conversationId) { setSending(false); return; }
    setDraft('');
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: text, createdAt: new Date().toISOString() };
    const assistantId = crypto.randomUUID();
    const pendingAssistant: ChatMessage = { id: assistantId, role: 'assistant', content: '', createdAt: new Date().toISOString() };
    setMessages((items) => [...items, userMessage, pendingAssistant]);
    try {
      const result = await kooduSocket.request<{ reply: string; createdAt: string }>('chats.send', { conversationId, role, text }, {
        onStream: (event) => setMessages((items) => items.map((message) => message.id !== assistantId ? message : { ...message, content: event.kind === 'reset' ? '' : message.content + event.text })),
      });
      setMessages((items) => items.map((message) => message.id !== assistantId ? message : { ...message, content: result.reply, createdAt: result.createdAt }));
      await loadConversations();
    } catch (reason) {
      setMessages((items) => items.filter((message) => message.id !== assistantId));
      setError(reason instanceof Error ? reason.message : 'The message could not be sent.');
      void kooduSocket.request<{ messages: ChatMessage[] }>('chats.messages', { conversationId }).then((result) => setMessages(result.messages)).catch(() => {});
    } finally { setSending(false); }
  };

  return <section className="chats-layout">
    <aside className="chat-conversation-panel">
      <div className="chat-side-actions">
        <button className="chat-new-button" onClick={() => void createConversation()}><AppIcon icon={Add01Icon} size={15}/> New chat</button>
        <label className="chat-search"><AppIcon icon={Search01Icon} size={15}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search chats" aria-label="Search chats"/></label>
      </div>
      <div className="chat-list-label"><span>Conversations</span><span>{conversations.length} saved</span></div>
      {loading ? <div className="chat-list-empty">Loading conversations…</div> : visibleConversations.length ? <div className="chat-conversation-list">{visibleConversations.map((conversation) => <div className={`chat-conversation-item ${activeId === conversation.id ? 'active' : ''}`} key={conversation.id}><button className="chat-conversation-select" onClick={() => setActiveId(conversation.id)}><strong>{conversation.title}</strong>{conversation.messageCount ? <small>{conversation.messageCount} messages</small> : null}</button><button className="chat-delete-button" aria-label={`Delete ${conversation.title}`} title="Delete conversation" onClick={() => void deleteConversation(conversation.id)}><AppIcon icon={Delete02Icon} size={13}/></button></div>)}</div> : <div className="chat-list-empty">{query ? 'No matching chats.' : 'No conversations yet.'}</div>}
    </aside>
    <div className="chat-thread">
      <header className="chat-thread-head">
        <span className="chat-thread-title">{activeConversation ? activeConversation.title : 'Start a conversation'}</span>
        <span className="chat-thread-meta">{activeConversation ? `${activeConversation.messageCount} messages · Saved on server` : 'Chats are saved on the server'}</span>
      </header>
      <div className="chat-message-list" aria-live="polite" ref={messageListRef}>
        <div className="chat-column">
          {!activeConversation && !messages.length ? <div className="chat-hero"><span className="chat-welcome-mark"><AppIcon icon={Message01Icon} size={22}/></span><strong>Meet Koodu</strong><p>Ask a question, describe a task, or type a page name. Koodu replies here and keeps history on the server.</p><div className="chat-suggestions">{chatSuggestions.map((suggestion) => <button key={suggestion} className="chat-suggestion-chip" onClick={() => setDraft(suggestion)}>{suggestion}</button>)}</div></div>
          : messages.length ? messages.map((message) => {
            if (message.role === 'user') return <div className="chat-row user-row" key={message.id}><div className="chat-user-bubble">{message.content}</div></div>;
            if (!message.content && sending) return <article className="chat-row assistant-row" key={message.id}><div className="chat-thought"><span className="chat-thought-spin"/><span>Thought for a while</span><span aria-hidden="true">›</span></div></article>;
            return <article className="chat-row assistant-row" key={message.id}><AssistantContent content={message.content}/></article>;
          }) : <div className="chat-hero"><span className="chat-welcome-mark"><AppIcon icon={SparklesIcon} size={22}/></span><strong>What would you like to work on?</strong><p>Try one of these, or type your own message below.</p><div className="chat-suggestions">{chatSuggestions.map((suggestion) => <button key={suggestion} className="chat-suggestion-chip" onClick={() => setDraft(suggestion)}>{suggestion}</button>)}</div></div>}
        </div>
      </div>
      <div className="chat-compose-wrap">
        {error && <div className="chat-error-inline" role="alert"><AppIcon icon={Cancel01Icon} size={13}/><span>{error}</span></div>}
        <div className="chat-compose">
          <textarea aria-label="Message Koodu" value={draft} maxLength={1000} disabled={sending} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder="Message Koodu, describe a task, or ask a question…" rows={2}/>
          <div className="chat-compose-bar">
            <button className="chat-plus-btn" onClick={() => void createConversation()} aria-label="New chat" title="New chat"><AppIcon icon={Add01Icon} size={16}/></button>
            <label className="chat-model-chip"><span className={`chat-model-dot ${role}`}/><select value={role} onChange={(event) => setRole(event.target.value as 'local' | 'cloud')} disabled={sending} aria-label="Model route"><option value="cloud">Cloud</option><option value="local">Local</option></select></label>
            <span className="chat-compose-hint">ENTER TO SEND</span>
            <button className="chat-send-btn" aria-label="Send message" disabled={!draft.trim() || sending} onClick={() => void sendMessage()}>{sending ? <i className="tiny-spinner"/> : <AppIcon icon={ArrowRight01Icon} size={16}/>}</button>
          </div>
        </div>
      </div>
    </div>
  </section>;
}

function AgentsPage() {
  const [selected, setSelected] = useState<AgentType | null>(null);
  const [task, setTask] = useState('');
  const [notice, setNotice] = useState('');
  const [running, setRunning] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [result, setResult] = useState<{ taskId: string; reply: string; iterations: number; toolCalls: number } | null>(null);
  const [error, setError] = useState('');
  const runTask = async () => {
    if (!selected || !task.trim() || running) return;
    setRunning(true); setError(''); setNotice(''); setResult(null); setStreamText('');
    try {
      const response = await kooduSocket.request<{ taskId: string; reply: string; iterations: number; toolCalls: number; proposal: unknown; provider: string }>(
        'agent.run', { role: 'cloud', agentType: selected, text: task.trim(), context: { source: 'agents-page' } },
        { onStream: (event) => setStreamText((current) => event.kind === 'reset' ? '' : current + event.text) },
      );
      setResult(response); setNotice('Task completed and recorded on the server.'); setTask('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The task could not be completed.'); }
    finally { setRunning(false); }
  };
  return <div className="product-page agents-page">
    <div className="section-label-row"><div><strong>Specialists</strong><span>Choose an agent focus, then run a task through Koodu’s server agent loop.</span></div><span>{AGENT_TYPES.length} ROLES</span></div>
    <div className="agent-grid">{AGENT_TYPES.map((type,index) => {const info=AGENT_DESCRIPTORS[type];return <button className={`agent-card ${selected===type?'selected':''}`} key={type} onClick={() => setSelected(type)}><span className="agent-avatar"><AppIcon icon={[AiSecurity02Icon, CpuIcon, DashboardSpeed01Icon, Layers01Icon][index] ?? AiSecurity02Icon} size={20}/></span><span className="agent-card-copy"><strong>{info.title}</strong><small>{info.description}</small></span><span className={`risk-pill ${info.risk}`}>{info.risk.toUpperCase()}</span></button>;})}</div>
    {selected && <section className="task-composer"><div className="composer-title"><div><strong>Run a task</strong><small>{AGENT_DESCRIPTORS[selected].title}</small></div><button aria-label="Close task composer" disabled={running} onClick={() => setSelected(null)}><AppIcon icon={Cancel01Icon} size={15}/></button></div><textarea rows={3} maxLength={1000} value={task} disabled={running} onChange={(e)=>setTask(e.target.value)} placeholder={`Describe a task for the ${AGENT_DESCRIPTORS[selected].title}…`}/><div className="composer-bottom"><span>Runs on the server · {task.length} / 1000</span><button className="product-primary" disabled={!task.trim()||running} onClick={()=>void runTask()}>{running?<i className="tiny-spinner"/>:<AppIcon icon={SparklesIcon} size={15}/>} {running?'Working…':'Run task'}</button></div></section>}
    {notice && <div className="draft-notice"><AppIcon icon={Tick02Icon} size={14}/>{notice}<button onClick={()=>setNotice('')} aria-label="Dismiss"><AppIcon icon={Cancel01Icon} size={13}/></button></div>}
    {error && <div className="memory-error-toast" role="alert"><span className="memory-error-mark">!</span>{error}</div>}
    <div className="section-label-row task-list-heading"><div><strong>Latest run</strong><span>Task output is kept in this page session; task status is recorded server-side.</span></div>{result && <span>{result.iterations} STEPS · {result.toolCalls} TOOLS</span>}</div>
    {running && streamText ? <article className="draft-row"><span className="draft-status"/><div><strong>{streamText}<i className="tiny-spinner"/></strong><small>Streaming response…</small></div></article> : result ? <article className="draft-row"><span className="draft-status"/><div><strong>{result.reply}</strong><small>Task {result.taskId.slice(0,8)} · Completed</small></div></article> : <div className="agent-empty">No task has run in this session <span>·</span> choose a specialist and submit a request.</div>}
  </div>;
}

function SettingsPage({ character, setCharacter, preferences, updatePreferences, settingsControls, connection }: { character: 'kumo' | 'kitsu'; setCharacter: (value: 'kumo' | 'kitsu') => void; preferences: WorkspaceSettings; updatePreferences: (changes: Partial<AppPreferences> & { petMode?: WorkspaceSettings['petMode'] }) => void; settingsControls: SettingsControls; connection: { status: 'connecting' | 'online' | 'offline'; ping: number | null } }) {
  const { meta, status, error, notice, onRefresh, onReset, onExport, onImport } = settingsControls;
  const importRef = useRef<HTMLInputElement>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const busy = status === 'saving' || status === 'loading';
  const savedAt = meta.updatedAt ? new Date(meta.updatedAt.replace(' ', 'T') + (meta.updatedAt.endsWith('Z') ? '' : 'Z')).toLocaleString() : 'Defaults (not saved yet)';
  const snapshotBytes = new Blob([JSON.stringify(preferences)]).size;
  const testConnection = async () => {
    setTesting(true); setTestResult('');
    const started = performance.now();
    try {
      await kooduSocket.request('system.ping', { at: Date.now() });
      const elapsed = Math.max(1, Math.round(performance.now() - started));
      setTestResult(`Connected · round-trip ${elapsed} ms`);
    } catch (reason) {
      setTestResult(reason instanceof Error ? reason.message : 'Connection test failed.');
    } finally { setTesting(false); }
  };
  return <div className="settings-layout">
    <CharacterPicker character={character} setCharacter={setCharacter}/>
    <div className="settings-grid">
      <section className="settings-section">
        <header><span><strong>Companion</strong><small>Animation, motion and display</small></span><AppIcon icon={SparklesIcon} size={16}/></header>
        <div className="setting-info-row"><span><b>Selected character</b><small>Changed from the companion strip above.</small></span><strong>{character === 'kumo' ? 'Kumo' : 'Kitsu'}</strong></div>
        <SettingToggle label="Animate companion" detail="Play the character’s sprite animations." checked={preferences.animateCompanion} onChange={(checked) => updatePreferences({ animateCompanion: checked })}/>
        <label className="setting-select-row"><span><b>Display mode</b><small>Embedded centers the pet, floating adds motion, hidden hides it on Home.</small></span><select value={preferences.petMode} onChange={(event) => updatePreferences({ petMode: event.target.value as WorkspaceSettings['petMode'] })}><option value="embedded">Embedded</option><option value="floating">Floating</option><option value="hidden">Hidden</option></select></label>
      </section>
      <section className="settings-section">
        <header><span><strong>Workspace</strong><small>Startup and command bar</small></span><AppIcon icon={DashboardSpeed01Icon} size={16}/></header>
        <label className="setting-select-row"><span><b>Open on startup</b><small>Choose the first page when Koodu starts.</small></span><select value={preferences.startupPage} onChange={(event) => updatePreferences({ startupPage: event.target.value as StartupPage })}><option value="/">Home</option>{pages.map((page) => <option key={page.route} value={page.route}>{page.label}</option>)}</select></label>
        <SettingToggle label="Show keyboard hint" detail="Display the Enter hint in the command bar." checked={preferences.showCommandHint} onChange={(checked) => updatePreferences({ showCommandHint: checked })}/>
      </section>
      <section className="settings-section">
        <header><span><strong>Connection</strong><small>Live WebSocket diagnostics</small></span><span className={`settings-status ${connection.status}`}><i/>{connection.status}</span></header>
        <div className="setting-info-row"><span><b>WebSocket ping</b><small>Heartbeat every 5 seconds</small></span><strong>{connection.ping === null ? 'Waiting for ping' : `${connection.ping} ms`}</strong></div>
        <div className="setting-info-row"><span><b>Endpoint</b><small>Central JSON-RPC channel</small></span><strong className="setting-code">/ws</strong></div>
        <div className="setting-info-row"><span><b>Reconnect</b><small>Auto-reconnects after a drop</small></span><strong>{connection.status === 'online' ? 'CONNECTED' : connection.status === 'connecting' ? 'CONNECTING' : 'RECONNECTING'}</strong></div>
      </section>
      <section className="settings-section">
        <header><span><strong>Storage & sync</strong><small>Server database</small></span><AppIcon icon={ShieldCheckIcon} size={16}/></header>
        <div className="setting-info-row"><span><b>Source of truth</b><small>Server SQLite · browser keeps a validated cache only</small></span><strong>{meta.persistence.toUpperCase()}</strong></div>
        <div className="setting-info-row"><span><b>Last saved</b><small>Written on every change</small></span><strong>{meta.updatedAt ? savedAt : 'Defaults'}</strong></div>
        <div className="setting-info-row"><span><b>Credentials</b><small>API secrets are never stored as settings.</small></span><strong>SECURE</strong></div>
        <div className="settings-actions">
          <button className="product-secondary settings-mini-action" onClick={onExport}><AppIcon icon={Download01Icon} size={13}/> Export</button>
          <button className="product-secondary settings-mini-action" onClick={() => importRef.current?.click()} disabled={busy}><AppIcon icon={Upload01Icon} size={13}/> Import</button>
          <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) onImport(file); if (importRef.current) importRef.current.value = ''; }}/>
          {confirmReset ? <span className="settings-reset-confirm"><button className="product-primary settings-mini-action" onClick={() => { setConfirmReset(false); onReset(); }} disabled={busy}>Confirm reset</button><button className="product-secondary settings-mini-action" onClick={() => setConfirmReset(false)}>Cancel</button></span> : <button className="product-secondary settings-mini-action danger" onClick={() => setConfirmReset(true)} disabled={busy}><AppIcon icon={Delete01Icon} size={13}/> Reset</button>}
        </div>
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
    fetch(`/companion/${id}/animation_manifest.json`).then((response) => (response.ok ? response.json() : null)).then((manifest) => {
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

function FloatingPet({ activity, character, animations, animate, mode, large, onModeChange, onCharacterChange }: { activity: PetActivity; character: 'kumo' | 'kitsu'; animations: Record<string, Animation>; animate: boolean; mode: 'floating' | 'embedded' | 'hidden'; large: boolean; onModeChange: (mode: 'floating' | 'embedded' | 'hidden') => void; onCharacterChange: (value: 'kumo' | 'kitsu') => void }) {
  const animation = animations[activity] ?? animations.idle ?? fallbackIdleAnimation;
  const storageKey = 'koodu:pet-position:v1';
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
      if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') return { x: saved.x, y: saved.y };
    } catch { /* ignore */ }
    return { x: Math.max(20, window.innerWidth - 160), y: Math.max(20, window.innerHeight - 180) };
  });
  const [dragging, setDragging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragOffset = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const movedRef = useRef(false);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(pos));
  }, [pos]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    movedRef.current = false;
    setDragging(true);
    dragOffset.current = { x: event.clientX - pos.x, y: event.clientY - pos.y };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    movedRef.current = true;
    const next = { x: event.clientX - dragOffset.current.x, y: event.clientY - dragOffset.current.y };
    setPos(next);
  };
  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    try { (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId); } catch { /* ignore */ }
  };
  const onContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    setMenuPos({ x: event.clientX, y: event.clientY });
    setMenuOpen(true);
  };
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  if (mode === 'hidden') return null;

  const size = large ? 128 : 72;
  return <>
    <div
      className={`floating-pet ${dragging ? 'dragging' : ''} pet-mode-${mode} ${large ? 'large' : ''}`}
      style={{ left: pos.x, top: pos.y, width: size, height: size }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onContextMenu={onContextMenu}
    >
      <SpriteSheet character={character} animation={animation} size={size} animate={animate} loop/>
      <span className="floating-pet-name">{character === 'kumo' ? 'Kumo' : 'Kitsu'}</span>
    </div>
    {menuOpen && (
      <div className="floating-pet-menu" style={{ left: menuPos.x, top: menuPos.y }} onPointerDown={(e) => e.stopPropagation()}>
        <button onClick={() => { onModeChange('hidden'); setMenuOpen(false); }}>Hide pet</button>
        <button onClick={() => { onModeChange(mode === 'floating' ? 'embedded' : 'floating'); setMenuOpen(false); }}>{mode === 'floating' ? 'Dock to home' : 'Float freely'}</button>
        <button onClick={() => { onCharacterChange(character === 'kumo' ? 'kitsu' : 'kumo'); setMenuOpen(false); }}>Switch character</button>
        <button onClick={() => { setPos({ x: Math.max(20, window.innerWidth - 160), y: Math.max(20, window.innerHeight - 180) }); setMenuOpen(false); }}>Reset position</button>
      </div>
    )}
  </>;
}

export default App;
