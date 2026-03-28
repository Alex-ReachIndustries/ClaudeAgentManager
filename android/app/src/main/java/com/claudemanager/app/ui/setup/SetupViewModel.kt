package com.claudemanager.app.ui.setup

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.claudemanager.app.ClaudeManagerApp
import com.claudemanager.app.data.api.AgentApi
import com.claudemanager.app.data.api.ApiClient
import com.claudemanager.app.service.AgentNotificationService
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * UI state for the setup/connection screen.
 */
data class SetupUiState(
    val serverAddress: String = "",
    val apiKey: String = "",
    val isLoading: Boolean = false,
    val error: String? = null,
    val isConnected: Boolean = false,
    val resolvedUrl: String? = null
)

/**
 * ViewModel for the server setup screen.
 *
 * Handles testing connectivity to the ClaudeManager backend by trying multiple
 * URL combinations (http/https, with/without port) and saving the working URL
 * to preferences.
 */
class SetupViewModel(application: Application) : AndroidViewModel(application) {

    private val app = application as ClaudeManagerApp
    private val preferences = app.preferences

    private val _uiState = MutableStateFlow(SetupUiState())
    val uiState: StateFlow<SetupUiState> = _uiState.asStateFlow()

    init {
        // Pre-fill the address field if a URL is already saved
        viewModelScope.launch {
            val savedUrl = preferences.getServerUrl()
            val savedKey = preferences.getApiKey()
            if (savedUrl.isNotBlank()) {
                // Extract the address portion from a full URL
                val address = savedUrl
                    .removePrefix("https://")
                    .removePrefix("http://")
                    .removeSuffix(":3001")
                    .removeSuffix("/")
                _uiState.update { it.copy(serverAddress = address, apiKey = savedKey, isConnected = true, resolvedUrl = savedUrl) }
            } else if (savedKey.isNotBlank()) {
                _uiState.update { it.copy(apiKey = savedKey) }
            }
        }
    }

    /**
     * Update the server address text field.
     */
    fun onAddressChanged(address: String) {
        _uiState.update { it.copy(serverAddress = address, error = null, isConnected = false, resolvedUrl = null) }
    }

    fun onApiKeyChanged(key: String) {
        _uiState.update { it.copy(apiKey = key) }
    }

    /**
     * Test connectivity to the server by trying multiple URL combinations.
     * Tries in order:
     * 1. http://{address}/api/health
     * 2. http://{address}:3001/api/health
     * 3. https://{address}/api/health
     * 4. https://{address}:3001/api/health
     *
     * Uses the first URL that returns a successful health response.
     */
    fun testConnection() {
        val address = _uiState.value.serverAddress.trim()
        if (address.isBlank()) {
            _uiState.update { it.copy(error = "Please enter a server address") }
            return
        }

        _uiState.update { it.copy(isLoading = true, error = null, isConnected = false, resolvedUrl = null) }

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
                        _uiState.update {
                            it.copy(
                                isLoading = false,
                                isConnected = true,
                                resolvedUrl = url,
                                error = null
                            )
                        }
                        return@launch
                    }
                } catch (_: Exception) {
                    // Try next candidate
                }
            }

            _uiState.update {
                it.copy(
                    isLoading = false,
                    isConnected = false,
                    error = "Could not connect to server. Check the address and make sure the server is running."
                )
            }
        }
    }

    /**
     * Save the resolved URL to preferences, update the API client, and start
     * the notification service.
     */
    fun saveAndConnect(onComplete: () -> Unit) {
        val url = _uiState.value.resolvedUrl ?: return
        val key = _uiState.value.apiKey.trim()

        viewModelScope.launch {
            preferences.setServerUrl(url)
            preferences.setApiKey(key)
            ApiClient.setBaseUrl(url)
            if (key.isNotBlank()) {
                ApiClient.setApiKey(key)
            }
            AgentNotificationService.start(getApplication())
            onComplete()
        }
    }
}
