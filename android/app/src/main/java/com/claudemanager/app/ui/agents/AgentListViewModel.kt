package com.claudemanager.app.ui.agents

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.claudemanager.app.ClaudeManagerApp
import com.claudemanager.app.data.models.Agent
import com.claudemanager.app.data.models.AgentStatus
import com.claudemanager.app.data.sse.SSEClient
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

enum class SortOption(val label: String) {
    ACTIVITY("Last Activity"),
    CREATED("Created"),
    UPDATES("Updates"),
    NAME("Name A-Z")
}

/**
 * UI state for the agent list screen.
 */
data class AgentListUiState(
    val agents: List<Agent> = emptyList(),
    val filteredAgents: List<Agent> = emptyList(),
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val error: String? = null,
    val connectionState: SSEClient.ConnectionState = SSEClient.ConnectionState.DISCONNECTED,
    val searchQuery: String = "",
    val selectedFilter: AgentStatus? = null, // null = All
    val sortOption: SortOption = SortOption.ACTIVITY,
    val isMultiSelectMode: Boolean = false,
    val selectedAgentIds: Set<String> = emptySet(),
    val isArchiving: Boolean = false
)

/**
 * ViewModel for the agent list screen.
 *
 * Loads agents from the repository and supports pull-to-refresh.
 * Connection state is observed from the service-level SSE client indirectly
 * by periodically refreshing.
 *
 * Supports client-side search and status filtering.
 */
class AgentListViewModel(application: Application) : AndroidViewModel(application) {

    private val app = application as ClaudeManagerApp
    private val repository = app.repository

    private val _uiState = MutableStateFlow(AgentListUiState())
    val uiState: StateFlow<AgentListUiState> = _uiState.asStateFlow()

    init {
        loadAgents()
        startPolling()
    }

    private fun startPolling() {
        viewModelScope.launch {
            while (isActive) {
                delay(5_000)
                silentRefresh()
            }
        }
    }

    private fun silentRefresh() {
        viewModelScope.launch {
            repository.getAgents()
                .onSuccess { agents ->
                    _uiState.update {
                        it.copy(
                            agents = agents,
                            filteredAgents = applyFilters(agents, it.searchQuery, it.selectedFilter, it.sortOption),
                            connectionState = SSEClient.ConnectionState.CONNECTED
                        )
                    }
                }
                .onFailure {
                    _uiState.update {
                        it.copy(connectionState = SSEClient.ConnectionState.DISCONNECTED)
                    }
                }
        }
    }

