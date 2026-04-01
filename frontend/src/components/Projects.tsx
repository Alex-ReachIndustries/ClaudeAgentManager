import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Plus, Loader2, FolderKanban, Users, Clock,
  X, Search,
} from 'lucide-react';
import { fetchProjects, createProject, startProject } from '../api';
import { timeAgo } from '../utils/time';
import FolderPicker from './FolderPicker';

type ProjectStatus = 'pending' | 'active' | 'paused' | 'completed' | 'failed';

const statusDot: Record<ProjectStatus, string> = {
  pending: 'bg-gray-400',
  active: 'bg-green-400',
  paused: 'bg-yellow-400',
  completed: 'bg-blue-400',
  failed: 'bg-red-400',
};

const statusText: Record<ProjectStatus, string> = {
  pending: 'text-gray-400',
  active: 'text-green-400',
  paused: 'text-yellow-400',
  completed: 'text-blue-400',
  failed: 'text-red-400',
};

export default function Projects() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'name' | 'status'>('newest');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchProjects();
      setProjects(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 text-dark-400 hover:text-dark-100 transition-colors"
          >
            <ArrowLeft size={18} />
            <span>Back</span>
          </button>
          <h1 className="text-2xl font-semibold text-dark-100">Projects</h1>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-lumi-600 hover:bg-lumi-500 text-white text-sm rounded-lg transition-colors"
        >
          <Plus size={16} />
          New Project
        </button>
      </div>

      {showCreate && (
        <CreateProjectDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
          navigate={navigate}
        />
      )}

      {/* Search + filter + sort */}
      {!loading && projects.length > 0 && (
        <div className="mb-4 space-y-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search projects..."
              className="w-full pl-9 pr-3 py-2 bg-dark-900 border border-dark-700 rounded-lg text-sm text-dark-200 placeholder-dark-500 focus:outline-none focus:border-lumi-500 transition-colors"
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {['All', 'Active', 'Pending', 'Paused', 'Completed', 'Failed'].map((s) => {
              const isActive = (s === 'All' && !statusFilter) || s.toLowerCase() === statusFilter;
              return (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s === 'All' ? null : s.toLowerCase())}
                  className={`px-3 py-1 rounded-full text-xs transition-colors ${
                    isActive
                      ? 'bg-lumi-600/20 text-lumi-400 border border-lumi-600/30'
                      : 'bg-dark-800 text-dark-500 border border-dark-700 hover:text-dark-300'
                  }`}
                >
                  {s}
                </button>
              );
            })}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="ml-auto px-3 py-1 bg-dark-800 border border-dark-700 rounded-lg text-xs text-dark-400 focus:outline-none focus:border-lumi-500"
            >
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="name">Name</option>
              <option value="status">Status</option>
            </select>
          </div>
        </div>
      )}

      {(() => {
        let filtered = projects;
        if (statusFilter) filtered = filtered.filter((p) => p.status?.toLowerCase() === statusFilter);
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          filtered = filtered.filter((p) => p.name?.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q));
        }
        filtered = [...filtered].sort((a, b) => {
          switch (sortBy) {
            case 'newest': return (b.created_at ?? '').localeCompare(a.created_at ?? '');
            case 'oldest': return (a.created_at ?? '').localeCompare(b.created_at ?? '');
            case 'name': return (a.name ?? '').localeCompare(b.name ?? '');
            case 'status': return (a.status ?? '').localeCompare(b.status ?? '');
            default: return 0;
          }
        });

        if (loading) return (
          <div className="flex items-center justify-center py-16 text-dark-500">
            <Loader2 size={20} className="animate-spin mr-2" />
            Loading projects...
          </div>
        );
        if (error) return (
          <div className="p-4 bg-red-900/30 border border-red-700/50 rounded-xl text-red-300 text-sm">
            {error}
          </div>
        );
        if (filtered.length === 0) return (
          <div className="text-center py-16">
            <FolderKanban size={40} className="mx-auto text-dark-600 mb-4" />
            <p className="text-dark-400 mb-2">{projects.length === 0 ? 'No projects yet' : 'No matching projects'}</p>
            {projects.length === 0 && <p className="text-dark-600 text-sm">Create a project to coordinate multiple agents on a shared goal.</p>}
          </div>
        );
        return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((proj) => {
            const st = (proj.status ?? 'pending') as ProjectStatus;
            const dot = statusDot[st] ?? 'bg-dark-400';
            const txt = statusText[st] ?? 'text-dark-400';
            const agents: any[] = proj.agents ?? [];
            const activeAgents = agents.filter((a: any) => a.status === 'active' || a.status === 'working').length;
            const progress = proj.progress ?? 0;

            return (
              <button
                key={proj.id}
                onClick={() => navigate(`/projects/${proj.id}`)}
                className="bg-dark-900 border border-dark-700 rounded-xl p-5 text-left w-full hover:border-dark-600 transition-colors focus:outline-none focus:ring-2 focus:ring-lumi-500/30"
              >
                {/* Status badge */}
                <div className="flex items-center gap-2 mb-3">
                  <span className={`w-2.5 h-2.5 rounded-full ${dot} ${st === 'active' ? 'animate-pulse' : ''}`} />
                  <span className={`text-xs font-medium uppercase tracking-wide ${txt}`}>
                    {st}
                  </span>
                  {proj.pm_agent_id && (
                    <span className="ml-auto text-xs text-lumi-400 font-medium">PM</span>
                  )}
                </div>

                {/* Name */}
                <h3 className="text-lg font-bold text-dark-100 mb-1 truncate">{proj.name}</h3>

                {/* Description */}
                {proj.description && (
                  <p className="text-sm text-dark-400 italic line-clamp-2 mb-3 leading-relaxed">
                    {proj.description}
                  </p>
                )}

                {/* Progress bar */}
                {progress > 0 && (
                  <div className="w-full h-1.5 bg-dark-700 rounded-full mb-3 overflow-hidden">
                    <div
                      className="h-full bg-lumi-500 rounded-full transition-all"
                      style={{ width: `${Math.min(100, progress)}%` }}
                    />
                  </div>
                )}

                {/* Stats row */}
                <div className="flex items-center gap-4 text-xs text-dark-500">
                  <span className="flex items-center gap-1">
                    <Users size={12} />
                    {activeAgents}/{agents.length} agents
                  </span>
                  <span className="flex items-center gap-1 ml-auto">
                    <Clock size={12} />
                    {timeAgo(proj.created_at)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
        );
      })()}
    </div>
  );
}

