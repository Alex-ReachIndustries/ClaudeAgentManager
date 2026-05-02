@file:OptIn(ExperimentalMaterialApi::class, ExperimentalFoundationApi::class)

package com.claudemanager.app.ui.agents

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.ExperimentalMaterialApi
import androidx.compose.material.pullrefresh.PullRefreshIndicator
import androidx.compose.material.pullrefresh.pullRefresh
import androidx.compose.material.pullrefresh.rememberPullRefreshState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Circle
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.automirrored.filled.Sort
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Update
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.TextButton
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.claudemanager.app.data.models.Agent
import com.claudemanager.app.data.models.AgentStatus
import com.claudemanager.app.data.sse.SSEClient
import com.claudemanager.app.ui.detail.components.FolderPickerDialog
import com.claudemanager.app.ui.theme.LumiBackground
import com.claudemanager.app.ui.theme.LumiCard
import com.claudemanager.app.ui.theme.LumiError
import com.claudemanager.app.ui.theme.LumiOnSurface
import com.claudemanager.app.ui.theme.LumiOnSurfaceSecondary
import com.claudemanager.app.ui.theme.LumiOnSurfaceTertiary
import com.claudemanager.app.ui.theme.LumiPurple500
import com.claudemanager.app.ui.theme.LumiSuccess
import com.claudemanager.app.ui.theme.LumiWarning
import com.claudemanager.app.ui.theme.agentStatusColor
import com.claudemanager.app.util.TimeUtils
import com.claudemanager.app.ui.PredefinedRole


