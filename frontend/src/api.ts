import type { Agent, AgentUpdate, AgentMessage, SSEEvent } from './types';

const BASE = '/api';

// --- API Key management ---
let apiKey: string | null = localStorage.getItem('cm-api-key');

export function getStoredApiKey(): string | null {
  return apiKey;
}

export function setApiKey(key: string): void {
  apiKey = key;
  localStorage.setItem('cm-api-key', key);
}

export function clearApiKey(): void {
  apiKey = null;
  localStorage.removeItem('cm-api-key');
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  return headers;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: authHeaders(),
    ...options,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export async function fetchAnalytics() {
  return request<{
    totalAgents: number;
    activeNow: number;
    updatesToday: number;
    messagesToday: number;
    statusCounts: { status: string; count: number }[];
  }>('/agents/analytics');
}

export async function fetchAgents(): Promise<Agent[]> {
  const result = await request<{ data: Agent[] } | Agent[]>('/agents');
  // Handle both paginated and legacy response formats
  return Array.isArray(result) ? result : result.data;
}

export async function fetchAgent(id: string): Promise<Agent> {
  return request<Agent>(`/agents/${id}`);
}

export async function fetchUpdates(agentId: string): Promise<AgentUpdate[]> {
  const result = await request<{ data: AgentUpdate[] } | AgentUpdate[]>(`/agents/${agentId}/updates`);
  const updates = Array.isArray(result) ? result : result.data;
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
  const result = await request<{ data: AgentMessage[] } | AgentMessage[]>(`/agents/${agentId}/messages`);
  return Array.isArray(result) ? result : result.data;
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
  const headers: Record<string, string> = {};
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  const res = await fetch(`${BASE}/agents/${agentId}/files`, {
    method: 'POST',
    headers,
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

// --- Auth endpoints ---
export async function fetchApiKey(): Promise<string> {
  const { apiKey: key } = await request<{ apiKey: string }>('/auth/key');
  return key;
}

export async function rotateApiKey(): Promise<string> {
  const { apiKey: key } = await request<{ apiKey: string }>('/auth/rotate', { method: 'POST' });
  setApiKey(key);
  return key;
}

// --- SSE connection state tracking ---
export type ConnectionState = 'connected' | 'connecting' | 'disconnected';

type ConnectionListener = (state: ConnectionState) => void;
const connectionListeners = new Set<ConnectionListener>();

export function onConnectionChange(listener: ConnectionListener): () => void {
  connectionListeners.add(listener);
  return () => { connectionListeners.delete(listener); };
}

function notifyConnectionState(state: ConnectionState) {
  connectionListeners.forEach((fn) => fn(state));
}

export function subscribeToEvents(
  onEvent: (event: SSEEvent) => void,
  onConnectionStateChange?: (state: ConnectionState) => void,
): () => void {
  const tokenParam = apiKey ? `?token=${encodeURIComponent(apiKey)}` : '';
  const es = new EventSource(`${BASE}/events${tokenParam}`);

  const emitState = (state: ConnectionState) => {
    notifyConnectionState(state);
    onConnectionStateChange?.(state);
  };

  // EventSource starts in CONNECTING state
  emitState('connecting');

  es.onopen = () => {
    emitState('connected');
  };

  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) {
      emitState('disconnected');
    } else {
      emitState('connecting');
    }
  };

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
    emitState('disconnected');
  };
}
