package com.claudemanager.app.ui.projects

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Update
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
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
import androidx.lifecycle.viewmodel.compose.viewModel
import com.claudemanager.app.data.models.Agent
import com.claudemanager.app.data.models.AgentMessage
import com.claudemanager.app.data.models.Project
import com.claudemanager.app.data.models.ProjectFile
import com.claudemanager.app.data.models.ProjectUpdate
import com.claudemanager.app.ui.theme.LumiBackground
import com.claudemanager.app.ui.theme.LumiCard
import com.claudemanager.app.ui.theme.LumiError
import com.claudemanager.app.ui.theme.LumiInfo
import com.claudemanager.app.ui.theme.LumiOnSurface
import com.claudemanager.app.ui.theme.LumiOnSurfaceSecondary
import com.claudemanager.app.ui.theme.LumiOnSurfaceTertiary
import com.claudemanager.app.ui.theme.LumiPurple500
import com.claudemanager.app.ui.theme.LumiSuccess
import com.claudemanager.app.ui.theme.LumiWarning
import com.claudemanager.app.ui.theme.agentStatusColor
import com.claudemanager.app.util.TimeUtils

/**
 * Project detail screen showing project info, agent roster, timeline, and actions.
 *
 * @param projectId The project ID to display.
 * @param onBack Callback to navigate back.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProjectDetailScreen(
    projectId: String,
    onBack: () -> Unit,
    onNavigateToAgent: (String) -> Unit = {},
    viewModel: ProjectDetailViewModel = viewModel()
) {
    val state by viewModel.uiState.collectAsState()
    val context = LocalContext.current
    val snackbarHostState = remember { SnackbarHostState() }
    var showMenu by remember { mutableStateOf(false) }

    // Initialize with project ID
    LaunchedEffect(projectId) {
        viewModel.init(projectId)
    }

    // Handle deletion navigation
    LaunchedEffect(state.isDeleted) {
        if (state.isDeleted) onBack()
    }

    // Show action messages
    LaunchedEffect(state.actionMessage) {
        state.actionMessage?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearActionMessage()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = state.project?.name ?: "Project",
                        style = MaterialTheme.typography.titleLarge,
                        color = LumiOnSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
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
                    val projectStatus = state.project?.status?.lowercase() ?: ""

                    // Start button
                    if (projectStatus in listOf("pending", "created", "paused")) {
                        IconButton(onClick = { viewModel.startProject(state.initialPrompt) }) {
                            Icon(Icons.Default.PlayArrow, "Start", tint = LumiSuccess)
                        }
                    }
                    // Pause button
                    if (projectStatus in listOf("active", "running")) {
                        IconButton(onClick = { viewModel.pauseProject() }) {
                            Icon(Icons.Default.Pause, "Pause", tint = LumiWarning)
                        }
                    }
                    // Complete button
                    if (projectStatus in listOf("active", "running")) {
                        IconButton(onClick = { viewModel.completeProject() }) {
                            Icon(Icons.Default.CheckCircle, "Complete", tint = LumiInfo)
                        }
                    }

                    // More menu (delete)
                    Box {
                        IconButton(onClick = { showMenu = true }) {
                            Icon(Icons.Default.MoreVert, "More", tint = LumiOnSurfaceSecondary)
                        }
                        DropdownMenu(
                            expanded = showMenu,
                            onDismissRequest = { showMenu = false }
                        ) {
                            DropdownMenuItem(
                                text = { Text("Delete", color = LumiError) },
                                leadingIcon = { Icon(Icons.Default.Delete, null, tint = LumiError) },
                                onClick = {
                                    showMenu = false
                                    viewModel.deleteProject()
                                }
                            )
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
        if (state.isLoading && state.project == null) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator(color = LumiPurple500)
            }
        } else if (state.error != null && state.project == null) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = state.error!!,
                    color = LumiError,
                    style = MaterialTheme.typography.bodyLarge
                )
            }
        } else {
            val tabTitles = listOf("Info", "Agents", "Messages", "Timeline", "Files")
            var selectedTab by remember { mutableStateOf(0) }

            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
            ) {
                // Tab row
                androidx.compose.material3.ScrollableTabRow(
                    selectedTabIndex = selectedTab,
                    containerColor = LumiBackground,
                    contentColor = LumiPurple500,
                    edgePadding = 16.dp,
                    divider = {}
                ) {
                    tabTitles.forEachIndexed { index, title ->
                        val count = when (index) {
                            1 -> state.agents.size
                            3 -> state.updates.size
                            4 -> state.files.size
                            else -> 0
                        }
                        androidx.compose.material3.Tab(
                            selected = selectedTab == index,
                            onClick = { selectedTab = index },
                            text = {
                                Text(
                                    text = if (count > 0) "$title ($count)" else title,
                                    style = MaterialTheme.typography.labelMedium
                                )
                            },
                            selectedContentColor = LumiPurple500,
                            unselectedContentColor = LumiOnSurfaceTertiary
                        )
                    }
                }

                // Tab content
                when (selectedTab) {
                    // ── Info tab ──
                    0 -> {
                        LazyColumn(
                            modifier = Modifier
                                .fillMaxSize()
                                .padding(horizontal = 16.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp),
                            contentPadding = PaddingValues(vertical = 12.dp)
                        ) {
                            state.project?.let { project ->
                                item { ProjectHeaderCard(project = project) }

                                if (project.status == "pending" || project.status == "paused") {
                                    item {
                                        OutlinedTextField(
                                            value = state.initialPrompt,
                                            onValueChange = viewModel::updateInitialPrompt,
                                            label = { Text("Initial Prompt for Project Manager") },
                                            placeholder = { Text("Describe the task...") },
                                            minLines = 3,
                                            maxLines = 6,
                                            modifier = Modifier.fillMaxWidth(),
                                            colors = OutlinedTextFieldDefaults.colors(
                                                focusedBorderColor = LumiPurple500,
                                                unfocusedBorderColor = LumiOnSurfaceTertiary.copy(alpha = 0.4f),
                                                cursorColor = LumiPurple500,
                                                focusedTextColor = LumiOnSurface,
                                                unfocusedTextColor = LumiOnSurface,
                                                focusedContainerColor = LumiCard,
                                                unfocusedContainerColor = LumiCard,
                                                focusedLabelColor = LumiPurple500,
                                                unfocusedLabelColor = LumiOnSurfaceTertiary
                                            )
                                        )
                                    }
                                }

                                // Project details card
                                item {
                                    Card(
                                        modifier = Modifier.fillMaxWidth(),
                                        colors = CardDefaults.cardColors(containerColor = LumiCard),
                                        shape = RoundedCornerShape(12.dp)
                                    ) {
                                        Column(modifier = Modifier.padding(16.dp)) {
                                            if (project.folderPath.isNotBlank()) {
                                                DetailRow("Path", project.folderPath)
                                            }
                                            DetailRow("Max Concurrent", "${project.maxConcurrent}")
                                            DetailRow("Agents", "${project.activeAgentCount ?: 0} active / ${project.totalAgentCount ?: 0} total")
                                            DetailRow("Files", "${state.files.size}")
                                            project.pmAgentId?.let {
                                                DetailRow("PM Agent", it.take(8) + "...")
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // ── Agents tab ──
                    1 -> {
                        LazyColumn(
                            modifier = Modifier
                                .fillMaxSize()
                                .padding(horizontal = 16.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                            contentPadding = PaddingValues(vertical = 12.dp)
                        ) {
                            if (state.agents.isEmpty()) {
                                item {
                                    Text(
                                        text = "No agents assigned yet.",
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = LumiOnSurfaceTertiary,
                                        modifier = Modifier.padding(vertical = 32.dp)
                                    )
                                }
                            } else {
                                items(state.agents, key = { it.id }) { agent ->
                                    AgentListCard(
                                        agent = agent,
                                        isPM = agent.id == state.project?.pmAgentId,
                                        onClick = { onNavigateToAgent(agent.id) },
                                        onMessage = {
                                            viewModel.selectAgent(agent.id)
                                            selectedTab = 2 // Switch to Messages tab
                                        }
                                    )
                                }
                            }
                        }
                    }

                    // ── Messages tab ──
                    2 -> {
                        CommunicationSection(
                            agents = state.agents,
                            pmAgentId = state.project?.pmAgentId,
                            selectedAgentId = state.selectedAgentId,
                            onSelectAgent = viewModel::selectAgent,
                            messages = state.agentMessages,
                            messageText = state.messageText,
                            onMessageTextChange = viewModel::updateMessageText,
                            isSending = state.isSendingMessage,
                            onSend = viewModel::sendMessage,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp)
                        )
                    }

                    // ── Timeline tab ──
                    3 -> {
                        LazyColumn(
                            modifier = Modifier
                                .fillMaxSize()
                                .padding(horizontal = 16.dp),
                            verticalArrangement = Arrangement.spacedBy(4.dp),
                            contentPadding = PaddingValues(vertical = 12.dp)
                        ) {
                            if (state.updates.isEmpty()) {
                                item {
                                    Text(
                                        text = "No updates yet.",
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = LumiOnSurfaceTertiary,
                                        modifier = Modifier.padding(vertical = 32.dp)
                                    )
                                }
                            } else {
                                items(state.updates, key = { it.id }) { update ->
                                    TimelineEntry(update = update)
                                }
                            }
                        }
                    }

                    // ── Files tab ──
                    4 -> {
                        LazyColumn(
                            modifier = Modifier
                                .fillMaxSize()
                                .padding(horizontal = 16.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                            contentPadding = PaddingValues(vertical = 12.dp)
                        ) {
                            if (state.files.isEmpty()) {
                                item {
                                    Text(
                                        text = "No files shared by agents yet.",
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = LumiOnSurfaceTertiary,
                                        modifier = Modifier.padding(vertical = 32.dp)
                                    )
                                }
                            } else {
                                items(state.files, key = { it.id }) { file ->
                                    FileCard(
                                        file = file,
                                        onDownload = { viewModel.downloadFile(file.agentId, file.id.toLong(), file.filename, context) }
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * Header card showing project name, status, description, and dates.
 */
