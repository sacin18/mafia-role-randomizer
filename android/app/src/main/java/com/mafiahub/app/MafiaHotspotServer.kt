package com.mafiahub.app

import android.content.Context
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.Collections
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.Executors
import kotlin.math.floor
import kotlin.math.max
import kotlin.random.Random

/**
 * Embedded Zero-Dependency HTTP + RFC 6455 WebSocket Server for Android.
 * Runs directly on the host phone (0.0.0.0:8080) over Wi-Fi Hotspot with no internet required.
 */
class MafiaHotspotServer(
    private val context: Context,
    val port: Int = 8080,
    private val onLobbyWakeStateChanged: (Boolean) -> Unit = {}
) {
    private var serverSocket: ServerSocket? = null
    @Volatile
    private var running = false
    private val executor = Executors.newCachedThreadPool()
    private val clients = CopyOnWriteArraySet<WsClient>()
    private val stateLock = Any()
    private val stateFile = File(context.filesDir, "games_state.json")

    private val games = mutableMapOf<String, JSONObject>()
    private val previousPlayersByCode = mutableMapOf<String, List<String>>()

    companion object {
        private val ADJECTIVES = listOf(
            "admiring", "adoring", "affectionate", "amazing", "awesome", "blissful", "bold",
            "brave", "busy", "charming", "clever", "cool", "compassionate", "competent",
            "confident", "cranky", "dazzling", "determined", "dreamy", "eager", "ecstatic",
            "elastic", "elated", "elegant", "eloquent", "epic", "exciting", "fervent",
            "festive", "focused", "friendly", "frosty", "funny", "gallant", "gifted",
            "gracious", "great", "happy", "hardcore", "heuristic", "hopeful", "infallible",
            "inspiring", "intelligent", "jolly", "jovial", "keen", "kind", "laughing",
            "lucid", "magical", "mystifying", "modest", "nifty", "nostalgic", "objective",
            "optimistic", "peaceful", "practical", "priceless", "quirky", "relaxed",
            "reverent", "serene", "sharp", "stoic", "sweet", "trusting", "upbeat",
            "vibrant", "vigilant", "vigorous", "wizardly", "wonderful", "youthful", "zealous", "zen"
        )

        private val SURNAMES = listOf(
            "albattani", "allen", "archimedes", "aryabhata", "babbage", "banach", "bardeen",
            "bartik", "bell", "benz", "bhabha", "bhaskara", "blackwell", "bohr", "bose",
            "bouman", "brahmagupta", "carson", "chandrasekhar", "chatterjee", "chebyshev",
            "clarke", "cori", "cray", "curie", "darwin", "davinci", "dijkstra", "easley",
            "edison", "einstein", "euclid", "euler", "faraday", "fermat", "fermi", "feynman",
            "franklin", "galileo", "gauss", "goldwasser", "goodall", "hamilton", "hawking",
            "heisenberg", "herschel", "hertz", "hodgkin", "hopper", "hypatia", "jemison",
            "kalam", "kapitsa", "keller", "kepler", "khayyam", "kilby", "knuth", "kowalevski",
            "lamarr", "lamport", "liskov", "lovelace", "lumiere", "mahavira", "maxwell",
            "mccarthy", "mcclintock", "mendel", "mendeleev", "meitner", "merkle", "mirzakhani",
            "moore", "morse", "napier", "nash", "neumann", "newton", "nightingale", "nobel",
            "noether", "noyce", "panini", "pascal", "pasteur", "perlman", "poincare",
            "ptolemy", "raman", "ramanujan", "ritchie", "roentgen", "rosalind", "rubin",
            "saha", "satoshi", "shamir", "shannon", "shockley", "solomon", "stonebraker",
            "sutherland", "swartz", "tesla", "thompson", "torvalds", "turing", "varahamihira",
            "vaughan", "visvesvaraya", "wiles", "wozniak", "wright", "wu", "yalow", "yonath"
        )

        fun normalizeIp(raw: String?): String {
            val clean = (raw ?: "").trim()
            if (clean.isEmpty()) return "127.0.0.1"
            if (clean.startsWith("::ffff:")) return clean.substring(7)
            if (clean == "::1") return "127.0.0.1"
            return clean
        }

        fun getHotspotIps(): List<String> {
            val priorityIps = mutableListOf<String>()
            val fallbackIps = mutableListOf<String>()
            try {
                val interfaces = Collections.list(NetworkInterface.getNetworkInterfaces())
                for (ni in interfaces) {
                    if (!ni.isUp || ni.isLoopback) continue
                    val ifName = ni.name.lowercase()
                    // Skip cellular / mobile data / VPN tunnel interfaces so we only show Hotspot / Wi-Fi LAN IPs
                    if (ifName.startsWith("rmnet") ||
                        ifName.startsWith("ccmni") ||
                        ifName.startsWith("pdp") ||
                        ifName.startsWith("dummy") ||
                        ifName.startsWith("tun") ||
                        ifName.startsWith("ppp") ||
                        ifName.startsWith("clat")
                    ) {
                        continue
                    }
                    for (addr in Collections.list(ni.inetAddresses)) {
                        if (addr is Inet4Address && !addr.isLoopbackAddress) {
                            val ip = addr.hostAddress ?: continue
                            if (ip.startsWith("192.168.43.") ||
                                ip.startsWith("192.168.49.") ||
                                ip.startsWith("192.168.137.") ||
                                ifName.contains("ap") ||
                                ifName.contains("wlan") ||
                                ifName.contains("swlan") ||
                                ifName.contains("tether") ||
                                ifName.contains("rndis") ||
                                ip.startsWith("192.168.")
                            ) {
                                priorityIps.add(ip)
                            } else {
                                fallbackIps.add(ip)
                            }
                        }
                    }
                }
            } catch (_: Exception) {
            }
            val combined = (priorityIps + fallbackIps).distinct()
            return if (combined.isEmpty()) listOf("192.168.43.1") else combined
        }
    }

    init {
        loadState()
    }

    fun start() {
        if (running) return
        running = true
        executor.execute {
            try {
                val ss = ServerSocket()
                ss.reuseAddress = true
                ss.bind(InetSocketAddress("0.0.0.0", port))
                serverSocket = ss
                while (running) {
                    val socket = ss.accept()
                    executor.execute { handleConnection(socket) }
                }
            } catch (_: Exception) {
            }
        }
    }

    fun stop() {
        running = false
        try {
            serverSocket?.close()
        } catch (_: Exception) {
        }
        for (c in clients) {
            c.close()
        }
        clients.clear()
    }

    private fun generateDockerCode(): String {
        repeat(100) {
            val code = "${ADJECTIVES.random()}_${SURNAMES.random()}"
            if (!games.containsKey(code)) return code
        }
        return "${ADJECTIVES.random()}_${SURNAMES.random()}_${Random.nextInt(10, 99)}"
    }

    private fun loadState() {
        synchronized(stateLock) {
            if (!stateFile.exists()) return
            try {
                val root = JSONObject(stateFile.readText())
                val gamesObj = root.optJSONObject("games")
                if (gamesObj != null) {
                    for (key in gamesObj.keys()) {
                        games[key] = gamesObj.getJSONObject(key)
                    }
                }
                val prevObj = root.optJSONObject("previous_players_by_code")
                if (prevObj != null) {
                    for (key in prevObj.keys()) {
                        val arr = prevObj.getJSONArray(key)
                        val list = mutableListOf<String>()
                        for (i in 0 until arr.length()) list.add(arr.getString(i))
                        previousPlayersByCode[key] = list
                    }
                }
            } catch (_: Exception) {
            }
            syncLobbyWakeState()
        }
    }

    private fun saveState() {
        synchronized(stateLock) {
            syncLobbyWakeState()
            try {
                val root = JSONObject()
                val gamesObj = JSONObject()
                for ((k, v) in games) gamesObj.put(k, v)
                val prevObj = JSONObject()
                for ((k, v) in previousPlayersByCode) prevObj.put(k, JSONArray(v))
                root.put("games", gamesObj)
                root.put("previous_players_by_code", prevObj)
                stateFile.writeText(root.toString())
            } catch (_: Exception) {
            }
        }
    }

    private fun syncLobbyWakeState() {
        val anyLobby = games.values.any { it.optString("status", "LOBBY") == "LOBBY" }
        onLobbyWakeStateChanged(anyLobby)
    }

    fun getLatestActiveGameCode(): String? {
        synchronized(stateLock) {
            return games.values
                .sortedByDescending { it.optLong("createdAt", 0L) }
                .firstOrNull { it.optString("status", "LOBBY") != "ENDED" }
                ?.optString("gameCode")
                ?: games.keys.firstOrNull()
        }
    }

    private fun resolveGameCode(raw: String): String {
        val clean = raw.trim().lowercase()
        if (games.containsKey(clean)) return clean
        val norm = clean.replace(Regex("[-_]+"), "_")
        return games.keys.firstOrNull { it.lowercase().replace(Regex("[-_]+"), "_") == norm } ?: clean
    }

    private fun handleConnection(socket: Socket) {
        try {
            val rawIp = normalizeIp(socket.inetAddress?.hostAddress)
            val input = BufferedInputStream(socket.getInputStream())
            val output = BufferedOutputStream(socket.getOutputStream())

            val reqLine = readHttpLine(input) ?: run {
                socket.close()
                return
            }
            val parts = reqLine.split(" ")
            if (parts.size < 2) {
                socket.close()
                return
            }
            val path = parts[1]
            val headers = mutableMapOf<String, String>()
            while (true) {
                val line = readHttpLine(input) ?: break
                if (line.isEmpty()) break
                val idx = line.indexOf(':')
                if (idx > 0) {
                    headers[line.substring(0, idx).trim().lowercase()] = line.substring(idx + 1).trim()
                }
            }

            val clientIp = normalizeIp(headers["x-forwarded-for"]?.split(",")?.firstOrNull() ?: headers["x-real-ip"] ?: rawIp)

            if (headers["upgrade"]?.lowercase() == "websocket") {
                val wsKey = headers["sec-websocket-key"] ?: ""
                val acceptRaw = (wsKey + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").toByteArray(Charsets.UTF_8)
                val sha1 = MessageDigest.getInstance("SHA-1").digest(acceptRaw)
                val acceptKey = Base64.encodeToString(sha1, Base64.NO_WRAP)
                val resp = (
                    "HTTP/1.1 101 Switching Protocols\r\n" +
                        "Upgrade: websocket\r\n" +
                        "Connection: Upgrade\r\n" +
                        "Sec-WebSocket-Accept: $acceptKey\r\n\r\n"
                    ).toByteArray(Charsets.UTF_8)
                output.write(resp)
                output.flush()

                val wsClient = WsClient(socket, input, output, clientIp)
                clients.add(wsClient)
                try {
                    while (!wsClient.closed) {
                        val frame = wsClient.readFrame() ?: break
                        if (frame.first == 0x8) break
                        if (frame.first == 0x9) {
                            wsClient.sendFrame(frame.second, 0xA)
                        } else if (frame.first == 0x1) {
                            val msg = JSONObject(String(frame.second, Charsets.UTF_8))
                            handleWsMessage(wsClient, msg)
                        }
                    }
                } catch (_: Exception) {
                } finally {
                    wsClient.close()
                    clients.remove(wsClient)
                }
            } else {
                serveStaticAsset(output, path, clientIp)
                socket.close()
            }
        } catch (_: Exception) {
            try {
                socket.close()
            } catch (_: Exception) {
            }
        }
    }

    private fun readHttpLine(input: InputStream): String? {
        val sb = StringBuilder()
        while (true) {
            val b = input.read()
            if (b == -1) return if (sb.isEmpty()) null else sb.toString()
            if (b == '\r'.code) continue
            if (b == '\n'.code) break
            sb.append(b.toChar())
        }
        return sb.toString()
    }

    private fun serveStaticAsset(output: OutputStream, rawPath: String, clientIp: String) {
        val cleanPath = rawPath.substringBefore('?').let { if (it.isEmpty() || it == "/") "/index.html" else it }
        if (cleanPath == "/api/games") {
            val payload = synchronized(stateLock) {
                JSONObject().apply {
                    put("games", listPublicGames(clientIp))
                    put("previousPlayersByCode", prevPlayersJson())
                    put("clientIp", clientIp)
                }.toString().toByteArray(Charsets.UTF_8)
            }
            val header = (
                "HTTP/1.1 200 OK\r\n" +
                    "Content-Type: application/json; charset=utf-8\r\n" +
                    "Content-Length: ${payload.size}\r\n" +
                    "Connection: close\r\n\r\n"
                ).toByteArray(Charsets.UTF_8)
            output.write(header)
            output.write(payload)
            output.flush()
            return
        }

        val assetName = "web/" + cleanPath.trimStart('/')
        val bytes = try {
            context.assets.open(assetName).use { it.readBytes() }
        } catch (_: Exception) {
            context.assets.open("web/index.html").use { it.readBytes() }
        }

        val mime = when {
            cleanPath.endsWith(".html") -> "text/html; charset=utf-8"
            cleanPath.endsWith(".css") -> "text/css; charset=utf-8"
            cleanPath.endsWith(".js") -> "application/javascript; charset=utf-8"
            cleanPath.endsWith(".json") -> "application/json; charset=utf-8"
            cleanPath.endsWith(".svg") -> "image/svg+xml"
            else -> "application/octet-stream"
        }

        val header = (
            "HTTP/1.1 200 OK\r\n" +
                "Content-Type: $mime\r\n" +
                "Content-Length: ${bytes.size}\r\n" +
                "Cache-Control: no-cache\r\n" +
                "Connection: close\r\n\r\n"
            ).toByteArray(Charsets.UTF_8)
        output.write(header)
        output.write(bytes)
        output.flush()
    }

    private fun prevPlayersJson(): JSONObject {
        val obj = JSONObject()
        for ((k, v) in previousPlayersByCode) obj.put(k, JSONArray(v))
        return obj
    }

    private fun listPublicGames(clientIp: String): JSONArray {
        val normIp = normalizeIp(clientIp)
        val sorted = games.values.sortedByDescending { it.optLong("createdAt", 0L) }
        val arr = JSONArray()
        for (g in sorted) {
            val code = g.getString("gameCode")
            val players = g.optJSONArray("players") ?: JSONArray()
            var boundName: String? = g.optJSONObject("deviceIps")?.optString(normIp, "")?.takeIf { it.isNotEmpty() }
            if (boundName == null) {
                for (i in 0 until players.length()) {
                    val p = players.getJSONObject(i)
                    if (normalizeIp(p.optString("ip", "")) == normIp && p.optString("ip", "").isNotEmpty()) {
                        boundName = p.getString("name")
                        break
                    }
                }
            }
            arr.put(JSONObject().apply {
                put("gameCode", code)
                put("status", g.optString("status", "LOBBY"))
                put("allowJoin", g.optBoolean("allowJoin", true))
                put("playerCount", players.length())
                put("expectedTotal", g.optInt("expectedTotal", 0))
                put("allocationMode", g.optString("allocationMode", "counts"))
                put("createdAt", g.optLong("createdAt", 0L))
                put("roundNumber", g.optInt("roundNumber", 1))
                put("previousPlayers", JSONArray(previousPlayersByCode[code] ?: emptyList<String>()))
                put("myBoundPlayer", boundName ?: JSONObject.NULL)
            })
        }
        return arr
    }

    private fun getPublicGameView(gameCode: String, playerName: String?, clientIp: String): JSONObject? {
        val g = games[gameCode] ?: return null
        val status = g.optString("status", "LOBBY")
        val players = g.optJSONArray("players") ?: JSONArray()
        val normIp = normalizeIp(clientIp)
        var myPlayer: JSONObject? = null

        if (!playerName.isNullOrBlank()) {
            for (i in 0 until players.length()) {
                val p = players.getJSONObject(i)
                if (p.getString("name").equals(playerName.trim(), ignoreCase = true)) {
                    myPlayer = p
                    break
                }
            }
        } else {
            for (i in 0 until players.length()) {
                val p = players.getJSONObject(i)
                if (p.optString("ip", "").isNotEmpty() && normalizeIp(p.optString("ip")) == normIp) {
                    myPlayer = p
                    break
                }
            }
        }

        var myRole: Any = JSONObject.NULL
        var roleHiddenReason: Any = JSONObject.NULL
        if (myPlayer != null) {
            val r = myPlayer.optString("role", "")
            if (status == "ROLES_ASSIGNED" && r.isNotEmpty()) {
                myRole = r
            } else if (status == "STARTED" && r.isNotEmpty()) {
                myRole = r
                roleHiddenReason = "HOLD_TO_VIEW"
            } else if (status == "ENDED" && r.isNotEmpty()) {
                myRole = r
            }
        }

        val rules = g.optJSONObject("rules") ?: JSONObject()
        val pubPlayers = JSONArray()
        for (i in 0 until players.length()) {
            val p = players.getJSONObject(i)
            val alive = p.optBoolean("alive", true)
            val entry = JSONObject().apply {
                put("name", p.getString("name"))
                put("alive", alive)
                put("claimed", p.optBoolean("claimed", false))
                if ((!alive && rules.optBoolean("revealRoleOnDeath", false)) || status == "ENDED") {
                    put("revealedRole", p.optString("role", ""))
                }
            }
            pubPlayers.put(entry)
        }

        return JSONObject().apply {
            put("gameCode", gameCode)
            put("status", status)
            put("roundNumber", g.optInt("roundNumber", 1))
            put("phase", g.optString("phase", "Lobby"))
            put("allowJoin", g.optBoolean("allowJoin", true))
            put("allocationMode", g.optString("allocationMode", "counts"))
            put("expectedTotal", g.optInt("expectedTotal", 0))
            put("rules", rules)
            put("players", pubPlayers)
            put("announcement", g.optString("announcement", ""))
            put("myPlayer", if (myPlayer != null) {
                JSONObject().apply {
                    put("name", myPlayer.getString("name"))
                    put("ip", myPlayer.optString("ip", ""))
                    put("alive", myPlayer.optBoolean("alive", true))
                    put("role", myRole)
                    put("roleHiddenReason", roleHiddenReason)
                }
            } else JSONObject.NULL)
        }
    }

    private fun broadcastUpdate(gameCode: String) {
        for (c in clients) {
            if (c.closed) continue
            c.sendJson(JSONObject().apply {
                put("type", "GAMES_LIST")
                put("games", listPublicGames(c.clientIp))
                put("previousPlayersByCode", prevPlayersJson())
            })
            if (c.subscribedGame == gameCode) {
                val pub = getPublicGameView(gameCode, c.playerName, c.clientIp)
                if (pub != null) {
                    c.sendJson(JSONObject().apply {
                        put("type", "GAME_STATE")
                        put("game", pub)
                    })
                }
                val g = games[gameCode]
                if (g != null && c.godPasscode != null && g.optString("passcode") == c.godPasscode) {
                    c.sendJson(JSONObject().apply {
                        put("type", "GOD_STATE")
                        put("game", g)
                    })
                }
            }
        }
    }

    private fun computeRolesFromPercentages(total: Int, pcts: JSONObject): JSONObject {
        val mPct = max(0.0, pcts.optDouble("mafia", 25.0))
        val detPct = max(0.0, pcts.optDouble("detective", 15.0))
        val docPct = max(0.0, pcts.optDouble("doctor", 15.0))
        val vilPct = max(0.0, pcts.optDouble("villager", 45.0))
        val sum = (mPct + detPct + docPct + vilPct).let { if (it <= 0.0) 100.0 else it }

        var m = floor((mPct / sum) * total).toInt()
        val det = floor((detPct / sum) * total).toInt()
        val doc = floor((docPct / sum) * total).toInt()
        if (mPct > 0 && total >= 2 && m == 0) m = 1
        val vil = max(0, total - (m + det + doc))
        return JSONObject().apply {
            put("mafia", m)
            put("detective", det)
            put("doctor", doc)
            put("villager", vil)
        }
    }

    private fun handleWsMessage(ws: WsClient, msg: JSONObject) {
        val action = msg.optString("action", "")
        val clientIp = ws.clientIp

        synchronized(stateLock) {
            when (action) {
                "INIT" -> {
                    ws.sendJson(JSONObject().apply {
                        put("type", "INIT_DATA")
                        put("games", listPublicGames(clientIp))
                        put("previousPlayersByCode", prevPlayersJson())
                        put("serverInfo", JSONObject().apply {
                            put("ips", JSONArray(getHotspotIps()))
                            put("port", port)
                            put("clientIp", clientIp)
                        })
                        put("suggestedCode", generateDockerCode())
                    })
                }

                "GENERATE_CODE" -> {
                    ws.sendJson(JSONObject().apply {
                        put("type", "GENERATED_CODE")
                        put("gameCode", generateDockerCode())
                    })
                }

                "CREATE_GAME" -> {
                    val rawCode = msg.optString("gameCode", "").trim().lowercase()
                        .replace(Regex("[^a-z0-9_-]"), "_")
                        .ifEmpty { generateDockerCode() }
                    val passcode = msg.optString("passcode", "").trim()
                    if (!passcode.matches(Regex("^\\d{4,8}$"))) {
                        ws.sendError("Passcode must be 4 to 8 digits.")
                        return
                    }
                    val existing = games[rawCode]
                    if (existing != null && existing.optString("passcode") != passcode) {
                        ws.sendError("Game code '$rawCode' already exists with a different passcode.")
                        return
                    }

                    val namesArr = msg.optJSONArray("playerNames") ?: JSONArray()
                    val players = JSONArray()
                    val seen = mutableSetOf<String>()
                    val savedNames = mutableListOf<String>()
                    for (i in 0 until namesArr.length()) {
                        val n = namesArr.getString(i).trim()
                        if (n.isNotEmpty() && seen.add(n.lowercase())) {
                            savedNames.add(n)
                            players.put(JSONObject().apply {
                                put("name", n)
                                put("role", JSONObject.NULL)
                                put("alive", true)
                                put("claimed", false)
                                put("token", "")
                                put("ip", "")
                            })
                        }
                    }
                    if (savedNames.isNotEmpty()) {
                        previousPlayersByCode[rawCode] = savedNames
                    }

                    val roundNum = if (existing != null) existing.optInt("roundNumber", 1) + 1 else 1
                    val rc = msg.optJSONObject("roleCounts") ?: JSONObject()
                    val expected = rc.optInt("mafia", 1) + rc.optInt("detective", 1) + rc.optInt("doctor", 1) + rc.optInt("villager", 3)

                    val gameObj = JSONObject().apply {
                        put("gameCode", rawCode)
                        put("passcode", passcode)
                        put("status", "LOBBY")
                        put("roundNumber", roundNum)
                        put("phase", "Lobby")
                        put("allowJoin", msg.optBoolean("allowJoin", true))
                        put("allocationMode", msg.optString("allocationMode", "counts"))
                        put("roleCounts", rc)
                        put("rolePercentages", msg.optJSONObject("rolePercentages") ?: JSONObject())
                        put("expectedTotal", expected)
                        put("rules", msg.optJSONObject("rules") ?: JSONObject())
                        put("players", players)
                        put("deviceIps", JSONObject())
                        put("announcement", "Waiting for Game-God to confirm players and randomize roles.")
                        put("history", JSONArray().put("Game '$rawCode' (Round $roundNum) created by Game-God."))
                        put("createdAt", System.currentTimeMillis())
                    }
                    games[rawCode] = gameObj
                    saveState()

                    ws.subscribedGame = rawCode
                    ws.godPasscode = passcode
                    ws.sendJson(JSONObject().apply {
                        put("type", "GAME_CREATED")
                        put("game", gameObj)
                    })
                    broadcastUpdate(rawCode)
                }

                "GOD_AUTH" -> {
                    val code = resolveGameCode(msg.optString("gameCode", ""))
                    val passcode = msg.optString("passcode", "").trim()
                    val g = games[code]
                    if (g == null || g.optString("passcode") != passcode) {
                        ws.sendError("Invalid game code or Game-God passcode.")
                        return
                    }
                    ws.subscribedGame = code
                    ws.godPasscode = passcode
                    ws.sendJson(JSONObject().apply {
                        put("type", "GOD_STATE")
                        put("game", g)
                    })
                }

                "JOIN_PLAYER" -> {
                    val code = resolveGameCode(msg.optString("gameCode", ""))
                    val playerName = msg.optString("playerName", "").trim()
                    val token = msg.optString("playerToken", "").trim()
                    val g = games[code]
                    if (g == null) {
                        ws.sendError("Game code '$code' not found.")
                        return
                    }
                    if (playerName.isEmpty()) {
                        ws.sendError("Please enter your player name.")
                        return
                    }

                    val players = g.optJSONArray("players") ?: JSONArray()
                    val deviceIps = g.optJSONObject("deviceIps") ?: JSONObject().also { g.put("deviceIps", it) }

                    // Enforce 1 player per IP address for this game code
                    var boundPlayer: JSONObject? = null
                    for (i in 0 until players.length()) {
                        val p = players.getJSONObject(i)
                        val pIp = p.optString("ip", "")
                        if ((pIp.isNotEmpty() && normalizeIp(pIp) == clientIp) ||
                            (token.isNotEmpty() && p.optString("token", "") == token)
                        ) {
                            boundPlayer = p
                            break
                        }
                    }

                    if (boundPlayer != null && !boundPlayer.getString("name").equals(playerName, ignoreCase = true)) {
                        ws.sendError(
                            "This device (IP: $clientIp) has already joined game '$code' as '${boundPlayer.getString("name")}'. Only one player per IP address is allowed in a game."
                        )
                        return
                    }

                    var existingPlayer: JSONObject? = null
                    for (i in 0 until players.length()) {
                        val p = players.getJSONObject(i)
                        if (p.getString("name").equals(playerName, ignoreCase = true)) {
                            existingPlayer = p
                            break
                        }
                    }

                    if (existingPlayer != null) {
                        if (existingPlayer.optBoolean("claimed", false)) {
                            val exIp = existingPlayer.optString("ip", "")
                            val sameIp = exIp.isNotEmpty() && normalizeIp(exIp) == clientIp
                            val sameToken = exIp.isEmpty() && existingPlayer.optString("token", "") == token
                            if (!sameIp && !sameToken) {
                                ws.sendError("Player name '$playerName' is already taken by another device in game '$code'!")
                                return
                            }
                        }
                        existingPlayer.put("claimed", true)
                        existingPlayer.put("ip", clientIp)
                        existingPlayer.put("token", token)
                        deviceIps.put(clientIp, existingPlayer.getString("name"))
                    } else {
                        if (!g.optBoolean("allowJoin", true)) {
                            ws.sendError("This game is locked to new players.")
                            return
                        }
                        players.put(JSONObject().apply {
                            put("name", playerName)
                            put("role", JSONObject.NULL)
                            put("alive", true)
                            put("claimed", true)
                            put("ip", clientIp)
                            put("token", token)
                        })
                        deviceIps.put(clientIp, playerName)
                        g.optJSONArray("history")?.put("Player '$playerName' joined from IP $clientIp.")
                        val allNames = mutableListOf<String>()
                        for (i in 0 until players.length()) allNames.add(players.getJSONObject(i).getString("name"))
                        previousPlayersByCode[code] = allNames
                    }

                    ws.subscribedGame = code
                    ws.playerName = existingPlayer?.getString("name") ?: playerName
                    ws.playerToken = token
                    saveState()

                    val pub = getPublicGameView(code, ws.playerName, clientIp)
                    ws.sendJson(JSONObject().apply {
                        put("type", "PLAYER_JOINED")
                        put("game", pub)
                    })
                    broadcastUpdate(code)
                }

                "GOD_UPDATE_SETUP" -> {
                    val code = msg.optString("gameCode", "").trim().lowercase()
                    val passcode = msg.optString("passcode", "").trim()
                    val g = games[code] ?: return
                    if (g.optString("passcode") != passcode) return

                    if (msg.has("allowJoin")) g.put("allowJoin", msg.getBoolean("allowJoin"))
                    if (msg.has("allocationMode")) g.put("allocationMode", msg.getString("allocationMode"))
                    if (msg.has("roleCounts")) g.put("roleCounts", msg.getJSONObject("roleCounts"))
                    if (msg.has("rolePercentages")) g.put("rolePercentages", msg.getJSONObject("rolePercentages"))
                    if (msg.has("rules")) g.put("rules", msg.getJSONObject("rules"))

                    val players = g.optJSONArray("players") ?: JSONArray()
                    if (msg.has("addPlayerName")) {
                        val newName = msg.getString("addPlayerName").trim()
                        if (newName.isNotEmpty()) {
                            players.put(JSONObject().apply {
                                put("name", newName)
                                put("role", JSONObject.NULL)
                                put("alive", true)
                                put("claimed", false)
                                put("ip", "")
                                put("token", "")
                            })
                        }
                    }
                    if (msg.has("removePlayerName")) {
                        val rem = msg.getString("removePlayerName").trim().lowercase()
                        val updated = JSONArray()
                        val updatedIps = JSONObject()
                        for (i in 0 until players.length()) {
                            val p = players.getJSONObject(i)
                            if (p.getString("name").lowercase() != rem) {
                                updated.put(p)
                                val pIp = p.optString("ip", "")
                                if (pIp.isNotEmpty()) updatedIps.put(normalizeIp(pIp), p.getString("name"))
                            }
                        }
                        g.put("players", updated)
                        g.put("deviceIps", updatedIps)
                    }
                    saveState()
                    broadcastUpdate(code)
                }

                "BEGIN_RANDOMIZATION" -> {
                    val code = msg.optString("gameCode", "").trim().lowercase()
                    val passcode = msg.optString("passcode", "").trim()
                    val g = games[code] ?: return
                    if (g.optString("passcode") != passcode) return

                    val players = g.optJSONArray("players") ?: JSONArray()
                    val total = players.length()
                    if (total == 0) {
                        ws.sendError("Add at least 1 player before randomizing roles.")
                        return
                    }

                    val counts = if (g.optString("allocationMode") == "percentages") {
                        computeRolesFromPercentages(total, g.optJSONObject("rolePercentages") ?: JSONObject())
                    } else {
                        val rc = g.optJSONObject("roleCounts") ?: JSONObject()
                        val special = rc.optInt("mafia", 1) + rc.optInt("detective", 0) + rc.optInt("doctor", 0)
                        if (special > total) {
                            ws.sendError("Special roles ($special) exceed total players ($total).")
                            return
                        }
                        rc.put("villager", total - special)
                        rc
                    }
                    g.put("roleCounts", counts)

                    val pool = mutableListOf<String>()
                    repeat(counts.optInt("mafia", 0)) { pool.add("Mafia") }
                    repeat(counts.optInt("detective", 0)) { pool.add("Detective") }
                    repeat(counts.optInt("doctor", 0)) { pool.add("Doctor") }
                    repeat(counts.optInt("villager", 0)) { pool.add("Villager") }
                    pool.shuffle()

                    for (i in 0 until total) {
                        val p = players.getJSONObject(i)
                        p.put("role", pool.getOrElse(i) { "Villager" })
                        p.put("alive", true)
                    }

                    g.put("status", "ROLES_ASSIGNED")
                    g.put("phase", "Role Reveal (Pre-Game)")
                    g.put("announcement", "Roles have been assigned! Players can view/refresh their secret role now before the game starts.")
                    g.optJSONArray("history")?.put("Roles randomized for $total players.")
                    saveState()
                    broadcastUpdate(code)
                }

                "START_GAME" -> {
                    val code = msg.optString("gameCode", "").trim().lowercase()
                    val passcode = msg.optString("passcode", "").trim()
                    val g = games[code] ?: return
                    if (g.optString("passcode") != passcode) return

                    g.put("status", "STARTED")
                    g.put("phase", "Night 1")
                    g.put("allowJoin", false)
                    g.put("announcement", "Game has started! Roles are now concealed — click and hold on your screen to peek at your role.")
                    g.optJSONArray("history")?.put("Game started (Night 1). Roles concealed (click & hold to view).")
                    saveState()
                    broadcastUpdate(code)
                }

                "GOD_GAME_ACTION" -> {
                    val code = msg.optString("gameCode", "").trim().lowercase()
                    val passcode = msg.optString("passcode", "").trim()
                    val g = games[code] ?: return
                    if (g.optString("passcode") != passcode) return
                    val sub = msg.optString("subAction", "")
                    val players = g.optJSONArray("players") ?: JSONArray()

                    when (sub) {
                        "TOGGLE_ALIVE" -> {
                            val target = msg.optString("playerName", "")
                            for (i in 0 until players.length()) {
                                val p = players.getJSONObject(i)
                                if (p.getString("name").equals(target, ignoreCase = true)) {
                                    p.put("alive", !p.optBoolean("alive", true))
                                    break
                                }
                            }
                        }
                        "RESOLVE_NIGHT" -> {
                            val killT = msg.optString("killTarget", "").trim()
                            val saveT = msg.optString("saveTarget", "").trim()
                            if (killT.isNotEmpty()) {
                                for (i in 0 until players.length()) {
                                    val p = players.getJSONObject(i)
                                    if (p.getString("name").equals(killT, ignoreCase = true)) {
                                        if (saveT.isNotEmpty() && saveT.equals(killT, ignoreCase = true)) {
                                            g.put("announcement", "Dawn breaks! Nobody died last night.")
                                        } else {
                                            p.put("alive", false)
                                            g.put("announcement", "Dawn breaks! ${p.getString("name")} was eliminated during the night.")
                                        }
                                        break
                                    }
                                }
                            }
                            g.put("phase", "Day Phase")
                        }
                        "UNLOCK_ROLES" -> {
                            g.put("status", "ROLES_ASSIGNED")
                            g.put("phase", "Role Reveal (Pre-Game)")
                        }
                        "END_GAME" -> {
                            val winner = msg.optString("winner", "Game Over")
                            g.put("status", "ENDED")
                            g.put("phase", "Ended ($winner)")
                            g.put("announcement", "Game Over! $winner")
                        }
                        "RESET_TO_LOBBY" -> {
                            for (i in 0 until players.length()) {
                                val p = players.getJSONObject(i)
                                p.put("role", JSONObject.NULL)
                                p.put("alive", true)
                            }
                            val nextRound = g.optInt("roundNumber", 1) + 1
                            g.put("roundNumber", nextRound)
                            g.put("status", "LOBBY")
                            g.put("phase", "Lobby")
                            g.put("announcement", "Round $nextRound Lobby open!")
                        }
                    }
                    saveState()
                    broadcastUpdate(code)
                }
            }
        }
    }

    private class WsClient(
        private val socket: Socket,
        private val input: InputStream,
        private val output: OutputStream,
        val clientIp: String
    ) {
        @Volatile
        var closed = false
        var subscribedGame: String? = null
        var playerName: String? = null
        var playerToken: String? = null
        var godPasscode: String? = null

        @Synchronized
        fun sendJson(obj: JSONObject) {
            if (closed) return
            try {
                sendFrame(obj.toString().toByteArray(Charsets.UTF_8), 0x1)
            } catch (_: Exception) {
                close()
            }
        }

        fun sendError(message: String) {
            sendJson(JSONObject().apply {
                put("type", "ERROR")
                put("message", message)
            })
        }

        @Synchronized
        fun sendFrame(payload: ByteArray, opcode: Int) {
            val len = payload.size
            output.write(0x80 or (opcode and 0x0F))
            when {
                len < 126 -> output.write(len)
                len < 65536 -> {
                    output.write(126)
                    output.write((len shr 8) and 0xFF)
                    output.write(len and 0xFF)
                }
                else -> {
                    output.write(127)
                    val buf = ByteBuffer.allocate(8).putLong(len.toLong()).array()
                    output.write(buf)
                }
            }
            output.write(payload)
            output.flush()
        }

        fun readFrame(): Pair<Int, ByteArray>? {
            val b1 = input.read()
            val b2 = input.read()
            if (b1 == -1 || b2 == -1) return null
            val opcode = b1 and 0x0F
            val masked = (b2 and 0x80) != 0
            var length = (b2 and 0x7F).toLong()
            if (length == 126L) {
                val ext = ByteArray(2)
                readExact(ext)
                length = (((ext[0].toInt() and 0xFF) shl 8) or (ext[1].toInt() and 0xFF)).toLong()
            } else if (length == 127L) {
                val ext = ByteArray(8)
                readExact(ext)
                length = ByteBuffer.wrap(ext).long
            }
            val mask = if (masked) ByteArray(4).also { readExact(it) } else null
            val payload = ByteArray(length.toInt())
            if (payload.isNotEmpty()) readExact(payload)
            if (mask != null) {
                for (i in payload.indices) {
                    payload[i] = (payload[i].toInt() xor mask[i % 4].toInt()).toByte()
                }
            }
            return Pair(opcode, payload)
        }

        private fun readExact(buf: ByteArray) {
            var offset = 0
            while (offset < buf.size) {
                val n = input.read(buf, offset, buf.size - offset)
                if (n <= 0) throw java.io.EOFException()
                offset += n
            }
        }

        fun close() {
            closed = true
            try {
                socket.close()
            } catch (_: Exception) {
            }
        }
    }
}
