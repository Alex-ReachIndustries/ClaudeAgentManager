package com.claudemanager.app.ui.admin

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.claudemanager.app.ClaudeManagerApp
import com.claudemanager.app.data.models.RetentionRunResult
import com.claudemanager.app.data.models.RetentionStatus
import com.claudemanager.app.data.models.WebhookEntry
import com.claudemanager.app.data.models.Workflow
import com.claudemanager.app.data.models.WorkflowStep
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Tabs available on the admin screen.
 */
enum class AdminTab {
    WEBHOOKS,
    RETENTION,
    WORKFLOWS
}

/**
 * UI state for the admin screen.
 */
data class AdminUiState(
    val selectedTab: AdminTab = AdminTab.WEBHOOKS,

    // Webhooks
    val webhooks: List<WebhookEntry> = emptyList(),
    val isLoadingWebhooks: Boolean = false,
    val webhookError: String? = null,

    // Retention
    val retentionStatus: RetentionStatus? = null,
    val isLoadingRetention: Boolean = false,
    val retentionError: String? = null,
    val isRunningRetention: Boolean = false,
    val lastRunResult: RetentionRunResult? = null,

    // Retention edit fields
    val editArchiveDays: String = "",
    val editUpdateDays: String = "",
    val editMessageDays: String = "",
    val editEnabled: Boolean = false,
    val editDryRun: Boolean = false,

    // Workflows
    val workflows: List<Workflow> = emptyList(),
    val isLoadingWorkflows: Boolean = false,
    val workflowError: String? = null,

    // General
    val snackbarMessage: String? = null
)

/**
 * ViewModel for the admin screen managing webhooks, retention, and workflows.
 * Follows the existing pattern of AndroidViewModel + StateFlow + Repository.
 */
class AdminViewModel(application: Application) : AndroidViewModel(application) {

    private val app = application as ClaudeManagerApp
    private val repository = app.repository

    private val _uiState = MutableStateFlow(AdminUiState())
    val uiState: StateFlow<AdminUiState> = _uiState.asStateFlow()

    init {
        loadWebhooks()
    }

    // ── Tab Navigation ──────────────────────────────────────────────────

    /**
     * Change the selected admin tab and load data for it if not yet loaded.
     */
    fun selectTab(tab: AdminTab) {
        _uiState.update { it.copy(selectedTab = tab) }
        when (tab) {
            AdminTab.WEBHOOKS -> if (_uiState.value.webhooks.isEmpty()) loadWebhooks()
            AdminTab.RETENTION -> if (_uiState.value.retentionStatus == null) loadRetention()
            AdminTab.WORKFLOWS -> if (_uiState.value.workflows.isEmpty()) loadWorkflows()
        }
    }

    fun clearSnackbar() {
        _uiState.update { it.copy(snackbarMessage = null) }
    }

    // ── Webhooks ────────────────────────────────────────────────────────

