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
data class ProjectListUiState(
    val projects: List<Project> = emptyList(),
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val error: String? = null,
    val showCreateDialog: Boolean = false
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

    /**
     * Create a new project.
     */
    fun createProject(name: String, description: String, folderPath: String) {
        viewModelScope.launch {
            repository.createProject(
                name = name,
                description = description,
                folderPath = folderPath
            ).onSuccess {
                _uiState.update { it.copy(showCreateDialog = false) }
                refresh()
            }.onFailure { e ->
                _uiState.update {
                    it.copy(error = e.message ?: "Failed to create project")
                }
            }
        }
    }
}
