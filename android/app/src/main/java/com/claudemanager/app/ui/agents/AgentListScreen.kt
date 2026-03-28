@file:OptIn(ExperimentalMaterialApi::class)

package com.claudemanager.app.ui.agents

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.ExperimentalMaterialApi
import androidx.compose.material.pullrefresh.PullRefreshIndicator
import androidx.compose.material.pullrefresh.pullRefresh
import androidx.compose.material.pullrefresh.rememberPullRefreshState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.Circle
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Update
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.claudemanager.app.data.models.Agent
import com.claudemanager.app.data.models.AgentStatus
import com.claudemanager.app.data.sse.SSEClient
import com.claudemanager.app.ui.detail.components.FolderPickerDialog
import com.claudemanager.app.ui.theme.LumiBackground
import com.claudemanager.app.ui.theme.LumiCard
import com.claudemanager.app.ui.theme.LumiError
import com.claudemanager.app.ui.theme.LumiOnSurface
import com.claudemanager.app.ui.theme.LumiOnSurfaceSecondary
import com.claudemanager.app.ui.theme.LumiOnSurfaceTertiary
import com.claudemanager.app.ui.theme.LumiPurple500
import com.claudemanager.app.ui.theme.LumiSuccess
import com.claudemanager.app.ui.theme.LumiWarning
import com.claudemanager.app.ui.theme.agentStatusColor
import com.claudemanager.app.util.TimeUtils

