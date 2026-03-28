package com.claudemanager.app.data.models

import com.google.gson.annotations.SerializedName

/**
 * A request to launch a new agent session, resume an existing one, or terminate a running one.
 * Created via the dashboard/app and picked up by the launcher process.
 */
data class LaunchRequest(
    @SerializedName("id")
    val id: Long,

    @SerializedName("type")
    val type: LaunchRequestType,

    @SerializedName("folder_path")
    val folderPath: String,

    @SerializedName("resume_agent_id")
    val resumeAgentId: String? = null,

    @SerializedName("target_pid")
    val targetPid: Int? = null,

    @SerializedName("status")
    val status: String = "pending",

    @SerializedName("created_at")
    val createdAt: String? = null,

    @SerializedName("claimed_at")
    val claimedAt: String? = null,

    @SerializedName("completed_at")
    val completedAt: String? = null,

    @SerializedName("agent_id")
    val agentId: String? = null
)

/**
 * The type of launch request.
 */
enum class LaunchRequestType {
    @SerializedName("new")
    NEW,

    @SerializedName("resume")
    RESUME,

    @SerializedName("terminate")
    TERMINATE
}

/**
 * Request body for creating a new launch request.
 */
data class CreateLaunchRequestBody(
    @SerializedName("type")
    val type: String,

    @SerializedName("folder_path")
    val folderPath: String,

    @SerializedName("resume_agent_id")
    val resumeAgentId: String? = null,

    @SerializedName("target_pid")
    val targetPid: Int? = null
)

/**
 * Response from the create launch request endpoint.
 */
data class CreateLaunchResponse(
    @SerializedName("ok")
    val ok: Boolean,

    @SerializedName("request")
    val request: LaunchRequest
)

/**
 * Response from the close agent endpoint.
 */
data class CloseResponse(
    @SerializedName("ok")
    val ok: Boolean,

    @SerializedName("terminated")
    val terminated: Boolean,

    @SerializedName("pid")
    val pid: Int? = null
)

/**
 * Simple request body for sending a message to an agent.
 */
data class SendMessageBody(
    @SerializedName("content")
    val content: String
)

/**
 * Simple response from endpoints that return {ok: true}.
 */
data class OkResponse(
    @SerializedName("ok")
    val ok: Boolean
)

/**
 * Health check response.
 */
data class HealthResponse(
    @SerializedName("status")
    val status: String
)

/**
 * Request body for updating agent fields via PATCH.
 */
data class UpdateAgentBody(
    @SerializedName("title")
    val title: String? = null,

    @SerializedName("status")
    val status: String? = null,

    @SerializedName("poll_delay_until")
    val pollDelayUntil: String? = null
)