@Composable
private fun ProjectHeaderCard(project: Project) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = LumiCard),
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            // Status and name
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(
                    text = project.name,
                    style = MaterialTheme.typography.titleLarge,
                    color = LumiOnSurface,
                    modifier = Modifier.weight(1f)
                )
                Spacer(modifier = Modifier.width(8.dp))
                ProjectStatusChip(status = project.status)
            }

            // Description
            if (project.description.isNotBlank()) {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = project.description,
                    style = MaterialTheme.typography.bodyMedium,
                    color = LumiOnSurfaceSecondary
                )
            }

            Spacer(modifier = Modifier.height(12.dp))

            // Metadata row
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                // Agent counts
                Column {
                    Text(
                        text = "Agents",
                        style = MaterialTheme.typography.labelSmall,
                        color = LumiOnSurfaceTertiary
                    )
                    Text(
                        text = "${project.activeAgentCount ?: 0} active / ${project.totalAgentCount ?: 0} total",
                        style = MaterialTheme.typography.bodySmall,
                        color = LumiOnSurface
                    )
                }
                // Max concurrent
                Column(horizontalAlignment = Alignment.End) {
                    Text(
                        text = "Max Concurrent",
                        style = MaterialTheme.typography.labelSmall,
                        color = LumiOnSurfaceTertiary
                    )
                    Text(
                        text = "${project.maxConcurrent}",
                        style = MaterialTheme.typography.bodySmall,
                        color = LumiOnSurface
                    )
                }
            }

            // Dates
            Spacer(modifier = Modifier.height(8.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                project.createdAt?.let {
                    DateLabel(label = "Created", dateString = it)
                }
                project.startedAt?.let {
                    DateLabel(label = "Started", dateString = it)
                }
                project.completedAt?.let {
                    DateLabel(label = "Completed", dateString = it)
                }
            }
        }
    }
}

