@file:OptIn(ExperimentalMaterialApi::class)

package com.claudemanager.app.ui.detail

import androidx.compose.foundation.background
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.ExperimentalMaterialApi
import androidx.compose.material.pullrefresh.PullRefreshIndicator
import androidx.compose.material.pullrefresh.pullRefresh
import androidx.compose.material.pullrefresh.rememberPullRefreshState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Unarchive
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.TabRowDefaults
import androidx.compose.material3.TabRowDefaults.tabIndicatorOffset
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.claudemanager.app.ClaudeManagerApp
import com.claudemanager.app.data.models.Agent
import com.claudemanager.app.data.models.AgentStatus
import com.claudemanager.app.data.models.MessageStatus
import com.claudemanager.app.ui.detail.components.ConversationPanel
import com.claudemanager.app.ui.detail.components.FilesPanel
import com.claudemanager.app.ui.theme.LumiBackground
import com.claudemanager.app.ui.theme.LumiCard
import com.claudemanager.app.ui.theme.LumiError
import com.claudemanager.app.ui.theme.LumiOnSurface
import com.claudemanager.app.ui.theme.LumiOnSurfaceSecondary
import com.claudemanager.app.ui.theme.LumiOnSurfaceTertiary
import com.claudemanager.app.ui.theme.LumiPurple500
import com.claudemanager.app.ui.theme.agentStatusColor
import com.claudemanager.app.util.TimeUtils

