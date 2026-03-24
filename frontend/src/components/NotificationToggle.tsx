import { useState, useEffect, useCallback } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { fetchVapidPublicKey, subscribePush, unsubscribePush } from '../api';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

function NotificationToggle() {
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const isSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    setSupported(isSupported);

    if (!isSupported) {
      setLoading(false);
      return;
    }

    // Check current subscription status
    navigator.serviceWorker.ready.then((reg) => {
      reg.pushManager.getSubscription().then((sub) => {
        setSubscribed(!!sub);
        setLoading(false);
      });
    });

    // Timeout in case service worker never becomes ready
    const timeout = setTimeout(() => setLoading(false), 3000);
    return () => clearTimeout(timeout);
  }, []);

  const handleToggle = useCallback(async () => {
    if (loading) return;
    setError(null);

    if (!supported) {
      const isHTTPS = location.protocol === 'https:' || location.hostname === 'localhost';
      if (!isHTTPS) {
        setError('Push notifications require HTTPS. Access the dashboard via HTTPS to enable.');
      } else {
        setError('Push notifications are not supported in this browser.');
      }
      return;
    }

    setLoading(true);

    try {
      const reg = await navigator.serviceWorker.ready;

      if (subscribed) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await unsubscribePush(sub.endpoint);
          await sub.unsubscribe();
        }
        setSubscribed(false);
      } else {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          setError('Notification permission denied.');
          setLoading(false);
          return;
        }

        const vapidKey = await fetchVapidPublicKey();
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey).buffer as ArrayBuffer,
        });

        await subscribePush(sub);
        setSubscribed(true);
      }
    } catch (err) {
      console.error('Push toggle error:', err);
      setError('Failed to toggle notifications.');
    } finally {
      setLoading(false);
    }
  }, [subscribed, loading, supported]);

  // Auto-dismiss error after 5 seconds
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(t);
  }, [error]);

  return (
    <div className="relative">
      <button
        onClick={handleToggle}
        disabled={loading}
        className={`p-2 rounded-lg transition-colors ${
          subscribed
            ? 'bg-lumi-600/20 text-lumi-400 hover:bg-lumi-600/30'
            : 'bg-dark-900 text-dark-500 hover:text-dark-300 hover:bg-dark-800'
        } ${loading ? 'opacity-50 cursor-wait' : ''}`}
        title={subscribed ? 'Disable push notifications' : 'Enable push notifications'}
      >
        {subscribed ? <Bell size={18} /> : <BellOff size={18} />}
      </button>
      {error && (
        <div className="absolute right-0 top-full mt-2 w-64 p-3 bg-dark-900 border border-dark-700 rounded-lg text-xs text-dark-300 shadow-lg z-50">
          {error}
        </div>
      )}
    </div>
  );
}

export default NotificationToggle;
