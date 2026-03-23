export interface Agent {
  id: string;
  title: string;
  status: 'active' | 'working' | 'idle' | 'waiting-for-input' | 'completed' | 'archived';
  created_at: string;
  last_update_at: string;
  update_count: number;
  metadata: Record<string, unknown>;
  pending_message_count: number;
  latest_summary: string | null;
  poll_delay_until: string | null;
  workspace: string | null;
  cwd: string | null;
  pid: number | null;
  unread_update_count: number;
  last_read_at: string | null;
  last_message_at: string | null;
  last_activity_at: string | null;
}

export interface AgentUpdate {
  id: number;
  agent_id: string;
  timestamp: string;
  type: 'text' | 'progress' | 'diagram' | 'error' | 'status';
  content: Record<string, unknown>;
  summary: string | null;
}

export interface AgentMessage {
  id: number;
  agent_id: string;
  created_at: string;
  delivered_at: string | null;
  content: string;
  status: 'pending' | 'delivered' | 'acknowledged' | 'executed';
  acknowledged_at: string | null;
}

export interface ProjectPhase {
  name: string;
  status: 'pending' | 'in-progress' | 'completed';
}

export interface ProjectStatus {
  name: string;
  phases: ProjectPhase[];
}

export interface TodoStatus {
  name: string;
  completed: boolean;
  project?: string;
}

export type SSEEvent =
  | { type: 'agent-updated'; data: Agent }
  | { type: 'agent-deleted'; data: { id: string } }
  | { type: 'message-queued'; data: AgentMessage };