/**
 * Agent list screen displaying all active and archived agents.
 *
 * Features:
 * - Search bar with text filtering (matches title, workspace, summary)
 * - Horizontally scrollable status filter chips
 * - Pull-to-refresh
 * - Real-time updates via SSE
 * - Active/archived sections (archived collapsed by default)
 * - FAB to launch new agent via folder picker
 * - Connection status indicator in the app bar
 *
 * @param onAgentClick Callback when an agent card is tapped.
 * @param onSettingsClick Callback when the settings icon is tapped.
 * @param startAgentId Optional agent ID to auto-navigate to on first load.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AgentListScreen(
    onAgentClick: (String) -> Unit,
    onSettingsClick: () -> Unit,
    startAgentId: String? = null,
    viewModel: AgentListViewModel = viewModel()
) {
    val state by viewModel.uiState.collectAsState()
    var showArchived by remember { mutableStateOf(false) }
    var showFolderPicker by remember { mutableStateOf(false) }
    var selectedFolder by remember { mutableStateOf<String?>(null) }
    var showRoleTaskDialog by remember { mutableStateOf(false) }
    var showGroupDialog by remember { mutableStateOf(false) }

    // Use filtered agents for display; separate into active/archived
    val displayAgents = state.filteredAgents
    val activeAgents = displayAgents.filter { it.status != AgentStatus.ARCHIVED }
    val archivedAgents = displayAgents.filter { it.status == AgentStatus.ARCHIVED }
    val pullRefreshState = rememberPullRefreshState(
        refreshing = state.isRefreshing,
        onRefresh = viewModel::refresh
    )

    // Handle deep-link navigation to a specific agent (consume once)
    var consumedStartId by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(startAgentId) {
        if (startAgentId != null && startAgentId != consumedStartId) {
            consumedStartId = startAgentId
            onAgentClick(startAgentId)
        }
    }

    Scaffold(
        topBar = {
            if (state.isMultiSelectMode) {
                MultiSelectTopBar(
                    selectedCount = state.selectedAgentIds.size,
                    isArchiving = state.isArchiving,
                    isGrouping = state.isGrouping,
                    onArchive = viewModel::archiveSelected,
                    onGroup = { showGroupDialog = true },
                    onClear = viewModel::clearSelection
                )
            } else {
                CenterAlignedTopAppBar(
                    title = {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                "Claude Manager",
                                style = MaterialTheme.typography.titleLarge
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            ConnectionDot(state.connectionState)
                        }
                    },
                    actions = {
                        IconButton(onClick = viewModel::refresh) {
                            Icon(
                                imageVector = Icons.Default.Refresh,
                                contentDescription = "Refresh",
                                tint = LumiOnSurfaceSecondary
                            )
                        }
                        IconButton(onClick = onSettingsClick) {
                            Icon(
                                imageVector = Icons.Default.Settings,
                                contentDescription = "Settings",
                                tint = LumiOnSurfaceSecondary
                            )
                        }
                    },
                    colors = TopAppBarDefaults.centerAlignedTopAppBarColors(
                        containerColor = LumiBackground,
                        titleContentColor = LumiOnSurface
                    )
                )
            }
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = { showFolderPicker = true },
                containerColor = LumiPurple500,
                contentColor = LumiOnSurface
            ) {
                Icon(Icons.Default.Add, contentDescription = "New Agent")
            }
        },
        containerColor = LumiBackground
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .pullRefresh(pullRefreshState)
        ) {
            Column(modifier = Modifier.fillMaxSize()) {
                // Search bar
                SearchBar(
                    query = state.searchQuery,
                    onQueryChanged = viewModel::onSearchChanged,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 4.dp)
                )

                // Filter chips + sort selector
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp)
                        .padding(bottom = 8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    FilterChipRow(
                        selectedFilter = state.selectedFilter,
                        onFilterChanged = viewModel::onFilterChanged,
                        modifier = Modifier.weight(1f)
                    )
                    SortChipRow(
                        selectedSort = state.sortOption,
                        onSortChanged = viewModel::onSortChanged
                    )
                }

                if (!state.isLoading && activeAgents.isEmpty() && archivedAgents.isEmpty()) {
                    // Empty state
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .weight(1f),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(
                                imageVector = Icons.Default.Notifications,
                                contentDescription = null,
                                modifier = Modifier.size(48.dp),
                                tint = LumiOnSurfaceTertiary
                            )
                            Spacer(modifier = Modifier.height(16.dp))
                            Text(
                                text = if (state.searchQuery.isNotBlank() || state.selectedFilter != null)
                                    "No agents match your filters"
                                else
                                    "No agents running",
                                style = MaterialTheme.typography.bodyLarge,
                                color = LumiOnSurfaceSecondary
                            )
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                text = if (state.searchQuery.isNotBlank() || state.selectedFilter != null)
                                    "Try adjusting your search or filter"
                                else
                                    "Tap + to launch a new agent",
                                style = MaterialTheme.typography.bodyMedium,
                                color = LumiOnSurfaceTertiary
                            )
                        }
                    }
                } else {
                    // Compute groups from non-archived agents
                    val groupedActive = activeAgents
                        .filter { it.wtWindow != null }
                        .groupBy { it.wtWindow!! }
                    val ungroupedActive = activeAgents.filter { it.wtWindow == null }

                    LazyColumn(
                        modifier = Modifier
                            .fillMaxSize()
                            .weight(1f)
                            .padding(horizontal = 16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
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

                        // Grouped agents
                        groupedActive.forEach { (groupName, groupAgents) ->
                            val isExpanded = groupName in state.expandedGroups
                            item(key = "group_$groupName") {
                                GroupCard(
                                    groupName = groupName,
                                    agents = groupAgents,
                                    isExpanded = isExpanded,
                                    onToggle = { viewModel.toggleGroupExpanded(groupName) },
                                    onResume = { viewModel.resumeGroup(groupName) }
                                )
                            }
                            if (isExpanded) {
                                items(groupAgents, key = { "g_${it.id}" }) { agent ->
                                    AgentCard(
                                        agent = agent,
                                        isSelected = agent.id in state.selectedAgentIds,
                                        isMultiSelectMode = state.isMultiSelectMode,
                                        onClick = {
                                            if (state.isMultiSelectMode) viewModel.toggleSelection(agent.id)
                                            else onAgentClick(agent.id)
                                        },
                                        onLongClick = { viewModel.toggleSelection(agent.id) },
                                        modifier = Modifier.padding(start = 16.dp)
                                    )
                                }
                            }
                        }

                        // Ungrouped active agents
                        if (ungroupedActive.isNotEmpty()) {
                            if (groupedActive.isNotEmpty()) {
                                item { SectionHeader(title = "Other Agents", count = ungroupedActive.size) }
                            } else {
                                item { SectionHeader(title = "Active Agents", count = ungroupedActive.size) }
                            }
                            items(ungroupedActive, key = { it.id }) { agent ->
                                AgentCard(
                                    agent = agent,
                                    isSelected = agent.id in state.selectedAgentIds,
                                    isMultiSelectMode = state.isMultiSelectMode,
                                    onClick = {
                                        if (state.isMultiSelectMode) viewModel.toggleSelection(agent.id)
                                        else onAgentClick(agent.id)
                                    },
                                    onLongClick = { viewModel.toggleSelection(agent.id) }
                                )
                            }
                        }

                        // Archived agents section (collapsed by default)
                        if (archivedAgents.isNotEmpty()) {
                            item {
                                Spacer(modifier = Modifier.height(8.dp))
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clickable { showArchived = !showArchived }
                                        .padding(vertical = 8.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.Archive,
                                        contentDescription = null,
                                        tint = LumiOnSurfaceTertiary,
                                        modifier = Modifier.size(16.dp)
                                    )
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text(
                                        text = "Archived",
                                        style = MaterialTheme.typography.titleSmall,
                                        color = LumiOnSurfaceTertiary
                                    )
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text(
                                        text = "(${archivedAgents.size})",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = LumiOnSurfaceTertiary
                                    )
                                    Spacer(modifier = Modifier.weight(1f))
                                    Icon(
                                        imageVector = if (showArchived) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                                        contentDescription = if (showArchived) "Collapse" else "Expand",
                                        tint = LumiOnSurfaceTertiary,
                                        modifier = Modifier.size(20.dp)
                                    )
                                }
                            }

                            if (showArchived) {
                                items(archivedAgents, key = { it.id }) { agent ->
                                    AgentCard(
                                        agent = agent,
                                        isSelected = agent.id in state.selectedAgentIds,
                                        isMultiSelectMode = state.isMultiSelectMode,
                                        onClick = {
                                            if (state.isMultiSelectMode) viewModel.toggleSelection(agent.id)
                                            else onAgentClick(agent.id)
                                        },
                                        onLongClick = { viewModel.toggleSelection(agent.id) }
                                    )
                                }
                            }
                        }

                        // Bottom spacer for FAB clearance
                        item { Spacer(modifier = Modifier.height(80.dp)) }
                    }
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

    // Group selection dialog
    if (showGroupDialog) {
        GroupDialog(
            existingGroups = state.wtWindows,
            onDismiss = { showGroupDialog = false },
            onConfirm = { groupName ->
                showGroupDialog = false
                viewModel.groupSelected(groupName)
            }
        )
    }

    // Folder picker dialog
    if (showFolderPicker) {
        FolderPickerDialog(
            onDismiss = { showFolderPicker = false },
            onFolderSelected = { path ->
                showFolderPicker = false
                selectedFolder = path
                showRoleTaskDialog = true
            }
        )
    }

    if (showRoleTaskDialog && selectedFolder != null) {
        val predefinedRoles = state.predefinedRoles
        var selectedRoleIndex by remember { mutableStateOf(-1) }  // -1 = Custom
        var roleDropdownExpanded by remember { mutableStateOf(false) }
        var customRoleText by remember { mutableStateOf("") }
        var taskText by remember { mutableStateOf("") }
        var effortExpanded by remember { mutableStateOf(false) }
        var modelExpanded by remember { mutableStateOf(false) }
        var selectedEffort by remember { mutableStateOf("high") }
        var selectedModel by remember { mutableStateOf("claude-sonnet-4-6") }
        var wtWindowExpanded by remember { mutableStateOf(false) }
        var selectedWtWindow by remember { mutableStateOf<String?>(null) }
        var customWtWindow by remember { mutableStateOf("") }

        val effortOptions = listOf("low" to "Low", "medium" to "Medium", "high" to "High")
        val modelOptions = listOf(
            "claude-haiku-4-5-20251001" to "Haiku 4.5",
            "claude-sonnet-4-6" to "Sonnet 4.6",
            "claude-opus-4-6" to "Opus 4.6"
        )

        AlertDialog(
            onDismissRequest = {
                showRoleTaskDialog = false
                selectedFolder = null
            },
            title = { Text("New Agent", style = MaterialTheme.typography.headlineSmall) },
            text = {
                Column(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = selectedFolder!!.substringAfterLast('/').substringAfterLast('\\'),
                        style = MaterialTheme.typography.bodySmall,
                        color = LumiOnSurfaceSecondary,
                        modifier = Modifier.padding(bottom = 12.dp)
                    )
                    // Role dropdown
                    Box(modifier = Modifier.fillMaxWidth()) {
                        OutlinedTextField(
                            value = if (selectedRoleIndex >= 0) predefinedRoles[selectedRoleIndex].displayName else "Custom",
                            onValueChange = {},
                            readOnly = true,
                            label = { Text("Role (optional)") },
                            modifier = Modifier.fillMaxWidth(),
                            trailingIcon = {
                                androidx.compose.material3.IconButton(onClick = { roleDropdownExpanded = true }) {
                                    Icon(Icons.Default.ExpandMore, contentDescription = null)
                                }
                            },
                            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = LumiPurple500)
                        )
                        androidx.compose.material3.DropdownMenu(
                            expanded = roleDropdownExpanded,
                            onDismissRequest = { roleDropdownExpanded = false }
                        ) {
                            predefinedRoles.forEachIndexed { idx, role ->
                                androidx.compose.material3.DropdownMenuItem(
                                    text = { Text(role.displayName, color = if (idx == selectedRoleIndex) LumiPurple500 else LumiOnSurface) },
                                    onClick = { selectedRoleIndex = idx; roleDropdownExpanded = false }
                                )
                            }
                            androidx.compose.material3.DropdownMenuItem(
                                text = { Text("Custom", color = if (selectedRoleIndex < 0) LumiPurple500 else LumiOnSurface) },
                                onClick = { selectedRoleIndex = -1; roleDropdownExpanded = false }
                            )
                        }
                    }
                    if (selectedRoleIndex < 0) {
                        Spacer(modifier = Modifier.height(8.dp))
                        OutlinedTextField(
                            value = customRoleText,
                            onValueChange = { customRoleText = it },
                            label = { Text("Custom role") },
                            placeholder = { Text("e.g. Designer, PM, Reviewer") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedBorderColor = LumiPurple500,
                                cursorColor = LumiPurple500
                            )
                        )
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedTextField(
                        value = taskText,
                        onValueChange = { taskText = it },
                        label = { Text("Task (optional)") },
                        placeholder = { Text("Describe what this agent should do") },
                        maxLines = 4,
                        modifier = Modifier.fillMaxWidth(),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = LumiPurple500,
                            cursorColor = LumiPurple500
                        )
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    // Effort dropdown
                    Box(modifier = Modifier.fillMaxWidth()) {
                        OutlinedTextField(
                            value = effortOptions.first { it.first == selectedEffort }.second,
                            onValueChange = {},
                            readOnly = true,
                            label = { Text("Effort") },
                            modifier = Modifier.fillMaxWidth(),
                            trailingIcon = {
                                androidx.compose.material3.IconButton(onClick = { effortExpanded = true }) {
                                    Icon(Icons.Default.ExpandMore, contentDescription = null)
                                }
                            },
                            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = LumiPurple500)
                        )
                        androidx.compose.material3.DropdownMenu(
                            expanded = effortExpanded,
                            onDismissRequest = { effortExpanded = false }
                        ) {
                            effortOptions.forEach { (value, label) ->
                                androidx.compose.material3.DropdownMenuItem(
                                    text = { Text(label, color = if (value == selectedEffort) LumiPurple500 else LumiOnSurface) },
                                    onClick = { selectedEffort = value; effortExpanded = false }
                                )
                            }
                        }
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    // Model dropdown
                    Box(modifier = Modifier.fillMaxWidth()) {
                        OutlinedTextField(
                            value = modelOptions.first { it.first == selectedModel }.second,
                            onValueChange = {},
                            readOnly = true,
                            label = { Text("Model") },
                            modifier = Modifier.fillMaxWidth(),
                            trailingIcon = {
                                androidx.compose.material3.IconButton(onClick = { modelExpanded = true }) {
                                    Icon(Icons.Default.ExpandMore, contentDescription = null)
                                }
                            },
                            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = LumiPurple500)
                        )
                        androidx.compose.material3.DropdownMenu(
                            expanded = modelExpanded,
                            onDismissRequest = { modelExpanded = false }
                        ) {
                            modelOptions.forEach { (value, label) ->
                                androidx.compose.material3.DropdownMenuItem(
                                    text = { Text(label, color = if (value == selectedModel) LumiPurple500 else LumiOnSurface) },
                                    onClick = { selectedModel = value; modelExpanded = false }
                                )
                            }
                        }
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    // Window Group dropdown
                    Box(modifier = Modifier.fillMaxWidth()) {
                        OutlinedTextField(
                            value = selectedWtWindow ?: "None",
                            onValueChange = {},
                            readOnly = true,
                            label = { Text("Window Group (optional)") },
                            modifier = Modifier.fillMaxWidth(),
                            trailingIcon = {
                                androidx.compose.material3.IconButton(onClick = { wtWindowExpanded = true }) {
                                    Icon(Icons.Default.ExpandMore, contentDescription = null)
                                }
                            },
                            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = LumiPurple500)
                        )
                        androidx.compose.material3.DropdownMenu(
                            expanded = wtWindowExpanded,
                            onDismissRequest = { wtWindowExpanded = false }
                        ) {
                            androidx.compose.material3.DropdownMenuItem(
                                text = { Text("None", color = if (selectedWtWindow == null) LumiPurple500 else LumiOnSurface) },
                                onClick = { selectedWtWindow = null; wtWindowExpanded = false }
                            )
                            state.wtWindows.forEach { w ->
                                androidx.compose.material3.DropdownMenuItem(
                                    text = { Text(w, color = if (selectedWtWindow == w) LumiPurple500 else LumiOnSurface) },
                                    onClick = { selectedWtWindow = w; customWtWindow = ""; wtWindowExpanded = false }
                                )
                            }
                        }
                    }
                    if (selectedWtWindow == null && state.wtWindows.isNotEmpty()) {
                        Spacer(modifier = Modifier.height(4.dp))
                        OutlinedTextField(
                            value = customWtWindow,
                            onValueChange = { customWtWindow = it },
                            label = { Text("or new group name") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedBorderColor = LumiPurple500,
                                cursorColor = LumiPurple500
                            )
                        )
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        val finalRole = if (selectedRoleIndex >= 0) predefinedRoles[selectedRoleIndex].fullDefinition
                                        else customRoleText.takeIf { it.isNotBlank() }
                        val finalWtWindow = selectedWtWindow ?: customWtWindow.trim().ifEmpty { null }
                        viewModel.launchNewAgent(
                            selectedFolder!!,
                            finalRole,
                            taskText.takeIf { it.isNotBlank() },
                            selectedEffort,
                            selectedModel,
                            finalWtWindow
                        )
                        showRoleTaskDialog = false
                        selectedFolder = null
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = LumiPurple500)
                ) {
                    Text("Create Agent")
                }
            },
            dismissButton = {
                TextButton(onClick = {
                    showRoleTaskDialog = false
                    selectedFolder = null
                }) {
                    Text("Cancel", color = LumiOnSurfaceSecondary)
                }
            }
        )
    }
}

/**
 * Search bar with search icon and clear button.
 */
