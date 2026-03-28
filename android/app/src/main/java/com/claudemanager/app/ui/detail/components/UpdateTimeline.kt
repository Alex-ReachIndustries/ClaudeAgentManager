package com.claudemanager.app.ui.detail.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material.icons.outlined.AccountTree
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.claudemanager.app.data.models.AgentUpdate
import com.claudemanager.app.data.models.UpdateContent
import com.claudemanager.app.data.models.UpdateType
import com.claudemanager.app.ui.theme.LumiCard
import com.claudemanager.app.ui.theme.LumiError
import com.claudemanager.app.ui.theme.LumiInfo
import com.claudemanager.app.ui.theme.LumiOnSurface
import com.claudemanager.app.ui.theme.LumiOnSurfaceSecondary
import com.claudemanager.app.ui.theme.LumiOnSurfaceTertiary
import com.claudemanager.app.ui.theme.LumiPurple500
import com.claudemanager.app.ui.theme.LumiSuccess
import com.claudemanager.app.ui.theme.LumiWarning
import com.claudemanager.app.util.TimeUtils

/**
 * Scrollable list of agent updates displayed in reverse chronological order (newest first).
 *
 * Each update shows a type icon, timestamp, and content rendered according to its type
 * (text, progress bar, error message, status transition, or diagram placeholder).
 */
@Composable
fun UpdateTimeline(
    updates: List<AgentUpdate>,
    modifier: Modifier = Modifier
) {
    if (updates.isEmpty()) {
        Box(
            modifier = modifier,
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = "No updates yet",
                style = MaterialTheme.typography.bodyLarge,
                color = LumiOnSurfaceTertiary
            )
        }
        return
    }

    // Show newest first
    val sortedUpdates = updates.sortedByDescending { it.id }

    LazyColumn(
        modifier = modifier.padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(0.dp)
    ) {
        item { Spacer(modifier = Modifier.height(8.dp)) }

        items(sortedUpdates, key = { it.id }) { update ->
            UpdateTimelineItem(update = update)
            HorizontalDivider(
                color = LumiCard,
                thickness = 1.dp,
                modifier = Modifier.padding(start = 40.dp)
            )
        }

        item { Spacer(modifier = Modifier.height(16.dp)) }
    }
}

/**
 * A single update item in the timeline.
 */
@Composable
private fun UpdateTimelineItem(update: AgentUpdate) {
    val content = update.parsedContent()
    val typeInfo = updateTypeInfo(update.type)

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 12.dp),
        verticalAlignment = Alignment.Top
    ) {
        // Type icon
        Icon(
            imageVector = typeInfo.icon,
            contentDescription = typeInfo.label,
            tint = typeInfo.color,
            modifier = Modifier.size(20.dp)
        )

        Spacer(modifier = Modifier.width(12.dp))

        Column(modifier = Modifier.weight(1f)) {
            // Timestamp
            Text(
                text = TimeUtils.formatTimestamp(update.timestamp),
                style = MaterialTheme.typography.labelSmall,
                color = LumiOnSurfaceTertiary
            )

            Spacer(modifier = Modifier.height(4.dp))

            // Content based on type
            when (content) {
                is UpdateContent.Text -> {
                    val displayText = update.summary ?: content.text
                    Text(
                        text = displayText,
                        style = MaterialTheme.typography.bodyMedium,
                        color = LumiOnSurface,
                        maxLines = 6,
                        overflow = TextOverflow.Ellipsis
                    )
                }

                is UpdateContent.Progress -> {
                    Text(
                        text = content.description,
                        style = MaterialTheme.typography.bodyMedium,
                        color = LumiOnSurface
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        LinearProgressIndicator(
                            progress = { content.percentage / 100f },
                            modifier = Modifier
                                .weight(1f)
                                .height(6.dp)
                                .clip(RoundedCornerShape(3.dp)),
                            color = LumiPurple500,
                            trackColor = LumiCard
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = "${content.percentage}%",
                            style = MaterialTheme.typography.labelSmall,
                            color = LumiOnSurfaceSecondary
                        )
                    }
                }

                is UpdateContent.Error -> {
                    Text(
                        text = content.message,
                        style = MaterialTheme.typography.bodyMedium,
                        color = LumiError,
                        maxLines = 4,
                        overflow = TextOverflow.Ellipsis
                    )
                }

                is UpdateContent.Status -> {
                    Text(
                        text = content.status,
                        style = MaterialTheme.typography.bodyMedium,
                        color = LumiOnSurface
                    )
                }

                is UpdateContent.Diagram -> {
                    Text(
                        text = "Diagram",
                        style = MaterialTheme.typography.bodyMedium,
                        color = LumiOnSurfaceSecondary
                    )
                }
            }
        }
    }
}

/**
 * Visual metadata for each update type.
 */
private data class UpdateTypeInfo(
    val icon: ImageVector,
    val label: String,
    val color: androidx.compose.ui.graphics.Color
)

/**
 * Returns the icon, label, and color for a given [UpdateType].
 */
private fun updateTypeInfo(type: UpdateType): UpdateTypeInfo = when (type) {
    UpdateType.TEXT -> UpdateTypeInfo(
        icon = Icons.Default.Description,
        label = "Text",
        color = LumiInfo
    )
    UpdateType.PROGRESS -> UpdateTypeInfo(
        icon = Icons.Default.BarChart,
        label = "Progress",
        color = LumiPurple500
    )
    UpdateType.ERROR -> UpdateTypeInfo(
        icon = Icons.Default.Error,
        label = "Error",
        color = LumiError
    )
    UpdateType.STATUS -> UpdateTypeInfo(
        icon = Icons.Default.SwapHoriz,
        label = "Status",
        color = LumiWarning
    )
    UpdateType.DIAGRAM -> UpdateTypeInfo(
        icon = Icons.Outlined.AccountTree,
        label = "Diagram",
        color = LumiSuccess
    )
}
