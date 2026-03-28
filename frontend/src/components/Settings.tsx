import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Eye, EyeOff, Copy, Check, RotateCcw, Key,
  Webhook, Plus, Pencil, Trash2, Zap, X, Database, Play,
  Loader2, AlertTriangle,
} from 'lucide-react';
import {
  getStoredApiKey, setApiKey, rotateApiKey as apiRotateKey,
  fetchWebhooks, createWebhook, updateWebhook, deleteWebhook, testWebhook,
  fetchRetentionStatus, updateRetentionSettings, runRetention,
} from '../api';

// ---- Webhook types (local) ----
interface WebhookEntry {
  id: number;
  url: string;
  events: string[];
  active: boolean;
  failure_count: number;
}

const WEBHOOK_EVENTS = [
  'agent.completed',
  'agent.error',
  'agent.waiting',
  'agent.status_changed',
  'message.received',
] as const;

// ---- Retention types (local) ----
interface RetentionSettings {
  archive_retention_days: number;
  update_retention_days: number;
  message_retention_days: number;
  enabled: boolean;
  dry_run: boolean;
}

interface RetentionStatus {
  settings: RetentionSettings;
  last_run?: {
    ran_at: string;
    archived_deleted: number;
    updates_deleted: number;
    messages_deleted: number;
    dry_run: boolean;
  };
}

// ---- Toast helper ----
function Toast({ message, type, onClose }: { message: string; type: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div className={`fixed bottom-6 right-6 z-[100] px-4 py-3 rounded-lg border text-sm shadow-lg ${
      type === 'success'
        ? 'bg-green-900/80 border-green-700/60 text-green-200'
        : 'bg-red-900/80 border-red-700/60 text-red-200'
    }`}>
      {message}
    </div>
  );
}

