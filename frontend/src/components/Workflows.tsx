import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Loader2, GitBranch } from 'lucide-react';
import { fetchWorkflows } from '../api';

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-400',
  running: 'bg-green-400',
  paused: 'bg-yellow-400',
  completed: 'bg-green-400',
  failed: 'bg-red-400',
};

const statusText: Record<string, string> = {
  pending: 'text-yellow-400',
  running: 'text-green-400',
  paused: 'text-yellow-400',
  completed: 'text-green-400',
  failed: 'text-red-400',
};

export default function Workflows() {
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchWorkflows();
      setWorkflows(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workflows');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 text-dark-400 hover:text-dark-100 transition-colors"
          >
            <ArrowLeft size={18} />
            <span>Back</span>
          </button>
          <h1 className="text-2xl font-semibold text-dark-100">Workflows</h1>
        </div>
        <button
          onClick={() => navigate('/workflows/new')}
          className="flex items-center gap-1.5 px-4 py-2 bg-lumi-600 hover:bg-lumi-500 text-white text-sm rounded-lg transition-colors"
        >
          <Plus size={16} />
          New Workflow
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-dark-500">
          <Loader2 size={20} className="animate-spin mr-2" />
          Loading workflows...
        </div>
      ) : error ? (
        <div className="p-4 bg-red-900/30 border border-red-700/50 rounded-xl text-red-300 text-sm">
          {error}
        </div>
      ) : workflows.length === 0 ? (
        <div className="text-center py-16">
          <GitBranch size={40} className="mx-auto text-dark-600 mb-4" />
          <p className="text-dark-400 mb-2">No workflows yet</p>
          <p className="text-dark-600 text-sm">Create a workflow to orchestrate multi-step agent pipelines.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {workflows.map((wf) => {
            const steps: any[] = wf.steps ?? [];
            const completedSteps = steps.filter((s: any) => s.status === 'completed').length;
            const dotColor = statusColors[wf.status] ?? 'bg-dark-400';
            const txtColor = statusText[wf.status] ?? 'text-dark-400';

            return (
              <button
                key={wf.id}
                onClick={() => navigate(`/workflows/${wf.id}`)}
                className="w-full text-left bg-dark-900 border border-dark-700 rounded-xl p-5 hover:border-dark-600 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="text-dark-100 font-medium truncate">{wf.name}</h3>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="flex items-center gap-1.5 text-xs">
                        <span className={`w-2 h-2 rounded-full ${dotColor}`} />
                        <span className={txtColor}>{wf.status}</span>
                      </span>
                      <span className="text-xs text-dark-500">
                        {completedSteps}/{steps.length} steps
                      </span>
                    </div>
                  </div>
                  <span className="text-xs text-dark-500 shrink-0">
                    {new Date(wf.created_at).toLocaleDateString()}
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
