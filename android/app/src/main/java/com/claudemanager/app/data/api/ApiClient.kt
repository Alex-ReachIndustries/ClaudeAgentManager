package com.claudemanager.app.data.api

import com.claudemanager.app.data.models.Agent
import com.claudemanager.app.data.models.AgentMetadata
import com.google.gson.Gson
import com.google.gson.GsonBuilder
import com.google.gson.JsonDeserializationContext
import com.google.gson.JsonDeserializer
import com.google.gson.JsonElement
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.lang.reflect.Type
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

/**
 * Singleton that manages the OkHttp client and Retrofit instance for communicating
 * with the ClaudeManager backend. Supports dynamic base URL changes (e.g. when the
 * user configures a different server in settings).
 */
object ApiClient {

    private const val DEFAULT_BASE_URL = "http://localhost:3001"

    @Volatile
    private var baseUrl: String = DEFAULT_BASE_URL

    @Volatile
    private var apiKey: String = ""

    @Volatile
    private var retrofit: Retrofit? = null

    @Volatile
    private var agentApi: AgentApi? = null

    /** Auth interceptor that adds Bearer token to all requests when API key is set */
    private val authInterceptor = Interceptor { chain ->
        val request = if (apiKey.isNotEmpty()) {
            chain.request().newBuilder()
                .addHeader("Authorization", "Bearer $apiKey")
                .build()
        } else {
            chain.request()
        }
        chain.proceed(request)
    }

    /** Get the current API key */
    fun getApiKey(): String = apiKey

    /** Set the API key and invalidate cached instances */
    @Synchronized
    fun setApiKey(key: String) {
        if (key == apiKey) return
        apiKey = key
        retrofit = null
        agentApi = null
    }

    /**
     * Gson instance configured for the ClaudeManager API.
     * - Lenient parsing to handle slightly malformed JSON from edge cases.
     * - Custom deserializer for AgentMetadata which may arrive as either a JSON object
     *   or a JSON-encoded string.
     */
    val gson: Gson = GsonBuilder()
        .setLenient()
        .registerTypeAdapter(AgentMetadata::class.java, AgentMetadataDeserializer())
        .create()

    /**
     * OkHttp client with reasonable timeouts for a Tailscale network connection.
     * - Connect: 10 seconds (Tailscale can sometimes be slow to establish)
     * - Read: 30 seconds (for large responses like update lists)
     * - Write: 30 seconds (for file uploads)
     */
    val okHttpClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .addInterceptor(authInterceptor)
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
    }

    /**
     * Creates an OkHttp client that trusts all certificates.
     * Only use this for Tailscale self-signed HTTPS connections where the
     * network itself is already encrypted and authenticated.
     */
    fun createTrustAllClient(): OkHttpClient {
        val trustAllCerts = arrayOf<TrustManager>(object : X509TrustManager {
            override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {}
            override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {}
            override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
        })

        val sslContext = SSLContext.getInstance("TLS")
        sslContext.init(null, trustAllCerts, SecureRandom())

        return OkHttpClient.Builder()
            .addInterceptor(authInterceptor)
            .sslSocketFactory(sslContext.socketFactory, trustAllCerts[0] as X509TrustManager)
            .hostnameVerifier { _, _ -> true }
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
    }

    /**
     * Get the current base URL.
     */
    fun getBaseUrl(): String = baseUrl

    /**
     * Update the base URL and invalidate cached Retrofit/API instances.
     * Thread-safe via synchronized block.
     */
    @Synchronized
    fun setBaseUrl(url: String) {
        val normalizedUrl = url.trimEnd('/')
        if (normalizedUrl == baseUrl) return

        baseUrl = normalizedUrl
        retrofit = null
        agentApi = null
    }

    /**
     * Get or create the Retrofit instance for the current base URL.
     */
    @Synchronized
    fun getRetrofit(): Retrofit {
        retrofit?.let { return it }

        val client = if (baseUrl.startsWith("https://")) {
            createTrustAllClient()
        } else {
            okHttpClient
        }

        val newRetrofit = Retrofit.Builder()
            .baseUrl("$baseUrl/")
            .client(client)
            .addConverterFactory(GsonConverterFactory.create(gson))
            .build()

        retrofit = newRetrofit
        return newRetrofit
    }

    /**
     * Get or create the [AgentApi] service interface.
     */
    @Synchronized
    fun getAgentApi(): AgentApi {
        agentApi?.let { return it }

        val newApi = getRetrofit().create(AgentApi::class.java)
        agentApi = newApi
        return newApi
    }

    /**
     * Convenience: build a one-off Retrofit instance pointed at a specific URL,
     * useful for testing connectivity to a server during setup.
     */
    fun createRetrofitForUrl(url: String): Retrofit {
        val normalizedUrl = url.trimEnd('/')
        val client = if (normalizedUrl.startsWith("https://")) {
            createTrustAllClient()
        } else {
            // Use a short-timeout client for health checks
            OkHttpClient.Builder()
                .connectTimeout(5, TimeUnit.SECONDS)
                .readTimeout(5, TimeUnit.SECONDS)
                .writeTimeout(5, TimeUnit.SECONDS)
                .build()
        }

        return Retrofit.Builder()
            .baseUrl("$normalizedUrl/")
            .client(client)
            .addConverterFactory(GsonConverterFactory.create(gson))
            .build()
    }
}

/**
 * Custom Gson deserializer for [AgentMetadata].
 *
 * The backend stores metadata as a JSON string in SQLite. Depending on the endpoint,
 * it may arrive as:
 * 1. A JSON object: `{"projects": [...], "todos": [...]}`
 * 2. A JSON string: `"{\"projects\": [...], \"todos\": [...]}"` (escaped)
 *
 * This deserializer handles both cases.
 */
private class AgentMetadataDeserializer : JsonDeserializer<AgentMetadata> {
    override fun deserialize(
        json: JsonElement,
        typeOfT: Type,
        context: JsonDeserializationContext
    ): AgentMetadata {
        return try {
            when {
                json.isJsonObject -> {
                    // Already a proper JSON object, deserialize normally
                    val obj = json.asJsonObject
                    AgentMetadata(
                        projects = if (obj.has("projects") && obj.get("projects").isJsonArray) {
                            obj.getAsJsonArray("projects").map { element ->
                                context.deserialize(element, com.claudemanager.app.data.models.ProjectStatus::class.java)
                            }
                        } else {
                            emptyList()
                        },
                        todos = if (obj.has("todos") && obj.get("todos").isJsonArray) {
                            obj.getAsJsonArray("todos").map { element ->
                                context.deserialize(element, com.claudemanager.app.data.models.TodoStatus::class.java)
                            }
                        } else {
                            emptyList()
                        }
                    )
                }
                json.isJsonPrimitive && json.asJsonPrimitive.isString -> {
                    // JSON string -- parse it first, then deserialize
                    val innerJson = com.google.gson.JsonParser.parseString(json.asString)
                    deserialize(innerJson, typeOfT, context)
                }
                else -> AgentMetadata()
            }
        } catch (_: Exception) {
            AgentMetadata()
        }
    }
}
