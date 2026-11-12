import Foundation
import Darwin
import CryptoKit

/**
 * Embedded Zero-Dependency HTTP + RFC 6455 WebSocket Server for iOS.
 * Runs directly on the host iPhone (0.0.0.0:8080) over Personal Hotspot / Wi-Fi with no internet required.
 */
final class MafiaHotspotServer {
    let port: UInt16
    private var serverFd: Int32 = -1
    private var running = false
    private let stateQueue = DispatchQueue(label: "com.mafiahub.server.state")
    private let onLobbyWakeStateChanged: (Bool) -> Void

    private var games: [String: [String: Any]] = [:]
    private var previousPlayersByCode: [String: [String]] = [:]
    private var clients: [WsClient] = []

    private static let adjectives = [
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
    ]

    private static let surnames = [
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
    ]

    init(port: UInt16 = 8080, onLobbyWakeStateChanged: @escaping (Bool) -> Void = { _ in }) {
        self.port = port
        self.onLobbyWakeStateChanged = onLobbyWakeStateChanged
        loadState()
    }

    private var stateFileURL: URL {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        return dir.appendingPathComponent("games_state.json")
    }

    static func normalizeIp(_ raw: String?) -> String {
        let clean = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if clean.isEmpty { return "127.0.0.1" }
        if clean.hasPrefix("::ffff:") { return String(clean.dropFirst(7)) }
        if clean == "::1" { return "127.0.0.1" }
        return clean
    }

    static func getHotspotIps() -> [String] {
        var ips: [String] = []
        var ifaddr: UnsafeMutablePointer<ifaddrs>?
        if getifaddrs(&ifaddr) == 0 {
            var ptr = ifaddr
            while ptr != nil {
                defer { ptr = ptr?.pointee.ifa_next }
                guard let interface = ptr?.pointee,
                      let addr = interface.ifa_addr else { continue }
                let addrFamily = addr.pointee.sa_family
                if addrFamily == UInt8(AF_INET) {
                    let name = String(cString: interface.ifa_name)
                    if name == "lo0" { continue }
                    var hostname = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                    if getnameinfo(addr, socklen_t(addr.pointee.sa_len), &hostname, socklen_t(hostname.count), nil, 0, NI_NUMERICHOST) == 0 {
                        let ip = String(cString: hostname)
                        if ip.hasPrefix("172.20.10.") || name.hasPrefix("bridge") || name.hasPrefix("en") {
                            ips.insert(ip, at: 0)
                        } else {
                            ips.append(ip)
                        }
                    }
                }
            }
            freeifaddrs(ifaddr)
        }
        return ips.isEmpty ? ["127.0.0.1"] : Array(NSOrderedSet(array: ips)) as? [String] ?? ["127.0.0.1"]
    }

