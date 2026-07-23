import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Search, Loader2, BookOpen, Plus, X, AlertTriangle,
  Tag, Server, Hash, Sparkles,
} from 'lucide-react';
import {
  searchKnowledge, getKnowledgeEntry, proposeKnowledge, fetchKbStats,
  type KbSearchResult, type KbStats,
} from '../api';

// ---- Toast helper (copied from Settings.tsx pattern) ----
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

function PendingBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-yellow-900/40 border border-yellow-700/50 text-yellow-300">
      <AlertTriangle size={10} /> Pending · unverified
    </span>
  );
}

function Chips({ items, icon: Icon }: { items: string[]; icon: typeof Tag }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((it) => (
        <span key={it} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-dark-800 border border-dark-700 text-dark-400">
          <Icon size={10} /> {it}
        </span>
      ))}
    </div>
  );
}

export default function Knowledge() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'knowledge' | 'profile'>('all');
  const [results, setResults] = useState<KbSearchResult[]>([]);
  const [embeddingsReady, setEmbeddingsReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [stats, setStats] = useState<KbStats | null>(null);
  const [detailId, setDetailId] = useState<string | number | null>(null);
  const [showPropose, setShowPropose] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const loadStats = useCallback(async () => {
    try { setStats(await fetchKbStats()); } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  const runSearch = useCallback(async (q: string, type: 'all' | 'knowledge' | 'profile') => {
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const res = await searchKnowledge(q, type, 30);
      setResults(res.results ?? []);
      setEmbeddingsReady(res.embeddingsReady);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runSearch(query.trim(), typeFilter);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 text-dark-400 hover:text-dark-100 transition-colors"
          >
            <ArrowLeft size={18} />
            <span>Back</span>
          </button>
          <h1 className="text-2xl font-semibold text-dark-100 flex items-center gap-2">
            <BookOpen size={22} className="text-lumi-400" /> Knowledge
          </h1>
        </div>
        <button
          onClick={() => setShowPropose(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-lumi-600 hover:bg-lumi-500 text-white text-sm rounded-lg transition-colors"
        >
          <Plus size={16} />
          Propose Knowledge
        </button>
      </div>

      {/* Stats line */}
      {stats && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mb-4 text-xs text-dark-500">
          <span><span className="text-dark-300 font-medium">{stats.entries.total}</span> entries ({stats.entries.approved} approved)</span>
          <span><span className="text-dark-300 font-medium">{stats.pending_queue}</span> pending</span>
          <span><span className="text-dark-300 font-medium">{stats.profiles}</span> profiles</span>
          <span className="flex items-center gap-1">
            <Sparkles size={11} className={stats.embeddingsReady ? 'text-green-400' : 'text-dark-600'} />
            embeddings {stats.embeddingsReady ? 'ready' : 'building'}
          </span>
        </div>
      )}

      {/* Search form */}
      <form onSubmit={handleSubmit} className="mb-4 space-y-3">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search knowledge and profiles..."
            className="w-full pl-9 pr-24 py-2 bg-dark-900 border border-dark-700 rounded-lg text-sm text-dark-200 placeholder-dark-500 focus:outline-none focus:border-lumi-500 transition-colors"
          />
          <button
            type="submit"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 px-3 py-1 bg-lumi-600 hover:bg-lumi-500 text-white text-xs rounded-md transition-colors"
          >
            Search
          </button>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(['all', 'knowledge', 'profile'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => { setTypeFilter(t); if (searched) runSearch(query.trim(), t); }}
              className={`px-3 py-1 rounded-full text-xs capitalize transition-colors ${
                typeFilter === t
                  ? 'bg-lumi-600/20 text-lumi-400 border border-lumi-600/30'
                  : 'bg-dark-800 text-dark-500 border border-dark-700 hover:text-dark-300'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </form>

      {/* Results */}
      {loading && (
        <div className="flex items-center justify-center py-16 text-dark-500">
          <Loader2 size={20} className="animate-spin mr-2" /> Searching...
        </div>
      )}
      {error && !loading && (
        <div className="p-4 bg-red-900/30 border border-red-700/50 rounded-xl text-red-300 text-sm">{error}</div>
      )}
      {!loading && !error && searched && results.length === 0 && (
        <div className="text-center py-16">
          <BookOpen size={40} className="mx-auto text-dark-600 mb-4" />
          <p className="text-dark-400">No results found</p>
        </div>
      )}
      {!loading && !error && !searched && (
        <div className="text-center py-16">
          <Search size={40} className="mx-auto text-dark-600 mb-4" />
          <p className="text-dark-400">Search the knowledge base and agent profiles.</p>
        </div>
      )}
      {!loading && !error && results.length > 0 && (
        <div className="space-y-3">
          {!embeddingsReady && (
            <p className="text-xs text-dark-500 italic">Semantic embeddings still building — showing keyword matches.</p>
          )}
          {results.map((r) => {
            const pending = r.status !== 'approved';
            const isKnowledge = r.type === 'knowledge';
            return (
              <button
                key={`${r.type}-${r.id}`}
                onClick={() => { if (isKnowledge) setDetailId(r.id); }}
                disabled={!isKnowledge}
                className={`w-full text-left bg-dark-900 border border-dark-700 rounded-xl p-4 transition-colors ${
                  isKnowledge ? 'hover:border-dark-600 cursor-pointer' : 'cursor-default'
                } focus:outline-none focus:ring-2 focus:ring-lumi-500/30`}
              >
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${
                    isKnowledge ? 'bg-lumi-600/20 text-lumi-300' : 'bg-blue-600/20 text-blue-300'
                  }`}>
                    {r.type}
                  </span>
                  {pending && <PendingBadge />}
                  {typeof r.score === 'number' && (
                    <span className="ml-auto text-[10px] text-dark-600">score {r.score.toFixed(3)}</span>
                  )}
                </div>
                <h3 className="text-base font-semibold text-dark-100 mb-1">{r.title}</h3>
                {r.snippet && <p className="text-sm text-dark-400 line-clamp-2 mb-2 leading-relaxed">{r.snippet}</p>}
                <div className="flex flex-col gap-1.5">
                  <Chips items={r.tags} icon={Tag} />
                  <Chips items={r.systems} icon={Server} />
                </div>
              </button>
            );
          })}
        </div>
      )}

      {detailId !== null && (
        <EntryDetailModal id={detailId} onClose={() => setDetailId(null)} />
      )}
      {showPropose && (
        <ProposeDialog
          onClose={() => setShowPropose(false)}
          onDone={(msg, type) => {
            setToast({ message: msg, type });
            if (type === 'success') { setShowPropose(false); loadStats(); }
          }}
        />
      )}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

/* ---------- Entry Detail Modal ---------- */
function EntryDetailModal({ id, onClose }: { id: string | number; onClose: () => void }) {
  const [entry, setEntry] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await getKnowledgeEntry(id);
        if (alive) setEntry(data);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'Failed to load entry');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id]);

  const pending = entry && entry.status !== 'approved';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="bg-dark-900 border border-dark-700 rounded-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-dark-900 border-b border-dark-800 px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-dark-100 pr-4">
            {loading ? 'Loading...' : (entry?.title ?? 'Entry')}
          </h2>
          <button onClick={onClose} className="text-dark-500 hover:text-dark-300 transition-colors shrink-0">
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-5">
          {loading && (
            <div className="flex items-center justify-center py-10 text-dark-500">
              <Loader2 size={18} className="animate-spin mr-2" /> Loading entry...
            </div>
          )}
          {error && <div className="p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">{error}</div>}
          {entry && !loading && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap text-xs">
                {pending && <PendingBadge />}
                {entry.category && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-dark-800 border border-dark-700 text-dark-400">
                    <Hash size={10} /> {entry.category}
                  </span>
                )}
                {typeof entry.hit_count === 'number' && (
                  <span className="text-dark-600">{entry.hit_count} views</span>
                )}
              </div>
              <Chips items={entry.tags ?? []} icon={Tag} />
              <Chips items={entry.systems ?? []} icon={Server} />
              <div className="bg-dark-925 border border-dark-800 rounded-lg p-4">
                <pre className="whitespace-pre-wrap break-words font-sans text-sm text-dark-200 leading-relaxed">
                  {entry.body ?? '(no body)'}
                </pre>
              </div>
              {Array.isArray(entry.related_ids) && entry.related_ids.length > 0 && (
                <div className="text-xs text-dark-500">
                  Related: {entry.related_ids.join(', ')}
                </div>
              )}
              <div className="text-[11px] text-dark-600 pt-2 border-t border-dark-800">
                {entry.source && <span>Source: {entry.source} · </span>}
                {entry.updated_at && <span>Updated {new Date(entry.updated_at).toLocaleString()}</span>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- Propose Knowledge Dialog ---------- */
function ProposeDialog({ onClose, onDone }: { onClose: () => void; onDone: (msg: string, type: 'success' | 'error') => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('');
  const [tags, setTags] = useState('');
  const [systems, setSystems] = useState('');
  const [rationale, setRationale] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await proposeKnowledge({
        kind: 'new',
        title: title.trim(),
        body: body.trim(),
        category: category.trim() || undefined,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        systems: systems.split(',').map((s) => s.trim()).filter(Boolean),
        source: 'dashboard',
        agent: 'human',
        rationale: rationale.trim() || undefined,
      });
      const conflictNote = res.conflicts && res.conflicts.length > 0
        ? ` (${res.conflicts.length} possible conflict${res.conflicts.length !== 1 ? 's' : ''} flagged)`
        : '';
      onDone(`Proposal submitted for review${conflictNote}`, 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit proposal');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-dark-900 border border-dark-700 rounded-xl p-6 w-full max-w-md max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-dark-100">Propose Knowledge</h2>
          <button onClick={onClose} className="text-dark-500 hover:text-dark-300 transition-colors">
            <X size={18} />
          </button>
        </div>
        {error && (
          <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">{error}</div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-dark-400 mb-1">Title *</label>
            <input
              type="text" value={title} onChange={(e) => setTitle(e.target.value)} required
              className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-200 placeholder-dark-500 focus:outline-none focus:border-lumi-500 transition-colors"
              placeholder="Short descriptive title"
            />
          </div>
          <div>
            <label className="block text-xs text-dark-400 mb-1">Body *</label>
            <textarea
              value={body} onChange={(e) => setBody(e.target.value)} required rows={6}
              className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-200 placeholder-dark-500 focus:outline-none focus:border-lumi-500 transition-colors resize-none"
              placeholder="The knowledge content (markdown ok)..."
            />
          </div>
          <div>
            <label className="block text-xs text-dark-400 mb-1">Category</label>
            <input
              type="text" value={category} onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-200 placeholder-dark-500 focus:outline-none focus:border-lumi-500 transition-colors"
              placeholder="e.g. infrastructure"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-dark-400 mb-1">Tags (comma-sep)</label>
              <input
                type="text" value={tags} onChange={(e) => setTags(e.target.value)}
                className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-200 placeholder-dark-500 focus:outline-none focus:border-lumi-500 transition-colors"
                placeholder="docker, aws"
              />
            </div>
            <div>
              <label className="block text-xs text-dark-400 mb-1">Systems (comma-sep)</label>
              <input
                type="text" value={systems} onChange={(e) => setSystems(e.target.value)}
                className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-200 placeholder-dark-500 focus:outline-none focus:border-lumi-500 transition-colors"
                placeholder="backend, mqtt"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-dark-400 mb-1">Rationale</label>
            <input
              type="text" value={rationale} onChange={(e) => setRationale(e.target.value)}
              className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-200 placeholder-dark-500 focus:outline-none focus:border-lumi-500 transition-colors"
              placeholder="Why this should be added"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-dark-400 hover:text-dark-200 transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !title.trim() || !body.trim()}
              className="px-4 py-2 bg-lumi-600 hover:bg-lumi-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
            >
              {submitting ? (
                <span className="flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Submitting...</span>
              ) : 'Submit for Review'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
