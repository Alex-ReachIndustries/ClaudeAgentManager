package com.claudemanager.app.ui.files

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.claudemanager.app.ClaudeManagerApp
import com.claudemanager.app.data.models.FileInfo
import com.claudemanager.app.ui.detail.ActiveDownload
import com.claudemanager.app.ui.detail.PendingDownload
import com.claudemanager.app.ui.detail.PendingFileAction
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class FilesUiState(
    val query: String = "",
    val files: List<FileInfo> = emptyList(),
    val nextCursor: String? = null,
    val hasMore: Boolean = false,
    val isLoading: Boolean = false,
    val isLoadingMore: Boolean = false,
    val error: String? = null,
    val actionMessage: String? = null,
    // Open / Save flow — same shape as ProjectDetailUiState so the dialogs match.
    val pendingFileAction: PendingFileAction? = null,
    val pendingFileActionAgentId: String? = null,
    val activeDownload: ActiveDownload? = null,
    val pendingDownload: PendingDownload? = null
)

/**
 * Files tab: every file from every agent, newest first, with a search box that matches part of
 * the filename, part of the file id, or the start of the agent id (GET /api/files).
 */
class FilesViewModel(application: Application) : AndroidViewModel(application) {

    private val repository = (application as ClaudeManagerApp).repository

    private val _uiState = MutableStateFlow(FilesUiState())
    val uiState: StateFlow<FilesUiState> = _uiState.asStateFlow()

    private var searchJob: Job? = null

    init {
        refresh()
    }

    /** Update the search text; the query runs after a short pause in typing. */
    fun onQueryChange(query: String) {
        _uiState.update { it.copy(query = query) }
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            delay(300)
            load(reset = true)
        }
    }

    fun refresh() {
        searchJob?.cancel()
        searchJob = viewModelScope.launch { load(reset = true) }
    }

    fun loadMore() {
        val s = _uiState.value
        if (!s.hasMore || s.isLoading || s.isLoadingMore) return
        viewModelScope.launch { load(reset = false) }
    }

    private suspend fun load(reset: Boolean) {
        val query = _uiState.value.query
        val cursor = if (reset) null else _uiState.value.nextCursor
        _uiState.update { if (reset) it.copy(isLoading = true, error = null) else it.copy(isLoadingMore = true) }
        repository.searchAllFiles(query, cursor)
            .onSuccess { page ->
                // Drop a stale response if the query changed while it was in flight.
                if (_uiState.value.query != query) return@onSuccess
                _uiState.update {
                    it.copy(
                        files = if (reset) page.data else it.files + page.data,
                        nextCursor = page.nextCursor,
                        hasMore = page.hasMore,
                        isLoading = false,
                        isLoadingMore = false
                    )
                }
            }
            .onFailure { e ->
                _uiState.update { it.copy(isLoading = false, isLoadingMore = false, error = e.message ?: "Failed to load files") }
            }
    }

    fun clearActionMessage() {
        _uiState.update { it.copy(actionMessage = null) }
    }

    /** Show the Open / Save dialog for a tapped file, before any network activity. */
    fun showFileActionDialog(agentId: String, fileId: Long, filename: String) {
        _uiState.update { it.copy(pendingFileAction = PendingFileAction(fileId, filename), pendingFileActionAgentId = agentId) }
    }

    fun dismissFileActionDialog() {
        _uiState.update { it.copy(pendingFileAction = null, pendingFileActionAgentId = null) }
    }

    /** Save to a user-chosen location in the background, via FileDownloadService. */
    fun downloadFileToUri(agentId: String, fileId: Long, filename: String, uri: android.net.Uri, context: android.content.Context) {
        val url = repository.getFileDownloadUrl(agentId, fileId)
        com.claudemanager.app.service.FileDownloadService.start(context, url, filename, uri)
        _uiState.update { it.copy(actionMessage = "Saving $filename in background") }
    }

    /**
     * Stream the file to app cache while showing a progress dialog, then open it with a viewer
     * app — same mechanism as ProjectDetailViewModel.startOpenDownload.
     */
    fun startOpenDownload(context: android.content.Context) {
        val action = _uiState.value.pendingFileAction ?: return
        val agentId = _uiState.value.pendingFileActionAgentId ?: return
        _uiState.update {
            it.copy(pendingFileAction = null, pendingFileActionAgentId = null, activeDownload = ActiveDownload(action.fileId, action.filename, -1f))
        }
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val url = repository.getFileDownloadUrl(agentId, action.fileId)
                val client = com.claudemanager.app.data.api.ApiClient.getRetrofit().callFactory() as okhttp3.OkHttpClient
                val request = okhttp3.Request.Builder().url(url).header("Accept-Encoding", "identity").build()
                val response = client.newCall(request).execute()
                if (!response.isSuccessful) {
                    withContext(Dispatchers.Main) { _uiState.update { it.copy(activeDownload = null, actionMessage = "Download failed: HTTP ${response.code}") } }
                    return@launch
                }
                val body = response.body ?: run {
                    withContext(Dispatchers.Main) { _uiState.update { it.copy(activeDownload = null, actionMessage = "Download failed: empty response") } }
                    return@launch
                }
                val total = body.contentLength()
                val mimeType = response.header("Content-Type") ?: "application/octet-stream"
                val cacheDir = java.io.File(context.cacheDir, "downloads").also { it.mkdirs() }
                val file = java.io.File(cacheDir, action.filename)
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
                                    withContext(Dispatchers.Main) {
                                        _uiState.update { s -> s.copy(activeDownload = s.activeDownload?.copy(progress = pct / 100f)) }
                                    }
                                }
                            }
                        }
                    }
                }
                withContext(Dispatchers.Main) {
                    _uiState.update { it.copy(activeDownload = null, pendingDownload = PendingDownload(action.filename, mimeType, file)) }
                    openPendingDownload(context)
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) { _uiState.update { it.copy(activeDownload = null, actionMessage = "Download failed: ${e.message}") } }
            }
        }
    }

    /** Open the downloaded file with an appropriate viewer app (ACTION_VIEW). */
    private fun openPendingDownload(context: android.content.Context) {
        val pending = _uiState.value.pendingDownload ?: return
        _uiState.update { it.copy(pendingDownload = null) }
        try {
            val uri = androidx.core.content.FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", pending.cachedFile)
            val intent = android.content.Intent(android.content.Intent.ACTION_VIEW).apply {
                setDataAndType(uri, pending.mimeType)
                addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            context.startActivity(intent)
        } catch (_: Exception) {
            _uiState.update { it.copy(actionMessage = "No app found to open ${pending.filename}") }
        }
    }
}
