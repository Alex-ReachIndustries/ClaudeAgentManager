import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Loader2, ClipboardCheck, Check, X, Pencil, Trash2,
  AlertTriangle, Bot, Tag, Server,
} from 'lucide-react';
import {
  fetchPendingKnowledge, decidePending, subscribeKnowledgePending,
} from '../api';
import Toast from './Toast';

function Chips({ items, icon: Icon }: { items?: string[] | null; icon: typeof Tag }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-1">
      {items.map((it) => (
        <span key={it} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-dark-800 border border-dark-700 text-dark-400">
          <Icon size={10} /> {it}
        </span>
      ))}
    </div>
  );
}

export default function PendingKnowledge() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | number | null>(null);
  const [editingId, setEditingId] = useState<string | number | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await fetchPendingKnowledge();
      setRows(Array.isArray(res?.data) ? res.data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pending queue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Live refresh on knowledge-pending SSE events
  useEffect(() => {
    const unsub = subscribeKnowledgePending(() => { load(); });
    return unsub;
  }, [load]);

  const decide = useCallback(async (
    id: string | number,
    decision: 'accept' | 'reject' | 'update',
    extra?: { edits?: any; note?: string },
  ) => {
    setActionId(id);
    try {
      await decidePending(id, { decision, decidedBy: 'human', ...extra });
      setToast({ message: `Proposal ${decision === 'reject' ? 'rejected' : decision === 'update' ? 'updated & approved' : 'accepted'}`, type: 'success' });
      setEditingId(null);
      await load();
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Decision failed', type: 'error' });
    } finally {
      setActionId(null);
    }
  }, [load]);

  const handleReject = (id: string | number) => {
    if (!confirm('Reject this proposal?')) return;
    const note = window.prompt('Optional note (why rejected)?') ?? undefined;
    decide(id, 'reject', note ? { note } : undefined);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => navigate('/knowledge')}
          className="flex items-center gap-2 text-dark-400 hover:text-dark-100 transition-colors"
        >
          <ArrowLeft size={18} />
          <span>Knowledge</span>
        </button>
        <h1 className="text-2xl font-semibold text-dark-100 flex items-center gap-2">
          <ClipboardCheck size={22} className="text-lumi-400" /> Pending Knowledge
          {rows.length > 0 && (
            <span className="ml-1 px-2 py-0.5 rounded-full text-xs bg-lumi-600/20 text-lumi-300 border border-lumi-600/30">
              {rows.length}
            </span>
          )}
        </h1>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16 text-dark-500">
          <Loader2 size={20} className="animate-spin mr-2" /> Loading queue...
        </div>
      )}
      {error && !loading && (
        <div className="p-4 bg-red-900/30 border border-red-700/50 rounded-xl text-red-300 text-sm">{error}</div>
      )}
      {!loading && !error && rows.length === 0 && (
        <div className="text-center py-16">
          <ClipboardCheck size={40} className="mx-auto text-dark-600 mb-4" />
          <p className="text-dark-400">Nothing to review — the queue is empty.</p>
        </div>
      )}

      <div className="space-y-4">
        {rows.map((row) => (
          editingId === row.id ? (
            <EditForm
              key={row.id}
              row={row}
              busy={actionId === row.id}
              onCancel={() => setEditingId(null)}
              onSave={(edits) => decide(row.id, 'update', { edits })}
            />
          ) : (
            <PendingCard
              key={row.id}
              row={row}
              busy={actionId === row.id}
              onAccept={() => decide(row.id, 'accept')}
              onUpdate={() => setEditingId(row.id)}
              onReject={() => handleReject(row.id)}
            />
          )
        ))}
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