@Composable
private fun SearchBar(
    query: String,
    onQueryChanged: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    OutlinedTextField(
        value = query,
        onValueChange = onQueryChanged,
        modifier = modifier,
        placeholder = {
            Text(
                "Search agents...",
                color = LumiOnSurfaceTertiary
            )
        },
        leadingIcon = {
            Icon(
                imageVector = Icons.Default.Search,
                contentDescription = "Search",
                tint = LumiOnSurfaceTertiary
            )
        },
        trailingIcon = {
            if (query.isNotEmpty()) {
                IconButton(onClick = { onQueryChanged("") }) {
                    Icon(
                        imageVector = Icons.Default.Clear,
                        contentDescription = "Clear search",
                        tint = LumiOnSurfaceTertiary
                    )
                }
            }
        },
        singleLine = true,
        shape = RoundedCornerShape(12.dp),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = LumiPurple500,
            unfocusedBorderColor = LumiOnSurfaceTertiary.copy(alpha = 0.4f),
            cursorColor = LumiPurple500,
            focusedTextColor = LumiOnSurface,
            unfocusedTextColor = LumiOnSurface,
            focusedContainerColor = LumiCard,
            unfocusedContainerColor = LumiCard
        )
    )
}

/**
 * Horizontally scrollable row of filter chips for status filtering.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FilterChipRow(
    selectedFilter: AgentStatus?,
    onFilterChanged: (AgentStatus?) -> Unit,
    modifier: Modifier = Modifier
) {
    val scrollState = rememberScrollState()

    // Define filter options: null = All, then each status
    data class FilterOption(val status: AgentStatus?, val label: String)

    val filters = listOf(
        FilterOption(null, "All"),
        FilterOption(AgentStatus.ACTIVE, "Active"),
        FilterOption(AgentStatus.IDLE, "Idle"),
        FilterOption(AgentStatus.WORKING, "Working"),
        FilterOption(AgentStatus.WAITING_FOR_INPUT, "Waiting"),
        FilterOption(AgentStatus.STANDBY, "Standby"),
        FilterOption(AgentStatus.COMPLETED, "Completed"),
        FilterOption(AgentStatus.ARCHIVED, "Archived")
    )

    Row(
        modifier = modifier.horizontalScroll(scrollState),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        filters.forEach { filter ->
            val isSelected = selectedFilter == filter.status
            FilterChip(
                selected = isSelected,
                onClick = { onFilterChanged(filter.status) },
                label = {
                    Text(
                        text = filter.label,
                        style = MaterialTheme.typography.labelMedium
                    )
                },
                leadingIcon = if (filter.status != null) {
                    {
                        Box(
                            modifier = Modifier
                                .size(8.dp)
                                .clip(CircleShape)
                                .background(agentStatusColor(filter.status))
                        )
                    }
                } else null,
                colors = FilterChipDefaults.filterChipColors(
                    containerColor = LumiCard,
                    labelColor = LumiOnSurfaceSecondary,
                    selectedContainerColor = LumiPurple500.copy(alpha = 0.2f),
                    selectedLabelColor = LumiOnSurface
                ),
                border = FilterChipDefaults.filterChipBorder(
                    borderColor = LumiOnSurfaceTertiary.copy(alpha = 0.3f),
                    selectedBorderColor = LumiPurple500.copy(alpha = 0.5f),
                    enabled = true,
                    selected = isSelected
                )
            )
        }
    }
}

/**
 * Section header for the agent list.
 */
