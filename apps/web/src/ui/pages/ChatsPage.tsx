import { useEffect, useRef, useState } from "react";
import {
  Add01Icon, ArrowRight01Icon, Cancel01Icon, Delete02Icon, Message01Icon,
  Search01Icon, SparklesIcon,
} from "@hugeicons/core-free-icons";
import { kooduSocket } from "../../lib/socket";
import * as Shared from "../shared";
import * as Components from "../components";

const chatSuggestions = ['Could you introduce yourself?', 'What can you help me with?', 'Help me organize my workspace'];

export function ChatsPage() {
  const [conversations, setConversations] = useState<Shared.ChatConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Shared.ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [role, setRole] = useState<'local' | 'cloud'>('cloud');
  const [modelProfiles, setModelProfiles] = useState<Shared.ModelProfile[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  useEffect(() => {
    kooduSocket.request<{ profiles: Shared.ModelProfile[] }>('models.list', {}).then((result) => {
      const profiles = Array.isArray(result.profiles) ? result.profiles.filter((profile) => profile.enabled) : [];
      setModelProfiles(profiles);
      const active = profiles.find((profile) => profile.active) ?? profiles[0];
      if (active) { setSelectedModelId(active.id); setRole(active.role); }
    }).catch(() => {});
  }, []);
  const selectedModel = modelProfiles.find((profile) => profile.id === selectedModelId) ?? null;
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [paused, setPaused] = useState<{ messageId: string; taskId: string } | null>(null);
  const [resumeText, setResumeText] = useState('');
  const [query, setQuery] = useState('');
  const messageListRef = useRef<HTMLDivElement>(null);
  const suppressLoadRef = useRef(false);
  useEffect(() => { const element = messageListRef.current; if (element) element.scrollTop = element.scrollHeight; }, [messages, sending]);

  const activeConversation = conversations.find((item) => item.id === activeId) ?? null;
  const visibleConversations = conversations.filter((item) => item.title.toLowerCase().includes(query.toLowerCase()));

  const loadConversations = async () => {
    const result = await kooduSocket.request<{ conversations: Shared.ChatConversation[] }>('chats.list');
    setConversations(result.conversations);
  };

  /** A paused chat task keeps its conversation id in the checkpoint, so the resume bar survives a reload. */
  const findResumableTask = async (conversationId: string): Promise<string | null> => {
    try {
      const result = await kooduSocket.request<{ tasks: Shared.AgentTask[] }>('tasks.list', { limit: 50 });
      const match = (Array.isArray(result.tasks) ? result.tasks : []).find((task) =>
        (task.status === 'paused' || task.status === 'failed') &&
        Boolean(task.checkpoint) &&
        task.checkpoint?.context?.conversationId === conversationId);
      return match?.id ?? null;
    } catch { return null; }
  };
  useEffect(() => {
    let alive = true;
    kooduSocket.request<{ conversations: Shared.ChatConversation[] }>('chats.list').then((result) => {
      if (alive) setConversations(result.conversations);
    }).catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : 'Could not load chats.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!activeId) { setMessages([]); setPaused(null); return; }
    if (suppressLoadRef.current) { suppressLoadRef.current = false; return; }
    let alive = true;
    setMessages([]); setError(''); setPaused(null);
    kooduSocket.request<{ messages: Shared.ChatMessage[] }>('chats.messages', { conversationId: activeId })
      .then(async (result) => {
        if (!alive) return;
        setMessages(result.messages);
        const taskId = await findResumableTask(activeId);
        if (!alive || !taskId) return;
        const lastAssistant = [...result.messages].reverse().find((message) => message.role === 'assistant');
        if (lastAssistant) setPaused({ messageId: lastAssistant.id, taskId });
      })
      .catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : 'Could not load this conversation.'); });
    return () => { alive = false; };
  }, [activeId]);

  const createConversation = async () => {
    setError('');
    try {
      const result = await kooduSocket.request<{ conversation: Shared.ChatConversation }>('chats.create', {});
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
    setSending(true); setError(''); setPaused(null);
    let conversationId = activeId;
    try {
      if (!conversationId) {
        suppressLoadRef.current = true;
        const created = await kooduSocket.request<{ conversation: Shared.ChatConversation }>('chats.create', {});
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
    const userMessage: Shared.ChatMessage = { id: crypto.randomUUID(), role: 'user', content: text, createdAt: new Date().toISOString() };
    const assistantId = crypto.randomUUID();
    const pendingAssistant: Shared.ChatMessage = { id: assistantId, role: 'assistant', content: '', createdAt: new Date().toISOString() };
    setMessages((items) => [...items, userMessage, pendingAssistant]);
    try {
      const result = await kooduSocket.request<{ reply: string; createdAt: string; status?: 'completed' | 'paused'; taskId?: string }>('chats.send', { conversationId, role, text }, {
        onStream: (event) => setMessages((items) => items.map((message) => message.id !== assistantId ? message : { ...message, content: event.kind === 'reset' ? '' : message.content + event.text })),
      });
      setMessages((items) => items.map((message) => message.id !== assistantId ? message : { ...message, content: result.reply, createdAt: result.createdAt }));
      setPaused(result.status === 'paused' && result.taskId ? { messageId: assistantId, taskId: result.taskId } : null);
      await loadConversations();
    } catch (reason) {
      setMessages((items) => items.filter((message) => message.id !== assistantId));
      setError(reason instanceof Error ? reason.message : 'The message could not be sent.');
      void kooduSocket.request<{ messages: Shared.ChatMessage[] }>('chats.messages', { conversationId }).then((result) => setMessages(result.messages)).catch(() => {});
    } finally { setSending(false); }
  };

  const resumePausedTask = async () => {
    if (!paused || !activeId || sending) return;
    setSending(true); setError(''); setResumeText('');
    const { taskId, messageId } = paused;
    try {
      const result = await kooduSocket.request<{ reply: string; status: 'completed' | 'paused'; taskId: string }>('agent.resume', { taskId, role }, {
        onStream: (event) => setResumeText((current) => event.kind === 'reset' ? '' : current + event.text),
      });
      const history = await kooduSocket.request<{ messages: Shared.ChatMessage[] }>('chats.messages', { conversationId: activeId });
      setMessages(history.messages);
      const lastAssistant = [...history.messages].reverse().find((message) => message.role === 'assistant');
      setPaused(result.status === 'paused' && lastAssistant ? { messageId: lastAssistant.id, taskId } : null);
      setResumeText('');
      await loadConversations();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The paused task could not be resumed.');
      setPaused({ messageId, taskId });
    } finally { setSending(false); }
  };

  return <section className="chats-layout">
    <aside className="chat-conversation-panel">
      <div className="chat-side-actions">
        <button className="chat-new-button" onClick={() => void createConversation()}><Components.AppIcon icon={Add01Icon} size={15}/> New chat</button>
        <label className="chat-search"><Components.AppIcon icon={Search01Icon} size={15}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search chats" aria-label="Search chats"/></label>
      </div>
      <div className="chat-list-label"><span>Conversations</span><span>{conversations.length} saved</span></div>
      {loading ? <div className="chat-list-empty">Loading conversations…</div> : visibleConversations.length ? <div className="chat-conversation-list">{visibleConversations.map((conversation) => <div className={`chat-conversation-item ${activeId === conversation.id ? 'active' : ''}`} key={conversation.id}><button className="chat-conversation-select" onClick={() => setActiveId(conversation.id)}><strong>{conversation.title}</strong>{conversation.messageCount ? <small>{conversation.messageCount} messages</small> : null}</button><button className="chat-delete-button" aria-label={`Delete ${conversation.title}`} title="Delete conversation" onClick={() => void deleteConversation(conversation.id)}><Components.AppIcon icon={Delete02Icon} size={13}/></button></div>)}</div> : <div className="chat-list-empty">{query ? 'No matching chats.' : 'No conversations yet.'}</div>}
    </aside>
    <div className="chat-thread">
      <header className="chat-thread-head">
        <span className="chat-thread-title">{activeConversation ? activeConversation.title : 'Start a conversation'}</span>
        <span className="chat-thread-meta">{activeConversation ? `${activeConversation.messageCount} messages · Saved on server` : 'Chats are saved on the server'}</span>
      </header>
      <div className="chat-message-list" aria-live="polite" ref={messageListRef}>
        <div className="chat-column">
          {!activeConversation && !messages.length ? <div className="chat-hero"><span className="chat-welcome-mark"><Components.AppIcon icon={Message01Icon} size={22}/></span><strong>Meet Koodu</strong><p>Ask a question, describe a task, or type a page name. Koodu replies here and keeps history on the server.</p><div className="chat-suggestions">{chatSuggestions.map((suggestion) => <button key={suggestion} className="chat-suggestion-chip" onClick={() => setDraft(suggestion)}>{suggestion}</button>)}</div></div>
          : messages.length ? messages.map((message) => {
            if (message.role === 'user') return <div className="chat-row user-row" key={message.id}><div className="chat-user-bubble">{message.content}</div></div>;
            if (!message.content && sending) return <article className="chat-row assistant-row" key={message.id}><div className="chat-thought"><span className="chat-thought-spin"/><span>Thought for a while</span><span aria-hidden="true">›</span></div></article>;
            return <article className="chat-row assistant-row" key={message.id}>
              <Components.AssistantContent content={message.content}/>
              {paused?.messageId === message.id && <div className="chat-task-paused">
                <span>This task paused at a safe step limit. Its progress is saved on the server.</span>
                {resumeText && <small className="chat-task-stream">{resumeText}</small>}
                <button className="product-secondary" disabled={sending} onClick={() => void resumePausedTask()}>{sending ? <i className="tiny-spinner"/> : 'Continue task'}</button>
              </div>}
            </article>;
          }) : <div className="chat-hero"><span className="chat-welcome-mark"><Components.AppIcon icon={SparklesIcon} size={22}/></span><strong>What would you like to work on?</strong><p>Try one of these, or type your own message below.</p><div className="chat-suggestions">{chatSuggestions.map((suggestion) => <button key={suggestion} className="chat-suggestion-chip" onClick={() => setDraft(suggestion)}>{suggestion}</button>)}</div></div>}
        </div>
      </div>
      <div className="chat-compose-wrap">
        {error && <div className="chat-error-inline" role="alert"><Components.AppIcon icon={Cancel01Icon} size={13}/><span>{error}</span></div>}
        <div className="chat-compose">
          <textarea aria-label="Message Koodu" value={draft} maxLength={1000} disabled={sending} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder="Message Koodu, describe a task, or ask a question…" rows={2}/>
          <div className="chat-compose-bar">
            <button className="chat-plus-btn" onClick={() => void createConversation()} aria-label="New chat" title="New chat"><Components.AppIcon icon={Add01Icon} size={16}/></button>
            <Components.ModelProfileDropdown profiles={modelProfiles} selectedId={selectedModelId} disabled={sending} onSelect={(profile: Shared.ModelProfile) => { setSelectedModelId(profile.id); setRole(profile.role); }}/>
            <span className="chat-compose-hint">ENTER TO SEND</span>
            <button className="chat-send-btn" aria-label="Send message" disabled={!draft.trim() || sending} onClick={() => void sendMessage()}>{sending ? <i className="tiny-spinner"/> : <Components.AppIcon icon={ArrowRight01Icon} size={16}/>}</button>
          </div>
        </div>
      </div>
    </div>
  </section>;
}

