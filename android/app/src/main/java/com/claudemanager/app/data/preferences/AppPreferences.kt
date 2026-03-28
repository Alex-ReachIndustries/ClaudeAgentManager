package com.claudemanager.app.data.preferences

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

/**
 * DataStore extension property on Context. Creates a single DataStore instance
 * for the entire application, stored in the default location.
 */
private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(
    name = "claude_manager_preferences"
)

/**
 * Wrapper around Jetpack DataStore for ClaudeManager app settings.
 *
 * Stores:
 * - Server URL: The base URL of the ClaudeManager backend (e.g., "http://100.x.y.z:3001")
 * - Notifications enabled: Whether the user wants local notifications for agent updates
 *
 * All values are exposed as [Flow]s for reactive Compose UI and also have
 * suspend getter/setter pairs for imperative access.
 */
class AppPreferences(private val context: Context) {

    companion object {
        private val KEY_SERVER_URL = stringPreferencesKey("server_url")
        private val KEY_API_KEY = stringPreferencesKey("api_key")
        private val KEY_NOTIFICATIONS_ENABLED = booleanPreferencesKey("notifications_enabled")
    }

    // ── Server URL ───────────────────────────────────────────────────────

    /**
     * Flow of the current server URL. Emits "" if not yet configured.
     */
    val serverUrlFlow: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[KEY_SERVER_URL] ?: ""
    }

    /**
     * Flow indicating whether the app has been configured with a server URL.
     */
    val isConfiguredFlow: Flow<Boolean> = serverUrlFlow.map { it.isNotBlank() }

    /**
     * Get the current server URL. Returns empty string if not configured.
     */
    suspend fun getServerUrl(): String {
        return serverUrlFlow.first()
    }

    /**
     * Set the server URL. Pass an empty string to clear the configuration.
     * Trailing slashes are automatically removed.
     */
    suspend fun setServerUrl(url: String) {
        context.dataStore.edit { prefs ->
            prefs[KEY_SERVER_URL] = url.trimEnd('/')
        }
    }

    // ── API Key ────────────────────────────────────────────────────────

    val apiKeyFlow: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[KEY_API_KEY] ?: ""
    }

    suspend fun getApiKey(): String {
        return apiKeyFlow.first()
    }

    suspend fun setApiKey(key: String) {
        context.dataStore.edit { prefs ->
            prefs[KEY_API_KEY] = key.trim()
        }
    }

    // ── Notifications ────────────────────────────────────────────────────

    /**
     * Flow of the notifications enabled preference. Defaults to true.
     */
    val notificationsEnabledFlow: Flow<Boolean> = context.dataStore.data.map { prefs ->
        prefs[KEY_NOTIFICATIONS_ENABLED] ?: true
    }

    /**
     * Get whether notifications are enabled.
     */
    suspend fun getNotificationsEnabled(): Boolean {
        return notificationsEnabledFlow.first()
    }

    /**
     * Set whether notifications are enabled.
     */
    suspend fun setNotificationsEnabled(enabled: Boolean) {
        context.dataStore.edit { prefs ->
            prefs[KEY_NOTIFICATIONS_ENABLED] = enabled
        }
    }

    // ── Convenience ──────────────────────────────────────────────────────

    /**
     * Clear all stored preferences. Useful for a "reset" or "disconnect" action.
     */
    suspend fun clear() {
        context.dataStore.edit { prefs ->
            prefs.clear()
        }
    }
}