/**
 * Agent list screen displaying all active and archived agents.
 *
 * Features:
 * - Pull-to-refresh
 * - Real-time updates via SSE
 * - Active/archived sections (archived collapsed by default)
 * - FAB to launch new agent via folder picker
 * - Connection status indicator in the app bar
 *
 * @param onAgentClick Callback when an agent card is tapped.
 * @param onSettingsClick Callback when the settings icon is tapped.
 * @param startAgentId Optional agent ID to auto-navigate to on first load.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AgentListScreen(
    onAgentClick: (String) -> Unit,
    onSettingsClick: () -> Unit,
    startAgentId: String? = null,
    viewModel: AgentListViewModel = viewModel()
) {
    val state by viewModel.uiState.collectAsState()
    var showArchived by remember { mutableStateOf(false) }
    var showFolderPicker by remember { mutableStateOf(false) }

    val activeAgents = state.agents.filter { it.status != AgentStatus.ARCHIVED }
    val archivedAgents = state.agents.filter { it.status == AgentStatus.ARCHIVED }
    val pullRefreshState = rememberPullRefreshState(
        refreshing = state.isRefreshing,
        onRefresh = viewModel::refresh
    )

    // Handle deep-link navigation to a specific agent (consume once)
    var consumedStartId by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(startAgentId) {
        if (startAgentId != null && startAgentId != consumedStartId) {
            consumedStartId = startAgentId
            onAgentClick(startAgentId)
        }
    }

    Scaffold(
        topBar = {
            CenterAlignedTopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "Claude Manager",
                            style = MaterialTheme.typography.titleLarge
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        ConnectionDot(state.connectionState)
                    }
                },
                actions = {
                    IconButton(onClick = viewModel::refresh) {
                        Icon(
                            imageVector = Icons.Default.Refresh,
                            contentDescription = "Refresh",
                            tint = LumiOnSurfaceSecondary
                        )
                    }
                    IconButton(onClick = onSettingsClick) {
                        Icon(
                            imageVector = Icons.Default.Settings,
                            contentDescription = "Settings",
                            tint = LumiOnSurfaceSecondary
                        )
                    }
                },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(
                    containerColor = LumiBackground,
                    titleContentColor = LumiOnSurface
                )
            )
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = { showFolderPicker = true },
                containerColor = LumiPurple500,
                contentColor = LumiOnSurface
            ) {
                Icon(Icons.Default.Add, contentDescription = "New Agent")
            }
        },
        containerColor = LumiBackground
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .pullRefresh(pullRefreshState)
        ) {
            if (!state.isLoading && activeAgents.isEmpty() && archivedAgents.isEmpty()) {
                // Empty state
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(
                            imageVector = Icons.Default.Notifications,
                            contentDescription = null,
                            modifier = Modifier.size(48.dp),
                            tint = LumiOnSurfaceTertiary
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        Text(
                            text = "No agents running",
                            style = MaterialTheme.typography.bodyLarge,
                            color = LumiOnSurfaceSecondary
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "Tap + to launch a new agent",
                            style = MaterialTheme.typography.bodyMedium,
                            color = LumiOnSurfaceTertiary
                        )
                    }
                }
            } else {
                LazyColumn(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(horizontal = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    // Error banner
                    if (state.error != null) {
                        item {
                            Text(
                                text = state.error!!,
                                color = LumiError,
                                style = MaterialTheme.typography.bodySmall,
                                modifier = Modifier.padding(vertical = 8.dp)
                            )
                        }
                    }

                    // Active agents section
                    if (activeAgents.isNotEmpty()) {
                        item {
                            SectionHeader(
                                title = "Active Agents",
                                count = activeAgents.size
                            )
                        }
                        items(activeAgents, key = { it.id }) { agent ->
                            AgentCard(
                                agent = agent,
                                onClick = { onAgentClick(agent.id) }
                            )
                        }
                    }

                    // Archived agents section (collapsed by default)
                    if (archivedAgents.isNotEmpty()) {
                        item {
                            Spacer(modifier = Modifier.height(8.dp))
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable { showArchived = !showArchived }
                                    .padding(vertical = 8.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Archive,
                                    contentDescription = null,
                                    tint = LumiOnSurfaceTertiary,
                                    modifier = Modifier.size(16.dp)
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                Text(
                                    text = "Archived",
                                    style = MaterialTheme.typography.titleSmall,
                                    color = LumiOnSurfaceTertiary
                                )
                                Spacer(modifier = Modifier.width(4.dp))
                                Text(
                                    text = "(${archivedAgents.size})",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = LumiOnSurfaceTertiary
                                )
                                Spacer(modifier = Modifier.weight(1f))
                                Icon(
                                    imageVector = if (showArchived) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                                    contentDescription = if (showArchived) "Collapse" else "Expand",
                                    tint = LumiOnSurfaceTertiary,
                                    modifier = Modifier.size(20.dp)
                                )
                            }
                        }

                        if (showArchived) {
                            items(archivedAgents, key = { it.id }) { agent ->
                                AgentCard(
                                    agent = agent,
                                    onClick = { onAgentClick(agent.id) }
                                )
                            }
                        }
                    }

                    // Bottom spacer for FAB clearance
                    item { Spacer(modifier = Modifier.height(80.dp)) }
                }
            }

            PullRefreshIndicator(
                refreshing = state.isRefreshing,
                state = pullRefreshState,
                modifier = Modifier.align(Alignment.TopCenter),
                contentColor = LumiPurple500
            )
        }
    }

    // Folder picker dialog
    if (showFolderPicker) {
        FolderPickerDialog(
            onDismiss = { showFolderPicker = false },
            onFolderSelected = { path ->
                showFolderPicker = false
                viewModel.launchNewAgent(path)
            }
        )
    }
}

/**
 * Section header for the agent list.
 */
@Composable
private fun SectionHeader(title: String, count: Int) {
    Row(
        modifier = Modifier.padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.titleSmall,
            color = LumiOnSurfaceSecondary
        )
        Spacer(modifier = Modifier.width(6.dp))
        Text(
            text = "($count)",
            style = MaterialTheme.typography.bodySmall,
            color = LumiOnSurfaceTertiary
        )
    }
}

/**
 * Individual agent card in the list.
 * Shows status dot, title, workspace, summary, stats, and activity time.
 */
