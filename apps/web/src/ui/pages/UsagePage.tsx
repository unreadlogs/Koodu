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

export function UsagePage() {
  const [range, setRange] = useState<Shared.UsageRange>('7D');
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
    <div className="usage-toolbar"><div className="usage-window"><Components.AppIcon icon={Clock01Icon} size={15}/><span>Activity window</span>{(['24H','7D','30D'] as Shared.UsageRange[]).map(option=><button key={option} className={range===option?'active':''} onClick={()=>setRange(option)}>{option}</button>)}</div><button className="product-secondary" onClick={exportPreview}><Components.AppIcon icon={Download01Icon} size={14}/> Export CSV</button></div>
    {error&&<div className="model-error">{error}</div>}
    <div className="usage-metric-grid">
      <Components.UsageMetric icon={ChartLineData01Icon} label="TOTAL REQUESTS" value={(summary?.calls??0).toLocaleString()} delta="" detail="selected period"/>
      <Components.UsageMetric icon={Coins01Icon} label="TOKENS PROCESSED" value={(summary?.tokens??0).toLocaleString()} delta="" detail="input + output"/>
      <Components.UsageMetric icon={Clock01Icon} label="AVG. RESPONSE TIME" value={`${Math.round(summary?.latency??0)} ms`} delta="" detail="recorded requests"/>
      <Components.UsageMetric icon={Activity01Icon} label="SUCCESS RATE" value={`${(summary?.successRate??0).toFixed(1)}%`} delta="" detail="successful requests"/>
    </div>
    <section className="usage-panel usage-chart-panel"><div className="usage-panel-heading"><div><strong>Request volume</strong><span>Recorded requests · {range}</span></div></div><div className="chart-area"><div className="chart-y-axis"><span>{maxCalls}</span><span>{Math.round(maxCalls*.75)}</span><span>{Math.round(maxCalls*.5)}</span><span>{Math.round(maxCalls*.25)}</span><span>0</span></div><div className="chart-columns" style={{gridTemplateColumns:`repeat(${labels.length||1},minmax(0,1fr))`}}>{(usage?.daily??[]).map(row=><div className="chart-column" key={row.day}><div className="chart-bar-track"><i className="chart-bar" style={{height:`${row.calls/maxCalls*100}%`}}/></div><span>{row.day}</span></div>)}</div></div>{!usage?.daily.length&&<p>No requests recorded for this period.</p>}</section>
    <div className="usage-lower-grid"><section className="usage-panel breakdown-panel"><div className="usage-panel-heading"><div><strong>Usage by model</strong><span>Request share · preview distribution</span></div><button className="quiet-action">All models <Components.AppIcon icon={ArrowUpRight01Icon} size={13}/></button></div>{[{name:'Local model',meta:'On-device · Koodu runtime',share:54,amount:'4,829',color:'green'},{name:'Cloud reasoning',meta:'Provider adapter · configured',share:33,amount:'2,951',color:'lavender'},{name:'Other requests',meta:'Embeddings and utilities',share:13,amount:'1,162',color:'blue'}].map(row=><div className="model-usage-row" key={row.name}><span className={`model-usage-mark ${row.color}`}/><div className="model-usage-copy"><strong>{row.name}</strong><small>{row.meta}</small><i><b className={row.color} style={{width:`${row.share}%`}}/></i></div><span className="model-usage-count"><strong>{row.amount}</strong><small>{row.share}%</small></span></div>)}</section>
      <section className="usage-panel activity-panel"><div className="usage-panel-heading"><div><strong>Recent activity</strong><span>Example request log</span></div><button className="quiet-action">View log <Components.AppIcon icon={ArrowUpRight01Icon} size={13}/></button></div><div className="activity-table"><div className="activity-row activity-table-head"><span>REQUEST</span><span>MODEL</span><span>TIME</span><span>STATUS</span></div>{[['Summarize my recent notes','Local · Koodu','2m ago','Success'],['Compare model responses','Cloud · Reasoning','18m ago','Success'],['Open workspace usage','Local · Koodu','41m ago','Success'],['Organize project context','Cloud · Reasoning','1h ago','Retried']].map(([title,model,time,status])=><div className="activity-row" key={title}><span className="activity-request">{title}</span><span>{model}</span><span>{time}</span><span className={`activity-state ${status==='Success'?'ok':'retry'}`}><i/>{status}</span></div>)}</div></section></div>
    <div className="usage-disclaimer">Usage is calculated from server-recorded inference requests.</div>
  </div>;
}
function UsageMetric({icon,label,value,delta,detail}:{icon:IconSvgElement;label:string;value:string;delta:string;detail:string}) {
  return <article className="usage-metric"><div className="usage-metric-top"><span><Components.AppIcon icon={icon} size={15}/>{label}</span><Components.AppIcon icon={ArrowUpRight01Icon} size={13}/></div><strong>{value}</strong><div className="usage-metric-bottom"><span>{delta}</span><small>{detail}</small></div></article>;
}

