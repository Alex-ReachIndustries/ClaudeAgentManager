package com.claudemanager.app.data.models

import com.google.gson.annotations.SerializedName

/**
 * A multi-step workflow that orchestrates a sequence of agent tasks.
 */
data class Workflow(
    @SerializedName("id")
    val id: String,

    @SerializedName("name")
    val name: String,

    @SerializedName("steps")
    val steps: String, // JSON string of steps array

    @SerializedName("status")
    val status: String,

    @SerializedName("current_step")
    val currentStep: Int,

    @SerializedName("created_at")
    val createdAt: String?,

    @SerializedName("started_at")
    val startedAt: String?,

    @SerializedName("completed_at")
    val completedAt: String?,

    @SerializedName("metadata")
    val metadata: String?
)

/**
 * A single step within a workflow.
 */
data class WorkflowStep(
    @SerializedName("name")
    val name: String,

    @SerializedName("folder_path")
    val folderPath: String,

    @SerializedName("prompt")
    val prompt: String,

    @SerializedName("trigger")
    val trigger: String = "on_complete",

    @SerializedName("condition")
    val condition: String? = null,

    @SerializedName("agent_id")
    val agentId: String? = null,

    @SerializedName("status")
    val status: String = "pending"
)

/**
 * Request body for creating a new workflow.
 */
data class CreateWorkflowBody(
    @SerializedName("name")
    val name: String,

    @SerializedName("steps")
    val steps: List<WorkflowStep>
)
