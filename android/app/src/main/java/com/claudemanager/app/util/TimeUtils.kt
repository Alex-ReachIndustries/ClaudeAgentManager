package com.claudemanager.app.util

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Utility functions for parsing and formatting ISO-8601 timestamps from the
 * ClaudeManager backend. The backend stores timestamps in SQLite's `datetime('now')`
 * format: "YYYY-MM-DD HH:MM:SS" (UTC, no timezone suffix), but may also include
 * a "T" separator and "Z" suffix depending on the endpoint.
 */
object TimeUtils {

    /**
     * Date formats the backend may return. Tried in order.
     */
    private val PARSE_FORMATS = listOf(
        "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",  // Full ISO with millis
        "yyyy-MM-dd'T'HH:mm:ss'Z'",       // ISO without millis
        "yyyy-MM-dd'T'HH:mm:ss.SSSZ",     // ISO with timezone offset
        "yyyy-MM-dd'T'HH:mm:ssZ",          // ISO with timezone offset, no millis
        "yyyy-MM-dd'T'HH:mm:ss.SSS",       // ISO without Z
        "yyyy-MM-dd'T'HH:mm:ss",           // ISO without millis or Z
        "yyyy-MM-dd HH:mm:ss"              // SQLite datetime format
    )

    /**
     * Parse an ISO-8601 timestamp string from the backend into a [Date].
     * Handles multiple common formats. Returns null if parsing fails.
     */
    fun parseIso(isoTimestamp: String): Date? {
        if (isoTimestamp.isBlank()) return null

        val trimmed = isoTimestamp.trim()

        for (format in PARSE_FORMATS) {
            try {
                val sdf = SimpleDateFormat(format, Locale.US)
                sdf.timeZone = TimeZone.getTimeZone("UTC")
                // Lenient = false to avoid weird parsing artifacts
                sdf.isLenient = false
                return sdf.parse(trimmed)
            } catch (_: Exception) {
                // Try next format
            }
        }

        return null
    }

    /**
     * Format an ISO timestamp as a human-readable relative time string.
     *
     * Examples:
     * - "just now" (< 60 seconds)
     * - "2m ago" (2 minutes)
     * - "1h ago" (1 hour)
     * - "3h ago" (3 hours)
     * - "1d ago" (1 day)
     * - "5d ago" (5 days)
     * - "3w ago" (3 weeks, for > 14 days)
     *
     * Returns the input string unchanged if parsing fails.
     */
    fun timeAgo(isoTimestamp: String): String {
        val date = parseIso(isoTimestamp) ?: return isoTimestamp

        val now = System.currentTimeMillis()
        val diffMs = now - date.time

        if (diffMs < 0) return "just now" // Future timestamps

        val seconds = diffMs / 1000
        val minutes = seconds / 60
        val hours = minutes / 60
        val days = hours / 24
        val weeks = days / 7

        return when {
            seconds < 60 -> "just now"
            minutes < 60 -> "${minutes}m ago"
            hours < 24 -> "${hours}h ago"
            days < 14 -> "${days}d ago"
            else -> "${weeks}w ago"
        }
    }

    /**
     * Format an ISO timestamp as a human-readable absolute time string.
     * Uses the device's local timezone.
     *
     * Examples:
     * - "Mar 27, 2:30 PM" (same year)
     * - "Dec 15, 2025, 9:00 AM" (different year)
     *
     * Returns the input string unchanged if parsing fails.
     */
    fun formatTimestamp(isoTimestamp: String): String {
        val date = parseIso(isoTimestamp) ?: return isoTimestamp

        val now = Date()
        val currentYear = SimpleDateFormat("yyyy", Locale.US).format(now)
        val dateYear = SimpleDateFormat("yyyy", Locale.US).apply {
            timeZone = TimeZone.getDefault()
        }.format(date)

        val pattern = if (currentYear == dateYear) {
            "MMM d, h:mm a"
        } else {
            "MMM d, yyyy, h:mm a"
        }

        val sdf = SimpleDateFormat(pattern, Locale.US)
        sdf.timeZone = TimeZone.getDefault()
        return sdf.format(date)
    }

    /**
     * Format an ISO timestamp with full date and time.
     * Always shows the year.
     *
     * Example: "Mar 27, 2026 at 2:30 PM"
     */
    fun formatFull(isoTimestamp: String): String {
        val date = parseIso(isoTimestamp) ?: return isoTimestamp

        val sdf = SimpleDateFormat("MMM d, yyyy 'at' h:mm a", Locale.US)
        sdf.timeZone = TimeZone.getDefault()
        return sdf.format(date)
    }

    /**
     * Format a duration in milliseconds as a human-readable string.
     *
     * Examples:
     * - "< 1m" (under 60 seconds)
     * - "5m" (5 minutes)
     * - "1h 30m" (1.5 hours)
     * - "2d 3h" (over a day)
     */
    fun formatDuration(durationMs: Long): String {
        if (durationMs < 0) return "0m"

        val seconds = durationMs / 1000
        val minutes = seconds / 60
        val hours = minutes / 60
        val days = hours / 24

        return when {
            minutes < 1 -> "< 1m"
            hours < 1 -> "${minutes}m"
            days < 1 -> "${hours}h ${minutes % 60}m"
            else -> "${days}d ${hours % 24}h"
        }
    }

    /**
     * Compute the duration between two ISO timestamps.
     * Returns null if either timestamp cannot be parsed.
     */
    fun durationBetween(startIso: String, endIso: String): Long? {
        val start = parseIso(startIso) ?: return null
        val end = parseIso(endIso) ?: return null
        return end.time - start.time
    }
}
