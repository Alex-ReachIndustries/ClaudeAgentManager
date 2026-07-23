@file:OptIn(ExperimentalMaterialApi::class, ExperimentalLayoutApi::class)

package com.claudemanager.app.ui.knowledge

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.MenuBook
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.RateReview
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.claudemanager.app.data.models.KnowledgeEntry
import com.claudemanager.app.data.models.KnowledgeResult
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
 * Knowledge Hub browse/search screen.
 *
 * Features:
 * - Stats header (entries / pending / embeddings)
 * - A prominent "Pending (N)" button that navigates to the review queue
 * - Search field with a type filter (All / Knowledge / Profiles)
 * - LazyColumn of result cards, with an explicit PENDING·unverified badge for
 *   non-approved entries
 * - Tapping a knowledge card opens a detail dialog (full body)
 * - FAB to propose a new knowledge entry
 *
 * @param onPendingClick Navigate to the dedicated Pending Knowledge screen.
 */
@Composable
fun KnowledgeListScreen(
    onPendingClick: () -> Unit,
    viewModel: KnowledgeListViewModel = viewModel()
) {
    val state by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(state.snackbarMessage) {
        state.snackbarMessage?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearSnackbar()
        }
    }

    val pullRefreshState = rememberPullRefreshState(
        refreshing = state.isSearching,
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
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                // Stats header + pending button
                item {
                    Spacer(modifier = Modifier.height(4.dp))
                    StatsHeader(
                        state = state,
                        onPendingClick = onPendingClick
                    )
                }

                // Search bar
                item {
                    OutlinedTextField(
                        value = state.searchQuery,
                        onValueChange = viewModel::setSearchQuery,
                        placeholder = { Text("Search the hive mind...") },
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

                // Type filter chips
                item {
                    val types = listOf("all" to "All", "knowledge" to "Knowledge", "profile" to "Profiles")
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        types.forEach { (value, label) ->
                            val isSelected = state.typeFilter == value
                            Box(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(16.dp))
                                    .background(
                                        if (isSelected) LumiPurple500.copy(alpha = 0.2f) else LumiCard
                                    )
                                    .clickable { viewModel.setTypeFilter(value) }
                                    .padding(horizontal = 12.dp, vertical = 6.dp)
                            ) {
                                Text(
                                    text = label,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = if (isSelected) LumiPurple500 else LumiOnSurfaceTertiary
                                )
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

                // Empty / results
                if (state.results.isEmpty() && !state.isSearching) {
                    item {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 48.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Icon(
                                    imageVector = Icons.Default.MenuBook,
                                    contentDescription = null,
                                    modifier = Modifier.size(48.dp),
                                    tint = LumiOnSurfaceTertiary
                                )
                                Spacer(modifier = Modifier.height(12.dp))
                                Text(
                                    text = if (state.hasSearched) "No matches" else "Search the shared Knowledge Hub",
                                    style = MaterialTheme.typography.bodyLarge,
                                    color = LumiOnSurfaceSecondary
                                )
                            }
                        }
                    }
                } else {
                    items(state.results, key = { "${it.type}:${it.id}" }) { result ->
                        KnowledgeCard(
                            result = result,
                            onClick = {
                                if (result.type == "knowledge") viewModel.openEntry(result.id)
                            }
                        )
                    }
                }

                item { Spacer(modifier = Modifier.height(80.dp)) }
            }

            PullRefreshIndicator(
                refreshing = state.isSearching,
                state = pullRefreshState,
                modifier = Modifier.align(Alignment.TopCenter),
                contentColor = LumiPurple500
            )
        }

        // FAB — propose new knowledge
        FloatingActionButton(
            onClick = { viewModel.showProposeDialog(true) },
            containerColor = LumiPurple500,
            contentColor = LumiOnSurface,
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(16.dp)
        ) {
            Icon(Icons.Default.Add, contentDescription = "Propose Knowledge")
        }

        SnackbarHost(
            hostState = snackbarHostState,
            modifier = Modifier.align(Alignment.BottomCenter)
        ) { data ->
            Snackbar(snackbarData = data, containerColor = LumiCard, contentColor = LumiOnSurface)
        }
    }

    // Detail dialog
    if (state.loadingDetail || state.selectedEntry != null) {
        KnowledgeDetailDialog(
            entry = state.selectedEntry,
            loading = state.loadingDetail,
            onDismiss = viewModel::closeEntry
        )
    }

    // Propose dialog
    if (state.showProposeDialog) {
        ProposeKnowledgeDialog(
            isProposing = state.isProposing,
            onDismiss = { viewModel.showProposeDialog(false) },
            onSubmit = { title, body, category, tags, systems, source, rationale ->
                viewModel.proposeNew(title, body, category, tags, systems, source, rationale)
            }
        )
    }
}

