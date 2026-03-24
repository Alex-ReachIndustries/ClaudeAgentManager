import type { Agent, AgentUpdate, AgentMessage, SSEEvent } from './types';

const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export async function fetchAgents(): Promise<Agent[]> {
  return request<Agent[]>('/agents');
}

export async function fetchAgent(id: string): Promise<Agent> {
  return request<Agent>(`/agents/${id}`);
}

export async function fetchUpdates(agentId: string): Promise<AgentUpdate[]> {
  const updates = await request<AgentUpdate[]>(`/agents/${agentId}/updates`);
  if (!updates) return [];
  return updates.map((u) => {
    let content = u.content;
    if (typeof content === 'string') {
      try {
        content = JSON.parse(content);
      } catch {
        // plain text content, keep as-is
      }
    }
    return { ...u, content };
  });
}

export async function fetchMessages(agentId: string): Promise<AgentMessage[]> {
  return request<AgentMessage[]>(`/agents/${agentId}/messages`);
}

export async function sendMessage(agentId: string, content: string): Promise<AgentMessage> {
  return request<AgentMessage>(`/agents/${agentId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}

export async function deleteAgent(agentId: string): Promise<void> {
  return request<void>(`/agents/${agentId}`, { method: 'DELETE' });
}

export async function updateAgent(
  agentId: string,
  fields: Partial<Pick<Agent, 'title' | 'status' | 'poll_delay_until'>>,
): Promise<Agent> {
  return request<Agent>(`/agents/${agentId}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
}

export async function markAgentRead(agentId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/agents/${agentId}/read`, { method: 'POST' });
}

export async function uploadFile(
  agentId: string,
  file: File,
): Promise<{ ok: boolean; file: { id: number; filename: string; mimetype: string; size: number } }> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}/agents/${agentId}/files`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }
  return res.json();
}

// --- Folder browser ---
export interface FolderEntry {
  name: string;
  path: string;
  hasChildren: boolean;
}

export async function fetchFolders(folderPath: string = ''): Promise<{ current: string; folders: FolderEntry[] }> {
  return request<{ current: string; folders: FolderEntry[] }>(`/folders?path=${encodeURIComponent(folderPath)}`);
}

// --- Agent close ---
export async function closeAgent(agentId: string): Promise<{ ok: boolean; terminated: boolean; pid: number | null }> {
  return request<{ ok: boolean; terminated: boolean; pid: number | null }>(`/agents/${agentId}/close`, { method: 'POST' });
}

// --- Launch requests ---
export async function createLaunchRequest(type: 'new' | 'resume', folderPath: string, resumeAgentId?: string): Promise<{ ok: boolean; request: unknown }> {
  return request<{ ok: boolean; request: unknown }>('/launch-requests', {
    method: 'POST',
    body: JSON.stringify({ type, folder_path: folderPath, resume_agent_id: resumeAgentId }),
  });
}

// --- Push notifications ---

export async function fetchVapidPublicKey(): Promise<string> {
  const { publicKey } = await request<{ publicKey: string }>('/push/vapid-public-key');
  return publicKey;
}

export async function subscribePush(subscription: PushSubscription): Promise<void> {
  const raw = subscription.toJSON();
  await request('/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({
      endpoint: raw.endpoint,
      keys: raw.keys,
    }),
  });
}

export async function unsubscribePush(endpoint: string): Promise<void> {
  await request('/push/unsubscribe', {
    method: 'POST',
    body: JSON.stringify({ endpoint }),
  });
}

export function subscribeToEvents(onEvent: (event: SSEEvent) => void): () => void {
  const es = new EventSource(`${BASE}/events`);

  const handleAgentUpdated = (e: MessageEvent) => {
    onEvent({ type: 'agent-updated', data: JSON.parse(e.data) });
  };

  const handleAgentDeleted = (e: MessageEvent) => {
    onEvent({ type: 'agent-deleted', data: JSON.parse(e.data) });
  };

  const handleMessageQueued = (e: MessageEvent) => {
    onEvent({ type: 'message-queued', data: JSON.parse(e.data) });
  };

  es.addEventListener('agent-updated', handleAgentUpdated);
  es.addEventListener('agent-deleted', handleAgentDeleted);
  es.addEventListener('message-queued', handleMessageQueued);

  return () => {
    es.removeEventListener('agent-updated', handleAgentUpdated);
    es.removeEventListener('agent-deleted', handleAgentDeleted);
    es.removeEventListener('message-queued', handleMessageQueued);
    es.close();
  };
}
