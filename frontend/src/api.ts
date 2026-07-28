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
  // Attribute KB searches/opens/proposals made from the dashboard to the human user
  // (only the KB routes read this header; everything else ignores it).
  headers['X-Agent-Id'] = 'user';
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

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: number | null;
  hasMore: boolean;
}

export async function fetchUpdates(agentId: string, before?: number): Promise<PaginatedResult<AgentUpdate>> {
  const query = before ? `?before=${before}` : '';
  const result = await request<{ data: AgentUpdate[]; next_cursor: number | null; has_more: boolean } | AgentUpdate[]>(`/agents/${agentId}/updates${query}`);
  const raw = Array.isArray(result) ? result : result.data;
  const items = (raw ?? []).map((u) => {
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
  return {
    items,
    nextCursor: Array.isArray(result) ? null : result.next_cursor,
    hasMore: Array.isArray(result) ? false : result.has_more,
  };
}

export async function fetchMessages(agentId: string, before?: number): Promise<PaginatedResult<AgentMessage>> {
  const query = before ? `?before=${before}` : '';
  const result = await request<{ data: AgentMessage[]; next_cursor: number | null; has_more: boolean } | AgentMessage[]>(`/agents/${agentId}/messages${query}`);
  const items = Array.isArray(result) ? result : (result.data ?? []);
  return {
    items,
    nextCursor: Array.isArray(result) ? null : result.next_cursor,
    hasMore: Array.isArray(result) ? false : result.has_more,
  };
}

export interface ReplyRef {
  reply_to_kind: 'message' | 'update' | 'file';
  reply_to_id: number;
  reply_to_label?: string;
  reply_to_snippet?: string;
}

export async function sendMessage(agentId: string, content: string, reply?: ReplyRef): Promise<AgentMessage> {
  return request<AgentMessage>(`/agents/${agentId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content, ...(reply ?? {}) }),
  });
}

export async function updateAgent(
  agentId: string,
  fields: Partial<Pick<Agent, 'title' | 'status' | 'poll_delay_until' | 'role' | 'effort' | 'model' | 'wt_window'>>,
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

/**
 * Fetch a binary PDF response. Bypasses request() (which assumes JSON) and,
 * like uploadFile, attaches the API key by hand since raw fetch() otherwise
 * sends no auth header at all.
 */
export async function exportPdf(path: string, options?: RequestInit): Promise<Blob> {
  const headers: Record<string, string> = {};
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }
  return res.blob();
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

export async function sendSignal(agentId: string, signal: 'ctrl-c' | 'enter'): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/agents/${agentId}/signal`, { method: 'POST', body: JSON.stringify({ signal }) });
}

// Display-only — hits the /preview endpoint, never the delivery route, so viewing
// this never marks rules as delivered to the agent (see backend route comment).
export async function fetchAgentRules(agentId: string): Promise<string> {
  const res = await fetch(`${BASE}/agents/${agentId}/rules/preview`, { headers: authHeaders() });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }
  return res.text();
}

// --- Launch requests ---
export async function fetchWtWindows(): Promise<string[]> {
  return request<string[]>('/agents/wt-windows');
}

export async function createLaunchRequest(
  type: 'new' | 'resume' | 'terminate' | 'terminate-resume',
  folderPath: string,
  resumeAgentId?: string,
  wtWindow?: string,
  targetPid?: number | null,
  role?: string,
  task?: string,
  effort?: string,
  model?: string,
): Promise<{ ok: boolean; request: unknown }> {
  return request<{ ok: boolean; request: unknown }>('/launch-requests', {
    method: 'POST',
    body: JSON.stringify({
      type,
      folder_path: folderPath,
      resume_agent_id: resumeAgentId,
      wt_window: wtWindow || undefined,
      target_pid: targetPid || undefined,
      role: role || undefined,
      task: task || undefined,
      effort: effort || undefined,
      model: model || undefined,
    }),
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

// --- Webhooks ---
export async function fetchWebhooks() { return request<any[]>('/webhooks'); }
export async function createWebhook(url: string, events: string[]) { return request('/webhooks', { method: 'POST', body: JSON.stringify({ url, events }) }); }
export async function updateWebhook(id: number, fields: any) { return request(`/webhooks/${id}`, { method: 'PATCH', body: JSON.stringify(fields) }); }
export async function deleteWebhook(id: number) { return request(`/webhooks/${id}`, { method: 'DELETE' }); }
export async function testWebhook(id: number) { return request(`/webhooks/${id}/test`, { method: 'POST' }); }

// --- Retention ---
export async function fetchRetentionStatus() { return request<any>('/retention/status'); }
export async function updateRetentionSettings(settings: any) { return request('/retention/settings', { method: 'PATCH', body: JSON.stringify(settings) }); }
export async function runRetention() { return request<any>('/retention/run', { method: 'POST' }); }

// --- Files ---
export async function fetchAgentFiles(agentId: string) { return request<any[]>(`/agents/${agentId}/files`); }

// --- Costs ---
export interface AgentCostEvent {
  id: number;
  agent_id: string;
  label: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  created_at: string;
}
export interface AgentCostBreakdown {
  total: { input_tokens: number; output_tokens: number; cost_usd: number };
  breakdown: {
    label: string;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
    event_count: number;
    first_at: string;
    last_at: string;
  }[];
  events?: AgentCostEvent[];
}
export async function fetchAgentCosts(agentId: string): Promise<AgentCostBreakdown> {
  return request<AgentCostBreakdown>(`/agents/${agentId}/costs?detail=true`);
}

export interface FleetCostAnalytics {
  total: { input_tokens: number; output_tokens: number; cost_usd: number };
  agents: {
    id: string;
    title: string;
    project_id: string | null;
    costs: { input_tokens: number; output_tokens: number; cost_usd: number };
  }[];
}
export async function fetchFleetCosts(): Promise<FleetCostAnalytics> {
  return request<FleetCostAnalytics>(`/agents/analytics/costs`);
}

// --- Roles ---
export interface Role {
  id: string;
  displayName: string;
  category: string;
  fullDefinition: string;
}
export async function fetchRoles(): Promise<Role[]> { return request<Role[]>('/roles'); }

// --- Projects ---
export async function fetchProjects() { return request<any[]>('/projects'); }
export async function createProject(data: {name: string, description: string, folder_path: string, max_concurrent?: number, pm_role?: string, pm_effort?: string, pm_model?: string, agent_effort?: string, agent_model?: string}) { return request('/projects', { method: 'POST', body: JSON.stringify(data) }); }
export async function fetchProject(id: string) { return request<any>(`/projects/${id}`); }
export async function fetchProjectAgents(id: string) { return request<any>(`/projects/${id}/agents`); }
export async function fetchProjectUpdates(id: string) { return request<any>(`/projects/${id}/updates`); }
export async function startProject(id: string, initialPrompt?: string) { return request(`/projects/${id}/start`, { method: 'POST', body: JSON.stringify({ initial_prompt: initialPrompt || '' }) }); }
export async function pauseProject(id: string) { return request(`/projects/${id}/pause`, { method: 'POST' }); }
export async function completeProject(id: string) { return request(`/projects/${id}/complete`, { method: 'POST' }); }
export async function deleteProject(id: string) { return request(`/projects/${id}`, { method: 'DELETE' }); }
export async function spawnProjectAgent(id: string, role: string, prompt: string, effort?: string, model?: string) { return request(`/projects/${id}/spawn-agent`, { method: 'POST', body: JSON.stringify({ role, prompt, ...(effort && { effort }), ...(model && { model }) }) }); }
export async function addProjectUpdate(id: string, type: string, content: string) { return request(`/projects/${id}/updates`, { method: 'POST', body: JSON.stringify({ type, content }) }); }
export async function fetchProjectFiles(id: string) { return request<any[]>(`/projects/${id}/files`); }

// --- Workflows ---
export async function fetchWorkflows() { return request<any[]>('/workflows'); }
export async function fetchWorkflow(id: string) { return request<any>(`/workflows/${id}`); }
export async function createWorkflow(data: any) { return request('/workflows', { method: 'POST', body: JSON.stringify(data) }); }
export async function startWorkflow(id: string) { return request(`/workflows/${id}/start`, { method: 'POST' }); }
export async function pauseWorkflow(id: string) { return request(`/workflows/${id}/pause`, { method: 'POST' }); }
export async function deleteWorkflow(id: string) { return request(`/workflows/${id}`, { method: 'DELETE' }); }

// --- Knowledge Hub (KB) ---
export interface KbSearchResult {
  id: string | number;
  type: 'knowledge' | 'profile';
  title: string;
  snippet: string;
  status: string;
  score: number;
  tags: string[];
  systems: string[];
}
export interface KbSearchResponse {
  query: string;
  type: string;
  embeddingsReady: boolean;
  results: KbSearchResult[];
}
export interface KbStats {
  entries: { total: number; approved: number; pending: number; rejected: number; superseded: number };
  pending_queue: number;
  flagged_for_review: number;
  profiles: number;
  stale_entries: number;
  stale_profiles: number;
  usage_7d?: { accesses: number; searches: number; hit_rate: number | null };
  embeddingsReady: boolean;
  embedDim: number;
}

export interface KbAnalytics {
  days: number;
  logging_since: string | null;
  surfacing?: { surfaces: number; entries_surfaced: number; entries_opened: number; open_rate: number | null };
  knowledge_wanted?: { open: number; top: { id: number; query: string; times: number; last_seen: string }[] };
  window_totals: { search: number; view: number; related: number; propose: number; surface?: number };
  all_time_totals: { search: number; view: number; related: number; propose: number; surface?: number };
  timeseries: { date: string; search: number; view: number; related: number; propose: number }[];
  search: { total: number; hits: number; misses: number; hit_rate: number | null; avg_latency_ms: number | null };
  gaps: { query: string; times: number; last_at: string }[];
  weak: { query: string; times: number; avg_top_score: number; last_at: string }[];
  top_queries: { query: string; times: number; hits: number; last_at: string }[];
  top_entries: { entry_id: number; title: string | null; status: string | null; views: number; last_at: string }[];
  by_agent: { agent: string; searches: number; views: number; related: number; proposals: number; total: number; last_at: string }[];
  never_accessed: { count: number; sample: { id: number; title: string; created_at: string }[] };
}

export async function searchKnowledge(q: string, type: 'all' | 'knowledge' | 'profile' = 'all', limit = 20): Promise<KbSearchResponse> {
  const params = new URLSearchParams({ q, type, limit: String(limit) });
  return request<KbSearchResponse>(`/kb/search?${params.toString()}`);
}

export async function getKnowledgeEntry(id: string | number): Promise<any> {
  return request<any>(`/kb/${id}`);
}

export async function proposeKnowledge(data: {
  kind: 'new' | 'edit';
  entry_id?: string | number;
  title?: string;
  body?: string;
  category?: string;
  tags?: string[];
  systems?: string[];
  source?: string;
  agent?: string;
  rationale?: string;
}): Promise<{ entry_id: string | number; pending_id: string | number; conflicts: { entry_id: string | number; title: string; note: string }[] }> {
  return request(`/kb/propose`, { method: 'POST', body: JSON.stringify(data) });
}

export async function fetchPendingKnowledge(): Promise<{ data: any[] }> {
  return request<{ data: any[] }>(`/kb/pending`);
}

export async function decidePending(
  id: string | number,
  body: { decision: 'accept' | 'update' | 'reject'; edits?: any; note?: string; decidedBy?: string },
): Promise<{ ok: boolean; entry_id: string | number }> {
  return request(`/kb/pending/${id}/decide`, { method: 'POST', body: JSON.stringify(body) });
}

export async function fetchKbProfiles(): Promise<{ data: any[] }> {
  return request<{ data: any[] }>(`/kb/profiles`);
}

export async function fetchKbProfile(name: string): Promise<any> {
  return request<any>(`/kb/profiles/${encodeURIComponent(name)}`);
}

export async function fetchKbStats(): Promise<KbStats> {
  return request<KbStats>(`/kb/stats`);
}

export async function fetchKbAnalytics(days = 30): Promise<KbAnalytics> {
  return request<KbAnalytics>(`/kb/analytics?days=${encodeURIComponent(String(days))}`);
}

export async function decideKbWanted(id: number, status: 'filled' | 'dismissed' | 'open'): Promise<{ ok: boolean }> {
  return request(`/kb/wanted/${id}/decide`, { method: 'POST', body: JSON.stringify({ status, by: 'dashboard' }) });
}

// --- KB Category Tree / membership ---
export interface TreeNode {
  id: number;
  name: string;
  parent_id: number | null;
  description: string | null;
  sort_order: number;
  direct_count: number;
  descendant_count: number;
  children: TreeNode[];
}
export interface CategoryRow {
  id: number;
  name: string;
  parent_id: number | null;
  description: string | null;
  sort_order: number;
}
export interface EntryCategory {
  id: number;
  name: string;
  path: string;
  source: 'auto' | 'manual';
  score: number | null;
}
export interface KbEntry {
  id: string | number;
  title: string;
  body?: string;
  snippet?: string;
  tags?: string[];
  systems?: string[];
  status?: string;
  categories?: EntryCategory[];
  [key: string]: any;
}
export interface RelatedEntry {
  id: string | number;
  title: string;
  snippet: string;
  score: number;
  via: 'semantic' | 'category';
}

export async function fetchKbTree(): Promise<{ tree: TreeNode[] }> {
  return request<{ tree: TreeNode[] }>(`/kb/tree`);
}

export async function fetchKbCategories(): Promise<{ data: CategoryRow[] }> {
  return request<{ data: CategoryRow[] }>(`/kb/categories`);
}

export async function createCategory(data: { name: string; parent_id?: number | null; description?: string }): Promise<CategoryRow> {
  return request<CategoryRow>(`/kb/categories`, { method: 'POST', body: JSON.stringify(data) });
}

export async function updateCategory(
  id: number,
  fields: { name?: string; parent_id?: number | null; description?: string; sort_order?: number },
): Promise<CategoryRow> {
  return request<CategoryRow>(`/kb/categories/${id}`, { method: 'PATCH', body: JSON.stringify(fields) });
}

export async function deleteCategory(id: number): Promise<void> {
  return request<void>(`/kb/categories/${id}`, { method: 'DELETE' });
}

export async function fetchEntriesByCategory(
  catId: number,
  descendants = true,
): Promise<{ category_id: number; descendants: boolean; data: KbEntry[] }> {
  const params = new URLSearchParams({ category: String(catId), descendants: descendants ? '1' : '0' });
  return request<{ category_id: number; descendants: boolean; data: KbEntry[] }>(`/kb/entries?${params.toString()}`);
}

export async function fetchRelated(id: string | number): Promise<{ entry_id: string | number; data: RelatedEntry[] }> {
  return request<{ entry_id: string | number; data: RelatedEntry[] }>(`/kb/${id}/related`);
}

export async function addEntryCategory(entryId: string | number, categoryId: number): Promise<any> {
  return request<any>(`/kb/entries/${entryId}/categories`, { method: 'POST', body: JSON.stringify({ category_id: categoryId }) });
}

export async function removeEntryCategory(entryId: string | number, categoryId: number): Promise<void> {
  return request<void>(`/kb/entries/${entryId}/categories/${categoryId}`, { method: 'DELETE' });
}

/**
 * Dedicated live subscription for knowledge-pending events. The backend
 * emits a named SSE event 'knowledge-pending' on /api/events whenever an
 * agent proposes an entry. This opens its own EventSource so it works
 * regardless of whether the main event transport chose MQTT (which does
 * not carry KB topics).
 */
export function subscribeKnowledgePending(
  onPending: (data: { pending_id: string | number; entry_id: string | number; kind: string; title: string; proposing_agent?: string; conflicts?: any[] }) => void,
): () => void {
  const tokenParam = apiKey ? `?token=${encodeURIComponent(apiKey)}` : '';
  const es = new EventSource(`${BASE}/events${tokenParam}`);
  const handler = (e: MessageEvent) => {
    try { onPending(JSON.parse(e.data)); } catch { /* ignore */ }
  };
  es.addEventListener('knowledge-pending', handler);
  return () => {
    es.removeEventListener('knowledge-pending', handler);
    es.close();
  };
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

import { subscribeToMqttEvents, isMqttAvailable } from './mqtt-client';

function subscribeToSSE(
  onEvent: (event: SSEEvent) => void,
  onConnectionStateChange?: (state: ConnectionState) => void,
): () => void {
  const tokenParam = apiKey ? `?token=${encodeURIComponent(apiKey)}` : '';
  const es = new EventSource(`${BASE}/events${tokenParam}`);

  const emitState = (state: ConnectionState) => {
    notifyConnectionState(state);
    onConnectionStateChange?.(state);
  };

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

  const handleMessagesAcknowledged = (e: MessageEvent) => {
    onEvent({ type: 'messages-acknowledged', data: JSON.parse(e.data) });
  };

  es.addEventListener('agent-updated', handleAgentUpdated);
  es.addEventListener('agent-deleted', handleAgentDeleted);
  es.addEventListener('message-queued', handleMessageQueued);
  es.addEventListener('messages-acknowledged', handleMessagesAcknowledged);

  return () => {
    es.removeEventListener('agent-updated', handleAgentUpdated);
    es.removeEventListener('agent-deleted', handleAgentDeleted);
    es.removeEventListener('message-queued', handleMessageQueued);
    es.removeEventListener('messages-acknowledged', handleMessagesAcknowledged);
    es.close();
    emitState('disconnected');
  };
}

/**
 * Subscribe to real-time events. Tries MQTT-over-WebSocket first for
 * sub-second latency, falls back to SSE if MQTT broker is unavailable.
 */
export function subscribeToEvents(
  onEvent: (event: SSEEvent) => void,
  onConnectionStateChange?: (state: ConnectionState) => void,
): () => void {
  let cleanup: (() => void) | null = null;

  // Try MQTT first, fall back to SSE
  isMqttAvailable(2000).then((available) => {
    if (available) {
      console.log('[events] Using MQTT-over-WebSocket');
      cleanup = subscribeToMqttEvents(onEvent, onConnectionStateChange);
    } else {
      console.log('[events] MQTT unavailable, falling back to SSE');
      cleanup = subscribeToSSE(onEvent, onConnectionStateChange);
    }
  }).catch(() => {
    console.log('[events] MQTT probe failed, using SSE');
    cleanup = subscribeToSSE(onEvent, onConnectionStateChange);
  });

  // Return cleanup function that cancels whichever transport was chosen
  return () => {
    cleanup?.();
  };
}
