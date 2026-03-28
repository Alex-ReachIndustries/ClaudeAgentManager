package com.claudemanager.app.data.repository

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import com.claudemanager.app.data.api.AgentApi
import com.claudemanager.app.data.api.ApiClient
import com.claudemanager.app.data.models.Agent
import com.claudemanager.app.data.models.AgentMessage
import com.claudemanager.app.data.models.AgentUpdate
import com.claudemanager.app.data.models.CloseResponse
import com.claudemanager.app.data.models.CreateLaunchRequestBody
import com.claudemanager.app.data.models.FileInfo
import com.claudemanager.app.data.models.FolderResponse
import com.claudemanager.app.data.models.HealthResponse
import com.claudemanager.app.data.models.LaunchRequest
import com.claudemanager.app.data.models.SendMessageBody
import com.claudemanager.app.data.models.UpdateAgentBody
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import retrofit2.Response

/**
 * Repository that wraps [AgentApi] calls with error handling.
 * All public methods return [Result<T>] so callers can handle success/failure
 * without try/catch boilerplate.
 */
class AgentRepository {

    private val api: AgentApi
        get() = ApiClient.getAgentApi()

    // ── Agents ──────────────────────────────────────────────────────────

    /**
     * Fetch all agents from the server.
     */
    suspend fun getAgents(): Result<List<Agent>> = apiCall {
        api.getAgents()
    }

    /**
     * Fetch a single agent by ID.
     */
    suspend fun getAgent(id: String): Result<Agent> = apiCall {
        api.getAgent(id)
    }

    /**
     * Update agent fields (title, status, poll_delay_until).
     * Only include fields that should change; null fields are not sent.
     */
    suspend fun updateAgent(
        id: String,
        title: String? = null,
        status: String? = null,
        pollDelayUntil: String? = null
    ): Result<Agent> = apiCall {
        api.updateAgent(id, UpdateAgentBody(title, status, pollDelayUntil))
    }

    /**
     * Delete an agent and all associated data.
     */
    suspend fun deleteAgent(id: String): Result<Unit> = apiCall {
        api.deleteAgent(id)
    }.map { }

    /**
     * Archive an agent and terminate its process.
     */
    suspend fun closeAgent(id: String): Result<CloseResponse> = apiCall {
        api.closeAgent(id)
    }

    /**
     * Mark an agent as read (resets unread update count).
     */
    suspend fun markRead(id: String): Result<Unit> = apiCall {
        api.markRead(id)
    }.map { }

    // ── Updates ──────────────────────────────────────────────────────────

    /**
     * Get all updates for an agent.
     */
    suspend fun getUpdates(agentId: String): Result<List<AgentUpdate>> = apiCall {
        api.getUpdates(agentId)
    }

    // ── Messages ─────────────────────────────────────────────────────────

    /**
     * Get all messages for an agent.
     */
    suspend fun getMessages(agentId: String): Result<List<AgentMessage>> = apiCall {
        api.getMessages(agentId)
    }

    /**
     * Send a message to an agent. The message is queued for delivery on the
     * agent's next poll.
     */
    suspend fun sendMessage(agentId: String, content: String): Result<Unit> = apiCall {
        api.sendMessage(agentId, SendMessageBody(content))
    }.map { }

    // ── Files ────────────────────────────────────────────────────────────

