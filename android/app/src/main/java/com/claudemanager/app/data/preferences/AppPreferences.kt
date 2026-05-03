package com.claudemanager.app.data.preferences

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.claudemanager.app.data.models.ServerManager
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
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
        private val KEY_QUIET_HOURS_ENABLED = booleanPreferencesKey("quiet_hours_enabled")
        private val KEY_QUIET_HOURS_START = intPreferencesKey("quiet_hours_start")
        private val KEY_QUIET_HOURS_END = intPreferencesKey("quiet_hours_end")
        private val KEY_MANAGERS_JSON = stringPreferencesKey("managers_json")
        private val KEY_ACTIVE_MANAGER_ID = stringPreferencesKey("active_manager_id")

        private val gson = Gson()
        private val managersListType = object : TypeToken<List<ServerManager>>() {}.type
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

    // ── Quiet Hours ──────────────────────────────────────────────────────

    /**
     * Flow of the quiet hours enabled preference. Defaults to true.
     * When enabled, notifications are suppressed between [quietHoursStartFlow] and [quietHoursEndFlow].
     */
    val quietHoursEnabledFlow: Flow<Boolean> = context.dataStore.data.map { prefs ->
        prefs[KEY_QUIET_HOURS_ENABLED] ?: false
    }

    /**
     * Flow of the quiet hours start hour (0-23). Defaults to 0 (midnight).
     */
    val quietHoursStartFlow: Flow<Int> = context.dataStore.data.map { prefs ->
        prefs[KEY_QUIET_HOURS_START] ?: 0
    }

    /**
     * Flow of the quiet hours end hour (0-23). Defaults to 8 (8am).
     */
    val quietHoursEndFlow: Flow<Int> = context.dataStore.data.map { prefs ->
        prefs[KEY_QUIET_HOURS_END] ?: 8
    }

    /**
     * Get whether quiet hours are enabled.
     */
    suspend fun getQuietHoursEnabled(): Boolean {
        return quietHoursEnabledFlow.first()
    }

    /**
     * Set whether quiet hours are enabled.
     */
    suspend fun setQuietHoursEnabled(enabled: Boolean) {
        context.dataStore.edit { prefs ->
            prefs[KEY_QUIET_HOURS_ENABLED] = enabled
        }
    }

    /**
     * Get the quiet hours start hour.
     */
    suspend fun getQuietHoursStart(): Int {
        return quietHoursStartFlow.first()
    }

    /**
     * Set the quiet hours start hour (0-23).
     */
    suspend fun setQuietHoursStart(hour: Int) {
        context.dataStore.edit { prefs ->
            prefs[KEY_QUIET_HOURS_START] = hour.coerceIn(0, 23)
        }
    }

    /**
     * Get the quiet hours end hour.
     */
    suspend fun getQuietHoursEnd(): Int {
        return quietHoursEndFlow.first()
    }

    /**
     * Set the quiet hours end hour (0-23).
     */
    suspend fun setQuietHoursEnd(hour: Int) {
        context.dataStore.edit { prefs ->
            prefs[KEY_QUIET_HOURS_END] = hour.coerceIn(0, 23)
        }
    }

    // ── Server Managers ──────────────────────────────────────────────────

    val managersFlow: Flow<List<ServerManager>> = context.dataStore.data.map { prefs ->
        val json = prefs[KEY_MANAGERS_JSON]
        if (!json.isNullOrBlank()) {
            try { gson.fromJson(json, managersListType) ?: emptyList() } catch (_: Exception) { emptyList() }
        } else emptyList()
    }

    val activeManagerIdFlow: Flow<String?> = context.dataStore.data.map { prefs ->
        prefs[KEY_ACTIVE_MANAGER_ID]
    }

    suspend fun getManagers(): List<ServerManager> = managersFlow.first()

    suspend fun getActiveManagerId(): String? = activeManagerIdFlow.first()

    suspend fun setActiveManagerId(id: String) {
        context.dataStore.edit { prefs -> prefs[KEY_ACTIVE_MANAGER_ID] = id }
    }

    suspend fun saveManagers(managers: List<ServerManager>) {
        context.dataStore.edit { prefs -> prefs[KEY_MANAGERS_JSON] = gson.toJson(managers) }
    }

    suspend fun addOrUpdateManager(manager: ServerManager) {
        val current = getManagers().toMutableList()
        val idx = current.indexOfFirst { it.id == manager.id }
        if (idx >= 0) current[idx] = manager else current.add(manager)
        saveManagers(current)
    }

    suspend fun removeManager(id: String) {
        val current = getManagers().filter { it.id != id }
        saveManagers(current)
        if (getActiveManagerId() == id) {
            val first = current.firstOrNull()
            if (first != null) {
                setActiveManagerId(first.id)
                setServerUrl(first.url)
                setApiKey(first.apiKey)
            }
        }
    }

    /**
     * One-time migration: if no managers list exists but a legacy server_url is set,
     * create the default "My Machine" manager from it.
     */
    suspend fun migrateToManagersIfNeeded() {
        val existing = getManagers()
        if (existing.isNotEmpty()) return
        val legacyUrl = getServerUrl()
        if (legacyUrl.isBlank()) return
        val legacyKey = getApiKey()
        val defaultManager = ServerManager(id = "default", name = "My Machine", url = legacyUrl, apiKey = legacyKey)
        addOrUpdateManager(defaultManager)
        setActiveManagerId(defaultManager.id)
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
