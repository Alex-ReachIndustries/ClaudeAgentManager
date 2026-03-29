package com.claudemanager.app.ui.navigation

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Tune
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import com.claudemanager.app.data.preferences.AppPreferences
import com.claudemanager.app.ui.admin.AdminScreen
import com.claudemanager.app.ui.admin.WorkflowDetailScreen
import com.claudemanager.app.ui.agents.AgentListScreen
import com.claudemanager.app.ui.detail.AgentDetailScreen
import com.claudemanager.app.ui.projects.ProjectDetailScreen
import com.claudemanager.app.ui.projects.ProjectListScreen
import com.claudemanager.app.ui.setup.SetupScreen
import com.claudemanager.app.ui.theme.LumiBackground
import com.claudemanager.app.ui.theme.LumiCard
import com.claudemanager.app.ui.theme.LumiOnSurface
import com.claudemanager.app.ui.theme.LumiOnSurfaceTertiary
import com.claudemanager.app.ui.theme.LumiPurple500

/**
 * Navigation route constants.
 */
object Routes {
    const val SETUP = "setup"
    const val AGENTS = "agents"
    const val AGENT_DETAIL = "agent/{agentId}"
    const val PROJECTS = "projects"
    const val PROJECT_DETAIL = "project/{projectId}"
    const val ADMIN = "admin"
    const val WORKFLOW_DETAIL = "workflow/{workflowId}"

    fun agentDetail(agentId: String): String = "agent/$agentId"
    fun projectDetail(projectId: String): String = "project/$projectId"
    fun workflowDetail(workflowId: String): String = "workflow/$workflowId"
}

/**
 * Bottom navigation destinations.
 */
enum class BottomNavItem(
    val route: String,
    val label: String,
    val icon: ImageVector
) {
    AGENTS(Routes.AGENTS, "Agents", Icons.Default.People),
    PROJECTS(Routes.PROJECTS, "Projects", Icons.Default.Folder),
    ADMIN(Routes.ADMIN, "Admin", Icons.Default.Tune)
}

/**
 * Routes that show the bottom navigation bar (the three tab destinations).
 */
private val bottomNavRoutes = setOf(Routes.AGENTS, Routes.PROJECTS, Routes.ADMIN)

/**
 * Root navigation graph for the ClaudeManager app.
 *
 * Uses a Scaffold with bottom NavigationBar for the three main destinations:
 * Agents, Projects, and Admin. Sub-routes (agent detail, project detail,
 * workflow detail, setup) are displayed full-screen without the bottom nav.
 *
 * @param preferences App preferences for reading server URL configuration.
 * @param startAgentId Optional agent ID to navigate directly to on launch (e.g. from notification deep link).
 */