@Composable
private fun SectionHeader(title: String, count: Int) {
    Row(
        modifier = Modifier.padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.titleSmall,
            color = LumiOnSurfaceSecondary
        )
        Spacer(modifier = Modifier.width(6.dp))
        Text(
            text = "($count)",
            style = MaterialTheme.typography.bodySmall,
            color = LumiOnSurfaceTertiary
        )
    }
}

/**
 * Individual agent card in the list.
 * Shows status dot, title, workspace, summary, stats, and activity time.
 * Supports multi-select via long-press and visual selection indicator.
 */
@Composable
private fun AgentCard(
    agent: Agent,
    isSelected: Boolean = false,
    isMultiSelectMode: Boolean = false,
    onClick: () -> Unit,
    onLongClick: () -> Unit = {},
    modifier: Modifier = Modifier
) {
    val borderModifier = if (isSelected) {
        Modifier.border(2.dp, LumiPurple500, RoundedCornerShape(12.dp))
    } else {
        Modifier
    }

    Card(
        modifier = modifier
            .fillMaxWidth()
            .then(borderModifier)
            .combinedClickable(
                onClick = onClick,
                onLongClick = onLongClick
            )
            .animateContentSize(),
        colors = CardDefaults.cardColors(
            containerColor = if (isSelected) LumiPurple500.copy(alpha = 0.08f) else LumiCard
        ),
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            // Title row with status dot and selection indicator
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (isMultiSelectMode) {
                    Icon(
                        imageVector = if (isSelected) Icons.Default.CheckCircle else Icons.Default.RadioButtonUnchecked,
                        contentDescription = if (isSelected) "Selected" else "Not selected",
                        tint = if (isSelected) LumiPurple500 else LumiOnSurfaceTertiary,
                        modifier = Modifier.size(22.dp)
                    )
                    Spacer(modifier = Modifier.width(10.dp))
                }
                Box(
                    modifier = Modifier
                        .size(10.dp)
                        .clip(CircleShape)
                        .background(agentStatusColor(agent.status))
                )
                Spacer(modifier = Modifier.width(10.dp))
                Text(
                    text = agent.title,
                    style = MaterialTheme.typography.titleMedium,
                    color = LumiOnSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )
            }

            // Workspace
            if (!agent.workspace.isNullOrBlank()) {
                val folderName = agent.workspace!!.substringAfterLast('/').substringAfterLast('\\')
                Text(
                    text = folderName,
                    style = MaterialTheme.typography.bodySmall,
                    color = LumiOnSurfaceTertiary,
                    modifier = Modifier.padding(start = 20.dp, top = 2.dp)
                )
            }

            // Project badge + role
            if (!agent.projectId.isNullOrBlank()) {
                Row(
                    modifier = Modifier.padding(start = 20.dp, top = 4.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(LumiPurple500.copy(alpha = 0.15f))
                            .padding(horizontal = 6.dp, vertical = 2.dp)
                    ) {
                        Text(
                            text = buildString {
                                append(agent.projectName ?: "Project")
                                val roleDisplay = agent.roleLabel ?: if (!agent.role.isNullOrBlank()) "Custom" else null
                                if (roleDisplay != null) {
                                    append(" \u00B7 $roleDisplay")
                                }
                            },
                            style = MaterialTheme.typography.labelSmall,
                            color = LumiPurple500
                        )
                    }
                }
            }

            // Latest activity: show most recent of agent update or user message
            val subtitle = run {
                val summary = agent.latestSummary
                val message = agent.latestMessage
                if (summary != null && message != null) {
                    val updateTime = TimeUtils.parseIso(agent.lastUpdateAt)?.time ?: 0L
                    val messageTime = agent.lastMessageAt?.let { TimeUtils.parseIso(it)?.time } ?: 0L
                    if (messageTime > updateTime) "You: $message" else summary
                } else message?.let { "You: $it" } ?: summary
            }
            if (!subtitle.isNullOrBlank()) {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodyMedium,
                    color = LumiOnSurfaceSecondary,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
            }

            Spacer(modifier = Modifier.height(10.dp))

            // Stats row
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    // Update count
                    Icon(
                        imageVector = Icons.Default.Update,
                        contentDescription = "Updates",
                        tint = LumiOnSurfaceTertiary,
                        modifier = Modifier.size(14.dp)
                    )
                    Spacer(modifier = Modifier.width(3.dp))
                    Text(
                        text = "${agent.updateCount}",
                        style = MaterialTheme.typography.labelSmall,
                        color = LumiOnSurfaceTertiary
                    )

                    // Unread badge
                    if (agent.unreadUpdateCount > 0) {
                        Spacer(modifier = Modifier.width(10.dp))
                        Badge(
                            text = "${agent.unreadUpdateCount} new",
                            color = LumiPurple500
                        )
                    }

                    // Pending messages badge
                    if (agent.pendingMessageCount > 0) {
                        Spacer(modifier = Modifier.width(10.dp))
                        Icon(
                            imageVector = Icons.Default.Email,
                            contentDescription = "Pending messages",
                            tint = LumiWarning,
                            modifier = Modifier.size(14.dp)
                        )
                        Spacer(modifier = Modifier.width(3.dp))
                        Text(
                            text = "${agent.pendingMessageCount}",
                            style = MaterialTheme.typography.labelSmall,
                            color = LumiWarning
                        )
                    }
                }

                // Time since last activity
                val timeText = agent.lastActivityAt?.let { TimeUtils.timeAgo(it) }
                    ?: TimeUtils.timeAgo(agent.lastUpdateAt)
                Text(
                    text = timeText,
                    style = MaterialTheme.typography.labelSmall,
                    color = LumiOnSurfaceTertiary
                )
            }
        }
    }
}

