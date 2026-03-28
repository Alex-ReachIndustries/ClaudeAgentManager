import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff, Copy, Check, RotateCcw, Key } from 'lucide-react';
import { getStoredApiKey, setApiKey, rotateApiKey as apiRotateKey } from '../api';

export default function Settings() {
  const navigate = useNavigate();
  const [key, setKey] = useState(getStoredApiKey() || '');
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(!getStoredApiKey());
  const [rotating, setRotating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    if (!key.trim()) return;
    setApiKey(key.trim());
    setEditing(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRotate = async () => {
    if (!confirm('Rotate API key? All clients will need the new key.')) return;
    setRotating(true);
    setError(null);
    try {
      const newKey = await apiRotateKey();
      setKey(newKey);
      setShowKey(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rotate key');
    } finally {
      setRotating(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      <button
        onClick={() => navigate('/')}
        className="flex items-center gap-2 text-dark-400 hover:text-dark-100 mb-6 transition-colors"
      >
        <ArrowLeft size={18} />
        <span>Back to Dashboard</span>
      </button>

      <h1 className="text-2xl font-semibold text-dark-100 mb-8">Settings</h1>

      {/* API Key Section */}
      <div className="bg-dark-900 border border-dark-700 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-lumi-600/20 rounded-lg">
            <Key size={20} className="text-lumi-400" />
          </div>
          <div>
            <h2 className="text-lg font-medium text-dark-100">API Key</h2>
            <p className="text-sm text-dark-400">Authentication key for all API requests</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">
            {error}
          </div>
        )}

        {saved && (
          <div className="mb-4 p-3 bg-green-900/30 border border-green-700/50 rounded-lg text-green-300 text-sm">
            API key saved successfully
          </div>
        )}

        <div className="space-y-4">
          {editing ? (
            <div className="space-y-3">
              <input
                type="text"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="Enter your API key"
                className="w-full px-4 py-2.5 bg-dark-800 border border-dark-600 rounded-lg text-dark-100 text-sm font-mono placeholder-dark-500 focus:outline-none focus:border-lumi-500"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  disabled={!key.trim()}
                  className="px-4 py-2 bg-lumi-600 hover:bg-lumi-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors"
                >
                  Save Key
                </button>
                {getStoredApiKey() && (
                  <button
                    onClick={() => { setKey(getStoredApiKey() || ''); setEditing(false); }}
                    className="px-4 py-2 bg-dark-800 hover:bg-dark-700 text-dark-300 text-sm rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="flex-1 px-4 py-2.5 bg-dark-800 border border-dark-700 rounded-lg text-sm font-mono text-dark-300 overflow-hidden">
                  {showKey ? key : '•'.repeat(Math.min(key.length, 40))}
                </div>
                <button
                  onClick={() => setShowKey(!showKey)}
                  className="p-2.5 bg-dark-800 hover:bg-dark-700 border border-dark-700 rounded-lg text-dark-400 hover:text-dark-200 transition-colors"
                  title={showKey ? 'Hide key' : 'Show key'}
                >
                  {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
                <button
                  onClick={handleCopy}
                  className="p-2.5 bg-dark-800 hover:bg-dark-700 border border-dark-700 rounded-lg text-dark-400 hover:text-dark-200 transition-colors"
                  title="Copy to clipboard"
                >
                  {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setEditing(true)}
                  className="px-4 py-2 bg-dark-800 hover:bg-dark-700 text-dark-300 text-sm rounded-lg transition-colors"
                >
                  Change Key
                </button>
                <button
                  onClick={handleRotate}
                  disabled={rotating}
                  className="flex items-center gap-2 px-4 py-2 bg-dark-800 hover:bg-dark-700 text-dark-300 text-sm rounded-lg transition-colors disabled:opacity-50"
                >
                  <RotateCcw size={14} className={rotating ? 'animate-spin' : ''} />
                  {rotating ? 'Rotating...' : 'Rotate Key'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
