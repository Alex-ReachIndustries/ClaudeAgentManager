package com.claudemanager.app.data.models

import com.google.gson.annotations.SerializedName

/**
 * Full retention status including current settings and last run information.
 */
data class RetentionStatus(
    @SerializedName("settings")
    val settings: RetentionSettings,

    @SerializedName("lastRunAt")
    val lastRunAt: String?,

    @SerializedName("lastRunStats")
    val lastRunStats: RetentionRunStats?
)

/**
 * Retention policy settings controlling automatic data cleanup.
 */
data class RetentionSettings(
    @SerializedName("retention_archive_days")
    val archiveDays: Int,

    @SerializedName("retention_update_days")
    val updateDays: Int,

    @SerializedName("retention_message_days")
    val messageDays: Int,

    @SerializedName("retention_enabled")
    val enabled: Boolean,

    @SerializedName("retention_dry_run")
    val dryRun: Boolean
)

/**
 * Request body for updating retention settings.
 * All fields are optional; only non-null fields are applied.
 */
data class RetentionSettingsBody(
    @SerializedName("retention_archive_days")
    val archiveDays: Int? = null,

    @SerializedName("retention_update_days")
    val updateDays: Int? = null,

    @SerializedName("retention_message_days")
    val messageDays: Int? = null,

    @SerializedName("retention_enabled")
    val enabled: Boolean? = null,

    @SerializedName("retention_dry_run")
    val dryRun: Boolean? = null
)

/**
 * Statistics from a retention cleanup run.
 */
data class RetentionRunStats(
    @SerializedName("agentsDeleted")
    val agentsDeleted: Int,

    @SerializedName("updatesDeleted")
    val updatesDeleted: Int,

    @SerializedName("messagesDeleted")
    val messagesDeleted: Int
)

/**
 * Result from manually triggering a retention cleanup run.
 */
data class RetentionRunResult(
    @SerializedName("stats")
    val stats: RetentionRunStats,

    @SerializedName("dry_run")
    val dryRun: Boolean
)

/**
 * Request body for relaying a message from one agent to another.
 */
data class RelayBody(
    @SerializedName("target_agent_id")
    val targetAgentId: String,

    @SerializedName("content")
    val content: String
)
