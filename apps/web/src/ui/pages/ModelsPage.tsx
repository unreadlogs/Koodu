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

const providerNames: Record<Shared.ModelProvider, string> = { openai: 'OpenAI', openrouter: 'OpenRouter', google: 'Google AI Studio', custom: 'Custom OpenAI-compatible' };
const providerUrls: Record<Shared.ModelProvider, string> = { openai: 'https://api.openai.com/v1', openrouter: 'https://openrouter.ai/api/v1', google: 'https://generativelanguage.googleapis.com/v1beta/openai', custom: '' };

export function ModelsPage(){
  const [profiles,setProfiles]=useState<Shared.ModelProfile[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [editor,setEditor]=useState<Shared.ModelProfile|null>(null);
  const [notice,setNotice]=useState('');
  const [testing,setTesting]=useState<string|null>(null);
  const [testStatus,setTestStatus]=useState<Record<string,string>>({});
  const load=()=>{setLoading(true);kooduSocket.request<{profiles:Shared.ModelProfile[]}>('models.list',{}).then(body=>{setProfiles(Array.isArray(body.profiles)?body.profiles:[]);setError('');}).catch(reason=>setError(reason instanceof Error?reason.message:'Could not load model profiles.')).finally(()=>setLoading(false));};
  useEffect(()=>{load();},[]);
  const save=async(value:Omit<Shared.ModelProfile,'apiKeySet'>&{apiKey?:string;clearApiKey?:boolean})=>{await kooduSocket.request('models.save',value);setEditor(null);setNotice('Model profile saved securely on the server.');load();};
  const remove=async(profile:Shared.ModelProfile)=>{try{await kooduSocket.request('models.delete',{id:profile.id});setProfiles(items=>items.filter(item=>item.id!==profile.id));setNotice(`${profile.name} removed.`);}catch(reason){setError(reason instanceof Error?reason.message:'Could not remove profile.');}};
  const activate=async(profile:Shared.ModelProfile)=>{try{await save({...profile,active:true,enabled:true});setNotice(`${profile.name} is now the active ${profile.role} profile.`);}catch(reason){setError(reason instanceof Error?reason.message:'Could not activate profile.');}};
  const test=async(profile:Shared.ModelProfile)=>{setTesting(profile.id);setTestStatus(current=>({...current,[profile.id]:''}));try{await kooduSocket.request('models.test',{id:profile.id});setTestStatus(current=>({...current,[profile.id]:'Connected'}));}catch(reason){const message=reason instanceof Error?reason.message:'Connection failed.';setTestStatus(current=>({...current,[profile.id]:message==='api_key_missing'?'Add an API key first.':message==='provider_unreachable'?'Provider endpoint could not be reached.':message}));}finally{setTesting(null);}};
  const create=()=>{setError('');setEditor({id:`model-${crypto.randomUUID().slice(0,8)}`,name:'',provider:'openai',model:'',baseUrl:providerUrls.openai,role:'cloud',maxOutputTokens:4096,monthlyTokenLimit:0,enabled:true,active:false,apiKeySet:false});};
  return <div className="product-page models-page">
    <div className="models-toolbar"><div className="models-runtime-status"><i className={error?'offline':'online'}/>{error?'SERVICE UNAVAILABLE':'SERVER-SIDE CONFIGURATION'}</div><button className="product-secondary" onClick={load}><Components.AppIcon icon={Refresh01Icon} size={14}/> Refresh</button><button className="product-primary" onClick={create}><Components.AppIcon icon={Add01Icon} size={15}/> Add model</button></div>
    {error&&<div className="model-error"><Components.AppIcon icon={Cancel01Icon} size={15}/>{error}<button onClick={load}>Retry</button></div>}{notice&&<div className="skill-notice"><Components.AppIcon icon={Tick02Icon} size={14}/>{notice}<button aria-label="Dismiss notice" onClick={()=>setNotice('')}><Components.AppIcon icon={Cancel01Icon} size={13}/></button></div>}
    {editor&&<ModelEditor key={editor.id} value={editor} onSave={save} onCancel={()=>setEditor(null)} onError={setError}/>}
    <div className="models-section-head"><div><strong>Configured models</strong><span>Provider keys remain on the server and are never sent back to the browser.</span></div><span>{profiles.length.toString().padStart(2,'0')}</span></div>
    {loading?<div className="model-loading"><i/>Loading provider profiles…</div>:profiles.length?<div className="model-profile-list">{profiles.map(profile=><article className={`model-profile ${!profile.enabled?'disabled':''}`} key={profile.id}><span className="model-provider-mark"><Components.AppIcon icon={profile.provider==='google'?SparklesIcon:profile.provider==='custom'?Settings01Icon:CpuIcon} size={18}/></span><div className="model-profile-main"><div className="model-name-row"><strong>{profile.name}</strong><span className="provider-chip">{providerNames[profile.provider]}</span>{profile.active&&profile.enabled&&<span className="active-chip">ACTIVE</span>}</div><div className="model-identifiers"><span>{profile.model}</span><span>·</span><span>{profile.role==='cloud'?'Cloud':'Local'} route</span><span>·</span><span>{profile.apiKeySet?'Key configured':'No API key'}</span></div><div className="model-limits"><span>Output max <b>{profile.maxOutputTokens.toLocaleString()} tokens</b></span><span>Monthly cap <b>{profile.monthlyTokenLimit?`${profile.monthlyTokenLimit.toLocaleString()} tokens`:'Unlimited'}</b></span></div>{testStatus[profile.id]&&<div className={`model-test-result ${testStatus[profile.id]==='Connected'?'success':'failure'}`}>{testStatus[profile.id]}</div>}</div><div className="model-profile-actions"><button className="product-secondary" onClick={()=>void test(profile)} disabled={testing!==null}>{testing===profile.id?<i className="tiny-spinner"/>:<Components.AppIcon icon={Activity01Icon} size={14}/>} Test</button>{!profile.active&&<button className="product-secondary activate-button" onClick={()=>void activate(profile)}>Use for {profile.role}</button>}<button className="icon-action" title="Edit profile" aria-label="Edit profile" onClick={()=>setEditor(profile)}><Components.AppIcon icon={Edit01Icon} size={15}/></button><button className="icon-action danger" title="Delete profile" aria-label="Delete profile" onClick={()=>void remove(profile)}><Components.AppIcon icon={Delete01Icon} size={15}/></button></div></article>)}</div>:!error?<div className="models-empty"><span className="empty-mark"><Components.AppIcon icon={CpuIcon} size={21}/></span><strong>No model profiles added</strong><p>Add OpenAI, OpenRouter, Google AI Studio, or any OpenAI-compatible endpoint.</p><button className="product-primary" onClick={create}><Components.AppIcon icon={Add01Icon} size={14}/> Add your first model</button></div>:null}
  </div>;
}
function ModelEditor({value,onSave,onCancel,onError}:{value:Shared.ModelProfile;onSave:(model:Omit<Shared.ModelProfile,'apiKeySet'>&{apiKey?:string;clearApiKey?:boolean})=>Promise<void>;onCancel:()=>void;onError:(message:string)=>void}){
  const [draft,setDraft]=useState(value);const [apiKey,setApiKey]=useState('');const [clearKey,setClearKey]=useState(false);const [saving,setSaving]=useState(false);
  const updateProvider=(provider:Shared.ModelProvider)=>setDraft(current=>({...current,provider,baseUrl:current.baseUrl===providerUrls[current.provider]?providerUrls[provider]:current.baseUrl}));
  const submit=async()=>{setSaving(true);onError('');try{await onSave({...draft,...(apiKey?{apiKey}:{}),...(clearKey?{clearApiKey:true}:{})});}catch(error){onError(error instanceof Error?error.message:'Could not save this profile.');}finally{setSaving(false);}};
  return <section className="model-editor"><div className="skill-editor-heading"><div><strong>{value.apiKeySet?'Edit provider profile':'Add provider profile'}</strong><small>Configure an OpenAI-compatible API endpoint for Koodu inference.</small></div><button aria-label="Close editor" onClick={onCancel}><Components.AppIcon icon={Cancel01Icon} size={16}/></button></div><div className="model-form-grid"><label>Profile name<input value={draft.name} maxLength={80} onChange={e=>setDraft({...draft,name:e.target.value})} placeholder="e.g. OpenRouter · Fast model"/></label><label>Provider<select value={draft.provider} onChange={e=>updateProvider(e.target.value as Shared.ModelProvider)}>{Object.entries(providerNames).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label><label>Model ID<input value={draft.model} onChange={e=>setDraft({...draft,model:e.target.value})} placeholder="Provider model identifier"/></label><label>API base URL<input value={draft.baseUrl} onChange={e=>setDraft({...draft,baseUrl:e.target.value})} placeholder="https://api.example.com/v1"/></label><label>Inference route<select value={draft.role} onChange={e=>setDraft({...draft,role:e.target.value as 'local'|'cloud',active:false})}><option value="cloud">Cloud reasoning</option><option value="local">Local inference</option></select></label><label>Max output tokens<input type="number" min={64} max={32768} step={64} value={draft.maxOutputTokens} onChange={e=>setDraft({...draft,maxOutputTokens:Number(e.target.value)})}/></label><label>Monthly token cap <small>0 means unlimited</small><input type="number" min={0} max={1000000000} step={1000} value={draft.monthlyTokenLimit} onChange={e=>setDraft({...draft,monthlyTokenLimit:Number(e.target.value)})}/></label><label>API key <small>{draft.apiKeySet&&!apiKey?'Saved on server · leave blank to keep':''}</small><input type="password" autoComplete="new-password" value={apiKey} onChange={e=>{setApiKey(e.target.value);setClearKey(false);}} placeholder={draft.apiKeySet?'Enter a new key to replace':'Paste provider API key'}/></label></div><div className="model-form-options"><label className="model-enabled-toggle"><input type="checkbox" checked={draft.enabled} onChange={e=>setDraft({...draft,enabled:e.target.checked,active:e.target.checked?draft.active:false})}/> Enabled</label>{draft.apiKeySet&&<label className="model-enabled-toggle"><input type="checkbox" checked={clearKey} onChange={e=>setClearKey(e.target.checked)}/> Remove saved key</label>}<label className="model-enabled-toggle"><input type="checkbox" checked={draft.active} onChange={e=>setDraft({...draft,active:e.target.checked,enabled:true})}/> Make active for this route</label></div><div className="model-editor-footer"><span>Compatible with OpenAI Chat Completions APIs. Google AI Studio’s OpenAI-compatible endpoint is supported.</span><div><button className="product-secondary" onClick={onCancel}>Cancel</button><button className="product-primary" disabled={saving||!draft.name.trim()||!draft.model.trim()||!draft.baseUrl.trim()||draft.maxOutputTokens<64||draft.monthlyTokenLimit<0} onClick={()=>void submit()}>{saving?<i className="tiny-spinner"/>:<Components.AppIcon icon={Tick02Icon} size={14}/>} Save profile</button></div></div></section>;
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
