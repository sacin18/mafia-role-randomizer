package com.mafiahub.app

import android.annotation.SuppressLint
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var urlTextView: TextView
    private var boundService: HotspotServerService? = null
    private val uiHandler = Handler(Looper.getMainLooper())
    private var currentBrowserUrl: String = "http://192.168.43.1:8080"

    private val ipRefreshRunnable = object : Runnable {
        override fun run() {
            updateHotspotUrlBanner()
            uiHandler.postDelayed(this, 3000L)
        }
    }

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            val binder = service as? HotspotServerService.LocalBinder ?: return
            boundService = binder.getService()
            boundService?.wakeStateListener = { keepScreenAwake ->
                runOnUiThread {
                    if (keepScreenAwake) {
                        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    } else {
                        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    }
                }
            }
            updateHotspotUrlBanner()
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            boundService = null
        }
    }

    private fun dp(value: Int): Int {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value.toFloat(),
            resources.displayMetrics
        ).toInt()
    }

    private fun updateHotspotUrlBanner() {
        val ips = MafiaHotspotServer.getHotspotIps().filter { it != "127.0.0.1" && it != "localhost" }
        val primaryIp = ips.firstOrNull() ?: "192.168.43.1"
        val activeCode = boundService?.server?.getLatestActiveGameCode()
        val baseUrl = "http://$primaryIp:8080"
        currentBrowserUrl = if (!activeCode.isNullOrBlank()) {
            "$baseUrl/?gamecode=$activeCode"
        } else {
            baseUrl
        }

        if (this::urlTextView.isInitialized) {
            if (ips.isEmpty()) {
                urlTextView.text = "Turn on Wi-Fi Hotspot • URL: $currentBrowserUrl"
            } else {
                urlTextView.text = currentBrowserUrl
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Keep screen awake by default while setting up lobby until roles are assigned
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // Start & bind embedded Hotspot HTTP + WebSocket Server service
        val serviceIntent = Intent(this, HotspotServerService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent)
        } else {
            startService(serviceIntent)
        }
        bindService(serviceIntent, connection, Context.BIND_AUTO_CREATE)

        // Root vertical layout: Top Native Browser URL Bar + Fullscreen WebView
        val rootLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.parseColor("#0B0F19"))
        }

        // Top bar showing the URL for other players to open in their browser
        val urlBanner = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(8), dp(12), dp(8))
            setBackgroundColor(Color.parseColor("#111827"))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        }

        val textColumn = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }

        val labelView = TextView(this).apply {
            text = "OTHER PLAYERS OPEN IN BROWSER:"
            setTextColor(Color.parseColor("#94A3B8"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 10f)
            typeface = Typeface.DEFAULT_BOLD
        }

        urlTextView = TextView(this).apply {
            text = currentBrowserUrl
            setTextColor(Color.parseColor("#38BDF8"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            typeface = Typeface.MONOSPACE
            setPadding(0, dp(2), 0, 0)
            setOnClickListener {
                copyUrlToClipboard()
            }
        }

        textColumn.addView(labelView)
        textColumn.addView(urlTextView)

        val copyBtn = TextView(this).apply {
            text = "Copy URL"
            setTextColor(Color.parseColor("#F8FAFC"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            typeface = Typeface.DEFAULT_BOLD
            setPadding(dp(10), dp(6), dp(10), dp(6))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#2563EB"))
                cornerRadius = dp(6).toFloat()
            }
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                marginStart = dp(8)
            }
            setOnClickListener {
                copyUrlToClipboard()
            }
        }

        val shareBtn = TextView(this).apply {
            text = "Share"
            setTextColor(Color.parseColor("#E2E8F0"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            typeface = Typeface.DEFAULT_BOLD
            setPadding(dp(10), dp(6), dp(10), dp(6))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#1E293B"))
                setStroke(dp(1), Color.parseColor("#334155"))
                cornerRadius = dp(6).toFloat()
            }
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                marginStart = dp(6)
            }
            setOnClickListener {
                val shareIntent = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(
                        Intent.EXTRA_TEXT,
                        "Join our Mafia game! Connect to my Wi-Fi Hotspot and open this URL in your browser: $currentBrowserUrl"
                    )
                }
                startActivity(Intent.createChooser(shareIntent, "Share Game URL"))
            }
        }

        urlBanner.addView(textColumn)
        urlBanner.addView(copyBtn)
        urlBanner.addView(shareBtn)

        // Bottom thin divider under banner
        val divider = LinearLayout(this).apply {
            setBackgroundColor(Color.parseColor("#1E293B"))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(1)
            )
        }

        webView = WebView(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f
            )
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            webViewClient = WebViewClient()
            webChromeClient = WebChromeClient()
            addJavascriptInterface(AndroidBridge(), "AndroidBridge")
        }

        rootLayout.addView(urlBanner)
        rootLayout.addView(divider)
        rootLayout.addView(webView)
        setContentView(rootLayout)

        updateHotspotUrlBanner()
        uiHandler.post(ipRefreshRunnable)

        // Connect WebView to the embedded local server on port 8080
        webView.postDelayed({
            webView.loadUrl("http://127.0.0.1:8080")
        }, 250)
    }

    private fun copyUrlToClipboard(customUrl: String? = null) {
        val target = customUrl ?: currentBrowserUrl
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("Mafia Hub URL", target))
        Toast.makeText(this, "Copied: $target", Toast.LENGTH_SHORT).show()
    }

    inner class AndroidBridge {
        @JavascriptInterface
        fun copyText(text: String) {
            runOnUiThread {
                copyUrlToClipboard(text)
            }
        }

        @JavascriptInterface
        fun shareUrl(url: String, gameCode: String) {
            runOnUiThread {
                val shareIntent = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(
                        Intent.EXTRA_TEXT,
                        "Join our Mafia game ($gameCode)! Connect to my Wi-Fi Hotspot and open this URL in your browser: $url"
                    )
                }
                startActivity(Intent.createChooser(shareIntent, "Share Game Invite Link"))
            }
        }
    }

    override fun onBackPressed() {
        if (this::webView.isInitialized && webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        uiHandler.removeCallbacks(ipRefreshRunnable)
        try {
            unbindService(connection)
        } catch (_: Exception) {
        }
        super.onDestroy()
    }
}