/**
 * Agent detail screen with tabs for Conversation and Info.
 *
 * Creates its own [AgentDetailViewModel] via a factory, injecting the agentId.
 *
 * @param agentId The agent ID to display.
 * @param onBack Callback to navigate back to the agent list.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AgentDetailScreen(
    agentId: String,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val app = context.applicationContext as ClaudeManagerApp

    // Create ViewModel with factory to inject agentId
    val viewModel = remember(agentId) {
        AgentDetailViewModelFactory(app, agentId).create(AgentDetailViewModel::class.java)
    }

    val state by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    var showOverflowMenu by remember { mutableStateOf(false) }
    var showDeleteConfirm by remember { mutableStateOf(false) }
    val pullRefreshState = rememberPullRefreshState(
        refreshing = state.isRefreshing,
        onRefresh = viewModel::refreshAll
    )

    // Show error in snackbar
    LaunchedEffect(state.error) {
        state.error?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearError()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            text = state.agent?.title ?: "Agent",
                            style = MaterialTheme.typography.titleMedium,
                            color = LumiOnSurface,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        state.agent?.let { agent ->
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Box(
                                    modifier = Modifier
                                        .size(8.dp)
                                        .clip(RoundedCornerShape(4.dp))
                                        .background(agentStatusColor(agent.status))
                                )
                                Spacer(modifier = Modifier.width(6.dp))
                                Text(
                                    text = agent.status.displayName,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = LumiOnSurfaceSecondary
                                )
                            }
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            imageVector = Icons.Default.ArrowBack,
                            contentDescription = "Back",
                            tint = LumiOnSurface
                        )
                    }
                },
                actions = {
                    Box {
                        IconButton(onClick = { showOverflowMenu = true }) {
                            Icon(
                                imageVector = Icons.Default.MoreVert,
                                contentDescription = "More options",
                                tint = LumiOnSurfaceSecondary
                            )
                        }
                        DropdownMenu(
                            expanded = showOverflowMenu,
                            onDismissRequest = { showOverflowMenu = false }
                        ) {
                            val agent = state.agent
                            if (agent != null) {
                                // Resume (for archived/completed agents)
                                if (!agent.isLive) {
                                    DropdownMenuItem(
                                        text = { Text("Resume") },
                                        leadingIcon = {
                                            Icon(Icons.Default.PlayArrow, contentDescription = null)
                                        },
                                        onClick = {
                                            showOverflowMenu = false
                                            viewModel.resumeAgent()
                                        }
                                    )
                                }

                                // PDF Export
                                DropdownMenuItem(
                                    text = { Text("Export PDF") },
                                    leadingIcon = {
                                        Icon(Icons.Default.PictureAsPdf, contentDescription = null)
                                    },
                                    onClick = {
                                        showOverflowMenu = false
                                        val url = viewModel.getPdfExportUrl()
                                        val intent = android.content.Intent(
                                            android.content.Intent.ACTION_VIEW,
                                            android.net.Uri.parse(url)
                                        )
                                        context.startActivity(intent)
                                    }
                                )

                                if (agent.status == AgentStatus.ARCHIVED) {
                                    DropdownMenuItem(
                                        text = { Text("Unarchive") },
                                        leadingIcon = {
                                            Icon(Icons.Default.Unarchive, contentDescription = null)
                                        },
                                        onClick = {
                                            showOverflowMenu = false
                                            viewModel.unarchiveAgent()
                                        }
                                    )
                                } else {
                                    DropdownMenuItem(
                                        text = { Text("Archive") },
                                        leadingIcon = {
                                            Icon(Icons.Default.Archive, contentDescription = null)
                                        },
                                        onClick = {
                                            showOverflowMenu = false
                                            viewModel.archiveAgent()
                                        }
                                    )
                                    if (agent.isLive) {
                                        DropdownMenuItem(
                                            text = { Text("Close & Terminate") },
                                            leadingIcon = {
                                                Icon(Icons.Default.Close, contentDescription = null)
                                            },
                                            onClick = {
                                                showOverflowMenu = false
                                                viewModel.closeAgent()
                                            }
                                        )
                                    }
                                }
                                DropdownMenuItem(
                                    text = { Text("Delete", color = LumiError) },
                                    leadingIcon = {
                                        Icon(Icons.Default.Delete, contentDescription = null, tint = LumiError)
                                    },
                                    onClick = {
                                        showOverflowMenu = false
                                        showDeleteConfirm = true
                                    }
                                )
                            }
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = LumiBackground,
                    titleContentColor = LumiOnSurface
                )
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        containerColor = LumiBackground
    ) { padding ->
        if (state.isLoading && state.agent == null) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator(color = LumiPurple500)
            }
        } else {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
            ) {
                // Tab row
                val tabs = DetailTab.entries
                TabRow(
                    selectedTabIndex = state.selectedTab.ordinal,
                    containerColor = LumiBackground,
                    contentColor = LumiOnSurface,
                    indicator = { tabPositions ->
                        TabRowDefaults.SecondaryIndicator(
                            modifier = Modifier.tabIndicatorOffset(tabPositions[state.selectedTab.ordinal]),
                            color = LumiPurple500
                        )
                    },
                    divider = {
                        Spacer(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(1.dp)
                                .background(LumiCard)
                        )
                    }
                ) {
                    tabs.forEach { tab ->
                        Tab(
                            selected = state.selectedTab == tab,
                            onClick = { viewModel.selectTab(tab) },
                            text = {
                                Text(
                                    text = when (tab) {
                                        DetailTab.CONVERSATION -> "Conversation"
                                        DetailTab.INFO -> "Info"
                                    },
                                    style = MaterialTheme.typography.labelLarge,
                                    color = if (state.selectedTab == tab)
                                        LumiPurple500 else LumiOnSurfaceTertiary
                                )
                            }
                        )
                    }
                }

                // Tab content with pull-to-refresh
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .pullRefresh(pullRefreshState)
                ) {
                    when (state.selectedTab) {
                        DetailTab.CONVERSATION -> {
                            ConversationPanel(
                                updates = state.updates,
                                messages = state.messages,
                                isSending = state.isSendingMessage,
                                isUploading = state.isUploading,
                                onSendMessage = viewModel::sendMessage,
                                onUploadFile = { uri -> viewModel.uploadFile(uri, context) },
                                draftMessage = state.draftMessage,
                                onDraftChanged = viewModel::updateDraftMessage,
                                modifier = Modifier.fillMaxSize()
                            )
                        }
                        DetailTab.INFO -> {
                            InfoTab(
                                agent = state.agent,
                                messages = state.messages,
                                files = state.files,
                                onFileClick = { fileId ->
                                    val file = state.files.find { it.id == fileId }
                                    val filename = file?.filename ?: "download"
                                    viewModel.downloadFile(fileId, filename, context)
                                },
                                modifier = Modifier.fillMaxSize()
                            )
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
        }
    }

    // Delete confirmation dialog
    if (showDeleteConfirm) {
        AlertDialog(
            onDismissRequest = { showDeleteConfirm = false },
            title = { Text("Delete Agent?") },
            text = {
                Text(
                    "This will permanently delete the agent and all its updates, messages, and files. This action cannot be undone."
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        showDeleteConfirm = false
                        viewModel.deleteAgent(onDeleted = onBack)
                    }
                ) {
                    Text("Delete", color = LumiError)
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteConfirm = false }) {
                    Text("Cancel")
                }
            },
            containerColor = LumiCard,
            titleContentColor = LumiOnSurface,
            textContentColor = LumiOnSurfaceSecondary
        )
    }
}

/**
 * Combined Info tab that renders agent metrics and file list
 * in a single scrollable LazyColumn to avoid nested scroll conflicts.
 */
