package com.claudemanager.app.data.models

import com.google.gson.annotations.SerializedName

/**
 * A webhook configuration that receives event notifications from the backend.
 */
data class WebhookEntry(
    @SerializedName("id")
    val id: Int,

    @SerializedName("url")
    val url: String,

    @SerializedName("events")
    val events: List<String>,

    @SerializedName("active")
    val active: Boolean,

    @SerializedName("failure_count")
    val failureCount: Int,

    @SerializedName("created_at")
    val createdAt: String?
)

/**
 * Request body for creating a new webhook.
 */
data class CreateWebhookBody(
    @SerializedName("url")
    val url: String,

    @SerializedName("events")
    val events: List<String>
)

/**
 * Request body for updating an existing webhook.
 * All fields are optional; only non-null fields are sent.
 */
data class UpdateWebhookBody(
    @SerializedName("url")
    val url: String? = null,

    @SerializedName("events")
    val events: List<String>? = null,

    @SerializedName("active")
    val active: Boolean? = null
)
