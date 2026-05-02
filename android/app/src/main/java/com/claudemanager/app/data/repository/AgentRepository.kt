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
import com.claudemanager.app.data.models.AgentCostBreakdownResponse
import com.claudemanager.app.data.models.CostAnalyticsResponse
import com.claudemanager.app.data.models.CostReportBody
import com.claudemanager.app.data.models.OkResponse
import com.claudemanager.app.data.models.CreateLaunchRequestBody
import com.claudemanager.app.data.models.CreateProjectBody
import com.claudemanager.app.data.models.CreateWebhookBody
import com.claudemanager.app.data.models.CreateWorkflowBody
import com.claudemanager.app.data.models.FileInfo
import com.claudemanager.app.data.models.FolderResponse
import com.claudemanager.app.data.models.HealthResponse
import com.claudemanager.app.data.models.LaunchRequest
import com.claudemanager.app.data.models.Project
import com.claudemanager.app.data.models.ProjectFile
import com.claudemanager.app.data.models.ProjectUpdate
import com.claudemanager.app.data.models.RelayBody
import com.claudemanager.app.data.models.RetentionRunResult
import com.claudemanager.app.data.models.RetentionSettingsBody
import com.claudemanager.app.data.models.RetentionStatus
import com.claudemanager.app.data.models.SendMessageBody
import com.claudemanager.app.data.models.ShareFileRequest
import com.claudemanager.app.data.models.SpawnAgentBody
import com.claudemanager.app.data.models.TerminalOutputBody
import com.claudemanager.app.data.models.UpdateAgentBody
import com.claudemanager.app.data.models.UpdateWebhookBody
import com.claudemanager.app.data.models.WebhookEntry
import com.claudemanager.app.data.models.Workflow
import com.claudemanager.app.data.models.WorkflowStep
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

    // ── Roles ────────────────────────────────────────────────────────────

    /** Fetch predefined roles from the server. */
    suspend fun getRoles() = apiCall { api.getRoles() }

    /** Fetch distinct non-null wt_window group names. */
    suspend fun getWtWindows(): Result<List<String>> = apiCall { api.getWtWindows() }

    /** Assign a window group (wt_window) to multiple agents. Pass null to remove grouping. */
    suspend fun assignWindowGroup(agentIds: List<String>, wtWindow: String?): Result<Unit> {
        agentIds.forEach { id -> updateAgent(id, wtWindow = wtWindow) }
        return Result.success(Unit)
    }

    // ── Agents ──────────────────────────────────────────────────────────

    /**
     * Fetch all agents from the server.
     */
    suspend fun getAgents(): Result<List<Agent>> = apiCall {
        api.getAgents()
    }.map { it.data }

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
        pollDelayUntil: String? = null,
        role: String? = null,
        effort: String? = null,
        model: String? = null,
        wtWindow: String? = null
    ): Result<Agent> = apiCall {
        api.updateAgent(id, UpdateAgentBody(title, status, pollDelayUntil, role, effort, model, wtWindow))
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

    suspend fun sendSignal(id: String, signal: String): Result<OkResponse> = apiCall {
        api.sendSignal(id, mapOf("signal" to signal))
    }

    suspend fun sendInput(id: String, text: String): Result<OkResponse> = apiCall {
        api.sendInput(id, mapOf("text" to text))
    }

    /**
     * Resume an archived/suspended agent with its full conversation history.
     */
    suspend fun resumeAgent(id: String): Result<Unit> = apiCall {
        api.resumeAgent(id)
    }.map { }

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
    }.map { it.data }

    // ── Messages ─────────────────────────────────────────────────────────

    /**
     * Get all messages for an agent.
     */
    suspend fun getMessages(agentId: String): Result<List<AgentMessage>> = apiCall {
        api.getMessages(agentId)
    }.map { it.data }

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
    }.map { it.data }

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
        targetPid: Int? = null,
        role: String? = null,
        task: String? = null,
        effort: String? = null,
        model: String? = null,
        wtWindow: String? = null
    ): Result<LaunchRequest> {
        return apiCall {
            api.createLaunchRequest(
                CreateLaunchRequestBody(
                    type = type,
                    folderPath = folderPath,
                    resumeAgentId = resumeAgentId,
                    targetPid = targetPid,
                    role = role,
                    task = task,
                    effort = effort,
                    model = model,
                    wtWindow = wtWindow
                )
            )
        }.map { it.request }
    }

    // ── Webhooks ─────────────────────────────────────────────────────────

    /**
     * Get all configured webhooks.
     */
    suspend fun getWebhooks(): Result<List<WebhookEntry>> = apiCall {
        api.getWebhooks()
    }

    /**
     * Create a new webhook with the given URL and event types.
     */
    suspend fun createWebhook(url: String, events: List<String>): Result<WebhookEntry> = apiCall {
        api.createWebhook(CreateWebhookBody(url, events))
    }

    /**
     * Update an existing webhook. Only non-null fields are applied.
     */
    suspend fun updateWebhook(
        id: Int,
        url: String? = null,
        events: List<String>? = null,
        active: Boolean? = null
    ): Result<WebhookEntry> = apiCall {
        api.updateWebhook(id, UpdateWebhookBody(url, events, active))
    }

    /**
     * Delete a webhook by ID.
     */
    suspend fun deleteWebhook(id: Int): Result<Unit> = apiCall {
        api.deleteWebhook(id)
    }.map { }

    /**
     * Send a test event to a webhook to verify connectivity.
     */
    suspend fun testWebhook(id: Int): Result<Unit> = apiCall {
        api.testWebhook(id)
    }.map { }

    // ── Retention ────────────────────────────────────────────────────────

    /**
     * Get the current retention policy status, including settings and last run stats.
     */
    suspend fun getRetentionStatus(): Result<RetentionStatus> = apiCall {
        api.getRetentionStatus()
    }

    /**
     * Update retention policy settings. Only non-null fields are applied.
     */
    suspend fun updateRetentionSettings(
        archiveDays: Int? = null,
        updateDays: Int? = null,
        messageDays: Int? = null,
        enabled: Boolean? = null,
        dryRun: Boolean? = null
    ): Result<Unit> = apiCall {
        api.updateRetentionSettings(
            RetentionSettingsBody(archiveDays, updateDays, messageDays, enabled, dryRun)
        )
    }.map { }

    /**
     * Manually trigger a retention cleanup run.
     */
    suspend fun runRetention(): Result<RetentionRunResult> = apiCall {
        api.runRetention()
    }

    // ── Projects ─────────────────────────────────────────────────────────

    /**
     * Get all projects.
     */
    suspend fun getProjects(): Result<List<Project>> = apiCall {
        api.getProjects()
    }

    /**
     * Create a new project.
     */
    suspend fun createProject(
        name: String,
        description: String,
        folderPath: String,
        maxConcurrent: Int = 4,
        pmRole: String? = null,
        pmEffort: String? = null,
        pmModel: String? = null,
        agentEffort: String? = null,
        agentModel: String? = null
    ): Result<Project> = apiCall {
        api.createProject(CreateProjectBody(name, description, folderPath, maxConcurrent, pmRole, pmEffort, pmModel, agentEffort, agentModel))
    }

    /**
     * Get a single project by ID.
     */
    suspend fun getProject(id: String): Result<Project> = apiCall {
        api.getProject(id)
    }

    /**
     * Get agents assigned to a project.
     */
    suspend fun getProjectAgents(id: String): Result<List<Agent>> = apiCall {
        api.getProjectAgents(id)
    }

    /**
     * Get project timeline updates.
     */
    suspend fun getProjectUpdates(id: String): Result<List<ProjectUpdate>> = apiCall {
        api.getProjectUpdates(id)
    }.map { it.data }

    /**
     * Get files from all agents in a project.
     */
    suspend fun getProjectFiles(id: String): Result<List<ProjectFile>> = apiCall {
        api.getProjectFiles(id)
    }

    /**
     * Start a project.
     */
    suspend fun startProject(id: String, initialPrompt: String = ""): Result<Unit> = apiCall {
        api.startProject(id, mapOf("initial_prompt" to initialPrompt))
    }.map { }

    /**
     * Pause a running project.
     */
    suspend fun pauseProject(id: String): Result<Unit> = apiCall {
        api.pauseProject(id)
    }.map { }

    /**
     * Mark a project as complete.
     */
    suspend fun completeProject(id: String): Result<Unit> = apiCall {
        api.completeProject(id)
    }.map { }

    /**
     * Delete a project.
     */
    suspend fun deleteProject(id: String): Result<Unit> = apiCall {
        api.deleteProject(id)
    }.map { }

    /**
     * Spawn a new agent within a project.
     */
    suspend fun spawnProjectAgent(
        projectId: String,
        role: String,
        prompt: String
    ): Result<Unit> = apiCall {
        api.spawnProjectAgent(projectId, SpawnAgentBody(role, prompt))
    }.map { }

    // ── Workflows ────────────────────────────────────────────────────────

    /**
     * Get all workflows.
     */
    suspend fun getWorkflows(): Result<List<Workflow>> = apiCall {
        api.getWorkflows()
    }

    /**
     * Get a single workflow by ID.
     */
    suspend fun getWorkflow(id: String): Result<Workflow> = apiCall {
        api.getWorkflow(id)
    }

    /**
     * Create a new workflow with the given name and steps.
     */
    suspend fun createWorkflow(name: String, steps: List<WorkflowStep>): Result<Workflow> = apiCall {
        api.createWorkflow(CreateWorkflowBody(name, steps))
    }

    /**
     * Start a workflow.
     */
    suspend fun startWorkflow(id: String): Result<Unit> = apiCall {
        api.startWorkflow(id)
    }.map { }

    /**
     * Pause a running workflow.
     */
    suspend fun pauseWorkflow(id: String): Result<Unit> = apiCall {
        api.pauseWorkflow(id)
    }.map { }

    /**
     * Delete a workflow.
     */
    suspend fun deleteWorkflow(id: String): Result<Unit> = apiCall {
        api.deleteWorkflow(id)
    }.map { }

    // ── Agent Relay ──────────────────────────────────────────────────────

    /**
     * Relay a message from one agent to another.
     *
     * @param fromAgentId The agent initiating the relay (source).
     * @param targetAgentId The agent receiving the relayed message.
     * @param content The message content to relay.
     */
    suspend fun relayMessage(
        fromAgentId: String,
        targetAgentId: String,
        content: String
    ): Result<Unit> = apiCall {
        api.relayMessage(fromAgentId, RelayBody(targetAgentId, content))
    }.map { }

    // ── Terminal Streaming ────────────────────────────────────────────────

    /**
     * Send terminal output for an agent. This is ephemeral and broadcast via SSE.
     */
    suspend fun postTerminalOutput(agentId: String, output: String): Result<Unit> = apiCall {
        api.postTerminalOutput(agentId, TerminalOutputBody(output))
    }.map { }

    // ── Cost Tracking ──────────────────────────────────────────────────

    /**
     * Report token usage and cost for an agent. Accumulates in agent metadata.
     */
    suspend fun reportCost(
        agentId: String,
        inputTokens: Long,
        outputTokens: Long,
        costUsd: Double
    ): Result<Unit> = apiCall {
        api.reportCost(agentId, CostReportBody(inputTokens, outputTokens, costUsd))
    }.map { }

    /**
     * Get aggregate cost analytics across all agents.
     */
    suspend fun getCostAnalytics(): Result<CostAnalyticsResponse> = apiCall {
        api.getCostAnalytics()
    }

    /**
     * Get per-agent cost breakdown by task label.
     */
    suspend fun getAgentCosts(agentId: String): Result<AgentCostBreakdownResponse> = apiCall {
        api.getAgentCosts(agentId)
    }

    // ── File Sharing ───────────────────────────────────────────────────

    /**
     * Share a file from one agent to another (copies the file).
     *
     * @param agentId The source agent that owns the file.
     * @param fileId The file to share.
     * @param targetAgentId The agent to copy the file to.
     */
    suspend fun shareFile(
        agentId: String,
        fileId: Long,
        targetAgentId: String
    ): Result<Unit> = apiCall {
        api.shareFile(agentId, ShareFileRequest(fileId, targetAgentId))
    }.map { }

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
