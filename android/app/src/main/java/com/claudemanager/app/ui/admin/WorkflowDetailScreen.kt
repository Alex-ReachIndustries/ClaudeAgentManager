package com.claudemanager.app.ui.admin

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.HourglassEmpty
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
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
import com.claudemanager.app.data.models.WorkflowStep
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
import com.claudemanager.app.util.TimeUtils

/**
 * Detailed view of a single workflow, showing its header, step list,
 * and actions (start, pause, delete).
 *
 * @param workflowId The workflow to display.
 * @param onBack Callback to navigate back.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WorkflowDetailScreen(
    workflowId: String,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val app = context.applicationContext as ClaudeManagerApp

    val viewModel = remember(workflowId) {
        WorkflowDetailViewModelFactory(app, workflowId).create(WorkflowDetailViewModel::class.java)
    }

    val state by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    var showOverflowMenu by remember { mutableStateOf(false) }
    var showDeleteConfirm by remember { mutableStateOf(false) }

    // Show snackbar messages
    LaunchedEffect(state.snackbarMessage) {
        state.snackbarMessage?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearSnackbar()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            text = state.workflow?.name ?: "Workflow",
                            style = MaterialTheme.typography.titleMedium,
                            color = LumiOnSurface,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        state.workflow?.let { wf ->
                            Text(
                                text = wf.status.replaceFirstChar { it.uppercase() },
                                style = MaterialTheme.typography.bodySmall,
                                color = workflowStatusColor(wf.status)
                            )
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
                            val wf = state.workflow
                            if (wf != null) {
                                when (wf.status) {
                                    "pending", "paused" -> {
                                        DropdownMenuItem(
                                            text = { Text("Start") },
                                            leadingIcon = {
                                                Icon(Icons.Default.PlayArrow, contentDescription = null)
                                            },
                                            onClick = {
                                                showOverflowMenu = false
                                                viewModel.startWorkflow()
                                            }
                                        )
                                    }
                                    "running" -> {
                                        DropdownMenuItem(
                                            text = { Text("Pause") },
                                            leadingIcon = {
                                                Icon(Icons.Default.Pause, contentDescription = null)
                                            },
                                            onClick = {
                                                showOverflowMenu = false
                                                viewModel.pauseWorkflow()
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
        if (state.isLoading && state.workflow == null) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator(color = LumiPurple500)
            }
        } else if (state.error != null && state.workflow == null) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = state.error!!,
                    style = MaterialTheme.typography.bodyLarge,
                    color = LumiError
                )
            }
        } else {
            val workflow = state.workflow ?: return@Scaffold
            val steps = state.parsedSteps

            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .padding(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(0.dp)
            ) {
                // Header card
                item {
                    Spacer(modifier = Modifier.height(12.dp))
                    WorkflowHeaderCard(workflow, steps.size)
                    Spacer(modifier = Modifier.height(16.dp))
                }

                // Section title
                item {
                    Text(
                        text = "Steps",
                        style = MaterialTheme.typography.titleSmall,
                        color = LumiOnSurfaceSecondary,
                        modifier = Modifier.padding(bottom = 8.dp)
                    )
                }

                // Step list with vertical connector
                itemsIndexed(steps) { index, step ->
                    StepItem(
                        step = step,
                        index = index,
                        isCurrentStep = index == workflow.currentStep,
                        isLast = index == steps.size - 1
                    )
                }

                item { Spacer(modifier = Modifier.height(32.dp)) }
            }
        }
    }

    // Delete confirmation dialog
    if (showDeleteConfirm) {
        AlertDialog(
            onDismissRequest = { showDeleteConfirm = false },
            title = { Text("Delete Workflow?") },
            text = { Text("This will permanently delete the workflow and its state.") },
            confirmButton = {
                TextButton(onClick = {
                    showDeleteConfirm = false
                    viewModel.deleteWorkflow(onDeleted = onBack)
                }) {
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
 * Header card showing workflow metadata and progress.
 */
