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
import com.claudemanager.app.data.models.AgentCostBreakdownResponse
import com.claudemanager.app.data.models.FileInfo
import com.claudemanager.app.data.sse.SSEEvent
import com.claudemanager.app.ui.PredefinedRole
import com.claudemanager.app.ui.PREDEFINED_ROLES
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.async
import kotlinx.coroutines.launch

/**
 * Tabs available on the agent detail screen.
 */
enum class DetailTab {
    CONVERSATION,
    COSTS,
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
 * A prior message the user has selected (via swipe-right) to reference in their
 * next outgoing message. Mirrors the file-attachment reference UX: shown as a
 * dismissible chip above the composer and prepended as a text reference on send.
 */
data class PendingReply(
    val msgId: Long,
    val snippet: String,
    val sourceLabel: String
)

/**
 * A file that has been downloaded to the app cache and is awaiting the user's
 * choice of what to do with it (open with an app or save to device storage).
 */
data class PendingDownload(
    val filename: String,
    val mimeType: String,
    val cachedFile: java.io.File
)

/**
 * Records that the user has tapped a file and is currently being shown the
 * Open/Save action dialog. Captured immediately on tap, *before* any download
 * starts, so the UI feels responsive even for large files.
 */
data class PendingFileAction(val fileId: Long, val filename: String)

/**
 * An "Open" download currently in progress. The UI shows a blocking progress
 * dialog while the file streams to cache, then dispatches ACTION_VIEW on
 * completion. Save-to-device downloads do *not* use this state — they run in
 * [com.claudemanager.app.service.FileDownloadService] with a notification.
 */
data class ActiveDownload(
    val fileId: Long,
    val filename: String,
    /** 0f..1f when total size is known; -1f for indeterminate. */
    val progress: Float
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
    val pendingReply: PendingReply? = null,
    val terminalLines: List<String> = emptyList(),
    val isSharingFile: Boolean = false,
    val costBreakdown: AgentCostBreakdownResponse? = null,
    val isLoadingCosts: Boolean = false,
    val pendingDownload: PendingDownload? = null,
    val pendingFileAction: PendingFileAction? = null,
    val activeDownload: ActiveDownload? = null,
    val predefinedRoles: List<PredefinedRole> = PREDEFINED_ROLES,
    val wtWindows: List<String> = emptyList(),
    // Pagination state for the conversation feed
    val hasMoreUpdates: Boolean = false,
    val hasMoreMessages: Boolean = false,
    val oldestUpdateId: Long? = null,
    val oldestMessageId: Long? = null,
    val maxUpdateId: Long? = null,
    val maxMessageId: Long? = null,
    val isLoadingMore: Boolean = false
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
        /** Number of items to load per page for updates and messages. */
        private const val PAGE_SIZE = 50
    }

    init {
        loadAll()
        loadRoles()
        loadWtWindows()
        markRead()
        startPolling()
        listenForTerminalOutput()
        listenForAcknowledgements()
    }

    private fun loadWtWindows() {
        viewModelScope.launch {
            repository.getWtWindows().onSuccess { windows ->
                _uiState.update { it.copy(wtWindows = windows) }
            }
        }
    }

    private fun loadRoles() {
        viewModelScope.launch {
            repository.getRoles().onSuccess { roles ->
                _uiState.update {
                    it.copy(predefinedRoles = roles.map { r -> PredefinedRole(r.id, r.displayName, r.fullDefinition) })
                }
            }
        }
    }

    /**
     * Load all data for this agent. Updates and messages load only the most recent page
     * so the initial display is fast even for long sessions.
     */
    private fun loadAll() {
        _uiState.update { it.copy(isLoading = true) }
        viewModelScope.launch {
            val agentD    = async { repository.getAgent(agentId) }
            val updatesD  = async { repository.getUpdatesPage(agentId, PAGE_SIZE) }
            val messagesD = async { repository.getMessagesPage(agentId, PAGE_SIZE) }
            val filesD    = async { repository.getFiles(agentId) }

            agentD.await()
                .onSuccess { agent -> _uiState.update { it.copy(agent = agent) } }
                .onFailure { e -> _uiState.update { it.copy(error = e.message ?: "Failed to load agent") } }

            updatesD.await().onSuccess { page ->
                // Backend returns DESC; reverse to ASC for display
                val sorted = page.data.sortedBy { it.id }
                _uiState.update { it.copy(
                    updates = sorted,
                    hasMoreUpdates = page.hasMore,
                    oldestUpdateId = sorted.firstOrNull()?.id,
                    maxUpdateId = sorted.lastOrNull()?.id
                ) }
            }

            messagesD.await().onSuccess { page ->
                val sorted = page.data.sortedBy { it.id }
                _uiState.update { it.copy(
                    messages = sorted,
                    hasMoreMessages = page.hasMore,
                    oldestMessageId = sorted.firstOrNull()?.id,
                    maxMessageId = sorted.lastOrNull()?.id
                ) }
            }

            filesD.await()
                .onSuccess { files -> _uiState.update { it.copy(files = files) } }

            _uiState.update { it.copy(isLoading = false) }
        }
    }

