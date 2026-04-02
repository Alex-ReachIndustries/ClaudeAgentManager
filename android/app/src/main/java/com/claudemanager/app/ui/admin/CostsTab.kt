@file:OptIn(ExperimentalMaterialApi::class)

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.ExperimentalMaterialApi
import androidx.compose.material.pullrefresh.PullRefreshIndicator
import androidx.compose.material.pullrefresh.pullRefresh
import androidx.compose.material.pullrefresh.rememberPullRefreshState
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.claudemanager.app.data.models.AgentCostEntry
import com.claudemanager.app.data.models.CostAnalyticsResponse
import com.claudemanager.app.data.models.CostData
import com.claudemanager.app.ui.theme.LumiCard
import com.claudemanager.app.ui.theme.LumiError
import com.claudemanager.app.ui.theme.LumiOnSurface
import com.claudemanager.app.ui.theme.LumiOnSurfaceSecondary
import com.claudemanager.app.ui.theme.LumiOnSurfaceTertiary
import com.claudemanager.app.ui.theme.LumiPurple500

/**
 * Cost analytics tab showing aggregate costs across all agents
 * and a per-agent breakdown sorted by cost descending.
 * Supports pull-to-refresh.
 */
@Composable
fun CostsTab(
    costAnalytics: CostAnalyticsResponse?,
    isLoading: Boolean,
    error: String?,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier
) {
    val pullRefreshState = rememberPullRefreshState(
        refreshing = isLoading,
        onRefresh = onRefresh
    )

    when {
        isLoading && costAnalytics == null -> {
            Box(
                modifier = modifier,
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator(color = LumiPurple500)
            }
        }

        error != null && costAnalytics == null -> {
            Box(
                modifier = modifier.padding(32.dp),
                contentAlignment = Alignment.Center
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        text = error,
                        style = MaterialTheme.typography.bodyLarge,
                        color = LumiError
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                    TextButton(onClick = onRefresh) {
                        Text("Retry", color = LumiPurple500)
                    }
                }
            }
        }

        costAnalytics != null -> {
            Box(
                modifier = modifier.pullRefresh(pullRefreshState)
            ) {
                val sortedAgents = costAnalytics.agents.sortedByDescending { it.costs.costUsd }

                LazyColumn(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(horizontal = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    item { Spacer(modifier = Modifier.height(4.dp)) }

                    // Total costs summary card
                    item {
                        TotalCostCard(total = costAnalytics.total)
                    }

                    // Per-agent header
                    item {
                        Text(
                            text = "Per-Agent Breakdown",
                            style = MaterialTheme.typography.titleSmall,
                            color = LumiOnSurfaceSecondary
                        )
                    }

                    if (sortedAgents.isEmpty()) {
                        item {
                            Text(
                                text = "No cost data available yet.",
                                style = MaterialTheme.typography.bodyMedium,
                                color = LumiOnSurfaceTertiary,
                                modifier = Modifier.padding(vertical = 16.dp)
                            )
                        }
                    } else {
                        items(sortedAgents, key = { it.id }) { entry ->
                            AgentCostCard(entry = entry)
                        }
                    }

                    item { Spacer(modifier = Modifier.height(16.dp)) }
                }

                PullRefreshIndicator(
                    refreshing = isLoading,
                    state = pullRefreshState,
                    modifier = Modifier.align(Alignment.TopCenter),
                    contentColor = LumiPurple500
                )
            }
        }

        else -> {
            // No data and no error -- show empty state
            Box(
                modifier = modifier.padding(32.dp),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = "No cost data available",
                    style = MaterialTheme.typography.bodyLarge,
                    color = LumiOnSurfaceTertiary
                )
            }
        }
    }
}

/**
 * Summary card showing total token usage and cost across all agents.
 */
@Composable
private fun TotalCostCard(total: CostData) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = LumiPurple500.copy(alpha = 0.1f)),
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            Text(
                text = "Total Costs",
                style = MaterialTheme.typography.titleMedium,
                color = LumiOnSurface,
                fontWeight = FontWeight.SemiBold
            )
            Spacer(modifier = Modifier.height(12.dp))

            CostMetricRow(label = "Input Tokens", value = "%,d".format(total.inputTokens))
            Spacer(modifier = Modifier.height(6.dp))
            CostMetricRow(label = "Output Tokens", value = "%,d".format(total.outputTokens))
            Spacer(modifier = Modifier.height(6.dp))
            HorizontalDivider(color = LumiOnSurfaceTertiary.copy(alpha = 0.2f))
            Spacer(modifier = Modifier.height(6.dp))
            CostMetricRow(
                label = "Total Cost",
                value = "$%,.4f".format(total.costUsd),
                highlight = true
            )
        }
    }
}

/**
 * Card showing cost data for a single agent.
 */
@Composable
private fun AgentCostCard(entry: AgentCostEntry) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = LumiCard),
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp)
        ) {
            Text(
                text = entry.title,
                style = MaterialTheme.typography.bodyLarge,
                color = LumiOnSurface,
                fontWeight = FontWeight.Medium
            )
            if (!entry.projectId.isNullOrBlank()) {
                Text(
                    text = "Project: ${entry.projectId}",
                    style = MaterialTheme.typography.bodySmall,
                    color = LumiOnSurfaceTertiary
                )
            }
            Spacer(modifier = Modifier.height(8.dp))
            CostMetricRow(label = "Input", value = "%,d".format(entry.costs.inputTokens))
            Spacer(modifier = Modifier.height(4.dp))
            CostMetricRow(label = "Output", value = "%,d".format(entry.costs.outputTokens))
            Spacer(modifier = Modifier.height(4.dp))
            CostMetricRow(
                label = "Cost",
                value = "$%,.4f".format(entry.costs.costUsd),
                highlight = true
            )
        }
    }
}

/**
 * A single label-value row for cost metrics.
 */
@Composable
private fun CostMetricRow(label: String, value: String, highlight: Boolean = false) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            color = LumiOnSurfaceSecondary
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodyMedium,
            color = if (highlight) LumiPurple500 else LumiOnSurface,
            fontWeight = if (highlight) FontWeight.SemiBold else FontWeight.Normal
        )
    }
}