@Composable
private fun WorkflowHeaderCard(
    workflow: com.claudemanager.app.data.models.Workflow,
    totalSteps: Int
) {
    val progress = if (totalSteps > 0) workflow.currentStep.toFloat() / totalSteps else 0f

    Card(
        colors = CardDefaults.cardColors(containerColor = LumiCard),
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            // Status and progress
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "Progress",
                    style = MaterialTheme.typography.bodyMedium,
                    color = LumiOnSurfaceSecondary
                )
                Text(
                    text = "${workflow.currentStep}/$totalSteps steps",
                    style = MaterialTheme.typography.labelMedium,
                    color = LumiOnSurface
                )
            }
            Spacer(modifier = Modifier.height(8.dp))
            LinearProgressIndicator(
                progress = { progress },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(8.dp)
                    .clip(RoundedCornerShape(4.dp)),
                color = workflowStatusColor(workflow.status),
                trackColor = LumiBackground
            )

            Spacer(modifier = Modifier.height(12.dp))

            // Dates
            WorkflowMetaRow("Created", workflow.createdAt?.let { TimeUtils.formatFull(it) } ?: "N/A")
            workflow.startedAt?.let {
                WorkflowMetaRow("Started", TimeUtils.formatFull(it))
            }
            workflow.completedAt?.let {
                WorkflowMetaRow("Completed", TimeUtils.formatFull(it))
            }
        }
    }
}

@Composable
private fun WorkflowMetaRow(label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 2.dp),
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
            color = LumiOnSurface
        )
    }
}

/**
 * A single step in the vertical step list with connector line.
 */
@Composable
private fun StepItem(
    step: WorkflowStep,
    index: Int,
    isCurrentStep: Boolean,
    isLast: Boolean
) {
    val statusColor = stepStatusColor(step.status)
    val connectorColor = LumiOnSurfaceTertiary.copy(alpha = 0.3f)

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 8.dp),
        verticalAlignment = Alignment.Top
    ) {
        // Icon column with connector line
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.width(32.dp)
        ) {
            Icon(
                imageVector = stepStatusIcon(step.status),
                contentDescription = step.status,
                tint = statusColor,
                modifier = Modifier.size(24.dp)
            )
            if (!isLast) {
                Box(
                    modifier = Modifier
                        .width(2.dp)
                        .height(40.dp)
                        .background(connectorColor)
                )
            }
        }

        Spacer(modifier = Modifier.width(12.dp))

        // Step content
        Card(
            colors = CardDefaults.cardColors(
                containerColor = if (isCurrentStep) LumiPurple500.copy(alpha = 0.1f) else LumiCard
            ),
            shape = RoundedCornerShape(8.dp),
            modifier = Modifier
                .weight(1f)
                .padding(bottom = if (isLast) 0.dp else 8.dp)
        ) {
            Column(modifier = Modifier.padding(12.dp)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        text = step.name,
                        style = MaterialTheme.typography.bodyMedium,
                        color = LumiOnSurface,
                        modifier = Modifier.weight(1f)
                    )
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(statusColor.copy(alpha = 0.15f))
                            .padding(horizontal = 6.dp, vertical = 2.dp)
                    ) {
                        Text(
                            text = step.status.replaceFirstChar { it.uppercase() },
                            style = MaterialTheme.typography.labelSmall,
                            color = statusColor
                        )
                    }
                }

                if (step.agentId != null) {
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "Agent: ${step.agentId}",
                        style = MaterialTheme.typography.labelSmall,
                        color = LumiOnSurfaceTertiary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }

                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = step.prompt,
                    style = MaterialTheme.typography.bodySmall,
                    color = LumiOnSurfaceSecondary,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}

private fun stepStatusIcon(status: String) = when (status) {
    "completed" -> Icons.Default.CheckCircle
    "running" -> Icons.Default.HourglassEmpty
    "failed" -> Icons.Default.Error
    else -> Icons.Default.RadioButtonUnchecked
}

private fun stepStatusColor(status: String) = when (status) {
    "completed" -> LumiSuccess
    "running" -> LumiInfo
    "failed" -> LumiError
    "skipped" -> LumiOnSurfaceTertiary
    else -> LumiOnSurfaceTertiary // pending
}
