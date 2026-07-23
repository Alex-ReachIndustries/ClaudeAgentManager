package com.claudemanager.app.ui.knowledge

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.claudemanager.app.ClaudeManagerApp
import com.claudemanager.app.data.models.PendingProposal
import com.claudemanager.app.data.models.ProposalEdits
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * UI state for the Pending Knowledge review queue.
 */
data class PendingKnowledgeUiState(
    val proposals: List<PendingProposal> = emptyList(),
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val error: String? = null,
    val processingId: Long? = null,
    val snackbarMessage: String? = null
)

/**
 * ViewModel for the Pending Knowledge screen. Lists proposals awaiting review
 * and applies accept / update / reject decisions. Polls every 15s and can be
 * refreshed on resume.
 */
class PendingKnowledgeViewModel(application: Application) : AndroidViewModel(application) {

    private val app = application as ClaudeManagerApp
    private val repository = app.repository

    private val _uiState = MutableStateFlow(PendingKnowledgeUiState())
    val uiState: StateFlow<PendingKnowledgeUiState> = _uiState.asStateFlow()

    init {
        load()
        startPolling()
    }

    private fun startPolling() {
        viewModelScope.launch {
            while (isActive) {
                delay(15_000)
                if (_uiState.value.processingId == null) silentRefresh()
            }
        }
    }

    private fun silentRefresh() {
        viewModelScope.launch {
            repository.getPendingKnowledge()
                .onSuccess { list -> _uiState.update { it.copy(proposals = list) } }
        }
    }

    fun load() {
        _uiState.update { it.copy(isLoading = true) }
        viewModelScope.launch {
            repository.getPendingKnowledge()
                .onSuccess { list ->
                    _uiState.update { it.copy(proposals = list, isLoading = false, error = null) }
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(isLoading = false, error = e.message ?: "Failed to load queue")
                    }
                }
        }
    }

    /** Pull-to-refresh / resume refresh. */
    fun refresh() {
        _uiState.update { it.copy(isRefreshing = true) }
        viewModelScope.launch {
            repository.getPendingKnowledge()
                .onSuccess { list ->
                    _uiState.update { it.copy(proposals = list, isRefreshing = false, error = null) }
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(isRefreshing = false, error = e.message ?: "Refresh failed")
                    }
                }
        }
    }

    fun accept(id: Long, note: String? = null) = decide(id, "accept", null, note, "Accepted")

    fun reject(id: Long, note: String? = null) = decide(id, "reject", null, note, "Rejected")

    fun update(id: Long, edits: ProposalEdits, note: String? = null) =
        decide(id, "update", edits, note, "Updated & accepted")

    private fun decide(
        id: Long,
        decision: String,
        edits: ProposalEdits?,
        note: String?,
        successLabel: String
    ) {
        _uiState.update { it.copy(processingId = id) }
        viewModelScope.launch {
            repository.decidePending(
                id = id,
                decision = decision,
                edits = edits,
                note = note?.ifBlank { null },
                decidedBy = "mobile"
            ).onSuccess {
                // Optimistically drop the decided item, then re-sync.
                _uiState.update {
                    it.copy(
                        proposals = it.proposals.filterNot { p -> p.id == id },
                        processingId = null,
                        snackbarMessage = successLabel
                    )
                }
                silentRefresh()
            }.onFailure { e ->
                _uiState.update {
                    it.copy(
                        processingId = null,
                        snackbarMessage = e.message ?: "Decision failed"
                    )
                }
            }
        }
    }

    fun clearSnackbar() {
        _uiState.update { it.copy(snackbarMessage = null) }
    }
}