/**
 * Stats header row: entries total/approved/pending + embeddings state, and a
 * "Pending (N)" button that jumps to the review queue.
 */
@Composable
private fun StatsHeader(
    state: KnowledgeListUiState,
    onPendingClick: () -> Unit
) {
    val stats = state.stats
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = LumiCard),
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    imageVector = Icons.Default.MenuBook,
                    contentDescription = null,
                    tint = LumiPurple500,
                    modifier = Modifier.size(18.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "Knowledge Hub",
                    style = MaterialTheme.typography.titleMedium,
                    color = LumiOnSurface,
                    modifier = Modifier.weight(1f)
                )
                // Embeddings readiness dot
                val embReady = state.embeddingsReady || (stats?.embeddingsReady == true)
                Box(
                    modifier = Modifier
                        .size(8.dp)
                        .clip(RoundedCornerShape(4.dp))
                        .background(if (embReady) LumiSuccess else LumiOnSurfaceTertiary)
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = if (embReady) "embeddings" else "keyword-only",
                    style = MaterialTheme.typography.labelSmall,
                    color = LumiOnSurfaceTertiary
                )
            }

            Spacer(modifier = Modifier.height(10.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                StatPill(
                    label = "Entries",
                    value = (stats?.entries?.approved ?: 0).toString(),
                    color = LumiInfo,
                    modifier = Modifier.weight(1f)
                )
                StatPill(
                    label = "Profiles",
                    value = (stats?.profiles ?: 0).toString(),
                    color = LumiPurple500,
                    modifier = Modifier.weight(1f)
                )

                // Pending button/badge — navigates to the review queue
                val pending = stats?.pendingQueue ?: 0
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(10.dp))
                        .background(
                            if (pending > 0) LumiWarning.copy(alpha = 0.18f)
                            else LumiOnSurfaceTertiary.copy(alpha = 0.12f)
                        )
                        .clickable(onClick = onPendingClick)
                        .padding(horizontal = 10.dp, vertical = 8.dp)
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            imageVector = Icons.Default.RateReview,
                            contentDescription = null,
                            tint = if (pending > 0) LumiWarning else LumiOnSurfaceTertiary,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Column {
                            Text(
                                text = "Pending",
                                style = MaterialTheme.typography.labelSmall,
                                color = if (pending > 0) LumiWarning else LumiOnSurfaceTertiary
                            )
                            Text(
                                text = pending.toString(),
                                style = MaterialTheme.typography.titleMedium,
                                color = if (pending > 0) LumiWarning else LumiOnSurfaceSecondary
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun StatPill(
    label: String,
    value: String,
    color: Color,
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(10.dp))
            .background(color.copy(alpha = 0.12f))
            .padding(horizontal = 10.dp, vertical = 8.dp)
    ) {
        Column {
            Text(
                text = label,
                style = MaterialTheme.typography.labelSmall,
                color = color
            )
            Text(
                text = value,
                style = MaterialTheme.typography.titleMedium,
                color = LumiOnSurface
            )
        }
    }
}

/**
 * A single search-result card.
 */
@Composable
private fun KnowledgeCard(result: KnowledgeResult, onClick: () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = LumiCard),
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(
                    text = result.title,
                    style = MaterialTheme.typography.titleSmall,
                    color = LumiOnSurface,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )
                Spacer(modifier = Modifier.width(8.dp))
                TypeBadge(type = result.type)
            }

            if (!result.isApproved) {
                Spacer(modifier = Modifier.height(6.dp))
                UnverifiedBadge(status = result.status)
            }

            if (result.snippet.isNotBlank()) {
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = result.snippet,
                    style = MaterialTheme.typography.bodySmall,
                    color = LumiOnSurfaceSecondary,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis
                )
            }

            val chips = result.systems.map { it to LumiInfo } + result.tags.map { it to LumiPurple500 }
            if (chips.isNotEmpty()) {
                Spacer(modifier = Modifier.height(8.dp))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    chips.take(8).forEach { (label, color) ->
                        Chip(label = label, color = color)
                    }
                }
            }
        }
    }
}

@Composable
private fun TypeBadge(type: String) {
    val (label, color, icon) = when (type) {
        "profile" -> Triple("Profile", LumiPurple500, Icons.Default.Person)
        else -> Triple("Knowledge", LumiInfo, Icons.Default.MenuBook)
    }
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(color.copy(alpha = 0.18f))
            .padding(horizontal = 8.dp, vertical = 3.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, tint = color, modifier = Modifier.size(12.dp))
            Spacer(modifier = Modifier.width(4.dp))
            Text(label, style = MaterialTheme.typography.labelSmall, color = color)
        }
    }
}

