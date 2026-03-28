package com.claudemanager.app.data.models

import com.google.gson.annotations.SerializedName

/**
 * Response from the folder browsing endpoint.
 */
data class FolderResponse(
    @SerializedName("current")
    val current: String,

    @SerializedName("folders")
    val folders: List<FolderEntry>
)

/**
 * A single folder entry in the directory listing.
 */
data class FolderEntry(
    @SerializedName("name")
    val name: String,

    @SerializedName("path")
    val path: String,

    @SerializedName("hasChildren")
    val hasChildren: Boolean
)
