import type { Agent } from '../types';
import NotificationToggle from './NotificationToggle';

interface HeaderProps {
  agents: Agent[];
}

function Header({ agents }: HeaderProps) {
  const activeCount = agents.filter((a) => a.status === 'active').length;

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
        <NotificationToggle />
        <div className="flex items-center gap-2 px-3 py-1.5 bg-dark-900 rounded-full border border-dark-800">
          <div
            className={`w-2 h-2 rounded-full ${activeCount > 0 ? 'bg-green-400 animate-pulse' : 'bg-dark-600'}`}
          />
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
