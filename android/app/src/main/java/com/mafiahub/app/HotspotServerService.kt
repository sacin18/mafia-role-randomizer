package com.mafiahub.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.wifi.WifiManager
import android.os.Binder
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat

class HotspotServerService : Service() {

    inner class LocalBinder : Binder() {
        fun getService(): HotspotServerService = this@HotspotServerService
    }

    private val binder = LocalBinder()
    var server: MafiaHotspotServer? = null
        private set
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null
    var wakeStateListener: ((Boolean) -> Unit)? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(1001, buildNotification())

        server = MafiaHotspotServer(applicationContext, 8080) { keepAwake ->
            updateWakeLock(keepAwake)
            wakeStateListener?.invoke(keepAwake)
        }.also { it.start() }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        server?.start()
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onDestroy() {
        updateWakeLock(false)
        server?.stop()
        super.onDestroy()
    }

    private fun updateWakeLock(keepAwake: Boolean) {
        try {
            if (keepAwake) {
                if (wakeLock == null) {
                    val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
                    wakeLock = pm.newWakeLock(
                        PowerManager.PARTIAL_WAKE_LOCK,
                        "MafiaHub::HotspotLobbyWakeLock"
                    ).apply { acquire(30 * 60 * 1000L) }
                }
                if (wifiLock == null) {
                    val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
                    wifiLock = wm.createWifiLock(
                        WifiManager.WIFI_MODE_FULL_HIGH_PERF,
                        "MafiaHub::HotspotWifiLock"
                    ).apply { acquire() }
                }
            } else {
                wakeLock?.let { if (it.isHeld) it.release() }
                wakeLock = null
                wifiLock?.let { if (it.isHeld) it.release() }
                wifiLock = null
            }
        } catch (_: Exception) {
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                "mafia_hotspot_channel",
                "Mafia Hub Hotspot Server",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Runs the local offline Mafia role server on your Wi-Fi hotspot"
            }
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        val ip = MafiaHotspotServer.getHotspotIps().firstOrNull() ?: "localhost"
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return NotificationCompat.Builder(this, "mafia_hotspot_channel")
            .setContentTitle("Mafia Hub Hotspot Server Active")
            .setContentText("Players can connect at http://$ip:8080")
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()
    }
}
