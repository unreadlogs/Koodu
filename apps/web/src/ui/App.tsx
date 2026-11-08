import { useEffect, useRef, useState } from 'react';
import { Home01Icon, SparklesIcon } from '@hugeicons/core-free-icons';
import type { IconSvgElement } from '@hugeicons/react';
import { defaultWorkspaceSettings, workspaceSettingsSchema } from '@koodu/protocol';
import type { SettingsSnapshot, WorkspaceSettings } from '@koodu/protocol';
import { kooduSocket } from '../lib/socket';
import { usePetController } from '../pet/pet-controller';
import * as Shared from './shared';
import * as Components from './components';
import { UsagePage } from './pages/UsagePage';
import { LogsPage } from './pages/LogsPage';
import { SkillsPage } from './pages/SkillsPage';
import { ModelsPage } from './pages/ModelsPage';
import { MemoryPage } from './pages/MemoryPage';
import { ChatsPage } from './pages/ChatsPage';
import { AgentsPage } from './pages/AgentsPage';
import { SettingsPage } from './pages/SettingsPage';

type Animation = { file: string; frameCount: number; frameWidth: number; frameHeight: number; fps: number; loop: boolean };
const fallbackIdleAnimation: Animation = { file: 'idle.png', frameCount: 6, frameWidth: 512, frameHeight: 512, fps: 8, loop: true };
type AppPreferences = Pick<WorkspaceSettings, 'animateCompanion' | 'showCommandHint' | 'startupPage'>;
const PREFERENCES_KEY = 'koodu:settings:v1';
const COMPANION_KEY = 'koodu:companion';
// Browser holds only a validated write-through cache for instant startup.
// The server SQLite row is authoritative; cache values are never auto-uploaded.
function readCachedSettings(): WorkspaceSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? 'null') as Partial<WorkspaceSettings> | null;
    const candidate = stored?.startupPage;
    const startupPage: Shared.StartupPage = candidate === '/' || Shared.pages.some((page) => page.route === candidate) ? candidate as Shared.StartupPage : '/';
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
const homeCopy: Record<Shared.PetActivity, { lead: string; accent: string; detail: string }> = {
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

function App() {
  const { path, navigate } = useRoute();
  const realtime = useRealtime();
  const currentPage = Shared.pageFromPath(path);
  // Server is source of truth; state starts from the validated cache for instant paint.
  const [settings, setSettings] = useState<WorkspaceSettings>(readCachedSettings);
  const settingsRef = useRef<WorkspaceSettings>(settings);
  const [settingsMeta, setSettingsMeta] = useState<{ updatedAt: string | null; persistence: string }>({ updatedAt: null, persistence: 'sqlite' });
  const [settingsStatus, setSettingsStatus] = useState<Shared.SettingsStatus>('loading');
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
  const [pausedTaskId, setPausedTaskId] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);
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
    setPausedTaskId(null);
    try {
      const result = await kooduSocket.request<{ reply: string; proposal: { action: string; args: unknown } | null; status?: 'completed' | 'paused'; taskId?: string }>(
        'agent.run', { role: 'cloud', text, context: { currentPath: path } },
        { onStream: (event) => setFeedback((current) => event.kind === 'reset' ? '' : current + event.text) },
      );
      if (result.proposal?.action === 'open_tab' && result.proposal.args && typeof result.proposal.args === 'object') {
        const route = (result.proposal.args as { route?: unknown }).route;
        const requested = Shared.pages.find((page) => page.route === route);
        if (requested) navigate(requested.route);
      }
      setFeedback(result.reply);
      if (result.status === 'paused' && result.taskId) {
        setPausedTaskId(result.taskId);
        dispatchPetAction('speak');
        return;
      }
      dispatchPetAction(result.proposal ? 'celebrate' : 'speak');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'The companion could not complete that request.');
      dispatchPetAction('speak');
    }
    window.setTimeout(() => { dispatchPetAction('reset'); setFeedback(''); }, 5000);
  };

  const resumeCommand = async () => {
    if (!pausedTaskId || resuming) return;
    setResuming(true);
    setFeedback('');
    dispatchPetAction('think');
    try {
      const result = await kooduSocket.request<{ reply: string; status: 'completed' | 'paused'; taskId: string }>(
        'agent.resume', { taskId: pausedTaskId, role: 'cloud' },
        { onStream: (event) => setFeedback((current) => event.kind === 'reset' ? '' : current + event.text) },
      );
      setFeedback(result.reply);
      if (result.status === 'paused') {
        dispatchPetAction('speak');
        return;
      }
      setPausedTaskId(null);
      dispatchPetAction('celebrate');
      window.setTimeout(() => { dispatchPetAction('reset'); setFeedback(''); }, 5000);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'The paused task could not be resumed.');
      dispatchPetAction('speak');
    } finally { setResuming(false); }
  };

  return <main className="app-shell rail-collapsed">
    <aside className="rail">
      <div className="brand-mark" aria-label="Koodu"><span className="koodu-mark"><i/><i/><i/></span></div>
      <div className="rail-section-label">WORKSPACE</div>
      <nav className="route-nav">
        <NavItem label="Home" icon={Home01Icon} selected={!currentPage} onClick={() => navigate('/')} />
        {Shared.pages.map((page) => <NavItem key={page.route} label={page.label} icon={page.icon} selected={currentPage?.route === page.route} onClick={() => navigate(page.route)} />)}
      </nav>
      <div className="rail-bottom"><div className="rail-divider"/></div>
    </aside>

    <section className="main-column">
      <section className={`page-canvas ${currentPage ? 'route-page' : 'home-page'}`}>
        <div className="canvas-grain"/>
        {currentPage ? <ModulePage page={currentPage} character={character} setCharacter={setCharacter} preferences={settings} updatePreferences={updatePreferences} settingsControls={{ meta: settingsMeta, status: settingsStatus, error: settingsError, notice: settingsNotice, onRefresh: () => void loadServerSettings(), onReset: () => void resetSettings(), onExport: exportSettings, onImport: (file) => void importSettings(file) }} connection={realtime}/> : <HomePage activity={activity} character={character} animations={animations} animateCompanion={settings.animateCompanion} petMode={petMode}/>}
        {feedback && <div className="command-feedback"><span className="feedback-spark"><Components.AppIcon icon={SparklesIcon} size={13}/></span><span className="command-feedback-text">{feedback}</span>{pausedTaskId && <button className="command-resume" disabled={resuming} onClick={() => void resumeCommand()}>{resuming ? <i className="tiny-spinner"/> : 'Continue'}</button>}</div>}
        {!currentPage && <Components.CommandBar value={command} setValue={setCommand} submit={submit} showHint={settings.showCommandHint}/>}
        <div className="bottom-status"><span><i className={realtime.status}/> {realtime.status === 'online' ? 'CONNECTED' : realtime.status === 'connecting' ? 'CONNECTING' : 'RECONNECTING'}</span><span>WS <b/> PING: {realtime.ping === null ? '—' : `${realtime.ping}ms`} <span className="ping-bars"><i/><i/><i/><i/></span></span></div>
      </section>
    </section>
    {petMode !== 'hidden' && <FloatingPet activity={activity} character={character} animations={animations} animate={settings.animateCompanion} mode={petMode} large={!currentPage} onModeChange={setPetMode} onCharacterChange={setCharacter}/>}
  </main>;
}