    fun loadWebhooks() {
        _uiState.update { it.copy(isLoadingWebhooks = true, webhookError = null) }
        viewModelScope.launch {
            repository.getWebhooks()
                .onSuccess { webhooks ->
                    _uiState.update {
                        it.copy(webhooks = webhooks, isLoadingWebhooks = false)
                    }
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(
                            isLoadingWebhooks = false,
                            webhookError = e.message ?: "Failed to load webhooks"
                        )
                    }
                }
        }
    }

    fun createWebhook(url: String, events: List<String>) {
        viewModelScope.launch {
            repository.createWebhook(url, events)
                .onSuccess {
                    _uiState.update { it.copy(snackbarMessage = "Webhook created") }
                    loadWebhooks()
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(snackbarMessage = "Failed: ${e.message}")
                    }
                }
        }
    }

    fun updateWebhook(
        id: Int,
        url: String? = null,
        events: List<String>? = null,
        active: Boolean? = null
    ) {
        viewModelScope.launch {
            repository.updateWebhook(id, url, events, active)
                .onSuccess {
                    _uiState.update { it.copy(snackbarMessage = "Webhook updated") }
                    loadWebhooks()
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(snackbarMessage = "Failed: ${e.message}")
                    }
                }
        }
    }

    fun deleteWebhook(id: Int) {
        viewModelScope.launch {
            repository.deleteWebhook(id)
                .onSuccess {
                    _uiState.update { it.copy(snackbarMessage = "Webhook deleted") }
                    loadWebhooks()
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(snackbarMessage = "Failed: ${e.message}")
                    }
                }
        }
    }

    fun testWebhook(id: Int) {
        viewModelScope.launch {
            repository.testWebhook(id)
                .onSuccess {
                    _uiState.update { it.copy(snackbarMessage = "Test sent successfully") }
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(snackbarMessage = "Test failed: ${e.message}")
                    }
                }
        }
    }

    // ── Retention ────────────────────────────────────────────────────────

    fun loadRetention() {
        _uiState.update { it.copy(isLoadingRetention = true, retentionError = null) }
        viewModelScope.launch {
            repository.getRetentionStatus()
                .onSuccess { status ->
                    _uiState.update {
                        it.copy(
                            retentionStatus = status,
                            isLoadingRetention = false,
                            editArchiveDays = status.settings.archiveDays.toString(),
                            editUpdateDays = status.settings.updateDays.toString(),
                            editMessageDays = status.settings.messageDays.toString(),
                            editEnabled = status.settings.enabled,
                            editDryRun = status.settings.dryRun
                        )
                    }
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(
                            isLoadingRetention = false,
                            retentionError = e.message ?: "Failed to load retention status"
                        )
                    }
                }
        }
    }

    fun onArchiveDaysChanged(value: String) {
        _uiState.update { it.copy(editArchiveDays = value) }
    }

    fun onUpdateDaysChanged(value: String) {
        _uiState.update { it.copy(editUpdateDays = value) }
    }

    fun onMessageDaysChanged(value: String) {
        _uiState.update { it.copy(editMessageDays = value) }
    }

    fun onEnabledChanged(value: Boolean) {
        _uiState.update { it.copy(editEnabled = value) }
    }

    fun onDryRunChanged(value: Boolean) {
        _uiState.update { it.copy(editDryRun = value) }
    }

    fun saveRetentionSettings() {
        val state = _uiState.value
        viewModelScope.launch {
            repository.updateRetentionSettings(
                archiveDays = state.editArchiveDays.toIntOrNull(),
                updateDays = state.editUpdateDays.toIntOrNull(),
                messageDays = state.editMessageDays.toIntOrNull(),
                enabled = state.editEnabled,
                dryRun = state.editDryRun
            )
                .onSuccess {
                    _uiState.update { it.copy(snackbarMessage = "Settings saved") }
                    loadRetention()
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(snackbarMessage = "Failed: ${e.message}")
                    }
                }
        }
    }

    fun runRetention() {
        _uiState.update { it.copy(isRunningRetention = true) }
        viewModelScope.launch {
            repository.runRetention()
                .onSuccess { result ->
                    _uiState.update {
                        it.copy(
                            isRunningRetention = false,
                            lastRunResult = result,
                            snackbarMessage = if (result.dryRun) "Dry run completed" else "Retention run completed"
                        )
                    }
                    loadRetention()
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(
                            isRunningRetention = false,
                            snackbarMessage = "Run failed: ${e.message}"
                        )
                    }
                }
        }
    }

    // ── Workflows ────────────────────────────────────────────────────────

    fun loadWorkflows() {
        _uiState.update { it.copy(isLoadingWorkflows = true, workflowError = null) }
        viewModelScope.launch {
            repository.getWorkflows()
                .onSuccess { workflows ->
                    _uiState.update {
                        it.copy(workflows = workflows, isLoadingWorkflows = false)
                    }
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(
                            isLoadingWorkflows = false,
                            workflowError = e.message ?: "Failed to load workflows"
                        )
                    }
                }
        }
    }

    fun createWorkflow(name: String, steps: List<WorkflowStep>) {
        viewModelScope.launch {
            repository.createWorkflow(name, steps)
                .onSuccess {
                    _uiState.update { it.copy(snackbarMessage = "Workflow created") }
                    loadWorkflows()
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(snackbarMessage = "Failed: ${e.message}")
                    }
                }
        }
    }

    fun startWorkflow(id: String) {
        viewModelScope.launch {
            repository.startWorkflow(id)
                .onSuccess {
                    _uiState.update { it.copy(snackbarMessage = "Workflow started") }
                    loadWorkflows()
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(snackbarMessage = "Failed: ${e.message}")
                    }
                }
        }
    }

    fun pauseWorkflow(id: String) {
        viewModelScope.launch {
            repository.pauseWorkflow(id)
                .onSuccess {
                    _uiState.update { it.copy(snackbarMessage = "Workflow paused") }
                    loadWorkflows()
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(snackbarMessage = "Failed: ${e.message}")
                    }
                }
        }
    }

    fun deleteWorkflow(id: String) {
        viewModelScope.launch {
            repository.deleteWorkflow(id)
                .onSuccess {
                    _uiState.update { it.copy(snackbarMessage = "Workflow deleted") }
                    loadWorkflows()
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(snackbarMessage = "Failed: ${e.message}")
                    }
                }
        }
    }
}
