import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, MessageSquare, Clock, Copy, Check, Folder, Bell, FolderKanban } from 'lucide-react';
import type { Agent } from '../types';
import { timeAgo } from '../utils/time';

const statusConfig = {
  active: { color: 'bg-green-400', label: 'Active' },
  working: { color: 'bg-blue-400', label: 'Working' },
  idle: { color: 'bg-yellow-400', label: 'Idle' },
  'waiting-for-input': { color: 'bg-orange-400', label: 'Waiting for Input' },
  archived: { color: 'bg-dark-600', label: 'Archived' },
  standby: { color: 'bg-purple-400', label: 'Standby' },
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
        <span className={`w-2.5 h-2.5 rounded-full ${status.color} ${['active', 'working'].includes(agent.status) ? 'animate-pulse' : ''}`} />
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
      <h3 className="text-lg font-bold text-dark-100 mb-1 truncate">{agent.title}</h3>

      {/* Project badge */}
      {agent.project_id && agent.role && (
        <p className="inline-flex items-center gap-1.5 px-2 py-0.5 mb-1 bg-lumi-600/10 border border-lumi-500/20 rounded-full text-xs text-lumi-400 truncate">
          <FolderKanban size={10} />
          <span className="truncate">{agent.project_name || 'Project'} · {agent.role_label ?? 'Custom'}</span>
        </p>
      )}

      {/* Workspace subtitle */}
      {agent.workspace && (
        <p className="flex items-center gap-1 text-xs text-dark-500 mb-2 truncate">
          <Folder size={11} />
          {agent.workspace}
        </p>
      )}

      {/* Detail text — prefer latest ack content, fall back to summary */}
      {(agent.latest_ack_content || agent.latest_summary) ? (
        <p className={`text-sm italic line-clamp-2 mb-4 leading-relaxed ${agent.latest_ack_content ? 'text-lumi-400' : 'text-dark-400'}`}>
          {agent.latest_ack_content || agent.latest_summary}
        </p>
      ) : (
        <p className="text-sm text-dark-600 italic mb-4">No updates yet</p>
      )}

      {/* Progress bar */}
      {(agent.progress ?? 0) > 0 && ['working', 'active'].includes(agent.status) && (
        <div className="mb-3">
          <div className="flex items-center justify-between text-xs text-dark-500 mb-1">
            <span>Progress</span>
            <span>{Math.round(agent.progress!)}%</span>
          </div>
          <div className="w-full h-1 bg-dark-700 rounded-full overflow-hidden">
            <div className="h-full bg-lumi-500 rounded-full transition-all" style={{ width: `${Math.min(100, agent.progress!)}%` }} />
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="flex items-center gap-4 text-xs text-dark-500">
        <span className="flex items-center gap-1">
          <Activity size={12} />
          {agent.update_count}
        </span>
        <span
          className={`flex items-center gap-1 ${agent.unread_update_count > 0 ? 'text-blue-400 font-medium' : ''}`}
          title="Unread updates"
        >
          <Bell size={12} />
          {agent.unread_update_count}
        </span>
        <span
          className={`flex items-center gap-1 ${agent.pending_message_count > 0 ? 'text-lumi-400 font-medium' : ''}`}
          title="Pending messages"
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