/**
 * Top bar shown during multi-select mode with selection count, Archive, and Cancel actions.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MultiSelectTopBar(
    selectedCount: Int,
    isArchiving: Boolean,
    isGrouping: Boolean,
    onArchive: () -> Unit,
    onGroup: () -> Unit,
    onClear: () -> Unit
) {
    CenterAlignedTopAppBar(
        navigationIcon = {
            IconButton(onClick = onClear) {
                Icon(
                    imageVector = Icons.Default.Close,
                    contentDescription = "Cancel selection",
                    tint = LumiOnSurface
                )
            }
        },
        title = {
            Text(
                text = "$selectedCount selected",
                style = MaterialTheme.typography.titleMedium,
                color = LumiOnSurface
            )
        },
        actions = {
            IconButton(
                onClick = onGroup,
                enabled = !isGrouping && selectedCount > 0
            ) {
                if (isGrouping) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        color = LumiOnSurface,
                        strokeWidth = 2.dp
                    )
                } else {
                    Icon(
                        imageVector = Icons.Default.FolderOpen,
                        contentDescription = "Group",
                        tint = LumiOnSurface
                    )
                }
            }
            Button(
                onClick = onArchive,
                enabled = !isArchiving && selectedCount > 0,
                colors = ButtonDefaults.buttonColors(
                    containerColor = LumiPurple500,
                    contentColor = LumiOnSurface
                ),
                modifier = Modifier.padding(end = 8.dp)
            ) {
                if (isArchiving) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(16.dp),
                        color = LumiOnSurface,
                        strokeWidth = 2.dp
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                }
                Icon(
                    imageVector = Icons.Default.Archive,
                    contentDescription = null,
                    modifier = Modifier.size(16.dp)
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text("Archive")
            }
        },
        colors = TopAppBarDefaults.centerAlignedTopAppBarColors(
            containerColor = LumiPurple500.copy(alpha = 0.12f),
            titleContentColor = LumiOnSurface
        )
    )
}

/**
 * Small colored badge for counts (unread updates, etc.).
 */
