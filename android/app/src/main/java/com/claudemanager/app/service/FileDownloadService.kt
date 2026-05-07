package com.claudemanager.app.service

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.claudemanager.app.MainActivity
import com.claudemanager.app.R
import com.claudemanager.app.data.api.ApiClient
import com.claudemanager.app.notification.NotificationHelper
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Foreground service that streams a file from the backend directly to a
 * caller-supplied SAF URI, with a progress notification. Survives the user
 * leaving the agent detail screen or backgrounding the app.
 *
 * Multiple downloads can run in parallel; each gets its own notification ID.
 * The service stops itself once the last download finishes.
 */
class FileDownloadService : Service() {

    private val supervisor = SupervisorJob()
    private val scope = CoroutineScope(Dispatchers.IO + supervisor)
    private val active = mutableSetOf<Int>()

    companion object {
        private const val TAG = "FileDownloadService"
        private const val ACTION_START = "com.claudemanager.app.DOWNLOAD_START"
        private const val EXTRA_URL = "url"
        private const val EXTRA_FILENAME = "filename"
        private const val EXTRA_URI = "uri"
        private const val NOTIFICATION_ID_BASE = 20000

        /** Kick off a save-to-SAF download. Safe to call from a UI scope. */
        fun start(context: Context, url: String, filename: String, destination: Uri) {
            val intent = Intent(context, FileDownloadService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_URL, url)
                putExtra(EXTRA_FILENAME, filename)
                putExtra(EXTRA_URI, destination)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action != ACTION_START) {
            stopIfIdle()
            return START_NOT_STICKY
        }
        val url = intent.getStringExtra(EXTRA_URL)
        val filename = intent.getStringExtra(EXTRA_FILENAME) ?: "download"
        @Suppress("DEPRECATION")
        val destination: Uri? = if (Build.VERSION.SDK_INT >= 33) {
            intent.getParcelableExtra(EXTRA_URI, Uri::class.java)
        } else {
            intent.getParcelableExtra(EXTRA_URI)
        }

        if (url.isNullOrBlank() || destination == null) {
            Log.w(TAG, "missing url/destination, ignoring start")
            stopIfIdle()
            return START_NOT_STICKY
        }

        val notificationId = NOTIFICATION_ID_BASE + startId
        active.add(notificationId)

        val initialNotif = buildProgressNotification(filename, percent = -1, written = 0L, total = -1L)
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(notificationId, initialNotif, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(notificationId, initialNotif)
        }

        scope.launch {
            try {
                streamToUri(url, filename, destination, notificationId)
            } catch (e: Exception) {
                Log.e(TAG, "download failed", e)
                showCompletionNotification(notificationId, filename, success = false, message = e.message ?: "unknown error")
            } finally {
                active.remove(notificationId)
                stopIfIdle()
            }
        }
        return START_NOT_STICKY
    }

    private suspend fun streamToUri(url: String, filename: String, destination: Uri, notificationId: Int) {
        val client = ApiClient.getRetrofit().callFactory() as okhttp3.OkHttpClient
        val request = okhttp3.Request.Builder()
            .url(url)
            // identity disables the server's gzip middleware and OkHttp's
            // transparent decompression — both of which strip Content-Length
            // and break determinate progress.
            .header("Accept-Encoding", "identity")
            .build()
        val response = client.newCall(request).execute()
        if (!response.isSuccessful) {
            showCompletionNotification(notificationId, filename, success = false, message = "HTTP ${response.code}")
            return
        }
        val body = response.body
        if (body == null) {
            showCompletionNotification(notificationId, filename, success = false, message = "empty response")
            return
        }
        val total = body.contentLength()
        val out = contentResolver.openOutputStream(destination)
        if (out == null) {
            showCompletionNotification(notificationId, filename, success = false, message = "could not open destination")
            return
        }

        var written = 0L
        var lastPercent = -1
        out.use { o ->
            body.byteStream().use { input ->
                val buf = ByteArray(8 * 1024)
                while (true) {
                    val n = input.read(buf)
                    if (n == -1) break
                    o.write(buf, 0, n)
                    written += n
                    if (total > 0) {
                        val pct = ((written * 100L) / total).toInt()
                        if (pct != lastPercent) {
                            lastPercent = pct
                            postProgress(notificationId, filename, pct, written, total)
                        }
                    }
                }
            }
        }
        showCompletionNotification(notificationId, filename, success = true, message = null)
    }

    private fun postProgress(id: Int, filename: String, percent: Int, written: Long, total: Long) {
        val notif = buildProgressNotification(filename, percent, written, total)
        try {
            NotificationManagerCompat.from(this).notify(id, notif)
        } catch (_: SecurityException) {
            // POST_NOTIFICATIONS not granted
        }
    }

    private fun buildProgressNotification(filename: String, percent: Int, written: Long, total: Long): Notification {
        val title = "Saving $filename"
        val subtitle = when {
            percent < 0 -> "Connecting…"
            total > 0 -> "${formatBytes(written)} / ${formatBytes(total)} ($percent%)"
            else -> formatBytes(written)
        }

        val openIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val openPi = PendingIntent.getActivity(
            this, 0, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val builder = NotificationCompat.Builder(this, NotificationHelper.CHANNEL_SERVICE)
            .setContentTitle(title)
            .setContentText(subtitle)
            .setSmallIcon(R.drawable.ic_notification)
            .setOngoing(true)
            .setLocalOnly(true)
            .setContentIntent(openPi)

        if (percent < 0) {
            builder.setProgress(0, 0, true)
        } else {
            builder.setProgress(100, percent, false)
        }
        return builder.build()
    }

    private fun showCompletionNotification(id: Int, filename: String, success: Boolean, message: String?) {
        val title = if (success) "Saved $filename" else "Failed to save $filename"
        val builder = NotificationCompat.Builder(this, NotificationHelper.CHANNEL_SERVICE)
            .setContentTitle(title)
            .setSmallIcon(R.drawable.ic_notification)
            .setLocalOnly(true)
            .setAutoCancel(true)
            .setOngoing(false)
        if (!success && !message.isNullOrBlank()) {
            builder.setContentText(message)
        }
        try {
            NotificationManagerCompat.from(this).notify(id, builder.build())
        } catch (_: SecurityException) {
            // POST_NOTIFICATIONS not granted
        }
    }

    private fun stopIfIdle() {
        if (active.isEmpty()) {
            stopForeground(STOP_FOREGROUND_DETACH)
            stopSelf()
        }
    }

    private fun formatBytes(b: Long): String = when {
        b < 1024L -> "$b B"
        b < 1024L * 1024 -> "%.1f KB".format(b / 1024.0)
        b < 1024L * 1024 * 1024 -> "%.1f MB".format(b / 1024.0 / 1024.0)
        else -> "%.2f GB".format(b / 1024.0 / 1024.0 / 1024.0)
    }

    override fun onDestroy() {
        super.onDestroy()
        supervisor.cancel()
    }
}
