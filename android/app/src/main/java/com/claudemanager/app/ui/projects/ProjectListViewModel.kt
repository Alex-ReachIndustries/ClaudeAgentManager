package com.claudemanager.app.ui.projects

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.claudemanager.app.ClaudeManagerApp
import com.claudemanager.app.data.models.Project
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * UI state for the project list screen.
 */
enum class ProjectSortOption(val label: String) {
    NEWEST("Newest"),
    OLDEST("Oldest"),
    NAME("Name"),
    STATUS("Status")
}

data class ProjectListUiState(
    val projects: List<Project> = emptyList(),
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val error: String? = null,
    val showCreateDialog: Boolean = false,
    val statusFilter: String? = null,
    val sortOption: ProjectSortOption = ProjectSortOption.NEWEST,
    val searchQuery: String = "",
    val navigateToProjectId: String? = null
)

/**
 * ViewModel for the project list screen.
 * Fetches projects, handles creation, and auto-refreshes every 10 seconds.
 */
class ProjectListViewModel(application: Application) : AndroidViewModel(application) {

    private val app = application as ClaudeManagerApp
    private val repository = app.repository

    private val _uiState = MutableStateFlow(ProjectListUiState())
    val uiState: StateFlow<ProjectListUiState> = _uiState.asStateFlow()

    init {
        loadProjects()
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
            repository.getProjects()
                .onSuccess { projects ->
                    _uiState.update { it.copy(projects = projects) }
                }
        }
    }

    /**
     * Initial load with loading indicator.
     */
    private fun loadProjects() {
        _uiState.update { it.copy(isLoading = true) }
        viewModelScope.launch {
            repository.getProjects()
                .onSuccess { projects ->
                    _uiState.update {
                        it.copy(
                            projects = projects,
                            isLoading = false,
                            error = null
                        )
                    }
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            error = e.message ?: "Failed to load projects"
                        )
                    }
                }
        }
    }

    /**
     * Pull-to-refresh.
     */
    fun refresh() {
        _uiState.update { it.copy(isRefreshing = true) }
        viewModelScope.launch {
            repository.getProjects()
                .onSuccess { projects ->
                    _uiState.update {
                        it.copy(
                            projects = projects,
                            isRefreshing = false,
                            error = null
                        )
                    }
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(
                            isRefreshing = false,
                            error = e.message ?: "Refresh failed"
                        )
                    }
                }
        }
    }

    /**
     * Show or hide the create project dialog.
     */
    fun showCreateDialog(show: Boolean) {
        _uiState.update { it.copy(showCreateDialog = show) }
    }

    fun setStatusFilter(status: String?) {
        _uiState.update { it.copy(statusFilter = status) }
    }

    fun setSortOption(option: ProjectSortOption) {
        _uiState.update { it.copy(sortOption = option) }
    }

    fun setSearchQuery(query: String) {
        _uiState.update { it.copy(searchQuery = query) }
    }

    /**
     * Get filtered and sorted projects.
     */
    fun getFilteredProjects(): List<Project> {
        val state = _uiState.value
        var list = state.projects

        // Filter by status
        state.statusFilter?.let { filter ->
            list = list.filter { it.status.equals(filter, ignoreCase = true) }
        }

        // Filter by search
        if (state.searchQuery.isNotBlank()) {
            val q = state.searchQuery.lowercase()
            list = list.filter {
                it.name.lowercase().contains(q) ||
                it.description.lowercase().contains(q)
            }
        }

        // Sort
        list = when (state.sortOption) {
            ProjectSortOption.NEWEST -> list.sortedByDescending { it.createdAt ?: "" }
            ProjectSortOption.OLDEST -> list.sortedBy { it.createdAt ?: "" }
            ProjectSortOption.NAME -> list.sortedBy { it.name.lowercase() }
            ProjectSortOption.STATUS -> list.sortedBy { it.status }
        }

        return list
    }

    /**
     * Create a new project.
     */
    fun createProject(name: String, task: String, folderPath: String) {
        viewModelScope.launch {
            repository.createProject(
                name = name,
                description = task,
                folderPath = folderPath
            ).onSuccess { project ->
                // Auto-start with crafted PM prompt
                val pmPrompt = "Project: $name\n\nTask: $task\n\nAnalyse this task, break it into phases, and begin execution by spawning the appropriate sub-agents."
                repository.startProject(project.id, pmPrompt)
                _uiState.update { it.copy(showCreateDialog = false, navigateToProjectId = project.id) }
            }.onFailure { e ->
                _uiState.update {
                    it.copy(error = e.message ?: "Failed to create project")
                }
            }
        }
    }

    fun clearNavigation() {
        _uiState.update { it.copy(navigateToProjectId = null) }
    }
}
