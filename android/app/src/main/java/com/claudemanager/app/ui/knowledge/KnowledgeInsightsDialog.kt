@file:OptIn(ExperimentalLayoutApi::class)

package com.claudemanager.app.ui.knowledge

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.claudemanager.app.data.models.KbAgentUsage
import com.claudemanager.app.data.models.KbAnalytics
import com.claudemanager.app.data.models.KbEntryUsage
import com.claudemanager.app.data.models.KbQueryStat
import com.claudemanager.app.data.models.KbTimePoint
import com.claudemanager.app.ui.theme.LumiBackground
import com.claudemanager.app.ui.theme.LumiCard
import com.claudemanager.app.ui.theme.LumiInfo
import com.claudemanager.app.ui.theme.LumiOnSurface
import com.claudemanager.app.ui.theme.LumiOnSurfaceSecondary
import com.claudemanager.app.ui.theme.LumiOnSurfaceTertiary
import com.claudemanager.app.ui.theme.LumiPurple500
import com.claudemanager.app.ui.theme.LumiSuccess
import com.claudemanager.app.ui.theme.LumiWarning
import kotlin.math.max
import kotlin.math.roundToInt

private val RANGES = listOf(7, 30, 90)

// Series segment colours (shared by the chart + legend).
private val CSearch = LumiSuccess
private val CView = LumiPurple500
private val CRelated = LumiInfo
private val CPropose = LumiWarning

/**
 * Full-screen Knowledge Hub analytics: usage over time, hit rate, gaps (search
 * terms that found nothing), weak topics, most-used entries and per-agent activity.
 * Mirrors the desktop Insights panel, laid out for mobile.
 */
@Composable
fun KnowledgeInsightsDialog(
    analytics: KbAnalytics?,
    loading: Boolean,
    days: Int,
    onDaysChange: (Int) -> Unit,
    onRefresh: () -> Unit,
    onDismiss: () -> Unit
) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Surface(modifier = Modifier.fillMaxSize(), color = LumiBackground) {
            Column(modifier = Modifier.fillMaxSize()) {
                // ── Top bar ─────────────────────────────────────────────
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(LumiCard)
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "Insights",
                        style = MaterialTheme.typography.titleLarge,
                        color = LumiOnSurface,
                        modifier = Modifier.weight(1f)
                    )
                    // Range chips
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        RANGES.forEach { r ->
                            val selected = r == days
                            Box(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(
                                        if (selected) LumiPurple500.copy(alpha = 0.22f)
                                        else LumiOnSurfaceTertiary.copy(alpha = 0.12f)
                                    )
                                    .clickable { onDaysChange(r) }
                                    .padding(horizontal = 10.dp, vertical = 5.dp)
                            ) {
                                Text(
                                    text = "${r}d",
                                    style = MaterialTheme.typography.labelMedium,
                                    color = if (selected) LumiPurple500 else LumiOnSurfaceTertiary
                                )
                            }
                        }
                    }
                    IconButton(onClick = onRefresh) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh", tint = LumiOnSurfaceSecondary)
                    }
                    IconButton(onClick = onDismiss) {
                        Icon(Icons.Default.Close, contentDescription = "Close", tint = LumiOnSurfaceSecondary)
                    }
                }

                when {
                    analytics == null && loading -> CenterBox { CircularProgressIndicator(color = LumiPurple500) }
                    analytics == null -> CenterBox {
                        Text("No analytics yet.", color = LumiOnSurfaceTertiary)
                    }
                    else -> InsightsContent(analytics)
                }
            }
        }
    }
}

@Composable
private fun CenterBox(content: @Composable () -> Unit) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { content() }
}

