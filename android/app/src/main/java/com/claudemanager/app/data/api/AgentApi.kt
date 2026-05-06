package com.claudemanager.app.data.api

import com.google.gson.annotations.SerializedName
import com.claudemanager.app.data.models.Agent
import com.claudemanager.app.data.models.AgentMessage
import com.claudemanager.app.data.models.AgentUpdate
import com.claudemanager.app.data.models.CloseResponse
import com.claudemanager.app.data.models.AgentCostBreakdownResponse
import com.claudemanager.app.data.models.CostAnalyticsResponse
import com.claudemanager.app.data.models.CostReportBody
import com.claudemanager.app.data.models.CreateLaunchRequestBody
import com.claudemanager.app.data.models.CreateLaunchResponse
import com.claudemanager.app.data.models.CreateProjectBody
import com.claudemanager.app.data.models.CreateWebhookBody
import com.claudemanager.app.data.models.CreateWorkflowBody
import com.claudemanager.app.data.models.FileInfo
import com.claudemanager.app.data.models.FolderResponse
import com.claudemanager.app.data.models.HealthResponse
import com.claudemanager.app.data.models.OkResponse
import com.claudemanager.app.data.models.PredefinedRoleResponse
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
import okhttp3.MultipartBody
import okhttp3.RequestBody
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Multipart
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Part
import retrofit2.http.Path
import retrofit2.http.Query

/** Paginated response wrapper for list endpoints */
data class PaginatedResponse<T>(
    @SerializedName("data") val data: List<T>,
    @SerializedName("next_cursor") val nextCursor: String? = null,
    @SerializedName("has_more") val hasMore: Boolean = false
)

/**
 * Retrofit interface defining all ClaudeManager backend API endpoints.
 * All methods are suspend functions for Kotlin coroutine support.
 */
interface AgentApi {

    // ── Health ───────────────────────────────────────────────────────────

    @GET("api/health")
    suspend fun checkHealth(): Response<HealthResponse>

    // ── Roles ────────────────────────────────────────────────────────────

    /** Fetch all predefined agent roles from the server. */
    @GET("api/roles")
    suspend fun getRoles(): Response<List<PredefinedRoleResponse>>

    /** Fetch distinct non-null wt_window values for the window group selector. */
    @GET("api/agents/wt-windows")
    suspend fun getWtWindows(): Response<List<String>>

    // ── Agents CRUD ─────────────────────────────────────────────────────

    /**
     * List all agents, ordered by last_update_at descending.
     * Includes computed fields: pending_message_count, unread_update_count, latest_summary.
     */
    @GET("api/agents")
    suspend fun getAgents(): Response<PaginatedResponse<Agent>>

    /**
     * Get a single agent by ID, with computed fields.
     */
    @GET("api/agents/{id}")
    suspend fun getAgent(@Path("id") id: String): Response<Agent>

    /**
     * Update agent fields (title, status, poll_delay_until).
     * Returns the updated agent.
     */
    @PATCH("api/agents/{id}")
    suspend fun updateAgent(
        @Path("id") id: String,
        @Body body: UpdateAgentBody
    ): Response<Agent>

    /**
     * Delete an agent and all associated data (updates, messages, files).
     */
    @DELETE("api/agents/{id}")
    suspend fun deleteAgent(@Path("id") id: String): Response<OkResponse>

    /**
     * Mark an agent's updates as read (resets unread count).
     */
    @POST("api/agents/{id}/read")
    suspend fun markRead(@Path("id") id: String): Response<OkResponse>

    /**
     * Archive an agent and request termination of its process.
     * Returns whether the process was terminated and the PID.
     */
    @POST("api/agents/{id}/close")
    suspend fun closeAgent(@Path("id") id: String): Response<CloseResponse>

    /**
     * Send a signal (ctrl-c, enter) to the agent's terminal.
     */
    @POST("api/agents/{id}/signal")
    suspend fun sendSignal(@Path("id") id: String, @Body body: Map<String, String>): Response<OkResponse>

    /**
     * Type text into the agent's terminal (followed by Enter).
     */
    @POST("api/agents/{id}/input")
    suspend fun sendInput(@Path("id") id: String, @Body body: Map<String, String>): Response<OkResponse>

    /**
     * Resume an archived/suspended agent with its full conversation history.
     */
    @POST("api/agents/{id}/resume")
    suspend fun resumeAgent(@Path("id") id: String): Response<OkResponse>