/**
 * Small label + date text.
 */
@Composable
private fun DateLabel(label: String, dateString: String) {
    Column {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = LumiOnSurfaceTertiary
        )
        Text(
            text = TimeUtils.timeAgo(dateString),
            style = MaterialTheme.typography.bodySmall,
            color = LumiOnSurface
        )
    }
}

/**
 * Color-coded status chip for the project header.
 */
@Composable
private fun ProjectStatusChip(status: String) {
    val color = projectStatusColor(status)
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(10.dp))
            .background(color.copy(alpha = 0.2f))
            .padding(horizontal = 10.dp, vertical = 4.dp)
    ) {
        Text(
            text = status.replaceFirstChar { it.uppercase() },
            style = MaterialTheme.typography.labelMedium,
            color = color
        )
    }
}

/**
 * Returns the color associated with a project status string.
 */
private fun projectStatusColor(status: String): androidx.compose.ui.graphics.Color =
    when (status.lowercase()) {
        "active", "running" -> LumiSuccess
        "paused" -> LumiWarning
        "completed" -> LumiInfo
        "pending", "created" -> LumiOnSurfaceTertiary
        "failed" -> LumiError
        else -> LumiOnSurfaceTertiary
    }

/**
 * Action buttons: Start, Pause, Complete based on project status.
 */
