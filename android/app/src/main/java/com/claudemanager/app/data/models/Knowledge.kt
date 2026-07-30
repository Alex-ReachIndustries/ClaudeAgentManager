package com.claudemanager.app.data.models

import com.google.gson.annotations.SerializedName

/**
 * Models for the shared Knowledge Hub ("hive mind") — the `/api/kb` endpoints.
 *
 * The Knowledge Hub stores cross-agent knowledge entries and people profiles.
 * Agents propose new entries or edits, which land in a pending review queue that
 * the human approves / updates / rejects from the app.
 */

// ── Search ────────────────────────────────────────────────────────────────

/**
 * A single hit from GET /api/kb/search. [status] is "approved" for verified
 * knowledge; anything else (e.g. "pending") must be surfaced as unverified.
 */
data class KnowledgeResult(
    @SerializedName("id") val id: Long,
    @SerializedName("type") val type: String,          // "knowledge" | "profile"
    @SerializedName("title") val title: String,
    @SerializedName("snippet") val snippet: String = "",
    @SerializedName("status") val status: String = "approved",
    @SerializedName("score") val score: Double = 0.0,
    @SerializedName("tags") val tags: List<String> = emptyList(),
    @SerializedName("systems") val systems: List<String> = emptyList(),
    @SerializedName("categories") val categories: List<EntryCategory>? = null
) {
    /** Whether this result is verified/approved knowledge. */
    val isApproved: Boolean get() = status.equals("approved", ignoreCase = true)
}

/** Response envelope for GET /api/kb/search. */
data class KnowledgeSearchResponse(
    @SerializedName("query") val query: String = "",
    @SerializedName("type") val type: String = "all",
    @SerializedName("embeddingsReady") val embeddingsReady: Boolean = false,
    @SerializedName("results") val results: List<KnowledgeResult> = emptyList()
)

/** Convenience holder for a set of search results plus the embeddings flag. */
data class KbSearchResults(
    val results: List<KnowledgeResult> = emptyList(),
    val embeddingsReady: Boolean = false
)

// ── Full entry ──────────────────────────────────────────────────────────────

/** Full knowledge entry from GET /api/kb/{id}. */
data class KnowledgeEntry(
    @SerializedName("id") val id: Long,
    @SerializedName("title") val title: String,
    @SerializedName("body") val body: String = "",
    @SerializedName("category") val category: String? = null,
    @SerializedName("tags") val tags: List<String> = emptyList(),
    @SerializedName("systems") val systems: List<String> = emptyList(),
    @SerializedName("source") val source: String? = null,
    @SerializedName("status") val status: String = "approved",
    @SerializedName("created_by_agent") val createdByAgent: String? = null,
    @SerializedName("created_at") val createdAt: String? = null,
    @SerializedName("updated_at") val updatedAt: String? = null,
    @SerializedName("hit_count") val hitCount: Int = 0,
    @SerializedName("categories") val categories: List<EntryCategory>? = null
) {
    val isApproved: Boolean get() = status.equals("approved", ignoreCase = true)
}

// ── Category tree ─────────────────────────────────────────────────────────

/**
 * A node in the nested category tree from GET /api/kb/tree.
 * [children] is recursive; [directCount] counts entries pinned directly at this
 * node, [descendantCount] includes all descendants.
 */
data class TreeNode(
    @SerializedName("id") val id: Int,
    @SerializedName("name") val name: String,
    @SerializedName("parent_id") val parentId: Int? = null,
    @SerializedName("description") val description: String = "",
    @SerializedName("sort_order") val sortOrder: Int = 0,
    @SerializedName("direct_count") val directCount: Int = 0,
    @SerializedName("descendant_count") val descendantCount: Int = 0,
    @SerializedName("children") val children: List<TreeNode> = emptyList()
)

/** Response envelope for GET /api/kb/tree. */
data class TreeResponse(
    @SerializedName("tree") val tree: List<TreeNode> = emptyList()
)

/** A flat category row from GET /api/kb/categories (and create/patch results). */
data class CategoryRow(
    @SerializedName("id") val id: Int,
    @SerializedName("name") val name: String,
    @SerializedName("parent_id") val parentId: Int? = null,
    @SerializedName("description") val description: String = "",
    @SerializedName("sort_order") val sortOrder: Int = 0,
    @SerializedName("created_by") val createdBy: String? = null,
    @SerializedName("created_at") val createdAt: String? = null
)

/** Response envelope for GET /api/kb/categories. */
data class CategoriesResponse(
    @SerializedName("data") val data: List<CategoryRow> = emptyList()
)

