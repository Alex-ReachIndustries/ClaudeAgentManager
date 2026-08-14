import { useState, useEffect, useCallback } from 'react';
import { X, Search, Eye, Plus, Users, Target, AlertTriangle, TrendingUp, Inbox } from 'lucide-react';
import { fetchKbAnalytics, decideKbWanted, type KbAnalytics } from '../api';

const RANGES = [7, 30, 90] as const;

function pct(n: number | null): string {
  return n == null ? '—' : `${Math.round(n * 100)}%`;
}

function shortDate(d: string): string {
  // d is 'YYYY-MM-DD'
  const [, m, day] = d.split('-');
  return `${m}/${day}`;
}

/** Simple dependency-free stacked bar chart of daily accesses. */
function UsageChart({ series }: { series: KbAnalytics['timeseries'] }) {
  if (!series.length) {
    return <div className="text-xs text-dark-500 py-8 text-center">No activity recorded in this window yet.</div>;
  }
  const max = Math.max(1, ...series.map((d) => d.search + d.view + d.related + d.propose));
  // Cap the number of bars shown so long windows stay readable.
  const bars = series.slice(-45);
  return (
    <div>
      <div className="flex items-end gap-[2px] h-32">
        {bars.map((d) => {
          const total = d.search + d.view + d.related + d.propose;
          const h = (total / max) * 100;
          const seg = (v: number) => (total ? (v / total) * h : 0);
          return (
            <div
              key={d.date}
              className="flex-1 flex flex-col justify-end group relative min-w-[3px]"
              title={`${d.date}\nsearches ${d.search} · views ${d.view} · related ${d.related} · proposals ${d.propose}`}
            >
              <div style={{ height: `${seg(d.propose)}%` }} className="bg-amber-500/80 w-full" />
              <div style={{ height: `${seg(d.related)}%` }} className="bg-lumi-700 w-full" />
              <div style={{ height: `${seg(d.view)}%` }} className="bg-lumi-500 w-full" />
              <div style={{ height: `${seg(d.search)}%` }} className="bg-green-500 w-full rounded-t-sm" />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-1.5 text-[10px] text-dark-600">
        <span>{shortDate(bars[0].date)}</span>
        <span>{shortDate(bars[bars.length - 1].date)}</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[10px] text-dark-500">
        <span className="flex items-center gap-1"><i className="inline-block w-2 h-2 rounded-sm bg-green-500" /> searches</span>
        <span className="flex items-center gap-1"><i className="inline-block w-2 h-2 rounded-sm bg-lumi-500" /> views</span>
        <span className="flex items-center gap-1"><i className="inline-block w-2 h-2 rounded-sm bg-lumi-700" /> related</span>
        <span className="flex items-center gap-1"><i className="inline-block w-2 h-2 rounded-sm bg-amber-500/80" /> proposals</span>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-dark-900 border border-dark-700 rounded-lg px-4 py-3">
      <div className="flex items-center gap-1.5 text-dark-500 text-[11px] mb-1">{icon}{label}</div>
      <div className="text-xl font-semibold text-dark-100">{value}</div>
      {sub && <div className="text-[11px] text-dark-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function ListPanel({
  title, icon, hint, empty, children,
}: { title: string; icon: React.ReactNode; hint?: string; empty: boolean; children: React.ReactNode }) {
  return (
    <div className="bg-dark-900 border border-dark-700 rounded-lg p-4">
      <div className="flex items-center gap-1.5 text-sm font-medium text-dark-200 mb-1">{icon}{title}</div>
      {hint && <div className="text-[11px] text-dark-500 mb-3">{hint}</div>}
      {empty ? <div className="text-xs text-dark-600 py-3">Nothing here yet.</div> : <div className="space-y-1.5 mt-2">{children}</div>}
    </div>
  );
}

function WantedPanel({ items }: { items: NonNullable<KbAnalytics['knowledge_wanted']>['top'] }) {
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const visible = items.filter((w) => !dismissed.has(w.id));
  return (
    <div className="bg-dark-900 border border-amber-600/30 rounded-lg p-4">
      <div className="flex items-center gap-1.5 text-sm font-medium text-dark-200 mb-1">
        <Inbox size={14} className="text-amber-400" />Knowledge wanted
      </div>
      <div className="text-[11px] text-dark-500 mb-3">Genuine search misses — write these, or dismiss the noise.</div>
      {visible.length === 0 ? (
        <div className="text-xs text-dark-600 py-2">Backlog clear.</div>
      ) : (
        <div className="space-y-1.5">
          {visible.map((w) => (
            <div key={w.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-dark-300 truncate">{w.query}</span>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-amber-400/80 tabular-nums">{w.times}×</span>
                <button
                  title="Dismiss"
                  onClick={async () => { setDismissed((p) => new Set(p).add(w.id)); try { await decideKbWanted(w.id, 'dismissed'); } catch { /* optimistic */ } }}
                  className="text-dark-600 hover:text-dark-300 transition-colors"
                >
                  <X size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function KbInsights({ onClose }: { onClose: () => void }) {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<KbAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (d: number) => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchKbAnalytics(d));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(days); }, [days, load]);

  const activeAgents = data ? data.by_agent.filter((a) => a.agent !== '(unknown)').length : 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center overflow-y-auto py-8 px-4" onClick={onClose}>
      <div
        className="bg-dark-950 border border-dark-700 rounded-xl w-full max-w-5xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-y-2 px-5 py-4 border-b border-dark-800 sticky top-0 bg-dark-950 rounded-t-xl z-10">
          <div className="flex items-center gap-2 min-w-0">
            <TrendingUp size={18} className="text-lumi-400 shrink-0" />
            <h2 className="text-base sm:text-lg font-semibold text-dark-100 truncate">Knowledge Hub — Insights</h2>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-1 bg-dark-900 border border-dark-700 rounded-lg p-0.5">
              {RANGES.map((r) => (
                <button
                  key={r}
                  onClick={() => setDays(r)}
                  className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                    days === r ? 'bg-lumi-600/20 text-lumi-400' : 'text-dark-500 hover:text-dark-300'
                  }`}
                >
                  {r}d
                </button>
              ))}
            </div>
            <button onClick={onClose} className="text-dark-500 hover:text-dark-200 transition-colors"><X size={20} /></button>
          </div>
        </div>

        <div className="p-5">
          {loading && <div className="text-sm text-dark-500 py-12 text-center">Loading analytics…</div>}
          {error && <div className="text-sm text-red-400 py-12 text-center">{error}</div>}

          {data && !loading && (
            <div className="space-y-5">
              {/* Headline cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <StatCard icon={<Search size={12} />} label="Searches" value={data.window_totals.search}
                  sub={`${data.all_time_totals.search} all-time`} />
                <StatCard icon={<Target size={12} />} label="Hit rate" value={pct(data.search.hit_rate)}
                  sub={`${data.search.misses} found nothing`} />
                <StatCard icon={<Eye size={12} />} label="Entry reads" value={data.window_totals.view + data.window_totals.related} />
                <StatCard icon={<Plus size={12} />} label="Contributions" value={data.window_totals.propose} />
                <StatCard icon={<Users size={12} />} label="Active agents" value={activeAgents} />
                {data.surfacing && (
                  <StatCard
                    icon={<TrendingUp size={12} />}
                    label="Auto-surfaced"
                    value={data.surfacing.surfaces}
                    sub={data.surfacing.open_rate != null ? `${Math.round(data.surfacing.open_rate * 100)}% opened` : 'push→read'}
                  />
                )}
              </div>

              {/* Uptake vs work volume — the honest measure (ratios, not vanity counts) */}
              {data.uptake && (
                <div className="bg-dark-900 border border-dark-700 rounded-lg p-4">
                  <div className="flex items-center gap-1.5 text-sm font-medium text-dark-200 mb-1"><Target size={14} />Uptake vs work</div>
                  <div className="text-[11px] text-dark-500 mb-3">across {data.uptake.tasks} tasks / {data.uptake.substantive_outputs} substantive outputs this window</div>
                  <div className="grid grid-cols-3 gap-3">
                    {([
                      { label: 'Searches / task', val: data.uptake.searches_per_task, tgt: data.uptake.targets.searches_per_task, fmt: (n: number) => n.toFixed(2) },
                      { label: 'Proposals / task', val: data.uptake.proposals_per_task, tgt: data.uptake.targets.proposals_per_task, fmt: (n: number) => n.toFixed(2) },
                      // Push side of the context library: entry bodies inlined straight into task
                      // deliveries. No target — more is not automatically better, it tracks how much
                      // relevant knowledge reached agents without them having to go looking.
                      { label: 'Delivered / task', val: data.uptake.delivered_per_task, tgt: null, fmt: (n: number) => n.toFixed(2) },
                    ] as const).map((m) => {
                      // A null target means "observation only" — show it neutrally rather than
                      // grading it, so a metric with no goal can't read as a failing red number.
                      const ok = m.tgt != null && m.val >= m.tgt;
                      return (
                        <div key={m.label} className="bg-dark-950 border border-dark-800 rounded-lg px-3 py-2">
                          <div className="text-[10px] text-dark-500 mb-1">{m.label}</div>
                          <div className={`text-lg font-semibold ${m.tgt == null ? 'text-dark-200' : ok ? 'text-green-400' : 'text-amber-400'}`}>{m.fmt(m.val)}</div>
                          <div className="text-[10px] text-dark-600">{m.tgt == null ? 'no target — push volume' : `target ${m.fmt(m.tgt)}${ok ? ' ✓' : ''}`}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Usage over time */}
              <div className="bg-dark-900 border border-dark-700 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-1.5 text-sm font-medium text-dark-200"><TrendingUp size={14} />Usage over time</div>
                  {data.search.avg_latency_ms != null && (
                    <span className="text-[11px] text-dark-500">avg search {data.search.avg_latency_ms} ms</span>
                  )}
                </div>
                <UsageChart series={data.timeseries} />
              </div>

              {/* Knowledge wanted — actionable backlog of genuine misses */}
              {data.knowledge_wanted && data.knowledge_wanted.top.length > 0 && (
                <WantedPanel items={data.knowledge_wanted.top} />
              )}

              {/* Two-column detail */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ListPanel
                  title="Gaps — searches that found nothing"
                  icon={<AlertTriangle size={14} className="text-amber-400" />}
                  hint="The clearest signal of what knowledge to write next."
                  empty={data.gaps.length === 0}
                >
                  {data.gaps.map((g, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-dark-300 truncate">{g.query}</span>
                      <span className="text-amber-400/80 shrink-0 tabular-nums">{g.times}×</span>
                    </div>
                  ))}
                </ListPanel>

                <ListPanel
                  title="Most-used knowledge"
                  icon={<Eye size={14} className="text-lumi-400" />}
                  hint="Entries agents actually open — your highest-value knowledge."
                  empty={data.top_entries.length === 0}
                >
                  {data.top_entries.map((e) => (
                    <div key={e.entry_id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-dark-300 truncate">{e.title ?? `#${e.entry_id} (removed)`}</span>
                      <span className="text-lumi-400/80 shrink-0 tabular-nums">{e.views}</span>
                    </div>
                  ))}
                </ListPanel>

                <ListPanel
                  title="Weak matches — under-served topics"
                  icon={<Target size={14} className="text-amber-400" />}
                  hint="Searches that returned only low-relevance results."
                  empty={data.weak.length === 0}
                >
                  {data.weak.map((w, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-dark-300 truncate">{w.query}</span>
                      <span className="text-dark-500 shrink-0 tabular-nums">{w.times}× · {w.avg_top_score}</span>
                    </div>
                  ))}
                </ListPanel>

                <ListPanel
                  title="Per-agent activity"
                  icon={<Users size={14} className="text-lumi-400" />}
                  empty={data.by_agent.length === 0}
                >
                  <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-1 text-[11px] text-dark-500 pb-1 border-b border-dark-800">
                    <span>agent</span><span className="text-right">search</span><span className="text-right">read</span><span className="text-right">add</span>
                  </div>
                  {data.by_agent.map((a, i) => (
                    <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 text-xs">
                      <span className="text-dark-300 truncate">{a.agent}</span>
                      <span className="text-right text-dark-400 tabular-nums">{a.searches}</span>
                      <span className="text-right text-dark-400 tabular-nums">{a.views + a.related}</span>
                      <span className="text-right text-dark-400 tabular-nums">{a.proposals}</span>
                    </div>
                  ))}
                </ListPanel>
              </div>

              {/* Footer facts */}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-dark-500 pt-1">
                <span className="flex items-center gap-1">
                  <AlertTriangle size={11} className="text-dark-600" />
                  <span className="text-dark-300 font-medium">{data.never_accessed.count}</span> approved entries never opened
                </span>
                {data.logging_since && <span>logging since {data.logging_since.replace('T', ' ')}</span>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
