package com.claudemanager.app.ui.detail.components

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudemanager.app.ui.theme.LumiOnSurfaceTertiary
import kotlinx.coroutines.launch

/**
 * Monospace scrollable terminal output panel.
 *
 * Displays lines of terminal output received via SSE. Auto-scrolls to the
 * bottom when new output arrives. Shows a placeholder when no output is
 * available yet.
 *
 * @param lines The current terminal output lines (max 200, managed by ViewModel).
 */
@Composable
fun TerminalPanel(
    lines: List<String>,
    modifier: Modifier = Modifier
) {
    val verticalScrollState = rememberScrollState()
    val horizontalScrollState = rememberScrollState()
    val scope = rememberCoroutineScope()

    // Auto-scroll to bottom when new lines arrive
    LaunchedEffect(lines.size) {
        if (lines.isNotEmpty()) {
            scope.launch {
                verticalScrollState.animateScrollTo(verticalScrollState.maxValue)
            }
        }
    }

    if (lines.isEmpty()) {
        Box(
            modifier = modifier.padding(32.dp),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = "No terminal output yet.\nOutput will appear here in real-time when the agent is running.",
                style = MaterialTheme.typography.bodyLarge,
                color = LumiOnSurfaceTertiary
            )
        }
        return
    }

    Box(
        modifier = modifier
            .padding(8.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(Color(0xFF1E1E2E))
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(verticalScrollState)
                .horizontalScroll(horizontalScrollState)
                .padding(12.dp)
        ) {
            Text(
                text = lines.joinToString("\n"),
                fontFamily = FontFamily.Monospace,
                fontSize = 12.sp,
                lineHeight = 16.sp,
                color = Color(0xFFCDD6F4),
                modifier = Modifier.fillMaxWidth()
            )
        }
    }
}