/* ---------- Pending Card ---------- */
function PendingCard({ row, busy, onAccept, onUpdate, onReject }: {
  row: any; busy: boolean; onAccept: () => void; onUpdate: () => void; onReject: () => void;
}) {
  const conflicts: any[] = Array.isArray(row.conflict_flags) ? row.conflict_flags : [];
  const hasConflicts = conflicts.length > 0;
  const isEdit = row.kind === 'edit';
  const title = row.proposed_title ?? row.current_title ?? '(untitled)';

  return (
    <div className={`bg-dark-900 border rounded-xl p-5 ${hasConflicts ? 'border-yellow-700/50' : 'border-dark-700'}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${
              isEdit ? 'bg-blue-600/20 text-blue-300' : 'bg-green-600/20 text-green-300'
            }`}>
              {isEdit ? 'edit' : 'new'}
            </span>
            {row.review_flag ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-yellow-900/40 border border-yellow-700/50 text-yellow-300">
                <AlertTriangle size={10} /> flagged for review
              </span>
            ) : null}
          </div>
          <h3 className="text-lg font-semibold text-dark-100">{title}</h3>
          <div className="flex items-center gap-3 mt-1 text-xs text-dark-500 flex-wrap">
            {row.proposing_agent && (
              <span className="flex items-center gap-1"><Bot size={11} /> {row.proposing_agent}</span>
            )}
            {row.created_at && <span>{new Date(row.created_at).toLocaleString()}</span>}
          </div>
        </div>
        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onAccept} disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Accept
          </button>
          <button
            onClick={onUpdate} disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-lumi-600 hover:bg-lumi-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
          >
            <Pencil size={14} /> Update
          </button>
          <button
            onClick={onReject} disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-dark-800 hover:bg-dark-700 disabled:opacity-50 text-red-400 text-sm rounded-lg border border-dark-600 transition-colors"
          >
            <Trash2 size={14} /> Reject
          </button>
        </div>
      </div>

      {/* Rationale */}
      {row.rationale && (
        <p className="text-sm text-dark-400 italic mb-3 leading-relaxed">"{row.rationale}"</p>
      )}

      {/* Conflicts */}
      {hasConflicts && (
        <div className="mb-3 p-3 rounded-lg bg-yellow-900/20 border border-yellow-700/40">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-yellow-300 mb-1">
            <AlertTriangle size={12} /> {conflicts.length} possible conflict{conflicts.length !== 1 ? 's' : ''}
          </div>
          <ul className="space-y-0.5 text-xs text-yellow-200/80">
            {conflicts.map((c, i) => (
              <li key={c.entry_id ?? i}>• <span className="font-medium">{c.title}</span>{c.note ? ` — ${c.note}` : ''}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Body / Diff */}
      {isEdit ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-dark-500 mb-1">Current</div>
            <div className="bg-dark-925 border border-dark-800 rounded-lg p-3 max-h-64 overflow-y-auto">
              <pre className="whitespace-pre-wrap break-words font-sans text-xs text-dark-400 leading-relaxed">
                {row.current_body ?? '(none)'}
              </pre>
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-green-400 mb-1">Proposed</div>
            <div className="bg-dark-925 border border-green-800/40 rounded-lg p-3 max-h-64 overflow-y-auto">
              <pre className="whitespace-pre-wrap break-words font-sans text-xs text-dark-200 leading-relaxed">
                {row.proposed_body ?? '(none)'}
              </pre>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-dark-925 border border-dark-800 rounded-lg p-3 max-h-64 overflow-y-auto">
          <pre className="whitespace-pre-wrap break-words font-sans text-xs text-dark-200 leading-relaxed">
            {row.proposed_body ?? row.current_body ?? '(no body)'}
          </pre>
        </div>
      )}

      <Chips items={row.proposed_tags ?? row.current_tags} icon={Tag} />
      <Chips items={row.proposed_systems ?? row.current_systems} icon={Server} />
    </div>
  );
}

/* ---------- Inline Edit Form (Update decision) ---------- */
function EditForm({ row, busy, onCancel, onSave }: {
  row: any; busy: boolean; onCancel: () => void; onSave: (edits: any) => void;
}) {
  const [title, setTitle] = useState(String(row.proposed_title ?? row.current_title ?? ''));
  const [body, setBody] = useState(String(row.proposed_body ?? row.current_body ?? ''));
  const [category, setCategory] = useState(String(row.proposed_category ?? row.current_category ?? ''));
  const [tags, setTags] = useState((row.proposed_tags ?? row.current_tags ?? []).join(', '));
  const [systems, setSystems] = useState((row.proposed_systems ?? row.current_systems ?? []).join(', '));

  const handleSave = () => {
    onSave({
      title: title.trim(),
      body: body.trim(),
      category: category.trim() || undefined,
      tags: tags.split(',').map((t: string) => t.trim()).filter(Boolean),
      systems: systems.split(',').map((s: string) => s.trim()).filter(Boolean),
    });
  };

  return (
    <div className="bg-dark-900 border border-lumi-600/40 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold text-dark-100 flex items-center gap-2">
          <Pencil size={16} className="text-lumi-400" /> Edit &amp; approve
        </h3>
        <button onClick={onCancel} className="text-dark-500 hover:text-dark-300 transition-colors"><X size={18} /></button>
      </div>
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-dark-400 mb-1">Title</label>
          <input
            type="text" value={title} onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-200 focus:outline-none focus:border-lumi-500 transition-colors"
          />
        </div>
        <div>
          <label className="block text-xs text-dark-400 mb-1">Body</label>
          <textarea
            value={body} onChange={(e) => setBody(e.target.value)} rows={8}
            className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-200 focus:outline-none focus:border-lumi-500 transition-colors resize-y"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-dark-400 mb-1">Category</label>
            <input
              type="text" value={category} onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-200 focus:outline-none focus:border-lumi-500 transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs text-dark-400 mb-1">Tags (comma-sep)</label>
            <input
              type="text" value={tags} onChange={(e) => setTags(e.target.value)}
              className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-200 focus:outline-none focus:border-lumi-500 transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs text-dark-400 mb-1">Systems (comma-sep)</label>
            <input
              type="text" value={systems} onChange={(e) => setSystems(e.target.value)}
              className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-200 focus:outline-none focus:border-lumi-500 transition-colors"
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-1">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-dark-400 hover:text-dark-200 transition-colors">Cancel</button>
          <button
            onClick={handleSave} disabled={busy || !title.trim() || !body.trim()}
            className="flex items-center gap-2 px-4 py-2 bg-lumi-600 hover:bg-lumi-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save &amp; Approve
          </button>
        </div>
      </div>
    </div>
  );
}
