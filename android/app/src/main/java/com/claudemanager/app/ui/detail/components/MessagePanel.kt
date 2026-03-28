package com.claudemanager.app.ui.detail.components

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.claudemanager.app.data.models.AgentMessage
import com.claudemanager.app.data.models.MessageStatus
import com.claudemanager.app.ui.theme.LumiCard
import com.claudemanager.app.ui.theme.LumiOnSurface
import com.claudemanager.app.ui.theme.LumiOnSurfaceSecondary
import com.claudemanager.app.ui.theme.LumiOnSurfaceTertiary
import com.claudemanager.app.ui.theme.LumiPurple500
import com.claudemanager.app.ui.theme.messageStatusColor
import com.claudemanager.app.util.TimeUtils

/**
 * Chat-like message interface for communicating with an agent.
 *
 * Shows a scrollable list of sent messages (auto-scrolls to bottom on new messages),
 * with a text input bar at the bottom including attach file and send buttons.
 *
 * @param messages List of messages for this agent.
 * @param isSending Whether a message is currently being sent.
 * @param isUploading Whether a file is currently being uploaded.
 * @param onSendMessage Callback to send a text message.
 * @param onUploadFile Callback to upload a file from a content URI.
 */
@Composable
fun MessagePanel(
    messages: List<AgentMessage>,
    isSending: Boolean,
    isUploading: Boolean,
    onSendMessage: (String) -> Unit,
    onUploadFile: (Uri) -> Unit,
    modifier: Modifier = Modifier
) {
    var messageText by remember { mutableStateOf("") }
    val focusManager = LocalFocusManager.current
    val listState = rememberLazyListState()

    // File picker launcher
    val filePickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        uri?.let { onUploadFile(it) }
    }

    // Auto-scroll to bottom when new messages arrive
    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) {
            listState.animateScrollToItem(messages.size - 1)
        }
    }

    Column(modifier = modifier.imePadding()) {
        // Message list
        if (messages.isEmpty()) {
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                contentAlignment = Alignment.Center
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        text = "No messages sent",
                        style = MaterialTheme.typography.bodyLarge,
                        color = LumiOnSurfaceTertiary
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "Type below to communicate with the agent.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = LumiOnSurfaceTertiary
                    )
                }
            }
        } else {
            LazyColumn(
                state = listState,
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                item { Spacer(modifier = Modifier.height(8.dp)) }

                items(messages, key = { it.id }) { message ->
                    MessageBubble(message = message)
                }

                item { Spacer(modifier = Modifier.height(8.dp)) }
            }
        }

        // Divider
        HorizontalDivider(color = LumiCard, thickness = 1.dp)

        // Input bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(LumiCard.copy(alpha = 0.5f))
                .padding(horizontal = 8.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Attach file button
            IconButton(
                onClick = { filePickerLauncher.launch("*/*") },
                enabled = !isUploading
            ) {
                if (isUploading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        color = LumiPurple500,
                        strokeWidth = 2.dp
                    )
                } else {
                    Icon(
                        imageVector = Icons.Default.AttachFile,
                        contentDescription = "Attach file",
                        tint = LumiOnSurfaceSecondary
                    )
                }
            }

            // Text field
            OutlinedTextField(
                value = messageText,
                onValueChange = { messageText = it },
                modifier = Modifier.weight(1f),
                placeholder = {
                    Text(
                        "Send message to agent...",
                        style = MaterialTheme.typography.bodyMedium,
                        color = LumiOnSurfaceTertiary
                    )
                },
                maxLines = 4,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(
                    onSend = {
                        if (messageText.isNotBlank() && !isSending) {
                            onSendMessage(messageText.trim())
                            messageText = ""
                            focusManager.clearFocus()
                        }
                    }
                ),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = LumiPurple500,
                    unfocusedBorderColor = LumiOnSurfaceTertiary.copy(alpha = 0.3f),
                    cursorColor = LumiPurple500
                ),
                shape = RoundedCornerShape(20.dp),
                textStyle = MaterialTheme.typography.bodyMedium.copy(color = LumiOnSurface)
            )

            Spacer(modifier = Modifier.width(4.dp))

            // Send button
            IconButton(
                onClick = {
                    if (messageText.isNotBlank() && !isSending) {
                        onSendMessage(messageText.trim())
                        messageText = ""
                        focusManager.clearFocus()
                    }
                },
                enabled = messageText.isNotBlank() && !isSending
            ) {
                if (isSending) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        color = LumiPurple500,
                        strokeWidth = 2.dp
                    )
                } else {
                    Icon(
                        imageVector = Icons.Default.Send,
                        contentDescription = "Send",
                        tint = if (messageText.isNotBlank()) LumiPurple500 else LumiOnSurfaceTertiary
                    )
                }
            }
        }
    }
}

/**
 * A single message bubble showing content, status badge, and relative time.
 */
@Composable
private fun MessageBubble(message: AgentMessage) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 32.dp), // Offset to right to look like sent messages
        horizontalAlignment = Alignment.End
    ) {
        Box(
            modifier = Modifier
                .clip(RoundedCornerShape(16.dp, 16.dp, 4.dp, 16.dp))
                .background(LumiPurple500.copy(alpha = 0.15f))
                .padding(12.dp)
        ) {
            Text(
                text = message.content,
                style = MaterialTheme.typography.bodyMedium,
                color = LumiOnSurface
            )
        }

        Spacer(modifier = Modifier.height(4.dp))

        // Status + time row
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(end = 4.dp)
        ) {
            // Status badge
            val statusColor = messageStatusColor(message.status)
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .background(statusColor.copy(alpha = 0.15f))
                    .padding(horizontal = 6.dp, vertical = 2.dp)
            ) {
                Text(
                    text = message.status.displayName,
                    style = MaterialTheme.typography.labelSmall,
                    color = statusColor
                )
            }

            Spacer(modifier = Modifier.width(8.dp))

            // Relative time
            Text(
                text = TimeUtils.timeAgo(message.createdAt),
                style = MaterialTheme.typography.labelSmall,
                color = LumiOnSurfaceTertiary
            )
        }
    }
}