@Composable
private fun ProjectActionButtons(
    status: String,
    onStart: () -> Unit,
    onPause: () -> Unit,
    onComplete: () -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        val normalizedStatus = status.lowercase()

        if (normalizedStatus in listOf("pending", "created", "paused")) {
            Button(
                onClick = onStart,
                colors = ButtonDefaults.buttonColors(
                    containerColor = LumiSuccess.copy(alpha = 0.2f),
                    contentColor = LumiSuccess
                ),
                modifier = Modifier.weight(1f)
            ) {
                Icon(
                    Icons.Default.PlayArrow,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp)
                )
                Spacer(modifier = Modifier.width(4.dp))
                Text("Start")
            }
        }

        if (normalizedStatus in listOf("active", "running")) {
            Button(
                onClick = onPause,
                colors = ButtonDefaults.buttonColors(
                    containerColor = LumiWarning.copy(alpha = 0.2f),
                    contentColor = LumiWarning
                ),
                modifier = Modifier.weight(1f)
            ) {
                Icon(
                    Icons.Default.Pause,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp)
                )
                Spacer(modifier = Modifier.width(4.dp))
                Text("Pause")
            }

            Button(
                onClick = onComplete,
                colors = ButtonDefaults.buttonColors(
                    containerColor = LumiInfo.copy(alpha = 0.2f),
                    contentColor = LumiInfo
                ),
                modifier = Modifier.weight(1f)
            ) {
                Icon(
                    Icons.Default.CheckCircle,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp)
                )
                Spacer(modifier = Modifier.width(4.dp))
                Text("Complete")
            }
        }
    }
}

/**
 * Horizontal LazyRow of agent chips with role and status.
 */
@Composable
private fun AgentRoster(
    agents: List<Agent>,
    pmAgentId: String?,
    selectedAgentId: String?,
    onAgentClick: (String) -> Unit,
    onMessageAgent: (String) -> Unit
) {
    LazyRow(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        contentPadding = PaddingValues(horizontal = 0.dp)
    ) {
        items(agents, key = { it.id }) { agent ->
            AgentChip(
                agent = agent,
                isPM = agent.id == pmAgentId,
                isSelected = agent.id == selectedAgentId,
                onClick = { onAgentClick(agent.id) },
                onMessage = { onMessageAgent(agent.id) }
            )
        }
    }
}

/**
 * Individual agent chip in the roster.
 */
@Composable
private fun AgentChip(
    agent: Agent,
    isPM: Boolean,
    isSelected: Boolean,
    onClick: () -> Unit,
    onMessage: () -> Unit
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Card(
            colors = CardDefaults.cardColors(containerColor = LumiCard),
            shape = RoundedCornerShape(10.dp),
            border = if (isSelected) {
                androidx.compose.foundation.BorderStroke(1.dp, LumiPurple500)
            } else null,
            modifier = Modifier.clickable(onClick = onClick)
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Status dot
                Box(
                    modifier = Modifier
                        .size(8.dp)
                        .clip(CircleShape)
                        .background(agentStatusColor(agent.status))
                )
                Spacer(modifier = Modifier.width(8.dp))
                Column {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = agent.role ?: agent.title,
                            style = MaterialTheme.typography.labelMedium,
                            color = LumiOnSurface,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        if (isPM) {
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(
                                text = "PM",
                                style = MaterialTheme.typography.labelSmall,
                                color = LumiPurple500
                            )
                        }
                    }
                    Text(
                        text = agent.status.displayName,
                        style = MaterialTheme.typography.labelSmall,
                        color = LumiOnSurfaceTertiary
                    )
                }
            }
        }
        // Message shortcut below chip
        Text(
            text = if (isSelected) "✓ Messaging" else "Message",
            style = MaterialTheme.typography.labelSmall,
            color = if (isSelected) LumiPurple500 else LumiOnSurfaceTertiary,
            modifier = Modifier
                .padding(top = 2.dp)
                .clickable(onClick = onMessage)
        )
    }
}

/**
 * Returns the icon for a timeline update type.
 */
private fun updateTypeIcon(type: String): ImageVector = when (type.lowercase()) {
    "info" -> Icons.Default.Info
    "error" -> Icons.Default.Error
    "warning" -> Icons.Default.Warning
    "success", "complete" -> Icons.Default.CheckCircle
    "agent" -> Icons.Default.Person
    "schedule", "started" -> Icons.Default.Schedule
    else -> Icons.Default.Update
}

