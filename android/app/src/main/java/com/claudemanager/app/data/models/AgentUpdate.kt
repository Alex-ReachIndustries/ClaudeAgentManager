package com.claudemanager.app.data.models

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.google.gson.annotations.SerializedName

/**
 * An update posted by an agent. The `content` field from the backend is a JSON string
 * containing another JSON object, requiring double-parsing.
 */
data class AgentUpdate(
    @SerializedName("id")
    val id: Long,

    @SerializedName("agent_id")
    val agentId: String,

    @SerializedName("timestamp")
    val timestamp: String,

    @SerializedName("type")
    val type: UpdateType,

    @SerializedName("content")
    val content: String,

    @SerializedName("summary")
    val summary: String? = null
) {
    /**
     * Parse the double-encoded content field into a typed [UpdateContent] object.
     * The backend stores `content` as a JSON string like `"{\"text\":\"hello\"}"`.
     * We first parse the outer string, then parse the inner JSON object.
     */
    fun parsedContent(): UpdateContent {
        return try {
            // The content is a JSON string. First, try parsing it directly as a JSON object.
            // If it's double-encoded (a JSON string containing escaped JSON), parse twice.
            val jsonElement = try {
                val parsed = JsonParser.parseString(content)
                if (parsed.isJsonObject) {
                    parsed.asJsonObject
                } else if (parsed.isJsonPrimitive && parsed.asJsonPrimitive.isString) {
                    // Double-encoded: the outer parse yielded a string, parse again
                    JsonParser.parseString(parsed.asString).asJsonObject
                } else {
                    null
                }
            } catch (_: Exception) {
                null
            }

            if (jsonElement == null) {
                return UpdateContent.Text(content)
            }

            when (type) {
                UpdateType.TEXT -> {
                    val text = jsonElement.getStringOrNull("text") ?: content
                    UpdateContent.Text(text)
                }
                UpdateType.PROGRESS -> {
                    val description = jsonElement.getStringOrNull("description") ?: ""
                    val percentage = jsonElement.getIntOrNull("percentage") ?: 0
                    UpdateContent.Progress(description, percentage)
                }
                UpdateType.ERROR -> {
                    val message = jsonElement.getStringOrNull("message") ?: content
                    UpdateContent.Error(message)
                }
                UpdateType.STATUS -> {
                    val status = jsonElement.getStringOrNull("status") ?: content
                    UpdateContent.Status(status)
                }
                UpdateType.DIAGRAM -> {
                    val diagram = jsonElement.getStringOrNull("diagram") ?: content
                    UpdateContent.Diagram(diagram)
                }
            }
        } catch (_: Exception) {
            // Fallback: treat raw content as text
            UpdateContent.Text(content)
        }
    }
}

/**
 * The type of an agent update.
 */
enum class UpdateType {
    @SerializedName("text")
    TEXT,

    @SerializedName("progress")
    PROGRESS,

    @SerializedName("error")
    ERROR,

    @SerializedName("status")
    STATUS,

    @SerializedName("diagram")
    DIAGRAM
}

/**
 * Typed content extracted from an [AgentUpdate]'s content field.
 */
sealed class UpdateContent {
    data class Text(val text: String) : UpdateContent()
    data class Progress(val description: String, val percentage: Int) : UpdateContent()
    data class Error(val message: String) : UpdateContent()
    data class Status(val status: String) : UpdateContent()
    data class Diagram(val diagram: String) : UpdateContent()

    /**
     * Returns a human-readable summary of this content, suitable for display
     * in a list item or notification.
     */
    fun displayText(): String = when (this) {
        is Text -> text
        is Progress -> if (percentage > 0) "$description ($percentage%)" else description
        is Error -> message
        is Status -> status
        is Diagram -> "(diagram)"
    }
}

/**
 * Extension to safely get a string from a JsonObject.
 */
private fun JsonObject.getStringOrNull(key: String): String? {
    val element = get(key) ?: return null
    return if (element.isJsonPrimitive && element.asJsonPrimitive.isString) {
        element.asString
    } else {
        element.toString()
    }
}

/**
 * Extension to safely get an int from a JsonObject.
 */
private fun JsonObject.getIntOrNull(key: String): Int? {
    val element = get(key) ?: return null
    return try {
        when {
            element.isJsonPrimitive && element.asJsonPrimitive.isNumber -> element.asInt
            element.isJsonPrimitive && element.asJsonPrimitive.isString -> element.asString.toIntOrNull()
            else -> null
        }
    } catch (_: Exception) {
        null
    }
}
