import { useState, useEffect, useCallback, useRef } from 'react';
import type { Agent, AgentUpdate, AgentMessage } from '../types';
import { fetchAgent, fetchUpdates, fetchMessages, subscribeToEvents } from '../api';

/** Merge newly-fetched items into an existing list, appending only ids not already present. */
function mergeById<T extends { id: number }>(existing: T[], incoming: T[]): T[] {
  const knownIds = new Set(existing.map((item) => item.id));
  const fresh = incoming.filter((item) => !knownIds.has(item.id));
  if (fresh.length === 0) return existing;
  return [...existing, ...fresh].sort((a, b) => a.id - b.id);
}

/** Prepend an older page fetched via a `before` cursor, deduped by id. */
function prependById<T extends { id: number }>(existing: T[], older: T[]): T[] {
  const knownIds = new Set(existing.map((item) => item.id));
  const fresh = older.filter((item) => !knownIds.has(item.id));
  return [...fresh, ...existing].sort((a, b) => a.id - b.id);
}

export function useAgent(id: string) {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [updates, setUpdates] = useState<AgentUpdate[]>([]);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMoreUpdates, setHasMoreUpdates] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const updatesCursor = useRef<number | null>(null);
  const messagesCursor = useRef<number | null>(null);

  const refetch = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [agentData, updatesResult, messagesResult] = await Promise.all([
        fetchAgent(id),
        fetchUpdates(id),
        fetchMessages(id),
      ]);
      setAgent(agentData);
      setUpdates(updatesResult.items);
      setMessages(messagesResult.items);
      updatesCursor.current = updatesResult.nextCursor;
      messagesCursor.current = messagesResult.nextCursor;
      setHasMoreUpdates(updatesResult.hasMore);
      setHasMoreMessages(messagesResult.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch agent');
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Loads one older page of both updates and messages (via their stored cursors)
  // and prepends them — the counterpart to the live-append handled by SSE below.
  const loadMoreHistory = useCallback(async () => {
    if (isLoadingMore || (!hasMoreUpdates && !hasMoreMessages)) return;
    setIsLoadingMore(true);
    try {
      const [updatesResult, messagesResult] = await Promise.all([
        hasMoreUpdates && updatesCursor.current != null
          ? fetchUpdates(id, updatesCursor.current)
          : null,
        hasMoreMessages && messagesCursor.current != null
          ? fetchMessages(id, messagesCursor.current)
          : null,
      ]);
      if (updatesResult) {
        setUpdates((prev) => prependById(prev, updatesResult.items));
        updatesCursor.current = updatesResult.nextCursor;
        setHasMoreUpdates(updatesResult.hasMore);
      }
      if (messagesResult) {
        setMessages((prev) => prependById(prev, messagesResult.items));
        messagesCursor.current = messagesResult.nextCursor;
        setHasMoreMessages(messagesResult.hasMore);
      }
    } catch {
      // leave hasMore flags as-is so the user can retry
    } finally {
      setIsLoadingMore(false);
    }
  }, [id, hasMoreUpdates, hasMoreMessages, isLoadingMore]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useEffect(() => {
    const unsubscribe = subscribeToEvents((event) => {
      switch (event.type) {
        case 'agent-updated':
          if (event.data.id === id) {
            setAgent(event.data);
            // An update may have delivered pending messages — pull the latest page and
            // append only genuinely new items, so lazy-loaded older history isn't dropped.
            fetchUpdates(id).then((r) => setUpdates((prev) => mergeById(prev, r.items))).catch(() => {});
            fetchMessages(id).then((r) => setMessages((prev) => mergeById(prev, r.items))).catch(() => {});
          }
          break;
        case 'message-queued':
          if (event.data.agent_id === id) {
            setMessages((prev) => [...prev, event.data]);
          }
          break;
        case 'messages-acknowledged':
          if (event.data.agent_id === id) {
            const { ids, ack_content } = event.data;
            setMessages((prev) =>
              prev.map((msg) =>
                ids.includes(msg.id)
                  ? { ...msg, status: 'acknowledged' as const, ack_content }
                  : msg
              )
            );
          }
          break;
        case 'agent-deleted':
          if (event.data.id === id) {
            setAgent(null);
            setError('Agent has been deleted');
          }
          break;
      }
    });

    return unsubscribe;
  }, [id]);

  return {
    agent,
    updates,
    messages,
    loading,
    error,
    refetch,
    hasMoreHistory: hasMoreUpdates || hasMoreMessages,
    isLoadingMore,
    loadMoreHistory,
  };
}