/* ---------- Create Project Dialog ---------- */

interface CreateDialogProps {
  onClose: () => void;
  onCreated: () => void;
  navigate: (path: string) => void;
}

function CreateProjectDialog({ onClose, onCreated, navigate }: CreateDialogProps) {
  const [name, setName] = useState('');
  const [task, setTask] = useState('');
  const [folderPath, setFolderPath] = useState('');
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !task.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      // Create the project
      const project = await createProject({
        name: name.trim(),
        description: task.trim(),
        folder_path: folderPath.trim(),
      }) as { id: string };

      // Auto-start with a crafted PM prompt based on the task
      const pmPrompt = `Project: ${name.trim()}\n\nTask: ${task.trim()}\n\nAnalyse this task, break it into phases, and begin execution by spawning the appropriate sub-agents.`;
      await startProject(project.id, pmPrompt);

      onCreated();
      // Navigate to project detail
      navigate(`/projects/${project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-dark-900 border border-dark-700 rounded-xl p-6 w-full max-w-md mx-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-dark-100">New Project</h2>
          <button onClick={onClose} className="text-dark-500 hover:text-dark-300 transition-colors">
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-dark-400 mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-200 placeholder-dark-500 focus:outline-none focus:border-lumi-500 transition-colors"
              placeholder="My Project"
            />
          </div>

          <div>
            <label className="block text-xs text-dark-400 mb-1">Task *</label>
            <textarea
              value={task}
              onChange={(e) => setTask(e.target.value)}
              required
              rows={3}
              className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-200 placeholder-dark-500 focus:outline-none focus:border-lumi-500 transition-colors resize-none"
              placeholder="Describe what this project should accomplish..."
            />
          </div>

          <div>
            <label className="block text-xs text-dark-400 mb-1">Folder Path</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={folderPath}
                readOnly
                className="flex-1 px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-200 placeholder-dark-500"
                placeholder="Select a folder..."
              />
              <button
                type="button"
                onClick={() => setShowFolderPicker(true)}
                className="px-3 py-2 bg-dark-800 hover:bg-dark-700 border border-dark-600 rounded-lg text-sm text-dark-300 transition-colors"
              >
                Browse
              </button>
            </div>
          </div>

          <FolderPicker
            isOpen={showFolderPicker}
            onSelect={(path) => { setFolderPath(path); setShowFolderPicker(false); }}
            onClose={() => setShowFolderPicker(false)}
          />

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-dark-400 hover:text-dark-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !name.trim() || !task.trim()}
              className="px-4 py-2 bg-lumi-600 hover:bg-lumi-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
            >
              {submitting ? (
                <span className="flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" />
                  Starting...
                </span>
              ) : 'Create & Start'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