function NavItem({ label, icon, selected, onClick }: { label: string; icon: IconSvgElement; selected: boolean; onClick: () => void }) {
  return <button className={`nav-item ${selected ? 'selected' : ''}`} title={label} aria-label={label} onClick={onClick}><Components.AppIcon icon={icon} size={17}/><span className="nav-tooltip">{label}</span></button>;
}

function HomePage({ activity, character, animations, animateCompanion, petMode }: { activity: Shared.PetActivity; character: 'kumo' | 'kitsu'; animations: Record<string, Animation>; animateCompanion: boolean; petMode: 'floating' | 'embedded' | 'hidden' }) {
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

function ModulePage({ page, character, setCharacter, preferences, updatePreferences, settingsControls, connection }: { page: Shared.RoutePage; character: 'kumo' | 'kitsu'; setCharacter: (value: 'kumo' | 'kitsu') => void; preferences: Shared.WorkspaceSettings; updatePreferences: (changes: Partial<AppPreferences> & { petMode?: Shared.WorkspaceSettings['petMode'] }) => void; settingsControls: Shared.SettingsControls; connection: { status: 'connecting' | 'online' | 'offline'; ping: number | null } }) {
  if (page.label === 'Chats') {
    return <div className="module-page-content chats-fullbleed"><ChatsPage/></div>;
  }
  return <div className={`module-page-content ${page.label === 'Settings' ? 'settings-page-content' : ''}`}>
    <div className="module-heading">
      <div><div className="eyebrow">KOODU / WORKSPACE / {page.label.toUpperCase()}</div><h1>{page.label}</h1><p>{page.subtitle}</p></div>
      <span className="module-page-icon"><Components.AppIcon icon={page.icon} size={19}/></span>
    </div>
    {page.label === 'Settings' ? <SettingsPage character={character} setCharacter={setCharacter} preferences={preferences} updatePreferences={updatePreferences} settingsControls={settingsControls} connection={connection}/>
    : page.label === 'Memory' ? <MemoryPage/>
    : page.label === 'Agents' ? <AgentsPage/>
    : page.label === 'Usage' ? <UsagePage/>
    : page.label === 'Logs' ? <LogsPage/>
    : page.label === 'Skills' ? <SkillsPage/>
    : page.label === 'Models' ? <ModelsPage/>
    : <>
      <div className="module-overview">
        <div className="module-card-heading"><span><Components.AppIcon icon={page.icon} size={15}/>{page.label} overview</span><span className="live-label"><i/> LIVE</span></div>
        <div className="module-placeholder"><span className="placeholder-icon"><Components.AppIcon icon={page.icon} size={23}/></span><strong>Your {page.label.toLowerCase()} page is ready</strong><span>This workspace section is connected and ready for its next feature.</span></div>
      </div>
      <div className="module-stats"><div><small>WORKSPACE</small><strong>Personal</strong></div><div><small>STATUS</small><strong><i/> Connected</strong></div><div><small>COMPANION</small><strong>By your side</strong></div></div>
    </>}
  </div>;
}

function FloatingPet({ activity, character, animations, animate, mode, large, onModeChange, onCharacterChange }: { activity: Shared.PetActivity; character: 'kumo' | 'kitsu'; animations: Record<string, Animation>; animate: boolean; mode: 'floating' | 'embedded' | 'hidden'; large: boolean; onModeChange: (mode: 'floating' | 'embedded' | 'hidden') => void; onCharacterChange: (value: 'kumo' | 'kitsu') => void }) {
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
      <Components.SpriteSheet character={character} animation={animation} size={size} animate={animate} loop/>
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