@Composable
fun AppNavGraph(
    preferences: AppPreferences,
    startAgentId: String? = null
) {
    val navController: NavHostController = rememberNavController()
    val serverUrl by preferences.serverUrlFlow.collectAsState(initial = "")

    // Determine start destination: setup if no server URL, agents list otherwise
    val startDestination = remember(serverUrl) {
        if (serverUrl.isBlank()) Routes.SETUP else Routes.AGENTS
    }

    // Handle deep link navigation: navigate to agent detail with agents list in back stack
    val deepLinkConsumed = remember { mutableStateOf(false) }
    LaunchedEffect(startAgentId) {
        if (startAgentId != null && !deepLinkConsumed.value) {
            deepLinkConsumed.value = true
            navController.navigate(Routes.agentDetail(startAgentId)) {
                popUpTo(Routes.AGENTS) { inclusive = false }
                launchSingleTop = true
            }
        }
    }

    // Observe current route to determine whether to show bottom nav
    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = navBackStackEntry?.destination?.route
    val showBottomNav = currentRoute in bottomNavRoutes

    Scaffold(
        containerColor = LumiBackground,
        bottomBar = {
            if (showBottomNav) {
                NavigationBar(
                    containerColor = LumiCard,
                    contentColor = LumiOnSurface
                ) {
                    BottomNavItem.entries.forEach { item ->
                        val isSelected = navBackStackEntry?.destination?.hierarchy?.any {
                            it.route == item.route
                        } == true

                        NavigationBarItem(
                            selected = isSelected,
                            onClick = {
                                navController.navigate(item.route) {
                                    // Pop up to the start destination to avoid building up
                                    // a large back stack of tab destinations
                                    popUpTo(navController.graph.findStartDestination().id) {
                                        saveState = true
                                    }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            },
                            icon = {
                                Icon(
                                    imageVector = item.icon,
                                    contentDescription = item.label
                                )
                            },
                            label = {
                                Text(
                                    text = item.label,
                                    style = androidx.compose.material3.MaterialTheme.typography.labelSmall
                                )
                            },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = LumiPurple500,
                                selectedTextColor = LumiPurple500,
                                unselectedIconColor = LumiOnSurfaceTertiary,
                                unselectedTextColor = LumiOnSurfaceTertiary,
                                indicatorColor = LumiPurple500.copy(alpha = 0.15f)
                            )
                        )
                    }
                }
            }
        }
    ) { innerPadding ->
        NavHost(
            navController = navController,
            startDestination = startDestination,
            modifier = Modifier.padding(bottom = innerPadding.calculateBottomPadding())
        ) {
            // ── Setup (full screen, no bottom nav) ──────────────────────
            composable(Routes.SETUP) {
                SetupScreen(
                    onConnected = {
                        navController.navigate(Routes.AGENTS) {
                            popUpTo(Routes.SETUP) { inclusive = true }
                        }
                    }
                )
            }

            // ── Agents tab ──────────────────────────────────────────────
            composable(Routes.AGENTS) {
                AgentListScreen(
                    onAgentClick = { agentId ->
                        navController.navigate(Routes.agentDetail(agentId))
                    },
                    onSettingsClick = {
                        navController.navigate(Routes.SETUP)
                    },
                    startAgentId = null
                )
            }

            // ── Agent Detail (full screen, no bottom nav) ───────────────
            composable(
                route = Routes.AGENT_DETAIL,
                arguments = listOf(
                    navArgument("agentId") { type = NavType.StringType }
                )
            ) { backStackEntry ->
                val agentId = backStackEntry.arguments?.getString("agentId") ?: return@composable
                AgentDetailScreen(
                    agentId = agentId,
                    onBack = { navController.popBackStack() }
                )
            }

            // ── Projects tab ────────────────────────────────────────────
            composable(Routes.PROJECTS) {
                ProjectListScreen(
                    onProjectClick = { projectId ->
                        navController.navigate(Routes.projectDetail(projectId))
                    }
                )
            }

            // ── Project Detail (full screen, no bottom nav) ─────────────
            composable(
                route = Routes.PROJECT_DETAIL,
                arguments = listOf(
                    navArgument("projectId") { type = NavType.StringType }
                )
            ) { backStackEntry ->
                val projectId = backStackEntry.arguments?.getString("projectId") ?: return@composable
                ProjectDetailScreen(
                    projectId = projectId,
                    onBack = { navController.popBackStack() },
                    onNavigateToAgent = { agentId ->
                        navController.navigate(Routes.agentDetail(agentId))
                    }
                )
            }

            // ── Admin tab ───────────────────────────────────────────────
            composable(Routes.ADMIN) {
                AdminScreen(
                    onBack = { navController.popBackStack() },
                    onWorkflowClick = { workflowId ->
                        navController.navigate(Routes.workflowDetail(workflowId))
                    }
                )
            }

            // ── Workflow Detail (full screen, no bottom nav) ────────────
            composable(
                route = Routes.WORKFLOW_DETAIL,
                arguments = listOf(
                    navArgument("workflowId") { type = NavType.StringType }
                )
            ) { backStackEntry ->
                val workflowId = backStackEntry.arguments?.getString("workflowId") ?: return@composable
                WorkflowDetailScreen(
                    workflowId = workflowId,
                    onBack = { navController.popBackStack() }
                )
            }
        }
    }
}
