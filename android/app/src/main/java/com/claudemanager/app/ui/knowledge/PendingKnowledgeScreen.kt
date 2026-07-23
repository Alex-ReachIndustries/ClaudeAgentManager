@file:OptIn(ExperimentalMaterialApi::class)

package com.claudemanager.app.ui.knowledge

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.ExperimentalMaterialApi
import androidx.compose.material.pullrefresh.PullRefreshIndicator
import androidx.compose.material.pullrefresh.pullRefresh
import androidx.compose.material.pullrefresh.rememberPullRefreshState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import com.claudemanager.app.data.models.ConflictFlag
import com.claudemanager.app.data.models.PendingProposal
import com.claudemanager.app.data.models.ProposalEdits
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
 * Pending Knowledge review queue — its own destination.
 *
 * Lists proposals with title, proposing agent, rationale, highlighted conflict
 * flags, and (for edits) a current-vs-proposed before/after of the body. Each
 * item offers Accept / Update / Reject.
 */
@Composable
fun PendingKnowledgeScreen(
    onBack: () -> Unit,
    viewModel: PendingKnowledgeViewModel = viewModel()
) {
    val state by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    // Refresh whenever the screen is (re)entered.
    LaunchedEffect(Unit) { viewModel.refresh() }

    LaunchedEffect(state.snackbarMessage) {
        state.snackbarMessage?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearSnackbar()
        }
    }

    val pullRefreshState = rememberPullRefreshState(
        refreshing = state.isRefreshing,
        onRefresh = viewModel::refresh
    )

    // Edit / reject dialog targets
    var editTarget by remember { mutableStateOf<PendingProposal?>(null) }
    var rejectTarget by remember { mutableStateOf<PendingProposal?>(null) }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(LumiBackground)
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
            // Header
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(LumiCard)
                    .padding(horizontal = 8.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = LumiOnSurface)
                }
                Text(
                    text = "Pending Knowledge",
                    style = MaterialTheme.typography.titleLarge,
                    color = LumiOnSurface,
                    modifier = Modifier.weight(1f)
                )
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(10.dp))
                        .background(LumiWarning.copy(alpha = 0.18f))
                        .padding(horizontal = 10.dp, vertical = 4.dp)
                ) {
                    Text(
                        text = "${state.proposals.size}",
                        style = MaterialTheme.typography.titleMedium,
                        color = LumiWarning
                    )
                }
                Spacer(modifier = Modifier.width(8.dp))
            }

            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .pullRefresh(pullRefreshState)
            ) {
                when {
                    state.isLoading && state.proposals.isEmpty() -> {
                        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(color = LumiPurple500)
                        }
                    }
                    state.proposals.isEmpty() -> {
                        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Icon(
                                    Icons.Default.Check,
                                    null,
                                    tint = LumiSuccess,
                                    modifier = Modifier.size(48.dp)
                                )
                                Spacer(modifier = Modifier.height(12.dp))
                                Text(
                                    text = state.error ?: "Nothing to review",
                                    style = MaterialTheme.typography.bodyLarge,
                                    color = if (state.error != null) LumiError else LumiOnSurfaceSecondary
                                )
                            }
                        }
                    }
                    else -> {
                        LazyColumn(
                            modifier = Modifier
                                .fillMaxSize()
                                .padding(horizontal = 16.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            item { Spacer(modifier = Modifier.height(6.dp)) }
                            items(state.proposals, key = { it.id }) { proposal ->
                                ProposalCard(
                                    proposal = proposal,
                                    isProcessing = state.processingId == proposal.id,
                                    onAccept = { viewModel.accept(proposal.id) },
                                    onUpdate = { editTarget = proposal },
                                    onReject = { rejectTarget = proposal }
                                )
                            }
                            item { Spacer(modifier = Modifier.height(24.dp)) }
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

        SnackbarHost(
            hostState = snackbarHostState,
            modifier = Modifier.align(Alignment.BottomCenter)
        ) { data ->
            Snackbar(snackbarData = data, containerColor = LumiCard, contentColor = LumiOnSurface)
        }
    }

    // Update (edit) dialog
    editTarget?.let { target ->
        EditProposalDialog(
            proposal = target,
            onDismiss = { editTarget = null },
            onConfirm = { edits, note ->
                viewModel.update(target.id, edits, note)
                editTarget = null
            }
        )
    }

    // Reject confirm dialog
    rejectTarget?.let { target ->
        RejectDialog(
            proposal = target,
            onDismiss = { rejectTarget = null },
            onConfirm = { note ->
                viewModel.reject(target.id, note)
                rejectTarget = null
            }
        )
    }
}

@Composable
private fun ProposalCard(
    proposal: PendingProposal,
    isProcessing: Boolean,
    onAccept: () -> Unit,
    onUpdate: () -> Unit,
    onReject: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = LumiCard),
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            // Kind badge + title
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                KindBadge(kind = proposal.kind)
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = proposal.proposedTitle ?: proposal.currentTitle ?: "(untitled)",
                    style = MaterialTheme.typography.titleSmall,
                    color = LumiOnSurface,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )
            }

            // Proposing agent
            proposal.proposingAgent?.takeIf { it.isNotBlank() }?.let {
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "Proposed by $it",
                    style = MaterialTheme.typography.labelSmall,
                    color = LumiOnSurfaceTertiary
                )
            }

            // Rationale
            proposal.rationale?.takeIf { it.isNotBlank() }?.let {
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = "\"$it\"",
                    style = MaterialTheme.typography.bodySmall,
                    color = LumiOnSurfaceSecondary
                )
            }

            // Conflict flags (highlighted)
            if (proposal.conflictFlags.isNotEmpty()) {
                Spacer(modifier = Modifier.height(8.dp))
                proposal.conflictFlags.forEach { ConflictRow(it) }
            }

            Spacer(modifier = Modifier.height(10.dp))

            // Body: before/after for edits, plain for new
            if (proposal.isEdit) {
                BeforeAfter(
                    before = proposal.currentBody ?: "(no current body)",
                    after = proposal.proposedBody ?: "(no proposed body)"
                )
            } else {
                Text(
                    text = proposal.proposedBody?.takeIf { it.isNotBlank() } ?: "(no body)",
                    style = MaterialTheme.typography.bodySmall,
                    color = LumiOnSurface,
                    maxLines = 6,
                    overflow = TextOverflow.Ellipsis
                )
            }

            Spacer(modifier = Modifier.height(12.dp))

            // Action buttons
            if (isProcessing) {
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = LumiPurple500, modifier = Modifier.size(24.dp))
                }
            } else {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Button(
                        onClick = onAccept,
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.buttonColors(containerColor = LumiSuccess),
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 8.dp, horizontal = 4.dp)
                    ) {
                        Icon(Icons.Default.Check, null, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Accept", style = MaterialTheme.typography.labelMedium)
                    }
                    OutlinedButton(
                        onClick = onUpdate,
                        modifier = Modifier.weight(1f),
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 8.dp, horizontal = 4.dp)
                    ) {
                        Icon(Icons.Default.Edit, null, tint = LumiInfo, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Update", color = LumiInfo, style = MaterialTheme.typography.labelMedium)
                    }
                    OutlinedButton(
                        onClick = onReject,
                        modifier = Modifier.weight(1f),
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 8.dp, horizontal = 4.dp)
                    ) {
                        Icon(Icons.Default.Close, null, tint = LumiError, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Reject", color = LumiError, style = MaterialTheme.typography.labelMedium)
                    }
                }
            }
        }
    }
}

