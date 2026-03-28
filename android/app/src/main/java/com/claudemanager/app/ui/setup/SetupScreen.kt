package com.claudemanager.app.ui.setup

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.Error
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.claudemanager.app.ui.theme.LumiError
import com.claudemanager.app.ui.theme.LumiOnSurface
import com.claudemanager.app.ui.theme.LumiOnSurfaceSecondary
import com.claudemanager.app.ui.theme.LumiPurple500
import com.claudemanager.app.ui.theme.LumiSuccess

/**
 * Setup screen for configuring the server connection.
 *
 * Allows the user to enter a Tailscale address, test the connection,
 * and save the working URL to proceed to the agent list.
 *
 * @param onConnected Callback invoked after a successful save, to navigate away.
 */
@Composable
fun SetupScreen(
    onConnected: () -> Unit,
    viewModel: SetupViewModel = viewModel()
) {
    val state by viewModel.uiState.collectAsState()
    val focusManager = LocalFocusManager.current

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            // Cloud icon
            Icon(
                imageVector = Icons.Default.Cloud,
                contentDescription = null,
                modifier = Modifier.size(64.dp),
                tint = LumiPurple500
            )

            Spacer(modifier = Modifier.height(24.dp))

            // Title
            Text(
                text = "Connect to Agent Manager",
                style = MaterialTheme.typography.headlineLarge,
                color = LumiOnSurface,
                textAlign = TextAlign.Center
            )

            Spacer(modifier = Modifier.height(8.dp))

            // Subtitle
            Text(
                text = "Enter your Tailscale address",
                style = MaterialTheme.typography.bodyLarge,
                color = LumiOnSurfaceSecondary,
                textAlign = TextAlign.Center
            )

            Spacer(modifier = Modifier.height(32.dp))

            // Server address input
            OutlinedTextField(
                value = state.serverAddress,
                onValueChange = viewModel::onAddressChanged,
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Server address") },
                placeholder = { Text("e.g., my-pc.tail12345.ts.net") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Uri,
                    imeAction = ImeAction.Go
                ),
                keyboardActions = KeyboardActions(
                    onGo = {
                        focusManager.clearFocus()
                        viewModel.testConnection()
                    }
                ),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = LumiPurple500,
                    unfocusedBorderColor = LumiOnSurfaceSecondary.copy(alpha = 0.4f),
                    cursorColor = LumiPurple500,
                    focusedLabelColor = LumiPurple500,
                    unfocusedLabelColor = LumiOnSurfaceSecondary
                ),
                shape = RoundedCornerShape(12.dp)
            )

            Spacer(modifier = Modifier.height(12.dp))

            // API key input
            OutlinedTextField(
                value = state.apiKey,
                onValueChange = viewModel::onApiKeyChanged,
                modifier = Modifier.fillMaxWidth(),
                label = { Text("API key (optional)") },
                placeholder = { Text("Enter API key if auth is enabled") },
                singleLine = true,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = LumiPurple500,
                    unfocusedBorderColor = LumiOnSurfaceSecondary.copy(alpha = 0.4f),
                    cursorColor = LumiPurple500,
                    focusedLabelColor = LumiPurple500,
                    unfocusedLabelColor = LumiOnSurfaceSecondary
                ),
                shape = RoundedCornerShape(12.dp)
            )

            Spacer(modifier = Modifier.height(16.dp))

            // Connection status feedback
            AnimatedVisibility(
                visible = state.isConnected || state.error != null,
                enter = fadeIn(),
                exit = fadeOut()
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.Center
                ) {
                    if (state.isConnected) {
                        Icon(
                            imageVector = Icons.Default.CheckCircle,
                            contentDescription = "Connected",
                            tint = LumiSuccess,
                            modifier = Modifier.size(20.dp)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = "Connected to ${state.resolvedUrl ?: "server"}",
                            style = MaterialTheme.typography.bodyMedium,
                            color = LumiSuccess
                        )
                    } else if (state.error != null) {
                        Icon(
                            imageVector = Icons.Default.Error,
                            contentDescription = "Error",
                            tint = LumiError,
                            modifier = Modifier.size(20.dp)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = state.error!!,
                            style = MaterialTheme.typography.bodyMedium,
                            color = LumiError
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            // Test Connection button
            OutlinedButton(
                onClick = {
                    focusManager.clearFocus()
                    viewModel.testConnection()
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
                enabled = !state.isLoading && state.serverAddress.isNotBlank(),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.outlinedButtonColors(
                    contentColor = LumiPurple500
                )
            ) {
                if (state.isLoading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        color = LumiPurple500,
                        strokeWidth = 2.dp
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Testing...")
                } else {
                    Text("Test Connection")
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            // Connect button (enabled only after successful test)
            Button(
                onClick = { viewModel.saveAndConnect(onConnected) },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
                enabled = state.isConnected,
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = LumiPurple500,
                    contentColor = LumiOnSurface,
                    disabledContainerColor = LumiPurple500.copy(alpha = 0.3f),
                    disabledContentColor = LumiOnSurface.copy(alpha = 0.5f)
                )
            ) {
                Text("Connect", style = MaterialTheme.typography.labelLarge)
            }
        }
    }
}
