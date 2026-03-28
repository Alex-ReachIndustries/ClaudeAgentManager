package com.claudemanager.app.data.sse

import android.util.Log
import com.claudemanager.app.data.api.ApiClient
import com.claudemanager.app.data.models.Agent
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/**
 * SSE (Server-Sent Events) client that connects to the ClaudeManager backend's
 * `/api/events` endpoint and emits parsed events as a Kotlin SharedFlow.
 *
 * Features:
 * - Automatic reconnection with exponential backoff (1s -> 2s -> 4s -> 8s -> max 30s)
 * - Connection state tracking via [connectionState]
 * - Typed event emission via sealed class [SSEEvent]
 * - Thread-safe cancel/reconnect
 */
class SSEClient {

    companion object {
        private const val TAG = "SSEClient"
        private const val INITIAL_BACKOFF_MS = 1000L
        private const val MAX_BACKOFF_MS = 30_000L
        private const val BACKOFF_MULTIPLIER = 2.0
    }

    /**
     * Connection state of the SSE client.
     */
    enum class ConnectionState {
        DISCONNECTED,
        CONNECTING,
        CONNECTED
    }

    private val _events = MutableSharedFlow<SSEEvent>(
        replay = 0,
        extraBufferCapacity = 64,
        onBufferOverflow = BufferOverflow.DROP_OLDEST
    )

    /** Flow of SSE events. Collectors receive events as they arrive from the server. */
    val events: SharedFlow<SSEEvent> = _events.asSharedFlow()

    private val _connectionState = MutableStateFlow(ConnectionState.DISCONNECTED)

    /** Current connection state. Useful for showing connectivity indicators in the UI. */
    val connectionState: StateFlow<ConnectionState> = _connectionState.asStateFlow()

    private var eventSource: EventSource? = null
    private var currentBackoffMs = INITIAL_BACKOFF_MS
    private var isCancelled = false

    private val scheduler = Executors.newSingleThreadScheduledExecutor { runnable ->
        Thread(runnable, "sse-reconnect").apply { isDaemon = true }
    }
    private var reconnectFuture: ScheduledFuture<*>? = null

    /**
     * OkHttp client configured for SSE with a long read timeout (no timeout)
     * since SSE connections are long-lived.
     */
    private val sseHttpClient: OkHttpClient by lazy {
        val baseUrl = ApiClient.getBaseUrl()
        val builder = if (baseUrl.startsWith("https://")) {
            ApiClient.createTrustAllClient().newBuilder()
        } else {
            ApiClient.okHttpClient.newBuilder()
        }
        builder
            .readTimeout(0, TimeUnit.SECONDS) // SSE connections are long-lived
            .retryOnConnectionFailure(true)
            .build()
    }

    /**
     * Connect to the SSE endpoint. If already connected, this is a no-op.
     * Call [cancel] to disconnect.
     */
    @Synchronized
    fun connect() {
        if (eventSource != null) return

        isCancelled = false
        currentBackoffMs = INITIAL_BACKOFF_MS
        doConnect()
    }

    /**
     * Disconnect from the SSE endpoint and stop reconnection attempts.
     */
    @Synchronized
    fun cancel() {
        isCancelled = true
        reconnectFuture?.cancel(false)
        reconnectFuture = null
        eventSource?.cancel()
        eventSource = null
        _connectionState.value = ConnectionState.DISCONNECTED
        Log.d(TAG, "SSE connection cancelled")
    }

    /**
     * Disconnect and immediately reconnect. Useful when the base URL changes.
     */
    fun reconnect() {
        cancel()
        connect()
    }

