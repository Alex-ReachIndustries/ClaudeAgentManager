package com.claudemanager.app.ui.detail.components

import android.net.Uri
import androidx.compose.ui.platform.LocalContext
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import android.content.ClipData
import android.content.ClipboardManager
import android.widget.Toast
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Upload
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.Hub
import androidx.compose.material.icons.filled.InsertDriveFile
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.SmartToy
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material.icons.outlined.AccountTree
import androidx.compose.material3.Surface
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
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.claudemanager.app.data.models.AgentMessage
import com.claudemanager.app.data.models.AgentUpdate
import com.claudemanager.app.data.models.MessageStatus
import com.claudemanager.app.data.models.UpdateContent
import com.claudemanager.app.data.models.UpdateType
import com.claudemanager.app.ui.detail.AttachedFile
import com.claudemanager.app.ui.theme.LumiBackground
import com.claudemanager.app.ui.theme.LumiCard
import com.claudemanager.app.ui.theme.LumiError
import com.claudemanager.app.ui.theme.LumiInfo
import com.claudemanager.app.ui.theme.LumiOnSurface
import com.claudemanager.app.ui.theme.LumiOnSurfaceSecondary
import com.claudemanager.app.ui.theme.LumiOnSurfaceTertiary
import com.claudemanager.app.ui.theme.LumiPurple400
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
    class File(val fileInfo: com.claudemanager.app.data.models.FileInfo, time: Long) : ConversationItem(time, "file-${fileInfo.id}")
}