@Composable
private fun AgentCard(agent: Agent, onClick: () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .animateContentSize(),
        colors = CardDefaults.cardColors(containerColor = LumiCard),
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            // Title row with status dot
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(10.dp)
                        .clip(CircleShape)
                        .background(agentStatusColor(agent.status))
                )
                Spacer(modifier = Modifier.width(10.dp))
                Text(
                    text = agent.title,
                    style = MaterialTheme.typography.titleMedium,
                    color = LumiOnSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )
            }

            // Workspace
            if (!agent.workspace.isNullOrBlank()) {
                val folderName = agent.workspace!!.substringAfterLast('/').substringAfterLast('\\')
                Text(
                    text = folderName,
                    style = MaterialTheme.typography.bodySmall,
                    color = LumiOnSurfaceTertiary,
                    modifier = Modifier.padding(start = 20.dp, top = 2.dp)
                )
            }

            // Latest activity: show most recent of agent update or user message
            val subtitle = run {
                val summary = agent.latestSummary
                val message = agent.latestMessage
                if (summary != null && message != null) {
                    val updateTime = TimeUtils.parseIso(agent.lastUpdateAt)?.time ?: 0L
                    val messageTime = agent.lastMessageAt?.let { TimeUtils.parseIso(it)?.time } ?: 0L
                    if (messageTime > updateTime) "You: $message" else summary
                } else message?.let { "You: $it" } ?: summary
            }
            if (!subtitle.isNullOrBlank()) {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodyMedium,
                    color = LumiOnSurfaceSecondary,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
            }

            Spacer(modifier = Modifier.height(10.dp))

            // Stats row
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    // Update count
                    Icon(
                        imageVector = Icons.Default.Update,
                        contentDescription = "Updates",
                        tint = LumiOnSurfaceTertiary,
                        modifier = Modifier.size(14.dp)
                    )
                    Spacer(modifier = Modifier.width(3.dp))
                    Text(
                        text = "${agent.updateCount}",
                        style = MaterialTheme.typography.labelSmall,
                        color = LumiOnSurfaceTertiary
                    )

                    // Unread badge
                    if (agent.unreadUpdateCount > 0) {
                        Spacer(modifier = Modifier.width(10.dp))
                        Badge(
                            text = "${agent.unreadUpdateCount} new",
                            color = LumiPurple500
                        )
                    }

                    // Pending messages badge
                    if (agent.pendingMessageCount > 0) {
                        Spacer(modifier = Modifier.width(10.dp))
                        Icon(
                            imageVector = Icons.Default.Email,
                            contentDescription = "Pending messages",
                            tint = LumiWarning,
                            modifier = Modifier.size(14.dp)
                        )
                        Spacer(modifier = Modifier.width(3.dp))
                        Text(
                            text = "${agent.pendingMessageCount}",
                            style = MaterialTheme.typography.labelSmall,
                            color = LumiWarning
                        )
                    }
                }

                // Time since last activity
                val timeText = agent.lastActivityAt?.let { TimeUtils.timeAgo(it) }
                    ?: TimeUtils.timeAgo(agent.lastUpdateAt)
                Text(
                    text = timeText,
                    style = MaterialTheme.typography.labelSmall,
                    color = LumiOnSurfaceTertiary
                )
            }
        }
    }
}

/**
 * Small colored badge for counts (unread updates, etc.).
 */
@Composable
private fun Badge(text: String, color: androidx.compose.ui.graphics.Color) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(10.dp))
            .background(color.copy(alpha = 0.2f))
            .padding(horizontal = 6.dp, vertical = 2.dp)
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelSmall,
            color = color
        )
    }
}

/**
 * Connection status indicator dot in the top app bar.
 */
@Composable
private fun ConnectionDot(state: SSEClient.ConnectionState) {
    val color = when (state) {
        SSEClient.ConnectionState.CONNECTED -> LumiSuccess
        SSEClient.ConnectionState.CONNECTING -> LumiWarning
        SSEClient.ConnectionState.DISCONNECTED -> LumiError
    }
    Box(
        modifier = Modifier
            .size(8.dp)
            .clip(CircleShape)
            .background(color)
    )
}
