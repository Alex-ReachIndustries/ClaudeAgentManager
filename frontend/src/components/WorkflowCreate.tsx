import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Loader2, GripVertical } from 'lucide-react';
import { createWorkflow } from '../api';

interface StepDraft {
  key: number;
  name: string;
  folder_path: string;
  prompt: string;
  trigger: 'on_complete' | 'manual';
  condition: string;
}

let nextKey = 1;

function emptyStep(): StepDraft {
  return {
    key: nextKey++,
    name: '',
    folder_path: '',
    prompt: '',
    trigger: 'on_complete',
    condition: '',
  };
}

export default function WorkflowCreate() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [steps, setSteps] = useState<StepDraft[]>([emptyStep()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addStep = () => setSteps((prev) => [...prev, emptyStep()]);

  const removeStep = (key: number) => {
    setSteps((prev) => prev.filter((s) => s.key !== key));
  };

  const updateStep = (key: number, field: keyof StepDraft, value: string) => {
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, [field]: value } : s)));
  };

  const handleSubmit = async () => {
    if (!name.trim()) return;
    if (steps.length === 0) return;
    const validSteps = steps.filter((s) => s.name.trim());
    if (validSteps.length === 0) return;

    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        steps: validSteps.map((s) => ({
          name: s.name.trim(),
          folder_path: s.folder_path.trim() || undefined,
          prompt: s.prompt.trim() || undefined,
          trigger: s.trigger,
          condition: s.condition.trim() || undefined,
        })),
      };
      await createWorkflow(payload);
      navigate('/workflows');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workflow');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <button
        onClick={() => navigate('/workflows')}
        className="flex items-center gap-2 text-dark-400 hover:text-dark-100 mb-6 transition-colors"
      >
        <ArrowLeft size={18} />
        <span>Back to Workflows</span>
      </button>

      <h1 className="text-2xl font-semibold text-dark-100 mb-8">New Workflow</h1>

      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">{error}</div>
      )}

      {/* Workflow name */}
      <div className="bg-dark-900 border border-dark-700 rounded-xl p-6 mb-6">
        <label className="text-sm text-dark-300 mb-2 block">Workflow Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Deploy Pipeline"
          className="w-full px-4 py-2.5 bg-dark-800 border border-dark-600 rounded-lg text-dark-100 text-sm placeholder-dark-500 focus:outline-none focus:border-lumi-500"
        />
      </div>

      {/* Steps */}
      <div className="bg-dark-900 border border-dark-700 rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-dark-300 uppercase tracking-wide">Steps</h2>
          <button
            onClick={addStep}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-dark-800 hover:bg-dark-700 text-dark-300 text-sm rounded-lg border border-dark-600 transition-colors"
          >
            <Plus size={14} />
            Add Step
          </button>
        </div>

        {steps.length === 0 ? (
          <p className="text-sm text-dark-500 text-center py-4">Add at least one step to the workflow.</p>
        ) : (
          <div className="space-y-4">
            {steps.map((step, idx) => (
              <div key={step.key} className="p-4 bg-dark-800 border border-dark-700 rounded-lg">
                <div className="flex items-center gap-2 mb-3">
                  <GripVertical size={14} className="text-dark-600" />
                  <span className="text-xs text-dark-500 font-medium">Step {idx + 1}</span>
                  <div className="flex-1" />
                  {steps.length > 1 && (
                    <button
                      onClick={() => removeStep(step.key)}
                      className="p-1 text-dark-500 hover:text-red-400 transition-colors"
                      title="Remove step"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-dark-400 mb-1 block">Name</label>
                    <input
                      type="text"
                      value={step.name}
                      onChange={(e) => updateStep(step.key, 'name', e.target.value)}
                      placeholder="Step name"
                      className="w-full px-3 py-2 bg-dark-900 border border-dark-600 rounded-lg text-dark-100 text-sm placeholder-dark-500 focus:outline-none focus:border-lumi-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-dark-400 mb-1 block">Folder Path</label>
                    <input
                      type="text"
                      value={step.folder_path}
                      onChange={(e) => updateStep(step.key, 'folder_path', e.target.value)}
                      placeholder="/path/to/project"
                      className="w-full px-3 py-2 bg-dark-900 border border-dark-600 rounded-lg text-dark-100 text-sm placeholder-dark-500 focus:outline-none focus:border-lumi-500"
                    />
                  </div>
                </div>
                <div className="mt-3">
                  <label className="text-xs text-dark-400 mb-1 block">Prompt</label>
                  <textarea
                    value={step.prompt}
                    onChange={(e) => updateStep(step.key, 'prompt', e.target.value)}
                    placeholder="Instructions for the agent..."
                    rows={2}
                    className="w-full px-3 py-2 bg-dark-900 border border-dark-600 rounded-lg text-dark-100 text-sm placeholder-dark-500 resize-none focus:outline-none focus:border-lumi-500"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                  <div>
                    <label className="text-xs text-dark-400 mb-1 block">Trigger</label>
                    <select
                      value={step.trigger}
                      onChange={(e) => updateStep(step.key, 'trigger', e.target.value)}
                      className="w-full px-3 py-2 bg-dark-900 border border-dark-600 rounded-lg text-dark-100 text-sm focus:outline-none focus:border-lumi-500"
                    >
                      <option value="on_complete">On Complete</option>
                      <option value="manual">Manual</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-dark-400 mb-1 block">Condition (optional)</label>
                    <input
                      type="text"
                      value={step.condition}
                      onChange={(e) => updateStep(step.key, 'condition', e.target.value)}
                      placeholder="e.g. previous.exit_code === 0"
                      className="w-full px-3 py-2 bg-dark-900 border border-dark-600 rounded-lg text-dark-100 text-sm placeholder-dark-500 focus:outline-none focus:border-lumi-500"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Submit */}
      <div className="flex gap-3">
        <button
          onClick={handleSubmit}
          disabled={!name.trim() || steps.filter((s) => s.name.trim()).length === 0 || saving}
          className="flex items-center gap-2 px-5 py-2.5 bg-lumi-600 hover:bg-lumi-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          Create Workflow
        </button>
        <button
          onClick={() => navigate('/workflows')}
          className="px-5 py-2.5 bg-dark-800 hover:bg-dark-700 text-dark-300 text-sm rounded-lg transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
