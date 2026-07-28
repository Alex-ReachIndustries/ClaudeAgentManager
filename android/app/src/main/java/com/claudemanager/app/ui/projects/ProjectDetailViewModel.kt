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
    val pendingDownload: com.claudemanager.app.ui.detail.PendingDownload? = null,
    val pendingFileAction: com.claudemanager.app.ui.detail.PendingFileAction? = null,
    // Project files span multiple agents, so unlike AgentDetailViewModel (which has a single
    // fixed agentId) we need to remember which agent the pending file action belongs to.
    val pendingFileActionAgentId: String? = null,
    val activeDownload: com.claudemanager.app.ui.detail.ActiveDownload? = null
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
     * Show the Open/Save action dialog for a tapped file. Called immediately on tap,
     * before any network activity — mirrors AgentDetailViewModel.showFileActionDialog.
     */
    fun showFileActionDialog(agentId: String, fileId: Long, filename: String) {
        _uiState.update {
            it.copy(
                pendingFileAction = com.claudemanager.app.ui.detail.PendingFileAction(fileId, filename),
                pendingFileActionAgentId = agentId
            )
        }
    }

    /** Dismiss the file action dialog without taking any action. */
    fun dismissFileActionDialog() {
        _uiState.update { it.copy(pendingFileAction = null, pendingFileActionAgentId = null) }
    }

    /**
     * Hand a save-to-SAF download off to [com.claudemanager.app.service.FileDownloadService] so
     * it survives this screen closing or the app backgrounding — same mechanism as
     * AgentDetailViewModel.downloadFileToUri. Takes explicit params (rather than reading
     * pendingFileAction from state) because the SAF picker is async and the action dialog is
     * dismissed before it returns, same as AgentDetailScreen's saveToDeviceLauncher flow.
     */
    fun downloadFileToUri(agentId: String, fileId: Long, filename: String, uri: android.net.Uri, context: android.content.Context) {
        val url = repository.getFileDownloadUrl(agentId, fileId)
        com.claudemanager.app.service.FileDownloadService.start(context, url, filename, uri)
        _uiState.update { it.copy(actionMessage = "Saving $filename in background") }
    }

    /**
     * Stream the file to app cache while showing a progress dialog, then open it with the
     * appropriate viewer app — same mechanism as AgentDetailViewModel.startOpenDownload.
     */
    fun startOpenDownload(context: android.content.Context) {
        val action = _uiState.value.pendingFileAction ?: return
        val agentId = _uiState.value.pendingFileActionAgentId ?: return
        _uiState.update {
            it.copy(
                pendingFileAction = null,
                pendingFileActionAgentId = null,
                activeDownload = com.claudemanager.app.ui.detail.ActiveDownload(action.fileId, action.filename, -1f)
            )
        }
        viewModelScope.launch(kotlinx.coroutines.Dispatchers.IO) {
            try {
                val url = repository.getFileDownloadUrl(agentId, action.fileId)
                val client = com.claudemanager.app.data.api.ApiClient.getRetrofit().callFactory() as okhttp3.OkHttpClient
                val request = okhttp3.Request.Builder()
                    .url(url)
                    .header("Accept-Encoding", "identity")
                    .build()
                val response = client.newCall(request).execute()
                if (!response.isSuccessful) {
                    kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                        _uiState.update { it.copy(activeDownload = null, actionMessage = "Download failed: HTTP ${response.code}") }
                    }
                    return@launch
                }
                val body = response.body ?: run {
                    kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                        _uiState.update { it.copy(activeDownload = null, actionMessage = "Download failed: empty response") }
                    }
                    return@launch
                }
                val total = body.contentLength()
                val mimeType = response.header("Content-Type") ?: "application/octet-stream"
                val cacheDir = java.io.File(context.cacheDir, "downloads").also { it.mkdirs() }
                val file = java.io.File(cacheDir, action.filename)

                if (total > 0) {
                    kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                        _uiState.update { s -> s.copy(activeDownload = s.activeDownload?.copy(progress = 0f)) }
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
                                        _uiState.update { s -> s.copy(activeDownload = s.activeDownload?.copy(progress = progress)) }
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
                            pendingDownload = com.claudemanager.app.ui.detail.PendingDownload(action.filename, mimeType, file)
                        )
                    }
                    openPendingDownload(context)
                }
            } catch (e: Exception) {
                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                    _uiState.update { it.copy(activeDownload = null, actionMessage = "Download failed: ${e.message}") }
                }
            }
        }
    }

    /** Open the pending download with an appropriate viewer app (ACTION_VIEW). */
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
