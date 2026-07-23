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

/** Aggregate Knowledge Hub stats (GET /api/kb/stats). */
data class KbStats(
    @SerializedName("entries") val entries: KbEntryStats = KbEntryStats(),
    @SerializedName("pending_queue") val pendingQueue: Int = 0,
    @SerializedName("flagged_for_review") val flaggedForReview: Int = 0,
    @SerializedName("profiles") val profiles: Int = 0,
    @SerializedName("stale_entries") val staleEntries: Int = 0,
    @SerializedName("stale_profiles") val staleProfiles: Int = 0,
    @SerializedName("embeddingsReady") val embeddingsReady: Boolean = false,
    @SerializedName("embedDim") val embedDim: Int = 0
)