    // ── Updates ──────────────────────────────────────────────────────────

    /**
     * Get updates for an agent, newest-first. Use [before] for older pages, [limit] to cap results.
     */
    @GET("api/agents/{id}/updates")
    suspend fun getUpdates(
        @Path("id") agentId: String,
        @Query("limit") limit: Int? = null,
        @Query("before") before: Long? = null
    ): Response<PaginatedResponse<AgentUpdate>>

    // ── Messages ─────────────────────────────────────────────────────────

    /**
     * Get messages for an agent, newest-first. Use [before] for older pages, [limit] to cap results.
     */
    @GET("api/agents/{id}/messages")
    suspend fun getMessages(
        @Path("id") agentId: String,
        @Query("limit") limit: Int? = null,
        @Query("before") before: Long? = null
    ): Response<PaginatedResponse<AgentMessage>>

    /**
     * Send a message to an agent (queues it for delivery on next poll).
     */
    @POST("api/agents/{id}/messages")
    suspend fun sendMessage(
        @Path("id") agentId: String,
        @Body body: SendMessageBody
    ): Response<OkResponse>

    // ── Files ────────────────────────────────────────────────────────────

    /**
     * List file metadata for an agent (without binary data).
     */
    @GET("api/agents/{id}/files")
    suspend fun getFiles(@Path("id") agentId: String): Response<PaginatedResponse<FileInfo>>

    /**
     * Upload a file attachment to an agent.
     * Uses multipart form data with a "file" field and optional "source" and "description" fields.
     */
    @Multipart
    @POST("api/agents/{id}/files")
    suspend fun uploadFile(
        @Path("id") agentId: String,
        @Part file: MultipartBody.Part,
        @Part("source") source: RequestBody,
        @Part("description") description: RequestBody
    ): Response<OkResponse>

    // ── Folders ──────────────────────────────────────────────────────────

    /**
     * Browse folders under the user's home directory on the server.
     * Used for selecting a project folder when launching a new agent.
     */
    @GET("api/folders")
    suspend fun getFolders(@Query("path") path: String = ""): Response<FolderResponse>

    // ── Launch Requests ──────────────────────────────────────────────────

    /**
     * Create a new launch request (new agent, resume session, or terminate).
     */
    @POST("api/launch-requests")
    suspend fun createLaunchRequest(
        @Body body: CreateLaunchRequestBody
    ): Response<CreateLaunchResponse>

    // ── Webhooks ─────────────────────────────────────────────────────────

    /**
     * List all configured webhooks.
     */
    @GET("api/webhooks")
    suspend fun getWebhooks(): Response<List<WebhookEntry>>

    /**
     * Create a new webhook.
     */
    @POST("api/webhooks")
    suspend fun createWebhook(@Body body: CreateWebhookBody): Response<WebhookEntry>

    /**
     * Update an existing webhook.
     */
    @PATCH("api/webhooks/{id}")
    suspend fun updateWebhook(
        @Path("id") id: Int,
        @Body body: UpdateWebhookBody
    ): Response<WebhookEntry>

    /**
     * Delete a webhook.
     */
    @DELETE("api/webhooks/{id}")
    suspend fun deleteWebhook(@Path("id") id: Int): Response<OkResponse>

    /**
     * Send a test event to a webhook to verify connectivity.
     */
    @POST("api/webhooks/{id}/test")
    suspend fun testWebhook(@Path("id") id: Int): Response<OkResponse>

    // ── Retention ────────────────────────────────────────────────────────

    /**
     * Get the current retention policy status, settings, and last run info.
     */
    @GET("api/retention/status")
    suspend fun getRetentionStatus(): Response<RetentionStatus>

    /**
     * Update retention policy settings.
     */
    @PATCH("api/retention/settings")
    suspend fun updateRetentionSettings(
        @Body body: RetentionSettingsBody
    ): Response<OkResponse>

    /**
     * Manually trigger a retention cleanup run.
     */
    @POST("api/retention/run")
    suspend fun runRetention(): Response<RetentionRunResult>

    // ── Workflows ────────────────────────────────────────────────────────

    /**
     * List all workflows.
     */
    @GET("api/workflows")
    suspend fun getWorkflows(): Response<List<Workflow>>

    /**
     * Create a new workflow.
     */
    @POST("api/workflows")
    suspend fun createWorkflow(@Body body: CreateWorkflowBody): Response<Workflow>

