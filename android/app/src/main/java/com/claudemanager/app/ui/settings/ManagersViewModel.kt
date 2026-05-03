package com.claudemanager.app.ui.settings

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.claudemanager.app.ClaudeManagerApp
import com.claudemanager.app.data.api.AgentApi
import com.claudemanager.app.data.api.ApiClient
import com.claudemanager.app.data.models.ServerManager
import com.claudemanager.app.service.AgentNotificationService
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.UUID

data class ManagersUiState(
    val managers: List<ServerManager> = emptyList(),
    val activeManagerId: String? = null,
    val showAddEditDialog: Boolean = false,
    val editingManager: ServerManager? = null,
    val dialogName: String = "",
    val dialogAddress: String = "",
    val dialogApiKey: String = "",
    val dialogIsLoading: Boolean = false,
    val dialogIsConnected: Boolean = false,
    val dialogResolvedUrl: String? = null,
    val dialogError: String? = null,
    val showDeleteConfirm: ServerManager? = null,
)

class ManagersViewModel(application: Application) : AndroidViewModel(application) {

    private val app = application as ClaudeManagerApp
    private val preferences = app.preferences

    private val _uiState = MutableStateFlow(ManagersUiState())
    val uiState: StateFlow<ManagersUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            preferences.managersFlow.collect { managers ->
                val activeId = preferences.getActiveManagerId()
                _uiState.update { it.copy(managers = managers, activeManagerId = activeId) }
            }
        }
    }

    fun openAddDialog() {
        _uiState.update {
            it.copy(
                showAddEditDialog = true,
                editingManager = null,
                dialogName = "",
                dialogAddress = "",
                dialogApiKey = "",
                dialogIsLoading = false,
                dialogIsConnected = false,
                dialogResolvedUrl = null,
                dialogError = null
            )
        }
    }

    fun openEditDialog(manager: ServerManager) {
        val address = manager.url
            .removePrefix("https://")
            .removePrefix("http://")
            .removeSuffix(":3001")
            .removeSuffix("/")
        _uiState.update {
            it.copy(
                showAddEditDialog = true,
                editingManager = manager,
                dialogName = manager.name,
                dialogAddress = address,
                dialogApiKey = manager.apiKey,
                dialogIsLoading = false,
                dialogIsConnected = true,
                dialogResolvedUrl = manager.url,
                dialogError = null
            )
        }
    }

    fun dismissDialog() {
        _uiState.update { it.copy(showAddEditDialog = false, editingManager = null) }
    }

    fun onDialogNameChanged(name: String) {
        _uiState.update { it.copy(dialogName = name) }
    }

    fun onDialogAddressChanged(address: String) {
        _uiState.update { it.copy(dialogAddress = address, dialogIsConnected = false, dialogResolvedUrl = null, dialogError = null) }
    }

    fun onDialogApiKeyChanged(key: String) {
        _uiState.update { it.copy(dialogApiKey = key, dialogIsConnected = false, dialogResolvedUrl = null) }
    }

    fun testConnection() {
        val address = _uiState.value.dialogAddress.trim()
        if (address.isBlank()) {
            _uiState.update { it.copy(dialogError = "Please enter a server address") }
            return
        }
        _uiState.update { it.copy(dialogIsLoading = true, dialogError = null, dialogIsConnected = false, dialogResolvedUrl = null) }

        viewModelScope.launch {
            val candidates = listOf(
                "http://$address",
                "http://$address:3001",
                "https://$address",
                "https://$address:3001"
            )
            for (url in candidates) {
                try {
                    val retrofit = ApiClient.createRetrofitForUrl(url)
                    val api = retrofit.create(AgentApi::class.java)
                    val response = api.checkHealth()
                    if (response.isSuccessful && response.body()?.status == "ok") {
                        _uiState.update { it.copy(dialogIsLoading = false, dialogIsConnected = true, dialogResolvedUrl = url, dialogError = null) }
                        return@launch
                    }
                } catch (_: Exception) { /* try next */ }
            }
            _uiState.update { it.copy(dialogIsLoading = false, dialogIsConnected = false, dialogError = "Could not connect. Check address and server.") }
        }
    }

    fun saveManager(onFirstManagerSaved: (() -> Unit)? = null) {
        val state = _uiState.value
        val url = state.dialogResolvedUrl ?: return
        val name = state.dialogName.trim().ifEmpty { url.removePrefix("https://").removePrefix("http://") }
        val key = state.dialogApiKey.trim()
        val isFirst = state.managers.isEmpty()

        val manager = state.editingManager?.copy(name = name, url = url, apiKey = key)
            ?: ServerManager(id = UUID.randomUUID().toString(), name = name, url = url, apiKey = key)

        viewModelScope.launch {
            preferences.addOrUpdateManager(manager)

            // If this is the first manager, set it as active and configure ApiClient
            if (isFirst || state.activeManagerId == null) {
                preferences.setActiveManagerId(manager.id)
                preferences.setServerUrl(manager.url)
                preferences.setApiKey(manager.apiKey)
                ApiClient.setBaseUrl(manager.url)
                if (manager.apiKey.isNotBlank()) ApiClient.setApiKey(manager.apiKey)
                AgentNotificationService.start(getApplication())
                onFirstManagerSaved?.invoke()
            } else {
                AgentNotificationService.reconfigure(getApplication())
            }
        }
        dismissDialog()
    }

    fun setActiveManager(manager: ServerManager) {
        viewModelScope.launch {
            preferences.setActiveManagerId(manager.id)
            preferences.setServerUrl(manager.url)
            preferences.setApiKey(manager.apiKey)
            ApiClient.setBaseUrl(manager.url)
            if (manager.apiKey.isNotBlank()) ApiClient.setApiKey(manager.apiKey) else ApiClient.setApiKey("")
            AgentNotificationService.reconfigure(getApplication())
            _uiState.update { it.copy(activeManagerId = manager.id) }
        }
    }

    fun confirmDelete(manager: ServerManager) {
        _uiState.update { it.copy(showDeleteConfirm = manager) }
    }

    fun dismissDeleteConfirm() {
        _uiState.update { it.copy(showDeleteConfirm = null) }
    }

    fun deleteManager(manager: ServerManager) {
        viewModelScope.launch {
            preferences.removeManager(manager.id)
            AgentNotificationService.reconfigure(getApplication())
        }
        _uiState.update { it.copy(showDeleteConfirm = null) }
    }
}
