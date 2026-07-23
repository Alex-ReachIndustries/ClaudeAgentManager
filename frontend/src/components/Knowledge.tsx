import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Search, Loader2, BookOpen, Plus, X, AlertTriangle,
  Tag, Server, Hash, Sparkles, ChevronRight, FolderTree, Folder,
  Pencil, Trash2, Link2, Layers,
} from 'lucide-react';
import {
  searchKnowledge, getKnowledgeEntry, proposeKnowledge, fetchKbStats,
  fetchKbTree, createCategory, updateCategory, deleteCategory,
  fetchEntriesByCategory, fetchRelated, addEntryCategory, removeEntryCategory,
  type KbSearchResult, type KbStats, type TreeNode, type KbEntry,
  type EntryCategory, type RelatedEntry,
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

function Chips({ items, icon: Icon }: { items?: string[] | null; icon: typeof Tag }) {
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

// ---- Category breadcrumb chip ----
function CategoryChip({
  cat, onRemove,
}: { cat: EntryCategory; onRemove?: () => void }) {
  const manual = cat.source === 'manual';
  return (
    <span
      title={manual ? 'Pinned manually' : `Auto-classified${cat.score != null ? ` · score ${cat.score.toFixed(2)}` : ''}`}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border ${
        manual
          ? 'bg-lumi-600/15 border-lumi-600/40 text-lumi-300'
          : 'bg-dark-800 border-dark-700 text-dark-400'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${manual ? 'bg-lumi-400' : 'bg-dark-500'}`} />
      {cat.path || cat.name}
      {onRemove && (
        <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="ml-0.5 hover:text-red-300">
          <X size={10} />
        </button>
      )}
    </span>
  );
}

function CategoryChips({ cats }: { cats?: EntryCategory[] | null }) {
  if (!cats || cats.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {cats.map((c) => <CategoryChip key={c.id} cat={c} />)}
    </div>
  );
}

// ---- Flatten tree into a list with breadcrumb paths (for pickers) ----
interface FlatCat { id: number; name: string; path: string; }
function flattenTree(nodes: TreeNode[], prefix = ''): FlatCat[] {
  const out: FlatCat[] = [];
  for (const n of nodes) {
    const path = prefix ? `${prefix} / ${n.name}` : n.name;
    out.push({ id: n.id, name: n.name, path });
    if (n.children?.length) out.push(...flattenTree(n.children, path));
  }
  return out;
}

/* ---------- Recursive tree node row ---------- */
function TreeRow({
  node, depth, expanded, toggle, selectedId, onSelect, onAddChild, onRename, onDelete,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<number>;
  toggle: (id: number) => void;
  selectedId: number | null;
  onSelect: (node: TreeNode) => void;
  onAddChild: (parent: TreeNode) => void;
  onRename: (node: TreeNode) => void;
  onDelete: (node: TreeNode) => void;
}) {
  const hasChildren = node.children && node.children.length > 0;
  const isOpen = expanded.has(node.id);
  const isSel = selectedId === node.id;
  const count = node.descendant_count ?? node.direct_count ?? 0;
  return (
    <div>
      <div
        className={`group flex items-center gap-1 pr-1 rounded-md text-sm cursor-pointer transition-colors ${
          isSel ? 'bg-lumi-600/20 text-lumi-200' : 'text-dark-300 hover:bg-dark-800'
        }`}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={() => onSelect(node)}
      >
        <button
          onClick={(e) => { e.stopPropagation(); if (hasChildren) toggle(node.id); }}
          className={`shrink-0 w-4 h-4 flex items-center justify-center text-dark-500 ${hasChildren ? 'hover:text-dark-200' : 'invisible'}`}
        >
          <ChevronRight size={13} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} />
        </button>
        <Folder size={13} className="shrink-0 text-dark-500" />
        <span className="flex-1 truncate py-1.5">{node.name}</span>
        <span
          title={`${node.direct_count} direct · ${node.descendant_count} incl. subcategories`}
          className="shrink-0 px-1.5 py-0.5 rounded-full text-[10px] bg-dark-800 border border-dark-700 text-dark-400 tabular-nums"
        >
          {count}
        </span>
        {/* hover actions */}
        <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={(e) => { e.stopPropagation(); onAddChild(node); }} title="Add subcategory" className="p-1 text-dark-500 hover:text-lumi-300"><Plus size={12} /></button>
          <button onClick={(e) => { e.stopPropagation(); onRename(node); }} title="Rename" className="p-1 text-dark-500 hover:text-dark-100"><Pencil size={11} /></button>
          <button onClick={(e) => { e.stopPropagation(); onDelete(node); }} title="Delete" className="p-1 text-dark-500 hover:text-red-400"><Trash2 size={11} /></button>
        </div>
      </div>
      {hasChildren && isOpen && (
        <div>
          {node.children.map((c) => (
            <TreeRow
              key={c.id} node={c} depth={depth + 1}
              expanded={expanded} toggle={toggle} selectedId={selectedId}
              onSelect={onSelect} onAddChild={onAddChild} onRename={onRename} onDelete={onDelete}
            />
          ))}
        </div>
      )}
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

  // --- category tree / browse state ---
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [selectedCat, setSelectedCat] = useState<TreeNode | null>(null);
  const [includeDescendants, setIncludeDescendants] = useState(true);
  const [browseEntries, setBrowseEntries] = useState<KbEntry[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [catModal, setCatModal] = useState<{ mode: 'create' | 'rename'; parent?: TreeNode; node?: TreeNode } | null>(null);

  const flatCats = useMemo(() => flattenTree(tree), [tree]);

  const loadStats = useCallback(async () => {
    try { setStats(await fetchKbStats()); } catch { /* non-fatal */ }
  }, []);

  const loadTree = useCallback(async () => {
    setTreeLoading(true);
    try {
      const { tree: t } = await fetchKbTree();
      setTree(t ?? []);
    } catch { /* non-fatal */ } finally {
      setTreeLoading(false);
    }
  }, []);

  useEffect(() => { loadStats(); loadTree(); }, [loadStats, loadTree]);

  const toggleExpand = useCallback((id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const runSearch = useCallback(async (q: string, type: 'all' | 'knowledge' | 'profile') => {
    setSelectedCat(null); // switch right pane back to search mode
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

  const loadCategoryEntries = useCallback(async (cat: TreeNode, descendants: boolean) => {
    setBrowseLoading(true);
    setError(null);
    try {
      const res = await fetchEntriesByCategory(cat.id, descendants);
      setBrowseEntries(res.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load entries');
      setBrowseEntries([]);
    } finally {
      setBrowseLoading(false);
    }
  }, []);

  const selectCategory = useCallback((cat: TreeNode) => {
    setSelectedCat(cat);
    setExpanded((prev) => new Set(prev).add(cat.id));
    loadCategoryEntries(cat, includeDescendants);
  }, [loadCategoryEntries, includeDescendants]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runSearch(query.trim(), typeFilter);
  };

  const handleDeleteCategory = async (node: TreeNode) => {
    if (!confirm(`Delete category "${node.name}"? Its children will be reparented to its parent. Entry memberships are removed.`)) return;
    try {
      await deleteCategory(node.id);
      setToast({ message: `Deleted "${node.name}"`, type: 'success' });
      if (selectedCat?.id === node.id) setSelectedCat(null);
      await loadTree();
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Delete failed', type: 'error' });
    }
  };

  const showBrowse = selectedCat !== null;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
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
      <form onSubmit={handleSubmit} className="mb-5 space-y-3">
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

      {/* Two-pane layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5 items-start">
        {/* LEFT: category tree */}
        <aside className="bg-dark-900 border border-dark-700 rounded-xl p-2 lg:sticky lg:top-4">
          <div className="flex items-center justify-between px-2 py-1.5 mb-1">
            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-dark-400">
              <FolderTree size={13} /> Categories
            </span>
            <button
              onClick={() => setCatModal({ mode: 'create' })}
              title="New top-level category"
              className="p-1 text-dark-500 hover:text-lumi-300 transition-colors"
            >
              <Plus size={14} />
            </button>
          </div>
          {/* All / search reset */}
          <button
            onClick={() => { setSelectedCat(null); }}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
              !showBrowse ? 'bg-lumi-600/20 text-lumi-200' : 'text-dark-300 hover:bg-dark-800'
            }`}
          >
            <Search size={13} className="text-dark-500" />
            <span className="flex-1 text-left">All / Search</span>
          </button>
          <div className="mt-1 max-h-[65vh] overflow-y-auto pr-0.5">
            {treeLoading ? (
              <div className="flex items-center gap-2 px-2 py-4 text-dark-500 text-sm">
                <Loader2 size={14} className="animate-spin" /> Loading tree...
              </div>
            ) : tree.length === 0 ? (
              <p className="px-2 py-4 text-dark-500 text-sm">No categories yet.</p>
            ) : (
              tree.map((n) => (
                <TreeRow
                  key={n.id} node={n} depth={0}
                  expanded={expanded} toggle={toggleExpand}
                  selectedId={selectedCat?.id ?? null}
                  onSelect={selectCategory}
                  onAddChild={(parent) => setCatModal({ mode: 'create', parent })}
                  onRename={(node) => setCatModal({ mode: 'rename', node })}
                  onDelete={handleDeleteCategory}
                />
              ))
            )}
          </div>
        </aside>

        {/* RIGHT: browse OR search results */}
        <main className="min-w-0">
          {showBrowse ? (
            <BrowsePane
              cat={selectedCat!}
              entries={browseEntries}
              loading={browseLoading}
              error={error}
              includeDescendants={includeDescendants}
              onToggleDescendants={() => {
                const next = !includeDescendants;
                setIncludeDescendants(next);
                loadCategoryEntries(selectedCat!, next);
              }}
              onOpen={(id) => setDetailId(id)}
            />
          ) : (
            <SearchPane
              loading={loading} error={error} searched={searched}
              results={results} embeddingsReady={embeddingsReady}
              onOpen={(id) => setDetailId(id)}
            />
          )}
        </main>
      </div>

      {detailId !== null && (
        <EntryDetailModal
          id={detailId}
          flatCats={flatCats}
          onClose={() => setDetailId(null)}
          onChanged={() => { if (selectedCat) loadCategoryEntries(selectedCat, includeDescendants); }}
          onToast={(message, type) => setToast({ message, type })}
        />
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
      {catModal && (
        <CategoryDialog
          mode={catModal.mode}
          parent={catModal.parent}
          node={catModal.node}
          onClose={() => setCatModal(null)}
          onDone={(msg, type) => {
            setToast({ message: msg, type });
            if (type === 'success') { setCatModal(null); loadTree(); }
          }}
        />
      )}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

/* ---------- Search results pane (existing behaviour) ---------- */
function SearchPane({
  loading, error, searched, results, embeddingsReady, onOpen,
}: {
  loading: boolean; error: string | null; searched: boolean;
  results: KbSearchResult[]; embeddingsReady: boolean;
  onOpen: (id: string | number) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-dark-500">
        <Loader2 size={20} className="animate-spin mr-2" /> Searching...
      </div>
    );
  }
  if (error) {
    return <div className="p-4 bg-red-900/30 border border-red-700/50 rounded-xl text-red-300 text-sm">{error}</div>;
  }
  if (searched && results.length === 0) {
    return (
      <div className="text-center py-16">
        <BookOpen size={40} className="mx-auto text-dark-600 mb-4" />
        <p className="text-dark-400">No results found</p>
      </div>
    );
  }
  if (!searched) {
    return (
      <div className="text-center py-16">
        <Search size={40} className="mx-auto text-dark-600 mb-4" />
        <p className="text-dark-400">Search the knowledge base, or pick a category on the left to browse.</p>
      </div>
    );
  }
  return (
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
            onClick={() => { if (isKnowledge) onOpen(r.id); }}
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
  );
}

/* ---------- Browse-by-category pane ---------- */
function BrowsePane({
  cat, entries, loading, error, includeDescendants, onToggleDescendants, onOpen,
}: {
  cat: TreeNode; entries: KbEntry[]; loading: boolean; error: string | null;
  includeDescendants: boolean; onToggleDescendants: () => void;
  onOpen: (id: string | number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-dark-100 flex items-center gap-2 truncate">
            <Folder size={16} className="text-lumi-400 shrink-0" /> {cat.name}
          </h2>
          {cat.description && <p className="text-xs text-dark-500 mt-0.5 line-clamp-2">{cat.description}</p>}
        </div>
        <button
          onClick={onToggleDescendants}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-colors ${
            includeDescendants
              ? 'bg-lumi-600/20 text-lumi-400 border-lumi-600/30'
              : 'bg-dark-800 text-dark-500 border-dark-700 hover:text-dark-300'
          }`}
        >
          <Layers size={12} /> Include subcategories
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-dark-500">
          <Loader2 size={20} className="animate-spin mr-2" /> Loading entries...
        </div>
      ) : error ? (
        <div className="p-4 bg-red-900/30 border border-red-700/50 rounded-xl text-red-300 text-sm">{error}</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-16">
          <Folder size={40} className="mx-auto text-dark-600 mb-4" />
          <p className="text-dark-400">No entries in this category{includeDescendants ? ' or its subcategories' : ''}.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-dark-500">{entries.length} entr{entries.length === 1 ? 'y' : 'ies'}</p>
          {entries.map((e) => {
            const pending = e.status && e.status !== 'approved';
            const snippet = e.snippet || (e.body ? e.body.slice(0, 220) : '');
            return (
              <button
                key={e.id}
                onClick={() => onOpen(e.id)}
                className="w-full text-left bg-dark-900 border border-dark-700 rounded-xl p-4 hover:border-dark-600 cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-lumi-500/30"
              >
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-lumi-600/20 text-lumi-300">knowledge</span>
                  {pending && <PendingBadge />}
                </div>
                <h3 className="text-base font-semibold text-dark-100 mb-1">{e.title}</h3>
                {snippet && <p className="text-sm text-dark-400 line-clamp-2 mb-2 leading-relaxed">{snippet}</p>}
                <div className="flex flex-col gap-1.5">
                  <CategoryChips cats={e.categories} />
                  <Chips items={e.tags} icon={Tag} />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------- Entry Detail Modal ---------- */
function EntryDetailModal({
  id, flatCats, onClose, onChanged, onToast,
}: {
  id: string | number;
  flatCats: FlatCat[];
  onClose: () => void;
  onChanged: () => void;
  onToast: (message: string, type: 'success' | 'error') => void;
}) {
  const [entry, setEntry] = useState<KbEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [related, setRelated] = useState<RelatedEntry[]>([]);
  const [busyCat, setBusyCat] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pickValue, setPickValue] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await getKnowledgeEntry(id);
      setEntry(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load entry');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    let alive = true;
    (async () => {
      await load();
      if (!alive) return;
      try {
        const r = await fetchRelated(id);
        if (alive) setRelated(r.data ?? []);
      } catch { /* non-fatal */ }
    })();
    return () => { alive = false; };
  }, [id, load]);

  const pending = entry && entry.status !== 'approved';

  const handleRemoveCat = async (catId: number) => {
    setBusyCat(true);
    try {
      await removeEntryCategory(id, catId);
      await load();
      onChanged();
      onToast('Category removed', 'success');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to remove category', 'error');
    } finally { setBusyCat(false); }
  };

  const handleAddCat = async (catId: number) => {
    setBusyCat(true);
    try {
      await addEntryCategory(id, catId);
      await load();
      onChanged();
      setPicking(false);
      setPickValue('');
      onToast('Category pinned', 'success');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to add category', 'error');
    } finally { setBusyCat(false); }
  };

  const existingIds = new Set((entry?.categories ?? []).map((c) => c.id));
  const available = flatCats.filter((c) => !existingIds.has(c.id));

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
                {typeof entry.hit_count === 'number' && (
                  <span className="text-dark-600">{entry.hit_count} views</span>
                )}
              </div>

              {/* Categories (editable) */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-dark-400 flex items-center gap-1">
                    <Hash size={11} /> Categories
                  </span>
                  <button
                    onClick={() => setPicking((p) => !p)}
                    disabled={busyCat}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-dark-800 border border-dark-700 text-dark-300 hover:text-lumi-300 hover:border-lumi-600/40 disabled:opacity-50"
                  >
                    <Plus size={11} /> Pin category
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(entry.categories ?? []).length === 0 && (
                    <span className="text-xs text-dark-600">Uncategorised</span>
                  )}
                  {(entry.categories ?? []).map((c) => (
                    <CategoryChip key={c.id} cat={c} onRemove={busyCat ? undefined : () => handleRemoveCat(c.id)} />
                  ))}
                </div>
                {picking && (
                  <div className="mt-2 flex items-center gap-2">
                    <select
                      value={pickValue}
                      onChange={(e) => setPickValue(e.target.value)}
                      className="flex-1 px-2 py-1.5 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-200 focus:outline-none focus:border-lumi-500"
                    >
                      <option value="">Select a category…</option>
                      {available.map((c) => (
                        <option key={c.id} value={c.id}>{c.path}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => pickValue && handleAddCat(Number(pickValue))}
                      disabled={!pickValue || busyCat}
                      className="px-3 py-1.5 bg-lumi-600 hover:bg-lumi-500 disabled:opacity-50 text-white text-xs rounded-lg"
                    >
                      {busyCat ? <Loader2 size={13} className="animate-spin" /> : 'Add'}
                    </button>
                  </div>
                )}
              </div>

              <Chips items={entry.tags ?? []} icon={Tag} />
              <Chips items={entry.systems ?? []} icon={Server} />
              <div className="bg-dark-925 border border-dark-800 rounded-lg p-4">
                <pre className="whitespace-pre-wrap break-words font-sans text-sm text-dark-200 leading-relaxed">
                  {entry.body ?? '(no body)'}
                </pre>
              </div>

              {/* Related */}
              {related.length > 0 && (
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wide text-dark-400 flex items-center gap-1 mb-2">
                    <Link2 size={11} /> Related
                  </span>
                  <div className="space-y-2">
                    {related.map((r) => (
                      <div key={r.id} className="bg-dark-925 border border-dark-800 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm font-medium text-dark-200 truncate">{r.title}</span>
                          <span className={`ml-auto shrink-0 px-1.5 py-0.5 rounded-full text-[10px] ${
                            r.via === 'semantic' ? 'bg-lumi-600/15 text-lumi-300' : 'bg-blue-600/15 text-blue-300'
                          }`}>
                            {r.via}{typeof r.score === 'number' ? ` · ${r.score.toFixed(2)}` : ''}
                          </span>
                        </div>
                        {r.snippet && <p className="text-xs text-dark-500 line-clamp-2 leading-relaxed">{r.snippet}</p>}
                      </div>
                    ))}
                  </div>
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

/* ---------- Category create / rename dialog ---------- */
function CategoryDialog({
  mode, parent, node, onClose, onDone,
}: {
  mode: 'create' | 'rename';
  parent?: TreeNode;
  node?: TreeNode;
  onClose: () => void;
  onDone: (msg: string, type: 'success' | 'error') => void;
}) {
  const [name, setName] = useState(mode === 'rename' ? (node?.name ?? '') : '');
  const [description, setDescription] = useState(mode === 'rename' ? (node?.description ?? '') : '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title = mode === 'rename'
    ? `Rename "${node?.name}"`
    : parent ? `New subcategory of "${parent.name}"` : 'New top-level category';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      if (mode === 'rename' && node) {
        await updateCategory(node.id, { name: name.trim(), description: description.trim() });
        onDone(`Renamed to "${name.trim()}"`, 'success');
      } else {
        await createCategory({ name: name.trim(), parent_id: parent?.id ?? null, description: description.trim() || undefined });
        onDone(`Created "${name.trim()}" — auto-classifying existing entries…`, 'success');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save category');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-dark-900 border border-dark-700 rounded-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-dark-100 pr-4">{title}</h2>
          <button onClick={onClose} className="text-dark-500 hover:text-dark-300 transition-colors shrink-0">
            <X size={18} />
          </button>
        </div>
        {error && (
          <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">{error}</div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-dark-400 mb-1">Name *</label>
            <input
              type="text" value={name} onChange={(e) => setName(e.target.value)} required autoFocus
              className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-200 placeholder-dark-500 focus:outline-none focus:border-lumi-500 transition-colors"
              placeholder="Category name"
            />
          </div>
          <div>
            <label className="block text-xs text-dark-400 mb-1">Description</label>
            <textarea
              value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
              className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-200 placeholder-dark-500 focus:outline-none focus:border-lumi-500 transition-colors resize-none"
              placeholder="What belongs here (guides auto-classification)"
            />
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-dark-400 hover:text-dark-200 transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !name.trim()}
              className="px-4 py-2 bg-lumi-600 hover:bg-lumi-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
            >
              {submitting ? (
                <span className="flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Saving...</span>
              ) : (mode === 'rename' ? 'Save' : 'Create')}
            </button>
          </div>
        </form>
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
