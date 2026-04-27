package com.claudemanager.app.data.models

import com.google.gson.annotations.SerializedName

/** API response shape for a single predefined role from GET /api/roles. */
data class PredefinedRoleResponse(
    @SerializedName("id") val id: String,
    @SerializedName("displayName") val displayName: String,
    @SerializedName("category") val category: String,
    @SerializedName("fullDefinition") val fullDefinition: String,
    @SerializedName("defaultCwd") val defaultCwd: String? = null
)