    /**
     * Load agents from the repository.
     */
    private fun loadAgents() {
        _uiState.update { it.copy(isLoading = true) }
        viewModelScope.launch {
            repository.getAgents()
                .onSuccess { agents ->
                    _uiState.update {
                        it.copy(
                            agents = agents,
                            filteredAgents = applyFilters(agents, it.searchQuery, it.selectedFilter, it.sortOption),
                            isLoading = false,
                            error = null,
                            connectionState = SSEClient.ConnectionState.CONNECTED
                        )
                    }
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            error = e.message ?: "Failed to load agents",
                            connectionState = SSEClient.ConnectionState.DISCONNECTED
                        )
                    }
                }
        }
    }

    /**
     * Pull-to-refresh: shows the refresh indicator.
     */
    fun refresh() {
        _uiState.update { it.copy(isRefreshing = true) }
        viewModelScope.launch {
            repository.getAgents()
                .onSuccess { agents ->
                    _uiState.update {
                        it.copy(
                            agents = agents,
                            filteredAgents = applyFilters(agents, it.searchQuery, it.selectedFilter, it.sortOption),
                            isRefreshing = false,
                            error = null,
                            connectionState = SSEClient.ConnectionState.CONNECTED
                        )
                    }
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(
                            isRefreshing = false,
                            error = e.message ?: "Refresh failed",
                            connectionState = SSEClient.ConnectionState.DISCONNECTED
                        )
                    }
                }
        }
    }

    /**
     * Update the search query and re-filter the agent list.
     */
    fun onSearchChanged(query: String) {
        _uiState.update {
            it.copy(
                searchQuery = query,
                filteredAgents = applyFilters(it.agents, query, it.selectedFilter, it.sortOption)
            )
        }
    }

    /**
     * Update the status filter and re-filter the agent list.
     * Pass null for "All" (no filter).
     */
    fun onFilterChanged(status: AgentStatus?) {
        _uiState.update {
            it.copy(
                selectedFilter = status,
                filteredAgents = applyFilters(it.agents, it.searchQuery, status, it.sortOption)
            )
        }
    }

    /**
     * Update the sort option and re-sort the agent list.
     */
    fun onSortChanged(sort: SortOption) {
        _uiState.update {
            it.copy(
                sortOption = sort,
                filteredAgents = applyFilters(it.agents, it.searchQuery, it.selectedFilter, sort)
            )
        }
    }

    /**
     * Apply search query, status filter, and sorting to the agent list.
     * Search matches against title, workspace, and latestSummary (case-insensitive).
     */
    private fun applyFilters(
        agents: List<Agent>,
        searchQuery: String,
        statusFilter: AgentStatus?,
        sortOption: SortOption = SortOption.ACTIVITY
    ): List<Agent> {
        var result = agents

        // Apply status filter
        if (statusFilter != null) {
            result = result.filter { it.status == statusFilter }
        }

        // Apply search query
        if (searchQuery.isNotBlank()) {
            val query = searchQuery.lowercase()
            result = result.filter { agent ->
                agent.title.lowercase().contains(query) ||
                        (agent.workspace?.lowercase()?.contains(query) == true) ||
                        (agent.latestSummary?.lowercase()?.contains(query) == true)
            }
        }

        // Apply sorting
        result = when (sortOption) {
            SortOption.ACTIVITY -> result.sortedByDescending { it.lastActivityAt ?: it.lastUpdateAt }
            SortOption.CREATED -> result.sortedByDescending { it.createdAt }
            SortOption.UPDATES -> result.sortedByDescending { it.updateCount }
            SortOption.NAME -> result.sortedBy { it.title.lowercase() }
        }

        return result
    }

    /**
     * Create a launch request to start a new agent in the given folder.
     */
    fun launchNewAgent(folderPath: String) {
        viewModelScope.launch {
            repository.createLaunchRequest(
                type = "new",
                folderPath = folderPath
            ).onSuccess {
                // Refresh the list to show the new agent once it appears
                refresh()
            }.onFailure { e ->
                _uiState.update { it.copy(error = e.message ?: "Failed to create launch request") }
            }
        }
    }

    // ── Multi-Select ────────────────────────────────────────────────────

    /**
     * Toggle selection of an agent. If not in multi-select mode, enters it.
     */
    fun toggleSelection(agentId: String) {
        _uiState.update { state ->
            val newSelected = if (agentId in state.selectedAgentIds) {
                state.selectedAgentIds - agentId
            } else {
                state.selectedAgentIds + agentId
            }
            // Exit multi-select if nothing is selected
            state.copy(
                isMultiSelectMode = newSelected.isNotEmpty(),
                selectedAgentIds = newSelected
            )
        }
    }

    /**
     * Clear selection and exit multi-select mode.
     */
    fun clearSelection() {
        _uiState.update {
            it.copy(isMultiSelectMode = false, selectedAgentIds = emptySet())
        }
    }

    /**
     * Archive (close) all selected agents, then refresh the list.
     */
    fun archiveSelected() {
        val ids = _uiState.value.selectedAgentIds.toList()
        if (ids.isEmpty()) return

        _uiState.update { it.copy(isArchiving = true) }
        viewModelScope.launch {
            ids.forEach { id ->
                repository.updateAgent(id, status = "archived")
            }
            // Clear selection and refresh
            _uiState.update {
                it.copy(
                    isMultiSelectMode = false,
                    selectedAgentIds = emptySet(),
                    isArchiving = false
                )
            }
            refresh()
        }
    }

    /**
     * Get the list of active (non-archived) agents, sorted by last update.
     */
    fun activeAgents(): List<Agent> =
        _uiState.value.agents.filter { it.status != AgentStatus.ARCHIVED }

    /**
     * Get the list of archived agents.
     */
    fun archivedAgents(): List<Agent> =
        _uiState.value.agents.filter { it.status == AgentStatus.ARCHIVED }
}
