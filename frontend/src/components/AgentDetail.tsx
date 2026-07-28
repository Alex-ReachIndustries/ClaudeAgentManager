import { useParams, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Calendar, Activity, Archive, ArchiveRestore, FileDown, Play, XCircle, MoreVertical, Trash2, Loader2, DollarSign } from 'lucide-react';
import { useAgent } from '../hooks/useAgent';
import { updateAgent, markAgentRead, createLaunchRequest, fetchAgentFiles, sendMessage, fetchRoles, fetchAgentCosts } from '../api';
import type { Role, AgentCostBreakdown } from '../api';
import type { AgentFile } from '../types';
import { formatDate } from '../utils/time';
import UpdateTimeline from './UpdateTimeline';
import MessagePanel from './MessagePanel';
import ProjectTodoPanel from './ProjectTodoPanel';
import PollDelayControl from './PollDelayControl';
import FilesPanel from './FilesPanel';
import TerminalPanel from './TerminalPanel';
import type { ProjectStatus, TodoStatus } from '../types';

const statusConfig = {
  active: { color: 'bg-green-400', label: 'Active' },
  working: { color: 'bg-blue-400', label: 'Working' },
  idle: { color: 'bg-yellow-400', label: 'Idle' },
  'waiting-for-input': { color: 'bg-orange-400', label: 'Waiting for Input' },
  archived: { color: 'bg-dark-600', label: 'Archived' },
  standby: { color: 'bg-purple-400', label: 'Standby' },
} as const;

const LIVE_STATUSES = new Set(['active', 'working', 'idle', 'waiting-for-input', 'standby']);

type DetailTab = 'conversation' | 'info' | 'costs';

