package com.claudemanager.app.ui.admin

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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AccountTree
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.claudemanager.app.data.models.Workflow
import com.claudemanager.app.data.models.WorkflowStep
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
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken

/**
 * Workflows management tab showing a list of workflows with status,
 * progress, and quick actions.
 */
@Composable
fun WorkflowsTab(
    workflows: List<Workflow>,
    isLoading: Boolean,
    error: String?,
    onRefresh: () -> Unit,
    onCreate: (String, List<WorkflowStep>) -> Unit,
    onWorkflowClick: (String) -> Unit,
    onStart: (String) -> Unit,
    onPause: (String) -> Unit,
    onDelete: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    var showCreateDialog by remember { mutableStateOf(false) }

    Box(modifier = modifier) {
        when {
            isLoading && workflows.isEmpty() -> {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator(color = LumiPurple500)
                }
            }
            error != null && workflows.isEmpty() -> {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            text = error,
                            style = MaterialTheme.typography.bodyLarge,
                            color = LumiError
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        Button(
                            onClick = onRefresh,
                            colors = ButtonDefaults.buttonColors(containerColor = LumiPurple500)
                        ) {
                            Text("Retry")
                        }
                    }
                }
            }
            workflows.isEmpty() -> {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(
                            imageVector = Icons.Default.AccountTree,
                            contentDescription = null,
                            modifier = Modifier.size(48.dp),
                            tint = LumiOnSurfaceTertiary
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        Text(
                            text = "No workflows",
                            style = MaterialTheme.typography.bodyLarge,
                            color = LumiOnSurfaceSecondary
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "Tap + to create a workflow",
                            style = MaterialTheme.typography.bodyMedium,
                            color = LumiOnSurfaceTertiary
                        )
                    }
                }
            }
            else -> {
                LazyColumn(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(horizontal = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    item { Spacer(modifier = Modifier.height(8.dp)) }
                    items(workflows, key = { it.id }) { workflow ->
                        WorkflowCard(
                            workflow = workflow,
                            onClick = { onWorkflowClick(workflow.id) },
                            onStart = { onStart(workflow.id) },
                            onPause = { onPause(workflow.id) },
                            onDelete = { onDelete(workflow.id) }
                        )
                    }
                    item { Spacer(modifier = Modifier.height(80.dp)) }
                }
            }
        }

        // FAB
        FloatingActionButton(
            onClick = { showCreateDialog = true },
            containerColor = LumiPurple500,
            contentColor = LumiOnSurface,
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(16.dp)
        ) {
            Icon(Icons.Default.Add, contentDescription = "Create Workflow")
        }
    }

    // Create dialog
    if (showCreateDialog) {
        CreateWorkflowDialog(
            onDismiss = { showCreateDialog = false },
            onCreate = { name, steps ->
                showCreateDialog = false
                onCreate(name, steps)
            }
        )
    }
}

/**
 * A single workflow card showing name, status, step progress, and action buttons.
 */
