package com.claudemanager.app.ui.projects

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.claudemanager.app.ClaudeManagerApp
import com.claudemanager.app.data.models.Agent
import com.claudemanager.app.data.models.Project
import com.claudemanager.app.data.models.ProjectFile
import com.claudemanager.app.data.models.ProjectUpdate
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.async
import kotlinx.coroutines.launch

/**
 * UI state for the project detail screen.
 */
data class ProjectDetailUiState(
    val project: Project? = null,
    val agents: List<Agent> = emptyList(),
    val updates: List<ProjectUpdate> = emptyList(),
    val files: List<ProjectFile> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null,
    val actionMessage: String? = null,
    val isDeleted: Boolean = false,
    val initialPrompt: String = "",
    val selectedAgentId: String? = null,
    val messageText: String = "",
    val isSendingMessage: Boolean = false,
    val agentMessages: List<com.claudemanager.app.data.models.AgentMessage> = emptyList(),
    val pendingDownload: com.claudemanager.app.ui.detail.PendingDownload? = null
)

/**
 * ViewModel for the project detail screen.
 * Fetches project, agents, and updates. Handles start/pause/complete/delete.
 */
class ProjectDetailViewModel(application: Application) : AndroidViewModel(application) {

    private val app = application as ClaudeManagerApp
    private val repository = app.repository

    private val _uiState = MutableStateFlow(ProjectDetailUiState())
    val uiState: StateFlow<ProjectDetailUiState> = _uiState.asStateFlow()

    private var projectId: String = ""

    /**
     * Set the project ID and load data. Called once from the composable.
     */
    fun init(projectId: String) {
        if (this.projectId == projectId) return
        this.projectId = projectId
        loadAll()
        startPolling()
    }

    private fun startPolling() {
        viewModelScope.launch {
            while (isActive) {
                delay(10_000)
                silentRefresh()
            }
        }
    }

    private fun silentRefresh() {
        viewModelScope.launch {
            val projectD = async { repository.getProject(projectId) }
            val agentsD  = async { repository.getProjectAgents(projectId) }
            val updatesD = async { repository.getProjectUpdates(projectId) }
            val filesD   = async { repository.getProjectFiles(projectId) }

            projectD.await().onSuccess { project ->
                _uiState.update { st ->
                    val sel = if (st.selectedAgentId == null && project.pmAgentId != null) {
                        project.pmAgentId
                    } else {
                        st.selectedAgentId
                    }
                    st.copy(project = project, selectedAgentId = sel)
                }
                val currentSel = _uiState.value.selectedAgentId
                if (currentSel != null && _uiState.value.agentMessages.isEmpty()) {
                    loadAgentMessages(currentSel)
                }
            }
            agentsD.await().onSuccess { agents -> _uiState.update { it.copy(agents = agents) } }
            updatesD.await().onSuccess { updates -> _uiState.update { it.copy(updates = updates) } }
            filesD.await().onSuccess { files -> _uiState.update { it.copy(files = files) } }

            // Refresh messages for selected agent (deduplicated — only if not already triggered above)
            _uiState.value.selectedAgentId?.let { agentId ->
                if (_uiState.value.agentMessages.isNotEmpty()) loadAgentMessages(agentId)
            }
        }
    }

    /**
     * Load project, agents, and updates.
     */
    private fun loadAll() {
        _uiState.update { it.copy(isLoading = true) }
        viewModelScope.launch {
            val projectD = async { repository.getProject(projectId) }
            val agentsD  = async { repository.getProjectAgents(projectId) }
            val updatesD = async { repository.getProjectUpdates(projectId) }
            val filesD   = async { repository.getProjectFiles(projectId) }

            projectD.await()
                .onSuccess { project -> _uiState.update { it.copy(project = project, error = null) } }
                .onFailure { e -> _uiState.update { it.copy(error = e.message ?: "Failed to load project") } }
            agentsD.await()
                .onSuccess { agents -> _uiState.update { it.copy(agents = agents) } }
            updatesD.await()
                .onSuccess { updates -> _uiState.update { it.copy(updates = updates) } }
            filesD.await()
                .onSuccess { files -> _uiState.update { it.copy(files = files) } }

            _uiState.update { it.copy(isLoading = false) }
        }
    }

    /**
     * Start the project.
     */
    fun updateInitialPrompt(text: String) {
        _uiState.update { it.copy(initialPrompt = text) }
    }

