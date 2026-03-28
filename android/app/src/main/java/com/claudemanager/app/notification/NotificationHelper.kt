package com.claudemanager.app.notification

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import androidx.core.graphics.drawable.IconCompat
import com.claudemanager.app.MainActivity
import com.claudemanager.app.R
import com.claudemanager.app.data.models.Agent
import com.claudemanager.app.data.models.AgentStatus
import com.claudemanager.app.service.AgentNotificationService

/**
 * Centralized notification creation and management for the ClaudeManager app.
 *
 * Handles two notification channels:
 * - Agent Updates: high-importance notifications for agent activity (bridges to Wear OS)
 * - Service Status: low-importance persistent notification for the foreground service
 *
 * Notifications use MessagingStyle and RemoteInput for Wear OS inline reply support.
 */
object NotificationHelper {

    const val CHANNEL_AGENTS = "agent_updates"
    const val CHANNEL_SERVICE = "service_status"

    const val KEY_REPLY_TEXT = "key_reply_text"
    const val ACTION_REPLY = "com.claudemanager.app.ACTION_REPLY"

    const val EXTRA_AGENT_ID = "extra_agent_id"
    const val EXTRA_AGENT_TITLE = "extra_agent_title"

    const val SERVICE_NOTIFICATION_ID = 1
    const val SUMMARY_NOTIFICATION_ID = 0

    const val GROUP_KEY = "agent_notifications"

    /** Lumi purple brand color. */
    private const val COLOR_LUMI_PURPLE = 0xFF7C3AED.toInt()

    /**
     * Creates notification channels. Safe to call multiple times; the system
     * ignores duplicate channel creation.
     */
    fun createNotificationChannels(context: Context) {
        val notificationManager =
            context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        // Agent updates channel -- high importance for heads-up display
        val agentChannel = NotificationChannel(
            CHANNEL_AGENTS,
            "Agent Updates",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Notifications for agent status changes and activity updates"
            enableVibration(true)
            enableLights(true)
        }

        // Service status channel -- low importance, persistent, no sound
        val serviceChannel = NotificationChannel(
            CHANNEL_SERVICE,
            "Service Status",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Persistent notification while monitoring agent activity"
            setShowBadge(false)
            enableVibration(false)
            enableLights(false)
        }

        notificationManager.createNotificationChannel(agentChannel)
        notificationManager.createNotificationChannel(serviceChannel)
    }

