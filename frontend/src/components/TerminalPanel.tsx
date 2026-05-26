import { useState, useEffect, useRef } from 'react';
import { Terminal, ChevronDown, ChevronUp } from 'lucide-react';
import type { AgentUpdate } from '../types';

interface TerminalPanelProps {
  updates: AgentUpdate[];
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

function TerminalPanel({ updates }: TerminalPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!collapsed && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [updates.length, collapsed]);

  return (
    <div className="bg-dark-950 border border-dark-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-dark-900/60 transition-colors"
      >
        <span className="flex items-center gap-2 text-xs font-mono font-semibold text-dark-500 uppercase tracking-wider">
          <Terminal size={13} />
          Terminal Log
          <span className="text-dark-700 font-normal normal-case tracking-normal">({updates.length})</span>
        </span>
        {collapsed ? <ChevronDown size={13} className="text-dark-600" /> : <ChevronUp size={13} className="text-dark-600" />}
      </button>

      {!collapsed && (
        <div
          ref={scrollRef}
          className="max-h-56 overflow-y-auto bg-dark-950 px-3 py-2 font-mono text-xs space-y-0.5"
        >
          {updates.length === 0 ? (
            <p className="text-dark-700 py-2 text-center">No entries</p>
          ) : (
            updates.map(u => {
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
            })
          )}
        </div>
      )}
    </div>
  );
}

export default TerminalPanel;
