package com.claudemanager.app.data.models

import com.google.gson.annotations.SerializedName

/**
 * A message sent from the dashboard to an agent, or retrieved from the message queue.
 */
data class AgentMessage(
    @SerializedName("id")
    val id: Long,

    @SerializedName("agent_id")
    val agentId: String,

    @SerializedName("created_at")
    val createdAt: String,

    @SerializedName("delivered_at")
    val deliveredAt: String? = null,

    @SerializedName("acknowledged_at")
    val acknowledgedAt: String? = null,

    @SerializedName("content")
    val content: String,

    @SerializedName("status")
    val status: MessageStatus = MessageStatus.PENDING,

    @SerializedName("source")
    val source: String? = null,

    @SerializedName("source_agent_id")
    val sourceAgentId: String? = null
)

/**
 * Possible message delivery statuses, matching the backend CHECK constraint.
 */
enum class MessageStatus {
    @SerializedName("pending")
    PENDING,

    @SerializedName("delivered")
    DELIVERED,

    @SerializedName("acknowledged")
    ACKNOWLEDGED,

    @SerializedName("executed")
    EXECUTED;

    val displayName: String
        get() = when (this) {
            PENDING -> "Pending"
            DELIVERED -> "Delivered"
            ACKNOWLEDGED -> "Acknowledged"
            EXECUTED -> "Executed"
        }
}
