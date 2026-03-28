package com.claudemanager.app.data.api

import com.claudemanager.app.data.models.Agent
import com.claudemanager.app.data.models.AgentMessage
import com.claudemanager.app.data.models.AgentUpdate
import com.claudemanager.app.data.models.CloseResponse
import com.claudemanager.app.data.models.CreateLaunchRequestBody
import com.claudemanager.app.data.models.CreateLaunchResponse
import com.claudemanager.app.data.models.FileInfo
import com.claudemanager.app.data.models.FolderResponse
import com.claudemanager.app.data.models.HealthResponse
import com.claudemanager.app.data.models.OkResponse
import com.claudemanager.app.data.models.SendMessageBody
import com.claudemanager.app.data.models.UpdateAgentBody
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

/**
 * Retrofit interface defining all ClaudeManager backend API endpoints.
 * All methods are suspend functions for Kotlin coroutine support.
 */
interface AgentApi {

    // ── Health ───────────────────────────────────────────────────────────

    @GET("api/health")
    suspend fun checkHealth(): Response<HealthResponse>

    // ── Agents CRUD ─────────────────────────────────────────────────────

    /**
     * List all agents, ordered by last_update_at descending.
     * Includes computed fields: pending_message_count, unread_update_count, latest_summary.
     */
    @GET("api/agents")
    suspend fun getAgents(): Response<List<Agent>>

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

    // ── Updates ──────────────────────────────────────────────────────────

    /**
     * Get all updates for an agent, ordered by timestamp ascending.
     */
    @GET("api/agents/{id}/updates")
    suspend fun getUpdates(@Path("id") agentId: String): Response<List<AgentUpdate>>

    // ── Messages ─────────────────────────────────────────────────────────

    /**
     * Get all messages for an agent, ordered by created_at ascending.
     */
    @GET("api/agents/{id}/messages")
    suspend fun getMessages(@Path("id") agentId: String): Response<List<AgentMessage>>

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
    suspend fun getFiles(@Path("id") agentId: String): Response<List<FileInfo>>

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
}
