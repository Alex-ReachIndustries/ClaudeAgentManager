package com.claudemanager.app.ui.detail.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material.icons.outlined.AccountTree
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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

@Composable
private fun UpdateTimelineItem(update: AgentUpdate) {
    val content = update.parsedContent()
    val typeInfo = updateTypeInfo(update.type)

    // Determine if this item has expandable detail beyond the summary line.
    // Status: verbose content.status vs short summary.
    // Text: full content.text vs short summary.
    val detailText: String? = when (content) {
        is UpdateContent.Status ->
            if (!update.summary.isNullOrBlank() && content.status.isNotBlank() && content.status.trim() != update.summary!!.trim())
                content.status
            else null
        is UpdateContent.Text ->
            if (!update.summary.isNullOrBlank() && content.text.isNotBlank() && content.text.trim() != update.summary!!.trim())
                content.text
            else null
        else -> null
    }
    val isExpandable = detailText != null
    var expanded by remember(update.id) { mutableStateOf(false) }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .then(
                if (isExpandable) Modifier.clickable { expanded = !expanded }
                else Modifier
            )
            .padding(vertical = 12.dp),
        verticalAlignment = Alignment.Top
    ) {
        Icon(
            imageVector = typeInfo.icon,
            contentDescription = typeInfo.label,
            tint = typeInfo.color,
            modifier = Modifier.size(20.dp)
        )

        Spacer(modifier = Modifier.width(12.dp))

        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = TimeUtils.formatTimestamp(update.timestamp),
                style = MaterialTheme.typography.labelSmall,
                color = LumiOnSurfaceTertiary
            )

            Spacer(modifier = Modifier.height(4.dp))

            when (content) {
                is UpdateContent.Text -> {
                    // Show summary collapsed, full text when expanded
                    val collapsed = update.summary ?: content.text
                    Text(
                        text = collapsed,
                        style = MaterialTheme.typography.bodyMedium,
                        color = LumiOnSurface,
                        maxLines = if (isExpandable) 2 else 6,
                        overflow = TextOverflow.Ellipsis
                    )
                    if (isExpandable) {
                        AnimatedVisibility(
                            visible = expanded,
                            enter = expandVertically(),
                            exit = shrinkVertically()
                        ) {
                            Column {
                                Spacer(modifier = Modifier.height(6.dp))
                                Text(
                                    text = detailText!!,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = LumiOnSurfaceSecondary
                                )
                            }
                        }
                    }
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
                    // Show summary collapsed, full verbose content when expanded
                    val collapsed = update.summary ?: content.status
                    Text(
                        text = collapsed,
                        style = MaterialTheme.typography.bodyMedium,
                        color = LumiOnSurface,
                        maxLines = if (isExpandable) 2 else Int.MAX_VALUE,
                        overflow = TextOverflow.Ellipsis
                    )
                    if (isExpandable) {
                        AnimatedVisibility(
                            visible = expanded,
                            enter = expandVertically(),
                            exit = shrinkVertically()
                        ) {
                            Column {
                                Spacer(modifier = Modifier.height(6.dp))
                                Text(
                                    text = detailText!!,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = LumiOnSurfaceSecondary
                                )
                            }
                        }
                    }
                    if (content.progress > 0) {
                        Spacer(modifier = Modifier.height(6.dp))
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            LinearProgressIndicator(
                                progress = { content.progress / 100f },
                                modifier = Modifier
                                    .weight(1f)
                                    .height(4.dp)
                                    .clip(RoundedCornerShape(2.dp)),
                                color = LumiWarning,
                                trackColor = LumiCard
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = "${content.progress}%",
                                style = MaterialTheme.typography.labelSmall,
                                color = LumiOnSurfaceSecondary
                            )
                        }
                    }
                }

                is UpdateContent.Diagram -> {
                    Text(
                        text = "Diagram",
                        style = MaterialTheme.typography.bodyMedium,
                        color = LumiOnSurfaceSecondary
                    )
                }

                is UpdateContent.Relay -> {
                    val arrow = if (content.direction == "sent") "→" else "←"
                    Text(
                        text = "$arrow ${content.otherTitle}: ${content.message}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = LumiOnSurfaceSecondary,
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
        }

        // Chevron indicator for expandable items
        if (isExpandable) {
            Spacer(modifier = Modifier.width(4.dp))
            Icon(
                imageVector = if (expanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                contentDescription = if (expanded) "Collapse" else "Expand",
                tint = LumiOnSurfaceTertiary,
                modifier = Modifier
                    .size(16.dp)
                    .align(Alignment.CenterVertically)
            )
        }
    }
}

private data class UpdateTypeInfo(
    val icon: ImageVector,
    val label: String,
    val color: androidx.compose.ui.graphics.Color
)

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
    UpdateType.RELAY -> UpdateTypeInfo(
        icon = Icons.Default.SwapHoriz,
        label = "Relay",
        color = LumiInfo
    )
}
