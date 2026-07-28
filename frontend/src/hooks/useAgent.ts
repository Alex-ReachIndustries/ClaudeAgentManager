import { useState, useEffect, useCallback } from 'react';
import type { Agent, AgentUpdate, AgentMessage, TerminalLine } from '../types';
import { fetchAgent, fetchUpdates, fetchMessages, subscribeToEvents } from '../api';

const LIVE_TERMINAL_SCROLLBACK = 500;

export function useAgent(id: string) {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [updates, setUpdates] = useState<AgentUpdate[]>([]);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [liveTerminalLines, setLiveTerminalLines] = useState<TerminalLine[]>([]);
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
        case 'terminal-output':
          if (event.data.agentId === id) {
            setLiveTerminalLines((prev) => {
              const next = [...prev, { output: event.data.output, timestamp: event.data.timestamp }];
              return next.length > LIVE_TERMINAL_SCROLLBACK ? next.slice(-LIVE_TERMINAL_SCROLLBACK) : next;
            });
          }
          break;
      }
    });

    return unsubscribe;
  }, [id]);

  return { agent, updates, messages, liveTerminalLines, loading, error, refetch };
}
