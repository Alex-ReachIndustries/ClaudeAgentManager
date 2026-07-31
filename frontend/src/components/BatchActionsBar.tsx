import { useState } from 'react';
import { X, MessageSquare, Archive, XCircle, ArchiveRestore } from 'lucide-react';
import type { Agent } from '../types';
import { updateAgent, createLaunchRequest, sendMessage as apiSendMessage } from '../api';

interface BatchActionsBarProps {
  selected: Set<string>;
  agents: Agent[];
  onClear: () => void;
  onRefetch: () => void;
}

function BatchActionsBar({ selected, agents, onClear, onRefetch }: BatchActionsBarProps) {
  const [msgMode, setMsgMode] = useState(false);
  const [msgInput, setMsgInput] = useState('');
  const [working, setWorking] = useState(false);

  const selectedAgents = agents.filter(a => selected.has(a.id));
  const count = selectedAgents.length;
  if (count === 0) return null;

  const anyArchived = selectedAgents.some(a => a.status === 'archived');
  const anyWithPid = selectedAgents.some(a => a.pid);

  const handleArchive = async () => {
    setWorking(true);
    try {
      await Promise.all(selectedAgents.map(a => updateAgent(a.id, { status: 'archived' })));
      onClear();
      onRefetch();
    } finally { setWorking(false); }
  };

  const handleUnarchive = async () => {
    setWorking(true);
    try {
      await Promise.all(selectedAgents.map(a => updateAgent(a.id, { status: 'active' })));
      onClear();
      onRefetch();
    } finally { setWorking(false); }
  };

  const handleTerminate = async () => {
    setWorking(true);
    try {
      const withPid = selectedAgents.filter(a => a.pid);
      await Promise.all(withPid.map(a =>
        // resume_agent_id (a.id) is required by the backend for terminate; without it every
        // request 400s. Pass wt_window so the launcher can target the right tmux session.
        createLaunchRequest('terminate', '', a.id, a.wt_window || undefined, a.pid)
      ));
      onClear();
      onRefetch();
    } finally { setWorking(false); }
  };

  const handleSend = async () => {
    if (!msgInput.trim()) return;
    setWorking(true);
    try {
      await Promise.all(selectedAgents.map(a => apiSendMessage(a.id, msgInput.trim())));
      setMsgInput('');
      setMsgMode(false);
      onClear();
      onRefetch();
    } finally { setWorking(false); }
  };

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-lg px-4">
      <div className="bg-dark-800 border border-dark-600 rounded-2xl shadow-2xl overflow-hidden">
        {msgMode && (
          <div className="p-3 border-b border-dark-700">
            <textarea
              autoFocus
              value={msgInput}
              onChange={e => setMsgInput(e.target.value)}
              placeholder={`Message to ${count} agent${count !== 1 ? 's' : ''}…`}
              rows={2}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend(); }}
              className="w-full bg-dark-850 border border-dark-700 rounded-lg px-3 py-2 text-sm text-dark-100 placeholder-dark-600 resize-none focus:outline-none focus:ring-2 focus:ring-lumi-500/30"
            />
            <div className="flex justify-end gap-2 mt-2">
              <button onClick={() => setMsgMode(false)} className="px-3 py-1.5 text-xs text-dark-400 hover:text-dark-200 transition-colors">
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled={!msgInput.trim() || working}
                className="px-3 py-1.5 text-xs bg-lumi-600 hover:bg-lumi-500 disabled:bg-dark-700 disabled:text-dark-500 text-white rounded-lg transition-colors"
              >
                {working ? 'Sending…' : `Send to ${count}`}
              </button>
            </div>
          </div>
        )}
        <div className="flex items-center gap-1 px-4 py-3 flex-wrap">
          <span className="text-sm font-medium text-dark-100 shrink-0 mr-2">
            {count} selected
          </span>
          <button
            onClick={() => setMsgMode(m => !m)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors ${
              msgMode ? 'text-lumi-300 bg-lumi-950/30' : 'text-dark-300 hover:text-lumi-300 hover:bg-lumi-950/20'
            }`}
          >
            <MessageSquare size={13} />
            Message
          </button>
          {anyArchived ? (
            <button
              onClick={handleUnarchive}
              disabled={working}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-dark-300 hover:text-yellow-300 hover:bg-yellow-950/20 rounded-lg transition-colors disabled:opacity-50"
            >
              <ArchiveRestore size={13} />
              Unarchive
            </button>
          ) : (
            <button
              onClick={handleArchive}
              disabled={working}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-dark-300 hover:text-yellow-300 hover:bg-yellow-950/20 rounded-lg transition-colors disabled:opacity-50"
            >
              <Archive size={13} />
              Archive
            </button>
          )}
          {anyWithPid && (
            <button
              onClick={handleTerminate}
              disabled={working}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-dark-300 hover:text-red-400 hover:bg-red-950/20 rounded-lg transition-colors disabled:opacity-50"
            >
              <XCircle size={13} />
              Terminate
            </button>
          )}
          <button
            onClick={onClear}
            className="ml-auto p-1.5 text-dark-500 hover:text-dark-200 hover:bg-dark-700 rounded-lg transition-colors"
            title="Clear selection"
          >
            <X size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default BatchActionsBar;
