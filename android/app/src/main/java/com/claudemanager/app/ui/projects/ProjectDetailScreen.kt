package com.claudemanager.app.ui.projects

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
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
import com.claudemanager.app.data.models.Project
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
    viewModel: ProjectDetailViewModel = viewModel()
) {
    val state by viewModel.uiState.collectAsState()
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
                    Box {
                        IconButton(onClick = { showMenu = true }) {
                            Icon(
                                imageVector = Icons.Default.MoreVert,
                                contentDescription = "More",
                                tint = LumiOnSurfaceSecondary
                            )
                        }
                        DropdownMenu(
                            expanded = showMenu,
                            onDismissRequest = { showMenu = false }
                        ) {
                            DropdownMenuItem(
                                text = { Text("Delete", color = LumiError) },
                                leadingIcon = {
                                    Icon(
                                        Icons.Default.Delete,
                                        contentDescription = null,
                                        tint = LumiError
                                    )
                                },
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
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .padding(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                // Header card
                state.project?.let { project ->
                    item {
                        ProjectHeaderCard(project = project)
                    }

                    // Initial prompt input for starting projects
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

                    // Action buttons
                    item {
                        ProjectActionButtons(
                            status = project.status,
                            onStart = { viewModel.startProject(state.initialPrompt) },
                            onPause = viewModel::pauseProject,
                            onComplete = viewModel::completeProject
                        )
                    }
                }

                // Agent roster
                if (state.agents.isNotEmpty()) {
                    item {
                        Text(
                            text = "Agents",
                            style = MaterialTheme.typography.titleSmall,
                            color = LumiOnSurfaceSecondary,
                            modifier = Modifier.padding(top = 4.dp)
                        )
                    }
                    item {
                        AgentRoster(agents = state.agents)
                    }
                }

                // Project timeline
                if (state.updates.isNotEmpty()) {
                    item {
                        Text(
                            text = "Timeline",
                            style = MaterialTheme.typography.titleSmall,
                            color = LumiOnSurfaceSecondary,
                            modifier = Modifier.padding(top = 4.dp)
                        )
                    }
                    items(state.updates, key = { it.id }) { update ->
                        TimelineEntry(update = update)
                    }
                }

                // Bottom spacer
                item { Spacer(modifier = Modifier.height(16.dp)) }
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
private fun AgentRoster(agents: List<Agent>) {
    LazyRow(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        contentPadding = PaddingValues(horizontal = 0.dp)
    ) {
        items(agents, key = { it.id }) { agent ->
            AgentChip(agent = agent)
        }
    }
}

/**
 * Individual agent chip in the roster.
 */
@Composable
private fun AgentChip(agent: Agent) {
    Card(
        colors = CardDefaults.cardColors(containerColor = LumiCard),
        shape = RoundedCornerShape(10.dp)
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
                Text(
                    text = agent.role ?: agent.title,
                    style = MaterialTheme.typography.labelMedium,
                    color = LumiOnSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = agent.status.displayName,
                    style = MaterialTheme.typography.labelSmall,
                    color = LumiOnSurfaceTertiary
                )
            }
        }
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