function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { agent, updates, messages, loading, error, refetch, hasMoreHistory, isLoadingMore, loadMoreHistory } = useAgent(id!);

  const isArchived = agent?.status === 'archived';
  const isLive = agent ? LIVE_STATUSES.has(agent.status) : false;

  const [tab, setTab] = useState<DetailTab>('conversation');
  const [exporting, setExporting] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [terminating, setTerminating] = useState(false);
  const [files, setFiles] = useState<AgentFile[]>([]);
  const [roleInput, setRoleInput] = useState('');
  const [savingRole, setSavingRole] = useState(false);
  const [effortInput, setEffortInput] = useState('high');
  const [modelInput, setModelInput] = useState('claude-sonnet-4-6');
  const [savingSettings, setSavingSettings] = useState(false);
  const [wtWindowInput, setWtWindowInput] = useState('');
  const [savingWtWindow, setSavingWtWindow] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [roles, setRoles] = useState<Role[]>([]);
  const [costs, setCosts] = useState<AgentCostBreakdown | null>(null);
  const [costsError, setCostsError] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Fetch predefined roles once
  useEffect(() => {
    fetchRoles().then(setRoles).catch(() => {});
  }, []);

  // Fetch cost breakdown lazily, the first time the Costs tab is opened
  useEffect(() => {
    if (tab === 'costs' && id && costs === null && !costsError) {
      fetchAgentCosts(id).then(setCosts).catch(() => setCostsError(true));
    }
  }, [tab, id, costs, costsError]);

  // Fetch files for inline timeline display
  useEffect(() => {
    if (id) {
      fetchAgentFiles(id).then((data) => {
        setFiles(Array.isArray(data) ? data : []);
      }).catch(() => {});
    }
  }, [id, agent?.update_count]);

  // Sync role/effort/model/wt_window inputs when agent loads
  useEffect(() => {
    if (agent) {
      setRoleInput(agent.role ?? '');
      setEffortInput(agent.effort ?? 'high');
      setModelInput(agent.model ?? 'claude-sonnet-4-6');
      setWtWindowInput(agent.wt_window ?? '');
    }
  }, [agent?.role, agent?.effort, agent?.model, agent?.wt_window]);

  // Mark agent as read when viewing detail page
  useEffect(() => {
    if (id && agent) {
      markAgentRead(id).catch(() => {});
    }
  }, [id, agent?.update_count]);

  const handleToggleArchive = async () => {
    if (!id || !agent) return;
    setShowMenu(false);
    try {
      await updateAgent(id, { status: isArchived ? 'active' : 'archived' });
      refetch();
    } catch { /* ignore */ }
  };

  const handleResume = async () => {
    if (!id || !agent || resuming) return;
    setShowMenu(false);
    setResuming(true);
    try {
      const cwdPath = (agent.cwd || '').replace(/\\/g, '/');
      await createLaunchRequest('resume', cwdPath || agent.workspace || '', id, agent.wt_window || undefined);
    } catch (err) {
      console.error('Resume failed:', err);
    } finally {
      setResuming(false);
    }
  };

  const handleTerminate = async () => {
    if (!id || !agent?.pid || terminating) return;
    setShowMenu(false);
    setTerminating(true);
    try {
      await createLaunchRequest('terminate', '', undefined, undefined, agent.pid);
      refetch();
    } catch (err) {
      console.error('Terminate failed:', err);
    } finally {
      setTerminating(false);
    }
  };

  const handleTerminateResume = async () => {
    if (!id || !agent || resuming) return;
    setShowMenu(false);
    setResuming(true);
    try {
      const cwdPath = (agent.cwd || '').replace(/\\/g, '/');
      await createLaunchRequest('terminate-resume', cwdPath || agent.workspace || '', id, agent.wt_window || undefined, agent.pid);
    } catch (err) {
      console.error('Terminate & Resume failed:', err);
    } finally {
      setResuming(false);
    }
  };

  const handleExportPdf = async () => {
    if (!id || exporting) return;
    setExporting(true);
    try {
      const res = await fetch(`/api/agents/${id}/export/pdf`);
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Agent_Report_${id.slice(0, 8)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('PDF export failed:', err);
    } finally {
      setExporting(false);
      setShowMenu(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="animate-pulse">
          <div className="h-8 w-32 bg-dark-800 rounded mb-6" />
          <div className="h-10 w-64 bg-dark-800 rounded mb-4" />
          <div className="h-4 w-48 bg-dark-800 rounded mb-8" />
          <div className="h-96 bg-dark-900 rounded-xl border border-dark-800" />
        </div>
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-8">
        <button
          onClick={() => navigate('/')}
          className="inline-flex items-center gap-2 text-dark-400 hover:text-dark-200 mb-6 transition-colors"
        >
          <ArrowLeft size={16} />
          Back to dashboard
        </button>
        <div className="bg-red-950/30 border border-red-800/50 rounded-xl p-6 text-center">
          <p className="text-red-400">{error || 'Agent not found'}</p>
        </div>
      </div>
    );
  }

  const status = statusConfig[agent.status];

  let parsedProjects: ProjectStatus[] = [];
  let parsedTodos: TodoStatus[] = [];
  try {
    const raw = agent.metadata;
    const meta = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
    if (Array.isArray(meta.projects)) parsedProjects = meta.projects;
    if (Array.isArray(meta.todos)) parsedTodos = meta.todos;
  } catch { /* ignore parse errors */ }
  const projects = parsedProjects;
  const todos = parsedTodos;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
      {/* Back button */}
      <button
        onClick={() => navigate('/')}
        className="inline-flex items-center gap-2 text-dark-400 hover:text-dark-200 mb-4 sm:mb-6 transition-colors"
      >
        <ArrowLeft size={16} />
        Back to dashboard
      </button>

      {/* Agent header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
        <div className="min-w-0">
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-bold text-dark-50 truncate">{agent.title}</h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-dark-850 rounded-full border border-dark-800 shrink-0">
              <span className={`w-2 h-2 rounded-full ${status.color} ${agent.status === 'active' ? 'animate-pulse' : ''}`} />
              <span className="text-xs font-medium text-dark-300">{status.label}</span>
            </span>
            {agent.wt_window && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-dark-800 rounded-full border border-dark-700 shrink-0">
                <span className="text-xs text-dark-400">⊞ {agent.wt_window}</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-4 text-sm text-dark-500 flex-wrap">
            <span className="font-mono text-xs text-dark-600 select-all">{agent.id}</span>
            <span className="flex items-center gap-1.5">
              <Calendar size={14} />
              Created {formatDate(agent.created_at)}
            </span>
            <span className="flex items-center gap-1.5">
              <Activity size={14} />
              {agent.update_count} update{agent.update_count !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        {/* 3-dot action menu */}
        <div className="relative shrink-0" ref={menuRef}>
          <button
            onClick={() => setShowMenu((prev) => !prev)}
            className="p-2 text-dark-400 hover:text-dark-200 hover:bg-dark-800 rounded-lg transition-colors"
            title={exporting ? 'Exporting PDF…' : 'Agent actions'}
          >
            {exporting ? <Loader2 size={20} className="animate-spin text-lumi-400" /> : <MoreVertical size={20} />}
          </button>

          {showMenu && (
            <div className="absolute right-0 top-full mt-1 w-52 bg-dark-900 border border-dark-700 rounded-xl shadow-2xl z-50 overflow-hidden py-1">
              <button
                onClick={handleResume}
                disabled={resuming}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-dark-300 hover:text-green-400 hover:bg-green-950/20 transition-colors disabled:opacity-50"
              >
                <Play size={15} />
                {resuming ? 'Resuming…' : 'Resume'}
              </button>

              {isLive && agent.pid && (
                <button
                  onClick={handleTerminate}
                  disabled={terminating}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-dark-300 hover:text-red-400 hover:bg-red-950/20 transition-colors disabled:opacity-50"
                >
                  <XCircle size={15} />
                  {terminating ? 'Terminating…' : 'Terminate'}
                </button>
              )}

              {agent.pid && (
                <button
                  onClick={handleTerminateResume}
                  disabled={resuming || terminating}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-dark-300 hover:text-orange-400 hover:bg-orange-950/20 transition-colors disabled:opacity-50"
                >
                  <Trash2 size={15} />
                  Terminate &amp; Resume
                </button>
              )}

              <div className="border-t border-dark-800 my-1" />

              <button
                onClick={handleToggleArchive}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-dark-300 hover:text-yellow-400 hover:bg-yellow-950/20 transition-colors"
              >
                {isArchived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                {isArchived ? 'Unarchive' : 'Archive'}
              </button>

              <button
                onClick={handleExportPdf}
                disabled={exporting}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-dark-300 hover:text-lumi-400 hover:bg-lumi-950/20 transition-colors disabled:opacity-50"
              >
                <FileDown size={15} />
                {exporting ? 'Exporting…' : 'Export PDF'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-dark-800 mb-6">
        {(['conversation', 'info', 'costs'] as DetailTab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              tab === t
                ? 'text-lumi-300 border-lumi-500'
                : 'text-dark-500 border-transparent hover:text-dark-300 hover:border-dark-600'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Conversation tab */}
      {tab === 'conversation' && (
        <div className="space-y-4">
          <UpdateTimeline
            updates={updates}
            files={files}
            hasMore={hasMoreHistory}
            isLoadingMore={isLoadingMore}
            onLoadMore={loadMoreHistory}
          />
          <TerminalPanel updates={updates} />
          <MessagePanel agentId={agent.id} messages={messages} onSent={refetch} />
        </div>
      )}

      {/* Info tab */}
      {tab === 'info' && (
        <div className="space-y-4 max-w-2xl">
          {/* Agent Metrics */}
          {(() => {
            const createdMs = new Date(agent.created_at).getTime();
            const lastMs = new Date(agent.last_update_at).getTime();
            const diffSec = Math.max(0, Math.floor((lastMs - createdMs) / 1000));
            const durationParts: string[] = [];
            const dDays = Math.floor(diffSec / 86400);
            const dHrs = Math.floor((diffSec % 86400) / 3600);
            const dMins = Math.floor((diffSec % 3600) / 60);
            if (dDays > 0) durationParts.push(`${dDays}d`);
            if (dHrs > 0) durationParts.push(`${dHrs}h`);
            durationParts.push(`${dMins}m`);
            const sessionDuration = durationParts.join(' ');

            const pendingCount = messages.filter(m => m.status === 'pending').length;
            const deliveredCount = messages.filter(m => m.status === 'delivered').length;
            const ackCount = messages.filter(m => m.status === 'acknowledged' || m.status === 'executed').length;

            const MetricRow = ({ label, value }: { label: string; value: string }) => (
              <div className="flex justify-between items-baseline gap-4 py-1.5 border-b border-dark-800 last:border-0">
                <span className="text-xs text-dark-500 shrink-0">{label}</span>
                <span className="text-xs text-dark-300 font-mono text-right truncate">{value}</span>
              </div>
            );

            return (
              <div className="bg-dark-900 rounded-xl border border-dark-800 p-4">
                <h3 className="text-sm font-semibold text-dark-300 mb-3">Agent Metrics</h3>
                <div>
                  <MetricRow label="Agent ID" value={agent.id} />
                  <MetricRow label="Created" value={formatDate(agent.created_at)} />
                  <MetricRow label="Session Duration" value={sessionDuration} />
                  <MetricRow label="Total Updates" value={`${agent.update_count}`} />
                  <MetricRow label="Messages" value={`${messages.length} total (${pendingCount} pending, ${deliveredCount} delivered, ${ackCount} ack'd)`} />
                  {(agent.workspace || agent.cwd) && (
                    <MetricRow label="Workspace" value={agent.workspace || agent.cwd || ''} />
                  )}
                  {agent.pid != null && (
                    <MetricRow label="PID" value={`${agent.pid}`} />
                  )}
                  <MetricRow label="Status" value={statusConfig[agent.status]?.label ?? agent.status} />
                </div>
              </div>
            );
          })()}

          {/* Role */}
          <div className="bg-dark-900 rounded-xl border border-dark-800 p-4">
            <h3 className="text-sm font-semibold text-dark-300 mb-3">Role</h3>
            {roles.length > 0 && (
              <div className="mb-3">
                <label className="text-xs text-dark-500 mb-1 block">Predefined roles</label>
                <select
                  defaultValue=""
                  onChange={e => {
                    const picked = roles.find(r => r.id === e.target.value);
                    if (picked) setRoleInput(picked.fullDefinition);
                  }}
                  className="w-full bg-dark-800 border border-dark-700 rounded-lg px-3 py-1.5 text-sm text-dark-200 focus:outline-none focus:border-dark-600"
                >
                  <option value="" disabled>Select a predefined role…</option>
                  {roles.map(r => (
                    <option key={r.id} value={r.id}>{r.displayName}</option>
                  ))}
                </select>
              </div>
            )}
            <label className="text-xs text-dark-500 mb-1 block">Custom role / definition</label>
            <textarea
              value={roleInput}
              onChange={e => setRoleInput(e.target.value)}
              rows={4}
              placeholder="Assign a role to this agent..."
              className="w-full bg-dark-800 border border-dark-700 rounded-lg px-3 py-2 text-sm text-dark-200 placeholder-dark-600 resize-none focus:outline-none focus:border-dark-600"
            />
            <button
              onClick={async () => {
                if (!id || savingRole) return;
                setSavingRole(true);
                try {
                  await updateAgent(id, { role: roleInput || undefined });
                  await sendMessage(id, `Your role has been updated to: "${roleInput}". Please follow this new role.`);
                  refetch();
                } catch (err) {
                  console.error('Role update failed:', err);
                } finally {
                  setSavingRole(false);
                }
              }}
              disabled={savingRole}
              className="mt-2 w-full px-3 py-1.5 text-xs font-medium bg-dark-800 hover:bg-dark-700 text-dark-300 hover:text-dark-100 rounded-lg border border-dark-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {savingRole ? 'Updating...' : 'Update Role'}
            </button>
          </div>

          {/* Launch settings */}
          <div className="bg-dark-900 rounded-xl border border-dark-800 p-4">
            <h3 className="text-sm font-semibold text-dark-300 mb-3">Launch Settings</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-dark-500 mb-1 block">Effort</label>
                <select
                  value={effortInput}
                  onChange={e => setEffortInput(e.target.value)}
                  className="w-full bg-dark-800 border border-dark-700 rounded-lg px-3 py-1.5 text-sm text-dark-200 focus:outline-none focus:border-dark-600"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-dark-500 mb-1 block">Model</label>
                <select
                  value={modelInput}
                  onChange={e => setModelInput(e.target.value)}
                  className="w-full bg-dark-800 border border-dark-700 rounded-lg px-3 py-1.5 text-sm text-dark-200 focus:outline-none focus:border-dark-600"
                >
                  <option value="claude-haiku-4-5-20251001">Haiku 4.5</option>
                  <option value="claude-sonnet-4-6">Sonnet 4.6</option>
                  <option value="claude-opus-4-6">Opus 4.6</option>
                </select>
              </div>
            </div>
            <button
              onClick={async () => {
                if (!id || savingSettings) return;
                setSavingSettings(true);
                try {
                  await updateAgent(id, { effort: effortInput, model: modelInput });
                  refetch();
                } catch (err) {
                  console.error('Settings update failed:', err);
                } finally {
                  setSavingSettings(false);
                }
              }}
              disabled={savingSettings}
              className="mt-3 w-full px-3 py-1.5 text-xs font-medium bg-dark-800 hover:bg-dark-700 text-dark-300 hover:text-dark-100 rounded-lg border border-dark-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {savingSettings ? 'Saving...' : 'Save Settings'}
            </button>
          </div>

          {/* Terminal Window grouping */}
          <div className="bg-dark-900 rounded-xl border border-dark-800 p-4">
            <h3 className="text-sm font-semibold text-dark-300 mb-3">Terminal Window</h3>
            <p className="text-xs text-dark-500 mb-2">
              Group this agent into a named terminal window. Agents sharing the same name open as tabs in the same window (Windows Terminal) or tmux session (Linux).
            </p>
            <input
              type="text"
              value={wtWindowInput}
              onChange={e => setWtWindowInput(e.target.value)}
              placeholder="e.g. assistants, DailyVacancy"
              className="w-full bg-dark-800 border border-dark-700 rounded-lg px-3 py-2 text-sm text-dark-200 placeholder-dark-600 focus:outline-none focus:border-dark-600"
            />
            {agent.pool_slot != null && (
              <p className="text-xs text-dark-600 mt-1">Pool slot: {agent.pool_slot}</p>
            )}
            <button
              onClick={async () => {
                if (!id || savingWtWindow) return;
                setSavingWtWindow(true);
                try {
                  await updateAgent(id, { wt_window: wtWindowInput || null });
                  refetch();
                } catch (err) {
                  console.error('wt_window update failed:', err);
                } finally {
                  setSavingWtWindow(false);
                }
              }}
              disabled={savingWtWindow}
              className="mt-2 w-full px-3 py-1.5 text-xs font-medium bg-dark-800 hover:bg-dark-700 text-dark-300 hover:text-dark-100 rounded-lg border border-dark-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {savingWtWindow ? 'Saving...' : 'Save Window'}
            </button>
          </div>

          <PollDelayControl agentId={agent.id} currentDelay={agent.poll_delay_until} onUpdated={refetch} />
          <ProjectTodoPanel projects={projects} todos={todos} />
          <FilesPanel agentId={agent.id} />
        </div>
      )}

      {/* Costs tab */}
      {tab === 'costs' && (
        <div className="space-y-4 max-w-2xl">
          {costsError && (
            <div className="bg-red-950/30 border border-red-800/50 rounded-xl p-4 text-center text-sm text-red-400">
              Failed to load cost data.
            </div>
          )}
          {!costsError && !costs && (
            <div className="animate-pulse space-y-4">
              <div className="h-20 bg-dark-900 rounded-xl border border-dark-800" />
              <div className="h-40 bg-dark-900 rounded-xl border border-dark-800" />
            </div>
          )}
          {!costsError && costs && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <StatCard icon={<DollarSign size={13} />} label="Total Cost" value={formatUsd(costs.total.cost_usd)} />
                <StatCard icon={<Activity size={13} />} label="Input Tokens" value={costs.total.input_tokens.toLocaleString()} />
                <StatCard icon={<Activity size={13} />} label="Output Tokens" value={costs.total.output_tokens.toLocaleString()} />
              </div>

              <div className="bg-dark-900 rounded-xl border border-dark-800 p-4">
                <h3 className="text-sm font-semibold text-dark-300 mb-3">Cost by Task Label</h3>
                {costs.breakdown.length === 0 ? (
                  <p className="text-xs text-dark-500 py-4 text-center">No cost events recorded for this agent yet.</p>
                ) : (
                  <CostBreakdown rows={costs.breakdown} />
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Small stat tile — matches the KB Insights analytics visual language. */
function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="bg-dark-900 border border-dark-700 rounded-lg px-4 py-3">
      <div className="flex items-center gap-1.5 text-dark-500 text-[11px] mb-1">{icon}{label}</div>
      <div className="text-xl font-semibold text-dark-100">{value}</div>
    </div>
  );
}

function formatUsd(n: number): string {
  return `$${n.toFixed(n < 1 ? 4 : 2)}`;
}

/** Hand-rolled horizontal bar list, one row per task label, sorted by cost descending. */
function CostBreakdown({ rows }: { rows: AgentCostBreakdown['breakdown'] }) {
  const sorted = [...rows].sort((a, b) => b.cost_usd - a.cost_usd);
  const max = Math.max(1e-9, ...sorted.map(r => r.cost_usd));
  return (
    <div className="space-y-3">
      {sorted.map(row => (
        <div key={row.label}>
          <div className="flex justify-between items-baseline gap-2 mb-1">
            <span className="text-xs text-dark-300 truncate">{row.label}</span>
            <span className="text-xs text-dark-400 font-mono shrink-0">{formatUsd(row.cost_usd)}</span>
          </div>
          <div className="h-1.5 bg-dark-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-lumi-500 rounded-full"
              style={{ width: `${(row.cost_usd / max) * 100}%` }}
            />
          </div>
          <div className="text-[11px] text-dark-600 mt-1">
            {row.event_count} event{row.event_count !== 1 ? 's' : ''} · {(row.input_tokens + row.output_tokens).toLocaleString()} tokens
          </div>
        </div>
      ))}
    </div>
  );
}

export default AgentDetail;
