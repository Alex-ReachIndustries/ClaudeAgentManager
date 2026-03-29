@file:OptIn(ExperimentalMaterialApi::class)

package com.claudemanager.app.ui.projects

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.ExperimentalMaterialApi
import androidx.compose.material.pullrefresh.PullRefreshIndicator
import androidx.compose.material.pullrefresh.pullRefresh
import androidx.compose.material.pullrefresh.rememberPullRefreshState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Sort
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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
import com.claudemanager.app.data.models.Project
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

/**
 * Project list screen displaying all projects with status, agent count, and progress.
 *
 * Features:
 * - Pull-to-refresh
 * - FAB to create new project
 * - Color-coded status chips
 * - Click card to navigate to project detail
 *
 * @param onProjectClick Callback when a project card is tapped.
 */
@Composable
fun ProjectListScreen(
    onProjectClick: (String) -> Unit,
    viewModel: ProjectListViewModel = viewModel()
) {
    val state by viewModel.uiState.collectAsState()
    val pullRefreshState = rememberPullRefreshState(
        refreshing = state.isRefreshing,
        onRefresh = viewModel::refresh
    )

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(LumiBackground)
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .pullRefresh(pullRefreshState)
        ) {
            val filteredProjects = viewModel.getFilteredProjects()
            val statusOptions = listOf("All", "Active", "Pending", "Paused", "Completed", "Failed")
            var showSortMenu by remember { mutableStateOf(false) }

            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                // Search bar
                item {
                    Spacer(modifier = Modifier.height(4.dp))
                    OutlinedTextField(
                        value = state.searchQuery,
                        onValueChange = viewModel::setSearchQuery,
                        placeholder = { Text("Search projects...") },
                        leadingIcon = {
                            Icon(Icons.Default.Search, null, tint = LumiOnSurfaceTertiary)
                        },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = LumiPurple500,
                            unfocusedBorderColor = LumiOnSurfaceTertiary.copy(alpha = 0.3f),
                            cursorColor = LumiPurple500,
                            focusedTextColor = LumiOnSurface,
                            unfocusedTextColor = LumiOnSurface,
                            focusedContainerColor = LumiCard,
                            unfocusedContainerColor = LumiCard
                        ),
                        shape = RoundedCornerShape(12.dp)
                    )
                }

                // Filter chips + sort button
                item {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(
                            modifier = Modifier
                                .weight(1f)
                                .horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            statusOptions.forEach { status ->
                                val isSelected = (status == "All" && state.statusFilter == null) ||
                                    status.equals(state.statusFilter, ignoreCase = true)
                                Box(
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(16.dp))
                                        .background(
                                            if (isSelected) LumiPurple500.copy(alpha = 0.2f)
                                            else LumiCard
                                        )
                                        .clickable {
                                            viewModel.setStatusFilter(
                                                if (status == "All") null else status.lowercase()
                                            )
                                        }
                                        .padding(horizontal = 12.dp, vertical = 6.dp)
                                ) {
                                    Text(
                                        text = status,
                                        style = MaterialTheme.typography.labelSmall,
                                        color = if (isSelected) LumiPurple500 else LumiOnSurfaceTertiary
                                    )
                                }
                            }
                        }

                        Box {
                            IconButton(onClick = { showSortMenu = true }) {
                                Icon(Icons.Default.Sort, "Sort", tint = LumiOnSurfaceTertiary)
                            }
                            DropdownMenu(
                                expanded = showSortMenu,
                                onDismissRequest = { showSortMenu = false }
                            ) {
                                ProjectSortOption.entries.forEach { option ->
                                    DropdownMenuItem(
                                        text = {
                                            Text(
                                                option.label,
                                                color = if (state.sortOption == option) LumiPurple500
                                                else LumiOnSurface
                                            )
                                        },
                                        onClick = {
                                            viewModel.setSortOption(option)
                                            showSortMenu = false
                                        }
                                    )
                                }
                            }
                        }
                    }
                }

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

                if (filteredProjects.isEmpty() && !state.isLoading) {
                    item {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 48.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Icon(
                                    imageVector = Icons.Default.Folder,
                                    contentDescription = null,
                                    modifier = Modifier.size(48.dp),
                                    tint = LumiOnSurfaceTertiary
                                )
                                Spacer(modifier = Modifier.height(12.dp))
                                Text(
                                    text = if (state.projects.isEmpty()) "No projects yet"
                                    else "No matching projects",
                                    style = MaterialTheme.typography.bodyLarge,
                                    color = LumiOnSurfaceSecondary
                                )
                            }
                        }
                    }
                } else {
                    items(filteredProjects, key = { it.id }) { project ->
                        ProjectCard(
                            project = project,
                            onClick = { onProjectClick(project.id) }
                        )
                    }
                }

                // Bottom spacer for FAB clearance
                item { Spacer(modifier = Modifier.height(80.dp)) }
            }

            PullRefreshIndicator(
                refreshing = state.isRefreshing,
                state = pullRefreshState,
                modifier = Modifier.align(Alignment.TopCenter),
                contentColor = LumiPurple500
            )
        }

        // FAB
        FloatingActionButton(
            onClick = { viewModel.showCreateDialog(true) },
            containerColor = LumiPurple500,
            contentColor = LumiOnSurface,
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(16.dp)
        ) {
            Icon(Icons.Default.Add, contentDescription = "New Project")
        }
    }

    // Create project dialog
    if (state.showCreateDialog) {
        CreateProjectDialog(
            onDismiss = { viewModel.showCreateDialog(false) },
            onCreate = { name, description, folderPath ->
                viewModel.createProject(name, description, folderPath)
            }
        )
    }
}

