import { useMemo, useState } from 'react';
import type { Agent } from '../types';
import AgentCard from './AgentCard';
import FolderPicker from './FolderPicker';
import { createLaunchRequest } from '../api';
import { RefreshCw, Bot, Archive, Plus } from 'lucide-react';

interface DashboardProps {
  agents: Agent[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

function Dashboard({ agents, loading, error, refetch }: DashboardProps) {
  const [showFolderPicker, setShowFolderPicker] = useState(false);

  const handleLaunch = async (folderPath: string) => {
    try {
      await createLaunchRequest('new', folderPath);
      setShowFolderPicker(false);
    } catch (err) {
      console.error('Failed to create launch request:', err);
    }
  };

  const { activeAgents, archivedAgents } = useMemo(() => {
    const sorted = [...agents].sort((a, b) => {
      // Sort by real activity (updates & messages), not heartbeats
      const aTime = a.last_activity_at || a.last_update_at;
      const bTime = b.last_activity_at || b.last_update_at;
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });
    return {
      activeAgents: sorted.filter((a) => a.status !== 'archived'),
      archivedAgents: sorted.filter((a) => a.status === 'archived'),
    };
  }, [agents]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="bg-dark-900 border border-dark-800 rounded-xl p-5 animate-pulse"
            >
              <div className="flex items-center gap-2 mb-4">
                <div className="w-3 h-3 rounded-full bg-dark-700" />
                <div className="h-4 w-20 bg-dark-700 rounded" />
              </div>
              <div className="h-6 w-3/4 bg-dark-800 rounded mb-3" />
              <div className="h-4 w-full bg-dark-800 rounded mb-2" />
              <div className="h-4 w-2/3 bg-dark-800 rounded mb-4" />
              <div className="flex gap-4">
                <div className="h-4 w-16 bg-dark-800 rounded" />
                <div className="h-4 w-16 bg-dark-800 rounded" />
                <div className="h-4 w-16 bg-dark-800 rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="bg-red-950/30 border border-red-800/50 rounded-xl p-6 text-center">
          <p className="text-red-400 mb-3">{error}</p>
          <button
            onClick={refetch}
            className="inline-flex items-center gap-2 px-4 py-2 bg-dark-800 hover:bg-dark-700 rounded-lg text-sm text-dark-200 transition-colors"
          >
            <RefreshCw size={14} />
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-2xl bg-dark-900 border border-dark-800 flex items-center justify-center mb-6">
            <Bot size={32} className="text-dark-600" />
          </div>
          <h2 className="text-xl font-semibold text-dark-300 mb-2">No agents yet</h2>
          <p className="text-dark-500 max-w-md">
            Waiting for connections... Agents will appear here once they register with the
            manager.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-8 space-y-6 sm:space-y-8">
      {/* New Agent button */}
      <div className="flex justify-end">
        <button
          onClick={() => setShowFolderPicker(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-lumi-600 hover:bg-lumi-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus size={16} />
          New Agent
        </button>
      </div>

      <FolderPicker
        isOpen={showFolderPicker}
        onClose={() => setShowFolderPicker(false)}
        onSelect={handleLaunch}
      />

      {/* Active agents */}
      {activeAgents.length > 0 && (
        <div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {activeAgents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        </div>
      )}

      {/* Archived agents */}
      {archivedAgents.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Archive size={14} className="text-dark-500" />
            <h2 className="text-sm font-semibold text-dark-500 uppercase tracking-wide">
              Archived
            </h2>
            <span className="text-xs text-dark-600">{archivedAgents.length}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 opacity-60">
            {archivedAgents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
