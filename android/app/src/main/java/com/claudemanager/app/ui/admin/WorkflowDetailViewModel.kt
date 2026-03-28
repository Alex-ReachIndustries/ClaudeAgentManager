package com.claudemanager.app.ui.admin

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.claudemanager.app.ClaudeManagerApp
import com.claudemanager.app.data.models.Workflow
import com.claudemanager.app.data.models.WorkflowStep
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * UI state for the workflow detail screen.
 */
data class WorkflowDetailUiState(
    val workflow: Workflow? = null,
    val parsedSteps: List<WorkflowStep> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null,
    val snackbarMessage: String? = null
)

/**
 * ViewModel for displaying and managing a single workflow.
 */
class WorkflowDetailViewModel(
    application: Application,
    private val workflowId: String
) : AndroidViewModel(application) {

    private val app = application as ClaudeManagerApp
    private val repository = app.repository
    private val gson = Gson()

    private val _uiState = MutableStateFlow(WorkflowDetailUiState())
    val uiState: StateFlow<WorkflowDetailUiState> = _uiState.asStateFlow()

    init {
        loadWorkflow()
        startPolling()
    }

    private fun loadWorkflow() {
        _uiState.update { it.copy(isLoading = true) }
        viewModelScope.launch {
            repository.getWorkflow(workflowId)
                .onSuccess { workflow ->
                    _uiState.update {
                        it.copy(
                            workflow = workflow,
                            parsedSteps = parseSteps(workflow.steps),
                            isLoading = false,
                            error = null
                        )
                    }
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            error = e.message ?: "Failed to load workflow"
                        )
                    }
                }
        }
    }

    private fun startPolling() {
        viewModelScope.launch {
            while (isActive) {
                delay(5_000)
                repository.getWorkflow(workflowId)
                    .onSuccess { workflow ->
                        _uiState.update {
                            it.copy(
                                workflow = workflow,
                                parsedSteps = parseSteps(workflow.steps)
                            )
                        }
                    }
            }
        }
    }

    /**
     * Parse the JSON string of steps into a typed list.
     */
    private fun parseSteps(stepsJson: String): List<WorkflowStep> {
        return try {
            val type = object : TypeToken<List<WorkflowStep>>() {}.type
            gson.fromJson(stepsJson, type)
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun startWorkflow() {
        viewModelScope.launch {
            repository.startWorkflow(workflowId)
                .onSuccess {
                    _uiState.update { it.copy(snackbarMessage = "Workflow started") }
                    loadWorkflow()
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(snackbarMessage = "Failed: ${e.message}")
                    }
                }
        }
    }

    fun pauseWorkflow() {
        viewModelScope.launch {
            repository.pauseWorkflow(workflowId)
                .onSuccess {
                    _uiState.update { it.copy(snackbarMessage = "Workflow paused") }
                    loadWorkflow()
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(snackbarMessage = "Failed: ${e.message}")
                    }
                }
        }
    }

    fun deleteWorkflow(onDeleted: () -> Unit) {
        viewModelScope.launch {
            repository.deleteWorkflow(workflowId)
                .onSuccess { onDeleted() }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(snackbarMessage = "Failed: ${e.message}")
                    }
                }
        }
    }

    fun clearSnackbar() {
        _uiState.update { it.copy(snackbarMessage = null) }
    }
}

/**
 * Factory for [WorkflowDetailViewModel] that injects the workflow ID.
 */
class WorkflowDetailViewModelFactory(
    private val application: Application,
    private val workflowId: String
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        return WorkflowDetailViewModel(application, workflowId) as T
    }
}
