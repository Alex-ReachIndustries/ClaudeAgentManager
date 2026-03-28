package com.claudemanager.app.ui.detail.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.claudemanager.app.ClaudeManagerApp
import com.claudemanager.app.data.models.FolderEntry
import com.claudemanager.app.ui.theme.LumiCard
import com.claudemanager.app.ui.theme.LumiError
import com.claudemanager.app.ui.theme.LumiOnSurface
import com.claudemanager.app.ui.theme.LumiOnSurfaceSecondary
import com.claudemanager.app.ui.theme.LumiOnSurfaceTertiary
import com.claudemanager.app.ui.theme.LumiPurple500
import com.claudemanager.app.ui.theme.LumiWarning
import kotlinx.coroutines.launch

/**
 * Dialog for browsing and selecting a folder on the server.
 * Used when launching a new agent to choose the project directory.
 *
 * Features:
 * - Lazy-loads child folders on expansion
 * - Current path breadcrumb at the top
 * - Select/Cancel buttons at the bottom
 *
 * @param onDismiss Callback when the dialog is dismissed.
 * @param onFolderSelected Callback with the selected folder path.
 */
@Composable
fun FolderPickerDialog(
    onDismiss: () -> Unit,
    onFolderSelected: (String) -> Unit
) {
    val context = LocalContext.current
    val app = context.applicationContext as ClaudeManagerApp
    val repository = app.repository
    val scope = rememberCoroutineScope()

    var currentPath by remember { mutableStateOf("") }
    var selectedPath by remember { mutableStateOf<String?>(null) }
    var isLoading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val folders = remember { mutableStateListOf<FolderEntry>() }

    // Load folders for the current path
    fun loadFolders(path: String) {
        scope.launch {
            isLoading = true
            error = null
            repository.getFolders(path)
                .onSuccess { response ->
                    currentPath = response.current
                    folders.clear()
                    folders.addAll(response.folders)
                }
                .onFailure { e ->
                    error = e.message ?: "Failed to load folders"
                }
            isLoading = false
        }
    }

    // Load root on first display
    LaunchedEffect(Unit) {
        loadFolders("")
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                text = "Select Project Folder",
                style = MaterialTheme.typography.headlineSmall,
                color = LumiOnSurface
            )
        },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 200.dp, max = 400.dp)
            ) {
                // Breadcrumb / current path
                Text(
                    text = currentPath.ifEmpty { "/" },
                    style = MaterialTheme.typography.bodySmall,
                    color = LumiPurple500,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(bottom = 8.dp)
                )

                // Error
                if (error != null) {
                    Text(
                        text = error!!,
                        style = MaterialTheme.typography.bodySmall,
                        color = LumiError,
                        modifier = Modifier.padding(bottom = 8.dp)
                    )
                }

                // Loading
                if (isLoading) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(100.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        CircularProgressIndicator(
                            color = LumiPurple500,
                            modifier = Modifier.size(24.dp),
                            strokeWidth = 2.dp
                        )
                    }
                } else {
                    // Parent directory entry (if not at root)
                    if (currentPath.isNotEmpty() && currentPath != "/") {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    val parent = currentPath
                                        .trimEnd('/', '\\')
                                        .substringBeforeLast('/')
                                        .substringBeforeLast('\\')
                                    selectedPath = null
                                    loadFolders(parent)
                                }
                                .padding(vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                imageVector = Icons.Default.FolderOpen,
                                contentDescription = "Parent folder",
                                tint = LumiWarning,
                                modifier = Modifier.size(20.dp)
                            )
                            Spacer(modifier = Modifier.width(10.dp))
                            Text(
                                text = "..",
                                style = MaterialTheme.typography.bodyMedium,
                                color = LumiOnSurfaceSecondary
                            )
                        }
                    }

                    // Folder list
                    LazyColumn(
                        modifier = Modifier.fillMaxWidth(),
                        verticalArrangement = Arrangement.spacedBy(2.dp)
                    ) {
                        items(folders, key = { it.path }) { folder ->
                            val isSelected = selectedPath == folder.path
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable {
                                        selectedPath = folder.path
                                    }
                                    .then(
                                        if (isSelected) {
                                            Modifier.padding(0.dp) // Will use background tint
                                        } else {
                                            Modifier
                                        }
                                    )
                                    .padding(vertical = 8.dp, horizontal = 4.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Folder,
                                    contentDescription = null,
                                    tint = if (isSelected) LumiPurple500 else LumiWarning,
                                    modifier = Modifier.size(20.dp)
                                )
                                Spacer(modifier = Modifier.width(10.dp))
                                Text(
                                    text = folder.name,
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = if (isSelected) LumiPurple500 else LumiOnSurface,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.weight(1f)
                                )
                                if (folder.hasChildren) {
                                    Icon(
                                        imageVector = Icons.Default.ChevronRight,
                                        contentDescription = "Expand",
                                        tint = LumiOnSurfaceTertiary,
                                        modifier = Modifier
                                            .size(20.dp)
                                            .clickable {
                                                selectedPath = null
                                                loadFolders(folder.path)
                                            }
                                    )
                                }
                            }
                        }

                        if (folders.isEmpty() && !isLoading) {
                            item {
                                Text(
                                    text = "No subfolders",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = LumiOnSurfaceTertiary,
                                    modifier = Modifier.padding(vertical = 16.dp)
                                )
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    val path = selectedPath ?: currentPath
                    if (path.isNotBlank()) {
                        onFolderSelected(path)
                    }
                },
                enabled = (selectedPath != null || currentPath.isNotBlank()),
                colors = ButtonDefaults.buttonColors(
                    containerColor = LumiPurple500,
                    contentColor = LumiOnSurface,
                    disabledContainerColor = LumiPurple500.copy(alpha = 0.3f),
                    disabledContentColor = LumiOnSurface.copy(alpha = 0.5f)
                ),
                shape = RoundedCornerShape(8.dp)
            ) {
                Text("Select")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel", color = LumiOnSurfaceSecondary)
            }
        },
        containerColor = LumiCard,
        titleContentColor = LumiOnSurface,
        textContentColor = LumiOnSurface
    )
}
