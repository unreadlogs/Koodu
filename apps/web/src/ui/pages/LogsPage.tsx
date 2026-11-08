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

export function LogsPage() {
  const [entries, setEntries] = useState<Shared.LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [clearing, setClearing] = useState(false);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const receive = (entry: Shared.LogEntry) => {
    setEntries((current) => [...new Map([...current, entry].map((item) => [item.id, item])).values()].sort((a,b) => b.at-a.at).slice(0,500));
  };
  const requestSnapshot = async () => {
    setError(''); setLoading(true);
    try {
      const result = await kooduSocket.request<{entries:Shared.LogEntry[]}>('logs.watch');
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
    <div className="logs-toolbar"><label className="product-search"><Components.AppIcon icon={Search01Icon} size={16}/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search events, details, or source"/></label><Components.LogSourceDropdown value={source} options={['all',...sources]} onChange={setSource}/><button className="product-secondary logs-export" onClick={exportLogs} disabled={!filtered.length}><Components.AppIcon icon={Download01Icon} size={14}/> Export</button><button className="product-secondary" title="Refresh logs" aria-label="Refresh logs" onClick={()=>void requestSnapshot()} disabled={loading}><Components.AppIcon icon={Refresh01Icon} size={14}/></button><button className="product-secondary logs-clear" onClick={()=>void clearLogs()} disabled={!entries.length||clearing}><Components.AppIcon icon={Delete01Icon} size={14}/> Clear</button></div>
    {error&&<div className="model-error"><Components.AppIcon icon={Cancel01Icon} size={15}/>{error}<button onClick={()=>void requestSnapshot()}>Retry</button></div>}
    <div className="logs-table-wrap"><div className="logs-table-head"><span>EVENT</span><span>SOURCE</span><span>TIME</span><span>LEVEL</span></div>{loading?<div className="logs-empty"><i className="tiny-spinner"/><strong>Loading server records</strong><span>Fetching the latest entries from the server.</span></div>:filtered.length ? filtered.map((entry)=><article className={`log-entry ${expanded===entry.id?'expanded':''}`} key={entry.id}><button className="log-entry-main" onClick={()=>setExpanded(expanded===entry.id?null:entry.id)} aria-expanded={expanded===entry.id}><span className={`log-indicator ${entry.level}`}/><span className="log-event-copy"><strong>{entry.message}</strong><small>{entry.detail ?? 'No additional details.'}</small></span><span className="log-source">{entry.source}</span><span className="log-time" title={new Date(entry.at).toLocaleString()}>{new Date(entry.at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span><span className={`log-level ${entry.level}`}>{entry.level}</span></button>{expanded===entry.id && <div className="log-entry-detail"><span>EVENT ID <b>{entry.id}</b></span><span>OCCURRED <b>{new Date(entry.at).toLocaleString()}</b></span><span>DETAIL <b>{entry.detail ?? '—'}</b></span></div>}</article>) : <div className="logs-empty"><Components.AppIcon icon={FileSearchIcon} size={22}/><strong>{entries.length ? 'No matching events' : 'No server records yet'}</strong><span>{entries.length ? 'Change the search or source filter.' : 'Server requests and operations will appear here.'}</span></div>}</div>
  </div>;
}



type SkillCategory = 'Research' | 'Development' | 'Organization' | 'Custom';
type SkillRecord = { id: string; name: string; description: string; category: Shared.SkillCategory; instructions: string; enabled: boolean; source: string; updatedAt: number };
const skillCategories: Shared.SkillCategory[] = ['Research','Development','Organization','Custom'];
type SkillListResponse = { skills: Shared.SkillRecord[] };
function normalizeSkills(value: unknown): Shared.SkillRecord[] { return Array.isArray(value) ? value.filter((item): item is Shared.SkillRecord => Boolean(item && typeof item==='object' && typeof (item as Shared.SkillRecord).id==='string' && typeof (item as Shared.SkillRecord).name==='string' && typeof (item as Shared.SkillRecord).description==='string' && typeof (item as Shared.SkillRecord).instructions==='string' && skillCategories.includes((item as Shared.SkillRecord).category) && typeof (item as Shared.SkillRecord).enabled==='boolean' && typeof (item as Shared.SkillRecord).source==='string' && typeof (item as Shared.SkillRecord).updatedAt==='number')) : []; }