@Composable
private fun InfoTab(
    agent: Agent?,
    messages: List<com.claudemanager.app.data.models.AgentMessage>,
    files: List<com.claudemanager.app.data.models.FileInfo>,
    onFileClick: (Long) -> Unit,
    modifier: Modifier = Modifier
) {
    Column(modifier = modifier) {
        AgentMetricsPanel(
            agent = agent,
            messages = messages,
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
        )
        FilesPanel(
            files = files,
            onFileClick = onFileClick,
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
        )
    }
}

/**
 * Displays agent metrics in themed cards: created date, session duration,
 * update count, message counts, workspace, PID, and status.
 */
@Composable
private fun AgentMetricsPanel(
    agent: Agent?,
    messages: List<com.claudemanager.app.data.models.AgentMessage>,
    modifier: Modifier = Modifier
) {
    if (agent == null) {
        Box(
            modifier = modifier,
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = "No agent data",
                style = MaterialTheme.typography.bodyLarge,
                color = LumiOnSurfaceTertiary
            )
        }
        return
    }

    val pendingCount = messages.count { it.status == MessageStatus.PENDING }
    val deliveredCount = messages.count { it.status == MessageStatus.DELIVERED }
    val acknowledgedCount = messages.count { it.status == MessageStatus.ACKNOWLEDGED || it.status == MessageStatus.EXECUTED }
    val totalMessages = messages.size

    val sessionDuration = TimeUtils.durationBetween(agent.createdAt, agent.lastUpdateAt)
    val durationText = if (sessionDuration != null) TimeUtils.formatDuration(sessionDuration) else "N/A"

    Column(
        modifier = modifier
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text(
            text = "Agent Metrics",
            style = MaterialTheme.typography.titleSmall,
            color = LumiOnSurfaceSecondary
        )

        // Created date
        MetricCard(label = "Created", value = TimeUtils.formatFull(agent.createdAt))

        // Session duration
        MetricCard(label = "Session Duration", value = durationText)

        // Total updates
        MetricCard(label = "Total Updates", value = agent.updateCount.toString())

        // Messages breakdown
        MetricCard(
            label = "Messages",
            value = "$totalMessages total ($pendingCount pending, $deliveredCount delivered, $acknowledgedCount ack'd)"
        )

        // Workspace / CWD
        if (!agent.workspace.isNullOrBlank() || !agent.cwd.isNullOrBlank()) {
            MetricCard(
                label = "Workspace",
                value = agent.workspace ?: agent.cwd ?: ""
            )
        }

        // PID
        if (agent.pid != null) {
            MetricCard(label = "PID", value = agent.pid.toString())
        }

        // Current status
        MetricCard(label = "Status", value = agent.status.displayName)
    }
}

/**
 * A single metric row rendered as a themed card.
 */
@Composable
private fun MetricCard(label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(LumiCard)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Top
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            color = LumiOnSurfaceSecondary,
            modifier = Modifier.width(120.dp)
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodyMedium,
            color = LumiOnSurface,
            modifier = Modifier.weight(1f)
        )
    }
}

/**
 * ViewModelProvider.Factory for [AgentDetailViewModel] that injects the agentId.
 */
class AgentDetailViewModelFactory(
    private val application: android.app.Application,
    private val agentId: String
) : androidx.lifecycle.ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : androidx.lifecycle.ViewModel> create(modelClass: Class<T>): T {
        return AgentDetailViewModel(application, agentId) as T
    }
}