@Composable
private fun KindBadge(kind: String) {
    val (label, color) = if (kind.equals("edit", true)) "EDIT" to LumiWarning else "NEW" to LumiSuccess
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(color.copy(alpha = 0.18f))
            .padding(horizontal = 8.dp, vertical = 3.dp)
    ) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = color)
    }
}

@Composable
private fun ConflictRow(flag: ConflictFlag) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 2.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(LumiError.copy(alpha = 0.12f))
            .padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(Icons.Default.Warning, null, tint = LumiError, modifier = Modifier.size(14.dp))
        Spacer(modifier = Modifier.width(6.dp))
        Column {
            Text(
                text = "Conflict: ${flag.title}",
                style = MaterialTheme.typography.labelSmall,
                color = LumiError
            )
            flag.note?.takeIf { it.isNotBlank() }?.let {
                Text(it, style = MaterialTheme.typography.labelSmall, color = LumiOnSurfaceSecondary)
            }
        }
    }
}

@Composable
private fun BeforeAfter(before: String, after: String) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("CURRENT", style = MaterialTheme.typography.labelSmall, color = LumiOnSurfaceTertiary)
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(8.dp))
                .background(LumiError.copy(alpha = 0.08f))
                .padding(8.dp)
        ) {
            Text(
                text = before,
                style = MaterialTheme.typography.bodySmall,
                color = LumiOnSurfaceSecondary,
                maxLines = 5,
                overflow = TextOverflow.Ellipsis
            )
        }
        Text("PROPOSED", style = MaterialTheme.typography.labelSmall, color = LumiSuccess)
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(8.dp))
                .background(LumiSuccess.copy(alpha = 0.08f))
                .padding(8.dp)
        ) {
            Text(
                text = after,
                style = MaterialTheme.typography.bodySmall,
                color = LumiOnSurface,
                maxLines = 6,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

/**
 * Editable form used when choosing "Update" — prefilled with the proposed values.
 */
@Composable
private fun EditProposalDialog(
    proposal: PendingProposal,
    onDismiss: () -> Unit,
    onConfirm: (ProposalEdits, String?) -> Unit
) {
    var title by remember { mutableStateOf(proposal.proposedTitle ?: proposal.currentTitle ?: "") }
    var body by remember { mutableStateOf(proposal.proposedBody ?: proposal.currentBody ?: "") }
    var category by remember { mutableStateOf(proposal.proposedCategory ?: "") }
    var tags by remember { mutableStateOf((proposal.proposedTags ?: emptyList()).joinToString(", ")) }
    var systems by remember { mutableStateOf((proposal.proposedSystems ?: emptyList()).joinToString(", ")) }
    var source by remember { mutableStateOf(proposal.proposedSource ?: "") }
    var note by remember { mutableStateOf("") }

    val colors = editTextFieldColors()

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = LumiCard,
        titleContentColor = LumiOnSurface,
        textContentColor = LumiOnSurfaceSecondary,
        title = { Text("Update & Accept", style = MaterialTheme.typography.titleLarge) },
        text = {
            Column(
                modifier = Modifier
                    .heightIn(max = 460.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                OutlinedTextField(
                    value = title, onValueChange = { title = it },
                    label = { Text("Title") }, singleLine = true,
                    modifier = Modifier.fillMaxWidth(), colors = colors
                )
                OutlinedTextField(
                    value = body, onValueChange = { body = it },
                    label = { Text("Body") }, minLines = 3, maxLines = 10,
                    modifier = Modifier.fillMaxWidth(), colors = colors
                )
                OutlinedTextField(
                    value = category, onValueChange = { category = it },
                    label = { Text("Category") }, singleLine = true,
                    modifier = Modifier.fillMaxWidth(), colors = colors
                )
                OutlinedTextField(
                    value = tags, onValueChange = { tags = it },
                    label = { Text("Tags (comma-separated)") }, singleLine = true,
                    modifier = Modifier.fillMaxWidth(), colors = colors
                )
                OutlinedTextField(
                    value = systems, onValueChange = { systems = it },
                    label = { Text("Systems (comma-separated)") }, singleLine = true,
                    modifier = Modifier.fillMaxWidth(), colors = colors
                )
                OutlinedTextField(
                    value = source, onValueChange = { source = it },
                    label = { Text("Source") }, singleLine = true,
                    modifier = Modifier.fillMaxWidth(), colors = colors
                )
                OutlinedTextField(
                    value = note, onValueChange = { note = it },
                    label = { Text("Review note (optional)") }, singleLine = true,
                    modifier = Modifier.fillMaxWidth(), colors = colors
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    val edits = ProposalEdits(
                        title = title.trim().ifBlank { null },
                        body = body.trim().ifBlank { null },
                        category = category.trim().ifBlank { null },
                        tags = tags.split(",").map { it.trim() }.filter { it.isNotBlank() }.ifEmpty { null },
                        systems = systems.split(",").map { it.trim() }.filter { it.isNotBlank() }.ifEmpty { null },
                        source = source.trim().ifBlank { null }
                    )
                    onConfirm(edits, note.trim())
                },
                enabled = title.isNotBlank() && body.isNotBlank()
            ) {
                Text("Save & Accept", color = LumiPurple500)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel", color = LumiOnSurfaceTertiary)
            }
        }
    )
}

@Composable
private fun RejectDialog(
    proposal: PendingProposal,
    onDismiss: () -> Unit,
    onConfirm: (String?) -> Unit
) {
    var note by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = LumiCard,
        titleContentColor = LumiOnSurface,
        textContentColor = LumiOnSurfaceSecondary,
        title = { Text("Reject proposal?") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    text = proposal.proposedTitle ?: proposal.currentTitle ?: "(untitled)",
                    style = MaterialTheme.typography.bodyMedium,
                    color = LumiOnSurface
                )
                OutlinedTextField(
                    value = note, onValueChange = { note = it },
                    label = { Text("Reason (optional)") }, singleLine = true,
                    modifier = Modifier.fillMaxWidth(), colors = editTextFieldColors()
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { onConfirm(note.trim()) }) {
                Text("Reject", color = LumiError)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel", color = LumiOnSurfaceTertiary)
            }
        }
    )
}

@Composable
private fun editTextFieldColors() = OutlinedTextFieldDefaults.colors(
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
