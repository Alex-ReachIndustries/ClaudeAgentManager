import { useParams, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { ArrowLeft, Calendar, Activity, Archive, ArchiveRestore, FileDown } from 'lucide-react';
import { useAgent } from '../hooks/useAgent';
import { updateAgent } from '../api';
import { formatDate } from '../utils/time';
import UpdateTimeline from './UpdateTimeline';
import MessagePanel from './MessagePanel';
import ProjectTodoPanel from './ProjectTodoPanel';
import PollDelayControl from './PollDelayControl';
import FilesPanel from './FilesPanel';
import type { ProjectStatus, TodoStatus } from '../types';

const statusConfig = {
  active: { color: 'bg-green-400', label: 'Active' },
  idle: { color: 'bg-yellow-400', label: 'Idle' },
  completed: { color: 'bg-dark-500', label: 'Completed' },
  archived: { color: 'bg-dark-600', label: 'Archived' },
} as const;

function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { agent, updates, messages, loading, error, refetch } = useAgent(id!);

  const isArchived = agent?.status === 'archived';
  const [exporting, setExporting] = useState(false);

  const handleToggleArchive = async () => {
    if (!id || !agent) return;
    try {
      await updateAgent(id, { status: isArchived ? 'active' : 'archived' });
      refetch();
    } catch {
      // Error will be shown through the hook
    }
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="animate-pulse">
          <div className="h-8 w-32 bg-dark-800 rounded mb-6" />
          <div className="h-10 w-64 bg-dark-800 rounded mb-4" />
          <div className="h-4 w-48 bg-dark-800 rounded mb-8" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 h-96 bg-dark-900 rounded-xl border border-dark-800" />
            <div className="h-96 bg-dark-900 rounded-xl border border-dark-800" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-8">
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
    <div className="max-w-7xl mx-auto px-6 py-8">
      {/* Back button */}
      <button
        onClick={() => navigate('/')}
        className="inline-flex items-center gap-2 text-dark-400 hover:text-dark-200 mb-6 transition-colors"
      >
        <ArrowLeft size={16} />
        Back to dashboard
      </button>

      {/* Agent header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-2xl font-bold text-dark-50">{agent.title}</h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-dark-850 rounded-full border border-dark-800">
              <span className={`w-2 h-2 rounded-full ${status.color} ${agent.status === 'active' ? 'animate-pulse' : ''}`} />
              <span className="text-xs font-medium text-dark-300">{status.label}</span>
            </span>
          </div>
          <div className="flex items-center gap-4 text-sm text-dark-500">
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

        <div className="flex items-center gap-2">
        <button
          onClick={async () => {
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
            }
          }}
          disabled={exporting}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm text-dark-500 hover:text-lumi-400 hover:bg-lumi-950/30 rounded-lg transition-colors disabled:opacity-50"
          title="Export as PDF"
        >
          <FileDown size={16} />
          <span className="text-xs">{exporting ? 'Exporting...' : 'PDF'}</span>
        </button>
        <button
          onClick={handleToggleArchive}
          className={`inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-colors ${
            isArchived
              ? 'text-dark-500 hover:text-green-400 hover:bg-green-950/30'
              : 'text-dark-500 hover:text-yellow-400 hover:bg-yellow-950/30'
          }`}
          title={isArchived ? 'Unarchive agent' : 'Archive agent'}
        >
          {isArchived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
          <span className="text-xs">{isArchived ? 'Unarchive' : 'Archive'}</span>
        </button>
        </div>
      </div>

      {/* Two-column layout — on mobile: messages, projects/todos, timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 order-3 lg:order-1">
          <UpdateTimeline updates={updates} />
        </div>
        <div className="order-1 lg:order-2 space-y-4">
          <MessagePanel agentId={agent.id} messages={messages} onSent={refetch} />
          <PollDelayControl agentId={agent.id} currentDelay={agent.poll_delay_until} onUpdated={refetch} />
        </div>
        <div className="lg:col-span-2 order-2 lg:order-3 space-y-4">
          <ProjectTodoPanel projects={projects} todos={todos} />
          <FilesPanel agentId={agent.id} />
        </div>
      </div>
    </div>
  );
}

export default AgentDetail;
