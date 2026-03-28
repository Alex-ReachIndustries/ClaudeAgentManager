package com.claudemanager.app.ui.theme

import androidx.compose.ui.graphics.Color
import com.claudemanager.app.data.models.AgentStatus
import com.claudemanager.app.data.models.MessageStatus
import com.claudemanager.app.data.models.PhaseStatus

// ── Primary / Accent ─────────────────────────────────────────────────────────
val LumiPurple500 = Color(0xFF8B5CF6)
val LumiPurple600 = Color(0xFF7C3AED)
val LumiPurple700 = Color(0xFF6D28D9)
val LumiPurple400 = Color(0xFFA78BFA)
val LumiPurple300 = Color(0xFFC4B5FD)

// ── Surfaces ─────────────────────────────────────────────────────────────────
val LumiBackground = Color(0xFF0F0F14)
val LumiSurface = Color(0xFF18181F)
val LumiCard = Color(0xFF1E1E28)
val LumiCardHover = Color(0xFF2A2A36)
val LumiCardSelected = Color(0xFF2A2A36)

// ── On-Surface Text ──────────────────────────────────────────────────────────
val LumiOnSurface = Color(0xFFE2E2EA)
val LumiOnSurfaceSecondary = Color(0xFF9898A6)
val LumiOnSurfaceTertiary = Color(0xFF6E6E7A)

// ── Semantic ─────────────────────────────────────────────────────────────────
val LumiError = Color(0xFFEF4444)
val LumiSuccess = Color(0xFF22C55E)
val LumiWarning = Color(0xFFF59E0B)
val LumiInfo = Color(0xFF3B82F6)

// ── Agent Status Colors ──────────────────────────────────────────────────────
val StatusActive = Color(0xFF22C55E)
val StatusWorking = Color(0xFF3B82F6)
val StatusIdle = Color(0xFFF59E0B)
val StatusWaiting = Color(0xFFF59E0B)
val StatusCompleted = Color(0xFF6B7280)
val StatusArchived = Color(0xFF4B5563)

/**
 * Returns the display color associated with the given [AgentStatus].
 */
fun agentStatusColor(status: AgentStatus): Color = when (status) {
    AgentStatus.ACTIVE -> StatusActive
    AgentStatus.WORKING -> StatusWorking
    AgentStatus.IDLE -> StatusIdle
    AgentStatus.WAITING_FOR_INPUT -> StatusWaiting
    AgentStatus.COMPLETED -> StatusCompleted
    AgentStatus.ARCHIVED -> StatusArchived
}

/**
 * Returns the display color associated with the given [MessageStatus].
 */
fun messageStatusColor(status: MessageStatus): Color = when (status) {
    MessageStatus.PENDING -> LumiWarning
    MessageStatus.DELIVERED -> LumiInfo
    MessageStatus.ACKNOWLEDGED -> LumiSuccess
    MessageStatus.EXECUTED -> LumiPurple500
}

/**
 * Returns the display color associated with the given [PhaseStatus].
 */
fun phaseStatusColor(status: PhaseStatus): Color = when (status) {
    PhaseStatus.PENDING -> LumiOnSurfaceTertiary
    PhaseStatus.IN_PROGRESS -> LumiInfo
    PhaseStatus.COMPLETED -> LumiSuccess
}
