import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, DollarSign, Activity } from 'lucide-react';
import { fetchFleetCosts } from '../api';
import type { FleetCostAnalytics } from '../api';

function formatUsd(n: number): string {
  return `$${n.toFixed(n < 1 ? 4 : 2)}`;
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="bg-dark-900 border border-dark-700 rounded-lg px-4 py-3">
      <div className="flex items-center gap-1.5 text-dark-500 text-[11px] mb-1">{icon}{label}</div>
      <div className="text-xl font-semibold text-dark-100">{value}</div>
    </div>
  );
}

/** Hand-rolled horizontal bar list, one row per agent, sorted by cost descending. */
function AgentCostBars({ agents }: { agents: FleetCostAnalytics['agents'] }) {
  const sorted = [...agents].sort((a, b) => b.costs.cost_usd - a.costs.cost_usd);
  const max = Math.max(1e-9, ...sorted.map(a => a.costs.cost_usd));
  return (
    <div className="space-y-3">
      {sorted.map(a => (
        <Link key={a.id} to={`/agent/${a.id}`} className="block group">
          <div className="flex justify-between items-baseline gap-2 mb-1">
            <span className="text-xs text-dark-300 truncate group-hover:text-dark-100 transition-colors">{a.title}</span>
            <span className="text-xs text-dark-400 font-mono shrink-0">{formatUsd(a.costs.cost_usd)}</span>
          </div>
          <div className="h-1.5 bg-dark-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-lumi-500 rounded-full"
              style={{ width: `${(a.costs.cost_usd / max) * 100}%` }}
            />
          </div>
          <div className="text-[11px] text-dark-600 mt-1">
            {(a.costs.input_tokens + a.costs.output_tokens).toLocaleString()} tokens
          </div>
        </Link>
      ))}
    </div>
  );
}

function Costs() {
  const navigate = useNavigate();
  const [data, setData] = useState<FleetCostAnalytics | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    fetchFleetCosts().then(setData).catch(() => setError(true));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
      <button
        onClick={() => navigate('/')}
        className="inline-flex items-center gap-2 text-dark-400 hover:text-dark-200 mb-4 sm:mb-6 transition-colors"
      >
        <ArrowLeft size={16} />
        Back to dashboard
      </button>

      <h1 className="text-xl sm:text-2xl font-bold text-dark-50 mb-6">Fleet Costs</h1>

      {error && (
        <div className="bg-red-950/30 border border-red-800/50 rounded-xl p-6 text-center text-sm text-red-400">
          Failed to load cost data.
        </div>
      )}

      {!error && !data && (
        <div className="animate-pulse space-y-4">
          <div className="h-20 bg-dark-900 rounded-xl border border-dark-800" />
          <div className="h-64 bg-dark-900 rounded-xl border border-dark-800" />
        </div>
      )}

      {!error && data && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StatCard icon={<DollarSign size={13} />} label="Total Spend" value={formatUsd(data.total.cost_usd)} />
            <StatCard icon={<Activity size={13} />} label="Input Tokens" value={data.total.input_tokens.toLocaleString()} />
            <StatCard icon={<Activity size={13} />} label="Output Tokens" value={data.total.output_tokens.toLocaleString()} />
          </div>

          <div className="bg-dark-900 rounded-xl border border-dark-800 p-4">
            <h3 className="text-sm font-semibold text-dark-300 mb-3">Cost by Agent</h3>
            {data.agents.length === 0 ? (
              <p className="text-xs text-dark-500 py-4 text-center">No cost events recorded yet.</p>
            ) : (
              <AgentCostBars agents={data.agents} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default Costs;
