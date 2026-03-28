package com.claudemanager.app.service

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import com.claudemanager.app.ClaudeManagerApp
import com.claudemanager.app.data.models.AgentStatus
import com.claudemanager.app.data.preferences.AppPreferences
import com.claudemanager.app.data.sse.SSEClient
import com.claudemanager.app.data.sse.SSEEvent
import com.claudemanager.app.notification.NotificationHelper
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

/**
 * Foreground service that maintains a persistent SSE connection to the backend
 * and shows Android notifications when agents have updates.
 *
 * The service uses FOREGROUND_SERVICE_DATA_SYNC type and returns START_STICKY
 * so Android restarts it if killed. It suppresses notifications when the app
 * is in the foreground (the user can see updates in the Compose UI directly).
 *
 * Notifications use MessagingStyle with RemoteInput, which provides inline
 * reply on both the phone and Wear OS (Pixel Watch 2).
 */
class AgentNotificationService : Service() {

    companion object {
        private const val TAG = "AgentNotifService"

        const val ACTION_STOP = "com.claudemanager.app.ACTION_STOP_SERVICE"

        @Volatile
        var isRunning: Boolean = false
            private set

        /**
         * Starts the foreground service. On Android O+ this uses startForegroundService().
         */
        fun start(context: Context) {
            val intent = Intent(context, AgentNotificationService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        /**
         * Stops the foreground service gracefully.
         */
        fun stop(context: Context) {
            val intent = Intent(context, AgentNotificationService::class.java)
            context.stopService(intent)
        }
    }

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var sseClient: SSEClient? = null

    override fun onCreate() {
        super.onCreate()
        NotificationHelper.createNotificationChannels(this)
        isRunning = true
        Log.d(TAG, "Service created")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Handle "Disconnect" action from the service notification
        if (intent?.action == ACTION_STOP) {
            Log.d(TAG, "Stop action received")
            stopSelf()
            return START_NOT_STICKY
        }

        // Start as foreground with the service status notification
        val notification = NotificationHelper.showServiceNotification(this, "Connecting")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NotificationHelper.SERVICE_NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            )
        } else {
            startForeground(NotificationHelper.SERVICE_NOTIFICATION_ID, notification)
        }

        // Connect SSE and start collecting events
        connectSSE()

        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        isRunning = false
        sseClient?.cancel()
        sseClient = null
        serviceScope.cancel()
        Log.d(TAG, "Service destroyed")
    }

    override fun onBind(intent: Intent?): IBinder? = null

    /**
     * Establishes the SSE connection and begins collecting events.
     *
     * On each SSE event, the service evaluates whether a notification should be
     * shown (suppressed when app is in foreground or agent is archived).
     */
    private fun connectSSE() {
        serviceScope.launch {
            val preferences = AppPreferences(this@AgentNotificationService)
            val serverUrl = preferences.getServerUrl()

            if (serverUrl.isBlank()) {
                Log.w(TAG, "No server URL configured, stopping service")
                stopSelf()
                return@launch
            }

            val client = SSEClient()
            sseClient = client

            // Observe connection state and update the foreground notification
            launch {
                client.connectionState.collectLatest { state ->
                    val stateLabel = when (state) {
                        SSEClient.ConnectionState.CONNECTED -> "Connected"
                        SSEClient.ConnectionState.CONNECTING -> "Connecting"
                        SSEClient.ConnectionState.DISCONNECTED -> "Disconnected"
                    }
                    Log.d(TAG, "SSE connection state: $stateLabel")
                    updateServiceNotification(stateLabel)
                }
            }

            // Observe SSE events and show notifications
            launch {
                client.events.collect { event ->
                    handleSSEEvent(event)
                }
            }

            // Initiate connection
            client.connect()
        }
    }

    /**
     * Processes an incoming SSE event and shows a notification if appropriate.
     */
    private fun handleSSEEvent(event: SSEEvent) {
        when (event) {
            is SSEEvent.AgentUpdated -> {
                val agent = event.agent

                // Skip archived agents
                if (agent.status == AgentStatus.ARCHIVED) return

                // Skip if no meaningful summary to show
                val summary = agent.latestSummary
                if (summary.isNullOrBlank()) return

                // Suppress notifications when the app is in the foreground
                val app = application as? ClaudeManagerApp
                if (app?.isAppInForeground == true) return

                NotificationHelper.showAgentNotification(
                    this,
                    agent,
                    summary
                )
            }

            is SSEEvent.AgentDeleted -> {
                NotificationHelper.cancelAgentNotification(this, event.agentId)
            }

            is SSEEvent.MessageQueued -> {
                // Message queued confirmation -- no notification needed since
                // the user just sent it. The agent will update when it processes
                // the message.
                Log.d(TAG, "Message queued for agent ${event.agentId}")
            }

            is SSEEvent.LaunchRequestCreated,
            is SSEEvent.LaunchRequestUpdated -> {
                // No notification needed for launch request events
            }
        }
    }

    /**
     * Updates the persistent foreground service notification with the current
     * connection state.
     */
    private fun updateServiceNotification(connectionState: String) {
        val notification = NotificationHelper.showServiceNotification(this, connectionState)
        val notificationManager =
            getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
        notificationManager.notify(NotificationHelper.SERVICE_NOTIFICATION_ID, notification)
    }
}
