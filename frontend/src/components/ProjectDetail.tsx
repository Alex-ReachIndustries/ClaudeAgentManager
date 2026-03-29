import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Play, Pause, CheckCircle2, Trash2, Loader2,
  Send, Milestone, Info, AlertTriangle, AlertCircle,
  Bot, Clock, FileText, Download, MessageSquare,
} from 'lucide-react';
import {
  fetchProject, fetchProjectAgents, fetchProjectUpdates,
  startProject, pauseProject, completeProject, deleteProject,
  sendMessage, fetchMessages, fetchProjectFiles,
} from '../api';
import type { AgentMessage } from '../types';
import { formatDate, timeAgo } from '../utils/time';

type ProjectStatus = 'pending' | 'active' | 'paused' | 'completed' | 'failed';
type TabId = 'info' | 'agents' | 'communication' | 'timeline' | 'files';

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

const tabs: { id: TabId; label: string }[] = [
  { id: 'info', label: 'Info' },
  { id: 'agents', label: 'Agents' },
  { id: 'communication', label: 'Messages' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'files', label: 'Files' },
];

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<any>(null);
  const [agents, setAgents] = useState<any[]>([]);
  const [updates, setUpdates] = useState<any[]>([]);
  const [files, setFiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [agentMessage, setAgentMessage] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>('info');

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      const [proj, agentsData, updatesData, filesData] = await Promise.all([
        fetchProject(id),
        fetchProjectAgents(id).catch(() => []),
        fetchProjectUpdates(id).catch(() => []),
        fetchProjectFiles(id).catch(() => []),
      ]);
      setProject(proj);
      const agentsList = Array.isArray(agentsData) ? agentsData : (agentsData?.data ?? []);
      setAgents(agentsList);
      const updatesList = Array.isArray(updatesData) ? updatesData : (updatesData?.data ?? []);
      setUpdates(updatesList);
      setFiles(Array.isArray(filesData) ? filesData : []);
      if (!selectedAgentId && proj.pm_agent_id) {
        setSelectedAgentId(proj.pm_agent_id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load project');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!id) return;
    const interval = setInterval(() => { load(); }, 15000);
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

  const handleSendToAgent = async () => {
    if (!selectedAgentId || !agentMessage.trim()) return;
    setSendingMessage(true);
    try {
      await sendMessage(selectedAgentId, agentMessage.trim());
      setAgentMessage('');
      loadAgentMessages(selectedAgentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSendingMessage(false);
    }
  };

  const loadAgentMessages = useCallback(async (agentId: string) => {
    try {
      const msgs = await fetchMessages(agentId);
      setAgentMessages(msgs);
    } catch {
      setAgentMessages([]);
    }
  }, []);

  useEffect(() => {
    if (selectedAgentId) {
      loadAgentMessages(selectedAgentId);
      const interval = setInterval(() => loadAgentMessages(selectedAgentId), 15000);
      return () => clearInterval(interval);
    }
  }, [selectedAgentId, loadAgentMessages]);

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

      {/* Compact header */}
      <div className="bg-dark-900 border border-dark-700 rounded-xl p-6 mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-wrap">
            <h1 className="text-xl font-semibold text-dark-100">{project.name}</h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-dark-850 rounded-full border border-dark-800">
              <span className={`w-2 h-2 rounded-full ${statusDot[st]} ${st === 'active' ? 'animate-pulse' : ''}`} />
              <span className={`text-xs font-medium ${statusTextColor[st]}`}>{statusLabel[st]}</span>
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {canStart && (
              <button
                onClick={() => {
                  const prompt = (document.getElementById('pm-prompt') as HTMLTextAreaElement)?.value || '';
                  handleAction('start', () => startProject(id!, prompt));
                }}
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

        {progress > 0 && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-dark-500 mb-1">
              <span>Progress</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <div className="w-full h-1.5 bg-dark-700 rounded-full overflow-hidden">
              <div className="h-full bg-lumi-500 rounded-full transition-all" style={{ width: `${Math.min(100, progress)}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-dark-700 mb-4 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
              activeTab === tab.id
                ? 'text-lumi-400 border-lumi-500'
                : 'text-dark-500 border-transparent hover:text-dark-300'
            }`}
          >
            {tab.label}
            {tab.id === 'agents' && agents.length > 0 && (
              <span className="ml-1.5 text-xs text-dark-500">({agents.length})</span>
            )}
            {tab.id === 'timeline' && updates.length > 0 && (
              <span className="ml-1.5 text-xs text-dark-500">({updates.length})</span>
            )}
            {tab.id === 'files' && files.length > 0 && (
              <span className="ml-1.5 text-xs text-dark-500">({files.length})</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="bg-dark-900 border border-dark-700 rounded-xl p-6">
        {/* ── Info tab ──────────────────────────────────────── */}
        {activeTab === 'info' && (
          <div>
            {project.description && (
              <p className="text-sm text-dark-300 mb-4">{project.description}</p>
            )}

            {canStart && (
              <div className="mb-4">
                <label className="block text-xs text-dark-400 mb-1">Initial Prompt for Project Manager</label>
                <textarea
                  id="pm-prompt"
                  rows={4}
                  className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-200 placeholder-dark-500 focus:outline-none focus:border-lumi-500 transition-colors resize-none"
                  placeholder="Describe the task for the project manager agent..."
                />
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-dark-500 mb-1">Status</p>
                <p className={`text-sm font-medium ${statusTextColor[st]}`}>{statusLabel[st]}</p>
              </div>
              <div>
                <p className="text-xs text-dark-500 mb-1">Agents</p>
                <p className="text-sm text-dark-200">{agents.filter((a: any) => ['active', 'working', 'idle', 'waiting-for-input'].includes(a.status)).length} active / {agents.length} total</p>
              </div>
              <div>
                <p className="text-xs text-dark-500 mb-1">Max Concurrent</p>
                <p className="text-sm text-dark-200">{project.max_concurrent ?? 4}</p>
              </div>
              <div>
                <p className="text-xs text-dark-500 mb-1">Files</p>
                <p className="text-sm text-dark-200">{files.length}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-dark-500 mt-4 pt-4 border-t border-dark-800">
              <span>Created: {formatDate(project.created_at)}</span>
              {project.started_at && <span>Started: {formatDate(project.started_at)}</span>}
              {project.completed_at && <span>Completed: {formatDate(project.completed_at)}</span>}
              {project.folder_path && <span>Path: {project.folder_path}</span>}
            </div>

            {project.pm_agent_id && (
              <div className="mt-4 pt-4 border-t border-dark-800">
                <p className="text-xs text-dark-500 mb-1">Project Manager</p>
                <button
                  onClick={() => navigate(`/agent/${project.pm_agent_id}`)}
                  className="text-sm text-lumi-400 hover:text-lumi-300 transition-colors"
                >
                  {project.pm_agent_id.slice(0, 8)}...
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Agents tab ────────────────────────────────────── */}
        {activeTab === 'agents' && (
          <div>
            {agents.length === 0 ? (
              <p className="text-sm text-dark-500 text-center py-8">No agents assigned to this project yet.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {agents.map((agent: any) => {
                  const aDot = agentStatusDot[agent.status] ?? 'bg-dark-500';
                  return (
                    <button
                      key={agent.id}
                      onClick={() => navigate(`/agent/${agent.id}`)}
                      className="bg-dark-800 border border-dark-600 rounded-lg p-4 text-left hover:border-dark-500 transition-colors focus:outline-none focus:ring-2 focus:ring-lumi-500/30"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`w-2 h-2 rounded-full ${aDot} ${['active', 'working'].includes(agent.status) ? 'animate-pulse' : ''}`} />
                        <span className="text-xs text-dark-400 capitalize">{agent.status}</span>
                        {agent.id === project.pm_agent_id && (
                          <span className="text-xs text-lumi-400 ml-auto font-medium">PM</span>
                        )}
                      </div>
                      {agent.role && <p className="text-xs text-lumi-400 font-medium mb-1">{agent.role}</p>}
                      <p className="text-sm text-dark-200 font-medium truncate">{agent.title || 'Untitled'}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedAgentId(agent.id);
                            setActiveTab('communication');
                          }}
                          className="text-xs text-dark-500 hover:text-lumi-400 transition-colors flex items-center gap-1"
                        >
                          <MessageSquare size={11} /> Message
                        </button>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Communication tab ─────────────────────────────── */}
        {activeTab === 'communication' && (
          <div>
            {agents.length > 0 ? (
              <div className="flex flex-col" style={{ maxHeight: '500px' }}>
                <select
                  value={selectedAgentId ?? ''}
                  onChange={(e) => setSelectedAgentId(e.target.value || null)}
                  className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-200 focus:outline-none focus:border-lumi-500 transition-colors mb-3"
                >
                  <option value="">Select agent...</option>
                  {agents.map((agent: any) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.id === project.pm_agent_id ? '⭐ PM: ' : ''}
                      {agent.role || agent.title || agent.id.slice(0, 8)}
                      {' '}({agent.status})
                    </option>
                  ))}
                </select>

                {selectedAgentId ? (
                  <>
                    <div className="flex-1 overflow-y-auto space-y-2 mb-3" style={{ maxHeight: '360px' }}>
                      {agentMessages.length === 0 ? (
                        <p className="text-xs text-dark-600 text-center py-8">No messages yet.</p>
                      ) : (
                        agentMessages.slice(-30).map((msg: AgentMessage) => (
                          <div
                            key={msg.id}
                            className={`px-3 py-2 rounded-lg text-sm ${
                              msg.source === 'user'
                                ? 'bg-lumi-600/20 border border-lumi-600/30 text-dark-200 ml-8'
                                : 'bg-dark-800 border border-dark-700 text-dark-300 mr-8'
                            }`}
                          >
                            <p className="break-words">{msg.content}</p>
                            <p className="text-xs text-dark-600 mt-1">
                              {msg.source === 'user' ? 'You' : 'Agent'} · {timeAgo(msg.created_at)}
                              {msg.status === 'pending' && ' · pending'}
                              {msg.status === 'delivered' && ' · delivered'}
                            </p>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={agentMessage}
                        onChange={(e) => setAgentMessage(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendToAgent(); } }}
                        placeholder="Message agent..."
                        className="flex-1 px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-200 placeholder-dark-500 focus:outline-none focus:border-lumi-500 transition-colors"
                      />
                      <button
                        onClick={handleSendToAgent}
                        disabled={sendingMessage || !agentMessage.trim()}
                        className="px-3 py-2 bg-lumi-600 hover:bg-lumi-500 disabled:opacity-50 text-white rounded-lg transition-colors"
                      >
                        {sendingMessage ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-dark-500 text-center py-8">Select an agent to send messages.</p>
                )}
              </div>
            ) : (
              <div className="text-center py-8">
                <AlertTriangle size={20} className="mx-auto text-dark-600 mb-2" />
                <p className="text-sm text-dark-500">No agents assigned yet.</p>
              </div>
            )}
          </div>
        )}

        {/* ── Timeline tab ──────────────────────────────────── */}
        {activeTab === 'timeline' && (
          <div>
            {updates.length === 0 ? (
              <p className="text-sm text-dark-500 text-center py-8">No updates yet.</p>
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
        )}

        {/* ── Files tab ─────────────────────────────────────── */}
        {activeTab === 'files' && (
          <div>
            {files.length === 0 ? (
              <p className="text-sm text-dark-500 text-center py-8">No files shared by agents yet.</p>
            ) : (
              <div className="space-y-2">
                {files.map((file: any) => (
                  <div key={file.id} className="flex items-center gap-3 px-3 py-2.5 bg-dark-800 border border-dark-700 rounded-lg hover:border-dark-600 transition-colors">
                    <FileText size={16} className="text-dark-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-dark-200 truncate">{file.filename}</p>
                      <div className="flex items-center gap-3 text-xs text-dark-500">
                        <span>{file.agent_role || 'Agent'}</span>
                        <span>{(file.size / 1024).toFixed(1)} KB</span>
                        {file.created_at && <span>{timeAgo(file.created_at)}</span>}
                        {file.description && <span className="truncate">{file.description}</span>}
                      </div>
                    </div>
                    <a
                      href={`/api/agents/${file.agent_id}/files/${file.id}`}
                      download={file.filename}
                      className="p-1.5 text-dark-400 hover:text-lumi-400 transition-colors"
                      title="Download"
                    >
                      <Download size={16} />
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
