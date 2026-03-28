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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CleaningServices
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.claudemanager.app.data.models.RetentionRunResult
import com.claudemanager.app.data.models.RetentionStatus
import com.claudemanager.app.ui.theme.LumiCard
import com.claudemanager.app.ui.theme.LumiError
import com.claudemanager.app.ui.theme.LumiOnSurface
import com.claudemanager.app.ui.theme.LumiOnSurfaceSecondary
import com.claudemanager.app.ui.theme.LumiOnSurfaceTertiary
import com.claudemanager.app.ui.theme.LumiPurple500
import com.claudemanager.app.ui.theme.LumiWarning
import com.claudemanager.app.util.TimeUtils

/**
 * Retention management tab for viewing and editing data retention settings.
 * Shows editable fields for days thresholds, switches for enabled/dry_run,
 * and a "Run Now" button with result display.
 */
@Composable
fun RetentionTab(
    retentionStatus: RetentionStatus?,
    isLoading: Boolean,
    error: String?,
    isRunning: Boolean,
    lastRunResult: RetentionRunResult?,
    editArchiveDays: String,
    editUpdateDays: String,
    editMessageDays: String,
    editEnabled: Boolean,
    editDryRun: Boolean,
    onArchiveDaysChanged: (String) -> Unit,
    onUpdateDaysChanged: (String) -> Unit,
    onMessageDaysChanged: (String) -> Unit,
    onEnabledChanged: (Boolean) -> Unit,
    onDryRunChanged: (Boolean) -> Unit,
    onSave: () -> Unit,
    onRunNow: () -> Unit,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier
) {
    when {
        isLoading && retentionStatus == null -> {
            Box(
                modifier = modifier,
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator(color = LumiPurple500)
            }
        }
        error != null && retentionStatus == null -> {
            Box(
                modifier = modifier,
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
        else -> {
            Column(
                modifier = modifier
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Text(
                    text = "Retention Settings",
                    style = MaterialTheme.typography.titleSmall,
                    color = LumiOnSurfaceSecondary
                )

                // Enabled switch
                SettingSwitchRow(
                    label = "Retention Enabled",
                    description = "Automatically clean up old data on schedule",
                    checked = editEnabled,
                    onCheckedChange = onEnabledChanged
                )

                // Dry run switch with warning
                SettingSwitchRow(
                    label = "Dry Run Mode",
                    description = "Preview what would be deleted without actually deleting",
                    checked = editDryRun,
                    onCheckedChange = onDryRunChanged
                )

                if (!editDryRun && editEnabled) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(LumiWarning.copy(alpha = 0.1f))
                            .padding(12.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Warning,
                            contentDescription = null,
                            tint = LumiWarning,
                            modifier = Modifier.padding(end = 8.dp)
                        )
                        Text(
                            text = "Retention is active with dry run disabled. Data will be permanently deleted.",
                            style = MaterialTheme.typography.bodySmall,
                            color = LumiWarning
                        )
                    }
                }

                Spacer(modifier = Modifier.height(4.dp))

                // Day fields
                Text(
                    text = "Thresholds",
                    style = MaterialTheme.typography.titleSmall,
                    color = LumiOnSurfaceSecondary
                )

                DaysField(
                    label = "Archive agents after (days)",
                    value = editArchiveDays,
                    onValueChange = onArchiveDaysChanged
                )

                DaysField(
                    label = "Delete updates after (days)",
                    value = editUpdateDays,
                    onValueChange = onUpdateDaysChanged
                )

                DaysField(
                    label = "Delete messages after (days)",
                    value = editMessageDays,
                    onValueChange = onMessageDaysChanged
                )

                // Save button
                Button(
                    onClick = onSave,
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = LumiPurple500)
                ) {
                    Text("Save Settings")
                }

                Spacer(modifier = Modifier.height(8.dp))

                // Run now section
                Text(
                    text = "Manual Run",
                    style = MaterialTheme.typography.titleSmall,
                    color = LumiOnSurfaceSecondary
                )

                OutlinedButton(
                    onClick = onRunNow,
                    enabled = !isRunning,
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = LumiPurple500)
                ) {
                    if (isRunning) {
                        CircularProgressIndicator(
                            modifier = Modifier
                                .padding(end = 8.dp)
                                .height(18.dp)
                                .width(18.dp),
                            color = LumiPurple500,
                            strokeWidth = 2.dp
                        )
                    } else {
                        Icon(
                            imageVector = Icons.Default.CleaningServices,
                            contentDescription = null,
                            modifier = Modifier.padding(end = 8.dp)
                        )
                    }
                    Text(if (isRunning) "Running..." else "Run Retention Now")
                }

                // Last run result
                lastRunResult?.let { result ->
                    Card(
                        colors = CardDefaults.cardColors(containerColor = LumiCard),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Text(
                                text = if (result.dryRun) "Dry Run Result" else "Run Result",
                                style = MaterialTheme.typography.titleSmall,
                                color = LumiOnSurface
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            RunStatRow("Agents deleted", result.stats.agentsDeleted)
                            RunStatRow("Updates deleted", result.stats.updatesDeleted)
                            RunStatRow("Messages deleted", result.stats.messagesDeleted)
                        }
                    }
                }

                // Last run info from server
                retentionStatus?.let { status ->
                    if (status.lastRunAt != null) {
                        Card(
                            colors = CardDefaults.cardColors(containerColor = LumiCard),
                            shape = RoundedCornerShape(12.dp)
                        ) {
                            Column(modifier = Modifier.padding(16.dp)) {
                                Text(
                                    text = "Last Run",
                                    style = MaterialTheme.typography.titleSmall,
                                    color = LumiOnSurface
                                )
                                Spacer(modifier = Modifier.height(4.dp))
                                Text(
                                    text = TimeUtils.timeAgo(status.lastRunAt),
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = LumiOnSurfaceSecondary
                                )
                                status.lastRunStats?.let { stats ->
                                    Spacer(modifier = Modifier.height(8.dp))
                                    RunStatRow("Agents deleted", stats.agentsDeleted)
                                    RunStatRow("Updates deleted", stats.updatesDeleted)
                                    RunStatRow("Messages deleted", stats.messagesDeleted)
                                }
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))
            }
        }
    }
}

/**
 * A row with label, description, and a switch toggle.
 */
@Composable
private fun SettingSwitchRow(
    label: String,
    description: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(LumiCard)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = label,
                style = MaterialTheme.typography.bodyMedium,
                color = LumiOnSurface
            )
            Text(
                text = description,
                style = MaterialTheme.typography.bodySmall,
                color = LumiOnSurfaceTertiary
            )
        }
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            colors = SwitchDefaults.colors(
                checkedThumbColor = LumiOnSurface,
                checkedTrackColor = LumiPurple500,
                uncheckedThumbColor = LumiOnSurfaceTertiary,
                uncheckedTrackColor = LumiCard
            )
        )
    }
}

/**
 * A number input field for day thresholds.
 */
@Composable
private fun DaysField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit
) {
    OutlinedTextField(
        value = value,
        onValueChange = { newVal ->
            // Only allow digits
            if (newVal.all { it.isDigit() } || newVal.isEmpty()) {
                onValueChange(newVal)
            }
        },
        label = { Text(label) },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
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
}

/**
 * A single row displaying a stat name and count from a retention run.
 */
@Composable
private fun RunStatRow(label: String, count: Int) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall,
            color = LumiOnSurfaceSecondary
        )
        Text(
            text = count.toString(),
            style = MaterialTheme.typography.bodySmall,
            color = LumiOnSurface
        )
    }
}
