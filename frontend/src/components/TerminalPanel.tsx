import { useState, useEffect, useRef } from 'react';
import { Terminal, ChevronDown, ChevronUp, Send, CornerDownLeft, Ban, Radio } from 'lucide-react';
import type { AgentUpdate, TerminalLine } from '../types';
import { sendInput, sendSignal } from '../api';

interface TerminalPanelProps {
  updates: AgentUpdate[];
  liveLines?: TerminalLine[];
  agentId?: string;
  /** Whether this agent is currently running and attached (live status + has a pid) — gates the interactive controls. */
  canControl?: boolean;
}

const TYPE_COLOR: Record<string, string> = {
  status:   'text-blue-500',
  text:     'text-dark-400',
  error:    'text-red-500',
  progress: 'text-yellow-500',
  relay:    'text-purple-500',
  diagram:  'text-cyan-500',
};

function summarise(u: AgentUpdate): string {
  if (u.summary) return u.summary;
  const c = u.content as unknown;
  if (typeof c === 'string') return (c as string).split('\n')[0].slice(0, 160);
  if (c && typeof c === 'object') {
    const r = c as Record<string, unknown>;
    const s = r.status ?? r.text ?? r.message ?? r.summary ?? r.description;
    if (typeof s === 'string') return s.split('\n')[0].slice(0, 160);
  }
  return u.type;
}

function TerminalPanel({ updates, liveLines = [], agentId, canControl = false }: TerminalPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [signaling, setSignaling] = useState<'ctrl-c' | 'enter' | null>(null);
  const [controlError, setControlError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const totalCount = updates.length + liveLines.length;

  useEffect(() => {
    if (!collapsed && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [totalCount, collapsed]);

  const handleSendInput = async () => {
    const text = inputText.trim();
    if (!text || !agentId || sending) return;
    setSending(true);
    setControlError(null);
    try {
      await sendInput(agentId, text);
      setInputText('');
    } catch (err) {
      setControlError(err instanceof Error ? err.message : 'Failed to send input');
    } finally {
      setSending(false);
    }
  };

  const handleSignal = async (signal: 'ctrl-c' | 'enter') => {
    if (!agentId || signaling) return;
    setSignaling(signal);
    setControlError(null);
    try {
      await sendSignal(agentId, signal);
    } catch (err) {
      setControlError(err instanceof Error ? err.message : 'Failed to send signal');
    } finally {
      setSignaling(null);
    }
  };

  return (
    <div className="bg-dark-950 border border-dark-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-dark-900/60 transition-colors"
      >
        <span className="flex items-center gap-2 text-xs font-mono font-semibold text-dark-500 uppercase tracking-wider">
          <Terminal size={13} />
          Terminal Log
          <span className="text-dark-700 font-normal normal-case tracking-normal">({totalCount})</span>
          {canControl && (
            <span className="flex items-center gap-1 text-green-500 font-normal normal-case tracking-normal">
              <Radio size={10} className="animate-pulse" /> live
            </span>
          )}
        </span>
        {collapsed ? <ChevronDown size={13} className="text-dark-600" /> : <ChevronUp size={13} className="text-dark-600" />}
      </button>

      {!collapsed && (
        <>
          <div
            ref={scrollRef}
            className="max-h-56 overflow-y-auto bg-dark-950 px-3 py-2 font-mono text-xs space-y-0.5"
          >
            {totalCount === 0 ? (
              <p className="text-dark-700 py-2 text-center">No entries</p>
            ) : (
              <>
                {updates.map(u => {
                  const ts = new Date(u.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
                  const typeColor = TYPE_COLOR[u.type] ?? 'text-dark-500';
                  const line = summarise(u);
                  return (
                    <div key={u.id} className="flex gap-2 leading-5 hover:bg-dark-900/40 px-1 rounded group">
                      <span className="text-dark-700 shrink-0 select-none">{ts}</span>
                      <span className={`shrink-0 w-14 ${typeColor}`}>{u.type}</span>
                      <span className="text-dark-300 break-all">{line}</span>
                    </div>
                  );
                })}
                {liveLines.map((line, i) => {
                  const ts = new Date(line.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
                  return (
                    <div key={`live-${i}`} className="flex gap-2 leading-5 hover:bg-dark-900/40 px-1 rounded group">
                      <span className="text-dark-700 shrink-0 select-none">{ts}</span>
                      <span className="shrink-0 w-14 text-green-500">live</span>
                      <span className="text-dark-200 break-all whitespace-pre-wrap">{line.output}</span>
                    </div>
                  );
                })}
              </>
            )}
          </div>

          {agentId && (
            <div className="border-t border-dark-800 px-3 py-2 space-y-1.5">
              {canControl ? (
                <>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSendInput(); }}
                      placeholder="Type into the agent's terminal..."
                      disabled={sending}
                      className="flex-1 bg-dark-900 border border-dark-700 rounded-lg px-2.5 py-1.5 font-mono text-xs text-dark-100 placeholder-dark-600 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-lumi-500/30 focus:border-lumi-600/50"
                    />
                    <button
                      onClick={handleSendInput}
                      disabled={!inputText.trim() || sending}
                      title="Type this text into the terminal"
                      className="px-2.5 py-1.5 bg-lumi-600 hover:bg-lumi-500 disabled:bg-dark-800 disabled:text-dark-600 text-white rounded-lg transition-colors"
                    >
                      <Send size={13} />
                    </button>
                    <button
                      onClick={() => handleSignal('enter')}
                      disabled={signaling !== null}
                      title="Send Enter keypress"
                      className="px-2.5 py-1.5 bg-dark-800 hover:bg-dark-700 disabled:opacity-50 text-dark-300 rounded-lg transition-colors"
                    >
                      <CornerDownLeft size={13} className={signaling === 'enter' ? 'animate-pulse' : ''} />
                    </button>
                    <button
                      onClick={() => handleSignal('ctrl-c')}
                      disabled={signaling !== null}
                      title="Send Ctrl+C"
                      className="px-2.5 py-1.5 bg-dark-800 hover:bg-red-950/40 disabled:opacity-50 text-dark-300 hover:text-red-400 rounded-lg transition-colors"
                    >
                      <Ban size={13} className={signaling === 'ctrl-c' ? 'animate-pulse' : ''} />
                    </button>
                  </div>
                  {controlError && <p className="text-xs text-red-400">{controlError}</p>}
                </>
              ) : (
                <p className="text-xs text-dark-600">Live control unavailable — agent is not currently running.</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default TerminalPanel;