@Composable
private fun WorkflowCard(
    workflow: Workflow,
    onClick: () -> Unit,
    onStart: () -> Unit,
    onPause: () -> Unit,
    onDelete: () -> Unit
) {
    var showDeleteConfirm by remember { mutableStateOf(false) }
    val stepCount = parseStepCount(workflow.steps)
    val progress = if (stepCount > 0) workflow.currentStep.toFloat() / stepCount else 0f

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = LumiCard),
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            // Name and status
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(
                    text = workflow.name,
                    style = MaterialTheme.typography.titleMedium,
                    color = LumiOnSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )
                Spacer(modifier = Modifier.width(8.dp))
                WorkflowStatusChip(status = workflow.status)
            }

            Spacer(modifier = Modifier.height(8.dp))

            // Step progress
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth()
            ) {
                LinearProgressIndicator(
                    progress = { progress },
                    modifier = Modifier
                        .weight(1f)
                        .height(6.dp)
                        .clip(RoundedCornerShape(3.dp)),
                    color = workflowStatusColor(workflow.status),
                    trackColor = LumiCard
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "Step ${workflow.currentStep}/$stepCount",
                    style = MaterialTheme.typography.labelSmall,
                    color = LumiOnSurfaceSecondary
                )
            }

            // Created time
            workflow.createdAt?.let {
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "Created ${TimeUtils.timeAgo(it)}",
                    style = MaterialTheme.typography.labelSmall,
                    color = LumiOnSurfaceTertiary
                )
            }

            Spacer(modifier = Modifier.height(8.dp))

            // Action buttons
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End
            ) {
                when (workflow.status) {
                    "pending", "paused" -> {
                        IconButton(onClick = onStart) {
                            Icon(
                                imageVector = Icons.Default.PlayArrow,
                                contentDescription = "Start",
                                tint = LumiSuccess
                            )
                        }
                    }
                    "running" -> {
                        IconButton(onClick = onPause) {
                            Icon(
                                imageVector = Icons.Default.Pause,
                                contentDescription = "Pause",
                                tint = LumiWarning
                            )
                        }
                    }
                }
                IconButton(onClick = { showDeleteConfirm = true }) {
                    Icon(
                        imageVector = Icons.Default.Delete,
                        contentDescription = "Delete",
                        tint = LumiError,
                        modifier = Modifier.size(18.dp)
                    )
                }
            }
        }
    }

    // Delete confirmation
    if (showDeleteConfirm) {
        AlertDialog(
            onDismissRequest = { showDeleteConfirm = false },
            title = { Text("Delete Workflow?") },
            text = { Text("This will permanently delete the workflow and its state.") },
            confirmButton = {
                TextButton(onClick = {
                    showDeleteConfirm = false
                    onDelete()
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
 * Status chip for a workflow.
 */
@Composable
private fun WorkflowStatusChip(status: String) {
    val color = workflowStatusColor(status)
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(10.dp))
            .background(color.copy(alpha = 0.15f))
            .padding(horizontal = 8.dp, vertical = 3.dp)
    ) {
        Text(
            text = status.replaceFirstChar { it.uppercase() },
            style = MaterialTheme.typography.labelSmall,
            color = color
        )
    }
}

/**
 * Returns the display color for a workflow status string.
 */
internal fun workflowStatusColor(status: String): androidx.compose.ui.graphics.Color = when (status) {
    "running" -> LumiInfo
    "completed" -> LumiSuccess
    "paused" -> LumiWarning
    "failed" -> LumiError
    else -> LumiOnSurfaceTertiary // pending, unknown
}

/**
 * Parse the step count from a workflow's JSON steps string.
 */
private fun parseStepCount(stepsJson: String): Int {
    return try {
        val type = object : TypeToken<List<Map<String, Any>>>() {}.type
        val list: List<Map<String, Any>> = Gson().fromJson(stepsJson, type)
        list.size
    } catch (_: Exception) {
        0
    }
}

/**
 * Simple dialog for creating a new workflow with a name and a single step.
 * For simplicity, this creates a minimal workflow; the full step editor
 * would be a more complex form in a production app.
 */
@Composable
private fun CreateWorkflowDialog(
    onDismiss: () -> Unit,
    onCreate: (String, List<WorkflowStep>) -> Unit
) {
    var name by remember { mutableStateOf("") }
    var stepName by remember { mutableStateOf("") }
    var folderPath by remember { mutableStateOf("") }
    var prompt by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("New Workflow") },
        text = {
            Column {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Workflow Name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    colors = adminTextFieldColors()
                )

                Spacer(modifier = Modifier.height(12.dp))

                Text(
                    text = "First Step",
                    style = MaterialTheme.typography.labelLarge,
                    color = LumiOnSurfaceSecondary
                )
                Spacer(modifier = Modifier.height(8.dp))

                OutlinedTextField(
                    value = stepName,
                    onValueChange = { stepName = it },
                    label = { Text("Step Name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    colors = adminTextFieldColors()
                )

                Spacer(modifier = Modifier.height(8.dp))

                OutlinedTextField(
                    value = folderPath,
                    onValueChange = { folderPath = it },
                    label = { Text("Folder Path") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    colors = adminTextFieldColors()
                )

                Spacer(modifier = Modifier.height(8.dp))

                OutlinedTextField(
                    value = prompt,
                    onValueChange = { prompt = it },
                    label = { Text("Prompt") },
                    minLines = 2,
                    maxLines = 4,
                    modifier = Modifier.fillMaxWidth(),
                    colors = adminTextFieldColors()
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    val steps = listOf(
                        WorkflowStep(
                            name = stepName,
                            folderPath = folderPath,
                            prompt = prompt
                        )
                    )
                    onCreate(name, steps)
                },
                enabled = name.isNotBlank() && stepName.isNotBlank() && folderPath.isNotBlank() && prompt.isNotBlank()
            ) {
                Text("Create", color = LumiPurple500)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        },
        containerColor = LumiCard,
        titleContentColor = LumiOnSurface,
        textContentColor = LumiOnSurfaceSecondary
    )
}

/**
 * Shared text field colors for admin dialogs.
 */
@Composable
internal fun adminTextFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = LumiPurple500,
    unfocusedBorderColor = LumiOnSurfaceTertiary.copy(alpha = 0.4f),
    cursorColor = LumiPurple500,
    focusedTextColor = LumiOnSurface,
    unfocusedTextColor = LumiOnSurface,
    focusedLabelColor = LumiPurple500,
    unfocusedLabelColor = LumiOnSurfaceTertiary
)