    /**
     * Upload a file to an agent from an Android content URI.
     * Reads the file via ContentResolver and sends it as a multipart request.
     *
     * @param agentId The agent to attach the file to.
     * @param uri The Android content:// or file:// URI of the file to upload.
     * @param context Android context for ContentResolver access.
     * @param description Optional description for the file.
     */
    suspend fun uploadFile(
        agentId: String,
        uri: Uri,
        context: Context,
        description: String = ""
    ): Result<FileInfo> {
        return try {
            val contentResolver = context.contentResolver

            // Determine filename
            val filename = getFileName(context, uri) ?: "upload"

            // Determine MIME type
            val mimeType = contentResolver.getType(uri) ?: "application/octet-stream"

            // Read file bytes
            val inputStream = contentResolver.openInputStream(uri)
                ?: return Result.failure(Exception("Cannot open file: $uri"))
            val bytes = inputStream.use { it.readBytes() }

            // Build multipart parts
            val fileRequestBody = bytes.toRequestBody(mimeType.toMediaType())
            val filePart = MultipartBody.Part.createFormData("file", filename, fileRequestBody)
            val sourcePart = "user".toRequestBody("text/plain".toMediaType())
            val descriptionPart = description.toRequestBody("text/plain".toMediaType())

            val response = api.uploadFile(agentId, filePart, sourcePart, descriptionPart)

            if (response.isSuccessful) {
                // The upload endpoint returns {ok, file: {id, filename, ...}} but we need
                // to construct a full FileInfo. Parse from the raw response body.
                val rawBody = response.body()
                // Since the response shape is {ok, file: {...}}, and our API returns OkResponse,
                // we need to re-fetch the files list to get the complete FileInfo.
                // Alternatively, construct a minimal FileInfo from what we know.
                Result.success(
                    FileInfo(
                        id = 0, // Will be populated on next fetch
                        agentId = agentId,
                        filename = filename,
                        mimetype = mimeType,
                        size = bytes.size.toLong(),
                        source = "user",
                        description = description,
                        createdAt = "" // Will be populated on next fetch
                    )
                )
            } else {
                val errorBody = response.errorBody()?.string() ?: "Upload failed"
                Result.failure(ApiException(response.code(), errorBody))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Get file metadata for all files attached to an agent.
     */
    suspend fun getFiles(agentId: String): Result<List<FileInfo>> = apiCall {
        api.getFiles(agentId)
    }

    /**
     * Build the download URL for a specific file. This URL can be opened
     * in a browser or used with a download manager.
     */
    fun getFileDownloadUrl(agentId: String, fileId: Long): String {
        return "${ApiClient.getBaseUrl()}/api/agents/$agentId/files/$fileId"
    }

    // ── Folders ──────────────────────────────────────────────────────────

    /**
     * Browse folders on the server's host machine.
     * Used for the folder picker when launching a new agent.
     */
    suspend fun getFolders(path: String = ""): Result<FolderResponse> = apiCall {
        api.getFolders(path)
    }

    // ── Launch Requests ──────────────────────────────────────────────────

    /**
     * Create a launch request to start a new agent session, resume an existing one,
     * or terminate a running one.
     */
    suspend fun createLaunchRequest(
        type: String,
        folderPath: String,
        resumeAgentId: String? = null,
        targetPid: Int? = null
    ): Result<LaunchRequest> {
        return apiCall {
            api.createLaunchRequest(
                CreateLaunchRequestBody(
                    type = type,
                    folderPath = folderPath,
                    resumeAgentId = resumeAgentId,
                    targetPid = targetPid
                )
            )
        }.map { it.request }
    }

    // ── Health Check ─────────────────────────────────────────────────────

    /**
     * Test connectivity to a specific server URL. Used during initial setup
     * to verify the server is reachable before saving the URL.
     *
     * @param serverUrl The full base URL to test (e.g., "http://100.x.y.z:3001").
     * @return Result<Boolean> where true means the server is healthy.
     */
    suspend fun checkHealth(serverUrl: String): Result<Boolean> {
        return try {
            val retrofit = ApiClient.createRetrofitForUrl(serverUrl)
            val testApi = retrofit.create(AgentApi::class.java)
            val response = testApi.checkHealth()

            if (response.isSuccessful) {
                val health = response.body()
                Result.success(health?.status == "ok")
            } else {
                Result.failure(
                    ApiException(response.code(), "Health check failed: HTTP ${response.code()}")
                )
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    // ── Private Helpers ──────────────────────────────────────────────────

    /**
     * Generic wrapper that executes a Retrofit suspend call and converts the
     * response into a [Result].
     */
    private suspend fun <T> apiCall(call: suspend () -> Response<T>): Result<T> {
        return try {
            val response = call()
            if (response.isSuccessful) {
                val body = response.body()
                if (body != null) {
                    Result.success(body)
                } else {
                    // Some endpoints (DELETE) return empty bodies
                    @Suppress("UNCHECKED_CAST")
                    Result.success(Unit as T)
                }
            } else {
                val errorBody = response.errorBody()?.string() ?: "Unknown error"
                Result.failure(ApiException(response.code(), errorBody))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Extract the display name of a file from a content URI.
     */
    private fun getFileName(context: Context, uri: Uri): String? {
        // Try the content resolver query first (works for content:// URIs)
        if (uri.scheme == "content") {
            context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (nameIndex >= 0 && cursor.moveToFirst()) {
                    return cursor.getString(nameIndex)
                }
            }
        }

        // Fall back to the last path segment
        return uri.lastPathSegment
    }
}

/**
 * Exception representing an HTTP error response from the API.
 */
class ApiException(
    val statusCode: Int,
    override val message: String
) : Exception("HTTP $statusCode: $message") {

    /**
     * Whether this is a client error (4xx).
     */
    val isClientError: Boolean
        get() = statusCode in 400..499

    /**
     * Whether this is a server error (5xx).
     */
    val isServerError: Boolean
        get() = statusCode in 500..599

    /**
     * Whether the resource was not found (404).
     */
    val isNotFound: Boolean
        get() = statusCode == 404
}
