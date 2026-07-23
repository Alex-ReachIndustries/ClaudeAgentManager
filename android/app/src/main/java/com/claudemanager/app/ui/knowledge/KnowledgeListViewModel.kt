package com.claudemanager.app.ui.knowledge

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.claudemanager.app.ClaudeManagerApp
import com.claudemanager.app.data.models.CategoryRow
import com.claudemanager.app.data.models.EntryCategory
import com.claudemanager.app.data.models.KbProfile
import com.claudemanager.app.data.models.KbStats
import com.claudemanager.app.data.models.KnowledgeEntry
import com.claudemanager.app.data.models.KnowledgeResult
import com.claudemanager.app.data.models.RelatedEntry
import com.claudemanager.app.data.models.TreeNode
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * UI state for the Knowledge Hub browse/search screen.
 */
/** Which top-of-screen mode is active. */
enum class KnowledgeMode { SEARCH, BROWSE }

data class KnowledgeListUiState(
    val mode: KnowledgeMode = KnowledgeMode.SEARCH,
    val searchQuery: String = "",
    val typeFilter: String = "all",          // "all" | "knowledge" | "profile"
    val results: List<KnowledgeResult> = emptyList(),
    val embeddingsReady: Boolean = false,
    val stats: KbStats? = null,
    val isSearching: Boolean = false,
    val hasSearched: Boolean = false,
    val error: String? = null,
    // Browse (category tree)
    val tree: List<TreeNode> = emptyList(),
    val loadingTree: Boolean = false,
    val expandedNodeIds: Set<Int> = emptySet(),
    val selectedCategoryId: Int? = null,
    val selectedCategoryName: String? = null,
    val browseEntries: List<KnowledgeEntry> = emptyList(),
    val loadingBrowse: Boolean = false,
    // All categories (flat) — used by the "add category" picker + management
    val allCategories: List<CategoryRow> = emptyList(),
    // Detail dialog
    val selectedEntry: KnowledgeEntry? = null,
    val loadingDetail: Boolean = false,
    val relatedEntries: List<RelatedEntry> = emptyList(),
    val loadingRelated: Boolean = false,
    val detailCategories: List<EntryCategory> = emptyList(),
    val showCategoryPicker: Boolean = false,
    // Profile detail dialog
    val profileDetail: KbProfile? = null,
    val loadingProfile: Boolean = false,
    // Category management dialog (create / rename / delete)
    val categoryDialog: CategoryDialogState? = null,
    // Propose dialog
    val showProposeDialog: Boolean = false,
    val isProposing: Boolean = false,
    // Snackbar
    val snackbarMessage: String? = null
)

/** State for the create/rename category dialog. */
data class CategoryDialogState(
    val editingId: Int? = null,             // null = create, non-null = rename
    val name: String = "",
    val description: String = "",
    val parentId: Int? = null,
    val busy: Boolean = false
) {
    val isEdit: Boolean get() = editingId != null
}

/**
 * ViewModel for the Knowledge Hub list/search screen. Debounces search input,
 * loads a stats header, and polls stats so the pending-queue badge stays fresh.
 */
class KnowledgeListViewModel(application: Application) : AndroidViewModel(application) {

    private val app = application as ClaudeManagerApp
    private val repository = app.repository

    private val _uiState = MutableStateFlow(KnowledgeListUiState())
    val uiState: StateFlow<KnowledgeListUiState> = _uiState.asStateFlow()

    private var searchJob: Job? = null

    init {
        loadStats()
        startStatsPolling()
    }

    private fun startStatsPolling() {
        viewModelScope.launch {
            while (isActive) {
                delay(15_000)
                loadStats()
            }
        }
    }

    /** Refresh the stats header (also refreshes the pending-queue badge). */
    fun loadStats() {
        viewModelScope.launch {
            repository.getKbStats()
                .onSuccess { stats -> _uiState.update { it.copy(stats = stats) } }
        }
    }

