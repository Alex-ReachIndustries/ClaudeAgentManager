package com.claudemanager.app.ui.detail

import android.app.Application
import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Environment
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.claudemanager.app.ClaudeManagerApp
import com.claudemanager.app.data.models.Agent
import com.claudemanager.app.data.models.AgentMessage
import com.claudemanager.app.data.models.AgentUpdate
import com.claudemanager.app.data.models.AgentStatus
import com.claudemanager.app.data.models.FileInfo
import com.claudemanager.app.data.sse.SSEEvent
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Tabs available on the agent detail screen.
 */
enum class DetailTab {
    CONVERSATION,
    TERMINAL,
    INFO
}

/**
 * Represents a file that has been attached (uploaded) and is pending inclusion in the next message.
 */
data class AttachedFile(
    val id: Long? = null,
    val filename: String,
    val isUploading: Boolean = false
)

/**
 * UI state for the agent detail screen.
 */
data class AgentDetailUiState(
    val agent: Agent? = null,
    val updates: List<AgentUpdate> = emptyList(),
    val messages: List<AgentMessage> = emptyList(),
    val files: List<FileInfo> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null,
    val selectedTab: DetailTab = DetailTab.CONVERSATION,
    val isSendingMessage: Boolean = false,
    val isUploading: Boolean = false,
    val isRefreshing: Boolean = false,
    val draftMessage: String = "",
    val otherAgents: List<Agent> = emptyList(),
    val isRelaying: Boolean = false,
    val isExporting: Boolean = false,
    val lastUploadedFileName: String? = null,
    val pendingAttachments: List<AttachedFile> = emptyList(),
    val terminalLines: List<String> = emptyList(),
    val isSharingFile: Boolean = false
)

/**
 * ViewModel for the agent detail screen.
 *
 * Loads the agent, its updates, messages, and files. Polls periodically for
 * updates to provide near-real-time data. Provides actions for sending
 * messages, uploading files, and managing the agent lifecycle.
 */
