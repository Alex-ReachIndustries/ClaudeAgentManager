package com.claudemanager.app.data.models

import com.google.gson.annotations.SerializedName

/**
 * Represents a Claude AI agent session managed by the ClaudeManager backend.
 */
data class Agent(
    @SerializedName("id")
    val id: String,

    @SerializedName("title")
    val title: String,

    @SerializedName("status")
    val status: AgentStatus,

    @SerializedName("created_at")
    val createdAt: String,

    @SerializedName("last_update_at")
    val lastUpdateAt: String,

    @SerializedName("last_activity_at")
    val lastActivityAt: String? = null,

    @SerializedName("update_count")
    val updateCount: Int = 0,

    @SerializedName("last_read_at")
    val lastReadAt: String? = null,

    @SerializedName("unread_update_count")
    val unreadUpdateCount: Int = 0,

    @SerializedName("pending_message_count")
    val pendingMessageCount: Int = 0,

    @SerializedName("latest_summary")
    val latestSummary: String? = null,

    @SerializedName("latest_message")
    val latestMessage: String? = null,

    @SerializedName("last_message_at")
    val lastMessageAt: String? = null,

    @SerializedName("metadata")
    val metadata: AgentMetadata? = null,

    @SerializedName("poll_delay_until")
    val pollDelayUntil: String? = null,

    @SerializedName("workspace")
    val workspace: String? = null,

    @SerializedName("cwd")
    val cwd: String? = null,

    @SerializedName("pid")
    val pid: Int? = null
) {
    /**
     * Whether this agent has unread updates since the last time it was marked read.
     */
    val hasUnread: Boolean
        get() = unreadUpdateCount > 0

    /**
     * Whether this agent is in a live/running state (not completed or archived).
     */
    val isLive: Boolean
        get() = status in listOf(
            AgentStatus.ACTIVE,
            AgentStatus.WORKING,
            AgentStatus.IDLE,
            AgentStatus.WAITING_FOR_INPUT
        )
}

/**
 * Possible agent statuses, matching the backend CHECK constraint.
 */
enum class AgentStatus {
    @SerializedName("active")
    ACTIVE,

    @SerializedName("working")
    WORKING,

    @SerializedName("idle")
    IDLE,

    @SerializedName("waiting-for-input")
    WAITING_FOR_INPUT,

    @SerializedName("completed")
    COMPLETED,

    @SerializedName("archived")
    ARCHIVED;

    /**
     * Human-readable display label.
     */
    val displayName: String
        get() = when (this) {
            ACTIVE -> "Active"
            WORKING -> "Working"
            IDLE -> "Idle"
            WAITING_FOR_INPUT -> "Waiting for Input"
            COMPLETED -> "Completed"
            ARCHIVED -> "Archived"
        }
}

/**
 * Agent metadata containing tracked projects and todos.
 * The backend stores this as a JSON string in the `metadata` column;
 * Gson deserializes it into this structure via a custom deserializer.
 */
data class AgentMetadata(
    @SerializedName("projects")
    val projects: List<ProjectStatus> = emptyList(),

    @SerializedName("todos")
    val todos: List<TodoStatus> = emptyList()
)

/**
 * A project being tracked by the agent, with named phases.
 */
data class ProjectStatus(
    @SerializedName("name")
    val name: String,

    @SerializedName("phases")
    val phases: List<ProjectPhase> = emptyList()
)

/**
 * A single phase within a project.
 */
data class ProjectPhase(
    @SerializedName("name")
    val name: String,

    @SerializedName("status")
    val status: PhaseStatus = PhaseStatus.PENDING
)

/**
 * Phase status values.
 */
enum class PhaseStatus {
    @SerializedName("pending")
    PENDING,

    @SerializedName("in-progress")
    IN_PROGRESS,

    @SerializedName("completed")
    COMPLETED;

    val displayName: String
        get() = when (this) {
            PENDING -> "Pending"
            IN_PROGRESS -> "In Progress"
            COMPLETED -> "Completed"
        }
}

/**
 * A todo item tracked by the agent.
 */
data class TodoStatus(
    @SerializedName("name")
    val name: String,

    @SerializedName("completed")
    val completed: Boolean = false,

    @SerializedName("project")
    val project: String? = null
)
