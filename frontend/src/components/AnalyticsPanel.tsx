import { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, Users, Zap, MessageSquare, Activity } from 'lucide-react';
import { fetchAnalytics } from '../api';

interface AnalyticsData {
  totalAgents: number;
  activeNow: number;
  updatesToday: number;
  messagesToday: number;
  statusCounts: { status: string; count: number }[];
}

const COLLAPSED_KEY = 'cm-analytics-collapsed';

function AnalyticsPanel() {
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem(COLLAPSED_KEY) === 'true';
  });
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchAnalytics()
      .then(setData)
      .catch(() => setError(true));
  }, []);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(COLLAPSED_KEY, String(next));
  };

  if (error) return null;

  return (
    <div>
      <button
        onClick={toggleCollapsed}
        className="flex items-center gap-2 text-sm text-dark-400 hover:text-dark-200 transition-colors mb-3"
      >
        {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        <span className="font-medium">Analytics</span>
      </button>

      {!collapsed && data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard
            label="Total Agents"
            value={data.totalAgents}
            icon={<Users size={16} className="text-lumi-400" />}
          />
          <MetricCard
            label="Active Now"
            value={data.activeNow}
            icon={<Zap size={16} className="text-green-400" />}
            accent="green"
          />
          <MetricCard
            label="Updates (24h)"
            value={data.updatesToday}
            icon={<Activity size={16} className="text-lumi-400" />}
          />
          <MetricCard
            label="Messages (24h)"
            value={data.messagesToday}
            icon={<MessageSquare size={16} className="text-lumi-400" />}
          />
        </div>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  accent?: 'green';
}) {
  return (
    <div className="bg-dark-900 border border-dark-700 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs text-dark-400">{label}</span>
      </div>
      <p
        className={`text-2xl font-bold ${
          accent === 'green' ? 'text-green-400' : 'text-dark-100'
        }`}
      >
        {value}
      </p>
    </div>
  );
}

export default AnalyticsPanel;
