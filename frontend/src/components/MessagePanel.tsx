import { useState, useRef, useEffect } from 'react';
import { Send, Paperclip, Clock, CheckCircle, CheckCheck, PlayCircle, File as FileIcon, X, Bot, User, Network, ArrowRightLeft, ChevronDown, Reply } from 'lucide-react';
import type { AgentMessage } from '../types';
import { sendMessage, uploadFile, fetchAgents, fetchAgentFiles } from '../api';
import type { ReplyRef } from '../api';
import { timeAgo } from '../utils/time';

const messageStatusConfig = {
  pending: { icon: Clock, color: 'text-yellow-400', bg: 'bg-yellow-400/10', label: 'Pending' },
  delivered: { icon: CheckCircle, color: 'text-blue-400', bg: 'bg-blue-400/10', label: 'Delivered' },
  acknowledged: { icon: CheckCheck, color: 'text-purple-400', bg: 'bg-purple-400/10', label: 'Acknowledged' },
  executed: { icon: PlayCircle, color: 'text-green-400', bg: 'bg-green-400/10', label: 'Executed' },
} as const;

type PendingItem =
  | { kind: 'file'; id: string; file: File }
  | { kind: 'relay'; id: string; filename: string; srcAgentId: string; srcAgentTitle: string; fileId: number }
  | { kind: 'reply'; id: string; msgId: number; snippet: string; sourceLabel: string; isAck: boolean };