    /**
     * Get a single workflow by ID.
     */
    @GET("api/workflows/{id}")
    suspend fun getWorkflow(@Path("id") id: String): Response<Workflow>

    /**
     * Start a workflow.
     */
    @POST("api/workflows/{id}/start")
    suspend fun startWorkflow(@Path("id") id: String): Response<OkResponse>

    /**
     * Pause a running workflow.
     */
    @POST("api/workflows/{id}/pause")
    suspend fun pauseWorkflow(@Path("id") id: String): Response<OkResponse>

    /**
     * Delete a workflow.
     */
    @DELETE("api/workflows/{id}")
    suspend fun deleteWorkflow(@Path("id") id: String): Response<OkResponse>

    // ── Projects ─────────────────────────────────────────────────────────

    /**
     * List all projects.
     */
    @GET("api/projects")
    suspend fun getProjects(): Response<List<Project>>

    /**
     * Create a new project.
     */
    @POST("api/projects")
    suspend fun createProject(@Body body: CreateProjectBody): Response<Project>

    /**
     * Get a single project by ID.
     */
    @GET("api/projects/{id}")
    suspend fun getProject(@Path("id") id: String): Response<Project>

    /**
     * Get agents assigned to a project.
     */
    @GET("api/projects/{id}/agents")
    suspend fun getProjectAgents(@Path("id") id: String): Response<List<Agent>>

    /**
     * Get project timeline updates.
     */
    @GET("api/projects/{id}/updates")
    suspend fun getProjectUpdates(@Path("id") id: String): Response<PaginatedResponse<ProjectUpdate>>

    /**
     * Start a project.
     */
    @POST("api/projects/{id}/start")
    suspend fun startProject(@Path("id") id: String, @Body body: Map<String, String> = emptyMap()): Response<OkResponse>

    /**
     * Pause a running project.
     */
    @POST("api/projects/{id}/pause")
    suspend fun pauseProject(@Path("id") id: String): Response<OkResponse>

    /**
     * Mark a project as complete.
     */
    @POST("api/projects/{id}/complete")
    suspend fun completeProject(@Path("id") id: String): Response<OkResponse>

    /**
     * Get files from all agents in a project.
     */
    @GET("api/projects/{id}/files")
    suspend fun getProjectFiles(@Path("id") id: String): Response<List<ProjectFile>>

    /**
     * Delete a project.
     */
    @DELETE("api/projects/{id}")
    suspend fun deleteProject(@Path("id") id: String): Response<OkResponse>

    /**
     * Spawn a new agent within a project.
     */
    @POST("api/projects/{id}/spawn-agent")
    suspend fun spawnProjectAgent(
        @Path("id") id: String,
        @Body body: SpawnAgentBody
    ): Response<OkResponse>

    // ── Agent Relay ──────────────────────────────────────────────────────

    /**
     * Relay a message from one agent to another (agent-to-agent communication).
     */
    @POST("api/agents/{id}/relay")
    suspend fun relayMessage(
        @Path("id") id: String,
        @Body body: RelayBody
    ): Response<OkResponse>

    // ── Terminal Streaming ───────────────────────────────────────────────

    /**
     * Send terminal output for an agent. The output is ephemeral and
     * broadcast to connected SSE clients.
     */
    @POST("api/agents/{id}/terminal")
    suspend fun postTerminalOutput(
        @Path("id") id: String,
        @Body body: TerminalOutputBody
    ): Response<OkResponse>

    // ── Cost Tracking ───────────────────────────────────────────────────

    /**
     * Report cost/token usage for an agent. Accumulates in agent metadata.
     */
    @POST("api/agents/{id}/cost")
    suspend fun reportCost(
        @Path("id") id: String,
        @Body body: CostReportBody
    ): Response<OkResponse>

    /**
     * Get aggregate cost analytics across all agents.
     */
    @GET("api/agents/analytics/costs")
    suspend fun getCostAnalytics(): Response<CostAnalyticsResponse>

    /**
     * Get per-agent cost breakdown by task label.
     */
    @GET("api/agents/{id}/costs")
    suspend fun getAgentCosts(
        @Path("id") id: String
    ): Response<AgentCostBreakdownResponse>

    // ── File Sharing ────────────────────────────────────────────────────

    /**
     * Share a file from one agent to another (copies the file).
     */
    @POST("api/agents/{id}/share-file")
    suspend fun shareFile(
        @Path("id") id: String,
        @Body body: ShareFileRequest
    ): Response<OkResponse>
}
