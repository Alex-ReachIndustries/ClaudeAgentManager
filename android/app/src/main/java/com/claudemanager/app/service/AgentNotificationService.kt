package com.claudemanager.app.service

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import com.claudemanager.app.ClaudeManagerApp
import com.claudemanager.app.data.api.ApiClient
import com.claudemanager.app.data.models.AgentStatus
import com.claudemanager.app.data.models.ServerManager
import com.claudemanager.app.data.preferences.AppPreferences
import com.claudemanager.app.data.sse.SSEClient
import com.claudemanager.app.data.sse.SSEEvent
import com.claudemanager.app.notification.NotificationHelper
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import java.util.Calendar

/**
 * Foreground service that maintains SSE connections to ALL configured backends
 * and shows Android notifications when agents have updates on any of them.
 *
 * The primary (active) manager's SSE client is exposed via [sseEvents] for ViewModels.
 * Background managers maintain their own SSE clients for notifications only.
 */
class AgentNotificationService : Service() {

    companion object {
        private const val TAG = "AgentNotifService"

        const val ACTION_STOP = "com.claudemanager.app.ACTION_STOP_SERVICE"
        const val ACTION_RECONFIGURE = "com.claudemanager.app.ACTION_RECONFIGURE"

        @Volatile
        var isRunning: Boolean = false
            private set

        /**
         * Shared flow of SSE events from the active manager's SSE client.
         * ViewModels can collect this to receive real-time events (e.g. terminal output).
         * Null when the service is not running.
         */
        @Volatile
        var sseEvents: SharedFlow<SSEEvent>? = null
            private set

        fun start(context: Context) {
            val intent = Intent(context, AgentNotificationService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            val intent = Intent(context, AgentNotificationService::class.java)
            context.stopService(intent)
        }

        fun reconfigure(context: Context) {
            val intent = Intent(context, AgentNotificationService::class.java).apply {
                action = ACTION_RECONFIGURE
            }
            if (isRunning) {
                context.startService(intent)
            } else {
                start(context)
            }
        }
    }

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    // Primary client for the active manager — feeds sseEvents
    private var primaryClient: SSEClient? = null

    // Clients for background managers — notifications only
    private val backgroundClients = mutableMapOf<String, SSEClient>()

    // Track last-seen ack content per agent to distinguish ack vs status updates
    private val lastSeenAckContent = mutableMapOf<String, String?>()

    override fun onCreate() {
        super.onCreate()
        NotificationHelper.createNotificationChannels(this)
        isRunning = true
        Log.d(TAG, "Service created")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }

        val notification = NotificationHelper.showServiceNotification(this, "Connecting")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NotificationHelper.SERVICE_NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NotificationHelper.SERVICE_NOTIFICATION_ID, notification)
        }

        if (intent?.action == ACTION_RECONFIGURE) {
            serviceScope.launch { reconfigureConnections() }
        } else {
            serviceScope.launch { reconfigureConnections() }
        }

        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        isRunning = false
        sseEvents = null
        cancelAllClients()
        serviceScope.cancel()
        Log.d(TAG, "Service destroyed")
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun cancelAllClients() {
        primaryClient?.cancel()
        primaryClient = null
        backgroundClients.values.forEach { it.cancel() }
        backgroundClients.clear()
    }

    private suspend fun reconfigureConnections() {
        cancelAllClients()

        val preferences = AppPreferences(this)
        val managers = preferences.getManagers()

        if (managers.isEmpty()) {
            // Legacy single-server mode
            val serverUrl = preferences.getServerUrl()
            if (serverUrl.isBlank()) {
                Log.w(TAG, "No managers or server URL configured, stopping")
                stopSelf()
                return
            }
            val apiKey = preferences.getApiKey()
            ApiClient.setBaseUrl(serverUrl)
            if (apiKey.isNotBlank()) ApiClient.setApiKey(apiKey)
            startPrimaryClient(null, null)
            return
        }

        val activeId = preferences.getActiveManagerId()
        val active = if (activeId != null) managers.firstOrNull { it.id == activeId } else managers.firstOrNull()

        // Start primary client for active manager
        if (active != null) {
            ApiClient.setBaseUrl(active.url)
            if (active.apiKey.isNotBlank()) ApiClient.setApiKey(active.apiKey) else ApiClient.setApiKey("")
            startPrimaryClient(active.url, active.apiKey.ifBlank { null })
            updateServiceNotification("Connecting")
        }

        // Start background clients for other managers
        managers.filter { it.id != active?.id }.forEach { manager ->
            startBackgroundClient(manager)
        }
    }

    private fun startPrimaryClient(url: String?, apiKey: String?) {
        val client = SSEClient(overrideUrl = url, overrideApiKey = apiKey)
        primaryClient = client
        sseEvents = client.events

        serviceScope.launch {
            client.connectionState.collectLatest { state ->
                val label = when (state) {
                    SSEClient.ConnectionState.CONNECTED -> "Connected"
                    SSEClient.ConnectionState.CONNECTING -> "Connecting"
                    SSEClient.ConnectionState.DISCONNECTED -> "Disconnected"
                }
                updateServiceNotification(label)
            }
        }

        serviceScope.launch {
            client.events.collect { event -> handleSSEEvent(event) }
        }

        client.connect()
    }

    private fun startBackgroundClient(manager: ServerManager) {
        val client = SSEClient(
            overrideUrl = manager.url,
            overrideApiKey = manager.apiKey.ifBlank { null }
        )
        backgroundClients[manager.id] = client

        serviceScope.launch {
            client.events.collect { event -> handleSSEEvent(event) }
        }

        client.connect()
        Log.d(TAG, "Background SSE started for manager: ${manager.name} (${manager.url})")
    }

    private fun handleSSEEvent(event: SSEEvent) {
        when (event) {
            is SSEEvent.AgentUpdated -> {
                val agent = event.agent
                if (agent.status == AgentStatus.ARCHIVED) return

                val previousAck = lastSeenAckContent[agent.id]
                val currentAck = agent.latestAckContent
                lastSeenAckContent[agent.id] = currentAck

                val isAckUpdate = currentAck != null && currentAck != previousAck
                val notifText = if (isAckUpdate) currentAck else agent.latestSummary
                if (notifText.isNullOrBlank()) return

                val app = application as? ClaudeManagerApp
                if (app?.isAppInForeground == true) return

                serviceScope.launch {
                    val preferences = AppPreferences(this@AgentNotificationService)
                    if (preferences.getQuietHoursEnabled()) {
                        val now = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
                        val start = preferences.getQuietHoursStart()
                        val end = preferences.getQuietHoursEnd()
                        val inQuiet = if (start < end) now in start until end else now >= start || now < end
                        if (inQuiet) return@launch
                    }
                    NotificationHelper.showAgentNotification(this@AgentNotificationService, agent, notifText)
                }
            }
            is SSEEvent.AgentDeleted -> NotificationHelper.cancelAgentNotification(this, event.agentId)
            else -> Unit
        }
    }

    private fun updateServiceNotification(connectionState: String) {
        val notification = NotificationHelper.showServiceNotification(this, connectionState)
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
        nm.notify(NotificationHelper.SERVICE_NOTIFICATION_ID, notification)
    }
}
