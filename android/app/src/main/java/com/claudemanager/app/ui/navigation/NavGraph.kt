package com.claudemanager.app.ui.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.claudemanager.app.data.preferences.AppPreferences
import com.claudemanager.app.ui.agents.AgentListScreen
import com.claudemanager.app.ui.detail.AgentDetailScreen
import com.claudemanager.app.ui.setup.SetupScreen

/**
 * Navigation route constants.
 */
object Routes {
    const val SETUP = "setup"
    const val AGENTS = "agents"
    const val AGENT_DETAIL = "agent/{agentId}"

    fun agentDetail(agentId: String): String = "agent/$agentId"
}

/**
 * Root navigation graph for the ClaudeManager app.
 *
 * The start destination depends on whether a server URL is already configured:
 * - If configured: jump straight to the agents list
 * - If not: show the setup/connection screen
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

    NavHost(
        navController = navController,
        startDestination = startDestination
    ) {
        composable(Routes.SETUP) {
            SetupScreen(
                onConnected = {
                    navController.navigate(Routes.AGENTS) {
                        popUpTo(Routes.SETUP) { inclusive = true }
                    }
                }
            )
        }

        composable(Routes.AGENTS) {
            // Consume startAgentId exactly once to prevent back-button re-navigation
            val oneTimeStartId = remember {
                mutableStateOf(startAgentId)
            }
            AgentListScreen(
                onAgentClick = { agentId ->
                    navController.navigate(Routes.agentDetail(agentId))
                },
                onSettingsClick = {
                    navController.navigate(Routes.SETUP)
                },
                startAgentId = oneTimeStartId.value
            )
            // Clear after first composition so back navigation doesn't re-trigger
            if (oneTimeStartId.value != null) {
                oneTimeStartId.value = null
            }
        }

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
    }
}
