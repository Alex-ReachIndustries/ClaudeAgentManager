package com.claudemanager.app.ui.settings

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Error
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.claudemanager.app.data.models.ServerManager
import com.claudemanager.app.ui.theme.LumiBackground
import com.claudemanager.app.ui.theme.LumiCard
import com.claudemanager.app.ui.theme.LumiError
import com.claudemanager.app.ui.theme.LumiOnSurface
import com.claudemanager.app.ui.theme.LumiOnSurfaceSecondary
import com.claudemanager.app.ui.theme.LumiOnSurfaceTertiary
import com.claudemanager.app.ui.theme.LumiPurple500
import com.claudemanager.app.ui.theme.LumiSuccess

/**
 * Settings screen for managing multiple server connections.
 * Accessible via the settings gear icon from the main agent list.
 *
 * @param onBack Navigate back to agent list.
 * @param onFirstManagerSaved Called when the first manager is added (navigate to agents).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ManagersScreen(
    onBack: () -> Unit,
    onFirstManagerSaved: (() -> Unit)? = null,
    viewModel: ManagersViewModel = viewModel()
) {
    val state by viewModel.uiState.collectAsState()

    Scaffold(
        containerColor = LumiBackground,
        topBar = {
            TopAppBar(
                title = { Text("Managers", style = MaterialTheme.typography.titleLarge, color = LumiOnSurface) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = LumiOnSurface)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = LumiBackground)
            )
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = viewModel::openAddDialog,
                containerColor = LumiPurple500,
                contentColor = LumiOnSurface
            ) {
                Icon(Icons.Default.Add, contentDescription = "Add manager")
            }
        }
    ) { padding ->
        if (state.managers.isEmpty()) {
            Box(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Default.Cloud, contentDescription = null, modifier = Modifier.size(64.dp), tint = LumiOnSurfaceTertiary)
                    Spacer(modifier = Modifier.height(16.dp))
                    Text("No managers added", style = MaterialTheme.typography.bodyLarge, color = LumiOnSurfaceSecondary)
                    Spacer(modifier = Modifier.height(8.dp))
                    Text("Tap + to add your first server", style = MaterialTheme.typography.bodyMedium, color = LumiOnSurfaceTertiary)
                }
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding).padding(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                item { Spacer(modifier = Modifier.height(8.dp)) }
                items(state.managers, key = { it.id }) { manager ->
                    ManagerCard(
                        manager = manager,
                        isActive = manager.id == state.activeManagerId,
                        onActivate = { viewModel.setActiveManager(manager) },
                        onEdit = { viewModel.openEditDialog(manager) },
                        onDelete = { viewModel.confirmDelete(manager) }
                    )
                }
                item { Spacer(modifier = Modifier.height(80.dp)) }
            }
        }
    }

    // Add / Edit dialog
    if (state.showAddEditDialog) {
        AddEditManagerDialog(
            isEditing = state.editingManager != null,
            name = state.dialogName,
            address = state.dialogAddress,
            apiKey = state.dialogApiKey,
            isLoading = state.dialogIsLoading,
            isConnected = state.dialogIsConnected,
            resolvedUrl = state.dialogResolvedUrl,
            error = state.dialogError,
            onNameChanged = viewModel::onDialogNameChanged,
            onAddressChanged = viewModel::onDialogAddressChanged,
            onApiKeyChanged = viewModel::onDialogApiKeyChanged,
            onTestConnection = viewModel::testConnection,
            onSave = { viewModel.saveManager(onFirstManagerSaved) },
            onDismiss = viewModel::dismissDialog
        )
    }

    // Delete confirmation dialog
    state.showDeleteConfirm?.let { manager ->
        AlertDialog(
            onDismissRequest = viewModel::dismissDeleteConfirm,
            title = { Text("Delete ${manager.name}?") },
            text = { Text("This will remove the server from your app. You can add it back later.", color = LumiOnSurfaceSecondary) },
            confirmButton = {
                Button(
                    onClick = { viewModel.deleteManager(manager) },
                    colors = ButtonDefaults.buttonColors(containerColor = LumiError)
                ) { Text("Delete") }
            },
            dismissButton = {
                TextButton(onClick = viewModel::dismissDeleteConfirm) { Text("Cancel", color = LumiOnSurfaceSecondary) }
            },
            containerColor = LumiCard
        )
    }
}

@Composable
private fun ManagerCard(
    manager: ServerManager,
    isActive: Boolean,
    onActivate: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(enabled = !isActive, onClick = onActivate),
        colors = CardDefaults.cardColors(
            containerColor = if (isActive) LumiPurple500.copy(alpha = 0.08f) else LumiCard
        ),
        shape = RoundedCornerShape(12.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Active indicator dot
            Box(
                modifier = Modifier
                    .size(10.dp)
                    .clip(CircleShape)
                    .background(if (isActive) LumiSuccess else LumiOnSurfaceTertiary.copy(alpha = 0.4f))
            )

            Spacer(modifier = Modifier.width(12.dp))

            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = manager.name,
                        style = MaterialTheme.typography.titleSmall,
                        color = if (isActive) LumiPurple500 else LumiOnSurface
                    )
                    if (isActive) {
                        Spacer(modifier = Modifier.width(6.dp))
                        Icon(Icons.Default.CheckCircle, contentDescription = "Active", tint = LumiPurple500, modifier = Modifier.size(14.dp))
                    }
                }
                Text(
                    text = manager.url.removePrefix("https://").removePrefix("http://"),
                    style = MaterialTheme.typography.bodySmall,
                    color = LumiOnSurfaceTertiary
                )
            }

            IconButton(onClick = onEdit) {
                Icon(Icons.Default.Edit, contentDescription = "Edit", tint = LumiOnSurfaceSecondary)
            }
            IconButton(onClick = onDelete) {
                Icon(Icons.Default.Delete, contentDescription = "Delete", tint = LumiError.copy(alpha = 0.7f))
            }
        }
    }
}

@Composable
private fun AddEditManagerDialog(
    isEditing: Boolean,
    name: String,
    address: String,
    apiKey: String,
    isLoading: Boolean,
    isConnected: Boolean,
    resolvedUrl: String?,
    error: String?,
    onNameChanged: (String) -> Unit,
    onAddressChanged: (String) -> Unit,
    onApiKeyChanged: (String) -> Unit,
    onTestConnection: () -> Unit,
    onSave: () -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = LumiCard,
        title = { Text(if (isEditing) "Edit Manager" else "Add Manager", style = MaterialTheme.typography.headlineSmall) },
        text = {
            Column(modifier = Modifier.fillMaxWidth()) {
                OutlinedTextField(
                    value = name,
                    onValueChange = onNameChanged,
                    label = { Text("Name") },
                    placeholder = { Text("e.g. My Desktop, Work Server") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = LumiPurple500, cursorColor = LumiPurple500)
                )
                Spacer(modifier = Modifier.height(10.dp))
                OutlinedTextField(
                    value = address,
                    onValueChange = onAddressChanged,
                    label = { Text("Server address") },
                    placeholder = { Text("e.g. my-pc.tail12345.ts.net") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                    modifier = Modifier.fillMaxWidth(),
                    colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = LumiPurple500, cursorColor = LumiPurple500)
                )
                Spacer(modifier = Modifier.height(10.dp))
                OutlinedTextField(
                    value = apiKey,
                    onValueChange = onApiKeyChanged,
                    label = { Text("API key (optional)") },
                    placeholder = { Text("Enter API key if auth is enabled") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth(),
                    colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = LumiPurple500, cursorColor = LumiPurple500)
                )

                Spacer(modifier = Modifier.height(12.dp))

                // Connection status
                AnimatedVisibility(visible = isConnected || error != null, enter = fadeIn(), exit = fadeOut()) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (isConnected) {
                            Icon(Icons.Default.CheckCircle, contentDescription = null, tint = LumiSuccess, modifier = Modifier.size(16.dp))
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("Connected to ${resolvedUrl?.removePrefix("https://")?.removePrefix("http://")}", style = MaterialTheme.typography.bodySmall, color = LumiSuccess)
                        } else if (error != null) {
                            Icon(Icons.Default.Error, contentDescription = null, tint = LumiError, modifier = Modifier.size(16.dp))
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(error, style = MaterialTheme.typography.bodySmall, color = LumiError)
                        }
                    }
                }

                Spacer(modifier = Modifier.height(12.dp))

                OutlinedButton(
                    onClick = onTestConnection,
                    enabled = !isLoading && address.isNotBlank(),
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = LumiPurple500)
                ) {
                    if (isLoading) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp), color = LumiPurple500, strokeWidth = 2.dp)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Testing...")
                    } else {
                        Text("Test Connection")
                    }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = onSave,
                enabled = isConnected,
                colors = ButtonDefaults.buttonColors(
                    containerColor = LumiPurple500,
                    disabledContainerColor = LumiPurple500.copy(alpha = 0.3f)
                )
            ) {
                Text(if (isEditing) "Save" else "Add")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel", color = LumiOnSurfaceSecondary) }
        }
    )
}