@Composable
private fun Badge(text: String, color: androidx.compose.ui.graphics.Color) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(10.dp))
            .background(color.copy(alpha = 0.2f))
            .padding(horizontal = 6.dp, vertical = 2.dp)
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelSmall,
            color = color
        )
    }
}

/**
 * Sort option selector — compact dropdown using a FilterChip with a sort icon.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SortChipRow(
    selectedSort: SortOption,
    onSortChanged: (SortOption) -> Unit
) {
    var expanded by remember { mutableStateOf(false) }

    Box {
        FilterChip(
            selected = true,
            onClick = { expanded = !expanded },
            label = {
                Text(
                    text = selectedSort.label,
                    style = MaterialTheme.typography.labelMedium
                )
            },
            leadingIcon = {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.Sort,
                    contentDescription = "Sort",
                    modifier = Modifier.size(16.dp)
                )
            },
            colors = FilterChipDefaults.filterChipColors(
                selectedContainerColor = LumiPurple500.copy(alpha = 0.2f),
                selectedLabelColor = LumiOnSurface
            ),
            border = FilterChipDefaults.filterChipBorder(
                selectedBorderColor = LumiPurple500.copy(alpha = 0.5f),
                borderColor = LumiOnSurfaceTertiary.copy(alpha = 0.3f),
                enabled = true,
                selected = true
            )
        )
        androidx.compose.material3.DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false }
        ) {
            SortOption.entries.forEach { option ->
                androidx.compose.material3.DropdownMenuItem(
                    text = {
                        Text(
                            text = option.label,
                            color = if (option == selectedSort) LumiPurple500 else LumiOnSurface
                        )
                    },
                    onClick = {
                        onSortChanged(option)
                        expanded = false
                    }
                )
            }
        }
    }
}

/**
 * Card representing a named window group with its agents shown as nested cards when expanded.
 */