export default function Settings() {
  const navigate = useNavigate();

  // --- Toast state ---
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // ============================================================
  // API Key State (unchanged)
  // ============================================================
  const [key, setKey] = useState(getStoredApiKey() || '');
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(!getStoredApiKey());
  const [rotating, setRotating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    if (!key.trim()) return;
    setApiKey(key.trim());
    setEditing(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRotate = async () => {
    if (!confirm('Rotate API key? All clients will need the new key.')) return;
    setRotating(true);
    setError(null);
    try {
      const newKey = await apiRotateKey();
      setKey(newKey);
      setShowKey(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rotate key');
    } finally {
      setRotating(false);
    }
  };

  // ============================================================
  // Webhooks State
  // ============================================================
  const [webhooks, setWebhooks] = useState<WebhookEntry[]>([]);
  const [webhooksLoading, setWebhooksLoading] = useState(true);
  const [webhookFormOpen, setWebhookFormOpen] = useState(false);
  const [webhookEditId, setWebhookEditId] = useState<number | null>(null);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookEvents, setWebhookEvents] = useState<string[]>([]);
  const [webhookSaving, setWebhookSaving] = useState(false);
  const [webhookTesting, setWebhookTesting] = useState<number | null>(null);

  const loadWebhooks = useCallback(async () => {
    try {
      setWebhooksLoading(true);
      const data = await fetchWebhooks();
      setWebhooks(data ?? []);
    } catch {
      setWebhooks([]);
    } finally {
      setWebhooksLoading(false);
    }
  }, []);

  useEffect(() => { loadWebhooks(); }, [loadWebhooks]);

  const resetWebhookForm = () => {
    setWebhookFormOpen(false);
    setWebhookEditId(null);
    setWebhookUrl('');
    setWebhookEvents([]);
  };

  const handleWebhookSave = async () => {
    if (!webhookUrl.trim() || webhookEvents.length === 0) return;
    setWebhookSaving(true);
    try {
      if (webhookEditId !== null) {
        await updateWebhook(webhookEditId, { url: webhookUrl.trim(), events: webhookEvents });
        setToast({ message: 'Webhook updated', type: 'success' });
      } else {
        await createWebhook(webhookUrl.trim(), webhookEvents);
        setToast({ message: 'Webhook created', type: 'success' });
      }
      resetWebhookForm();
      await loadWebhooks();
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Failed to save webhook', type: 'error' });
    } finally {
      setWebhookSaving(false);
    }
  };

  const handleWebhookEdit = (wh: WebhookEntry) => {
    setWebhookEditId(wh.id);
    setWebhookUrl(wh.url);
    setWebhookEvents([...wh.events]);
    setWebhookFormOpen(true);
  };

  const handleWebhookDelete = async (id: number) => {
    if (!confirm('Delete this webhook?')) return;
    try {
      await deleteWebhook(id);
      setToast({ message: 'Webhook deleted', type: 'success' });
      await loadWebhooks();
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Failed to delete webhook', type: 'error' });
    }
  };

  const handleWebhookTest = async (id: number) => {
    setWebhookTesting(id);
    try {
      await testWebhook(id);
      setToast({ message: 'Webhook test successful', type: 'success' });
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Webhook test failed', type: 'error' });
    } finally {
      setWebhookTesting(null);
    }
  };

  const toggleWebhookEvent = (event: string) => {
    setWebhookEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event],
    );
  };

  // ============================================================
  // Retention State
  // ============================================================
  const [retentionStatus, setRetentionStatus] = useState<RetentionStatus | null>(null);
  const [retentionLoading, setRetentionLoading] = useState(true);
  const [retentionForm, setRetentionForm] = useState<RetentionSettings>({
    archive_retention_days: 30,
    update_retention_days: 30,
    message_retention_days: 30,
    enabled: false,
    dry_run: true,
  });
  const [retentionSaving, setRetentionSaving] = useState(false);
  const [retentionRunning, setRetentionRunning] = useState(false);
  const [retentionRunResult, setRetentionRunResult] = useState<any>(null);

  const loadRetention = useCallback(async () => {
    try {
      setRetentionLoading(true);
      const data = await fetchRetentionStatus();
      setRetentionStatus(data);
      if (data?.settings) {
        setRetentionForm(data.settings);
      }
    } catch {
      // API may not exist yet
    } finally {
      setRetentionLoading(false);
    }
  }, []);

  useEffect(() => { loadRetention(); }, [loadRetention]);

  const handleRetentionSave = async () => {
    setRetentionSaving(true);
    try {
      await updateRetentionSettings(retentionForm);
      setToast({ message: 'Retention settings saved', type: 'success' });
      await loadRetention();
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Failed to save retention settings', type: 'error' });
    } finally {
      setRetentionSaving(false);
    }
  };

  const handleRetentionRun = async () => {
    setRetentionRunning(true);
    setRetentionRunResult(null);
    try {
      const result = await runRetention();
      setRetentionRunResult(result);
      setToast({ message: 'Retention run completed', type: 'success' });
      await loadRetention();
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Retention run failed', type: 'error' });
    } finally {
      setRetentionRunning(false);
    }
  };

  // ============================================================
  // Render
  // ============================================================
  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      <button
        onClick={() => navigate('/')}
        className="flex items-center gap-2 text-dark-400 hover:text-dark-100 mb-6 transition-colors"
      >
        <ArrowLeft size={18} />
        <span>Back to Dashboard</span>
      </button>

      <h1 className="text-2xl font-semibold text-dark-100 mb-8">Settings</h1>

      {/* ====== API Key Section ====== */}
      <div className="bg-dark-900 border border-dark-700 rounded-xl p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-lumi-600/20 rounded-lg">
            <Key size={20} className="text-lumi-400" />
          </div>
          <div>
            <h2 className="text-lg font-medium text-dark-100">API Key</h2>
            <p className="text-sm text-dark-400">Authentication key for all API requests</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">
            {error}
          </div>
        )}

        {saved && (
          <div className="mb-4 p-3 bg-green-900/30 border border-green-700/50 rounded-lg text-green-300 text-sm">
            API key saved successfully
          </div>
        )}

        <div className="space-y-4">
          {editing ? (
            <div className="space-y-3">
              <input
                type="text"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="Enter your API key"
                className="w-full px-4 py-2.5 bg-dark-800 border border-dark-600 rounded-lg text-dark-100 text-sm font-mono placeholder-dark-500 focus:outline-none focus:border-lumi-500"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  disabled={!key.trim()}
                  className="px-4 py-2 bg-lumi-600 hover:bg-lumi-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors"
                >
                  Save Key
                </button>
                {getStoredApiKey() && (
                  <button
                    onClick={() => { setKey(getStoredApiKey() || ''); setEditing(false); }}
                    className="px-4 py-2 bg-dark-800 hover:bg-dark-700 text-dark-300 text-sm rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="flex-1 px-4 py-2.5 bg-dark-800 border border-dark-700 rounded-lg text-sm font-mono text-dark-300 overflow-hidden">
                  {showKey ? key : '\u2022'.repeat(Math.min(key.length, 40))}
                </div>
                <button
                  onClick={() => setShowKey(!showKey)}
                  className="p-2.5 bg-dark-800 hover:bg-dark-700 border border-dark-700 rounded-lg text-dark-400 hover:text-dark-200 transition-colors"
                  title={showKey ? 'Hide key' : 'Show key'}
                >
                  {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
                <button
                  onClick={handleCopy}
                  className="p-2.5 bg-dark-800 hover:bg-dark-700 border border-dark-700 rounded-lg text-dark-400 hover:text-dark-200 transition-colors"
                  title="Copy to clipboard"
                >
                  {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setEditing(true)}
                  className="px-4 py-2 bg-dark-800 hover:bg-dark-700 text-dark-300 text-sm rounded-lg transition-colors"
                >
                  Change Key
                </button>
                <button
                  onClick={handleRotate}
                  disabled={rotating}
                  className="flex items-center gap-2 px-4 py-2 bg-dark-800 hover:bg-dark-700 text-dark-300 text-sm rounded-lg transition-colors disabled:opacity-50"
                >
                  <RotateCcw size={14} className={rotating ? 'animate-spin' : ''} />
                  {rotating ? 'Rotating...' : 'Rotate Key'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ====== Webhooks Section ====== */}
      <div className="bg-dark-900 border border-dark-700 rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-lumi-600/20 rounded-lg">
              <Webhook size={20} className="text-lumi-400" />
            </div>
            <div>
              <h2 className="text-lg font-medium text-dark-100">Webhooks</h2>
              <p className="text-sm text-dark-400">HTTP callbacks for agent events</p>
            </div>
          </div>
          {!webhookFormOpen && (
            <button
              onClick={() => { resetWebhookForm(); setWebhookFormOpen(true); }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-lumi-600 hover:bg-lumi-500 text-white text-sm rounded-lg transition-colors"
            >
              <Plus size={14} />
              Add Webhook
            </button>
          )}
        </div>

        {/* Inline form */}
        {webhookFormOpen && (
          <div className="mb-4 p-4 bg-dark-800 border border-dark-700 rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-dark-200">
                {webhookEditId !== null ? 'Edit Webhook' : 'New Webhook'}
              </span>
              <button onClick={resetWebhookForm} className="text-dark-500 hover:text-dark-200 transition-colors">
                <X size={16} />
              </button>
            </div>
            <input
              type="text"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://example.com/webhook"
              className="w-full px-3 py-2 bg-dark-900 border border-dark-600 rounded-lg text-dark-100 text-sm placeholder-dark-500 focus:outline-none focus:border-lumi-500"
            />
            <div>
              <span className="text-xs text-dark-400 mb-1.5 block">Events</span>
              <div className="flex flex-wrap gap-2">
                {WEBHOOK_EVENTS.map((evt) => (
                  <label
                    key={evt}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs cursor-pointer border transition-colors ${
                      webhookEvents.includes(evt)
                        ? 'bg-lumi-600/20 border-lumi-500/40 text-lumi-300'
                        : 'bg-dark-900 border-dark-600 text-dark-400 hover:text-dark-200'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={webhookEvents.includes(evt)}
                      onChange={() => toggleWebhookEvent(evt)}
                      className="sr-only"
                    />
                    {evt}
                  </label>
                ))}
              </div>
            </div>
            <button
              onClick={handleWebhookSave}
              disabled={!webhookUrl.trim() || webhookEvents.length === 0 || webhookSaving}
              className="flex items-center gap-2 px-4 py-2 bg-lumi-600 hover:bg-lumi-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors"
            >
              {webhookSaving && <Loader2 size={14} className="animate-spin" />}
              {webhookEditId !== null ? 'Update' : 'Save'}
            </button>
          </div>
        )}

        {/* Webhook list */}
        {webhooksLoading ? (
          <div className="flex items-center justify-center py-6 text-dark-500 text-sm">
            <Loader2 size={16} className="animate-spin mr-2" /> Loading webhooks...
          </div>
        ) : webhooks.length === 0 ? (
          <p className="text-sm text-dark-500 text-center py-4">No webhooks configured</p>
        ) : (
          <div className="space-y-2">
            {webhooks.map((wh) => (
              <div key={wh.id} className="flex items-start gap-3 p-3 bg-dark-800 border border-dark-700 rounded-lg">
                <div className="mt-1.5">
                  <div className={`w-2 h-2 rounded-full ${wh.active ? 'bg-green-400' : 'bg-red-400'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-dark-200 font-mono truncate" title={wh.url}>
                    {wh.url.length > 50 ? wh.url.slice(0, 50) + '...' : wh.url}
                  </p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {wh.events.map((evt) => (
                      <span key={evt} className="px-1.5 py-0.5 bg-dark-900 border border-dark-600 rounded text-[10px] text-dark-400">
                        {evt}
                      </span>
                    ))}
                  </div>
                  {wh.failure_count > 0 && (
                    <span className="text-xs text-red-400 mt-1 inline-block">
                      {wh.failure_count} failure{wh.failure_count !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleWebhookEdit(wh)}
                    className="p-1.5 bg-dark-900 hover:bg-dark-700 border border-dark-600 rounded text-dark-400 hover:text-dark-200 transition-colors"
                    title="Edit"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => handleWebhookTest(wh.id)}
                    disabled={webhookTesting === wh.id}
                    className="p-1.5 bg-dark-900 hover:bg-dark-700 border border-dark-600 rounded text-dark-400 hover:text-dark-200 transition-colors disabled:opacity-50"
                    title="Test"
                  >
                    {webhookTesting === wh.id ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
                  </button>
                  <button
                    onClick={() => handleWebhookDelete(wh.id)}
                    className="p-1.5 bg-dark-900 hover:bg-dark-700 border border-dark-600 rounded text-red-400 hover:text-red-300 transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ====== Data Retention Section ====== */}
      <div className="bg-dark-900 border border-dark-700 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-lumi-600/20 rounded-lg">
            <Database size={20} className="text-lumi-400" />
          </div>
          <div>
            <h2 className="text-lg font-medium text-dark-100">Data Retention</h2>
            <p className="text-sm text-dark-400">Automatic cleanup of old data</p>
          </div>
        </div>

        {retentionLoading ? (
          <div className="flex items-center justify-center py-6 text-dark-500 text-sm">
            <Loader2 size={16} className="animate-spin mr-2" /> Loading retention settings...
          </div>
        ) : (
          <div className="space-y-4">
            {/* Number inputs */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-dark-400 mb-1 block">Archive retention (days)</label>
                <input
                  type="number"
                  min={1}
                  value={retentionForm.archive_retention_days}
                  onChange={(e) => setRetentionForm((f) => ({ ...f, archive_retention_days: Number(e.target.value) }))}
                  className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-dark-100 text-sm focus:outline-none focus:border-lumi-500"
                />
              </div>
              <div>
                <label className="text-xs text-dark-400 mb-1 block">Update retention (days)</label>
                <input
                  type="number"
                  min={1}
                  value={retentionForm.update_retention_days}
                  onChange={(e) => setRetentionForm((f) => ({ ...f, update_retention_days: Number(e.target.value) }))}
                  className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-dark-100 text-sm focus:outline-none focus:border-lumi-500"
                />
              </div>
              <div>
                <label className="text-xs text-dark-400 mb-1 block">Message retention (days)</label>
                <input
                  type="number"
                  min={1}
                  value={retentionForm.message_retention_days}
                  onChange={(e) => setRetentionForm((f) => ({ ...f, message_retention_days: Number(e.target.value) }))}
                  className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-dark-100 text-sm focus:outline-none focus:border-lumi-500"
                />
              </div>
            </div>

            {/* Toggles */}
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={retentionForm.enabled}
                  onChange={(e) => setRetentionForm((f) => ({ ...f, enabled: e.target.checked }))}
                  className="w-4 h-4 rounded border-dark-600 bg-dark-800 text-lumi-600 focus:ring-lumi-500 focus:ring-offset-0"
                />
                <span className="text-sm text-dark-200">Enabled</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={retentionForm.dry_run}
                  onChange={(e) => setRetentionForm((f) => ({ ...f, dry_run: e.target.checked }))}
                  className="w-4 h-4 rounded border-dark-600 bg-dark-800 text-lumi-600 focus:ring-lumi-500 focus:ring-offset-0"
                />
                <span className="text-sm text-dark-200">Dry Run</span>
              </label>
            </div>

            {!retentionForm.dry_run && (
              <div className="flex items-start gap-2 p-3 bg-yellow-900/20 border border-yellow-700/40 rounded-lg">
                <AlertTriangle size={16} className="text-yellow-400 mt-0.5 shrink-0" />
                <p className="text-xs text-yellow-300">
                  Dry run is disabled. Running retention will permanently delete data that exceeds the retention period.
                </p>
              </div>
            )}

            {/* Buttons */}
            <div className="flex gap-2">
              <button
                onClick={handleRetentionSave}
                disabled={retentionSaving}
                className="flex items-center gap-2 px-4 py-2 bg-lumi-600 hover:bg-lumi-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
              >
                {retentionSaving && <Loader2 size={14} className="animate-spin" />}
                Save Settings
              </button>
              <button
                onClick={handleRetentionRun}
                disabled={retentionRunning}
                className="flex items-center gap-2 px-4 py-2 bg-dark-800 hover:bg-dark-700 disabled:opacity-50 text-dark-300 text-sm rounded-lg transition-colors"
              >
                {retentionRunning ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                Run Now
              </button>
            </div>

            {/* Run result */}
            {retentionRunResult && (
              <div className="p-3 bg-dark-800 border border-dark-700 rounded-lg text-sm space-y-1">
                <span className="text-dark-300 font-medium block mb-1">Run Results</span>
                <p className="text-dark-400">Archives deleted: <span className="text-dark-200">{retentionRunResult.archived_deleted ?? 0}</span></p>
                <p className="text-dark-400">Updates deleted: <span className="text-dark-200">{retentionRunResult.updates_deleted ?? 0}</span></p>
                <p className="text-dark-400">Messages deleted: <span className="text-dark-200">{retentionRunResult.messages_deleted ?? 0}</span></p>
                {retentionRunResult.dry_run && <p className="text-yellow-400 text-xs mt-1">(dry run - no data was actually deleted)</p>}
              </div>
            )}

            {/* Last run stats */}
            {retentionStatus?.last_run && (
              <div className="text-xs text-dark-500 border-t border-dark-700 pt-3">
                Last run: {new Date(retentionStatus.last_run.ran_at).toLocaleString()}
                {' '}&mdash;{' '}
                {retentionStatus.last_run.archived_deleted} archives,{' '}
                {retentionStatus.last_run.updates_deleted} updates,{' '}
                {retentionStatus.last_run.messages_deleted} messages deleted
                {retentionStatus.last_run.dry_run && ' (dry run)'}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