interface MessagePanelProps {
  agentId: string;
  messages: AgentMessage[];
  onSent: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

let pendingItemCounter = 0;

function MessagePanel({ agentId, messages, onSent }: MessagePanelProps) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Scroll to (and briefly highlight) a referenced message when its ghost quote is tapped.
  const jumpToMessage = (id: number) => {
    const el = document.getElementById(`web-msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightId(id);
    window.setTimeout(() => setHighlightId(curr => (curr === id ? null : curr)), 1500);
  };

  // Relay picker state
  const [showRelay, setShowRelay] = useState(false);
  const [relayAgents, setRelayAgents] = useState<{ id: string; title: string }[]>([]);
  const [relayAgentId, setRelayAgentId] = useState('');
  const [relayFiles, setRelayFiles] = useState<{ id: number; filename: string; size: number }[]>([]);
  const [loadingRelayFiles, setLoadingRelayFiles] = useState(false);

  // Load agent list when relay picker opens
  useEffect(() => {
    if (!showRelay) return;
    fetchAgents()
      .then(all => setRelayAgents(all.filter(a => a.id !== agentId).map(a => ({ id: a.id, title: a.title }))))
      .catch(() => {});
  }, [showRelay, agentId]);

  // Load files when a relay agent is selected
  useEffect(() => {
    if (!relayAgentId) { setRelayFiles([]); return; }
    setLoadingRelayFiles(true);
    fetchAgentFiles(relayAgentId)
      .then(files => setRelayFiles(Array.isArray(files) ? files : []))
      .catch(() => setRelayFiles([]))
      .finally(() => setLoadingRelayFiles(false));
  }, [relayAgentId]);

  const handleSend = async () => {
    const content = input.trim();
    // A reply alone is not sendable — it's metadata attached to a body (text or file).
    const nonReplyItems = pendingItems.filter(i => i.kind !== 'reply');
    if ((!content && nonReplyItems.length === 0) || sending) return;

    try {
      setSending(true);
      setSendError(null);

      let messageContent = content;

      for (const item of pendingItems) {
        if (item.kind === 'file') {
          const result = await uploadFile(agentId, item.file);
          const ref = `[File attached: ${result.file.filename} (id=${result.file.id}, ${result.file.mimetype}, ${formatSize(result.file.size)}). Retrieve via GET /api/agents/${agentId}/files/${result.file.id}]`;
          messageContent = messageContent ? `${messageContent}\n\n${ref}` : ref;
        } else if (item.kind === 'relay') {
          const ref = `[Relayed file from ${item.srcAgentTitle}: ${item.filename} — retrieve at GET /api/agents/${item.srcAgentId}/files/${item.fileId}]`;
          messageContent = messageContent ? `${messageContent}\n\n${ref}` : ref;
        }
      }

      // Reply is sent structurally (rendered as a ghost quote); the textual
      // reference is injected server-side at delivery, not stored in the body.
      const reply = pendingItems.find((i): i is Extract<PendingItem, { kind: 'reply' }> => i.kind === 'reply');
      const replyRef: ReplyRef | undefined = reply
        ? {
            reply_to_kind: 'message',
            reply_to_id: reply.msgId,
            reply_to_label: `${reply.sourceLabel}${reply.isAck ? "'s ack" : ''}`,
            reply_to_snippet: reply.snippet,
          }
        : undefined;

      if (messageContent) {
        await sendMessage(agentId, messageContent, replyRef);
      }

      setInput('');
      setPendingItems([]);
      onSent();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setPendingItems(prev => [
      ...prev,
      ...files.map(f => ({ kind: 'file' as const, id: `f-${++pendingItemCounter}`, file: f })),
    ]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeItem = (id: string) => setPendingItems(prev => prev.filter(i => i.id !== id));

  // Set (or replace) the single pending reply reference for the next outgoing message.
  // isAck=true references a message's acknowledgement independently of its body.
  const setReply = (msgId: number, content: string, sourceLabel: string, isAck = false) => {
    const snippet = content.replace(/\s+/g, ' ').trim().slice(0, 80);
    setPendingItems(prev => [
      ...prev.filter(i => i.kind !== 'reply'),
      { kind: 'reply', id: `q-${++pendingItemCounter}`, msgId, snippet, sourceLabel, isAck },
    ]);
  };

  const addRelayFile = (file: { id: number; filename: string; size: number }) => {
    const agent = relayAgents.find(a => a.id === relayAgentId);
    if (!agent) return;
    setPendingItems(prev => [
      ...prev,
      {
        kind: 'relay',
        id: `r-${++pendingItemCounter}`,
        filename: file.filename,
        srcAgentId: relayAgentId,
        srcAgentTitle: agent.title,
        fileId: file.id,
      },
    ]);
    setShowRelay(false);
    setRelayAgentId('');
    setRelayFiles([]);
  };

  return (
    <div className="bg-dark-900 border border-dark-800 rounded-xl overflow-hidden flex flex-col">
      <div className="px-5 py-4 border-b border-dark-800">
        <h2 className="text-sm font-semibold text-dark-300 uppercase tracking-wide">
          Messages
        </h2>
      </div>

      {/* Input area */}
      <div className="p-4 border-b border-dark-800 space-y-2">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Send a message to the agent..."
            rows={2}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend(); }}
            className="flex-1 bg-dark-850 border border-dark-700 rounded-lg px-3 py-2 text-sm text-dark-100 placeholder-dark-600 resize-none focus:outline-none focus:ring-2 focus:ring-lumi-500/30 focus:border-lumi-600/50"
          />
          <div className="flex flex-col gap-1 self-end">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={sending}
              className="px-3 py-2 bg-dark-800 hover:bg-dark-700 disabled:opacity-50 text-dark-300 rounded-lg transition-colors"
              title="Attach file"
            >
              <Paperclip size={16} />
            </button>
            <button
              onClick={() => { setShowRelay(r => !r); setRelayAgentId(''); setRelayFiles([]); }}
              disabled={sending}
              className={`px-3 py-2 rounded-lg transition-colors disabled:opacity-50 ${showRelay ? 'bg-purple-700/30 text-purple-300' : 'bg-dark-800 hover:bg-dark-700 text-dark-300'}`}
              title="Relay file from another agent"
            >
              <ArrowRightLeft size={16} />
            </button>
            <button
              onClick={handleSend}
              disabled={(!input.trim() && pendingItems.every(i => i.kind === 'reply')) || sending}
              className="px-3 py-2 bg-lumi-600 hover:bg-lumi-500 disabled:bg-dark-700 disabled:text-dark-500 text-white rounded-lg transition-colors"
            >
              <Send size={16} />
            </button>
          </div>
        </div>

        {/* Hidden file input — multiple */}
        <input ref={fileInputRef} type="file" multiple onChange={handleFileSelect} className="hidden" />

        {/* Pending items */}
        {pendingItems.length > 0 && (
          <div className="space-y-1.5">
            {pendingItems.map(item => (
              <div key={item.id} className="flex items-center gap-2 px-2 py-1.5 bg-dark-850 border border-dark-700 rounded-lg text-sm">
                {item.kind === 'file' ? (
                  <>
                    <FileIcon size={14} className="text-lumi-400 shrink-0" />
                    <span className="text-dark-200 truncate flex-1">{item.file.name}</span>
                    <span className="text-dark-500 text-xs shrink-0">{formatSize(item.file.size)}</span>
                  </>
                ) : item.kind === 'relay' ? (
                  <>
                    <ArrowRightLeft size={14} className="text-purple-400 shrink-0" />
                    <span className="text-dark-200 truncate flex-1">{item.filename}</span>
                    <span className="text-dark-500 text-xs shrink-0 truncate max-w-[80px]">from {item.srcAgentTitle}</span>
                  </>
                ) : (
                  <>
                    <Reply size={14} className="text-lumi-400 shrink-0" />
                    <span className="text-dark-200 truncate flex-1">
                      <span className="text-dark-500">Replying to {item.sourceLabel}{item.isAck ? "'s ack" : ''}: </span>{item.snippet}
                    </span>
                  </>
                )}
                <button onClick={() => removeItem(item.id)} className="text-dark-500 hover:text-dark-200 shrink-0">
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Relay file picker */}
        {showRelay && (
          <div className="border border-dark-700 rounded-lg bg-dark-850 p-3 space-y-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-dark-400">Relay file from agent</span>
              <button onClick={() => setShowRelay(false)} className="text-dark-600 hover:text-dark-300">
                <X size={13} />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={relayAgentId}
                onChange={e => setRelayAgentId(e.target.value)}
                className="flex-1 bg-dark-800 border border-dark-700 rounded-lg px-2 py-1.5 text-xs text-dark-200 focus:outline-none"
              >
                <option value="">Select agent…</option>
                {relayAgents.map(a => (
                  <option key={a.id} value={a.id}>{a.title}</option>
                ))}
              </select>
              {relayAgentId && <ChevronDown size={13} className="text-dark-500 shrink-0" />}
            </div>
            {relayAgentId && (
              <div className="max-h-36 overflow-y-auto space-y-1">
                {loadingRelayFiles && <p className="text-xs text-dark-500 text-center py-2">Loading…</p>}
                {!loadingRelayFiles && relayFiles.length === 0 && (
                  <p className="text-xs text-dark-600 text-center py-2">No files found</p>
                )}
                {relayFiles.map(f => (
                  <button
                    key={f.id}
                    onClick={() => addRelayFile(f)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-dark-700 text-left transition-colors"
                  >
                    <FileIcon size={13} className="text-dark-500 shrink-0" />
                    <span className="text-xs text-dark-200 truncate flex-1">{f.filename}</span>
                    <span className="text-xs text-dark-600 shrink-0">{formatSize(f.size)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {sendError && <p className="text-xs text-red-400">{sendError}</p>}
      </div>

      {/* Message list */}
      <div className="max-h-[calc(100vh-360px)] overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <p className="text-sm text-dark-600 text-center py-4">No messages yet</p>
        ) : (
          messages.map((msg) => {
            const statusCfg = messageStatusConfig[msg.status];
            const StatusIcon = statusCfg.icon;
            const isAgent = msg.source === 'agent';
            const isPeer = msg.source === 'peer';

            const containerClass = isPeer
              ? 'bg-emerald-950/15 border-emerald-800/30'
              : isAgent
                ? 'bg-blue-950/10 border-blue-800/20'
                : msg.status === 'pending'
                  ? 'bg-yellow-950/10 border-yellow-800/20'
                  : 'bg-dark-850 border-dark-800/50';

            const labelClass = isPeer
              ? 'text-emerald-400'
              : isAgent
                ? 'text-blue-400'
                : 'text-purple-400';

            const peerAgentLabel = msg.source_agent_id
              ? `Agent ${msg.source_agent_id.slice(0, 8)}`
              : 'Peer';
            const sourceLabel = isPeer
              ? `${peerAgentLabel} @ ${msg.source_peer_name ?? 'unknown'}`
              : isAgent
                ? (msg.source_agent_id ? `Agent ${msg.source_agent_id}` : 'Agent')
                : 'You';

            return (
              <div
                key={msg.id}
                id={`web-msg-${msg.id}`}
                className={`p-3 rounded-lg border transition-shadow ${containerClass} ${highlightId === msg.id ? 'ring-2 ring-lumi-400' : ''}`}
              >
                <div className="flex items-center gap-1.5 mb-1.5">
                  {isPeer ? (
                    <Network size={13} className="text-emerald-400" />
                  ) : isAgent ? (
                    <Bot size={13} className="text-blue-400" />
                  ) : (
                    <User size={13} className="text-purple-400" />
                  )}
                  <span className={`text-xs font-medium ${labelClass}`}>{sourceLabel}</span>
                </div>
                {msg.reply_to_id != null && (
                  <button
                    onClick={() => jumpToMessage(msg.reply_to_id!)}
                    className="w-full text-left mb-2 pl-2 pr-2 py-1 border-l-2 border-lumi-500/60 bg-dark-800/40 rounded hover:bg-dark-800/70 transition-colors"
                    title="Jump to referenced message"
                  >
                    <span className="flex items-center gap-1 text-xs text-lumi-400 truncate">
                      <Reply size={11} className="shrink-0" />
                      {msg.reply_to_label ?? 'Reply'}
                    </span>
                    {msg.reply_to_snippet && (
                      <span className="block text-xs text-dark-400 truncate">{msg.reply_to_snippet}</span>
                    )}
                  </button>
                )}
                <p className="text-sm text-dark-200 whitespace-pre-wrap break-words mb-2">
                  {msg.content}
                </p>
                {msg.status === 'acknowledged' && msg.ack_content && (
                  <div className="mb-2 px-2.5 py-1.5 bg-purple-950/20 border border-purple-800/30 rounded text-xs text-purple-300 italic flex items-start gap-1.5">
                    <span className="flex-1"><span className="text-purple-500 font-medium not-italic">Ack:</span> {msg.ack_content}</span>
                    <button
                      onClick={() => setReply(msg.id, msg.ack_content ?? '', sourceLabel, true)}
                      className="inline-flex items-center justify-center w-5 h-5 rounded-full text-purple-400 hover:text-lumi-300 hover:bg-lumi-500/10 transition-colors shrink-0 not-italic"
                      title="Reply to this acknowledgement"
                    >
                      <Reply size={12} />
                    </button>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className={`inline-flex items-center gap-1 text-xs ${statusCfg.color} ${statusCfg.bg} px-2 py-0.5 rounded-full`}>
                      <StatusIcon size={10} />
                      {statusCfg.label}
                    </span>
                    <button
                      onClick={() => setReply(msg.id, msg.content, sourceLabel)}
                      className="inline-flex items-center justify-center w-6 h-6 rounded-full text-dark-500 hover:text-lumi-300 hover:bg-lumi-500/10 transition-colors"
                      title="Reply to this message"
                    >
                      <Reply size={13} />
                    </button>
                  </div>
                  <span className="text-xs text-dark-600">{timeAgo(msg.created_at)}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default MessagePanel;
