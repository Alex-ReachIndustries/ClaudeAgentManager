import { useNavigate } from 'react-router-dom';
import { Settings } from 'lucide-react';
import type { Agent } from '../types';
import type { ConnectionState } from '../api';
import NotificationToggle from './NotificationToggle';

interface HeaderProps {
  agents: Agent[];
  connectionState: ConnectionState;
}

const connectionConfig: Record<ConnectionState, { color: string; pulse: boolean; label: string }> = {
  connected: { color: 'bg-green-400', pulse: true, label: 'Connected' },
  connecting: { color: 'bg-yellow-400', pulse: false, label: 'Connecting' },
  disconnected: { color: 'bg-red-400', pulse: false, label: 'Disconnected' },
};

function Header({ agents, connectionState }: HeaderProps) {
  const navigate = useNavigate();
  const activeCount = agents.filter((a) => a.status === 'active').length;
  const conn = connectionConfig[connectionState];

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-16 bg-dark-925 border-b border-dark-800 flex items-center justify-between px-6">
      <div className="flex items-center gap-3">
        {/* Lumi logo — stylised "L" in purple gradient */}
        <svg
          width="32"
          height="32"
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="lumi-grad" x1="0" y1="0" x2="32" y2="32">
              <stop offset="0%" stopColor="#9333ff" />
              <stop offset="100%" stopColor="#6b00f0" />
            </linearGradient>
          </defs>
          <rect width="32" height="32" rx="8" fill="url(#lumi-grad)" />
          <path
            d="M10 8V20H22"
            stroke="white"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="22" cy="12" r="3" fill="white" opacity="0.6" />
        </svg>
        <span className="text-lg font-semibold text-dark-100">Agent Manager</span>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/settings')}
          className="p-2 rounded-lg bg-dark-900 border border-dark-800 text-dark-400 hover:text-dark-200 transition-colors"
          title="Settings"
        >
          <Settings size={18} />
        </button>
        <NotificationToggle />
        <div className="flex items-center gap-2 px-3 py-1.5 bg-dark-900 rounded-full border border-dark-800">
          <div className="relative group">
            <div
              className={`w-2 h-2 rounded-full ${conn.color} ${conn.pulse ? 'animate-pulse' : ''}`}
            />
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-dark-800 border border-dark-700 rounded text-xs text-dark-300 whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity">
              SSE: {conn.label}
            </div>
          </div>
          <span className="text-sm text-dark-300">
            {agents.length} agent{agents.length !== 1 ? 's' : ''}
          </span>
          {activeCount > 0 && (
            <span className="text-xs text-lumi-400 font-medium">
              {activeCount} active
            </span>
          )}
        </div>
      </div>
    </header>
  );
}

export default Header;