    fun startProject(initialPrompt: String = "") {
        viewModelScope.launch {
            repository.startProject(projectId, initialPrompt)
                .onSuccess {
                    _uiState.update { it.copy(actionMessage = "Project started") }
                    silentRefresh()
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(actionMessage = "Failed: ${e.message}")
                    }
                }
        }
    }

    /**
     * Pause the project.
     */
    fun pauseProject() {
        viewModelScope.launch {
            repository.pauseProject(projectId)
                .onSuccess {
                    _uiState.update { it.copy(actionMessage = "Project paused") }
                    silentRefresh()
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(actionMessage = "Failed: ${e.message}")
                    }
                }
        }
    }

    /**
     * Complete the project.
     */
    fun completeProject() {
        viewModelScope.launch {
            repository.completeProject(projectId)
                .onSuccess {
                    _uiState.update { it.copy(actionMessage = "Project completed") }
                    silentRefresh()
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(actionMessage = "Failed: ${e.message}")
                    }
                }
        }
    }

    /**
     * Delete the project.
     */
    fun deleteProject() {
        viewModelScope.launch {
            repository.deleteProject(projectId)
                .onSuccess {
                    _uiState.update { it.copy(isDeleted = true) }
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(actionMessage = "Failed: ${e.message}")
                    }
                }
        }
    }

    /**
     * Clear the action message after it has been shown.
     */
    fun clearActionMessage() {
        _uiState.update { it.copy(actionMessage = null) }
    }

    /**
     * Select an agent for messaging.
     */
    fun selectAgent(agentId: String?) {
        _uiState.update { it.copy(selectedAgentId = agentId, agentMessages = emptyList()) }
        if (agentId != null) loadAgentMessages(agentId)
    }

    /**
     * Update the message text input.
     */
    fun updateMessageText(text: String) {
        _uiState.update { it.copy(messageText = text) }
    }

    /**
     * Send a message to the selected agent.
     */
    fun sendMessage() {
        val agentId = _uiState.value.selectedAgentId ?: return
        val content = _uiState.value.messageText.trim()
        if (content.isEmpty()) return

        _uiState.update { it.copy(isSendingMessage = true) }
        viewModelScope.launch {
            repository.sendMessage(agentId, content)
                .onSuccess {
                    _uiState.update { it.copy(messageText = "", isSendingMessage = false) }
                    loadAgentMessages(agentId)
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(
                            isSendingMessage = false,
                            actionMessage = "Failed to send: ${e.message}"
                        )
                    }
                }
        }
    }

    /**
     * Download a project file via OkHttp and open it.
     */
    fun downloadFile(agentId: String, fileId: Long, filename: String, context: android.content.Context) {
        viewModelScope.launch(kotlinx.coroutines.Dispatchers.IO) {
            try {
                val url = repository.getFileDownloadUrl(agentId, fileId)
                val client = com.claudemanager.app.data.api.ApiClient.getRetrofit().callFactory() as okhttp3.OkHttpClient
                val request = okhttp3.Request.Builder().url(url).build()
                val response = client.newCall(request).execute()
                if (response.isSuccessful) {
                    val body = response.body ?: return@launch
                    val mimeType = response.header("Content-Type") ?: "application/octet-stream"
                    val cacheDir = java.io.File(context.cacheDir, "downloads")
                    cacheDir.mkdirs()
                    val file = java.io.File(cacheDir, filename)
                    file.outputStream().use { out -> body.byteStream().use { it.copyTo(out) } }
                    kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                        _uiState.update { it.copy(pendingDownload = com.claudemanager.app.ui.detail.PendingDownload(filename, mimeType, file)) }
                    }
                } else {
                    kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                        _uiState.update { it.copy(actionMessage = "Download failed: HTTP ${response.code}") }
                    }
                }
            } catch (e: Exception) {
                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                    _uiState.update { it.copy(actionMessage = "Download failed: ${e.message}") }
                }
            }
        }
    }

    fun openPendingDownload(context: android.content.Context) {
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
            _uiState.update { it.copy(actionMessage = "No app found to open ${pending.filename}") }
        }
    }

    fun savePendingDownloadToUri(uri: android.net.Uri, context: android.content.Context) {
        val pending = _uiState.value.pendingDownload ?: return
        _uiState.update { it.copy(pendingDownload = null) }
        viewModelScope.launch(kotlinx.coroutines.Dispatchers.IO) {
            try {
                context.contentResolver.openOutputStream(uri)?.use { out ->
                    pending.cachedFile.inputStream().use { it.copyTo(out) }
                }
                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                    _uiState.update { it.copy(actionMessage = "Saved ${pending.filename}") }
                }
            } catch (e: Exception) {
                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                    _uiState.update { it.copy(actionMessage = "Save failed: ${e.message}") }
                }
            }
        }
    }

    fun clearPendingDownload() {
        _uiState.update { it.copy(pendingDownload = null) }
    }

    /**
     * Load messages for the selected agent.
     */
    private fun loadAgentMessages(agentId: String) {
        viewModelScope.launch {
            repository.getMessages(agentId)
                .onSuccess { messages ->
                    // Only update if this is still the selected agent
                    if (_uiState.value.selectedAgentId == agentId) {
                        _uiState.update { it.copy(agentMessages = messages) }
                    }
                }
        }
    }
}