/**
 * Returns the color associated with a project status string.
 */
private fun projectStatusColor(status: String): androidx.compose.ui.graphics.Color = when (status.lowercase()) {
    "active", "running" -> LumiSuccess
    "paused" -> LumiWarning
    "completed" -> LumiInfo
    "pending", "created" -> LumiOnSurfaceTertiary
    "failed" -> LumiError
    else -> LumiOnSurfaceTertiary
}

/**
 * Individual project card in the list.
 */
@Composable
private fun ProjectCard(project: Project, onClick: () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = LumiCard),
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            // Title row with status chip
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(
                    text = project.name,
                    style = MaterialTheme.typography.titleMedium,
                    color = LumiOnSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )
                Spacer(modifier = Modifier.width(8.dp))
                StatusChip(status = project.status)
            }

            // Description
            if (project.description.isNotBlank()) {
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = project.description,
                    style = MaterialTheme.typography.bodyMedium,
                    color = LumiOnSurfaceSecondary,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
            }

            Spacer(modifier = Modifier.height(10.dp))

            // Agent count and progress
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                // Agent count
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Default.Group,
                        contentDescription = "Agents",
                        tint = LumiOnSurfaceTertiary,
                        modifier = Modifier.size(14.dp)
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(
                        text = "${project.activeAgentCount ?: 0}/${project.totalAgentCount ?: 0} agents",
                        style = MaterialTheme.typography.labelSmall,
                        color = LumiOnSurfaceTertiary
                    )
                }

                // Folder name
                val folderName = project.folderPath
                    .substringAfterLast('/')
                    .substringAfterLast('\\')
                Text(
                    text = folderName,
                    style = MaterialTheme.typography.labelSmall,
                    color = LumiOnSurfaceTertiary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }

            // Progress bar for active projects
            if (project.status.lowercase() in listOf("active", "running") &&
                (project.totalAgentCount ?: 0) > 0
            ) {
                Spacer(modifier = Modifier.height(8.dp))
                LinearProgressIndicator(
                    progress = {
                        (project.activeAgentCount ?: 0).toFloat() /
                            (project.totalAgentCount ?: 1).toFloat()
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(4.dp)
                        .clip(RoundedCornerShape(2.dp)),
                    color = LumiPurple500,
                    trackColor = LumiOnSurfaceTertiary.copy(alpha = 0.2f)
                )
            }
        }
    }
}

/**
 * Color-coded status chip.
 */
@Composable
private fun StatusChip(status: String) {
    val color = projectStatusColor(status)
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(10.dp))
            .background(color.copy(alpha = 0.2f))
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
 * Dialog for creating a new project.
 */
@Composable
private fun CreateProjectDialog(
    onDismiss: () -> Unit,
    onCreate: (name: String, description: String, folderPath: String) -> Unit
) {
    var name by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var folderPath by remember { mutableStateOf("") }
    var showFolderPicker by remember { mutableStateOf(false) }

    val textFieldColors = OutlinedTextFieldDefaults.colors(
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

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = LumiCard,
        titleContentColor = LumiOnSurface,
        textContentColor = LumiOnSurfaceSecondary,
        title = {
            Text("New Project", style = MaterialTheme.typography.titleLarge)
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    colors = textFieldColors
                )
                OutlinedTextField(
                    value = description,
                    onValueChange = { description = it },
                    label = { Text("Description") },
                    minLines = 2,
                    maxLines = 4,
                    modifier = Modifier.fillMaxWidth(),
                    colors = textFieldColors
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    OutlinedTextField(
                        value = folderPath,
                        onValueChange = {},
                        label = { Text("Folder Path") },
                        readOnly = true,
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                        colors = textFieldColors
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    TextButton(onClick = { showFolderPicker = true }) {
                        Text("Browse", color = LumiPurple500)
                    }
                }

                if (showFolderPicker) {
                    com.claudemanager.app.ui.detail.components.FolderPickerDialog(
                        onDismiss = { showFolderPicker = false },
                        onFolderSelected = { path ->
                            folderPath = path
                            showFolderPicker = false
                        }
                    )
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onCreate(name, description, folderPath) },
                enabled = name.isNotBlank() && folderPath.isNotBlank()
            ) {
                Text("Create", color = LumiPurple500)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel", color = LumiOnSurfaceTertiary)
            }
        }
    )
}