/** Request body for POST /api/kb/categories and PATCH /api/kb/categories/{id}. */
data class CategoryBody(
    @SerializedName("name") val name: String? = null,
    @SerializedName("parent_id") val parentId: Int? = null,
    @SerializedName("description") val description: String? = null
)

/** A category membership attached to a knowledge entry (breadcrumb + provenance). */
data class EntryCategory(
    @SerializedName("id") val id: Int,
    @SerializedName("name") val name: String,
    @SerializedName("path") val path: String = "",
    @SerializedName("source") val source: String = "auto",   // "auto" | "manual"
    @SerializedName("score") val score: Double? = null
) {
    val isManual: Boolean get() = source.equals("manual", ignoreCase = true)
}

/** Response envelope for GET /api/kb/entries?category=…&descendants=… */
data class EntriesByCategoryResponse(
    @SerializedName("category_id") val categoryId: Int = 0,
    @SerializedName("descendants") val descendants: Boolean = false,
    @SerializedName("data") val data: List<KnowledgeEntry> = emptyList()
)

/** A related entry from GET /api/kb/{id}/related. */
data class RelatedEntry(
    @SerializedName("id") val id: Long,
    @SerializedName("title") val title: String,
    @SerializedName("snippet") val snippet: String = "",
    @SerializedName("score") val score: Double = 0.0,
    @SerializedName("via") val via: String = "semantic"      // "semantic" | "category"
)

/** Response envelope for GET /api/kb/{id}/related. */
data class RelatedResponse(
    @SerializedName("entry_id") val entryId: Long = 0,
    @SerializedName("data") val data: List<RelatedEntry> = emptyList()
)

/** Request body for POST /api/kb/entries/{id}/categories. */
data class MembershipBody(
    @SerializedName("category_id") val categoryId: Int
)

/** Response envelope for membership add/remove endpoints. */
data class MembershipResponse(
    @SerializedName("ok") val ok: Boolean = false,
    @SerializedName("categories") val categories: List<EntryCategory> = emptyList()
)

// ── Propose ──────────────────────────────────────────────────────────────

/** Request body for POST /api/kb/propose. */
data class ProposeKnowledgeBody(
    @SerializedName("kind") val kind: String,            // "new" | "edit"
    @SerializedName("entry_id") val entryId: Long? = null,
    @SerializedName("title") val title: String? = null,
    @SerializedName("body") val body: String? = null,
    @SerializedName("category") val category: String? = null,
    @SerializedName("tags") val tags: List<String>? = null,
    @SerializedName("systems") val systems: List<String>? = null,
    @SerializedName("source") val source: String? = null,
    @SerializedName("agent") val agent: String? = null,
    @SerializedName("rationale") val rationale: String? = null
)

/** A detected conflict between a proposal and an existing entry. */
data class ConflictFlag(
    @SerializedName("entry_id") val entryId: Long,
    @SerializedName("title") val title: String,
    @SerializedName("note") val note: String? = null
)

/** Response from POST /api/kb/propose. */
data class ProposeKnowledgeResponse(
    @SerializedName("entry_id") val entryId: Long? = null,
    @SerializedName("pending_id") val pendingId: Long,
    @SerializedName("conflicts") val conflicts: List<ConflictFlag> = emptyList()
)

// ── Pending queue ─────────────────────────────────────────────────────────

/** A proposal awaiting human review (GET /api/kb/pending). */
data class PendingProposal(
    @SerializedName("id") val id: Long,
    @SerializedName("kind") val kind: String,             // "new" | "edit"
    @SerializedName("entry_id") val entryId: Long? = null,
    @SerializedName("entry_status") val entryStatus: String? = null,
    @SerializedName("proposed_title") val proposedTitle: String? = null,
    @SerializedName("proposed_body") val proposedBody: String? = null,
    @SerializedName("proposed_category") val proposedCategory: String? = null,
    @SerializedName("proposed_tags") val proposedTags: List<String>? = null,
    @SerializedName("proposed_systems") val proposedSystems: List<String>? = null,
    @SerializedName("proposed_source") val proposedSource: String? = null,
    @SerializedName("current_title") val currentTitle: String? = null,
    @SerializedName("current_body") val currentBody: String? = null,
    @SerializedName("proposing_agent") val proposingAgent: String? = null,
    @SerializedName("rationale") val rationale: String? = null,
    @SerializedName("conflict_flags") val conflictFlags: List<ConflictFlag> = emptyList(),
    @SerializedName("review_flag") val reviewFlag: Int = 0,
    @SerializedName("created_at") val createdAt: String? = null
) {
    val isEdit: Boolean get() = kind.equals("edit", ignoreCase = true)
    val isFlagged: Boolean get() = reviewFlag != 0 || conflictFlags.isNotEmpty()
}