/** Prominent flag for non-approved (pending/unverified) knowledge. */
@Composable
private fun UnverifiedBadge(status: String) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(LumiWarning.copy(alpha = 0.18f))
            .padding(horizontal = 8.dp, vertical = 3.dp)
    ) {
        Text(
            text = "⚠ ${status.uppercase()} · UNVERIFIED",
            style = MaterialTheme.typography.labelSmall,
            color = LumiWarning
        )
    }
}

@Composable
private fun Chip(label: String, color: Color) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(color.copy(alpha = 0.12f))
            .padding(horizontal = 8.dp, vertical = 3.dp)
    ) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = color)
    }
}

/**
 * Detail dialog showing the full body of a knowledge entry.
 */
@Composable
private fun KnowledgeDetailDialog(
    entry: KnowledgeEntry?,
    loading: Boolean,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = LumiCard,
        titleContentColor = LumiOnSurface,
        textContentColor = LumiOnSurfaceSecondary,
        title = {
            Text(
                text = entry?.title ?: "Loading…",
                style = MaterialTheme.typography.titleMedium
            )
        },
        text = {
            if (loading || entry == null) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(24.dp),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator(color = LumiPurple500)
                }
            } else {
                Column(
                    modifier = Modifier
                        .heightIn(max = 420.dp)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    if (!entry.isApproved) {
                        UnverifiedBadge(status = entry.status)
                    }
                    val meta = buildList {
                        entry.category?.takeIf { it.isNotBlank() }?.let { add(it) }
                        entry.createdByAgent?.takeIf { it.isNotBlank() }?.let { add("by $it") }
                        add("${entry.hitCount} hits")
                    }.joinToString(" · ")
                    Text(meta, style = MaterialTheme.typography.labelSmall, color = LumiOnSurfaceTertiary)

                    Text(
                        text = entry.body.ifBlank { "(no body)" },
                        style = MaterialTheme.typography.bodyMedium,
                        color = LumiOnSurface
                    )

                    val chips = entry.systems.map { it to LumiInfo } + entry.tags.map { it to LumiPurple500 }
                    if (chips.isNotEmpty()) {
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            chips.forEach { (label, color) -> Chip(label = label, color = color) }
                        }
                    }
                    entry.source?.takeIf { it.isNotBlank() }?.let {
                        Text("Source: $it", style = MaterialTheme.typography.labelSmall, color = LumiOnSurfaceTertiary)
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("Close", color = LumiPurple500)
            }
        }
    )
}

/**
 * Dialog to propose a new knowledge entry.
 */
@Composable
private fun ProposeKnowledgeDialog(
    isProposing: Boolean,
    onDismiss: () -> Unit,
    onSubmit: (title: String, body: String, category: String?, tags: List<String>, systems: List<String>, source: String?, rationale: String?) -> Unit
) {
    var title by remember { mutableStateOf("") }
    var body by remember { mutableStateOf("") }
    var category by remember { mutableStateOf("") }
    var tags by remember { mutableStateOf("") }
    var systems by remember { mutableStateOf("") }
    var source by remember { mutableStateOf("") }
    var rationale by remember { mutableStateOf("") }

    val colors = OutlinedTextFieldDefaults.colors(
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
        title = { Text("Propose Knowledge", style = MaterialTheme.typography.titleLarge) },
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
                    label = { Text("Body") }, minLines = 3, maxLines = 8,
                    modifier = Modifier.fillMaxWidth(), colors = colors
                )
                OutlinedTextField(
                    value = category, onValueChange = { category = it },
                    label = { Text("Category (optional)") }, singleLine = true,
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
                    label = { Text("Source (optional)") }, singleLine = true,
                    modifier = Modifier.fillMaxWidth(), colors = colors
                )
                OutlinedTextField(
                    value = rationale, onValueChange = { rationale = it },
                    label = { Text("Rationale (optional)") }, minLines = 2, maxLines = 4,
                    modifier = Modifier.fillMaxWidth(), colors = colors
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    onSubmit(
                        title.trim(),
                        body.trim(),
                        category.trim(),
                        tags.split(",").map { it.trim() }.filter { it.isNotBlank() },
                        systems.split(",").map { it.trim() }.filter { it.isNotBlank() },
                        source.trim(),
                        rationale.trim()
                    )
                },
                enabled = !isProposing && title.isNotBlank() && body.isNotBlank()
            ) {
                Text(if (isProposing) "Submitting…" else "Propose", color = LumiPurple500)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel", color = LumiOnSurfaceTertiary)
            }
        }
    )
}
