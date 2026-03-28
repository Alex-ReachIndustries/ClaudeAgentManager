package com.claudemanager.app.ui.admin

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.TabRowDefaults
import androidx.compose.material3.TabRowDefaults.tabIndicatorOffset
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.claudemanager.app.ui.theme.LumiBackground
import com.claudemanager.app.ui.theme.LumiCard
import com.claudemanager.app.ui.theme.LumiOnSurface
import com.claudemanager.app.ui.theme.LumiOnSurfaceTertiary
import com.claudemanager.app.ui.theme.LumiPurple500

/**
 * Admin screen with tabs for Webhooks, Retention, and Workflows.
 *
 * @param onBack Callback to navigate back.
 * @param onWorkflowClick Callback when a workflow is clicked, navigating to its detail.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdminScreen(
    onBack: () -> Unit,
    onWorkflowClick: (String) -> Unit,
    viewModel: AdminViewModel = viewModel()
) {
    val state by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    // Show snackbar messages
    LaunchedEffect(state.snackbarMessage) {
        state.snackbarMessage?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearSnackbar()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = "Admin",
                        style = MaterialTheme.typography.titleLarge,
                        color = LumiOnSurface
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            imageVector = Icons.Default.ArrowBack,
                            contentDescription = "Back",
                            tint = LumiOnSurface
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = LumiBackground,
                    titleContentColor = LumiOnSurface
                )
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        containerColor = LumiBackground
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            // Tab row
            val tabs = AdminTab.entries
            TabRow(
                selectedTabIndex = state.selectedTab.ordinal,
                containerColor = LumiBackground,
                contentColor = LumiOnSurface,
                indicator = { tabPositions ->
                    TabRowDefaults.SecondaryIndicator(
                        modifier = Modifier.tabIndicatorOffset(tabPositions[state.selectedTab.ordinal]),
                        color = LumiPurple500
                    )
                },
                divider = {
                    Spacer(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(1.dp)
                            .background(LumiCard)
                    )
                }
            ) {
                tabs.forEach { tab ->
                    Tab(
                        selected = state.selectedTab == tab,
                        onClick = { viewModel.selectTab(tab) },
                        text = {
                            Text(
                                text = when (tab) {
                                    AdminTab.WEBHOOKS -> "Webhooks"
                                    AdminTab.RETENTION -> "Retention"
                                    AdminTab.WORKFLOWS -> "Workflows"
                                },
                                style = MaterialTheme.typography.labelLarge,
                                color = if (state.selectedTab == tab)
                                    LumiPurple500 else LumiOnSurfaceTertiary
                            )
                        }
                    )
                }
            }

            // Tab content
            when (state.selectedTab) {
                AdminTab.WEBHOOKS -> WebhooksTab(
                    webhooks = state.webhooks,
                    isLoading = state.isLoadingWebhooks,
                    error = state.webhookError,
                    onRefresh = viewModel::loadWebhooks,
                    onCreate = viewModel::createWebhook,
                    onUpdate = viewModel::updateWebhook,
                    onDelete = viewModel::deleteWebhook,
                    onTest = viewModel::testWebhook,
                    modifier = Modifier.fillMaxSize()
                )
                AdminTab.RETENTION -> RetentionTab(
                    retentionStatus = state.retentionStatus,
                    isLoading = state.isLoadingRetention,
                    error = state.retentionError,
                    isRunning = state.isRunningRetention,
                    lastRunResult = state.lastRunResult,
                    editArchiveDays = state.editArchiveDays,
                    editUpdateDays = state.editUpdateDays,
                    editMessageDays = state.editMessageDays,
                    editEnabled = state.editEnabled,
                    editDryRun = state.editDryRun,
                    onArchiveDaysChanged = viewModel::onArchiveDaysChanged,
                    onUpdateDaysChanged = viewModel::onUpdateDaysChanged,
                    onMessageDaysChanged = viewModel::onMessageDaysChanged,
                    onEnabledChanged = viewModel::onEnabledChanged,
                    onDryRunChanged = viewModel::onDryRunChanged,
                    onSave = viewModel::saveRetentionSettings,
                    onRunNow = viewModel::runRetention,
                    onRefresh = viewModel::loadRetention,
                    modifier = Modifier.fillMaxSize()
                )
                AdminTab.WORKFLOWS -> WorkflowsTab(
                    workflows = state.workflows,
                    isLoading = state.isLoadingWorkflows,
                    error = state.workflowError,
                    onRefresh = viewModel::loadWorkflows,
                    onCreate = viewModel::createWorkflow,
                    onWorkflowClick = onWorkflowClick,
                    onStart = viewModel::startWorkflow,
                    onPause = viewModel::pauseWorkflow,
                    onDelete = viewModel::deleteWorkflow,
                    modifier = Modifier.fillMaxSize()
                )
            }
        }
    }
}
