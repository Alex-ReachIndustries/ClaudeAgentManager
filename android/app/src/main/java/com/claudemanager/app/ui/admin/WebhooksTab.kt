package com.claudemanager.app.ui.admin

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Webhook
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.claudemanager.app.data.models.WebhookEntry
import com.claudemanager.app.ui.theme.LumiCard
import com.claudemanager.app.ui.theme.LumiError
import com.claudemanager.app.ui.theme.LumiOnSurface
import com.claudemanager.app.ui.theme.LumiOnSurfaceSecondary
import com.claudemanager.app.ui.theme.LumiOnSurfaceTertiary
import com.claudemanager.app.ui.theme.LumiPurple500
import com.claudemanager.app.ui.theme.LumiSuccess
import com.claudemanager.app.ui.theme.LumiWarning

/** Known webhook event types available for selection. */
private val WEBHOOK_EVENTS = listOf(
    "agent.created",
    "agent.updated",
    "agent.deleted",
    "agent.status_changed",
    "update.created",
    "message.created",
    "message.delivered"
)

/**
 * Webhooks management tab showing the list of configured webhooks
 * with create, edit, delete, and test actions.
 */
@Composable
fun WebhooksTab(
    webhooks: List<WebhookEntry>,
    isLoading: Boolean,
    error: String?,
    onRefresh: () -> Unit,
    onCreate: (String, List<String>) -> Unit,
    onUpdate: (Int, String?, List<String>?, Boolean?) -> Unit,
    onDelete: (Int) -> Unit,
    onTest: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    var showCreateDialog by remember { mutableStateOf(false) }
    var editingWebhook by remember { mutableStateOf<WebhookEntry?>(null) }

    Box(modifier = modifier) {
        when {
            isLoading && webhooks.isEmpty() -> {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator(color = LumiPurple500)
                }
            }
            error != null && webhooks.isEmpty() -> {
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
            webhooks.isEmpty() -> {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(
                            imageVector = Icons.Default.Webhook,
                            contentDescription = null,
                            modifier = Modifier.size(48.dp),
                            tint = LumiOnSurfaceTertiary
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        Text(
                            text = "No webhooks configured",
                            style = MaterialTheme.typography.bodyLarge,
                            color = LumiOnSurfaceSecondary
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "Tap + to add a webhook",
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
                    items(webhooks, key = { it.id }) { webhook ->
                        WebhookCard(
                            webhook = webhook,
                            onEdit = { editingWebhook = webhook },
                            onDelete = { onDelete(webhook.id) },
                            onTest = { onTest(webhook.id) },
                            onToggleActive = { active ->
                                onUpdate(webhook.id, null, null, active)
                            }
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
            Icon(Icons.Default.Add, contentDescription = "Add Webhook")
        }
    }

    // Create dialog
    if (showCreateDialog) {
        WebhookFormDialog(
            title = "New Webhook",
            initialUrl = "",
            initialEvents = emptyList(),
            onDismiss = { showCreateDialog = false },
            onConfirm = { url, events ->
                showCreateDialog = false
                onCreate(url, events)
            }
        )
    }

    // Edit dialog
    editingWebhook?.let { webhook ->
        WebhookFormDialog(
            title = "Edit Webhook",
            initialUrl = webhook.url,
            initialEvents = webhook.events,
            onDismiss = { editingWebhook = null },
            onConfirm = { url, events ->
                editingWebhook = null
                onUpdate(webhook.id, url, events, null)
            }
        )
    }
}

/**
 * A single webhook card with URL, events, status, and actions.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun WebhookCard(
    webhook: WebhookEntry,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    onTest: () -> Unit,
    onToggleActive: (Boolean) -> Unit
) {
    var showDeleteConfirm by remember { mutableStateOf(false) }

    Card(
        colors = CardDefaults.cardColors(containerColor = LumiCard),
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            // URL row with active indicator
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth()
            ) {
                Box(
                    modifier = Modifier
                        .size(10.dp)
                        .clip(CircleShape)
                        .background(if (webhook.active) LumiSuccess else LumiOnSurfaceTertiary)
                )
                Spacer(modifier = Modifier.width(10.dp))
                Text(
                    text = webhook.url,
                    style = MaterialTheme.typography.bodyMedium,
                    color = LumiOnSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )
            }

            Spacer(modifier = Modifier.height(8.dp))

            // Event chips
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                webhook.events.forEach { event ->
                    AssistChip(
                        onClick = { },
                        label = {
                            Text(
                                text = event,
                                style = MaterialTheme.typography.labelSmall
                            )
                        },
                        colors = AssistChipDefaults.assistChipColors(
                            containerColor = LumiPurple500.copy(alpha = 0.15f),
                            labelColor = LumiPurple500
                        ),
                        border = null
                    )
                }
            }

            // Failure count warning
            if (webhook.failureCount > 0) {
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = "${webhook.failureCount} failures",
                    style = MaterialTheme.typography.labelSmall,
                    color = if (webhook.failureCount >= 5) LumiError else LumiWarning
                )
            }

            Spacer(modifier = Modifier.height(8.dp))

            // Action buttons row
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Toggle active
                TextButton(onClick = { onToggleActive(!webhook.active) }) {
                    Text(
                        text = if (webhook.active) "Disable" else "Enable",
                        style = MaterialTheme.typography.labelMedium,
                        color = if (webhook.active) LumiOnSurfaceTertiary else LumiSuccess
                    )
                }

                IconButton(onClick = onTest) {
                    Icon(
                        imageVector = Icons.Default.Send,
                        contentDescription = "Test",
                        tint = LumiOnSurfaceSecondary,
                        modifier = Modifier.size(18.dp)
                    )
                }

                IconButton(onClick = onEdit) {
                    Icon(
                        imageVector = Icons.Default.Edit,
                        contentDescription = "Edit",
                        tint = LumiOnSurfaceSecondary,
                        modifier = Modifier.size(18.dp)
                    )
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
            title = { Text("Delete Webhook?") },
            text = { Text("This webhook will stop receiving event notifications.") },
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
 * Dialog for creating or editing a webhook.
 * Shows a URL text field and event type checkboxes.
 */
@Composable
private fun WebhookFormDialog(
    title: String,
    initialUrl: String,
    initialEvents: List<String>,
    onDismiss: () -> Unit,
    onConfirm: (String, List<String>) -> Unit
) {
    var url by remember { mutableStateOf(initialUrl) }
    val selectedEvents = remember { mutableStateListOf<String>().apply { addAll(initialEvents) } }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column {
                OutlinedTextField(
                    value = url,
                    onValueChange = { url = it },
                    label = { Text("Webhook URL") },
                    placeholder = { Text("https://example.com/webhook") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = LumiPurple500,
                        unfocusedBorderColor = LumiOnSurfaceTertiary.copy(alpha = 0.4f),
                        cursorColor = LumiPurple500,
                        focusedTextColor = LumiOnSurface,
                        unfocusedTextColor = LumiOnSurface,
                        focusedLabelColor = LumiPurple500,
                        unfocusedLabelColor = LumiOnSurfaceTertiary
                    )
                )

                Spacer(modifier = Modifier.height(16.dp))

                Text(
                    text = "Events",
                    style = MaterialTheme.typography.labelLarge,
                    color = LumiOnSurfaceSecondary
                )
                Spacer(modifier = Modifier.height(8.dp))

                WEBHOOK_EVENTS.forEach { event ->
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Checkbox(
                            checked = event in selectedEvents,
                            onCheckedChange = { checked ->
                                if (checked) selectedEvents.add(event)
                                else selectedEvents.remove(event)
                            },
                            colors = CheckboxDefaults.colors(
                                checkedColor = LumiPurple500,
                                uncheckedColor = LumiOnSurfaceTertiary
                            )
                        )
                        Text(
                            text = event,
                            style = MaterialTheme.typography.bodyMedium,
                            color = LumiOnSurface
                        )
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onConfirm(url, selectedEvents.toList()) },
                enabled = url.isNotBlank() && selectedEvents.isNotEmpty()
            ) {
                Text("Save", color = LumiPurple500)
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