/** Response envelope for GET /api/kb/pending. */
data class PendingResponse(
    @SerializedName("data") val data: List<PendingProposal> = emptyList()
)

/** Request body for POST /api/kb/pending/{id}/decide. */
data class DecideProposalBody(
    @SerializedName("decision") val decision: String,     // "accept" | "update" | "reject"
    @SerializedName("edits") val edits: ProposalEdits? = null,
    @SerializedName("note") val note: String? = null,
    @SerializedName("decidedBy") val decidedBy: String? = null
)

/** Editable fields applied when deciding "update". */
data class ProposalEdits(
    @SerializedName("title") val title: String? = null,
    @SerializedName("body") val body: String? = null,
    @SerializedName("category") val category: String? = null,
    @SerializedName("tags") val tags: List<String>? = null,
    @SerializedName("systems") val systems: List<String>? = null,
    @SerializedName("source") val source: String? = null
)

/** Response from POST /api/kb/pending/{id}/decide. */
data class DecideProposalResponse(
    @SerializedName("ok") val ok: Boolean = false,
    @SerializedName("entry_id") val entryId: Long? = null
)

// ── Profiles ────────────────────────────────────────────────────────────

/** A single fact attached to a people profile. */
data class KbProfileFact(
    @SerializedName("fact") val fact: String = "",
    @SerializedName("source") val source: String? = null,
    @SerializedName("at") val at: String? = null,
    @SerializedName("by") val by: String? = null
)

/** A people profile (GET /api/kb/profiles, GET /api/kb/profiles/{name}). */
data class KbProfile(
    @SerializedName("id") val id: Long,
    @SerializedName("name") val name: String,
    @SerializedName("aliases") val aliases: List<String> = emptyList(),
    @SerializedName("role") val role: String? = null,
    @SerializedName("org") val org: String? = null,
    @SerializedName("relationships") val relationships: String? = null,
    @SerializedName("summary") val summary: String = "",
    @SerializedName("facts") val facts: List<KbProfileFact> = emptyList(),
    @SerializedName("created_at") val createdAt: String? = null,
    @SerializedName("updated_at") val updatedAt: String? = null
)

/** Response envelope for GET /api/kb/profiles. */
data class KbProfilesResponse(
    @SerializedName("data") val data: List<KbProfile> = emptyList()
)

// ── Stats ────────────────────────────────────────────────────────────────

/** Entry counts by status. */
data class KbEntryStats(
    @SerializedName("total") val total: Int = 0,
    @SerializedName("approved") val approved: Int = 0,
    @SerializedName("pending") val pending: Int = 0,
    @SerializedName("rejected") val rejected: Int = 0,
    @SerializedName("superseded") val superseded: Int = 0
)

/** Compact 7-day usage pulse embedded in GET /api/kb/stats. */
data class KbUsage7d(
    @SerializedName("accesses") val accesses: Int = 0,
    @SerializedName("searches") val searches: Int = 0,
    @SerializedName("hit_rate") val hitRate: Double? = null
)

/** Aggregate Knowledge Hub stats (GET /api/kb/stats). */
data class KbStats(
    @SerializedName("entries") val entries: KbEntryStats = KbEntryStats(),
    @SerializedName("pending_queue") val pendingQueue: Int = 0,
    @SerializedName("flagged_for_review") val flaggedForReview: Int = 0,
    @SerializedName("profiles") val profiles: Int = 0,
    @SerializedName("stale_entries") val staleEntries: Int = 0,
    @SerializedName("stale_profiles") val staleProfiles: Int = 0,
    @SerializedName("usage_7d") val usage7d: KbUsage7d? = null,
    @SerializedName("embeddingsReady") val embeddingsReady: Boolean = false,
    @SerializedName("embedDim") val embedDim: Int = 0
)

// ── Analytics (GET /api/kb/analytics) ──────────────────────────────────────

/** Access counts by action, over a window. */
data class KbActionTotals(
    @SerializedName("search") val search: Int = 0,
    @SerializedName("view") val view: Int = 0,
    @SerializedName("related") val related: Int = 0,
    @SerializedName("propose") val propose: Int = 0
)

