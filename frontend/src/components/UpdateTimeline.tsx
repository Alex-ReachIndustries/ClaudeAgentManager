import { Activity, AlertTriangle, BarChart3, FileText, ArrowRightLeft, Download, Bot, User, Paperclip } from 'lucide-react';
import type { AgentUpdate, AgentFile } from '../types';
import { timeAgo } from '../utils/time';
import MermaidDiagram from './MermaidDiagram';
import ErrorBoundary from './ErrorBoundary';

interface UpdateTimelineProps {
  updates: AgentUpdate[];
  files?: AgentFile[];
}

type TimelineEntry =
  | { kind: 'update'; ts: string; data: AgentUpdate }
  | { kind: 'file'; ts: string; data: AgentFile };

function UpdateTimeline({ updates, files = [] }: UpdateTimelineProps) {
  // Merge updates and files into a single chronological timeline
  const entries: TimelineEntry[] = [
    ...updates.map((u): TimelineEntry => ({ kind: 'update', ts: u.timestamp, data: u })),
    ...files.map((f): TimelineEntry => ({ kind: 'file', ts: f.created_at, data: f })),
  ].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  if (entries.length === 0) {
    return (
      <div className="bg-dark-900 border border-dark-800 rounded-xl p-8 text-center">
        <Activity size={24} className="text-dark-600 mx-auto mb-3" />
        <p className="text-dark-500">No updates yet</p>
      </div>
    );
  }

  return (
    <div className="bg-dark-900 border border-dark-800 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-dark-800">
        <h2 className="text-sm font-semibold text-dark-300 uppercase tracking-wide">
          Timeline
        </h2>
      </div>
      <div className="max-h-[calc(100vh-320px)] overflow-y-auto p-4 space-y-3">
        {entries.map((entry, idx) => (
          <div
            key={entry.kind === 'update' ? `u-${entry.data.id}` : `f-${(entry.data as AgentFile).id}`}
            className="animate-in fade-in slide-in-from-top-1"
            style={{ animationDelay: `${Math.min(idx, 20) * 30}ms`, animationFillMode: 'both' }}
          >
            {entry.kind === 'update' ? (
              <UpdateItem update={entry.data as AgentUpdate} />
            ) : (
              <FileItem file={entry.data as AgentFile} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileItem({ file }: { file: AgentFile }) {
  const isUser = file.source === 'user';
  const downloadUrl = `/api/agents/${file.agent_id}/files/${file.id}`;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] p-3 rounded-lg border ${
          isUser
            ? 'bg-lumi-950/30 border-lumi-800/40 rounded-br-sm'
            : 'bg-dark-850 border-dark-800/50 rounded-bl-sm'
        }`}
      >
        <div className="flex items-center gap-2 mb-1.5">
          {isUser ? (
            <User size={14} className="text-lumi-400 shrink-0" />
          ) : (
            <Bot size={14} className="text-blue-400 shrink-0" />
          )}
          <span className="text-xs font-medium text-dark-400">
            {isUser ? 'You uploaded' : 'Claude generated'}
          </span>
          <span className="text-xs text-dark-600 ml-auto">{timeAgo(file.created_at)}</span>
        </div>
        <a
          href={downloadUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`flex items-center gap-2 p-2 rounded-md transition-colors ${
            isUser
              ? 'bg-lumi-950/40 hover:bg-lumi-900/40'
              : 'bg-dark-800/60 hover:bg-dark-800'
          }`}
        >
          <Paperclip size={14} className="text-dark-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-dark-200 truncate">{file.filename}</p>
            <p className="text-xs text-dark-500">{formatSize(file.size)}</p>
          </div>
          <Download size={14} className="text-dark-500 shrink-0" />
        </a>
        {file.description && (
          <p className="text-xs text-dark-500 mt-1.5 italic">{file.description}</p>
        )}
      </div>
    </div>
  );
}

/** Safely extract a displayable string from content that may be a string or object */
function contentText(content: unknown, ...keys: string[]): string {
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object') {
    for (const key of keys) {
      const val = (content as Record<string, unknown>)[key];
      if (typeof val === 'string') return val;
    }
  }
  return JSON.stringify(content);
}

function UpdateItem({ update }: { update: AgentUpdate }) {
  const timestamp = (
    <span className="text-xs text-dark-600 shrink-0">{timeAgo(update.timestamp)}</span>
  );

  switch (update.type) {
    case 'text': {
      return (
        <div className="flex items-start gap-3 p-3 rounded-lg bg-dark-850 border border-dark-800/50">
          <FileText size={16} className="text-dark-500 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-dark-200 whitespace-pre-wrap break-words">
              {contentText(update.content, 'text', 'message')}
            </p>
            {update.summary && (
              <p className="text-xs text-dark-500 mt-1 italic">{update.summary}</p>
            )}
          </div>
          {timestamp}
        </div>
      );
    }

    case 'progress': {
      const c = typeof update.content === 'object' ? update.content as Record<string, unknown> : {};
      const pct = Number(c.percentage ?? c.percent ?? 0);
      const desc = typeof c.description === 'string' ? c.description : (typeof update.content === 'string' ? update.content : undefined);
      return (
        <div className="flex items-start gap-3 p-3 rounded-lg bg-dark-850 border border-dark-800/50">
          <BarChart3 size={16} className="text-lumi-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            {desc && (
              <p className="text-sm text-dark-200 mb-2">{desc}</p>
            )}
            <div className="w-full bg-dark-800 rounded-full h-2">
              <div
                className="bg-gradient-to-r from-lumi-600 to-lumi-400 h-2 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
              />
            </div>
            <p className="text-xs text-dark-500 mt-1">{pct}%</p>
          </div>
          {timestamp}
        </div>
      );
    }

    case 'diagram': {
      const content = update.content as { mermaid?: string };
      return (
        <div className="p-3 rounded-lg bg-dark-850 border border-dark-800/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-dark-400 uppercase tracking-wide">
              Diagram
            </span>
            {timestamp}
          </div>
          {content.mermaid ? (
            <ErrorBoundary
              fallback={
                <div className="bg-dark-900 border border-red-500/30 rounded-lg p-4 text-center">
                  <p className="text-red-400 text-xs">Diagram rendering failed</p>
                </div>
              }
            >
              <MermaidDiagram chart={content.mermaid} />
            </ErrorBoundary>
          ) : (
            <p className="text-sm text-dark-500 italic">No diagram content</p>
          )}
        </div>
      );
    }

    case 'error': {
      return (
        <div className="flex items-start gap-3 p-3 rounded-lg bg-red-950/20 border border-red-800/30">
          <AlertTriangle size={16} className="text-red-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-red-300 break-words">
              {contentText(update.content, 'message', 'text')}
            </p>
          </div>
          {timestamp}
        </div>
      );
    }

    case 'status': {
      const c = typeof update.content === 'object' ? update.content as Record<string, unknown> : {};
      return (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-dark-850 border border-dark-800/50">
          <ArrowRightLeft size={16} className="text-dark-500 shrink-0" />
          <p className="text-sm text-dark-400 flex-1">
            {c.from && c.to ? (
              <>
                Status changed from{' '}
                <span className="font-medium text-dark-300">{String(c.from)}</span> to{' '}
                <span className="font-medium text-dark-300">{String(c.to)}</span>
              </>
            ) : (
              <span className="font-medium text-dark-300">
                {contentText(update.content, 'status', 'text')}
              </span>
            )}
          </p>
          {timestamp}
        </div>
      );
    }

    case 'relay': {
      const c = typeof update.content === 'object' ? update.content as Record<string, unknown> : {};
      const isSent = c.direction === 'sent';
      const peer = isSent ? String(c.to_title ?? c.to_id ?? '?') : String(c.from_title ?? c.from_id ?? '?');
      const msg = typeof c.message === 'string' ? c.message : contentText(update.content, 'relay', 'text');
      return (
        <div className={`flex items-start gap-3 p-3 rounded-lg border ${isSent ? 'bg-blue-950/20 border-blue-800/30' : 'bg-purple-950/20 border-purple-800/30'}`}>
          <ArrowRightLeft size={16} className={`mt-0.5 shrink-0 ${isSent ? 'text-blue-400' : 'text-purple-400'}`} />
          <div className="flex-1 min-w-0">
            <p className={`text-xs font-medium mb-1 ${isSent ? 'text-blue-400' : 'text-purple-400'}`}>
              {isSent ? `→ ${peer}` : `← ${peer}`}
            </p>
            <p className="text-sm text-dark-200 whitespace-pre-wrap break-words">{msg}</p>
          </div>
          {timestamp}
        </div>
      );
    }

    default:
      return (
        <div className="flex items-start gap-3 p-3 rounded-lg bg-dark-850 border border-dark-800/50">
          <Activity size={16} className="text-dark-500 mt-0.5 shrink-0" />
          <pre className="text-xs text-dark-400 flex-1 overflow-auto">
            {JSON.stringify(update.content, null, 2)}
          </pre>
          {timestamp}
        </div>
      );
  }
}

export default UpdateTimeline;
