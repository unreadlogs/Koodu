import { useEffect, useRef, useState } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  AiSecurity02Icon, ArrowRight01Icon, CommandIcon, CpuIcon, DashboardSpeed01Icon,
  Home01Icon, Layers01Icon, Mic01Icon, Settings01Icon, ShieldCheckIcon, SparklesIcon,
  Add01Icon, Cancel01Icon, Search01Icon, Delete02Icon, Clock01Icon, Tick02Icon, Edit01Icon,
  Activity01Icon, ArrowUpRight01Icon, ChartLineData01Icon, Coins01Icon, Download01Icon,
  FileSearchIcon, FilterIcon, Refresh01Icon, Delete01Icon,
  PuzzleIcon, BookOpen01Icon, Upload01Icon,
  Message01Icon,
} from "@hugeicons/core-free-icons";
import { kooduSocket } from "../../lib/socket";
import * as Shared from "../shared";
import * as Components from "../components";

export function SettingsPage({ character, setCharacter, preferences, updatePreferences, settingsControls, connection }: { character: 'kumo' | 'kitsu'; setCharacter: (value: 'kumo' | 'kitsu') => void; preferences: Shared.WorkspaceSettings; updatePreferences: (changes: Partial<Shared.AppPreferences> & { petMode?: Shared.WorkspaceSettings['petMode'] }) => void; settingsControls: Shared.SettingsControls; connection: { status: 'connecting' | 'online' | 'offline'; ping: number | null } }) {
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
    <Components.CharacterPicker character={character} setCharacter={setCharacter}/>
    <div className="settings-grid">
      <section className="settings-section">
        <header><span><strong>Companion</strong><small>Shared.Animation, motion and display</small></span><Components.AppIcon icon={SparklesIcon} size={16}/></header>
        <div className="setting-info-row"><span><b>Selected character</b><small>Changed from the companion strip above.</small></span><strong>{character === 'kumo' ? 'Kumo' : 'Kitsu'}</strong></div>
        <Components.SettingToggle label="Animate companion" detail="Play the character’s sprite animations." checked={preferences.animateCompanion} onChange={(checked) => updatePreferences({ animateCompanion: checked })}/>
        <label className="setting-select-row"><span><b>Display mode</b><small>Embedded centers the pet, floating adds motion, hidden hides it on Home.</small></span><select value={preferences.petMode} onChange={(event) => updatePreferences({ petMode: event.target.value as Shared.WorkspaceSettings['petMode'] })}><option value="embedded">Embedded</option><option value="floating">Floating</option><option value="hidden">Hidden</option></select></label>
      </section>
      <section className="settings-section">
        <header><span><strong>Workspace</strong><small>Startup and command bar</small></span><Components.AppIcon icon={DashboardSpeed01Icon} size={16}/></header>
        <label className="setting-select-row"><span><b>Open on startup</b><small>Choose the first page when Koodu starts.</small></span><select value={preferences.startupPage} onChange={(event) => updatePreferences({ startupPage: event.target.value as Shared.StartupPage })}><option value="/">Home</option>{Shared.pages.map((page) => <option key={page.route} value={page.route}>{page.label}</option>)}</select></label>
        <Components.SettingToggle label="Show keyboard hint" detail="Display the Enter hint in the command bar." checked={preferences.showCommandHint} onChange={(checked) => updatePreferences({ showCommandHint: checked })}/>
      </section>
      <section className="settings-section">
        <header><span><strong>Connection</strong><small>Live WebSocket diagnostics</small></span><span className={`settings-status ${connection.status}`}><i/>{connection.status}</span></header>
        <div className="setting-info-row"><span><b>WebSocket ping</b><small>Heartbeat every 5 seconds</small></span><strong>{connection.ping === null ? 'Waiting for ping' : `${connection.ping} ms`}</strong></div>
        <div className="setting-info-row"><span><b>Endpoint</b><small>Central JSON-RPC channel</small></span><strong className="setting-code">/ws</strong></div>
        <div className="setting-info-row"><span><b>Reconnect</b><small>Auto-reconnects after a drop</small></span><strong>{connection.status === 'online' ? 'CONNECTED' : connection.status === 'connecting' ? 'CONNECTING' : 'RECONNECTING'}</strong></div>
      </section>
      <section className="settings-section">
        <header><span><strong>Storage & sync</strong><small>Server database</small></span><Components.AppIcon icon={ShieldCheckIcon} size={16}/></header>
        <div className="setting-info-row"><span><b>Source of truth</b><small>Server SQLite · browser keeps a validated cache only</small></span><strong>{meta.persistence.toUpperCase()}</strong></div>
        <div className="setting-info-row"><span><b>Last saved</b><small>Written on every change</small></span><strong>{meta.updatedAt ? savedAt : 'Defaults'}</strong></div>
        <div className="setting-info-row"><span><b>Credentials</b><small>API secrets are never stored as settings.</small></span><strong>SECURE</strong></div>
        <div className="settings-actions">
          <button className="product-secondary settings-mini-action" onClick={onExport}><Components.AppIcon icon={Download01Icon} size={13}/> Export</button>
          <button className="product-secondary settings-mini-action" onClick={() => importRef.current?.click()} disabled={busy}><Components.AppIcon icon={Upload01Icon} size={13}/> Import</button>
          <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) onImport(file); if (importRef.current) importRef.current.value = ''; }}/>
          {confirmReset ? <span className="settings-reset-confirm"><button className="product-primary settings-mini-action" onClick={() => { setConfirmReset(false); onReset(); }} disabled={busy}>Confirm reset</button><button className="product-secondary settings-mini-action" onClick={() => setConfirmReset(false)}>Cancel</button></span> : <button className="product-secondary settings-mini-action danger" onClick={() => setConfirmReset(true)} disabled={busy}><Components.AppIcon icon={Delete01Icon} size={13}/> Reset</button>}
        </div>
      </section>
    </div>
  </div>;
}

function SettingToggle({ label, detail, checked, onChange }: { label: string; detail: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <div className="setting-toggle-row"><span><b>{label}</b><small>{detail}</small></span><button type="button" role="switch" aria-checked={checked} aria-label={label} className={`setting-switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}><i/></button></div>;
}

