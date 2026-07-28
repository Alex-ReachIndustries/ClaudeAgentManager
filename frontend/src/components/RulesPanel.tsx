import { useState, useEffect } from 'react';
import { ShieldCheck } from 'lucide-react';
import { fetchAgentRules } from '../api';

interface RulesPanelProps {
  agentId: string;
}

function RulesPanel({ agentId }: RulesPanelProps) {
  const [rules, setRules] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchAgentRules(agentId)
      .then((text) => { if (!cancelled) setRules(text); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load rules'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [agentId]);

  return (
    <div className="bg-dark-900 rounded-xl border border-dark-800 p-4">
      <h3 className="text-sm font-semibold text-dark-300 mb-3 flex items-center gap-2">
        <ShieldCheck size={14} className="text-lumi-400" />
        Agent Rules
      </h3>
      {loading && <p className="text-xs text-dark-500">Loading rules…</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
      {!loading && !error && rules && (
        <pre className="text-xs text-dark-300 whitespace-pre-wrap break-words font-mono bg-dark-950 rounded-lg p-3 max-h-96 overflow-y-auto">
          {rules}
        </pre>
      )}
    </div>
  );
}

export default RulesPanel;