/**
 * Unified conversation panel merging agent updates (timeline) and user messages
 * into a single chronological chat-style view.
 *
 * Agent updates appear left-aligned with type icons.
 * User messages appear right-aligned as chat bubbles.
 * A message input bar sits at the bottom.
 *
 * Supports infinite scroll: when the user scrolls near the top and [hasMore] is true,
 * [onLoadMore] is called to fetch older history.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ConversationPanel(
    updates: List<AgentUpdate>,
    messages: List<AgentMessage>,
    files: List<com.claudemanager.app.data.models.FileInfo> = emptyList(),
    isSending: Boolean,
    isUploading: Boolean,
    onSendMessage: (String) -> Unit,
    onUploadFile: (Uri) -> Unit,
    onFileDownload: (Long, String) -> Unit = { _, _ -> },
    draftMessage: String = "",
    onDraftChanged: (String) -> Unit = {},
    lastUploadedFileName: String? = null,
    onClearAttachment: () -> Unit = {},
    pendingAttachments: List<AttachedFile> = emptyList(),
    onRemoveAttachment: (String) -> Unit = {},
    hasMore: Boolean = false,
    isLoadingMore: Boolean = false,
    onLoadMore: () -> Unit = {},
    modifier: Modifier = Modifier
) {
    var messageText by remember { mutableStateOf(draftMessage) }
    var uploadingFileName by remember { mutableStateOf<String?>(null) }
    val focusManager = LocalFocusManager.current
    val context = LocalContext.current
    val listState = rememberLazyListState()

    // Sync from ViewModel draft when re-entering the tab (e.g., after failed send)
    LaunchedEffect(draftMessage) {
        if (draftMessage != messageText && draftMessage.isNotEmpty()) {
            messageText = draftMessage
        }
    }

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
    val items = remember(updates, messages, files) {
        val merged = mutableListOf<ConversationItem>()
        for (u in updates) {
            val time = TimeUtils.parseIso(u.timestamp)?.time ?: 0L
            merged.add(ConversationItem.Update(u, time))
        }
        for (m in messages) {
            val time = TimeUtils.parseIso(m.createdAt)?.time ?: 0L
            merged.add(ConversationItem.Message(m, time))
        }
        for (f in files) {
            val time = TimeUtils.parseIso(f.createdAt)?.time ?: 0L
            merged.add(ConversationItem.File(f, time))
        }
        merged.sortBy { it.sortTime }
        merged.toList()
    }

    // Scroll to bottom: immediately on first load, then animated on each new message.
    var initialScrollDone by remember { mutableStateOf(false) }
    var prevItemCount by remember { mutableStateOf(0) }
    LaunchedEffect(items.size) {
        if (!initialScrollDone) {
            if (items.isNotEmpty() && !isLoadingMore) {
                listState.scrollToItem(items.size - 1)
                initialScrollDone = true
                prevItemCount = items.size
            }
        } else {
            val grew = items.size > prevItemCount
            prevItemCount = items.size
            if (grew && !isLoadingMore) {
                listState.animateScrollToItem(items.size - 1)
            }
        }
    }

    // Trigger load-more when user scrolls near the top
    LaunchedEffect(listState.firstVisibleItemIndex) {
        if (listState.firstVisibleItemIndex <= 2 && hasMore && !isLoadingMore) {
            onLoadMore()
        }
    }

    Column(modifier = modifier.imePadding()) {
        // Conversation feed
        if (items.isEmpty() && !isLoadingMore) {
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
                // Spinner / hint at top for older history
                if (isLoadingMore || hasMore) {
                    item(key = "load-more-header") {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 8.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            if (isLoadingMore) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(20.dp),
                                    color = LumiPurple500,
                                    strokeWidth = 2.dp
                                )
                            } else {
                                Text(
                                    text = "Scroll up for older history",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = LumiOnSurfaceTertiary
                                )
                            }
                        }
                    }
                }

                item(key = "top-spacer") { Spacer(modifier = Modifier.height(8.dp)) }

                items(items, key = { it.itemKey }) { item ->
                    when (item) {
                        is ConversationItem.Update -> UpdateBubble(update = item.update)
                        is ConversationItem.Message -> {
                            when (item.message.source) {
                                "agent" -> AgentRelayBubble(message = item.message)
                                "peer" -> PeerMessageBubble(message = item.message)
                                else -> SentMessageBubble(message = item.message)
                            }
                        }
                        is ConversationItem.File -> FileBubble(fileInfo = item.fileInfo, onDownload = onFileDownload)
                    }
                }

                item(key = "bottom-spacer") { Spacer(modifier = Modifier.height(8.dp)) }
            }
        }

        // Divider
        HorizontalDivider(color = LumiCard, thickness = 1.dp)

        // Upload indicator — shows file being uploaded with name, icon, and progress
        if (uploadingFileName != null && isUploading) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(LumiPurple500.copy(alpha = 0.1f))
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    imageVector = Icons.Default.InsertDriveFile,
                    contentDescription = null,
                    tint = LumiPurple500,
                    modifier = Modifier.size(18.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = uploadingFileName!!,
                        style = MaterialTheme.typography.bodySmall,
                        color = LumiOnSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    LinearProgressIndicator(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(3.dp)
                            .clip(RoundedCornerShape(2.dp)),
                        color = LumiPurple500,
                        trackColor = LumiPurple500.copy(alpha = 0.2f)
                    )
                }
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "Uploading...",
                    style = MaterialTheme.typography.labelSmall,
                    color = LumiOnSurfaceSecondary
                )
            }
        }

        // Pending attachment chips (multiple files supported)
        if (pendingAttachments.isNotEmpty()) {
            FlowRow(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(LumiSuccess.copy(alpha = 0.08f))
                    .padding(horizontal = 10.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                pendingAttachments.forEach { attachment ->
                    Row(
                        modifier = Modifier
                            .clip(RoundedCornerShape(16.dp))
                            .background(LumiSuccess.copy(alpha = 0.18f))
                            .padding(start = 8.dp, top = 4.dp, bottom = 4.dp, end = 4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = Icons.Default.AttachFile,
                            contentDescription = null,
                            tint = LumiSuccess,
                            modifier = Modifier.size(14.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(
                            text = attachment.filename,
                            style = MaterialTheme.typography.labelSmall,
                            color = LumiOnSurface,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        IconButton(
                            onClick = { onRemoveAttachment(attachment.filename) },
                            modifier = Modifier.size(18.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Close,
                                contentDescription = "Remove ${attachment.filename}",
                                tint = LumiOnSurfaceTertiary,
                                modifier = Modifier.size(12.dp)
                            )
                        }
                    }
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
                onValueChange = {
                    messageText = it
                    onDraftChanged(it)
                },
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

            val canSend = (messageText.isNotBlank() || pendingAttachments.isNotEmpty()) && !isSending
            IconButton(
                onClick = {
                    if (canSend) {
                        val textToSend = messageText.trim()
                        messageText = ""
                        onDraftChanged("")
                        focusManager.clearFocus()
                        onSendMessage(textToSend)
                    }
                },
                enabled = canSend
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
                        tint = if (canSend) LumiPurple500 else LumiOnSurfaceTertiary
                    )
                }
            }
        }
    }
}

/**
 * Left-aligned agent update rendered as a compact card.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun UpdateBubble(update: AgentUpdate) {
    val content = update.parsedContent()
    val typeInfo = updateTypeInfo(update.type)
    var expanded by remember { mutableStateOf(false) }
    val context = LocalContext.current

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
                .combinedClickable(
                    onClick = { expanded = !expanded },
                    onLongClick = {
                        // Copy full content — same as what's shown when expanded
                        val text = when (content) {
                            is UpdateContent.Text -> {
                                val parts = listOfNotNull(update.summary, content.text.takeIf { !it.isNullOrBlank() })
                                parts.joinToString("\n\n").ifBlank { update.content }
                            }
                            is UpdateContent.Progress -> listOfNotNull(content.description, update.summary).joinToString("\n").ifBlank { update.content }
                            is UpdateContent.Error -> content.message
                            is UpdateContent.Status -> content.status
                            is UpdateContent.Diagram -> content.diagram
                            else -> update.summary ?: update.content
                        }
                        copyToClipboard(context, text)
                    }
                )
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

                // Content — tap to expand/collapse
                when (content) {
                    is UpdateContent.Text -> {
                        // Show summary first, full content when expanded
                        val displayText = if (expanded && !content.text.isNullOrBlank()) {
                            (update.summary ?: "") + "\n\n" + content.text
                        } else {
                            update.summary ?: content.text
                        }
                        Text(
                            text = displayText,
                            style = MaterialTheme.typography.bodyMedium,
                            color = LumiOnSurface,
                            maxLines = if (expanded) Int.MAX_VALUE else 4,
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
                            maxLines = if (expanded) Int.MAX_VALUE else 4,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                    is UpdateContent.Status -> {
                        val statusText = update.summary ?: content.status
                        // content.status IS the verbose text (parsed by parsedContent() from the "status" JSON key)
                        val detail = content.status.takeIf { it.isNotBlank() && it.trim() != statusText.trim() }

                        Text(
                            text = if (expanded && detail != null)
                                "$statusText\n\n$detail" else statusText,
                            style = MaterialTheme.typography.bodyMedium,
                            color = LumiOnSurface,
                            maxLines = if (expanded) Int.MAX_VALUE else 4,
                            overflow = TextOverflow.Ellipsis
                        )
                        if (content.progress > 0) {
                            Spacer(modifier = Modifier.height(6.dp))
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                LinearProgressIndicator(
                                    progress = { content.progress / 100f },
                                    modifier = Modifier
                                        .weight(1f)
                                        .height(4.dp)
                                        .clip(RoundedCornerShape(2.dp)),
                                    color = LumiWarning,
                                    trackColor = LumiCard
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                Text(
                                    text = "${content.progress}%",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = LumiOnSurfaceSecondary
                                )
                            }
                        }
                    }
                    is UpdateContent.Diagram -> {
                        Text(
                            text = "(diagram)",
                            style = MaterialTheme.typography.bodyMedium,
                            color = LumiOnSurfaceSecondary
                        )
                    }
                    is UpdateContent.Relay -> {
                        val arrow = if (content.direction == "sent") "→" else "←"
                        Text(
                            text = "$arrow ${content.otherTitle}: ${content.message}",
                            style = MaterialTheme.typography.bodyMedium,
                            color = LumiOnSurfaceSecondary,
                            maxLines = if (expanded) Int.MAX_VALUE else 3,
                            overflow = TextOverflow.Ellipsis
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
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun SentMessageBubble(message: AgentMessage) {
    val context = LocalContext.current
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
                .combinedClickable(
                    onClick = {},
                    onLongClick = { copyToClipboard(context, message.content) }
                )
                .padding(10.dp)
        ) {
            Text(
                text = message.content,
                style = MaterialTheme.typography.bodyMedium,
                color = LumiOnSurface
            )
        }

        if (message.status == MessageStatus.ACKNOWLEDGED && !message.ackContent.isNullOrBlank()) {
            Spacer(modifier = Modifier.height(4.dp))
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .background(LumiPurple500.copy(alpha = 0.10f))
                    .padding(horizontal = 8.dp, vertical = 4.dp)
            ) {
                Text(
                    text = "Ack: ${message.ackContent}",
                    style = MaterialTheme.typography.labelSmall.copy(
                        fontStyle = androidx.compose.ui.text.font.FontStyle.Italic
                    ),
                    color = LumiPurple400
                )
            }
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

/**
 * Left-aligned message bubble for messages received from another agent via relay.
 * Styled differently from user messages to distinguish the source.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun AgentRelayBubble(message: AgentMessage) {
    val context = LocalContext.current
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(end = 48.dp),
        horizontalAlignment = Alignment.Start
    ) {
        Box(
            modifier = Modifier
                .clip(RoundedCornerShape(4.dp, 16.dp, 16.dp, 16.dp))
                .background(LumiInfo.copy(alpha = 0.12f))
                .combinedClickable(
                    onClick = {},
                    onLongClick = { copyToClipboard(context, message.content) }
                )
                .padding(10.dp)
        ) {
            Column {
                // Source label
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Default.SmartToy,
                        contentDescription = "From agent",
                        tint = LumiInfo,
                        modifier = Modifier.size(14.dp)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = "From Agent",
                        style = MaterialTheme.typography.labelSmall,
                        color = LumiInfo
                    )
                    if (message.sourceAgentId != null) {
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(
                            text = "(${message.sourceAgentId})",
                            style = MaterialTheme.typography.labelSmall,
                            color = LumiOnSurfaceTertiary,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                }

                Spacer(modifier = Modifier.height(4.dp))

                Text(
                    text = message.content,
                    style = MaterialTheme.typography.bodyMedium,
                    color = LumiOnSurface
                )
            }
        }

        if (message.status == MessageStatus.ACKNOWLEDGED && !message.ackContent.isNullOrBlank()) {
            Spacer(modifier = Modifier.height(4.dp))
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .background(LumiInfo.copy(alpha = 0.10f))
                    .padding(horizontal = 8.dp, vertical = 4.dp)
            ) {
                Text(
                    text = "Ack: ${message.ackContent}",
                    style = MaterialTheme.typography.labelSmall.copy(
                        fontStyle = androidx.compose.ui.text.font.FontStyle.Italic
                    ),
                    color = LumiInfo
                )
            }
        }

        Spacer(modifier = Modifier.height(2.dp))

        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(start = 4.dp)
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

/**
 * Left-aligned message bubble for messages received from a peer machine over the tailnet
 * (source = "peer"). Emerald-tinted with a Hub icon — visually distinct from agent relays
 * (blue) and locally-sent user messages (purple, right-aligned).
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun PeerMessageBubble(message: AgentMessage) {
    val context = LocalContext.current
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(end = 48.dp),
        horizontalAlignment = Alignment.Start
    ) {
        Box(
            modifier = Modifier
                .clip(RoundedCornerShape(4.dp, 16.dp, 16.dp, 16.dp))
                .background(LumiSuccess.copy(alpha = 0.12f))
                .combinedClickable(
                    onClick = {},
                    onLongClick = { copyToClipboard(context, message.content) }
                )
                .padding(10.dp)
        ) {
            Column {
                // Source label — "Agent <uuid8> @ peerName" or "Peer @ peerName"
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Default.Hub,
                        contentDescription = "From peer machine",
                        tint = LumiSuccess,
                        modifier = Modifier.size(14.dp)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    val agentLabel = message.sourceAgentId?.let { "Agent ${it.take(8)}" } ?: "Peer"
                    val peerLabel = message.sourcePeerName ?: "unknown"
                    Text(
                        text = "$agentLabel @ $peerLabel",
                        style = MaterialTheme.typography.labelSmall,
                        color = LumiSuccess,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }

                Spacer(modifier = Modifier.height(4.dp))

                Text(
                    text = message.content,
                    style = MaterialTheme.typography.bodyMedium,
                    color = LumiOnSurface
                )
            }
        }

        if (message.status == MessageStatus.ACKNOWLEDGED && !message.ackContent.isNullOrBlank()) {
            Spacer(modifier = Modifier.height(4.dp))
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .background(LumiSuccess.copy(alpha = 0.10f))
                    .padding(horizontal = 8.dp, vertical = 4.dp)
            ) {
                Text(
                    text = "Ack: ${message.ackContent}",
                    style = MaterialTheme.typography.labelSmall.copy(
                        fontStyle = androidx.compose.ui.text.font.FontStyle.Italic
                    ),
                    color = LumiSuccess
                )
            }
        }

        Spacer(modifier = Modifier.height(2.dp))

        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(start = 4.dp)
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
    UpdateType.RELAY -> ConvUpdateTypeInfo(Icons.Default.SwapHoriz, "Relay", LumiInfo)
}

/**
 * File attachment bubble in the conversation timeline.
 * User uploads align right (purple tint), Claude-generated files align left (blue tint).
 */