/** One day of the usage time series. */
data class KbTimePoint(
    @SerializedName("date") val date: String = "",
    @SerializedName("search") val search: Int = 0,
    @SerializedName("view") val view: Int = 0,
    @SerializedName("related") val related: Int = 0,
    @SerializedName("propose") val propose: Int = 0
) {
    val total: Int get() = search + view + related + propose
}

/** Aggregate search effectiveness over the window. */
data class KbSearchAgg(
    @SerializedName("total") val total: Int = 0,
    @SerializedName("hits") val hits: Int = 0,
    @SerializedName("misses") val misses: Int = 0,
    @SerializedName("hit_rate") val hitRate: Double? = null,
    @SerializedName("avg_latency_ms") val avgLatencyMs: Double? = null
)

/** A grouped search term (gaps / weak / top queries). */
data class KbQueryStat(
    @SerializedName("query") val query: String = "",
    @SerializedName("times") val times: Int = 0,
    @SerializedName("hits") val hits: Int = 0,
    @SerializedName("avg_top_score") val avgTopScore: Double? = null,
    @SerializedName("last_at") val lastAt: String? = null
)

/** A most-used entry row. */
data class KbEntryUsage(
    @SerializedName("entry_id") val entryId: Long = 0,
    @SerializedName("title") val title: String? = null,
    @SerializedName("status") val status: String? = null,
    @SerializedName("views") val views: Int = 0,
    @SerializedName("last_at") val lastAt: String? = null
)

/** Per-agent activity row. */
data class KbAgentUsage(
    @SerializedName("agent") val agent: String = "",
    @SerializedName("searches") val searches: Int = 0,
    @SerializedName("views") val views: Int = 0,
    @SerializedName("related") val related: Int = 0,
    @SerializedName("proposals") val proposals: Int = 0,
    @SerializedName("total") val total: Int = 0,
    @SerializedName("last_at") val lastAt: String? = null
) {
    val reads: Int get() = views + related
}

/** An approved-but-never-opened entry (dead weight). */
data class KbNeverAccessedEntry(
    @SerializedName("id") val id: Long = 0,
    @SerializedName("title") val title: String = "",
    @SerializedName("created_at") val createdAt: String? = null
)

data class KbNeverAccessed(
    @SerializedName("count") val count: Int = 0,
    @SerializedName("sample") val sample: List<KbNeverAccessedEntry> = emptyList()
)

/** Full analytics payload from GET /api/kb/analytics?days=N. */
data class KbUptakeTargets(
    @SerializedName("searches_per_task") val searchesPerTask: Double = 2.0,
    @SerializedName("proposals_per_task") val proposalsPerTask: Double = 0.3,
    @SerializedName("surface_open_rate") val surfaceOpenRate: Double = 0.3,
)

/** Uptake measured against work volume — the honest measure (ratios, not vanity counts). */
data class KbUptake(
    @SerializedName("tasks") val tasks: Int = 0,
    @SerializedName("substantive_outputs") val substantiveOutputs: Int = 0,
    @SerializedName("searches_per_task") val searchesPerTask: Double = 0.0,
    @SerializedName("proposals_per_task") val proposalsPerTask: Double = 0.0,
    @SerializedName("searches_per_output") val searchesPerOutput: Double = 0.0,
    @SerializedName("surface_open_rate") val surfaceOpenRate: Double? = null,
    @SerializedName("targets") val targets: KbUptakeTargets = KbUptakeTargets(),
)

data class KbAnalytics(
    @SerializedName("days") val days: Int = 30,
    @SerializedName("logging_since") val loggingSince: String? = null,
    @SerializedName("uptake") val uptake: KbUptake? = null,
    @SerializedName("window_totals") val windowTotals: KbActionTotals = KbActionTotals(),
    @SerializedName("all_time_totals") val allTimeTotals: KbActionTotals = KbActionTotals(),
    @SerializedName("timeseries") val timeseries: List<KbTimePoint> = emptyList(),
    @SerializedName("search") val search: KbSearchAgg = KbSearchAgg(),
    @SerializedName("gaps") val gaps: List<KbQueryStat> = emptyList(),
    @SerializedName("weak") val weak: List<KbQueryStat> = emptyList(),
    @SerializedName("top_queries") val topQueries: List<KbQueryStat> = emptyList(),
    @SerializedName("top_entries") val topEntries: List<KbEntryUsage> = emptyList(),
    @SerializedName("by_agent") val byAgent: List<KbAgentUsage> = emptyList(),
    @SerializedName("never_accessed") val neverAccessed: KbNeverAccessed = KbNeverAccessed()
)
