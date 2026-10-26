import { useEffect, useState } from 'react';
import { getSystemAlerts, subscribeSystemAlerts, type SystemAlert } from '../api';

const DISMISSED_KEY = 'cm-dismissed-system-alerts';

function loadDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(DISMISSED_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function saveDismissed(ids: Set<string>) {
  try {
    sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids].slice(-100)));
  } catch { /* storage unavailable: dismissals last for this page only */ }
}

const STYLES: Record<SystemAlert['severity'], string> = {
  critical: 'bg-red-900/30 border-red-700/50 text-red-300',
  warning: 'bg-yellow-950/20 border-yellow-700/50 text-yellow-300',
  info: 'bg-dark-900 border-dark-700 text-dark-200',
};

/**
 * Host-level alert (fleet silent, usage limit nearing) shown under the header. Shows the newest
 * alert the user hasn't dismissed; a "fleet back online" alert supersedes "fleet silent".
 */
function SystemAlertBanner() {
  const [alerts, setAlerts] = useState<SystemAlert[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(loadDismissed);

  useEffect(() => {
    getSystemAlerts().then(setAlerts).catch(() => { /* backend without alerts: show nothing */ });
    return subscribeSystemAlerts((alert) => {
      setAlerts((prev) => [alert, ...prev.filter((a) => a.id !== alert.id)].slice(0, 50));
    });
  }, []);

  const latest = alerts.find((a) => !dismissed.has(a.id));
  if (!latest) return null;
  // Recovery clears a silence banner. It is shown once, then dismissed like any other alert.
  const dismiss = () => {
    const next = new Set(dismissed);
    next.add(latest.id);
    if (latest.kind === 'fleet-recovered') {
      alerts.filter((a) => a.kind === 'fleet-silent').forEach((a) => next.add(a.id));
    }
    setDismissed(next);
    saveDismissed(next);
  };
  if (latest.kind === 'fleet-silent') {
    const newerRecovery = alerts.find((a) => a.kind === 'fleet-recovered' && a.created_at > latest.created_at);
    if (newerRecovery) return null;
  }

  const time = new Date(latest.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <div
      role={latest.severity === 'info' ? 'status' : 'alert'}
      className={`mx-4 mt-3 sm:mx-6 px-4 py-3 rounded-lg border text-sm flex items-start gap-3 ${STYLES[latest.severity]}`}
    >
      <div className="flex-1 min-w-0">
        <div className="font-semibold">
          {latest.title} <span className="font-normal opacity-70">· {time}</span>
        </div>
        <div className="opacity-90 break-words">{latest.message}</div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss alert"
        className="shrink-0 px-2 py-0.5 rounded opacity-70 hover:opacity-100"
      >
        ✕
      </button>
    </div>
  );
}

export default SystemAlertBanner;
