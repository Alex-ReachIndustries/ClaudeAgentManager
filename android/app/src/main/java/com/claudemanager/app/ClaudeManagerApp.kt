package com.claudemanager.app

import android.app.Application
import android.util.Log
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.claudemanager.app.data.api.ApiClient
import com.claudemanager.app.data.preferences.AppPreferences
import com.claudemanager.app.data.repository.AgentRepository
import com.claudemanager.app.notification.NotificationHelper
import com.claudemanager.app.service.AgentNotificationService
// import com.claudemanager.app.widget.AgentWidgetWorker  // TODO: fix Glance API compatibility
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/**
 * Application class for ClaudeManager.
 *
 * Responsibilities:
 * - Creates notification channels on startup
 * - Initializes AppPreferences and ApiClient with the stored server URL
 * - Tracks foreground/background state via ProcessLifecycleOwner for notification suppression
 * - Starts the AgentNotificationService if a server URL is already configured
 * - Provides shared instances of [AppPreferences] and [AgentRepository]
 */
class ClaudeManagerApp : Application(), DefaultLifecycleObserver {

    companion object {
        private const val TAG = "ClaudeManagerApp"
    }

    lateinit var preferences: AppPreferences
        private set

    /** Lazy repository -- only usable after ApiClient has a base URL configured. */
    val repository: AgentRepository by lazy { AgentRepository() }

    /**
     * True when any Activity in this app is in the started (visible) state.
     * Used by [AgentNotificationService] to suppress notifications while the
     * user is actively viewing the dashboard.
     */
    @Volatile
    var isAppInForeground: Boolean = false
        private set

    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    override fun onCreate() {
        super<Application>.onCreate()

        // Create notification channels early so they are available immediately
        NotificationHelper.createNotificationChannels(this)

        // Initialize preferences
        preferences = AppPreferences(this)

        // Register lifecycle observer for foreground detection
        ProcessLifecycleOwner.get().lifecycle.addObserver(this)

        // Restore server URL and start background service if configured
        appScope.launch {
            val serverUrl = preferences.getServerUrl()
            val apiKey = preferences.getApiKey()
            if (!serverUrl.isNullOrBlank()) {
                Log.d(TAG, "Restoring server URL: $serverUrl")
                ApiClient.setBaseUrl(serverUrl)
                if (apiKey.isNotBlank()) {
                    ApiClient.setApiKey(apiKey)
                }

                // Start the notification service for SSE events
                if (preferences.getNotificationsEnabled()) {
                    AgentNotificationService.start(this@ClaudeManagerApp)
                }

                // Schedule periodic widget updates
                // AgentWidgetWorker.schedulePeriodicUpdate(this@ClaudeManagerApp)  // TODO: fix Glance API
            } else {
                Log.d(TAG, "No server URL configured, skipping service start")
            }
        }
    }

    // ---- DefaultLifecycleObserver (app-level foreground/background) ----

    override fun onStart(owner: LifecycleOwner) {
        isAppInForeground = true
        Log.d(TAG, "App entered foreground")
    }

    override fun onStop(owner: LifecycleOwner) {
        isAppInForeground = false
        Log.d(TAG, "App entered background")
    }
}
