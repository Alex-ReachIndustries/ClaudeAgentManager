package com.claudemanager.app.data.models

import com.google.gson.annotations.SerializedName

/**
 * Represents a project managed by the ClaudeManager backend.
 * A project coordinates multiple agents working towards a shared goal.
 */
data class Project(
    @SerializedName("id")
    val id: String,

    @SerializedName("name")
    val name: String,

    @SerializedName("description")
    val description: String,

    @SerializedName("status")
    val status: String,

    @SerializedName("pm_agent_id")
    val pmAgentId: String?,

    @SerializedName("folder_path")
    val folderPath: String,

    @SerializedName("max_concurrent")
    val maxConcurrent: Int,

    @SerializedName("created_at")
    val createdAt: String?,

    @SerializedName("started_at")
    val startedAt: String?,

    @SerializedName("completed_at")
    val completedAt: String?,

    @SerializedName("active_agent_count")
    val activeAgentCount: Int?,

    @SerializedName("total_agent_count")
    val totalAgentCount: Int?
)

/**
 * A timestamped update entry within a project timeline.
 */
data class ProjectUpdate(
    @SerializedName("id")
    val id: Int,

    @SerializedName("project_id")
    val projectId: String,

    @SerializedName("type")
    val type: String,

    @SerializedName("content")
    val content: String,

    @SerializedName("timestamp")
    val timestamp: String
)

/**
 * A file shared by an agent within a project.
 */
data class ProjectFile(
    @SerializedName("id")
    val id: Int,

    @SerializedName("agent_id")
    val agentId: String,

    @SerializedName("agent_role")
    val agentRole: String?,

    @SerializedName("filename")
    val filename: String,

    @SerializedName("mimetype")
    val mimetype: String?,

    @SerializedName("size")
    val size: Long,

    @SerializedName("source")
    val source: String?,

    @SerializedName("description")
    val description: String?,

    @SerializedName("created_at")
    val createdAt: String?
)

/**
 * Request body for creating a new project.
 */
data class CreateProjectBody(
    @SerializedName("name")
    val name: String,

    @SerializedName("description")
    val description: String,

    @SerializedName("folder_path")
    val folderPath: String,

    @SerializedName("max_concurrent")
    val maxConcurrent: Int = 4
)

/**
 * Request body for posting an update to a project.
 */
data class ProjectUpdateBody(
    @SerializedName("type")
    val type: String,

    @SerializedName("content")
    val content: String
)

/**
 * Request body for spawning an agent within a project.
 */
data class SpawnAgentBody(
    @SerializedName("role")
    val role: String,

    @SerializedName("prompt")
    val prompt: String
)