    /**
     * Load older updates and messages (scroll-to-top "load more" trigger).
     * Prepends the older items to the existing lists without scrolling.
     */
    fun loadMoreHistory() {
        val state = _uiState.value
        if (state.isLoadingMore) return
        val hasMore = state.hasMoreUpdates || state.hasMoreMessages
        if (!hasMore) return

        _uiState.update { it.copy(isLoadingMore = true) }
        viewModelScope.launch {
            val updatesD = async {
                if (state.hasMoreUpdates && state.oldestUpdateId != null)
                    repository.getUpdatesPage(agentId, PAGE_SIZE, before = state.oldestUpdateId)
                else null
            }
            val messagesD = async {
                if (state.hasMoreMessages && state.oldestMessageId != null)
                    repository.getMessagesPage(agentId, PAGE_SIZE, before = state.oldestMessageId)
                else null
            }

            updatesD.await()?.onSuccess { page ->
                val older = page.data.sortedBy { it.id }
                _uiState.update { s -> s.copy(
                    updates = older + s.updates,
                    hasMoreUpdates = page.hasMore,
                    oldestUpdateId = older.firstOrNull()?.id ?: s.oldestUpdateId
                ) }
            }

            messagesD.await()?.onSuccess { page ->
                val older = page.data.sortedBy { it.id }
                _uiState.update { s -> s.copy(
                    messages = older + s.messages,
                    hasMoreMessages = page.hasMore,
                    oldestMessageId = older.firstOrNull()?.id ?: s.oldestMessageId
                ) }
            }

            _uiState.update { it.copy(isLoadingMore = false) }
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
     * Manual refresh triggered by pull-to-refresh. Reloads the latest page and
     * resets pagination cursors so "load more" works correctly after a hard refresh.
     */
    fun refreshAll() {
        _uiState.update { it.copy(isRefreshing = true) }
        viewModelScope.launch {
            val a  = async { repository.getAgent(agentId) }
            val u  = async { repository.getUpdatesPage(agentId, PAGE_SIZE) }
            val m  = async { repository.getMessagesPage(agentId, PAGE_SIZE) }
            val f  = async { repository.getFiles(agentId) }
            a.await().onSuccess { agent -> _uiState.update { it.copy(agent = agent) } }
            u.await().onSuccess { page ->
                val sorted = page.data.sortedBy { it.id }
                _uiState.update { it.copy(
                    updates = sorted,
                    hasMoreUpdates = page.hasMore,
                    oldestUpdateId = sorted.firstOrNull()?.id,
                    maxUpdateId = sorted.lastOrNull()?.id
                ) }
            }
            m.await().onSuccess { page ->
                val sorted = page.data.sortedBy { it.id }
                _uiState.update { it.copy(
                    messages = sorted,
                    hasMoreMessages = page.hasMore,
                    oldestMessageId = sorted.firstOrNull()?.id,
                    maxMessageId = sorted.lastOrNull()?.id
                ) }
            }
            f.await().onSuccess { files -> _uiState.update { it.copy(files = files) } }
            _uiState.update { it.copy(isRefreshing = false) }
        }
    }

    /**
     * Change the selected tab.
     */
    fun selectTab(tab: DetailTab) {
        _uiState.update { it.copy(selectedTab = tab) }
        if (tab == DetailTab.COSTS && _uiState.value.costBreakdown == null) {
            loadCosts()
        }
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
     * Select a prior message to reference in the next outgoing message (swipe-right).
     * Replaces any existing pending reply.
     */
    fun setReply(message: AgentMessage) {
        val label = when (message.source) {
            "agent" -> message.sourceAgentId?.let { "Agent $it" } ?: "Agent"
            "peer" -> "${message.sourceAgentId?.let { "Agent ${it.take(8)}" } ?: "Peer"} @ ${message.sourcePeerName ?: "unknown"}"
            else -> "You"
        }
        val snippet = message.content.replace(Regex("\\s+"), " ").trim().take(80)
        _uiState.update { it.copy(pendingReply = PendingReply(message.id, snippet, label)) }
    }

    /**
     * Clear the pending reply reference.
     */
    fun clearReply() {
        _uiState.update { it.copy(pendingReply = null) }
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
            val reply = _uiState.value.pendingReply
            val fullContent = buildString {
                // Reply reference is prepended so it reads as context for the message below it.
                if (reply != null) {
                    append("[Replying to message #${reply.msgId} from ${reply.sourceLabel}: \"${reply.snippet}\"]\n\n")
                }
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
                        pendingAttachments = emptyList(),
                        pendingReply = null
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
                .onSuccess { uploaded ->
                    refreshFiles()
                    val attachment = AttachedFile(
                        id = uploaded.id.takeIf { it != 0L },
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

    fun sendInput(text: String) {
        viewModelScope.launch {
            repository.sendInput(agentId, text)
                .onFailure { e ->
                    _uiState.update { it.copy(error = "Input failed: ${e.message}") }
                }
        }
    }

    /**
     * Resume the agent. For archived/completed/failed agents this calls
     * POST /api/agents/{id}/resume so the backend status guard runs and the
     * stored context_handoff is restored. For live agents (where /resume would
     * 400) we fall back to a direct launch request — useful when the user
     * wants to spawn a fresh process in the same folder/window.
     */
    fun resumeAgent() {
        val agent = _uiState.value.agent ?: return
        viewModelScope.launch {
            val canUseResumeEndpoint = agent.status == AgentStatus.ARCHIVED
            val result = if (canUseResumeEndpoint) {
                repository.resumeAgent(agentId)
            } else {
                repository.createLaunchRequest(
                    type = "resume",
                    folderPath = agent.cwd ?: agent.workspace ?: "",
                    resumeAgentId = agentId,
                    wtWindow = agent.wtWindow ?: agent.projectName
                ).map { }
            }
            result.onSuccess {
                _uiState.update { it.copy(error = null) }
                refreshAgent()
            }.onFailure { e ->
                _uiState.update { it.copy(error = e.message ?: "Failed to resume agent") }
            }
        }
    }

    fun terminateAgent() {
        val agent = _uiState.value.agent ?: return
        viewModelScope.launch {
            repository.createLaunchRequest(
                type = "terminate",
                folderPath = "",
                resumeAgentId = agentId,
                targetPid = agent.pid
            ).onSuccess {
                refreshAgent()
            }.onFailure { e ->
                _uiState.update { it.copy(error = e.message ?: "Failed to terminate agent") }
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
     * Terminate the agent and immediately resume it (restart) in the same window.
     */
    fun terminateAndResume() {
        val agent = _uiState.value.agent ?: return
        viewModelScope.launch {
            repository.createLaunchRequest(
                type = "terminate-resume",
                folderPath = agent.cwd ?: agent.workspace ?: "",
                resumeAgentId = agentId,
                targetPid = agent.pid,
                wtWindow = agent.wtWindow ?: agent.projectName
            ).onSuccess {
                refreshAgent()
            }.onFailure { e ->
                _uiState.update { it.copy(error = "Terminate & Resume failed: ${e.message}") }
            }
        }
    }

    /**
     * Archive the agent. Goes through POST /:id/close which both archives the
     * record and fires a terminate launch request — so the running tmux/claude
     * process is actually killed instead of being left polling in the
     * background.
     */
    fun archiveAgent() {
        viewModelScope.launch {
            repository.closeAgent(agentId)
                .onSuccess { refreshAgent() }
                .onFailure { e ->
                    _uiState.update { it.copy(error = e.message ?: "Failed to archive agent") }
                }
        }
    }

    /**
     * Un-archive an agent by spawning a fresh process via POST /:id/resume.
     * Just flipping the DB status was misleading: it made the agent appear
     * live in the list while no process was actually polling.
     */
    fun unarchiveAgent() {
        viewModelScope.launch {
            repository.resumeAgent(agentId)
                .onSuccess { refreshAgent() }
                .onFailure { e ->
                    _uiState.update { it.copy(error = e.message ?: "Failed to unarchive agent") }
                }
        }
    }

    /**
     * Update role, effort, and/or model for this agent.
     */
    fun updateWtWindow(wtWindow: String?) {
        viewModelScope.launch {
            repository.updateAgent(agentId, wtWindow = wtWindow)
                .onSuccess { agent ->
                    _uiState.update { it.copy(agent = agent) }
                    loadWtWindows()
                }
                .onFailure { e ->
                    _uiState.update { it.copy(error = e.message ?: "Failed to update window group") }
                }
        }
    }

    fun updateAgentFields(role: String? = null, effort: String? = null, model: String? = null) {
        viewModelScope.launch {
            repository.updateAgent(agentId, role = role, effort = effort, model = model)
                .onSuccess { agent ->
                    _uiState.update { it.copy(agent = agent) }
                    val parts = mutableListOf<String>()
                    if (role != null) parts.add("role: \"$role\"")
                    if (effort != null) parts.add("effort: $effort")
                    if (model != null) parts.add("model: $model")
                    if (parts.isNotEmpty()) {
                        repository.sendMessage(
                            agentId,
                            "Your settings have been updated — ${parts.joinToString(", ")}. Please follow your new role/settings."
                        ).onFailure { e ->
                            _uiState.update {
                                it.copy(error = "Settings saved, but agent notification failed: ${e.message}")
                            }
                        }
                    }
                }
                .onFailure { e ->
                    _uiState.update { it.copy(error = e.message ?: "Failed to update agent") }
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
     * Show the Open/Save action dialog for a tapped file. Called immediately
     * on tap, before any network activity, so the UI feels responsive.
     */
    fun showFileActionDialog(fileId: Long, filename: String) {
        _uiState.update { it.copy(pendingFileAction = PendingFileAction(fileId, filename)) }
    }

    /** Dismiss the file action dialog without taking any action. */
    fun dismissFileActionDialog() {
        _uiState.update { it.copy(pendingFileAction = null) }
    }

    /**
     * Hand a save-to-SAF download off to [FileDownloadService] so it survives
     * the agent screen being closed or the app being backgrounded. The service
     * shows its own progress notification; the in-app UI just confirms via
     * snackbar that the save started.
     */
    fun downloadFileToUri(fileId: Long, filename: String, uri: android.net.Uri, context: Context) {
        val url = repository.getFileDownloadUrl(agentId, fileId)
        com.claudemanager.app.service.FileDownloadService.start(context, url, filename, uri)
        _uiState.update {
            it.copy(
                pendingFileAction = null,
                error = "Saving $filename in background"
            )
        }
    }

    /**
     * Stream the file to app cache while showing a progress dialog, then open
     * it with the appropriate viewer app via [openPendingDownload].
     *
     * Sends `Accept-Encoding: identity` because the backend's gzip compression
     * middleware strips Content-Length from the response when gzip is in play —
     * which would make the determinate progress bar impossible. Identity
     * encoding lets us read Content-Length and show real percentages.
     */
    fun startOpenDownload(fileId: Long, filename: String, context: Context) {
        _uiState.update {
            it.copy(
                pendingFileAction = null,
                // Start indeterminate; switch to determinate once we know the size.
                activeDownload = ActiveDownload(fileId, filename, -1f)
            )
        }
        viewModelScope.launch(kotlinx.coroutines.Dispatchers.IO) {
            try {
                val url = repository.getFileDownloadUrl(agentId, fileId)
                val client = com.claudemanager.app.data.api.ApiClient.getRetrofit().callFactory() as okhttp3.OkHttpClient
                val request = okhttp3.Request.Builder()
                    .url(url)
                    .header("Accept-Encoding", "identity")
                    .build()
                val response = client.newCall(request).execute()
                if (!response.isSuccessful) {
                    kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                        _uiState.update { it.copy(activeDownload = null, error = "Download failed: HTTP ${response.code}") }
                    }
                    return@launch
                }
                val body = response.body ?: run {
                    kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                        _uiState.update { it.copy(activeDownload = null, error = "Download failed: empty response") }
                    }
                    return@launch
                }
                val total = body.contentLength()
                val mimeType = response.header("Content-Type") ?: "application/octet-stream"
                val cacheDir = java.io.File(context.cacheDir, "downloads").also { it.mkdirs() }
                val file = java.io.File(cacheDir, filename)

                if (total > 0) {
                    kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                        _uiState.update { s ->
                            s.copy(activeDownload = s.activeDownload?.copy(progress = 0f))
                        }
                    }
                }

                var written = 0L
                var lastPostedPercent = -1
                file.outputStream().use { out ->
                    body.byteStream().use { input ->
                        val buf = ByteArray(8192)
                        while (true) {
                            val n = input.read(buf)
                            if (n == -1) break
                            out.write(buf, 0, n)
                            written += n
                            if (total > 0) {
                                val pct = ((written * 100L) / total).toInt()
                                if (pct != lastPostedPercent) {
                                    lastPostedPercent = pct
                                    val progress = pct / 100f
                                    kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                                        _uiState.update { s ->
                                            s.copy(activeDownload = s.activeDownload?.copy(progress = progress))
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                    _uiState.update {
                        it.copy(
                            activeDownload = null,
                            pendingDownload = PendingDownload(filename, mimeType, file)
                        )
                    }
                    openPendingDownload(context)
                }
            } catch (e: Exception) {
                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                    _uiState.update { it.copy(activeDownload = null, error = "Download failed: ${e.message}") }
                }
            }
        }
    }

    /** Open the pending download with an appropriate viewer app (ACTION_VIEW). */
    fun openPendingDownload(context: Context) {
        val pending = _uiState.value.pendingDownload ?: return
        _uiState.update { it.copy(pendingDownload = null) }
        try {
            val uri = androidx.core.content.FileProvider.getUriForFile(
                context, "${context.packageName}.fileprovider", pending.cachedFile
            )
            val intent = android.content.Intent(android.content.Intent.ACTION_VIEW).apply {
                setDataAndType(uri, pending.mimeType)
                addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            context.startActivity(intent)
        } catch (_: Exception) {
            _uiState.update { it.copy(error = "No app found to open ${pending.filename}") }
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

    /**
     * Listen for messages-acknowledged SSE events and update the relevant message
     * cards in-place so ack text appears without waiting for the next poll.
     */
    private fun listenForAcknowledgements() {
        viewModelScope.launch {
            try {
                com.claudemanager.app.service.AgentNotificationService.sseEvents?.collect { event ->
                    if (event is SSEEvent.MessagesAcknowledged && event.agentId == agentId) {
                        _uiState.update { state ->
                            state.copy(
                                messages = state.messages.map { msg ->
                                    if (event.ids.contains(msg.id)) {
                                        msg.copy(
                                            status = com.claudemanager.app.data.models.MessageStatus.ACKNOWLEDGED,
                                            ackContent = event.ackContent
                                        )
                                    } else {
                                        msg
                                    }
                                }
                            )
                        }
                    }
                }
            } catch (_: Exception) {
                // SSE not available; ack text will appear on next poll
            }
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

    // ── Cost breakdown ───────────────────────────────────────────────────

    /**
     * Load per-agent cost breakdown by task label.
     */
    fun loadCosts() {
        _uiState.update { it.copy(isLoadingCosts = true) }
        viewModelScope.launch {
            repository.getAgentCosts(agentId)
                .onSuccess { breakdown ->
                    _uiState.update {
                        it.copy(costBreakdown = breakdown, isLoadingCosts = false)
                    }
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(isLoadingCosts = false, error = e.message)
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

    /**
     * Poll for updates newer than what we already have.
     * Fetches the latest page and appends any items with id > maxUpdateId.
     */
    private fun refreshUpdates() {
        viewModelScope.launch {
            repository.getUpdatesPage(agentId, PAGE_SIZE).onSuccess { page ->
                val currentMax = _uiState.value.maxUpdateId
                val newItems = if (currentMax != null) {
                    page.data.filter { it.id > currentMax }.sortedBy { it.id }
                } else {
                    page.data.sortedBy { it.id }
                }
                if (newItems.isNotEmpty()) {
                    _uiState.update { s -> s.copy(
                        updates = s.updates + newItems,
                        maxUpdateId = newItems.last().id
                    ) }
                }
            }
        }
    }

    /**
     * Poll for messages newer than what we already have.
     * Fetches the latest page and appends any items with id > maxMessageId.
     */
    private fun refreshMessages() {
        viewModelScope.launch {
            repository.getMessagesPage(agentId, PAGE_SIZE).onSuccess { page ->
                val currentMax = _uiState.value.maxMessageId
                val newItems = if (currentMax != null) {
                    page.data.filter { it.id > currentMax }.sortedBy { it.id }
                } else {
                    page.data.sortedBy { it.id }
                }
                if (newItems.isNotEmpty()) {
                    _uiState.update { s -> s.copy(
                        messages = s.messages + newItems,
                        maxMessageId = newItems.last().id
                    ) }
                }
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

    override fun onCleared() {
        super.onCleared()
        // viewModelScope is cancelled by super; clear large lists so GC can reclaim them promptly.
        _uiState.update { AgentDetailUiState() }
    }
}