@Composable
private fun FileBubble(fileInfo: com.claudemanager.app.data.models.FileInfo, onDownload: (Long, String) -> Unit = { _, _ -> }) {
    val isUser = fileInfo.source == "user"

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(
                start = if (isUser) 48.dp else 0.dp,
                end = if (isUser) 0.dp else 48.dp
            ),
        horizontalAlignment = if (isUser) Alignment.End else Alignment.Start
    ) {
        Surface(
            shape = RoundedCornerShape(
                topStart = if (isUser) 16.dp else 4.dp,
                topEnd = if (isUser) 4.dp else 16.dp,
                bottomStart = 16.dp,
                bottomEnd = 16.dp
            ),
            color = if (isUser) LumiPurple500.copy(alpha = 0.12f) else LumiCard,
            border = BorderStroke(
                1.dp,
                if (isUser) LumiPurple500.copy(alpha = 0.25f) else LumiOnSurfaceTertiary.copy(alpha = 0.2f)
            ),
            modifier = Modifier.clickable {
                onDownload(fileInfo.id, fileInfo.filename)
            }
        ) {
            Column(modifier = Modifier.padding(12.dp)) {
                // Header: source label + time
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(
                        imageVector = if (isUser) Icons.Default.Upload else Icons.Default.SmartToy,
                        contentDescription = null,
                        tint = if (isUser) LumiPurple500 else LumiInfo,
                        modifier = Modifier.size(14.dp)
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(
                        text = if (isUser) "You uploaded" else "Claude generated",
                        style = MaterialTheme.typography.labelSmall,
                        color = LumiOnSurfaceTertiary
                    )
                    Spacer(modifier = Modifier.weight(1f))
                    Text(
                        text = TimeUtils.timeAgo(fileInfo.createdAt),
                        style = MaterialTheme.typography.labelSmall,
                        color = LumiOnSurfaceTertiary
                    )
                }

                Spacer(modifier = Modifier.height(6.dp))

                // File info row
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(if (isUser) LumiPurple500.copy(alpha = 0.08f) else LumiBackground.copy(alpha = 0.5f))
                        .padding(8.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.AttachFile,
                        contentDescription = "File",
                        tint = LumiOnSurfaceSecondary,
                        modifier = Modifier.size(16.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = fileInfo.filename,
                            style = MaterialTheme.typography.bodySmall,
                            color = LumiOnSurface,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        Text(
                            text = fileInfo.formattedSize,
                            style = MaterialTheme.typography.labelSmall,
                            color = LumiOnSurfaceTertiary
                        )
                    }
                    Icon(
                        imageVector = Icons.Default.Download,
                        contentDescription = "Download",
                        tint = LumiOnSurfaceTertiary,
                        modifier = Modifier.size(16.dp)
                    )
                }

                // Description if present
                if (!fileInfo.description.isNullOrBlank()) {
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = fileInfo.description!!,
                        style = MaterialTheme.typography.labelSmall,
                        color = LumiOnSurfaceTertiary,
                        fontStyle = FontStyle.Italic
                    )
                }
            }
        }
    }
}

/**
 * Copy text to the system clipboard and show a toast confirmation.
 */
private fun copyToClipboard(context: android.content.Context, text: String) {
    val clipboard = context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText("message", text))
    Toast.makeText(context, "Copied to clipboard", Toast.LENGTH_SHORT).show()
}