@Composable
private fun InsightsContent(a: KbAnalytics) {
    val hitRate = a.search.hitRate?.let { "${(it * 100).roundToInt()}%" } ?: "—"
    val activeAgents = a.byAgent.count { it.agent != "(unknown)" }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        item { Spacer(Modifier.height(2.dp)) }

        // Headline stat cards
        item {
            FlowRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                StatBox("Searches", a.windowTotals.search.toString(), "${a.allTimeTotals.search} all-time", LumiSuccess)
                StatBox("Hit rate", hitRate, "${a.search.misses} found nothing", LumiPurple500)
                StatBox("Reads", (a.windowTotals.view + a.windowTotals.related).toString(), null, LumiInfo)
                StatBox("Contributions", a.windowTotals.propose.toString(), null, LumiWarning)
                StatBox("Active agents", activeAgents.toString(), null, LumiOnSurfaceSecondary)
            }
        }

        // Usage over time
        item {
            InsightCard("Usage over time") {
                UsageBarChart(a.timeseries)
                Spacer(Modifier.height(6.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    LegendDot("searches", CSearch)
                    LegendDot("reads", CView)
                    LegendDot("proposals", CPropose)
                }
                a.search.avgLatencyMs?.let {
                    Text(
                        "avg search ${it.roundToInt()} ms",
                        style = MaterialTheme.typography.labelSmall,
                        color = LumiOnSurfaceTertiary,
                        modifier = Modifier.padding(top = 4.dp)
                    )
                }
            }
        }

        // Gaps
        item {
            InsightCard("Gaps — searches that found nothing", "What to write next.") {
                QueryList(a.gaps, valueColor = LumiWarning) { "${it.times}×" }
            }
        }

        // Most-used
        item {
            InsightCard("Most-used knowledge", "Entries agents actually open.") {
                if (a.topEntries.isEmpty()) EmptyLine()
                else a.topEntries.take(15).forEach { e -> UsageRow(e) }
            }
        }

        // Weak
        item {
            InsightCard("Weak matches — under-served topics", "Only low-relevance results.") {
                QueryList(a.weak, valueColor = LumiOnSurfaceTertiary) { q ->
                    val s = q.avgTopScore?.let { " · ${(it * 100).roundToInt() / 100.0}" } ?: ""
                    "${q.times}×$s"
                }
            }
        }

        // Per-agent
        item {
            InsightCard("Per-agent activity") {
                if (a.byAgent.isEmpty()) EmptyLine()
                else {
                    Row(modifier = Modifier.fillMaxWidth().padding(bottom = 2.dp)) {
                        Text("agent", style = MaterialTheme.typography.labelSmall, color = LumiOnSurfaceTertiary, modifier = Modifier.weight(1f))
                        MiniHeader("search"); MiniHeader("read"); MiniHeader("add")
                    }
                    a.byAgent.take(30).forEach { ag -> AgentRow(ag) }
                }
            }
        }

        // Footer
        item {
            Column(modifier = Modifier.padding(vertical = 4.dp)) {
                Text(
                    "${a.neverAccessed.count} approved entries never opened",
                    style = MaterialTheme.typography.labelSmall,
                    color = LumiOnSurfaceTertiary
                )
                a.loggingSince?.let {
                    Text(
                        "logging since ${it.replace("T", " ")}",
                        style = MaterialTheme.typography.labelSmall,
                        color = LumiOnSurfaceTertiary
                    )
                }
            }
            Spacer(Modifier.height(12.dp))
        }
    }
}

@Composable
private fun StatBox(label: String, value: String, sub: String?, accent: Color) {
    Column(
        modifier = Modifier
            .width(108.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(LumiCard)
            .padding(10.dp)
    ) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = accent)
        Text(value, style = MaterialTheme.typography.titleLarge, color = LumiOnSurface)
        if (sub != null) {
            Text(sub, style = MaterialTheme.typography.labelSmall, color = LumiOnSurfaceTertiary, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun InsightCard(title: String, hint: String? = null, content: @Composable () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = LumiCard),
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall, color = LumiOnSurface)
            if (hint != null) {
                Text(hint, style = MaterialTheme.typography.labelSmall, color = LumiOnSurfaceTertiary, modifier = Modifier.padding(top = 1.dp))
            }
            Spacer(Modifier.height(8.dp))
            content()
        }
    }
}

