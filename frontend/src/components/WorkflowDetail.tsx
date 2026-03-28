import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Play, Pause, Trash2, Loader2,
  CheckCircle, Circle, AlertCircle, Clock, Bot,
} from 'lucide-react';
import { fetchWorkflow, startWorkflow, pauseWorkflow, deleteWorkflow } from '../api';

const stepIcons: Record<string, typeof CheckCircle> = {
  completed: CheckCircle,
  running: Loader2,
  failed: AlertCircle,
  pending: Circle,
  skipped: Circle,
};

const stepColors: Record<string, string> = {
  completed: 'text-green-400',
  running: 'text-lumi-400',
  failed: 'text-red-400',
  pending: 'text-dark-500',
  skipped: 'text-dark-600',
};

export default function WorkflowDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [workflow, setWorkflow] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      const data = await fetchWorkflow(id);
      setWorkflow(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workflow');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleStart = async () => {
    if (!id) return;
    setActionLoading('start');
    try { await startWorkflow(id); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to start'); }
    finally { setActionLoading(null); }
  };

  const handlePause = async () => {
    if (!id) return;
    setActionLoading('pause');
    try { await pauseWorkflow(id); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to pause'); }
    finally { setActionLoading(null); }
  };

  const handleDelete = async () => {
    if (!id || !confirm('Delete this workflow? This cannot be undone.')) return;
    setActionLoading('delete');
    try { await deleteWorkflow(id); navigate('/workflows'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to delete'); setActionLoading(null); }
  };

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center justify-center py-16 text-dark-500">
          <Loader2 size={20} className="animate-spin mr-2" /> Loading workflow...
        </div>
      </div>
    );
  }

  if (error && !workflow) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <button onClick={() => navigate('/workflows')} className="flex items-center gap-2 text-dark-400 hover:text-dark-100 mb-6 transition-colors">
          <ArrowLeft size={18} /> Back to Workflows
        </button>
        <div className="p-4 bg-red-900/30 border border-red-700/50 rounded-xl text-red-300 text-sm">{error}</div>
      </div>
    );
  }

  if (!workflow) return null;

  const steps: any[] = workflow.steps ?? [];
  const canStart = ['pending', 'paused'].includes(workflow.status);
  const canPause = workflow.status === 'running';
  const canDelete = !['running'].includes(workflow.status);

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <button
        onClick={() => navigate('/workflows')}
        className="flex items-center gap-2 text-dark-400 hover:text-dark-100 mb-6 transition-colors"
      >
        <ArrowLeft size={18} />
        <span>Back to Workflows</span>
      </button>

      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">{error}</div>
      )}

      {/* Header */}
      <div className="bg-dark-900 border border-dark-700 rounded-xl p-6 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-dark-100">{workflow.name}</h1>
            <div className="flex items-center gap-4 mt-2 text-sm">
              <span className={`capitalize ${
                workflow.status === 'completed' ? 'text-green-400' :
                workflow.status === 'running' ? 'text-lumi-400' :
                workflow.status === 'failed' ? 'text-red-400' :
                'text-yellow-400'
              }`}>
                {workflow.status}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {canStart && (
              <button
                onClick={handleStart}
                disabled={actionLoading !== null}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
              >
                {actionLoading === 'start' ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                Start
              </button>
            )}
            {canPause && (
              <button
                onClick={handlePause}
                disabled={actionLoading !== null}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
              >
                {actionLoading === 'pause' ? <Loader2 size={14} className="animate-spin" /> : <Pause size={14} />}
                Pause
              </button>
            )}
            {canDelete && (
              <button
                onClick={handleDelete}
                disabled={actionLoading !== null}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-dark-800 hover:bg-dark-700 disabled:opacity-50 text-red-400 text-sm rounded-lg border border-dark-600 transition-colors"
              >
                {actionLoading === 'delete' ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                Delete
              </button>
            )}
          </div>
        </div>

        {/* Dates */}
        <div className="flex flex-wrap gap-x-6 gap-y-1 mt-4 text-xs text-dark-500">
          <span>Created: {new Date(workflow.created_at).toLocaleString()}</span>
          {workflow.started_at && <span>Started: {new Date(workflow.started_at).toLocaleString()}</span>}
          {workflow.completed_at && <span>Completed: {new Date(workflow.completed_at).toLocaleString()}</span>}
        </div>
      </div>

      {/* Pipeline Steps */}
      <div className="bg-dark-900 border border-dark-700 rounded-xl p-6">
        <h2 className="text-sm font-semibold text-dark-300 uppercase tracking-wide mb-4">Pipeline Steps</h2>
        {steps.length === 0 ? (
          <p className="text-sm text-dark-500 text-center py-4">No steps defined</p>
        ) : (
          <div className="space-y-0">
            {steps.map((step: any, idx: number) => {
              const status = step.status ?? 'pending';
              const StepIcon = stepIcons[status] ?? Circle;
              const iconColor = stepColors[status] ?? 'text-dark-500';
              const isLast = idx === steps.length - 1;

              return (
                <div key={step.id ?? idx} className="flex gap-4">
                  {/* Vertical line + icon */}
                  <div className="flex flex-col items-center">
                    <div className={`p-1 ${iconColor}`}>
                      <StepIcon size={18} className={status === 'running' ? 'animate-spin' : ''} />
                    </div>
                    {!isLast && <div className="w-px flex-1 bg-dark-700 my-1" />}
                  </div>
                  {/* Step info */}
                  <div className={`pb-${isLast ? '0' : '4'} flex-1 min-w-0`}>
                    <p className="text-sm text-dark-100 font-medium">{step.name ?? `Step ${idx + 1}`}</p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-dark-500">
                      <span className="capitalize">{status}</span>
                      {step.agent_id && (
                        <span className="flex items-center gap-1 text-dark-400">
                          <Bot size={11} /> {step.agent_id}
                        </span>
                      )}
                      {step.trigger && (
                        <span className="flex items-center gap-1 text-dark-500">
                          <Clock size={11} /> {step.trigger}
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
    </div>
  );
}
