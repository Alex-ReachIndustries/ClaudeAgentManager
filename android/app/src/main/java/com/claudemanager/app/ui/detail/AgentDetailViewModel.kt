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
    INFO
}

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
    val isRelaying: Boolean = false
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

    init {
        loadAll()
        markRead()
        startPolling()
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

    /**
     * Send a message to the agent.
     * On success, clears the draft. On failure, keeps the draft so the user can retry.
     */
    fun sendMessage(content: String) {
        if (content.isBlank()) return

        _uiState.update { it.copy(isSendingMessage = true) }
        viewModelScope.launch {
            repository.sendMessage(agentId, content)
                .onSuccess {
                    _uiState.update { it.copy(draftMessage = "") }
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
     */
    fun uploadFile(uri: Uri, context: Context) {
        _uiState.update { it.copy(isUploading = true) }
        viewModelScope.launch {
            repository.uploadFile(agentId, uri, context)
                .onSuccess {
                    refreshFiles()
                }
                .onFailure { e ->
                    _uiState.update { it.copy(error = e.message ?: "Failed to upload file") }
                }
            _uiState.update { it.copy(isUploading = false) }
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
     * Get the PDF export URL for this agent.
     */
    fun getPdfExportUrl(): String {
        return "${com.claudemanager.app.data.api.ApiClient.getBaseUrl()}/api/agents/$agentId/export/pdf"
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