/**
 * Returns the color for a timeline update type.
 */
private fun updateTypeColor(type: String): androidx.compose.ui.graphics.Color =
    when (type.lowercase()) {
        "info" -> LumiInfo
        "error" -> LumiError
        "warning" -> LumiWarning
        "success", "complete" -> LumiSuccess
        "agent" -> LumiPurple500
        else -> LumiOnSurfaceTertiary
    }

/**
 * Single entry in the project timeline.
 */
@Composable
private fun TimelineEntry(update: ProjectUpdate) {
    val icon = updateTypeIcon(update.type)
    val color = updateTypeColor(update.type)

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 2.dp),
        verticalAlignment = Alignment.Top
    ) {
        // Type icon
        Icon(
            imageVector = icon,
            contentDescription = update.type,
            tint = color,
            modifier = Modifier
                .size(20.dp)
                .padding(top = 2.dp)
        )
        Spacer(modifier = Modifier.width(10.dp))

        // Content
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = update.content,
                style = MaterialTheme.typography.bodyMedium,
                color = LumiOnSurface
            )
            Text(
                text = TimeUtils.timeAgo(update.timestamp),
                style = MaterialTheme.typography.labelSmall,
                color = LumiOnSurfaceTertiary
            )
        }
    }
}

/**
 * A row showing a label + value in the info tab.
 */
@Composable
private fun DetailRow(label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall,
            color = LumiOnSurfaceTertiary
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodySmall,
            color = LumiOnSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(start = 16.dp)
        )
    }
}

/**
 * Agent card for the Agents tab with navigation and message shortcuts.
 */
@Composable
private fun AgentListCard(
    agent: Agent,
    isPM: Boolean,
    onClick: () -> Unit,
    onMessage: () -> Unit
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = LumiCard),
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(10.dp)
                    .clip(CircleShape)
                    .background(agentStatusColor(agent.status))
            )
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = agent.role ?: agent.title,
                        style = MaterialTheme.typography.bodyMedium,
                        color = LumiOnSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    if (isPM) {
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = "PM",
                            style = MaterialTheme.typography.labelSmall,
                            color = LumiPurple500
                        )
                    }
                }
                Text(
                    text = agent.status.displayName,
                    style = MaterialTheme.typography.labelSmall,
                    color = LumiOnSurfaceTertiary
                )
            }
            IconButton(onClick = onMessage) {
                Icon(
                    imageVector = Icons.Default.Send,
                    contentDescription = "Message",
                    tint = LumiOnSurfaceTertiary,
                    modifier = Modifier.size(18.dp)
                )
            }
        }
    }
}

/**
 * File card for the Files tab.
 */
@Composable
private fun FileCard(file: ProjectFile, onDownload: () -> Unit = {}) {
    Card(
        colors = CardDefaults.cardColors(containerColor = LumiCard),
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth().clickable { onDownload() }
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = Icons.Default.Info,
                contentDescription = null,
                tint = LumiOnSurfaceTertiary,
                modifier = Modifier.size(20.dp)
            )
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = file.filename,
                    style = MaterialTheme.typography.bodyMedium,
                    color = LumiOnSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = file.agentRole ?: "Agent",
                        style = MaterialTheme.typography.labelSmall,
                        color = LumiOnSurfaceTertiary
                    )
                    Text(
                        text = "${file.size / 1024} KB",
                        style = MaterialTheme.typography.labelSmall,
                        color = LumiOnSurfaceTertiary
                    )
                    file.createdAt?.let {
                        Text(
                            text = TimeUtils.timeAgo(it),
                            style = MaterialTheme.typography.labelSmall,
                            color = LumiOnSurfaceTertiary
                        )
                    }
                }
                file.description?.let {
                    Text(
                        text = it,
                        style = MaterialTheme.typography.labelSmall,
                        color = LumiOnSurfaceTertiary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
        }
    }
}

/**
 * Communication section for messaging project agents.
 */
