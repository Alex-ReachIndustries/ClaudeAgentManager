package com.claudemanager.app.data.mqtt

import android.util.Log
import com.claudemanager.app.data.api.ApiClient
import com.claudemanager.app.data.models.Agent
import com.claudemanager.app.data.sse.SSEEvent
import com.hivemq.client.mqtt.MqttClient
import com.hivemq.client.mqtt.datatypes.MqttQos
import com.hivemq.client.mqtt.mqtt3.Mqtt3AsyncClient
import com.hivemq.client.mqtt.mqtt3.message.publish.Mqtt3Publish
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import java.net.URI
import java.nio.charset.StandardCharsets

/**
 * MQTT client for the Android app that connects to the Mosquitto broker
 * via WebSocket and emits events compatible with the existing SSEEvent flow.
 *
 * Tries MQTT first; if connection fails, the app falls back to SSE.
 */
class MqttEventClient {

    companion object {
        private const val TAG = "MqttEventClient"
        private const val MQTT_USERNAME = "dashboard"
        private const val MQTT_PASSWORD = "dashboard"
    }

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

    val events: SharedFlow<SSEEvent> = _events.asSharedFlow()

    private val _connectionState = MutableStateFlow(ConnectionState.DISCONNECTED)
    val connectionState: StateFlow<ConnectionState> = _connectionState.asStateFlow()

    private var client: Mqtt3AsyncClient? = null
    private var isCancelled = false

    /**
     * Connect to the MQTT broker via WebSocket.
     * The broker URL is derived from the API base URL.
     */
    @Synchronized
    fun connect() {
        if (client != null) return
        isCancelled = false
        _connectionState.value = ConnectionState.CONNECTING

        try {
            val baseUrl = ApiClient.getBaseUrl()
            val uri = URI(baseUrl)
            val host = uri.host
            val useSSL = baseUrl.startsWith("https://")
            // MQTT WebSocket path — proxied through Nginx at /mqtt
            val port = if (uri.port > 0) uri.port else if (useSSL) 443 else 80

            Log.d(TAG, "Connecting to MQTT at $host:$port/mqtt (ssl=$useSSL)")

            val builder = MqttClient.builder()
                .useMqttVersion3()
                .identifier("android-${System.currentTimeMillis()}")
                .serverHost(host)
                .serverPort(port)
                .webSocketConfig()
                    .serverPath("/mqtt")
                    .applyWebSocketConfig()
                .simpleAuth()
                    .username(MQTT_USERNAME)
                    .password(MQTT_PASSWORD.toByteArray(StandardCharsets.UTF_8))
                    .applySimpleAuth()

            if (useSSL) {
                builder.sslWithDefaultConfig()
            }

            client = builder.buildAsync()

            client!!.connectWith()
                .cleanSession(true)
                .send()
                .whenComplete { _, throwable ->
                    if (throwable != null) {
                        Log.w(TAG, "MQTT connection failed: ${throwable.message}")
                        _connectionState.value = ConnectionState.DISCONNECTED
                        client = null
                    } else {
                        Log.d(TAG, "MQTT connected")
                        _connectionState.value = ConnectionState.CONNECTED
                        subscribeToTopics()
                    }
                }
        } catch (e: Exception) {
            Log.e(TAG, "MQTT setup failed: ${e.message}", e)
            _connectionState.value = ConnectionState.DISCONNECTED
            client = null
        }
    }

    private fun subscribeToTopics() {
        val mqttClient = client ?: return

        // Subscribe to agent updates and messages
        mqttClient.subscribeWith()
            .topicFilter("agents/+/updates")
            .qos(MqttQos.AT_MOST_ONCE)
            .callback { publish -> handleMessage(publish) }
            .send()

        mqttClient.subscribeWith()
            .topicFilter("agents/+/messages")
            .qos(MqttQos.AT_MOST_ONCE)
            .callback { publish -> handleMessage(publish) }
            .send()

        Log.d(TAG, "Subscribed to MQTT topics")
    }

    private fun handleMessage(publish: Mqtt3Publish) {
        try {
            val topic = publish.topic.toString()
            val payload = String(publish.payloadAsBytes, StandardCharsets.UTF_8)
            val parts = topic.split("/")

            Log.v(TAG, "MQTT message: topic=$topic, payload=${payload.take(200)}")

            val gson = ApiClient.gson

            when {
                parts.size >= 3 && parts[0] == "agents" && parts[2] == "updates" -> {
                    val agent = gson.fromJson(payload, Agent::class.java)
                    _events.tryEmit(SSEEvent.AgentUpdated(agent))
                }
                parts.size >= 3 && parts[0] == "agents" && parts[2] == "messages" -> {
                    val json = com.google.gson.JsonParser.parseString(payload).asJsonObject
                    val agentId = parts[1]
                    val content = json.get("content")?.asString ?: ""
                    _events.tryEmit(SSEEvent.MessageQueued(agentId, content))
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to parse MQTT message", e)
        }
    }

    /**
     * Disconnect from the MQTT broker.
     */
    @Synchronized
    fun cancel() {
        isCancelled = true
        try {
            client?.disconnect()
        } catch (e: Exception) {
            Log.w(TAG, "Error disconnecting MQTT", e)
        }
        client = null
        _connectionState.value = ConnectionState.DISCONNECTED
        Log.d(TAG, "MQTT disconnected")
    }

    /**
     * Disconnect and reconnect.
     */
    fun reconnect() {
        cancel()
        connect()
    }

    /**
     * Check if currently connected.
     */
    fun isConnected(): Boolean = _connectionState.value == ConnectionState.CONNECTED
}
