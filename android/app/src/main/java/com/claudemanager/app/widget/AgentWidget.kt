package com.claudemanager.app.widget

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.action.ActionParameters
import androidx.glance.action.actionParametersOf
import androidx.glance.action.actionStartActivity
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.currentState
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.claudemanager.app.MainActivity
import com.claudemanager.app.R

/**
 * Glance App Widget that displays active Claude agents with their status.
 *
 * Shows:
 * - Active agent count in header
 * - Up to 3 agents with title and status
 * - Manual refresh button
 * - Tap on widget opens app; tap on agent opens detail via deep link
 *
 * Data is stored in widget state as preferences keys and updated by [AgentWidgetWorker].
 */
class AgentWidget : GlanceAppWidget() {

    companion object {
        // Widget state keys
        val KEY_AGENT_COUNT = intPreferencesKey("agent_count")
        fun agentTitleKey(index: Int) = stringPreferencesKey("agent_title_$index")
        fun agentStatusKey(index: Int) = stringPreferencesKey("agent_status_$index")
        fun agentIdKey(index: Int) = stringPreferencesKey("agent_id_$index")

        // Colors matching app theme (LumiBackground, LumiCard, etc.)
        val BgColor = ColorProvider(day = android.graphics.Color.parseColor("#0F0F14"), night = android.graphics.Color.parseColor("#0F0F14"))
        val CardColor = ColorProvider(day = android.graphics.Color.parseColor("#1E1E28"), night = android.graphics.Color.parseColor("#1E1E28"))
        val TextPrimary = ColorProvider(day = android.graphics.Color.parseColor("#E2E2EA"), night = android.graphics.Color.parseColor("#E2E2EA"))
        val TextSecondary = ColorProvider(day = android.graphics.Color.parseColor("#9898A6"), night = android.graphics.Color.parseColor("#9898A6"))
        val TextTertiary = ColorProvider(day = android.graphics.Color.parseColor("#6E6E7A"), night = android.graphics.Color.parseColor("#6E6E7A"))
        val PurpleAccent = ColorProvider(day = android.graphics.Color.parseColor("#8B5CF6"), night = android.graphics.Color.parseColor("#8B5CF6"))
    }

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        provideContent {
            AgentWidgetContent()
        }
    }

    @Composable
    private fun AgentWidgetContent() {
        val prefs = currentState<Preferences>()
        val agentCount = prefs[KEY_AGENT_COUNT] ?: 0

        Column(
            modifier = GlanceModifier
                .fillMaxSize()
                .background(BgColor)
                .padding(12.dp)
                .clickable(actionStartActivity<MainActivity>())
        ) {
            // Header row with title and refresh button
            Row(
                modifier = GlanceModifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = GlanceModifier.defaultWeight()) {
                    Text(
                        text = "Claude Manager",
                        style = TextStyle(
                            color = TextPrimary,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Bold
                        )
                    )
                    Text(
                        text = if (agentCount == 0) "No active agents"
                        else "$agentCount active agent${if (agentCount != 1) "s" else ""}",
                        style = TextStyle(
                            color = TextSecondary,
                            fontSize = 12.sp
                        )
                    )
                }

                // Refresh button
                Image(
                    provider = ImageProvider(R.drawable.ic_notification),
                    contentDescription = "Refresh",
                    modifier = GlanceModifier
                        .size(24.dp)
                        .clickable(actionRunCallback<RefreshWidgetAction>())
                )
            }

            Spacer(modifier = GlanceModifier.height(8.dp))

            // Agent list (up to 3)
            val displayCount = minOf(agentCount, 3)
            if (displayCount == 0) {
                Text(
                    text = "Tap + in app to launch",
                    style = TextStyle(
                        color = TextTertiary,
                        fontSize = 11.sp
                    )
                )
            } else {
                for (i in 0 until displayCount) {
                    val title = prefs[agentTitleKey(i)] ?: "Agent"
                    val status = prefs[agentStatusKey(i)] ?: "unknown"
                    val agentId = prefs[agentIdKey(i)] ?: ""

                    AgentWidgetRow(
                        title = title,
                        status = status,
                        agentId = agentId
                    )

                    if (i < displayCount - 1) {
                        Spacer(modifier = GlanceModifier.height(4.dp))
                    }
                }

                // Show count of remaining agents
                if (agentCount > 3) {
                    Spacer(modifier = GlanceModifier.height(4.dp))
                    Text(
                        text = "+${agentCount - 3} more",
                        style = TextStyle(
                            color = TextTertiary,
                            fontSize = 11.sp
                        )
                    )
                }
            }
        }
    }

    @Composable
    private fun AgentWidgetRow(
        title: String,
        status: String,
        agentId: String
    ) {
        val statusColor = when (status.lowercase()) {
            "active" -> ColorProvider(
                day = android.graphics.Color.parseColor("#22C55E"),
                night = android.graphics.Color.parseColor("#22C55E")
            )
            "working" -> ColorProvider(
                day = android.graphics.Color.parseColor("#3B82F6"),
                night = android.graphics.Color.parseColor("#3B82F6")
            )
            "idle" -> ColorProvider(
                day = android.graphics.Color.parseColor("#F59E0B"),
                night = android.graphics.Color.parseColor("#F59E0B")
            )
            "waiting-for-input" -> ColorProvider(
                day = android.graphics.Color.parseColor("#F59E0B"),
                night = android.graphics.Color.parseColor("#F59E0B")
            )
            "completed" -> ColorProvider(
                day = android.graphics.Color.parseColor("#6B7280"),
                night = android.graphics.Color.parseColor("#6B7280")
            )
            else -> TextTertiary
        }

        val statusLabel = when (status.lowercase()) {
            "active" -> "Active"
            "working" -> "Working"
            "idle" -> "Idle"
            "waiting-for-input" -> "Waiting"
            "completed" -> "Completed"
            "archived" -> "Archived"
            else -> status
        }

        Row(
            modifier = GlanceModifier
                .fillMaxWidth()
                .background(CardColor)
                .padding(horizontal = 8.dp, vertical = 6.dp)
                .clickable(
                    actionRunCallback<OpenAgentAction>(
                        actionParametersOf(
                            OpenAgentAction.AGENT_ID_KEY to agentId
                        )
                    )
                ),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Truncated title
            Text(
                text = title,
                style = TextStyle(
                    color = TextPrimary,
                    fontSize = 12.sp
                ),
                maxLines = 1,
                modifier = GlanceModifier.defaultWeight()
            )
            Spacer(modifier = GlanceModifier.width(6.dp))
            Text(
                text = statusLabel,
                style = TextStyle(
                    color = statusColor,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Medium
                )
            )
        }
    }
}

/**
 * Action callback triggered when the user taps an agent row in the widget.
 * Opens the app with a deep link to the specific agent's detail screen.
 */
class OpenAgentAction : ActionCallback {
    companion object {
        val AGENT_ID_KEY = ActionParameters.Key<String>("agentId")
    }

    override suspend fun onAction(
        context: Context,
        glanceId: GlanceId,
        parameters: ActionParameters
    ) {
        val agentId = parameters[AGENT_ID_KEY] ?: return
        val intent = Intent(context, MainActivity::class.java).apply {
            data = Uri.parse("claudemanager://agent/$agentId")
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        context.startActivity(intent)
    }
}

/**
 * Action callback triggered when the user taps the refresh button on the widget.
 * Enqueues a one-time [AgentWidgetWorker] to fetch fresh data from the API.
 */
class RefreshWidgetAction : ActionCallback {
    override suspend fun onAction(
        context: Context,
        glanceId: GlanceId,
        parameters: ActionParameters
    ) {
        val request = OneTimeWorkRequestBuilder<AgentWidgetWorker>().build()
        WorkManager.getInstance(context).enqueue(request)
    }
}
