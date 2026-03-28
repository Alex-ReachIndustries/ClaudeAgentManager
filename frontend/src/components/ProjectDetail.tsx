import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Play, Pause, CheckCircle2, Trash2, Loader2,
  Users, Send, Milestone, Info, AlertTriangle, AlertCircle,
  Bot, Clock,
} from 'lucide-react';
import {
  fetchProject, fetchProjectAgents, fetchProjectUpdates,
  startProject, pauseProject, completeProject, deleteProject,
  sendMessage,
} from '../api';
import { formatDate, timeAgo } from '../utils/time';

type ProjectStatus = 'pending' | 'active' | 'paused' | 'completed' | 'failed';

const statusDot: Record<ProjectStatus, string> = {
  pending: 'bg-gray-400',
  active: 'bg-green-400',
  paused: 'bg-yellow-400',
  completed: 'bg-blue-400',
  failed: 'bg-red-400',
};

const statusLabel: Record<ProjectStatus, string> = {
  pending: 'Pending',
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
  failed: 'Failed',
};

const statusTextColor: Record<ProjectStatus, string> = {
  pending: 'text-gray-400',
  active: 'text-green-400',
  paused: 'text-yellow-400',
  completed: 'text-blue-400',
  failed: 'text-red-400',
};

const agentStatusDot: Record<string, string> = {
  active: 'bg-green-400',
  working: 'bg-blue-400',
  idle: 'bg-yellow-400',
  'waiting-for-input': 'bg-orange-400',
  completed: 'bg-dark-500',
  archived: 'bg-dark-600',
};

const updateIcons: Record<string, typeof Milestone> = {
  milestone: Milestone,
  decision: CheckCircle2,
  info: Info,
  error: AlertCircle,
};

