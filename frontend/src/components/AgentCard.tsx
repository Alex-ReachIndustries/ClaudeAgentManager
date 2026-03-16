import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, MessageSquare, Clock, Copy, Check } from 'lucide-react';
import type { Agent } from '../types';
import { timeAgo } from '../utils/time';

const statusConfig = {
  active: { color: 'bg-green-400', label: 'Active' },
  idle: { color: 'bg-yellow-400', label: 'Idle' },
  completed: { color: 'bg-dark-500', label: 'Completed' },
  archived: { color: 'bg-dark-600', label: 'Archived' },
} as const;

interface AgentCardProps {
  agent: Agent;
}

function AgentCard({ agent }: AgentCardProps) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const status = statusConfig[agent.status];

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    const cmd = `claude --resume ${agent.id}`;
    navigator.clipboard.writeText(cmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button
      onClick={() => navigate(`/agent/${agent.id}`)}
      className="agent-card bg-dark-900 border border-dark-800 rounded-xl p-5 text-left w-full hover:border-dark-700 focus:outline-none focus:ring-2 focus:ring-lumi-500/30"
    >
      {/* Status badge + copy button */}
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-2.5 h-2.5 rounded-full ${status.color} ${agent.status === 'active' ? 'animate-pulse' : ''}`} />
        <span className="text-xs font-medium text-dark-400 uppercase tracking-wide">
          {status.label}
        </span>
        <span
          role="button"
          tabIndex={0}
          onClick={handleCopy}
          onKeyDown={(e) => { if (e.key === 'Enter') handleCopy(e as unknown as React.MouseEvent); }}
          className="ml-auto p-1 rounded hover:bg-dark-700 transition-colors"
          title="Copy resume command"
        >
          {copied ? (
            <Check size={14} className="text-green-400" />
          ) : (
            <Copy size={14} className="text-dark-500 hover:text-dark-300" />
          )}
        </span>
      </div>

      {/* Title */}
      <h3 className="text-lg font-bold text-dark-100 mb-2 truncate">{agent.title}</h3>

      {/* Latest summary */}
      {agent.latest_summary ? (
        <p className="text-sm text-dark-400 italic line-clamp-2 mb-4 leading-relaxed">
          {agent.latest_summary}
        </p>
      ) : (
        <p className="text-sm text-dark-600 italic mb-4">No updates yet</p>
      )}

      {/* Stats row */}
      <div className="flex items-center gap-4 text-xs text-dark-500">
        <span className="flex items-center gap-1">
          <Activity size={12} />
          {agent.update_count}
        </span>
        <span
          className={`flex items-center gap-1 ${agent.pending_message_count > 0 ? 'text-lumi-400 font-medium' : ''}`}
        >
          <MessageSquare size={12} />
          {agent.pending_message_count}
        </span>
        <span className="flex items-center gap-1 ml-auto">
          <Clock size={12} />
          {timeAgo(agent.last_update_at)}
        </span>
      </div>
    </button>
  );
}

export default AgentCard;