    // ── Mode switching ──────────────────────────────────────────────────

    fun setMode(mode: KnowledgeMode) {
        _uiState.update { it.copy(mode = mode) }
        if (mode == KnowledgeMode.BROWSE && _uiState.value.tree.isEmpty()) {
            loadTree()
        }
    }

    // ── Browse: category tree ───────────────────────────────────────────

    /** Load the nested category tree and the flat category list (for pickers). */
    fun loadTree() {
        _uiState.update { it.copy(loadingTree = true) }
        viewModelScope.launch {
            repository.getKbTree()
                .onSuccess { tree ->
                    _uiState.update { it.copy(tree = tree, loadingTree = false, error = null) }
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(loadingTree = false, error = e.message ?: "Failed to load categories")
                    }
                }
        }
        viewModelScope.launch {
            repository.getKbCategories().onSuccess { cats ->
                _uiState.update { it.copy(allCategories = cats) }
            }
        }
    }

    /** Toggle a tree node's expanded/collapsed state by id. */
    fun toggleNode(id: Int) {
        _uiState.update {
            val next = it.expandedNodeIds.toMutableSet()
            if (!next.add(id)) next.remove(id)
            it.copy(expandedNodeIds = next)
        }
    }

    /** Select a category node and load its entries (including descendants). */
    fun selectCategory(node: TreeNode) {
        _uiState.update {
            it.copy(
                selectedCategoryId = node.id,
                selectedCategoryName = node.name,
                loadingBrowse = true,
                browseEntries = emptyList()
            )
        }
        viewModelScope.launch {
            repository.getEntriesByCategory(node.id, descendants = true)
                .onSuccess { entries ->
                    _uiState.update { it.copy(browseEntries = entries, loadingBrowse = false, error = null) }
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(loadingBrowse = false, error = e.message ?: "Failed to load entries")
                    }
                }
        }
    }

    // ── Category management (create / rename / delete) ──────────────────

    fun openCreateCategory(parentId: Int? = null) {
        _uiState.update { it.copy(categoryDialog = CategoryDialogState(parentId = parentId)) }
    }

    fun openRenameCategory(node: TreeNode) {
        _uiState.update {
            it.copy(
                categoryDialog = CategoryDialogState(
                    editingId = node.id,
                    name = node.name,
                    description = node.description,
                    parentId = node.parentId
                )
            )
        }
    }

    fun updateCategoryDialog(name: String? = null, description: String? = null) {
        _uiState.update { st ->
            st.categoryDialog?.let { d ->
                st.copy(categoryDialog = d.copy(
                    name = name ?: d.name,
                    description = description ?: d.description
                ))
            } ?: st
        }
    }

    fun dismissCategoryDialog() {
        _uiState.update { it.copy(categoryDialog = null) }
    }

    /** Persist the create/rename category dialog. */
    fun saveCategory() {
        val dialog = _uiState.value.categoryDialog ?: return
        val name = dialog.name.trim()
        if (name.isBlank()) return
        _uiState.update { it.copy(categoryDialog = dialog.copy(busy = true)) }
        viewModelScope.launch {
            val result = if (dialog.isEdit) {
                repository.updateCategory(
                    id = dialog.editingId!!,
                    name = name,
                    description = dialog.description.trim()
                )
            } else {
                repository.createCategory(
                    name = name,
                    parentId = dialog.parentId,
                    description = dialog.description.trim().ifBlank { null }
                )
            }
            result.onSuccess {
                _uiState.update {
                    it.copy(
                        categoryDialog = null,
                        snackbarMessage = if (dialog.isEdit) "Category renamed" else "Category created"
                    )
                }
                loadTree()
            }.onFailure { e ->
                _uiState.update {
                    it.copy(
                        categoryDialog = dialog.copy(busy = false),
                        snackbarMessage = e.message ?: "Failed to save category"
                    )
                }
            }
        }
    }

    /** Delete a category by id (children re-parent to its parent). */
    fun deleteCategory(id: Int) {
        viewModelScope.launch {
            repository.deleteCategory(id)
                .onSuccess {
                    _uiState.update {
                        val clearSel = if (it.selectedCategoryId == id) {
                            it.copy(selectedCategoryId = null, selectedCategoryName = null, browseEntries = emptyList())
                        } else it
                        clearSel.copy(snackbarMessage = "Category deleted")
                    }
                    loadTree()
                }
                .onFailure { e ->
                    _uiState.update { it.copy(snackbarMessage = e.message ?: "Failed to delete category") }
                }
        }
    }

    fun setSearchQuery(query: String) {
        _uiState.update { it.copy(searchQuery = query) }
        scheduleSearch()
    }

    fun setTypeFilter(type: String) {
        _uiState.update { it.copy(typeFilter = type) }
        if (_uiState.value.searchQuery.isNotBlank()) search()
    }

    private fun scheduleSearch() {
        searchJob?.cancel()
        val query = _uiState.value.searchQuery
        if (query.isBlank()) {
            _uiState.update { it.copy(results = emptyList(), hasSearched = false, error = null) }
            return
        }
        searchJob = viewModelScope.launch {
            delay(400)
            search()
        }
    }

    /** Execute the search immediately for the current query + type filter. */
    fun search() {
        val query = _uiState.value.searchQuery.trim()
        if (query.isBlank()) return
        _uiState.update { it.copy(isSearching = true, error = null) }
        viewModelScope.launch {
            repository.searchKnowledge(query, _uiState.value.typeFilter)
                .onSuccess { resp ->
                    _uiState.update {
                        it.copy(
                            results = resp.results,
                            embeddingsReady = resp.embeddingsReady,
                            isSearching = false,
                            hasSearched = true,
                            error = null
                        )
                    }
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(
                            isSearching = false,
                            hasSearched = true,
                            error = e.message ?: "Search failed"
                        )
                    }
                }
        }
    }

    /** Pull-to-refresh: re-run the search (if any) and reload stats + tree. */
    fun refresh() {
        loadStats()
        if (_uiState.value.mode == KnowledgeMode.BROWSE) {
            loadTree()
            _uiState.value.selectedCategoryId?.let { catId ->
                viewModelScope.launch {
                    repository.getEntriesByCategory(catId, descendants = true).onSuccess { entries ->
                        _uiState.update { it.copy(browseEntries = entries) }
                    }
                }
            }
        }
        if (_uiState.value.searchQuery.isNotBlank()) search()
    }

    /** Open the detail dialog for a knowledge entry by id (loads categories + related). */
    fun openEntry(id: Long) {
        _uiState.update {
            it.copy(
                loadingDetail = true,
                selectedEntry = null,
                relatedEntries = emptyList(),
                detailCategories = emptyList(),
                loadingRelated = true,
                showCategoryPicker = false
            )
        }
        viewModelScope.launch {
            repository.getKnowledgeEntry(id)
                .onSuccess { entry ->
                    _uiState.update {
                        it.copy(
                            selectedEntry = entry,
                            detailCategories = entry.categories ?: emptyList(),
                            loadingDetail = false
                        )
                    }
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(
                            loadingDetail = false,
                            loadingRelated = false,
                            snackbarMessage = e.message ?: "Failed to load entry"
                        )
                    }
                }
        }
        // Make sure the flat category list is available for the picker.
        if (_uiState.value.allCategories.isEmpty()) {
            viewModelScope.launch {
                repository.getKbCategories().onSuccess { cats ->
                    _uiState.update { it.copy(allCategories = cats) }
                }
            }
        }
        loadRelated(id)
    }

    private fun loadRelated(id: Long) {
        _uiState.update { it.copy(loadingRelated = true) }
        viewModelScope.launch {
            repository.getRelated(id)
                .onSuccess { related ->
                    _uiState.update { it.copy(relatedEntries = related, loadingRelated = false) }
                }
                .onFailure {
                    _uiState.update { it.copy(loadingRelated = false) }
                }
        }
    }

    fun closeEntry() {
        _uiState.update {
            it.copy(
                selectedEntry = null,
                loadingDetail = false,
                relatedEntries = emptyList(),
                detailCategories = emptyList(),
                showCategoryPicker = false
            )
        }
    }

    /** Open the profile detail dialog for a person by name. */
    fun openProfile(name: String) {
        _uiState.update { it.copy(loadingProfile = true, profileDetail = null) }
        viewModelScope.launch {
            repository.getKbProfile(name)
                .onSuccess { profile ->
                    _uiState.update { it.copy(profileDetail = profile, loadingProfile = false) }
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(
                            loadingProfile = false,
                            snackbarMessage = e.message ?: "Failed to load profile"
                        )
                    }
                }
        }
    }

    fun closeProfile() {
        _uiState.update { it.copy(profileDetail = null, loadingProfile = false) }
    }

    fun showCategoryPicker(show: Boolean) {
        _uiState.update { it.copy(showCategoryPicker = show) }
    }

    /** Pin a category onto the currently open entry. */
    fun addCategoryToEntry(categoryId: Int) {
        val entryId = _uiState.value.selectedEntry?.id ?: return
        _uiState.update { it.copy(showCategoryPicker = false) }
        viewModelScope.launch {
            repository.addEntryCategory(entryId, categoryId)
                .onSuccess { cats ->
                    _uiState.update { it.copy(detailCategories = cats, snackbarMessage = "Category added") }
                }
                .onFailure { e ->
                    _uiState.update { it.copy(snackbarMessage = e.message ?: "Failed to add category") }
                }
        }
    }

    /** Remove a category membership from the currently open entry. */
    fun removeCategoryFromEntry(categoryId: Int) {
        val entryId = _uiState.value.selectedEntry?.id ?: return
        viewModelScope.launch {
            repository.removeEntryCategory(entryId, categoryId)
                .onSuccess { cats ->
                    _uiState.update { it.copy(detailCategories = cats, snackbarMessage = "Category removed") }
                }
                .onFailure { e ->
                    _uiState.update { it.copy(snackbarMessage = e.message ?: "Failed to remove category") }
                }
        }
    }

    fun showProposeDialog(show: Boolean) {
        _uiState.update { it.copy(showProposeDialog = show) }
    }

    /** Propose a new knowledge entry. */
    fun proposeNew(
        title: String,
        body: String,
        category: String?,
        tags: List<String>,
        systems: List<String>,
        source: String?,
        rationale: String?
    ) {
        _uiState.update { it.copy(isProposing = true) }
        viewModelScope.launch {
            repository.proposeKnowledge(
                kind = "new",
                title = title,
                body = body,
                category = category?.ifBlank { null },
                tags = tags.ifEmpty { null },
                systems = systems.ifEmpty { null },
                source = source?.ifBlank { null },
                agent = "mobile",
                rationale = rationale?.ifBlank { null }
            ).onSuccess { resp ->
                val conflictNote = if (resp.conflicts.isNotEmpty()) {
                    " (${resp.conflicts.size} possible conflict${if (resp.conflicts.size > 1) "s" else ""})"
                } else ""
                _uiState.update {
                    it.copy(
                        isProposing = false,
                        showProposeDialog = false,
                        snackbarMessage = "Proposed for review$conflictNote"
                    )
                }
                loadStats()
            }.onFailure { e ->
                _uiState.update {
                    it.copy(
                        isProposing = false,
                        snackbarMessage = e.message ?: "Failed to propose"
                    )
                }
            }
        }
    }

    fun clearSnackbar() {
        _uiState.update { it.copy(snackbarMessage = null) }
    }
}
