package com.claudemanager.app.ui.detail.components

import android.net.Uri
import androidx.compose.ui.platform.LocalContext
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material.icons.outlined.AccountTree
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.claudemanager.app.data.models.AgentMessage
import com.claudemanager.app.data.models.AgentUpdate
import com.claudemanager.app.data.models.UpdateContent
import com.claudemanager.app.data.models.UpdateType
import com.claudemanager.app.ui.theme.LumiCard
import com.claudemanager.app.ui.theme.LumiError
import com.claudemanager.app.ui.theme.LumiInfo
import com.claudemanager.app.ui.theme.LumiOnSurface
import com.claudemanager.app.ui.theme.LumiOnSurfaceSecondary
import com.claudemanager.app.ui.theme.LumiOnSurfaceTertiary
import com.claudemanager.app.ui.theme.LumiPurple500
import com.claudemanager.app.ui.theme.LumiSuccess
import com.claudemanager.app.ui.theme.LumiWarning
import com.claudemanager.app.ui.theme.messageStatusColor
import com.claudemanager.app.util.TimeUtils

/**
 * A unified item in the conversation feed, wrapping either an agent update or a user message.
 */
private sealed class ConversationItem(val sortTime: Long, val itemKey: String) {
    class Update(val update: AgentUpdate, time: Long) : ConversationItem(time, "update-${update.id}")
    class Message(val message: AgentMessage, time: Long) : ConversationItem(time, "msg-${message.id}")
}

/**
 * Unified conversation panel merging agent updates (timeline) and user messages
 * into a single chronological chat-style view.
 *
 * Agent updates appear left-aligned with type icons.
 * User messages appear right-aligned as chat bubbles.
 * A message input bar sits at the bottom.
 */
@Composable
fun ConversationPanel(
    updates: List<AgentUpdate>,
    messages: List<AgentMessage>,
    isSending: Boolean,
    isUploading: Boolean,
    onSendMessage: (String) -> Unit,
    onUploadFile: (Uri) -> Unit,
    modifier: Modifier = Modifier
) {
    var messageText by remember { mutableStateOf("") }
    var uploadingFileName by remember { mutableStateOf<String?>(null) }
    val focusManager = LocalFocusManager.current
    val context = LocalContext.current
    val listState = rememberLazyListState()

    val filePickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        uri?.let {
            // Extract filename for visual feedback
            uploadingFileName = context.contentResolver.query(it, null, null, null, null)?.use { cursor ->
                val nameIndex = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                cursor.moveToFirst()
                if (nameIndex >= 0) cursor.getString(nameIndex) else null
            } ?: it.lastPathSegment ?: "file"
            onUploadFile(it)
        }
    }

    // Clear filename when upload finishes
    LaunchedEffect(isUploading) {
        if (!isUploading) uploadingFileName = null
    }

    // Build merged chronological list
    val items = remember(updates, messages) {
        val merged = mutableListOf<ConversationItem>()
        for (u in updates) {
            val time = TimeUtils.parseIso(u.timestamp)?.time ?: 0L
            merged.add(ConversationItem.Update(u, time))
        }
        for (m in messages) {
            val time = TimeUtils.parseIso(m.createdAt)?.time ?: 0L
            merged.add(ConversationItem.Message(m, time))
        }
        merged.sortBy { it.sortTime }
        merged.toList()
    }

    // Auto-scroll to bottom when new items arrive
    LaunchedEffect(items.size) {
        if (items.isNotEmpty()) {
            listState.animateScrollToItem(items.size - 1)
        }
    }

    Column(modifier = modifier.imePadding()) {
        // Conversation feed
        if (items.isEmpty()) {
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = "No activity yet",
                    style = MaterialTheme.typography.bodyLarge,
                    color = LumiOnSurfaceTertiary
                )
            }
        } else {
            LazyColumn(
                state = listState,
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                item { Spacer(modifier = Modifier.height(8.dp)) }

                items(items, key = { it.itemKey }) { item ->
                    when (item) {
                        is ConversationItem.Update -> UpdateBubble(update = item.update)
                        is ConversationItem.Message -> SentMessageBubble(message = item.message)
                    }
                }

                item { Spacer(modifier = Modifier.height(8.dp)) }
            }
        }

        // Divider
        HorizontalDivider(color = LumiCard, thickness = 1.dp)

        // Upload indicator
        if (uploadingFileName != null) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(LumiPurple500.copy(alpha = 0.1f))
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    imageVector = Icons.Default.AttachFile,
                    contentDescription = null,
                    tint = LumiPurple500,
                    modifier = Modifier.size(14.dp)
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = if (isUploading) "Uploading: $uploadingFileName" else uploadingFileName!!,
                    style = MaterialTheme.typography.bodySmall,
                    color = LumiOnSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )
                if (isUploading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(14.dp),
                        color = LumiPurple500,
                        strokeWidth = 2.dp
                    )
                }
            }
        }

        // Input bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(LumiCard.copy(alpha = 0.5f))
                .padding(horizontal = 8.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
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

            OutlinedTextField(
                value = messageText,
                onValueChange = { messageText = it },
                modifier = Modifier.weight(1f),
                placeholder = {
                    Text(
                        "Message agent...",
                        style = MaterialTheme.typography.bodyMedium,
                        color = LumiOnSurfaceTertiary
                    )
                },
                maxLines = 8,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Default),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = LumiPurple500,
                    unfocusedBorderColor = LumiOnSurfaceTertiary.copy(alpha = 0.3f),
                    cursorColor = LumiPurple500
                ),
                shape = RoundedCornerShape(20.dp),
                textStyle = MaterialTheme.typography.bodyMedium.copy(color = LumiOnSurface)
            )

            Spacer(modifier = Modifier.width(4.dp))

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
 * Left-aligned agent update rendered as a compact card.
 */