@Composable
private fun GroupCard(
    groupName: String,
    agents: List<Agent>,
    isExpanded: Boolean,
    onToggle: () -> Unit,
    onResume: () -> Unit
) {
    val liveCount = agents.count { it.isLive }
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .animateContentSize(),
        colors = CardDefaults.cardColors(containerColor = LumiCard),
        shape = RoundedCornerShape(12.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { onToggle() }
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = Icons.Default.FolderOpen,
                contentDescription = null,
                tint = LumiPurple500,
                modifier = Modifier.size(18.dp)
            )
            Spacer(modifier = Modifier.width(10.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = groupName,
                    style = MaterialTheme.typography.titleSmall,
                    color = LumiOnSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = "${agents.size} agent${if (agents.size != 1) "s" else ""}${if (liveCount > 0) " · $liveCount live" else ""}",
                    style = MaterialTheme.typography.bodySmall,
                    color = LumiOnSurfaceSecondary
                )
            }
            if (liveCount > 0) {
                IconButton(
                    onClick = onResume,
                    modifier = Modifier.size(32.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.PlayArrow,
                        contentDescription = "Resume group",
                        tint = LumiPurple500,
                        modifier = Modifier.size(18.dp)
                    )
                }
            }
            Icon(
                imageVector = if (isExpanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                contentDescription = if (isExpanded) "Collapse" else "Expand",
                tint = LumiOnSurfaceTertiary,
                modifier = Modifier.size(20.dp)
            )
        }
    }
}