class AgentDetailViewModel(
    application: Application,
    private val agentId: String
) : AndroidViewModel(application) {

    private val app = application as ClaudeManagerApp
    private val repository = app.repository

    private val _uiState = MutableStateFlow(AgentDetailUiState())
    val uiState: StateFlow<AgentDetailUiState> = _uiState.asStateFlow()

    companion object {
        /** Maximum number of terminal lines to keep in the buffer. */
        private const val MAX_TERMINAL_LINES = 200
    }

    init {
        loadAll()
        markRead()
        startPolling()
        listenForTerminalOutput()
    }

    /**
     * Load all data for this agent.
     */
    private fun loadAll() {
        _uiState.update { it.copy(isLoading = true) }
        viewModelScope.launch {
            // Load agent details
            repository.getAgent(agentId)
                .onSuccess { agent ->
                    _uiState.update { it.copy(agent = agent) }
                }
                .onFailure { e ->
                    _uiState.update { it.copy(error = e.message ?: "Failed to load agent") }
                }

            // Load updates
            repository.getUpdates(agentId)
                .onSuccess { updates ->
                    _uiState.update { it.copy(updates = updates) }
                }

            // Load messages
            repository.getMessages(agentId)
                .onSuccess { messages ->
                    _uiState.update { it.copy(messages = messages) }
                }

            // Load files
            repository.getFiles(agentId)
                .onSuccess { files ->
                    _uiState.update { it.copy(files = files) }
                }

            _uiState.update { it.copy(isLoading = false) }
        }
    }

    /**
     * Poll for updates every 5 seconds to keep the UI fresh.
     * This compensates for not having direct SSE access in the ViewModel.
     */
    private fun startPolling() {
        viewModelScope.launch {
            while (isActive) {
                delay(5_000)
                refreshAgent()
                refreshUpdates()
                refreshMessages()
            }
        }
    }

    /**
     * Manual refresh triggered by pull-to-refresh.
     */
    fun refreshAll() {
        _uiState.update { it.copy(isRefreshing = true) }
        viewModelScope.launch {
            refreshAgent()
            refreshUpdates()
            refreshMessages()
            refreshFiles()
            _uiState.update { it.copy(isRefreshing = false) }
        }
    }

    /**
     * Change the selected tab.
     */
    fun selectTab(tab: DetailTab) {
        _uiState.update { it.copy(selectedTab = tab) }
    }

    /**
     * Mark all updates for this agent as read.
     */
    fun markRead() {
        viewModelScope.launch {
            repository.markRead(agentId)
        }
    }

    /**
     * Update the draft message text (persists across tab switches).
     */
    fun updateDraftMessage(text: String) {
        _uiState.update { it.copy(draftMessage = text) }
    }

    fun clearAttachment() {
        _uiState.update { it.copy(lastUploadedFileName = null, pendingAttachments = emptyList()) }
    }

    /**
     * Remove a single pending attachment by filename.
     */
    fun removeAttachment(filename: String) {
        _uiState.update { state ->
            state.copy(
                pendingAttachments = state.pendingAttachments.filter { it.filename != filename }
            )
        }
    }

    /**
     * Send a message to the agent.
     * If there are pending attachments, appends "[File attached: name (id=X)]" references.
     * On success, clears the draft and attachments. On failure, keeps the draft so the user can retry.
     */
    fun sendMessage(content: String) {
        if (content.isBlank() && _uiState.value.pendingAttachments.isEmpty()) return

        _uiState.update { it.copy(isSendingMessage = true) }
        viewModelScope.launch {
            // Build message with attachment references
            val attachments = _uiState.value.pendingAttachments
            val fullContent = buildString {
                append(content)
                for (att in attachments) {
                    if (isNotEmpty()) append("\n")
                    if (att.id != null) {
                        append("[File attached: ${att.filename} (id=${att.id})]")
                    } else {
                        append("[File attached: ${att.filename}]")
                    }
                }
            }

            repository.sendMessage(agentId, fullContent)
                .onSuccess {
                    _uiState.update { it.copy(
                        draftMessage = "",
                        lastUploadedFileName = null,
                        pendingAttachments = emptyList()
                    ) }
                    refreshMessages()
                }
                .onFailure { e ->
                    // Keep the message in the draft so the user can retry
                    _uiState.update { it.copy(
                        error = e.message ?: "Failed to send message",
                        draftMessage = content
                    ) }
                }
            _uiState.update { it.copy(isSendingMessage = false) }
        }
    }

    /**
     * Upload a file attachment to the agent.
     * On success, adds the file to pendingAttachments for inclusion with the next message.
     */
    fun uploadFile(uri: Uri, context: Context) {
        // Resolve the display name from the URI for the confirmation chip
        val displayName = context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
            val nameIndex = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
            cursor.moveToFirst()
            if (nameIndex >= 0) cursor.getString(nameIndex) else null
        } ?: uri.lastPathSegment ?: "file"

        _uiState.update { it.copy(isUploading = true) }
        viewModelScope.launch {
            repository.uploadFile(agentId, uri, context)
                .onSuccess {
                    refreshFiles()
                    // Find the most recently uploaded file to get its ID
                    val latestFiles = repository.getFiles(agentId).getOrNull() ?: emptyList()
                    val uploadedFile = latestFiles.find { it.filename == displayName }
                    val attachment = AttachedFile(
                        id = uploadedFile?.id,
                        filename = displayName,
                        isUploading = false
                    )
                    _uiState.update { state ->
                        state.copy(
                            lastUploadedFileName = displayName,
                            pendingAttachments = state.pendingAttachments + attachment
                        )
                    }
                }
                .onFailure { e ->
                    _uiState.update { it.copy(error = e.message ?: "Failed to upload file") }
                }
            _uiState.update { it.copy(isUploading = false) }
        }
    }

    /**
     * Send a signal (ctrl-c or enter) to the agent's terminal.
     */
    fun sendSignal(signal: String) {
        viewModelScope.launch {
            repository.sendSignal(agentId, signal)
                .onFailure { e ->
                    _uiState.update { it.copy(error = "Signal failed: ${e.message}") }
                }
        }
    }

    /**
     * Resume the agent by creating a resume launch request.
     */
    fun resumeAgent() {
        val agent = _uiState.value.agent ?: return
        viewModelScope.launch {
            repository.createLaunchRequest(
                type = "resume",
                folderPath = agent.cwd ?: "",
                resumeAgentId = agentId
            ).onSuccess {
                _uiState.update { it.copy(error = null) }
                refreshAgent()
            }.onFailure { e ->
                _uiState.update { it.copy(error = e.message ?: "Failed to resume agent") }
            }
        }
    }

    /**
     * Export the agent as PDF by downloading in-app via OkHttp (with auth interceptor),
     * saving to cache, and opening via FileProvider.
     */
    fun exportPdf(context: Context) {
        _uiState.update { it.copy(isExporting = true) }
        viewModelScope.launch(kotlinx.coroutines.Dispatchers.IO) {
            try {
                val url = "${com.claudemanager.app.data.api.ApiClient.getBaseUrl()}/api/agents/$agentId/export/pdf"
                val client = com.claudemanager.app.data.api.ApiClient.getRetrofit().callFactory() as okhttp3.OkHttpClient
                val request = okhttp3.Request.Builder().url(url).build()
                val response = client.newCall(request).execute()
                if (response.isSuccessful) {
                    val body = response.body ?: run {
                        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                            _uiState.update { it.copy(isExporting = false, error = "PDF export returned empty response") }
                        }
                        return@launch
                    }
                    val cacheDir = java.io.File(context.cacheDir, "downloads")
                    cacheDir.mkdirs()
                    val agentTitle = _uiState.value.agent?.title?.replace(Regex("[^a-zA-Z0-9_-]"), "_") ?: "agent"
                    val filename = "${agentTitle}_export.pdf"
                    val file = java.io.File(cacheDir, filename)
                    file.outputStream().use { out ->
                        body.byteStream().use { it.copyTo(out) }
                    }
                    kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                        _uiState.update { it.copy(isExporting = false) }
                        try {
                            val uri = androidx.core.content.FileProvider.getUriForFile(
                                context,
                                "${context.packageName}.fileprovider",
                                file
                            )
                            val intent = android.content.Intent(android.content.Intent.ACTION_VIEW).apply {
                                setDataAndType(uri, "application/pdf")
                                addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
                            }
                            context.startActivity(intent)
                        } catch (_: Exception) {
                            _uiState.update { it.copy(error = "PDF saved but no app available to open it") }
                        }
                    }
                } else {
                    kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                        _uiState.update { it.copy(isExporting = false, error = "PDF export failed: HTTP ${response.code}") }
                    }
                }
            } catch (e: Exception) {
                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                    _uiState.update { it.copy(isExporting = false, error = "PDF export failed: ${e.message}") }
                }
            }
        }
    }

    /**
     * Close the agent (archive + terminate process).
     */
    fun closeAgent() {
        viewModelScope.launch {
            repository.closeAgent(agentId)
                .onSuccess {
                    refreshAgent()
                }
                .onFailure { e ->
                    _uiState.update { it.copy(error = e.message ?: "Failed to close agent") }
                }
        }
    }

    /**
     * Archive the agent (set status to archived).
     */
    fun archiveAgent() {
        viewModelScope.launch {
            repository.updateAgent(agentId, status = "archived")
                .onSuccess { agent ->
                    _uiState.update { it.copy(agent = agent) }
                }
                .onFailure { e ->
                    _uiState.update { it.copy(error = e.message ?: "Failed to archive agent") }
                }
        }
    }

    /**
     * Un-archive the agent (set status to idle).
     */
    fun unarchiveAgent() {
        viewModelScope.launch {
            repository.updateAgent(agentId, status = "idle")
                .onSuccess { agent ->
                    _uiState.update { it.copy(agent = agent) }
                }
                .onFailure { e ->
                    _uiState.update { it.copy(error = e.message ?: "Failed to unarchive agent") }
                }
        }
    }

    /**
     * Delete the agent and all its data.
     */
    fun deleteAgent(onDeleted: () -> Unit) {
        viewModelScope.launch {
            repository.deleteAgent(agentId)
                .onSuccess {
                    onDeleted()
                }
                .onFailure { e ->
                    _uiState.update { it.copy(error = e.message ?: "Failed to delete agent") }
                }
        }
    }

    /**
     * Get the download URL for a specific file.
     */
    fun getFileDownloadUrl(fileId: Long): String {
        return repository.getFileDownloadUrl(agentId, fileId)
    }

    /**
     * Download a file using OkHttp (which trusts Tailscale certs), save to app cache,
     * then open with a share/view intent. No storage permissions needed.
     */
    fun downloadFile(fileId: Long, filename: String, context: Context) {
        viewModelScope.launch(kotlinx.coroutines.Dispatchers.IO) {
            try {
                val url = repository.getFileDownloadUrl(agentId, fileId)
                val client = com.claudemanager.app.data.api.ApiClient.getRetrofit().callFactory() as okhttp3.OkHttpClient
                val request = okhttp3.Request.Builder().url(url).build()
                val response = client.newCall(request).execute()
                if (response.isSuccessful) {
                    val body = response.body ?: return@launch
                    // Save to app's cache dir (no permission needed)
                    val cacheDir = java.io.File(context.cacheDir, "downloads")
                    cacheDir.mkdirs()
                    val file = java.io.File(cacheDir, filename)
                    file.outputStream().use { out ->
                        body.byteStream().use { it.copyTo(out) }
                    }
                    // Open the file via FileProvider or direct intent
                    kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                        try {
                            val uri = androidx.core.content.FileProvider.getUriForFile(
                                context,
                                "${context.packageName}.fileprovider",
                                file
                            )
                            val intent = android.content.Intent(android.content.Intent.ACTION_VIEW).apply {
                                setDataAndType(uri, response.header("Content-Type") ?: "application/octet-stream")
                                addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
                            }
                            context.startActivity(intent)
                        } catch (_: Exception) {
                            _uiState.update { it.copy(error = "Downloaded: $filename (no app to open)") }
                        }
                    }
                } else {
                    kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                        _uiState.update { it.copy(error = "Download failed: HTTP ${response.code}") }
                    }
                }
            } catch (e: Exception) {
                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                    _uiState.update { it.copy(error = "Download failed: ${e.message}") }
                }
            }
        }
    }

    // ── Agent Relay ────────────────────────────────────────────────────

    /**
     * Load the list of other active agents for the relay dialog.
     */
    fun loadOtherAgents() {
        viewModelScope.launch {
            repository.getAgents().onSuccess { agents ->
                val others = agents.filter { it.id != agentId && it.isLive }
                _uiState.update { it.copy(otherAgents = others) }
            }
        }
    }

    /**
     * Relay a message from this agent to another agent.
     */
    fun relayMessage(targetAgentId: String, content: String) {
        if (content.isBlank()) return

        _uiState.update { it.copy(isRelaying = true) }
        viewModelScope.launch {
            repository.relayMessage(agentId, targetAgentId, content)
                .onSuccess {
                    _uiState.update { it.copy(isRelaying = false, error = null) }
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(
                            isRelaying = false,
                            error = e.message ?: "Failed to relay message"
                        )
                    }
                }
        }
    }

    // ── Terminal Streaming ────────────────────────────────────────────────

    /**
     * Listen for terminal-output SSE events scoped to this agent and append
     * new lines to the terminal buffer (capped at [MAX_TERMINAL_LINES]).
     */
    private fun listenForTerminalOutput() {
        viewModelScope.launch {
            app.let { application ->
                // Access the SSE client from the notification service singleton if available,
                // or create a lightweight listener on the shared SSE flow.
                try {
                    com.claudemanager.app.service.AgentNotificationService.sseEvents?.collect { event ->
                        if (event is SSEEvent.TerminalOutput && event.agentId == agentId) {
                            appendTerminalOutput(event.output)
                        }
                    }
                } catch (_: Exception) {
                    // SSE not available; terminal will remain empty until SSE connects
                }
            }
        }
    }

    /**
     * Append text to the terminal output buffer, keeping the last [MAX_TERMINAL_LINES] lines.
     */
    private fun appendTerminalOutput(output: String) {
        _uiState.update { state ->
            val newLines = output.lines()
            val combined = state.terminalLines + newLines
            val trimmed = if (combined.size > MAX_TERMINAL_LINES) {
                combined.takeLast(MAX_TERMINAL_LINES)
            } else {
                combined
            }
            state.copy(terminalLines = trimmed)
        }
    }

    // ── File Sharing ───────────────────────────────────────────────────

    /**
     * Share a file from this agent to another agent.
     *
     * @param fileId The file to share.
     * @param targetAgentId The agent to copy the file to.
     */
    fun shareFile(fileId: Long, targetAgentId: String) {
        _uiState.update { it.copy(isSharingFile = true) }
        viewModelScope.launch {
            repository.shareFile(agentId, fileId, targetAgentId)
                .onSuccess {
                    _uiState.update {
                        it.copy(isSharingFile = false, error = null)
                    }
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(
                            isSharingFile = false,
                            error = e.message ?: "Failed to share file"
                        )
                    }
                }
        }
    }

    // ── Refresh helpers ──────────────────────────────────────────────────

    private fun refreshAgent() {
        viewModelScope.launch {
            repository.getAgent(agentId).onSuccess { agent ->
                _uiState.update { it.copy(agent = agent) }
            }
        }
    }

    private fun refreshUpdates() {
        viewModelScope.launch {
            repository.getUpdates(agentId).onSuccess { updates ->
                _uiState.update { it.copy(updates = updates) }
            }
        }
    }

    private fun refreshMessages() {
        viewModelScope.launch {
            repository.getMessages(agentId).onSuccess { messages ->
                _uiState.update { it.copy(messages = messages) }
            }
        }
    }

    private fun refreshFiles() {
        viewModelScope.launch {
            repository.getFiles(agentId).onSuccess { files ->
                _uiState.update { it.copy(files = files) }
            }
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}
