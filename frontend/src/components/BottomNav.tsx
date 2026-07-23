import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { LayoutGrid, FolderKanban, BookOpen, ClipboardCheck, Settings } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { fetchKbStats, subscribeKnowledgePending } from '../api';

interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  /** match active state on exact path only */
  exact?: boolean;
}

const items: NavItem[] = [
  { label: 'Agents', path: '/', icon: LayoutGrid, exact: true },
  { label: 'Projects', path: '/projects', icon: FolderKanban },
  { label: 'Knowledge', path: '/knowledge', icon: BookOpen, exact: true },
  { label: 'Pending', path: '/knowledge/pending', icon: ClipboardCheck },
  { label: 'Settings', path: '/settings', icon: Settings },
];

function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const [pendingKb, setPendingKb] = useState(0);

  const refreshKbCount = useCallback(async () => {
    try {
      const stats = await fetchKbStats();
      setPendingKb(stats.pending_queue ?? 0);
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { refreshKbCount(); }, [refreshKbCount]);

  useEffect(() => {
    const unsub = subscribeKnowledgePending(() => { refreshKbCount(); });
    return unsub;
  }, [refreshKbCount]);

  const isActive = (item: NavItem) => {
    if (item.exact) return location.pathname === item.path;
    return location.pathname === item.path || location.pathname.startsWith(`${item.path}/`);
  };

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-dark-900/95 backdrop-blur border-t border-dark-800 pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-stretch justify-around h-14">
        {items.map((item) => {
          const active = isActive(item);
          const Icon = item.icon;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors ${
                active ? 'text-lumi-500' : 'text-dark-400'
              }`}
              title={item.label}
            >
              <span className="relative">
                <Icon size={20} strokeWidth={active ? 2.4 : 2} />
                {item.label === 'Pending' && pendingKb > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-[16px] h-[16px] px-1 flex items-center justify-center rounded-full bg-lumi-600 text-white text-[9px] font-semibold leading-none">
                    {pendingKb > 99 ? '99+' : pendingKb}
                  </span>
                )}
              </span>
              <span className="text-[10px] font-medium leading-none">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export default BottomNav;
