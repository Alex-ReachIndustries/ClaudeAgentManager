package com.claudemanager.app.widget

import android.content.Context
import android.util.Log
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.state.updateAppWidgetState
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.claudemanager.app.data.api.ApiClient
import com.claudemanager.app.data.models.AgentStatus
import com.claudemanager.app.data.preferences.AppPreferences
import com.claudemanager.app.data.repository.AgentRepository
import java.util.concurrent.TimeUnit

/**
 * WorkManager [CoroutineWorker] that fetches agents from the API and updates
 * all placed [AgentWidget] instances with the latest data.
 *
 * Runs on two triggers:
 * 1. Periodic: every 15 minutes via [schedulePeriodicUpdate]
 * 2. On-demand: when the user taps the refresh button on the widget
 *
 * The worker reads the server URL from preferences, ensures the API client is
 * configured, fetches agents, and writes the data into each widget's state.
 */
class AgentWidgetWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    companion object {
        private const val TAG = "AgentWidgetWorker"
        private const val WORK_NAME = "agent_widget_update"

        /**
         * Schedule a periodic widget update every 15 minutes.
         * Uses KEEP policy so existing schedules are not replaced.
         */
        fun schedulePeriodicUpdate(context: Context) {
            val request = PeriodicWorkRequestBuilder<AgentWidgetWorker>(
                15, TimeUnit.MINUTES
            ).build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request
            )

            Log.d(TAG, "Scheduled periodic widget update every 15 minutes")
        }

        /**
         * Cancel the periodic widget update.
         */
        fun cancelPeriodicUpdate(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
        }
    }

    override suspend fun doWork(): Result {
        return try {
            val preferences = AppPreferences(applicationContext)
            val serverUrl = preferences.getServerUrl()

            if (serverUrl.isBlank()) {
                Log.w(TAG, "No server URL configured, skipping widget update")
                return Result.success()
            }

            // Ensure API client is configured
            val currentBaseUrl = ApiClient.getBaseUrl()
            if (currentBaseUrl != serverUrl) {
                ApiClient.setBaseUrl(serverUrl)
            }
            val apiKey = preferences.getApiKey()
            if (apiKey.isNotBlank() && ApiClient.getApiKey() != apiKey) {
                ApiClient.setApiKey(apiKey)
            }

            // Fetch agents
            val repository = AgentRepository()
            val agents = repository.getAgents().getOrNull() ?: emptyList()

            // Filter to active (non-archived, non-completed) agents
            val activeAgents = agents.filter { it.isLive }

            // Update all widget instances
            val manager = GlanceAppWidgetManager(applicationContext)
            val glanceIds = manager.getGlanceIds(AgentWidget::class.java)

            for (glanceId in glanceIds) {
                updateAppWidgetState(applicationContext, glanceId) { prefs ->
                    prefs[AgentWidget.KEY_AGENT_COUNT] = activeAgents.size

                    // Store up to 3 agents
                    val displayCount = minOf(activeAgents.size, 3)
                    for (i in 0 until displayCount) {
                        val agent = activeAgents[i]
                        prefs[AgentWidget.agentTitleKey(i)] = agent.title
                        prefs[AgentWidget.agentStatusKey(i)] = when (agent.status) {
                            AgentStatus.ACTIVE -> "active"
                            AgentStatus.WORKING -> "working"
                            AgentStatus.IDLE -> "idle"
                            AgentStatus.WAITING_FOR_INPUT -> "waiting-for-input"
                            AgentStatus.COMPLETED -> "completed"
                            AgentStatus.ARCHIVED -> "archived"
                        }
                        prefs[AgentWidget.agentIdKey(i)] = agent.id
                    }

                    // Clear stale entries beyond current count
                    for (i in displayCount until 3) {
                        prefs.remove(AgentWidget.agentTitleKey(i))
                        prefs.remove(AgentWidget.agentStatusKey(i))
                        prefs.remove(AgentWidget.agentIdKey(i))
                    }
                }

                // Trigger widget recomposition
                AgentWidget().update(applicationContext, glanceId)
            }

            Log.d(TAG, "Widget updated: ${activeAgents.size} active agents")
            Result.success()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to update widget", e)
            Result.retry()
        }
    }
}