    func start() {
        if running { return }
        running = true
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.acceptLoop()
        }
    }

    func stop() {
        running = false
        if serverFd >= 0 {
            Darwin.close(serverFd)
            serverFd = -1
        }
    }

    private func acceptLoop() {
        let fd = Darwin.socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { return }
        serverFd = fd

        var yes: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size))

        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = port.bigEndian
        addr.sin_addr.s_addr = INADDR_ANY.bigEndian

        let bindRes = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bindRes == 0, Darwin.listen(fd, 64) == 0 else {
            Darwin.close(fd)
            return
        }

        while running {
            var clientAddr = sockaddr_in()
            var len = socklen_t(MemoryLayout<sockaddr_in>.size)
            let clientFd = withUnsafeMutablePointer(to: &clientAddr) {
                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    Darwin.accept(fd, $0, &len)
                }
            }
            if clientFd < 0 { continue }
            var ipBuf = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
            inet_ntop(AF_INET, &clientAddr.sin_addr, &ipBuf, socklen_t(INET_ADDRSTRLEN))
            let peerIp = Self.normalizeIp(String(cString: ipBuf))

            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                self?.handleClient(fd: clientFd, peerIp: peerIp)
            }
        }
    }

    private func generateDockerCode() -> String {
        for _ in 0..<100 {
            let code = "\(Self.adjectives.randomElement()!)_\(Self.surnames.randomElement()!)"
            if games[code] == nil { return code }
        }
        return "\(Self.adjectives.randomElement()!)_\(Self.surnames.randomElement()!)_\(Int.random(in: 10...99))"
    }

    private func loadState() {
        guard let data = try? Data(contentsOf: stateFileURL),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        if let g = root["games"] as? [String: [String: Any]] {
            games = g
        }
        if let p = root["previous_players_by_code"] as? [String: [String]] {
            previousPlayersByCode = p
        }
        syncWakeLock()
    }

    private func saveState() {
        syncWakeLock()
        let root: [String: Any] = [
            "games": games,
            "previous_players_by_code": previousPlayersByCode
        ]
        if let data = try? JSONSerialization.data(withJSONObject: root, options: [.prettyPrinted]) {
            try? data.write(to: stateFileURL)
        }
    }

    private func syncWakeLock() {
        let anyLobby = games.values.contains { ($0["status"] as? String ?? "LOBBY") == "LOBBY" }
        DispatchQueue.main.async { [weak self] in
            self?.onLobbyWakeStateChanged(anyLobby)
        }
    }

    private func handleClient(fd: Int32, peerIp: String) {
        var one: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &one, socklen_t(MemoryLayout<Int32>.size))

        guard let reqLine = readLine(fd: fd) else {
            Darwin.close(fd)
            return
        }
        let parts = reqLine.split(separator: " ")
        guard parts.count >= 2 else {
            Darwin.close(fd)
            return
        }
        let path = String(parts[1])
        var headers: [String: String] = [:]
        while let line = readLine(fd: fd), !line.isEmpty {
            if let idx = line.firstIndex(of: ":") {
                let k = line[..<idx].trimmingCharacters(in: .whitespaces).lowercased()
                let v = line[line.index(after: idx)...].trimmingCharacters(in: .whitespaces)
                headers[k] = v
            }
        }

        let clientIp = Self.normalizeIp(headers["x-forwarded-for"]?.split(separator: ",").first.map(String.init) ?? headers["x-real-ip"] ?? peerIp)

        if headers["upgrade"]?.lowercased() == "websocket" {
            let key = headers["sec-websocket-key"] ?? ""
            let magic = key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
            let digest = Insecure.SHA1.hash(data: Data(magic.utf8))
            let acceptKey = Data(digest).base64EncodedString()
            let handshake = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: \(acceptKey)\r\n\r\n"
            _ = writeAll(fd: fd, data: Data(handshake.utf8))

            let ws = WsClient(fd: fd, clientIp: clientIp)
            stateQueue.sync { clients.append(ws) }
            defer {
                ws.close()
                stateQueue.sync { clients.removeAll { $0 === ws } }
            }

            while !ws.closed {
                guard let (opcode, payload) = ws.readFrame() else { break }
                if opcode == 0x8 { break }
                if opcode == 0x9 {
                    ws.sendFrame(payload: payload, opcode: 0xA)
                } else if opcode == 0x1,
                          let msg = try? JSONSerialization.jsonObject(with: payload) as? [String: Any] {
                    stateQueue.sync {
                        self.handleWsMessage(ws: ws, msg: msg)
                    }
                }
            }
        } else {
            serveStatic(fd: fd, rawPath: path, clientIp: clientIp)
            Darwin.close(fd)
        }
    }

    private func readLine(fd: Int32) -> String? {
        var bytes: [UInt8] = []
        var b: UInt8 = 0
        while true {
            let n = Darwin.read(fd, &b, 1)
            if n <= 0 { return bytes.isEmpty ? nil : String(bytes: bytes, encoding: .utf8) }
            if b == 13 { continue }
            if b == 10 { break }
            bytes.append(b)
        }
        return String(bytes: bytes, encoding: .utf8)
    }

    private func writeAll(fd: Int32, data: Data) -> Bool {
        return data.withUnsafeBytes { rawBuf in
            guard let base = rawBuf.baseAddress else { return false }
            var sent = 0
            while sent < data.count {
                let n = Darwin.write(fd, base.advanced(by: sent), data.count - sent)
                if n <= 0 { return false }
                sent += n
            }
            return true
        }
    }

    private func serveStatic(fd: Int32, rawPath: String, clientIp: String) {
        let clean = rawPath.components(separatedBy: "?").first ?? "/"
        let target = (clean.isEmpty || clean == "/") ? "/index.html" : clean

        if target == "/api/games" {
            let body: Data = stateQueue.sync {
                let dict: [String: Any] = [
                    "games": listPublicGames(clientIp: clientIp),
                    "previousPlayersByCode": previousPlayersByCode,
                    "clientIp": clientIp
                ]
                return (try? JSONSerialization.data(withJSONObject: dict)) ?? Data("{}".utf8)
            }
            let hdr = "HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n"
            _ = writeAll(fd: fd, data: Data(hdr.utf8))
            _ = writeAll(fd: fd, data: body)
            return
        }

        let fileName = String(target.dropFirst())
        let url = Bundle.main.url(forResource: fileName, withExtension: nil, subdirectory: "WebAssets")
            ?? Bundle.main.url(forResource: "index.html", withExtension: nil, subdirectory: "WebAssets")
        let content = (url != nil ? try? Data(contentsOf: url!) : nil) ?? Data("Mafia Hub".utf8)

        let mime: String
        if target.hasSuffix(".html") { mime = "text/html; charset=utf-8" }
        else if target.hasSuffix(".css") { mime = "text/css; charset=utf-8" }
        else if target.hasSuffix(".js") { mime = "application/javascript; charset=utf-8" }
        else if target.hasSuffix(".json") { mime = "application/json; charset=utf-8" }
        else if target.hasSuffix(".svg") { mime = "image/svg+xml" }
        else { mime = "application/octet-stream" }

        let hdr = "HTTP/1.1 200 OK\r\nContent-Type: \(mime)\r\nContent-Length: \(content.count)\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n"
        _ = writeAll(fd: fd, data: Data(hdr.utf8))
        _ = writeAll(fd: fd, data: content)
    }

    private func listPublicGames(clientIp: String) -> [[String: Any]] {
        let normIp = Self.normalizeIp(clientIp)
        let sorted = games.values.sorted { ($0["createdAt"] as? Int64 ?? 0) > ($1["createdAt"] as? Int64 ?? 0) }
        return sorted.map { g in
            let code = g["gameCode"] as? String ?? ""
            let players = g["players"] as? [[String: Any]] ?? []
            let deviceIps = g["deviceIps"] as? [String: String] ?? [:]
            var bound = deviceIps[normIp]
            if bound == nil {
                bound = players.first { Self.normalizeIp($0["ip"] as? String) == normIp && !(($0["ip"] as? String) ?? "").isEmpty }?["name"] as? String
            }
            return [
                "gameCode": code,
                "status": g["status"] as? String ?? "LOBBY",
                "allowJoin": g["allowJoin"] as? Bool ?? true,
                "playerCount": players.count,
                "expectedTotal": g["expectedTotal"] as? Int ?? 0,
                "allocationMode": g["allocationMode"] as? String ?? "counts",
                "createdAt": g["createdAt"] as? Int64 ?? 0,
                "roundNumber": g["roundNumber"] as? Int ?? 1,
                "previousPlayers": previousPlayersByCode[code] ?? [],
                "myBoundPlayer": bound as Any
            ]
        }
    }

    private func getPublicGameView(gameCode: String, playerName: String?, clientIp: String) -> [String: Any]? {
        guard let g = games[gameCode] else { return nil }
        let status = g["status"] as? String ?? "LOBBY"
        let players = g["players"] as? [[String: Any]] ?? []
        let normIp = Self.normalizeIp(clientIp)

        var myPlayer: [String: Any]?
        if let name = playerName, !name.isEmpty {
            myPlayer = players.first { ($0["name"] as? String ?? "").lowercased() == name.lowercased() }
        } else {
            myPlayer = players.first { Self.normalizeIp($0["ip"] as? String) == normIp && !(($0["ip"] as? String) ?? "").isEmpty }
        }

        var myRole: Any = NSNull()
        var roleHiddenReason: Any = NSNull()
        if let mp = myPlayer, let r = mp["role"] as? String, !r.isEmpty {
            if status == "ROLES_ASSIGNED" {
                myRole = r
            } else if status == "STARTED" {
                myRole = r
                roleHiddenReason = "HOLD_TO_VIEW"
            } else if status == "ENDED" {
                myRole = r
            }
        }

        let rules = g["rules"] as? [String: Any] ?? [:]
        let revealDeath = rules["revealRoleOnDeath"] as? Bool ?? false
        let pubPlayers: [[String: Any]] = players.map { p in
            let alive = p["alive"] as? Bool ?? true
            var item: [String: Any] = [
                "name": p["name"] as? String ?? "",
                "alive": alive,
                "claimed": p["claimed"] as? Bool ?? false
            ]
            if (!alive && revealDeath) || status == "ENDED" {
                item["revealedRole"] = p["role"] as? String ?? ""
            }
            return item
        }

        let myPlayerDict: Any = myPlayer != nil ? [
            "name": myPlayer!["name"] as? String ?? "",
            "ip": myPlayer!["ip"] as? String ?? "",
            "alive": myPlayer!["alive"] as? Bool ?? true,
            "role": myRole,
            "roleHiddenReason": roleHiddenReason
        ] : NSNull()

        return [
            "gameCode": gameCode,
            "status": status,
            "roundNumber": g["roundNumber"] as? Int ?? 1,
            "phase": g["phase"] as? String ?? "Lobby",
            "allowJoin": g["allowJoin"] as? Bool ?? true,
            "allocationMode": g["allocationMode"] as? String ?? "counts",
            "expectedTotal": g["expectedTotal"] as? Int ?? 0,
            "rules": rules,
            "players": pubPlayers,
            "announcement": g["announcement"] as? String ?? "",
            "myPlayer": myPlayerDict
        ]
    }

    private func broadcastUpdate(gameCode: String) {
        for c in clients where !c.closed {
            c.sendJson([
                "type": "GAMES_LIST",
                "games": listPublicGames(clientIp: c.clientIp),
                "previousPlayersByCode": previousPlayersByCode
            ])
            if c.subscribedGame == gameCode {
                if let pub = getPublicGameView(gameCode: gameCode, playerName: c.playerName, clientIp: c.clientIp) {
                    c.sendJson(["type": "GAME_STATE", "game": pub])
                }
                if let g = games[gameCode], let pass = c.godPasscode, (g["passcode"] as? String) == pass {
                    c.sendJson(["type": "GOD_STATE", "game": g])
                }
            }
        }
    }

    private func handleWsMessage(ws: WsClient, msg: [String: Any]) {
        let action = msg["action"] as? String ?? ""
        let clientIp = ws.clientIp

        switch action {
        case "INIT":
            ws.sendJson([
                "type": "INIT_DATA",
                "games": listPublicGames(clientIp: clientIp),
                "previousPlayersByCode": previousPlayersByCode,
                "serverInfo": [
                    "ips": Self.getHotspotIps(),
                    "port": Int(port),
                    "clientIp": clientIp
                ],
                "suggestedCode": generateDockerCode()
            ])

        case "GENERATE_CODE":
            ws.sendJson([
                "type": "GENERATED_CODE",
                "gameCode": generateDockerCode()
            ])

        case "CREATE_GAME":
            let raw = (msg["gameCode"] as? String ?? "").trimmingCharacters(in: .whitespaces).lowercased()
            let code = raw.isEmpty ? generateDockerCode() : raw
            let passcode = (msg["passcode"] as? String ?? "").trimmingCharacters(in: .whitespaces)
            if passcode.range(of: "^\\d{4,8}$", options: .regularExpression) == nil {
                ws.sendError("Passcode must be 4 to 8 digits.")
                return
            }
            if let existing = games[code], (existing["passcode"] as? String) != passcode {
                ws.sendError("Game code '\(code)' already exists with a different passcode.")
                return
            }

            let rawNames = msg["playerNames"] as? [String] ?? []
            var seen = Set<String>()
            var players: [[String: Any]] = []
            for n in rawNames {
                let clean = n.trimmingCharacters(in: .whitespaces)
                if !clean.isEmpty && seen.insert(clean.lowercased()).inserted {
                    players.append([
                        "name": clean,
                        "role": NSNull(),
                        "alive": true,
                        "claimed": false,
                        "ip": "",
                        "token": ""
                    ])
                }
            }
            if !players.isEmpty {
                previousPlayersByCode[code] = players.compactMap { $0["name"] as? String }
            }

            let roundNum = (games[code]?["roundNumber"] as? Int ?? 0) + 1
            let gObj: [String: Any] = [
                "gameCode": code,
                "passcode": passcode,
                "status": "LOBBY",
                "roundNumber": roundNum,
                "phase": "Lobby",
                "allowJoin": msg["allowJoin"] as? Bool ?? true,
                "allocationMode": msg["allocationMode"] as? String ?? "counts",
                "roleCounts": msg["roleCounts"] as? [String: Int] ?? ["mafia": 1, "detective": 1, "doctor": 1, "villager": 3],
                "rolePercentages": msg["rolePercentages"] as? [String: Double] ?? ["mafia": 25, "detective": 15, "doctor": 15, "villager": 45],
                "expectedTotal": players.count,
                "rules": msg["rules"] as? [String: Any] ?? [:],
                "players": players,
                "deviceIps": [String: String](),
                "announcement": "Waiting for Game-God to confirm players and randomize roles.",
                "history": ["Game '\(code)' (Round \(roundNum)) created by Game-God."],
                "createdAt": Int64(Date().timeIntervalSince1970 * 1000)
            ]
            games[code] = gObj
            saveState()
            ws.subscribedGame = code
            ws.godPasscode = passcode
            ws.sendJson(["type": "GAME_CREATED", "game": gObj])
            broadcastUpdate(gameCode: code)

        case "GOD_AUTH":
            let code = (msg["gameCode"] as? String ?? "").trimmingCharacters(in: .whitespaces).lowercased()
            let passcode = (msg["passcode"] as? String ?? "").trimmingCharacters(in: .whitespaces)
            guard let g = games[code], (g["passcode"] as? String) == passcode else {
                ws.sendError("Invalid game code or Game-God passcode.")
                return
            }
            ws.subscribedGame = code
            ws.godPasscode = passcode
            ws.sendJson(["type": "GOD_STATE", "game": g])

        case "JOIN_PLAYER":
            let code = (msg["gameCode"] as? String ?? "").trimmingCharacters(in: .whitespaces).lowercased()
            let playerName = (msg["playerName"] as? String ?? "").trimmingCharacters(in: .whitespaces)
            let token = (msg["playerToken"] as? String ?? "").trimmingCharacters(in: .whitespaces)
            guard var g = games[code] else {
                ws.sendError("Game code '\(code)' not found.")
                return
            }
            var players = g["players"] as? [[String: Any]] ?? []
            var deviceIps = g["deviceIps"] as? [String: String] ?? [:]

            // Enforce 1 player per IP address for this game code
            if let bound = players.first(where: {
                let pIp = $0["ip"] as? String ?? ""
                let pTok = $0["token"] as? String ?? ""
                return (!pIp.isEmpty && Self.normalizeIp(pIp) == clientIp) || (!token.isEmpty && pTok == token)
            }) {
                let boundName = bound["name"] as? String ?? ""
                if boundName.lowercased() != playerName.lowercased() {
                    ws.sendError("This device (IP: \(clientIp)) has already joined game '\(code)' as '\(boundName)'. Only one player per IP address is allowed in a game.")
                    return
                }
            }

            if let idx = players.firstIndex(where: { ($0["name"] as? String ?? "").lowercased() == playerName.lowercased() }) {
                var p = players[idx]
                let claimed = p["claimed"] as? Bool ?? false
                let exIp = p["ip"] as? String ?? ""
                let exTok = p["token"] as? String ?? ""
                if claimed && ((!exIp.isEmpty && Self.normalizeIp(exIp) != clientIp) || (exIp.isEmpty && exTok != token)) {
                    ws.sendError("Player name '\(playerName)' is already taken by another device in game '\(code)'!")
                    return
                }
                p["claimed"] = true
                p["ip"] = clientIp
                p["token"] = token
                players[idx] = p
                deviceIps[clientIp] = p["name"] as? String ?? playerName
            } else {
                if !(g["allowJoin"] as? Bool ?? true) {
                    ws.sendError("This game is locked to new players.")
                    return
                }
                players.append([
                    "name": playerName,
                    "role": NSNull(),
                    "alive": true,
                    "claimed": true,
                    "ip": clientIp,
                    "token": token
                ])
                deviceIps[clientIp] = playerName
                previousPlayersByCode[code] = players.compactMap { $0["name"] as? String }
            }

            g["players"] = players
            g["deviceIps"] = deviceIps
            games[code] = g
            saveState()

            ws.subscribedGame = code
            ws.playerName = playerName
            ws.playerToken = token
            if let pub = getPublicGameView(gameCode: code, playerName: playerName, clientIp: clientIp) {
                ws.sendJson(["type": "PLAYER_JOINED", "game": pub])
            }
            broadcastUpdate(gameCode: code)

        case "BEGIN_RANDOMIZATION":
            let code = (msg["gameCode"] as? String ?? "").trimmingCharacters(in: .whitespaces).lowercased()
            let passcode = (msg["passcode"] as? String ?? "").trimmingCharacters(in: .whitespaces)
            guard var g = games[code], (g["passcode"] as? String) == passcode else { return }
            var players = g["players"] as? [[String: Any]] ?? []
            guard !players.isEmpty else {
                ws.sendError("Add at least 1 player before randomizing roles.")
                return
            }
            var rc = g["roleCounts"] as? [String: Int] ?? ["mafia": 1, "detective": 1, "doctor": 1, "villager": 3]
            let special = (rc["mafia"] ?? 1) + (rc["detective"] ?? 0) + (rc["doctor"] ?? 0)
            rc["villager"] = max(0, players.count - special)
            var pool: [String] = []
            pool.append(contentsOf: Array(repeating: "Mafia", count: rc["mafia"] ?? 1))
            pool.append(contentsOf: Array(repeating: "Detective", count: rc["detective"] ?? 0))
            pool.append(contentsOf: Array(repeating: "Doctor", count: rc["doctor"] ?? 0))
            pool.append(contentsOf: Array(repeating: "Villager", count: rc["villager"] ?? 0))
            pool.shuffle()

            for i in 0..<players.count {
                players[i]["role"] = i < pool.count ? pool[i] : "Villager"
                players[i]["alive"] = true
            }
            g["players"] = players
            g["status"] = "ROLES_ASSIGNED"
            g["phase"] = "Role Reveal (Pre-Game)"
            g["announcement"] = "Roles have been assigned! Players can view/refresh their secret role now before the game starts."
            games[code] = g
            saveState()
            broadcastUpdate(gameCode: code)

        case "START_GAME":
            let code = (msg["gameCode"] as? String ?? "").trimmingCharacters(in: .whitespaces).lowercased()
            let passcode = (msg["passcode"] as? String ?? "").trimmingCharacters(in: .whitespaces)
            guard var g = games[code], (g["passcode"] as? String) == passcode else { return }
            g["status"] = "STARTED"
            g["phase"] = "Night 1"
            g["allowJoin"] = false
            g["announcement"] = "Game has started! Roles are now concealed — click and hold on your screen to peek at your role."
            games[code] = g
            saveState()
            broadcastUpdate(gameCode: code)

        default:
            break
        }
    }

    private final class WsClient {
        let fd: Int32
        let clientIp: String
        var closed = false
        var subscribedGame: String?
        var playerName: String?
        var playerToken: String?
        var godPasscode: String?

        init(fd: Int32, clientIp: String) {
            self.fd = fd
            self.clientIp = clientIp
        }

        func sendJson(_ dict: [String: Any]) {
            guard !closed, let data = try? JSONSerialization.data(withJSONObject: dict) else { return }
            sendFrame(payload: data, opcode: 0x1)
        }

        func sendError(_ message: String) {
            sendJson(["type": "ERROR", "message": message])
        }

        func sendFrame(payload: Data, opcode: UInt8) {
            var header = Data([0x80 | (opcode & 0x0F)])
            let len = payload.count
            if len < 126 {
                header.append(UInt8(len))
            } else if len < 65536 {
                header.append(126)
                header.append(UInt8((len >> 8) & 0xFF))
                header.append(UInt8(len & 0xFF))
            } else {
                header.append(127)
                var bigLen = UInt64(len).bigEndian
                header.append(Data(bytes: &bigLen, count: 8))
            }
            let packet = header + payload
            _ = packet.withUnsafeBytes { rawBuf in
                guard let base = rawBuf.baseAddress else { return }
                _ = Darwin.write(fd, base, packet.count)
            }
        }

        func readFrame() -> (UInt8, Data)? {
            var firstTwo = [UInt8](repeating: 0, count: 2)
            guard readExact(&firstTwo) else { return nil }
            let opcode = firstTwo[0] & 0x0F
            let masked = (firstTwo[1] & 0x80) != 0
            var length = Int(firstTwo[1] & 0x7F)
            if length == 126 {
                var ext = [UInt8](repeating: 0, count: 2)
                guard readExact(&ext) else { return nil }
                length = (Int(ext[0]) << 8) | Int(ext[1])
            } else if length == 127 {
                var ext = [UInt8](repeating: 0, count: 8)
                guard readExact(&ext) else { return nil }
                length = ext.reduce(0) { ($0 << 8) | Int($1) }
            }
            var maskKey = [UInt8](repeating: 0, count: 4)
            if masked {
                guard readExact(&maskKey) else { return nil }
            }
            var payload = [UInt8](repeating: 0, count: length)
            if length > 0 {
                guard readExact(&payload) else { return nil }
            }
            if masked {
                for i in 0..<length {
                    payload[i] ^= maskKey[i % 4]
                }
            }
            return (opcode, Data(payload))
        }

        private func readExact(_ buf: inout [UInt8]) -> Bool {
            var offset = 0
            let count = buf.count
            return buf.withUnsafeMutableBytes { rawBuf in
                guard let base = rawBuf.baseAddress else { return false }
                while offset < count {
                    let n = Darwin.read(fd, base.advanced(by: offset), count - offset)
                    if n <= 0 { return false }
                    offset += n
                }
                return true
            }
        }

        func close() {
            guard !closed else { return }
            closed = true
            Darwin.close(fd)
        }
    }
}
