import { useEffect, useRef, useState } from 'react';
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
import { kooduSocket } from '../lib/socket';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { usePetController } from '../pet/pet-controller';
import { pages } from './shared';
import * as Shared from './shared';
import type { Animation, AppPreferences, ModelProfile, SettingsControls, SettingsStatus, WorkspaceSettings } from './shared';

export function AppIcon({ icon, size, className }: { icon: IconSvgElement; size: number; className?: string }) {
  return <HugeiconsIcon icon={icon} size={size} className={className} aria-hidden="true"/>;
}

export function SpriteSheet({ character, animation, size = 250, animate = true, loop }: { character: 'kumo' | 'kitsu'; animation: Animation; size?: number | string; animate?: boolean; loop?: boolean }) {
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

export function PetCharacter({ activity, character, animations, animate }: { activity: string; character: 'kumo' | 'kitsu'; animations: Record<string, Animation>; animate: boolean }) {
  const animation = animations[activity] ?? animations.idle ?? { file: 'idle.png', frameCount: 6, frameWidth: 512, frameHeight: 512, fps: 8, loop: true };
  return <div className="pet-character" title={`${character === 'kumo' ? 'Kumo' : 'Kitsu'} · ${activity}`}>
    <SpriteSheet key={`${character}-${activity}-${animation.file}`} character={character} animation={animation} size="clamp(112px, min(42vw, 29vh), 210px)" animate={animate}/>
  </div>;
}

export function CommandBar({ value, setValue, submit, showHint }: { value: string; setValue: (value: string) => void; submit: () => void; showHint: boolean }) {
  return <div className="command-bar"><button title="Voice input" className="command-mic"><AppIcon icon={Mic01Icon} size={17}/></button><span className="command-prompt">›</span><input value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submit(); }} placeholder="Type a command, open a page, or ask Koodu…"/>{showHint && <span className="command-hint"><AppIcon icon={CommandIcon} size={10}/> ENTER</span>}<button className="command-send" onClick={submit} title="Send command"><AppIcon icon={ArrowRight01Icon} size={20}/></button></div>;
}

export function SettingToggle({ label, detail, checked, onChange }: { label: string; detail: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <div className="setting-toggle-row"><span><b>{label}</b><small>{detail}</small></span><button type="button" role="switch" aria-checked={checked} aria-label={label} className={`setting-switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}><i/></button></div>;
}

export function NavItem({ label, icon, selected, onClick }: { label: string; icon: IconSvgElement; selected: boolean; onClick: () => void }) {
  return <button className={`nav-item ${selected ? 'selected' : ''}`} title={label} aria-label={label} onClick={onClick}><AppIcon icon={icon} size={17}/><span className="nav-tooltip">{label}</span></button>;
}

export { pages };
export type { Animation, AppPreferences, ModelProfile, SettingsControls, SettingsStatus, WorkspaceSettings };
export function CharacterPicker({ character, setCharacter }: { character: 'kumo' | 'kitsu'; setCharacter: (value: 'kumo' | 'kitsu') => void }) {
  return <section className="settings-card" aria-label="Choose companion">
    <div className="settings-title"><div><strong>Companion character</strong><small>Select the character shown in your workspace.</small></div><span className="companion-count">2 CHARACTERS</span></div>
    <div className="character-options">
      {(['kumo', 'kitsu'] as const).map((id) => <CharacterOption key={id} id={id} selected={character === id} onSelect={() => setCharacter(id)}/>)}
    </div>
  </section>;
}
export function CharacterOption({ id, selected, onSelect }: { id: 'kumo' | 'kitsu'; selected: boolean; onSelect: () => void }) {
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

export function UsageMetric({ icon, label, value, delta, detail }: { icon: any; label: string; value: string; delta: string; detail: string }) {
  return <article className="usage-metric"><div className="usage-metric-top"><span><AppIcon icon={icon} size={15}/>{label}</span><AppIcon icon={ArrowUpRight01Icon} size={13}/></div><strong>{value}</strong><div className="usage-metric-bottom"><span>{delta}</span><small>{detail}</small></div></article>;
}
export function LogSourceDropdown({value,options,onChange}:{value:string;options:string[];onChange:(value:string)=>void}){
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

export function ModelProfileDropdown({ profiles, selectedId, disabled, onSelect }: { profiles: Shared.ModelProfile[]; selectedId: string; disabled: boolean; onSelect: (profile: Shared.ModelProfile) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const selected = profiles.find((profile) => profile.id === selectedId) ?? null;
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  return <div className="chat-model-dropdown" ref={root}>
    <button type="button" className="chat-model-trigger" aria-haspopup="menu" aria-expanded={open} disabled={disabled || !profiles.length} onClick={() => setOpen((current) => !current)}>
      <span className={`chat-model-dot ${selected?.role ?? 'cloud'}`}/>
      <span className="chat-model-trigger-label">{selected ? `${selected.name} · ${selected.role === 'cloud' ? 'Cloud' : 'Local'}` : (profiles.length ? 'Select model' : 'No saved models')}</span>
      <i/>
    </button>
    {open && profiles.length > 0 && <div className="chat-model-menu" role="menu" aria-label="Select model profile">{profiles.map((profile) => <button type="button" role="menuitemradio" aria-checked={selectedId === profile.id} className={selectedId === profile.id ? 'selected' : ''} key={profile.id} onClick={() => { onSelect(profile); setOpen(false); }}><span className={`chat-model-dot ${profile.role}`}/><span className="chat-model-menu-label">{profile.name}</span><small>{profile.provider} · {profile.role === 'cloud' ? 'Cloud' : 'Local'}</small></button>)}</div>}
  </div>;
}

export function AssistantContent({ content }: { content: string }) {
  return <div className="chat-assistant-body markdown-body">
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{content}</ReactMarkdown>
  </div>;
}