@Composable
private fun QueryList(items: List<KbQueryStat>, valueColor: Color, value: (KbQueryStat) -> String) {
    if (items.isEmpty()) { EmptyLine(); return }
    Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
        items.take(20).forEach { q ->
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(q.query, style = MaterialTheme.typography.bodySmall, color = LumiOnSurfaceSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Spacer(Modifier.width(8.dp))
                Text(value(q), style = MaterialTheme.typography.labelSmall, color = valueColor)
            }
        }
    }
}

@Composable
private fun UsageRow(e: KbEntryUsage) {
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(e.title ?: "#${e.entryId} (removed)", style = MaterialTheme.typography.bodySmall, color = LumiOnSurfaceSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        Spacer(Modifier.width(8.dp))
        Text(e.views.toString(), style = MaterialTheme.typography.labelSmall, color = LumiPurple500)
    }
}

@Composable
private fun AgentRow(ag: KbAgentUsage) {
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(ag.agent, style = MaterialTheme.typography.bodySmall, color = LumiOnSurfaceSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        MiniValue(ag.searches); MiniValue(ag.reads); MiniValue(ag.proposals)
    }
}

@Composable
private fun MiniHeader(text: String) {
    Text(text, style = MaterialTheme.typography.labelSmall, color = LumiOnSurfaceTertiary, modifier = Modifier.width(46.dp))
}

@Composable
private fun MiniValue(n: Int) {
    Text(n.toString(), style = MaterialTheme.typography.bodySmall, color = LumiOnSurfaceSecondary, modifier = Modifier.width(46.dp))
}

@Composable
private fun LegendDot(label: String, color: Color) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(modifier = Modifier.size(8.dp).clip(RoundedCornerShape(2.dp)).background(color))
        Spacer(Modifier.width(4.dp))
        Text(label, style = MaterialTheme.typography.labelSmall, color = LumiOnSurfaceTertiary)
    }
}

@Composable
private fun EmptyLine() {
    Text("Nothing here yet.", style = MaterialTheme.typography.bodySmall, color = LumiOnSurfaceTertiary)
}

/** Dependency-free stacked bar chart of daily accesses (last ~45 days). */
@Composable
private fun UsageBarChart(series: List<KbTimePoint>) {
    if (series.isEmpty()) {
        Text("No activity recorded in this window yet.", style = MaterialTheme.typography.bodySmall, color = LumiOnSurfaceTertiary)
        return
    }
    val bars = series.takeLast(45)
    val maxTotal = max(1, bars.maxOf { it.total })
    Canvas(modifier = Modifier.fillMaxWidth().height(120.dp)) {
        val n = bars.size
        val gap = 2.dp.toPx()
        val barW = ((size.width - gap * (n - 1)) / n).coerceAtLeast(1f)
        bars.forEachIndexed { i, d ->
            val x = i * (barW + gap)
            var yTop = size.height
            // reads = views + related, grouped under one colour for a cleaner mobile chart
            val segments = listOf(
                d.search to CSearch,
                (d.view + d.related) to CView,
                d.propose to CPropose
            )
            segments.forEach { (v, c) ->
                if (v > 0) {
                    val h = (v.toFloat() / maxTotal) * size.height
                    drawRect(color = c, topLeft = Offset(x, yTop - h), size = Size(barW, h))
                    yTop -= h
                }
            }
        }
    }
    Row(modifier = Modifier.fillMaxWidth().padding(top = 2.dp)) {
        Text(bars.first().date.takeLast(5), style = MaterialTheme.typography.labelSmall, color = LumiOnSurfaceTertiary, modifier = Modifier.weight(1f))
        Text(bars.last().date.takeLast(5), style = MaterialTheme.typography.labelSmall, color = LumiOnSurfaceTertiary)
    }
}
