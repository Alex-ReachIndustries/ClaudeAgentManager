package com.claudemanager.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import com.claudemanager.app.ui.navigation.AppNavGraph
import com.claudemanager.app.ui.theme.ClaudeManagerTheme

/**
 * Single-activity host for the Compose navigation graph.
 *
 * Handles:
 * - Deep links from notification taps (claudemanager://agent/{agentId})
 * - POST_NOTIFICATIONS permission request on Android 13+
 * - New-intent handling when the activity is already running (singleTask launch mode)
 */
class MainActivity : ComponentActivity() {

    companion object {
        private const val TAG = "MainActivity"
        private const val SCHEME = "claudemanager"
        private const val HOST_AGENT = "agent"
    }

    /** The agent ID extracted from the launch/deep-link intent, if any. */
    private var startAgentId by mutableStateOf<String?>(null)

    /** Launcher for the POST_NOTIFICATIONS permission dialog (Android 13+). */
    private val notificationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            Log.d(TAG, "POST_NOTIFICATIONS permission granted: $granted")
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        // Extract deep link agent ID from the launching intent
        startAgentId = extractAgentIdFromIntent(intent)

        // Request notification permission on Android 13+ if not already granted
        requestNotificationPermissionIfNeeded()

        val app = application as ClaudeManagerApp

        setContent {
            ClaudeManagerTheme {
                AppNavGraph(
                    preferences = app.preferences,
                    startAgentId = startAgentId
                )
            }
        }
    }

    /**
     * Called when the activity receives a new intent while already running
     * (because launchMode is singleTask). Re-extracts the deep link target.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val agentId = extractAgentIdFromIntent(intent)
        if (agentId != null) {
            startAgentId = agentId
            Log.d(TAG, "onNewIntent deep link to agent: $agentId")
        }
    }

    /**
     * Extracts the agent ID from a deep link URI of the form:
     * `claudemanager://agent/{agentId}`
     *
     * Returns null if the intent does not contain a matching deep link.
     */
    private fun extractAgentIdFromIntent(intent: Intent?): String? {
        val uri: Uri = intent?.data ?: return null
        if (uri.scheme != SCHEME) return null
        if (uri.host != HOST_AGENT) return null
        val agentId = uri.pathSegments.firstOrNull()
        Log.d(TAG, "Extracted agent ID from deep link: $agentId")
        return agentId
    }

    /**
     * On Android 13 (API 33) and above, POST_NOTIFICATIONS requires an explicit
     * runtime permission grant. This prompts the user if the permission has not
     * already been granted.
     */
    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val permission = Manifest.permission.POST_NOTIFICATIONS
            if (ContextCompat.checkSelfPermission(this, permission)
                != PackageManager.PERMISSION_GRANTED
            ) {
                notificationPermissionLauncher.launch(permission)
            }
        }
    }
}
