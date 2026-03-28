import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Plus, Loader2, FolderKanban, Users, Clock,
  X,
} from 'lucide-react';
import { fetchProjects, createProject } from '../api';
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
        />
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-dark-500">
          <Loader2 size={20} className="animate-spin mr-2" />
          Loading projects...
        </div>
      ) : error ? (
        <div className="p-4 bg-red-900/30 border border-red-700/50 rounded-xl text-red-300 text-sm">
          {error}
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-16">
          <FolderKanban size={40} className="mx-auto text-dark-600 mb-4" />
          <p className="text-dark-400 mb-2">No projects yet</p>
          <p className="text-dark-600 text-sm">Create a project to coordinate multiple agents on a shared goal.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((proj) => {
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
      )}
    </div>
  );
}

/* ---------- Create Project Dialog ---------- */

interface CreateDialogProps {
  onClose: () => void;
  onCreated: () => void;
}

function CreateProjectDialog({ onClose, onCreated }: CreateDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [folderPath, setFolderPath] = useState('');
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [maxConcurrent, setMaxConcurrent] = useState(4);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await createProject({
        name: name.trim(),
        description: description.trim(),
        folder_path: folderPath.trim(),
        max_concurrent: maxConcurrent,
      });
      onCreated();
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
            <label className="block text-xs text-dark-400 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-200 placeholder-dark-500 focus:outline-none focus:border-lumi-500 transition-colors resize-none"
              placeholder="What this project is about..."
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

          <div>
            <label className="block text-xs text-dark-400 mb-1">Max Concurrent Agents</label>
            <input
              type="number"
              value={maxConcurrent}
              onChange={(e) => setMaxConcurrent(parseInt(e.target.value, 10) || 1)}
              min={1}
              max={20}
              className="w-24 px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-200 focus:outline-none focus:border-lumi-500 transition-colors"
            />
          </div>

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
              disabled={submitting || !name.trim()}
              className="px-4 py-2 bg-lumi-600 hover:bg-lumi-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
            >
              {submitting ? (
                <span className="flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" />
                  Creating...
                </span>
              ) : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