/**
 * Dialog for naming a window group when grouping selected agents.
 */
@Composable
private fun GroupDialog(
    existingGroups: List<String>,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit
) {
    var groupName by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Group Agents", style = MaterialTheme.typography.headlineSmall) },
        text = {
            Column(modifier = Modifier.fillMaxWidth()) {
                if (existingGroups.isNotEmpty()) {
                    Text(
                        text = "Join existing group:",
                        style = MaterialTheme.typography.bodySmall,
                        color = LumiOnSurfaceSecondary,
                        modifier = Modifier.padding(bottom = 8.dp)
                    )
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        existingGroups.forEach { g ->
                            Button(
                                onClick = { onConfirm(g) },
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = if (groupName == g) LumiPurple500 else LumiPurple500.copy(alpha = 0.15f),
                                    contentColor = if (groupName == g) LumiOnSurface else LumiPurple500
                                )
                            ) {
                                Text(g, style = MaterialTheme.typography.labelMedium)
                            }
                        }
                    }
                    Spacer(modifier = Modifier.height(12.dp))
                    Text(
                        text = "or create new group:",
                        style = MaterialTheme.typography.bodySmall,
                        color = LumiOnSurfaceSecondary,
                        modifier = Modifier.padding(bottom = 8.dp)
                    )
                }
                OutlinedTextField(
                    value = groupName,
                    onValueChange = { groupName = it },
                    label = { Text("Group name") },
                    placeholder = { Text("e.g. assistants, research") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = LumiPurple500,
                        cursorColor = LumiPurple500
                    )
                )
            }
        },
        confirmButton = {
            Button(
                onClick = { if (groupName.isNotBlank()) onConfirm(groupName.trim()) },
                enabled = groupName.isNotBlank(),
                colors = ButtonDefaults.buttonColors(containerColor = LumiPurple500)
            ) {
                Text("Group")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel", color = LumiOnSurfaceSecondary)
            }
        }
    )
}

/**
 * Connection status indicator dot in the top app bar.
 */
@Composable
private fun ConnectionDot(state: SSEClient.ConnectionState) {
    val color = when (state) {
        SSEClient.ConnectionState.CONNECTED -> LumiSuccess
        SSEClient.ConnectionState.CONNECTING -> LumiWarning
        SSEClient.ConnectionState.DISCONNECTED -> LumiError
    }
    Box(
        modifier = Modifier
            .size(8.dp)
            .clip(CircleShape)
            .background(color)
    )
}
