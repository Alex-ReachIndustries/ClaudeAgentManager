import { useState } from 'react';
import { PauseCircle, AlertTriangle } from 'lucide-react';
import { updateAgent } from '../api';

interface PollDelayControlProps {
  agentId: string;
  currentDelay: string | null;
  onUpdated: () => void;
}

function PollDelayControl({ agentId, currentDelay, onUpdated }: PollDelayControlProps) {
  const [duration, setDuration] = useState('1');
  const [unit, setUnit] = useState<'hours' | 'days'>('hours');
  const [setting, setSetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDelayed = currentDelay && new Date(currentDelay + 'Z') > new Date();

  const handleDelay = async () => {
    const ms = unit === 'hours' ? Number(duration) * 3600000 : Number(duration) * 86400000;
    const until = new Date(Date.now() + ms).toISOString().replace('T', ' ').slice(0, 19);

    try {
      setSetting(true);
      setError(null);
      await updateAgent(agentId, { poll_delay_until: until } as never);
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set delay');
    } finally {
      setSetting(false);
    }
  };

  const formatDelay = (iso: string) => {
    const d = new Date(iso + 'Z');
    return d.toLocaleString();
  };

  return (
    <div className="bg-dark-900 border border-dark-800 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-dark-800">
        <h2 className="text-sm font-semibold text-dark-300 uppercase tracking-wide flex items-center gap-2">
          <PauseCircle size={14} />
          Polling Control
        </h2>
      </div>

      <div className="p-4 space-y-3">
        {isDelayed ? (
          <div className="p-3 bg-yellow-950/20 border border-yellow-800/30 rounded-lg">
            <p className="text-sm text-yellow-300 flex items-center gap-2">
              <PauseCircle size={14} />
              Polling paused until {formatDelay(currentDelay!)}
            </p>
            <p className="text-xs text-dark-500 mt-2 flex items-center gap-1">
              <AlertTriangle size={12} />
              Can only be resumed from the local machine
            </p>
          </div>
        ) : (
          <>
            <p className="text-xs text-dark-400">
              Pause this agent's polling for a set duration. The agent will not check for messages until the delay expires.
            </p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                max="168"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className="w-16 bg-dark-850 border border-dark-700 rounded-lg px-2 py-1.5 text-sm text-dark-100 focus:outline-none focus:ring-2 focus:ring-lumi-500/30"
              />
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value as 'hours' | 'days')}
                className="bg-dark-850 border border-dark-700 rounded-lg px-2 py-1.5 text-sm text-dark-100 focus:outline-none focus:ring-2 focus:ring-lumi-500/30"
              >
                <option value="hours">hours</option>
                <option value="days">days</option>
              </select>
              <button
                onClick={handleDelay}
                disabled={setting || !duration || Number(duration) < 1}
                className="px-3 py-1.5 bg-yellow-600 hover:bg-yellow-500 disabled:bg-dark-700 disabled:text-dark-500 text-white text-sm rounded-lg transition-colors"
              >
                {setting ? 'Setting...' : 'Pause Polling'}
              </button>
            </div>
            <div className="flex items-start gap-1.5 p-2 bg-red-950/10 border border-red-800/20 rounded-lg">
              <AlertTriangle size={12} className="text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-300">
                Once paused, polling can only be resumed early from a confirmation dialog on the local machine where the agent is running.
              </p>
            </div>
          </>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    </div>
  );
}

export default PollDelayControl;
