package com.claudemanager.app.data.models

import com.google.gson.annotations.SerializedName

/**
 * Token usage and cost data for an agent.
 * Used both in agent metadata and in the analytics response.
 */
data class CostData(
    @SerializedName("input_tokens")
    val inputTokens: Long = 0,

    @SerializedName("output_tokens")
    val outputTokens: Long = 0,

    @SerializedName("cost_usd")
    val costUsd: Double = 0.0
)

/**
 * Response from GET /api/agents/analytics/costs.
 * Contains aggregate totals and per-agent cost breakdown.
 */
data class CostAnalyticsResponse(
    @SerializedName("total")
    val total: CostData,

    @SerializedName("agents")
    val agents: List<AgentCostEntry>
)

/**
 * Per-agent cost entry returned in the analytics response.
 */
data class AgentCostEntry(
    @SerializedName("id")
    val id: String,

    @SerializedName("title")
    val title: String,

    @SerializedName("project_id")
    val projectId: String? = null,

    @SerializedName("costs")
    val costs: CostData
)

/**
 * Request body for POST /api/agents/{id}/cost.
 */
data class CostReportBody(
    @SerializedName("input_tokens")
    val inputTokens: Long,

    @SerializedName("output_tokens")
    val outputTokens: Long,

    @SerializedName("cost_usd")
    val costUsd: Double
)

/**
 * Response from GET /api/agents/{id}/costs — per-agent cost breakdown by task.
 */
data class AgentCostBreakdownResponse(
    @SerializedName("total")
    val total: CostData,

    @SerializedName("breakdown")
    val breakdown: List<CostBreakdownEntry>
)

/**
 * A single task/label cost entry in the per-agent breakdown.
 */
data class CostBreakdownEntry(
    @SerializedName("label")
    val label: String,

    @SerializedName("input_tokens")
    val inputTokens: Long = 0,

    @SerializedName("output_tokens")
    val outputTokens: Long = 0,

    @SerializedName("cost_usd")
    val costUsd: Double = 0.0,

    @SerializedName("event_count")
    val eventCount: Int = 1,

    @SerializedName("first_at")
    val firstAt: String? = null,

    @SerializedName("last_at")
    val lastAt: String? = null
)

/**
 * Request body for POST /api/agents/{id}/terminal.
 */
data class TerminalOutputBody(
    @SerializedName("output")
    val output: String
)

/**
 * Request body for POST /api/agents/{id}/share-file.
 */
data class ShareFileRequest(
    @SerializedName("file_id")
    val fileId: Long,

    @SerializedName("target_agent_id")
    val targetAgentId: String
)
