package com.claudemanager.app.ui.files

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.InsertDriveFile
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
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
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.claudemanager.app.data.models.FileInfo
import com.claudemanager.app.ui.detail.CreateDocumentWithMime
import com.claudemanager.app.ui.detail.mimeTypeForFilename
import com.claudemanager.app.ui.theme.LumiBackground
import com.claudemanager.app.ui.theme.LumiCard
import com.claudemanager.app.ui.theme.LumiError
import com.claudemanager.app.ui.theme.LumiOnSurface
import com.claudemanager.app.ui.theme.LumiOnSurfaceSecondary
import com.claudemanager.app.ui.theme.LumiOnSurfaceTertiary
import com.claudemanager.app.ui.theme.LumiPurple500
import com.claudemanager.app.ui.theme.LumiWarning
import com.claudemanager.app.util.TimeUtils

/**
 * Files tab: every file from every agent in one list, newest first. The search box matches
 * part of the filename, part of the file id, or the start of the agent id. Tapping a file
 * offers Open / Save to Device, same as the agent and project screens.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FilesScreen(
    onOpenAgent: (String) -> Unit = {},
    viewModel: FilesViewModel = viewModel()
) {
    val state by viewModel.uiState.collectAsState()
    val context = LocalContext.current
    val snackbarHostState = remember { SnackbarHostState() }
    val listState = rememberLazyListState()

    // The file picked for Save, held while the SAF picker is open (mirrors ProjectDetailScreen).
    var pendingSaveAgentId by remember { mutableStateOf<String?>(null) }
    var pendingSaveFileId by remember { mutableStateOf<Long?>(null) }
    var pendingSaveFilename by remember { mutableStateOf("") }
    val saveToDeviceLauncher = rememberLauncherForActivityResult(CreateDocumentWithMime()) { uri ->
        val aid = pendingSaveAgentId
        val fid = pendingSaveFileId
        if (uri != null && aid != null && fid != null) {
            viewModel.downloadFileToUri(aid, fid, pendingSaveFilename, uri, context)
        }
        pendingSaveAgentId = null
        pendingSaveFileId = null
        pendingSaveFilename = ""
    }

    LaunchedEffect(state.actionMessage) {
        state.actionMessage?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearActionMessage()
        }
    }

    // Load the next page when the list is scrolled near the end.
    val nearEnd by remember {
        derivedStateOf {
            val last = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            last >= listState.layoutInfo.totalItemsCount - 5
        }
    }
    LaunchedEffect(nearEnd, state.files.size) {
        if (nearEnd) viewModel.loadMore()
    }

    state.pendingFileAction?.let { action ->
        AlertDialog(
            onDismissRequest = { viewModel.dismissFileActionDialog() },
            title = { Text(action.filename, maxLines = 2, overflow = TextOverflow.Ellipsis) },
            text = { Text("Open with an app or save to device storage?") },
            confirmButton = {
                TextButton(onClick = { viewModel.startOpenDownload(context) }) {
                    Text("Open", color = LumiPurple500)
                }
            },
            dismissButton = {
                Row {
                    TextButton(onClick = { viewModel.dismissFileActionDialog() }) { Text("Cancel") }
                    TextButton(onClick = {
                        pendingSaveAgentId = state.pendingFileActionAgentId
                        pendingSaveFileId = action.fileId
                        pendingSaveFilename = action.filename
                        viewModel.dismissFileActionDialog()
                        saveToDeviceLauncher.launch(Pair(action.filename, mimeTypeForFilename(action.filename)))
                    }) {
                        Text("Save to Device", color = LumiPurple500)
                    }
                }
            },
            containerColor = LumiCard,
            titleContentColor = LumiOnSurface,
            textContentColor = LumiOnSurfaceSecondary
        )
    }

    state.activeDownload?.let { dl ->
        AlertDialog(
            onDismissRequest = {},
            title = { Text("Downloading", style = MaterialTheme.typography.titleMedium) },
            text = {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Text(dl.filename, style = MaterialTheme.typography.bodySmall, color = LumiOnSurfaceSecondary,
                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (dl.progress >= 0f) {
                        LinearProgressIndicator(progress = { dl.progress }, modifier = Modifier.fillMaxWidth(), color = LumiPurple500)
                        Text("${(dl.progress * 100).toInt()}%", style = MaterialTheme.typography.labelSmall, color = LumiOnSurfaceTertiary)
                    } else {
                        LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = LumiPurple500)
                    }
                }
            },
            confirmButton = {},
            containerColor = LumiCard,
            titleContentColor = LumiOnSurface,
            textContentColor = LumiOnSurfaceSecondary
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Files", style = MaterialTheme.typography.titleLarge, color = LumiOnSurface) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = LumiBackground)
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        containerColor = LumiBackground
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            OutlinedTextField(
                value = state.query,
                onValueChange = viewModel::onQueryChange,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                placeholder = { Text("Search filename, file id or agent id", color = LumiOnSurfaceTertiary) },
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null, tint = LumiOnSurfaceTertiary) },
                trailingIcon = {
                    if (state.query.isNotEmpty()) {
                        IconButton(onClick = { viewModel.onQueryChange("") }) {
                            Icon(Icons.Default.Clear, contentDescription = "Clear search", tint = LumiOnSurfaceTertiary)
                        }
                    }
                },
                singleLine = true,
                shape = RoundedCornerShape(12.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = LumiPurple500,
                    unfocusedBorderColor = LumiCard,
                    focusedTextColor = LumiOnSurface,
                    unfocusedTextColor = LumiOnSurface,
                    cursorColor = LumiPurple500
                )
            )

            when {
                state.isLoading && state.files.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = LumiPurple500)
                }
                state.error != null && state.files.isEmpty() -> Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(state.error ?: "", color = LumiError, style = MaterialTheme.typography.bodyMedium)
                        TextButton(onClick = { viewModel.refresh() }) { Text("Retry", color = LumiPurple500) }
                    }
                }
                state.files.isEmpty() -> Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                    Text(
                        text = if (state.query.isBlank()) "No files yet." else "No files match \"${state.query}\".",
                        color = LumiOnSurfaceTertiary,
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
                else -> LazyColumn(
                    state = listState,
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(state.files, key = { it.id }) { file ->
                        AllFilesCard(
                            file = file,
                            onClick = { viewModel.showFileActionDialog(file.agentId, file.id, file.filename) },
                            onAgentClick = { onOpenAgent(file.agentId) }
                        )
                    }
                    if (state.isLoadingMore) {
                        item {
                            Box(Modifier.fillMaxWidth().padding(12.dp), contentAlignment = Alignment.Center) {
                                CircularProgressIndicator(color = LumiPurple500, modifier = Modifier.size(24.dp))
                            }
                        }
                    }
                }
            }
        }
    }
}

/** One file row: name, agent (tap to open the agent), size, age, id. */
@Composable
private fun AllFilesCard(file: FileInfo, onClick: () -> Unit, onAgentClick: () -> Unit) {
    val archived = file.agentStatus == "archived"
    Card(
        colors = CardDefaults.cardColors(containerColor = LumiCard),
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth().clickable { onClick() }
    ) {
        Row(modifier = Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Default.InsertDriveFile, contentDescription = null, tint = LumiOnSurfaceTertiary, modifier = Modifier.size(20.dp))
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(file.filename, style = MaterialTheme.typography.bodyMedium, color = LumiOnSurface,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = file.agentTitle ?: file.agentId.take(8),
                        style = MaterialTheme.typography.labelSmall,
                        color = LumiPurple500,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false).clickable { onAgentClick() }
                    )
                    if (archived) {
                        Text("archived", style = MaterialTheme.typography.labelSmall, color = LumiWarning)
                    }
                    Text(file.formattedSize, style = MaterialTheme.typography.labelSmall, color = LumiOnSurfaceTertiary)
                    Text(TimeUtils.timeAgo(file.createdAt), style = MaterialTheme.typography.labelSmall, color = LumiOnSurfaceTertiary)
                    Text("#${file.id}", style = MaterialTheme.typography.labelSmall, color = LumiOnSurfaceTertiary)
                }
                file.description?.takeIf { it.isNotBlank() }?.let {
                    Text(it, style = MaterialTheme.typography.labelSmall, color = LumiOnSurfaceTertiary,
                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}