@Composable
private fun UpdateBubble(update: AgentUpdate) {
    val content = update.parsedContent()
    val typeInfo = updateTypeInfo(update.type)

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(end = 48.dp),
        horizontalAlignment = Alignment.Start
    ) {
        Box(
            modifier = Modifier
                .clip(RoundedCornerShape(4.dp, 16.dp, 16.dp, 16.dp))
                .background(LumiCard)
                .padding(10.dp)
        ) {
            Column {
                // Type + time header
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = typeInfo.icon,
                        contentDescription = typeInfo.label,
                        tint = typeInfo.color,
                        modifier = Modifier.size(14.dp)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = typeInfo.label,
                        style = MaterialTheme.typography.labelSmall,
                        color = typeInfo.color
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = TimeUtils.timeAgo(update.timestamp),
                        style = MaterialTheme.typography.labelSmall,
                        color = LumiOnSurfaceTertiary
                    )
                }

                Spacer(modifier = Modifier.height(4.dp))

                // Content
                when (content) {
                    is UpdateContent.Text -> {
                        Text(
                            text = update.summary ?: content.text,
                            style = MaterialTheme.typography.bodyMedium,
                            color = LumiOnSurface,
                            maxLines = 6,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                    is UpdateContent.Progress -> {
                        Text(
                            text = content.description,
                            style = MaterialTheme.typography.bodyMedium,
                            color = LumiOnSurface
                        )
                        Spacer(modifier = Modifier.height(6.dp))
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            LinearProgressIndicator(
                                progress = { content.percentage / 100f },
                                modifier = Modifier
                                    .weight(1f)
                                    .height(6.dp)
                                    .clip(RoundedCornerShape(3.dp)),
                                color = LumiPurple500,
                                trackColor = LumiCard
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = "${content.percentage}%",
                                style = MaterialTheme.typography.labelSmall,
                                color = LumiOnSurfaceSecondary
                            )
                        }
                    }
                    is UpdateContent.Error -> {
                        Text(
                            text = content.message,
                            style = MaterialTheme.typography.bodyMedium,
                            color = LumiError,
                            maxLines = 4,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                    is UpdateContent.Status -> {
                        Text(
                            text = content.status,
                            style = MaterialTheme.typography.bodyMedium,
                            color = LumiOnSurface
                        )
                    }
                    is UpdateContent.Diagram -> {
                        Text(
                            text = "(diagram)",
                            style = MaterialTheme.typography.bodyMedium,
                            color = LumiOnSurfaceSecondary
                        )
                    }
                }
            }
        }
    }
}

/**
 * Right-aligned user message bubble (sent to agent).
 */
@Composable
private fun SentMessageBubble(message: AgentMessage) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 48.dp),
        horizontalAlignment = Alignment.End
    ) {
        Box(
            modifier = Modifier
                .clip(RoundedCornerShape(16.dp, 16.dp, 4.dp, 16.dp))
                .background(LumiPurple500.copy(alpha = 0.15f))
                .padding(10.dp)
        ) {
            Text(
                text = message.content,
                style = MaterialTheme.typography.bodyMedium,
                color = LumiOnSurface
            )
        }

        Spacer(modifier = Modifier.height(2.dp))

        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(end = 4.dp)
        ) {
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
            Spacer(modifier = Modifier.width(6.dp))
            Text(
                text = TimeUtils.timeAgo(message.createdAt),
                style = MaterialTheme.typography.labelSmall,
                color = LumiOnSurfaceTertiary
            )
        }
    }
}

private data class ConvUpdateTypeInfo(
    val icon: ImageVector,
    val label: String,
    val color: Color
)

private fun updateTypeInfo(type: UpdateType): ConvUpdateTypeInfo = when (type) {
    UpdateType.TEXT -> ConvUpdateTypeInfo(Icons.Default.Description, "Update", LumiInfo)
    UpdateType.PROGRESS -> ConvUpdateTypeInfo(Icons.Default.BarChart, "Progress", LumiPurple500)
    UpdateType.ERROR -> ConvUpdateTypeInfo(Icons.Default.Error, "Error", LumiError)
    UpdateType.STATUS -> ConvUpdateTypeInfo(Icons.Default.SwapHoriz, "Status", LumiWarning)
    UpdateType.DIAGRAM -> ConvUpdateTypeInfo(Icons.Outlined.AccountTree, "Diagram", LumiSuccess)
}
