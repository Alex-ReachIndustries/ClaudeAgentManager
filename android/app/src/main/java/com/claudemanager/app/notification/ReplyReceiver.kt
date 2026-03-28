package com.claudemanager.app.notification

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.RemoteInput
import com.claudemanager.app.R
import com.claudemanager.app.data.preferences.AppPreferences
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/**
 * BroadcastReceiver that handles inline reply actions from notifications.
 *
 * When a user replies to an agent notification (on phone or Wear OS), this receiver:
 * 1. Extracts the reply text from RemoteInput
 * 2. Immediately updates the notification to show "Sending..." feedback
 * 3. POSTs the message to the backend API
 * 4. Updates the notification with success/failure status
 *
 * Uses OkHttp directly rather than Retrofit because BroadcastReceivers have a
 * limited lifecycle and need a simple, lightweight HTTP call.
 */
class ReplyReceiver : BroadcastReceiver() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .build()

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != NotificationHelper.ACTION_REPLY) return

        // Extract reply text from RemoteInput
        val remoteInputResults = RemoteInput.getResultsFromIntent(intent) ?: return
        val replyText = remoteInputResults.getCharSequence(NotificationHelper.KEY_REPLY_TEXT)
            ?.toString()
            ?.trim()

        if (replyText.isNullOrBlank()) return

        // Extract agent metadata from intent extras
        val agentId = intent.getStringExtra(NotificationHelper.EXTRA_AGENT_ID) ?: return
        val agentTitle = intent.getStringExtra(NotificationHelper.EXTRA_AGENT_TITLE) ?: "Agent"

        // Immediately show "Sending..." feedback so user knows the reply was received
        showSendingNotification(context, agentId, agentTitle)

        // Use goAsync() to extend the BroadcastReceiver's lifecycle for the network call
        val pendingResult = goAsync()

        scope.launch {
            try {
                val preferences = AppPreferences(context)
                val serverUrl = preferences.getServerUrl()

                if (serverUrl.isNullOrBlank()) {
                    NotificationHelper.updateReplyNotification(
                        context, agentId, agentTitle, success = false
                    )
                    return@launch
                }

                // POST the message to the backend
                val url = "${serverUrl.trimEnd('/')}/api/agents/$agentId/messages"
                val jsonBody = """{"content":"${escapeJson(replyText)}"}"""
                val requestBody = jsonBody.toRequestBody("application/json".toMediaType())

                val apiKey = com.claudemanager.app.data.api.ApiClient.getApiKey()
                val requestBuilder = Request.Builder()
                    .url(url)
                    .post(requestBody)
                if (apiKey.isNotEmpty()) {
                    requestBuilder.addHeader("Authorization", "Bearer $apiKey")
                }
                val request = requestBuilder.build()

                val response = httpClient.newCall(request).execute()
                val success = response.isSuccessful
                response.close()

                NotificationHelper.updateReplyNotification(
                    context, agentId, agentTitle, success = success
                )
            } catch (e: Exception) {
                NotificationHelper.updateReplyNotification(
                    context, agentId, agentTitle, success = false
                )
            } finally {
                pendingResult.finish()
            }
        }
    }

    /**
     * Shows an interim "Sending..." notification to give immediate visual feedback
     * while the network request is in flight.
     */
    private fun showSendingNotification(context: Context, agentId: String, agentTitle: String) {
        val notificationManager = NotificationManagerCompat.from(context)

        val notification = NotificationCompat.Builder(context, NotificationHelper.CHANNEL_AGENTS)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(agentTitle)
            .setContentText("Sending...")
            .setOngoing(true)
            .build()

        try {
            notificationManager.notify(agentId.hashCode(), notification)
        } catch (_: SecurityException) {
            // POST_NOTIFICATIONS permission not granted
        }
    }

    /**
     * Escapes special characters in a string for safe inclusion in a JSON string literal.
     */
    private fun escapeJson(text: String): String {
        return text
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
            .replace("\t", "\\t")
    }
}
