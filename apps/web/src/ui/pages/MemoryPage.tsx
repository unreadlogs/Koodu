import { useEffect, useRef, useState, type ReactNode } from "react";
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

export function MemoryPage() {
  const [notes, setNotes] = useState<Shared.MemoryNote[]>([]);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [category, setCategory] = useState<Shared.MemoryNote['category']>('fact');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errorToast, setErrorToast] = useState('');
  useEffect(() => { if (!errorToast) return; const timeout = window.setTimeout(() => setErrorToast(''), 5000); return () => window.clearTimeout(timeout); }, [errorToast]);
  const load = async () => {
    setLoading(true); setError('');
    try {
      const result = await kooduSocket.request<{ memories: Array<{id:number;content:string;category:Shared.MemoryNote['category'];createdAt:number}> }>('memory.list');
      setNotes(result.memories.map((item) => ({...item, id:String(item.id), updatedAt:item.createdAt})));
    } catch (reason) { const message = readableMemoryError(reason, 'Could not load memories.'); setError(message); setErrorToast(message); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const startNew = () => { setEditing('new'); setContent(''); setCategory('fact'); };
  const startEdit = (note: Shared.MemoryNote) => { setEditing(note.id); setContent(note.content); setCategory(note.category); };
  const save = async () => {
    const cleanContent = boundMemoryText(content);
    if (!cleanContent) return;
    setBusy(true); setError('');
    try {
      const result = await kooduSocket.request<{ memories: Array<{id:number;content:string;category:Shared.MemoryNote['category'];createdAt:number}> }>('memory.save', { ...(editing !== 'new' ? {id:Number(editing)} : {}), content:cleanContent, category });
      setNotes(result.memories.map((item) => ({...item, id:String(item.id), updatedAt:item.createdAt}))); setEditing(null);
    } catch (reason) { const message = readableMemoryError(reason, 'Could not save memory.'); setError(message); setErrorToast(message); }
    finally { setBusy(false); }
  };
  const visible = notes.filter((note) => `${note.content} ${note.category}`.toLowerCase().includes(query.toLowerCase())).sort((a,b) => b.updatedAt-a.updatedAt);
  const remove = async (note: Shared.MemoryNote) => {
    setBusy(true); setError('');
    try { const result = await kooduSocket.request<{ memories: Array<{id:number;content:string;category:Shared.MemoryNote['category'];createdAt:number}> }>('memory.delete', {id:Number(note.id)}); setNotes(result.memories.map((item) => ({...item, id:String(item.id), updatedAt:item.createdAt}))); }
    catch (reason) { const message = readableMemoryError(reason, 'Could not delete memory.'); setError(message); setErrorToast(message); }
    finally { setBusy(false); }
  };
  return <div className="product-page memory-page">
    <div className="memory-toolbar"><label className="product-search"><Components.AppIcon icon={Search01Icon} size={16}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search saved memories"/></label><div className="memory-toolbar-actions"><span className="memory-total">{notes.length} SAVED</span><button className="product-secondary memory-refresh" title="Refresh memories" aria-label="Refresh memories" onClick={() => void load()} disabled={loading}><Components.AppIcon icon={Refresh01Icon} size={14}/></button><button className="product-primary" onClick={startNew}><Components.AppIcon icon={Add01Icon} size={15}/> New memory</button></div></div>
    {errorToast && <div className="memory-error-toast" role="alert"><span className="memory-error-mark">!</span><span>{errorToast}</span><button aria-label="Dismiss error" onClick={() => setErrorToast('')}><Components.AppIcon icon={Cancel01Icon} size={14}/></button></div>}
    {editing !== null && <section className="memory-editor"><div className="editor-heading"><strong>{editing === 'new' ? 'New memory' : 'Edit memory'}</strong><button aria-label="Close editor" disabled={busy} onClick={() => setEditing(null)}><Components.AppIcon icon={Cancel01Icon} size={16}/></button></div><div className="memory-editor-row"><input className="memory-content-input" value={content} onChange={(e) => setContent(e.target.value)} placeholder="Write one clear memory…" maxLength={350} disabled={busy}/><select aria-label="Memory category" value={category} onChange={(e) => setCategory(e.target.value as Shared.MemoryNote['category'])} disabled={busy}><option value="preference">Preference</option><option value="fact">Fact</option><option value="task">Task</option></select></div><div className="editor-actions"><span className="memory-token-count">{Array.from(content).length} / 350 characters</span><button className="product-secondary" disabled={busy} onClick={() => setEditing(null)}>Cancel</button><button className="product-primary" disabled={busy||!content.trim()} onClick={() => void save()}>{busy?<i className="tiny-spinner"/>:<Components.AppIcon icon={Tick02Icon} size={15}/>} {busy?'Saving…':'Save memory'}</button></div></section>}
    {loading ? <div className="product-empty">Loading memories from server…</div> : visible.length ? <div className="memory-list">{visible.map((note) => <article className="memory-row" key={note.id}><span className="memory-row-content" title={note.content}>{note.content}</span><span className={`memory-category-pill ${note.category}`}>{note.category}</span><time className="memory-row-time" title={new Date(note.updatedAt).toLocaleString()}>{new Date(note.updatedAt).toLocaleDateString()}</time><span className="memory-row-actions"><button title="Edit memory" aria-label="Edit memory" disabled={busy} onClick={() => startEdit(note)}><Components.AppIcon icon={Edit01Icon} size={14}/></button><button title="Delete memory" aria-label="Delete memory" disabled={busy} onClick={() => void remove(note)}><Components.AppIcon icon={Delete02Icon} size={14}/></button></span></article>)}</div> : <div className="product-empty"><span className="empty-mark"><Components.AppIcon icon={Layers01Icon} size={21}/></span><strong>{query ? 'No matching memories' : error ? 'Could not load memories' : 'Your memory is ready'}</strong><p>{query ? 'Try a different search.' : error ? 'Check the WebSocket connection and retry.' : 'Save a preference, fact, or task as one concise memory.'}</p>{!query && <button className="product-secondary" onClick={startNew}><Components.AppIcon icon={Add01Icon} size={14}/> Create your first memory</button>}</div>}
  </div>;
}

type ChatConversation = { id: string; title: string; createdAt: string; updatedAt: string; messageCount: number };
type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string; createdAt: string };


function renderChatInline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return <span key={index}>{part}</span>;
  });
}


