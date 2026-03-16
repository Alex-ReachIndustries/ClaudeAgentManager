import { useState, useEffect, useCallback } from 'react';
import type { Agent } from '../types';
import { fetchAgents, subscribeToEvents } from '../api';

export function useAgents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchAgents();
      setAgents(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch agents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useEffect(() => {
    const unsubscribe = subscribeToEvents((event) => {
      switch (event.type) {
        case 'agent-updated':
          setAgents((prev) => {
            const idx = prev.findIndex((a) => a.id === event.data.id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = event.data;
              return next;
            }
            return [event.data, ...prev];
          });
          break;
        case 'agent-deleted':
          setAgents((prev) => prev.filter((a) => a.id !== event.data.id));
          break;
        case 'message-queued':
          setAgents((prev) =>
            prev.map((a) =>
              a.id === event.data.agent_id
                ? { ...a, pending_message_count: a.pending_message_count + 1 }
                : a,
            ),
          );
          break;
      }
    });

    return unsubscribe;
  }, []);

  return { agents, loading, error, refetch };
}