    private fun doConnect() {
        val baseUrl = ApiClient.getBaseUrl()
        val apiKey = ApiClient.getApiKey()
        val tokenParam = if (apiKey.isNotEmpty()) "?token=${java.net.URLEncoder.encode(apiKey, "UTF-8")}" else ""
        val url = "$baseUrl/api/events$tokenParam"

        Log.d(TAG, "Connecting to SSE at $baseUrl/api/events")
        _connectionState.value = ConnectionState.CONNECTING

        val request = Request.Builder()
            .url(url)
            .header("Accept", "text/event-stream")
            .build()

        val factory = EventSources.createFactory(sseHttpClient)

        eventSource = factory.newEventSource(request, object : EventSourceListener() {

            override fun onOpen(eventSource: EventSource, response: Response) {
                Log.d(TAG, "SSE connection opened")
                _connectionState.value = ConnectionState.CONNECTED
                currentBackoffMs = INITIAL_BACKOFF_MS // Reset backoff on successful connection
            }

            override fun onEvent(
                eventSource: EventSource,
                id: String?,
                type: String?,
                data: String
            ) {
                if (type == null) return

                Log.v(TAG, "SSE event: type=$type, data=${data.take(200)}")

                try {
                    val event = parseEvent(type, data)
                    if (event != null) {
                        _events.tryEmit(event)
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Failed to parse SSE event: type=$type", e)
                }
            }

            override fun onClosed(eventSource: EventSource) {
                Log.d(TAG, "SSE connection closed by server")
                _connectionState.value = ConnectionState.DISCONNECTED
                scheduleReconnect()
            }

            override fun onFailure(
                eventSource: EventSource,
                t: Throwable?,
                response: Response?
            ) {
                Log.w(TAG, "SSE connection failure: ${t?.message}", t)
                _connectionState.value = ConnectionState.DISCONNECTED
                scheduleReconnect()
            }
        })
    }

    private fun parseEvent(type: String, data: String): SSEEvent? {
        val gson = ApiClient.gson

        return when (type) {
            "agent-updated" -> {
                val agent = gson.fromJson(data, Agent::class.java)
                SSEEvent.AgentUpdated(agent)
            }
            "agent-deleted" -> {
                val json = com.google.gson.JsonParser.parseString(data).asJsonObject
                val id = json.get("id").asString
                SSEEvent.AgentDeleted(id)
            }
            "message-queued" -> {
                val json = com.google.gson.JsonParser.parseString(data).asJsonObject
                val agentId = json.get("agentId").asString
                val content = json.get("content").asString
                SSEEvent.MessageQueued(agentId, content)
            }
            "launch-request-created" -> {
                SSEEvent.LaunchRequestCreated(data)
            }
            "launch-request-updated" -> {
                SSEEvent.LaunchRequestUpdated(data)
            }
            else -> {
                Log.d(TAG, "Unknown SSE event type: $type")
                null
            }
        }
    }

    @Synchronized
    private fun scheduleReconnect() {
        if (isCancelled) return

        // Clean up old event source
        eventSource?.cancel()
        eventSource = null

        Log.d(TAG, "Scheduling reconnect in ${currentBackoffMs}ms")

        reconnectFuture = scheduler.schedule({
            synchronized(this@SSEClient) {
                if (!isCancelled) {
                    doConnect()
                }
            }
        }, currentBackoffMs, TimeUnit.MILLISECONDS)

        // Exponential backoff with cap
        currentBackoffMs = (currentBackoffMs * BACKOFF_MULTIPLIER).toLong()
            .coerceAtMost(MAX_BACKOFF_MS)
    }
}

/**
 * Typed SSE events emitted by [SSEClient].
 */
sealed class SSEEvent {
    /**
     * An agent was created or updated. Contains the full updated agent object.
     */
    data class AgentUpdated(val agent: Agent) : SSEEvent()

    /**
     * An agent was deleted from the system.
     */
    data class AgentDeleted(val agentId: String) : SSEEvent()

    /**
     * A new message was queued for delivery to an agent.
     */
    data class MessageQueued(val agentId: String, val content: String) : SSEEvent()

    /**
     * A new launch request was created.
     */
    data class LaunchRequestCreated(val rawData: String) : SSEEvent()

    /**
     * A launch request was updated (claimed, completed, failed).
     */
    data class LaunchRequestUpdated(val rawData: String) : SSEEvent()
}
