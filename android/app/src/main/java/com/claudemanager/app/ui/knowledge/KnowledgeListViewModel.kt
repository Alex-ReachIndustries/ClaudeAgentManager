package com.claudemanager.app.ui.knowledge

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.claudemanager.app.ClaudeManagerApp
import com.claudemanager.app.data.models.KbStats
import com.claudemanager.app.data.models.KnowledgeEntry
import com.claudemanager.app.data.models.KnowledgeResult
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * UI state for the Knowledge Hub browse/search screen.
 */
data class KnowledgeListUiState(
    val searchQuery: String = "",
    val typeFilter: String = "all",          // "all" | "knowledge" | "profile"
    val results: List<KnowledgeResult> = emptyList(),
    val embeddingsReady: Boolean = false,
    val stats: KbStats? = null,
    val isSearching: Boolean = false,
    val hasSearched: Boolean = false,
    val error: String? = null,
    // Detail dialog
    val selectedEntry: KnowledgeEntry? = null,
    val loadingDetail: Boolean = false,
    // Propose dialog
    val showProposeDialog: Boolean = false,
    val isProposing: Boolean = false,
    // Snackbar
    val snackbarMessage: String? = null
)

/**
 * ViewModel for the Knowledge Hub list/search screen. Debounces search input,
 * loads a stats header, and polls stats so the pending-queue badge stays fresh.
 */
class KnowledgeListViewModel(application: Application) : AndroidViewModel(application) {

    private val app = application as ClaudeManagerApp
    private val repository = app.repository

    private val _uiState = MutableStateFlow(KnowledgeListUiState())
    val uiState: StateFlow<KnowledgeListUiState> = _uiState.asStateFlow()

    private var searchJob: Job? = null

    init {
        loadStats()
        startStatsPolling()
    }

    private fun startStatsPolling() {
        viewModelScope.launch {
            while (isActive) {
                delay(15_000)
                loadStats()
            }
        }
    }

    /** Refresh the stats header (also refreshes the pending-queue badge). */
    fun loadStats() {
        viewModelScope.launch {
            repository.getKbStats()
                .onSuccess { stats -> _uiState.update { it.copy(stats = stats) } }
        }
    }

    fun setSearchQuery(query: String) {
        _uiState.update { it.copy(searchQuery = query) }
        scheduleSearch()
    }

    fun setTypeFilter(type: String) {
        _uiState.update { it.copy(typeFilter = type) }
        if (_uiState.value.searchQuery.isNotBlank()) search()
    }

    private fun scheduleSearch() {
        searchJob?.cancel()
        val query = _uiState.value.searchQuery
        if (query.isBlank()) {
            _uiState.update { it.copy(results = emptyList(), hasSearched = false, error = null) }
            return
        }
        searchJob = viewModelScope.launch {
            delay(400)
            search()
        }
    }

    /** Execute the search immediately for the current query + type filter. */
    fun search() {
        val query = _uiState.value.searchQuery.trim()
        if (query.isBlank()) return
        _uiState.update { it.copy(isSearching = true, error = null) }
        viewModelScope.launch {
            repository.searchKnowledge(query, _uiState.value.typeFilter)
                .onSuccess { resp ->
                    _uiState.update {
                        it.copy(
                            results = resp.results,
                            embeddingsReady = resp.embeddingsReady,
                            isSearching = false,
                            hasSearched = true,
                            error = null
                        )
                    }
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(
                            isSearching = false,
                            hasSearched = true,
                            error = e.message ?: "Search failed"
                        )
                    }
                }
        }
    }

    /** Pull-to-refresh: re-run the search (if any) and reload stats. */
    fun refresh() {
        loadStats()
        if (_uiState.value.searchQuery.isNotBlank()) search()
    }

    /** Open the detail dialog for a knowledge entry by id. */
    fun openEntry(id: Long) {
        _uiState.update { it.copy(loadingDetail = true, selectedEntry = null) }
        viewModelScope.launch {
            repository.getKnowledgeEntry(id)
                .onSuccess { entry ->
                    _uiState.update { it.copy(selectedEntry = entry, loadingDetail = false) }
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(
                            loadingDetail = false,
                            snackbarMessage = e.message ?: "Failed to load entry"
                        )
                    }
                }
        }
    }

    fun closeEntry() {
        _uiState.update { it.copy(selectedEntry = null, loadingDetail = false) }
    }

    fun showProposeDialog(show: Boolean) {
        _uiState.update { it.copy(showProposeDialog = show) }
    }

    /** Propose a new knowledge entry. */
    fun proposeNew(
        title: String,
        body: String,
        category: String?,
        tags: List<String>,
        systems: List<String>,
        source: String?,
        rationale: String?
    ) {
        _uiState.update { it.copy(isProposing = true) }
        viewModelScope.launch {
            repository.proposeKnowledge(
                kind = "new",
                title = title,
                body = body,
                category = category?.ifBlank { null },
                tags = tags.ifEmpty { null },
                systems = systems.ifEmpty { null },
                source = source?.ifBlank { null },
                agent = "mobile",
                rationale = rationale?.ifBlank { null }
            ).onSuccess { resp ->
                val conflictNote = if (resp.conflicts.isNotEmpty()) {
                    " (${resp.conflicts.size} possible conflict${if (resp.conflicts.size > 1) "s" else ""})"
                } else ""
                _uiState.update {
                    it.copy(
                        isProposing = false,
                        showProposeDialog = false,
                        snackbarMessage = "Proposed for review$conflictNote"
                    )
                }
                loadStats()
            }.onFailure { e ->
                _uiState.update {
                    it.copy(
                        isProposing = false,
                        snackbarMessage = e.message ?: "Failed to propose"
                    )
                }
            }
        }
    }

    fun clearSnackbar() {
        _uiState.update { it.copy(snackbarMessage = null) }
    }
}