    /**
     * Shows an agent notification using MessagingStyle for Wear OS compatibility.
     *
     * Each agent gets its own notification (keyed by agent.id.hashCode()).
     * Includes inline reply via RemoteInput that works on both phone and Pixel Watch.
     */
    fun showAgentNotification(context: Context, agent: Agent, text: String) {
        val notificationManager = NotificationManagerCompat.from(context)

        // Build Person for MessagingStyle
        val person = Person.Builder()
            .setName(agent.title)
            .setKey(agent.id)
            .setIcon(IconCompat.createWithResource(context, R.drawable.ic_notification))
            .build()

        // MessagingStyle for best Wear OS experience
        val messagingStyle = NotificationCompat.MessagingStyle(
            Person.Builder().setName("Me").build()
        )
            .setConversationTitle(agent.title)
            .addMessage(text, System.currentTimeMillis(), person)

        // RemoteInput for inline reply (phone + watch)
        val remoteInput = RemoteInput.Builder(KEY_REPLY_TEXT)
            .setLabel("Reply to agent...")
            .build()

        // Reply action intent -> ReplyReceiver
        val replyIntent = Intent(ACTION_REPLY).apply {
            setClass(context, ReplyReceiver::class.java)
            putExtra(EXTRA_AGENT_ID, agent.id)
            putExtra(EXTRA_AGENT_TITLE, agent.title)
        }
        val replyPendingIntent = PendingIntent.getBroadcast(
            context,
            agent.id.hashCode(),
            replyIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        )
        val replyAction = NotificationCompat.Action.Builder(
            R.drawable.ic_notification,
            "Reply",
            replyPendingIntent
        )
            .addRemoteInput(remoteInput)
            .setAllowGeneratedReplies(true)
            .build()

        // Content intent -- opens app to agent detail via deep link
        val contentIntent = Intent(context, MainActivity::class.java).apply {
            data = android.net.Uri.parse("claudemanager://agent/${agent.id}")
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val contentPendingIntent = PendingIntent.getActivity(
            context,
            agent.id.hashCode() + 1000,
            contentIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_AGENTS)
            .setStyle(messagingStyle)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(COLOR_LUMI_PURPLE)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setGroup(GROUP_KEY)
            .setContentIntent(contentPendingIntent)
            .addAction(replyAction)
            // Do NOT set setLocalOnly(true) -- must bridge to Wear OS
            .build()

        try {
            notificationManager.notify(agent.id.hashCode(), notification)
            showGroupSummaryNotification(context)
        } catch (e: SecurityException) {
            // POST_NOTIFICATIONS permission not granted -- silently ignore
        }
    }

    /**
     * Shows a group summary notification that bundles individual agent notifications
     * on devices that support notification grouping (Android 7+).
     */
    private fun showGroupSummaryNotification(context: Context) {
        val notificationManager = NotificationManagerCompat.from(context)

        val summaryIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val summaryPendingIntent = PendingIntent.getActivity(
            context,
            SUMMARY_NOTIFICATION_ID,
            summaryIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val summaryNotification = NotificationCompat.Builder(context, CHANNEL_AGENTS)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(COLOR_LUMI_PURPLE)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setGroup(GROUP_KEY)
            .setGroupSummary(true)
            .setAutoCancel(true)
            .setContentIntent(summaryPendingIntent)
            .build()

        try {
            notificationManager.notify(SUMMARY_NOTIFICATION_ID, summaryNotification)
        } catch (_: SecurityException) {
            // Permission not granted
        }
    }

    /**
     * Builds a foreground service notification.
     *
     * Returns the Notification object (does not post it) so the service can use
     * startForeground(). This notification is local-only -- it should NOT bridge
     * to Wear OS.
     */
    fun showServiceNotification(context: Context, connectionState: String): Notification {
        val contentText = when (connectionState) {
            "Connected" -> "Connected to server"
            "Connecting" -> "Connecting..."
            else -> "Disconnected - Reconnecting..."
        }

        // Content intent opens the app
        val contentIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val contentPendingIntent = PendingIntent.getActivity(
            context,
            SERVICE_NOTIFICATION_ID + 2000,
            contentIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Disconnect action
        val stopIntent = Intent(context, AgentNotificationService::class.java).apply {
            action = AgentNotificationService.ACTION_STOP
        }
        val stopPendingIntent = PendingIntent.getService(
            context,
            SERVICE_NOTIFICATION_ID + 3000,
            stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(context, CHANNEL_SERVICE)
            .setContentTitle("Claude Manager")
            .setContentText(contentText)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(COLOR_LUMI_PURPLE)
            .setOngoing(true)
            .setLocalOnly(true) // Don't bridge service notification to watch
            .setContentIntent(contentPendingIntent)
            .addAction(
                R.drawable.ic_notification,
                "Disconnect",
                stopPendingIntent
            )
            .build()
    }

    /**
     * Updates a notification after an inline reply attempt to give the user feedback.
     *
     * On success: shows a brief "Message sent" confirmation.
     * On failure: shows an error with the option to retry.
     */
    fun updateReplyNotification(
        context: Context,
        agentId: String,
        agentTitle: String,
        success: Boolean
    ) {
        val notificationManager = NotificationManagerCompat.from(context)

        val contentText = if (success) {
            "Message sent to $agentTitle"
        } else {
            "Failed to send message to $agentTitle"
        }

        val contentIntent = Intent(context, MainActivity::class.java).apply {
            data = android.net.Uri.parse("claudemanager://agent/$agentId")
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val contentPendingIntent = PendingIntent.getActivity(
            context,
            agentId.hashCode() + 4000,
            contentIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val builder = NotificationCompat.Builder(context, CHANNEL_AGENTS)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(COLOR_LUMI_PURPLE)
            .setContentTitle(agentTitle)
            .setContentText(contentText)
            .setAutoCancel(true)
            .setContentIntent(contentPendingIntent)

        if (!success) {
            // Add retry intent -- reopens the notification with reply
            val retryIntent = Intent(context, MainActivity::class.java).apply {
                data = android.net.Uri.parse("claudemanager://agent/$agentId")
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val retryPendingIntent = PendingIntent.getActivity(
                context,
                agentId.hashCode() + 5000,
                retryIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            builder.addAction(
                R.drawable.ic_notification,
                "Open App",
                retryPendingIntent
            )
        }

        try {
            notificationManager.notify(agentId.hashCode(), builder.build())
        } catch (_: SecurityException) {
            // Permission not granted
        }
    }

    /**
     * Cancels the notification for a specific agent.
     */
    fun cancelAgentNotification(context: Context, agentId: String) {
        val notificationManager = NotificationManagerCompat.from(context)
        notificationManager.cancel(agentId.hashCode())
    }
}
