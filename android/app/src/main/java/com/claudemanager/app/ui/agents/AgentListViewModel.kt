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
    val selectedFilter: AgentStatus? = null // null = All
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
                            filteredAgents = applyFilters(agents, it.searchQuery, it.selectedFilter),
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
                            filteredAgents = applyFilters(agents, it.searchQuery, it.selectedFilter),
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
                            filteredAgents = applyFilters(agents, it.searchQuery, it.selectedFilter),
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
                filteredAgents = applyFilters(it.agents, query, it.selectedFilter)
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
                filteredAgents = applyFilters(it.agents, it.searchQuery, status)
            )
        }
    }

    /**
     * Apply search query and status filter to the agent list.
     * Search matches against title, workspace, and latestSummary (case-insensitive).
     */
    private fun applyFilters(
        agents: List<Agent>,
        searchQuery: String,
        statusFilter: AgentStatus?
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
