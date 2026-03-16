import { useState, useEffect, useCallback } from 'react';
import type { Agent, AgentUpdate, AgentMessage } from '../types';
import { fetchAgent, fetchUpdates, fetchMessages, subscribeToEvents } from '../api';

export function useAgent(id: string) {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [updates, setUpdates] = useState<AgentUpdate[]>([]);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [agentData, updatesData, messagesData] = await Promise.all([
        fetchAgent(id),
        fetchUpdates(id),
        fetchMessages(id),
      ]);
      setAgent(agentData);
      setUpdates(updatesData);
      setMessages(messagesData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch agent');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useEffect(() => {
    const unsubscribe = subscribeToEvents((event) => {
      switch (event.type) {
        case 'agent-updated':
          if (event.data.id === id) {
            setAgent(event.data);
            // Refetch updates and messages — an update may have delivered pending messages
            fetchUpdates(id).then(setUpdates).catch(() => {});
            fetchMessages(id).then(setMessages).catch(() => {});
          }
          break;
        case 'message-queued':
          if (event.data.agent_id === id) {
            setMessages((prev) => [...prev, event.data]);
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

  return { agent, updates, messages, loading, error, refetch };
}