const updateIconColors: Record<string, string> = {
  milestone: 'text-lumi-400',
  decision: 'text-green-400',
  info: 'text-blue-400',
  error: 'text-red-400',
};

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<any>(null);
  const [agents, setAgents] = useState<any[]>([]);
  const [updates, setUpdates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [pmMessage, setPmMessage] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      const [proj, agentsData, updatesData] = await Promise.all([
        fetchProject(id),
        fetchProjectAgents(id).catch(() => []),
        fetchProjectUpdates(id).catch(() => []),
      ]);
      setProject(proj);
      const agentsList = Array.isArray(agentsData) ? agentsData : (agentsData?.data ?? []);
      setAgents(agentsList);
      const updatesList = Array.isArray(updatesData) ? updatesData : (updatesData?.data ?? []);
      setUpdates(updatesList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load project');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 15s
  useEffect(() => {
    if (!id) return;
    const interval = setInterval(() => {
      load();
    }, 15000);
    return () => clearInterval(interval);
  }, [id, load]);

  const handleAction = async (action: string, fn: () => Promise<unknown>) => {
    setActionLoading(action);
    try {
      await fn();
      if (action === 'delete') {
        navigate('/projects');
      } else {
        await load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleSendToPM = async () => {
    if (!project?.pm_agent_id || !pmMessage.trim()) return;
    setSendingMessage(true);
    try {
      await sendMessage(project.pm_agent_id, pmMessage.trim());
      setPmMessage('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSendingMessage(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center justify-center py-16 text-dark-500">
          <Loader2 size={20} className="animate-spin mr-2" /> Loading project...
        </div>
      </div>
    );
  }

  if (error && !project) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <button onClick={() => navigate('/projects')} className="flex items-center gap-2 text-dark-400 hover:text-dark-100 mb-6 transition-colors">
          <ArrowLeft size={18} /> Back to Projects
        </button>
        <div className="p-4 bg-red-900/30 border border-red-700/50 rounded-xl text-red-300 text-sm">{error}</div>
      </div>
    );
  }

  if (!project) return null;

  const st = (project.status ?? 'pending') as ProjectStatus;
  const canStart = ['pending', 'paused'].includes(st);
  const canPause = st === 'active';
  const canComplete = st === 'active';
  const canDelete = !['active'].includes(st);
  const progress = project.progress ?? 0;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <button
        onClick={() => navigate('/projects')}
        className="flex items-center gap-2 text-dark-400 hover:text-dark-100 mb-6 transition-colors"
      >
        <ArrowLeft size={18} />
        <span>Back to Projects</span>
      </button>

      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">{error}</div>
      )}

      {/* Header card */}
      <div className="bg-dark-900 border border-dark-700 rounded-xl p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <h1 className="text-xl font-semibold text-dark-100">{project.name}</h1>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-dark-850 rounded-full border border-dark-800">
                <span className={`w-2 h-2 rounded-full ${statusDot[st]} ${st === 'active' ? 'animate-pulse' : ''}`} />
                <span className={`text-xs font-medium ${statusTextColor[st]}`}>{statusLabel[st]}</span>
              </span>
            </div>
            {project.description && (
              <p className="text-sm text-dark-400 mb-3">{project.description}</p>
            )}
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-dark-500">
              <span>Created: {formatDate(project.created_at)}</span>
              {project.started_at && <span>Started: {formatDate(project.started_at)}</span>}
              {project.completed_at && <span>Completed: {formatDate(project.completed_at)}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {canStart && (
              <button
                onClick={() => handleAction('start', () => startProject(id!))}
                disabled={actionLoading !== null}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
              >
                {actionLoading === 'start' ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                Start
              </button>
            )}
            {canPause && (
              <button
                onClick={() => handleAction('pause', () => pauseProject(id!))}
                disabled={actionLoading !== null}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
              >
                {actionLoading === 'pause' ? <Loader2 size={14} className="animate-spin" /> : <Pause size={14} />}
                Pause
              </button>
            )}
            {canComplete && (
              <button
                onClick={() => handleAction('complete', () => completeProject(id!))}
                disabled={actionLoading !== null}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
              >
                {actionLoading === 'complete' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                Complete
              </button>
            )}
            {canDelete && (
              <button
                onClick={() => {
                  if (!confirm('Delete this project? This cannot be undone.')) return;
                  handleAction('delete', () => deleteProject(id!));
                }}
                disabled={actionLoading !== null}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-dark-800 hover:bg-dark-700 disabled:opacity-50 text-red-400 text-sm rounded-lg border border-dark-600 transition-colors"
              >
                {actionLoading === 'delete' ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                Delete
              </button>
            )}
          </div>
        </div>

        {/* Progress bar */}
        {progress > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-dark-500 mb-1">
              <span>Progress</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <div className="w-full h-2 bg-dark-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-lumi-500 rounded-full transition-all"
                style={{ width: `${Math.min(100, progress)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Agent Roster */}
      <div className="bg-dark-900 border border-dark-700 rounded-xl p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Users size={16} className="text-dark-400" />
          <h2 className="text-sm font-semibold text-dark-300 uppercase tracking-wide">Agent Roster</h2>
          <span className="text-xs text-dark-500">({agents.length})</span>
        </div>

        {agents.length === 0 ? (
          <p className="text-sm text-dark-500 text-center py-4">No agents assigned to this project yet.</p>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
            {agents.map((agent: any) => {
              const aDot = agentStatusDot[agent.status] ?? 'bg-dark-500';
              return (
                <button
                  key={agent.id}
                  onClick={() => navigate(`/agent/${agent.id}`)}
                  className="shrink-0 w-48 bg-dark-800 border border-dark-600 rounded-lg p-3 text-left hover:border-dark-500 transition-colors focus:outline-none focus:ring-2 focus:ring-lumi-500/30"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`w-2 h-2 rounded-full ${aDot} ${['active', 'working'].includes(agent.status) ? 'animate-pulse' : ''}`} />
                    <span className="text-xs text-dark-400 capitalize">{agent.status}</span>
                  </div>
                  {agent.role && (
                    <p className="text-xs text-lumi-400 font-medium mb-1 truncate">{agent.role}</p>
                  )}
                  <p className="text-sm text-dark-200 font-medium truncate">{agent.title || 'Untitled'}</p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Project Timeline */}
        <div className="lg:col-span-2 bg-dark-900 border border-dark-700 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-dark-300 uppercase tracking-wide mb-4">Project Timeline</h2>

          {updates.length === 0 ? (
            <p className="text-sm text-dark-500 text-center py-4">No updates yet.</p>
          ) : (
            <div className="space-y-0">
              {updates.map((upd: any, idx: number) => {
                const uType = upd.type ?? 'info';
                const UIcon = updateIcons[uType] ?? Info;
                const iconColor = updateIconColors[uType] ?? 'text-dark-500';
                const isLast = idx === updates.length - 1;

                return (
                  <div key={upd.id ?? idx} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className={`p-1 ${iconColor}`}>
                        <UIcon size={16} />
                      </div>
                      {!isLast && <div className="w-px flex-1 bg-dark-700 my-1" />}
                    </div>
                    <div className={`${isLast ? 'pb-0' : 'pb-4'} flex-1 min-w-0`}>
                      <p className="text-sm text-dark-200">{upd.content}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-dark-500">
                        <span className="capitalize">{uType}</span>
                        {upd.created_at && (
                          <span className="flex items-center gap-1">
                            <Clock size={11} />
                            {timeAgo(upd.created_at)}
                          </span>
                        )}
                        {upd.agent_id && (
                          <span className="flex items-center gap-1 text-dark-400">
                            <Bot size={11} />
                            {upd.agent_id.slice(0, 8)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Communication panel */}
        <div className="bg-dark-900 border border-dark-700 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-dark-300 uppercase tracking-wide mb-4">Communication</h2>

          {project.pm_agent_id ? (
            <div>
              <p className="text-xs text-dark-500 mb-3">
                Send a message to the PM agent
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={pmMessage}
                  onChange={(e) => setPmMessage(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendToPM(); } }}
                  placeholder="Message PM..."
                  className="flex-1 px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-200 placeholder-dark-500 focus:outline-none focus:border-lumi-500 transition-colors"
                />
                <button
                  onClick={handleSendToPM}
                  disabled={sendingMessage || !pmMessage.trim()}
                  className="px-3 py-2 bg-lumi-600 hover:bg-lumi-500 disabled:opacity-50 text-white rounded-lg transition-colors"
                >
                  {sendingMessage ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center py-4">
              <AlertTriangle size={20} className="mx-auto text-dark-600 mb-2" />
              <p className="text-sm text-dark-500">No PM agent assigned yet.</p>
              <p className="text-xs text-dark-600 mt-1">Start the project to spawn a PM agent.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