@Composable
private fun CommunicationSection(
    agents: List<Agent>,
    pmAgentId: String?,
    selectedAgentId: String?,
    onSelectAgent: (String?) -> Unit,
    messages: List<AgentMessage>,
    messageText: String,
    onMessageTextChange: (String) -> Unit,
    isSending: Boolean,
    onSend: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(modifier = modifier.fillMaxSize()) {

            // Agent selector chips
            LazyRow(
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                items(agents, key = { it.id }) { agent ->
                    val isSelected = agent.id == selectedAgentId
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(16.dp))
                            .background(
                                if (isSelected) LumiPurple500.copy(alpha = 0.2f)
                                else LumiBackground
                            )
                            .clickable { onSelectAgent(agent.id) }
                            .padding(horizontal = 12.dp, vertical = 6.dp)
                    ) {
                        Text(
                            text = buildString {
                                if (agent.id == pmAgentId) append("⭐ ")
                                append(agent.role ?: agent.title)
                            },
                            style = MaterialTheme.typography.labelSmall,
                            color = if (isSelected) LumiPurple500 else LumiOnSurfaceSecondary,
                            maxLines = 1
                        )
                    }
                }
            }

            if (selectedAgentId != null) {
                Spacer(modifier = Modifier.height(8.dp))

                // Message history
                val msgListState = rememberLazyListState()
                val recentMessages = messages.takeLast(20)

                LaunchedEffect(recentMessages.size) {
                    if (recentMessages.isNotEmpty()) {
                        msgListState.animateScrollToItem(recentMessages.lastIndex)
                    }
                }

                LazyColumn(
                    state = msgListState,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 250.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    if (recentMessages.isEmpty()) {
                        item {
                            Text(
                                text = "No messages yet.",
                                style = MaterialTheme.typography.bodySmall,
                                color = LumiOnSurfaceTertiary,
                                modifier = Modifier.padding(vertical = 16.dp)
                            )
                        }
                    } else {
                        items(recentMessages, key = { it.id }) { msg ->
                            MessageBubble(msg)
                        }
                    }
                }

                Spacer(modifier = Modifier.height(8.dp))

                // Message input
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedTextField(
                        value = messageText,
                        onValueChange = onMessageTextChange,
                        placeholder = { Text("Message agent...") },
                        maxLines = 3,
                        modifier = Modifier.weight(1f),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = LumiPurple500,
                            unfocusedBorderColor = LumiOnSurfaceTertiary.copy(alpha = 0.4f),
                            cursorColor = LumiPurple500,
                            focusedTextColor = LumiOnSurface,
                            unfocusedTextColor = LumiOnSurface,
                            focusedContainerColor = LumiBackground,
                            unfocusedContainerColor = LumiBackground
                        )
                    )
                    IconButton(
                        onClick = onSend,
                        enabled = !isSending && messageText.isNotBlank()
                    ) {
                        if (isSending) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                color = LumiPurple500,
                                strokeWidth = 2.dp
                            )
                        } else {
                            Icon(
                                imageVector = Icons.Default.Send,
                                contentDescription = "Send",
                                tint = if (messageText.isNotBlank()) LumiPurple500
                                else LumiOnSurfaceTertiary
                            )
                        }
                    }
                }
            } else {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "Select an agent above to send messages.",
                    style = MaterialTheme.typography.bodySmall,
                    color = LumiOnSurfaceTertiary
                )
            }
        }
    }

/**
 * A single message bubble in the conversation.
 */
@Composable
private fun MessageBubble(msg: AgentMessage) {
    val isUser = msg.source == "user"
    val isRelay = msg.sourceAgentId != null
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start
    ) {
        Box(
            modifier = Modifier
                .clip(RoundedCornerShape(12.dp))
                .background(
                    when {
                        isUser -> LumiPurple500.copy(alpha = 0.15f)
                        isRelay -> LumiInfo.copy(alpha = 0.15f)
                        else -> LumiBackground
                    }
                )
                .padding(horizontal = 12.dp, vertical = 8.dp)
                .fillMaxWidth(0.85f)
        ) {
            Column {
                Text(
                    text = msg.content,
                    style = MaterialTheme.typography.bodySmall,
                    color = LumiOnSurface
                )
                Spacer(modifier = Modifier.height(2.dp))
                Text(
                    text = buildString {
                        when {
                            isUser -> append("You")
                            isRelay -> append("Agent ${msg.sourceAgentId?.take(8)}")
                            else -> append("Agent")
                        }
                        append(" · ")
                        append(TimeUtils.timeAgo(msg.createdAt))
                        if (msg.status.displayName != "Executed") {
                            append(" · ")
                            append(msg.status.displayName.lowercase())
                        }
                    },
                    style = MaterialTheme.typography.labelSmall,
                    color = if (isRelay) LumiInfo else LumiOnSurfaceTertiary
                )
            }
        }
    }
}
