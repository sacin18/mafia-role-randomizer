#!/usr/bin/env python3
"""
Mafia Role Randomizer & Game Server
Zero-dependency HTTP + WebSocket server designed to run on the Game-God's device
(laptop or Android phone via Termux/Pydroid) over a mobile hotspot with no internet.
Also uses `names-generator` if installed, or built-in Docker-style word lists.
"""

import asyncio
import base64
import hashlib
import json
import mimetypes
import os
import random
import re
import shutil
import socket
import struct
import subprocess
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse

try:
    from names_generator import generate_name as _pkg_generate_name
except ImportError:
    _pkg_generate_name = None

BASE_DIR = Path(__file__).resolve().parent
STATE_FILE = BASE_DIR / "games_state.json"

# Docker-style adjectives and surnames (fallback if names-generator is not installed)
ADJECTIVES = [
    "admiring", "adoring", "affectionate", "agitated", "amazing", "angry", "awesome",
    "blissful", "bold", "boring", "brave", "busy", "charming", "clever", "cool",
    "compassionate", "competent", "condescending", "confident", "cranky", "crazy",
    "dazzling", "determined", "distracted", "dreamy", "eager", "ecstatic", "elastic",
    "elated", "elegant", "eloquent", "epic", "exciting", "fervent", "festive",
    "flamboyant", "focused", "friendly", "frosty", "funny", "gallant", "gifted",
    "goofy", "gracious", "great", "happy", "hardcore", "heuristic", "hopeful",
    "hungry", "infallible", "inspiring", "interesting", "intelligent", "jolly",
    "jovial", "keen", "kind", "laughing", "loving", "lucid", "magical", "mystifying",
    "modest", "musing", "naughty", "nervous", "nice", "nifty", "nostalgic",
    "objective", "optimistic", "peaceful", "pedantic", "pensive", "practical",
    "priceless", "quirky", "quizzical", "recursing", "relaxed", "reverent",
    "romantic", "sad", "serene", "sharp", "silly", "sleepy", "stoic", "strange",
    "stupefied", "suspicious", "sweet", "tender", "thirsty", "trusting", "unruffled",
    "upbeat", "vibrant", "vigilant", "vigorous", "wizardly", "wonderful", "xenodochial",
    "youthful", "zealous", "zen"
]

SURNAMES = [
    "albattani", "allen", "almeida", "archimedes", "ardinghelli", "aryabhata",
    "austin", "babbage", "banach", "bardeen", "bartik", "bassi", "beaver", "bell",
    "benz", "bhabha", "bhaskara", "blackwell", "bohr", "booth", "borg", "bose",
    "bouman", "boyd", "brahmagupta", "brattain", "brown", "carson", "chandrasekhar",
    "chaplygin", "chatelet", "chatterjee", "chebyshev", "cohen", "chaum", "clarke",
    "colden", "cori", "cray", "curie", "darwin", "davinci", "dijkstra", "dubinsky",
    "easley", "edison", "einstein", "elion", "engelbart", "euclid", "euler",
    "faraday", "feistel", "fermat", "fermi", "feynman", "franklin", "galileo",
    "gates", "gauss", "germain", "goldberg", "goldstine", "goldwasser", "golick",
    "goodall", "gould", "greider", "grothendieck", "haibt", "hamilton", "haslett",
    "hawking", "heisenberg", "hermann", "herschel", "hertz", "heyrovsky", "hodgkin",
    "hofstadter", "hoover", "hopper", "hugle", "hypatia", "ishizaka", "jackson",
    "jang", "jemison", "jennings", "jepsen", "johnson", "joliot", "jones", "kalam",
    "kapitsa", "kare", "keldysh", "keller", "kepler", "khayyam", "kilby", "kirch",
    "knuth", "kowalevski", "lalande", "lamarr", "lamport", "leakey", "leavitt",
    "lederberg", "lehmann", "lewin", "lichterman", "liskov", "lovelace", "lumiere",
    "mahavira", "margulis", "matsumoto", "maxwell", "mayer", "mccarthy", "mcclintock",
    "mclean", "mcnulty", "mendel", "mendeleev", "meitner", "meninsky", "merkle",
    "mestorf", "mirzakhani", "moore", "morse", "murdock", "moser", "napier",
    "nash", "neumann", "newton", "nightingale", "nobel", "noether", "northcutt",
    "noyce", "panini", "pare", "pascal", "pasteur", "payne", "perlman", "pike",
    "poincare", "poitras", "proskuriakova", "ptolemy", "raman", "ramanujan",
    "ride", "ritchie", "rhodes", "robinson", "roentgen", "rosalind", "rubin",
    "saha", "sammet", "sanderson", "satoshi", "shamir", "shannon", "shaw",
    "shirley", "shockley", "shtern", "sinoussi", "snyder", "solomon", "spence",
    "stonebraker", "sutherland", "swanson", "swartz", "swirles", "taussig",
    "tesla", "thompson", "torvalds", "tu", "turing", "varahamihira", "vaughan",
    "visvesvaraya", "volhard", "wescoff", "wilbur", "wiles", "williams", "williamson",
    "wilson", "wing", "wozniak", "wright", "wu", "yalow", "yonath", "zhukovsky"
]


def generate_docker_code(existing_codes=None):
    existing = set(existing_codes or [])
    for _ in range(100):
        if _pkg_generate_name is not None:
            code = _pkg_generate_name(style="underscore")
        else:
            code = f"{random.choice(ADJECTIVES)}_{random.choice(SURNAMES)}"
        if code not in existing:
            return code
    return f"{random.choice(ADJECTIVES)}_{random.choice(SURNAMES)}_{random.randint(10, 99)}"


def get_local_ips():
    ips = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
        if ip and not ip.startswith("127."):
            ips.append(ip)
    except Exception:
        pass
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ip = info[4][0]
            if ip and not ip.startswith("127.") and ip not in ips:
                ips.append(ip)
    except Exception:
        pass
    return ips or ["127.0.0.1"]


def normalize_ip(raw_ip: str) -> str:
    ip = str(raw_ip or "").strip()
    if not ip:
        return "127.0.0.1"
    if ip.startswith("::ffff:"):
        ip = ip[7:]
    if ip == "::1":
        ip = "127.0.0.1"
    return ip


class HostWakeManager:
    """
    Keeps the host OS awake while any game is in LOBBY waiting for players to join
    and roles to be assigned (supports Android Termux `termux-wake-lock` and macOS `caffeinate`).
    """
    def __init__(self):
        self.active = False
        self.proc = None

    def sync(self, games: dict):
        needs_wake = any(g.get("status", "LOBBY") == "LOBBY" for g in games.values())
        if needs_wake and not self.active:
            self._acquire()
        elif not needs_wake and self.active:
            self._release()

    def _acquire(self):
        self.active = True
        try:
            if shutil.which("termux-wake-lock"):
                subprocess.Popen(
                    ["termux-wake-lock"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
            elif shutil.which("caffeinate") and self.proc is None:
                self.proc = subprocess.Popen(
                    ["caffeinate", "-di"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
        except Exception:
            pass

    def _release(self):
        self.active = False
        try:
            if shutil.which("termux-wake-unlock"):
                subprocess.Popen(
                    ["termux-wake-unlock"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
            if self.proc is not None:
                self.proc.terminate()
                self.proc = None
        except Exception:
            self.proc = None


WAKE_MANAGER = HostWakeManager()


class GameStore:
    def __init__(self):
        self.games = {}
        self.previous_players_by_code = {}
        self.load()

    def load(self):
        if STATE_FILE.exists():
            try:
                data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
                self.games = data.get("games", {})
                self.previous_players_by_code = data.get("previous_players_by_code", {})
            except Exception:
                self.games = {}
                self.previous_players_by_code = {}
        WAKE_MANAGER.sync(self.games)

    def save(self):
        WAKE_MANAGER.sync(self.games)
        try:
            payload = {
                "games": self.games,
                "previous_players_by_code": self.previous_players_by_code,
            }
            STATE_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        except Exception:
            pass

    def list_public_games(self, client_ip=None):
        norm_ip = normalize_ip(client_ip) if client_ip else None
        result = []
        for code, g in sorted(
            self.games.items(), key=lambda item: item[1].get("createdAt", 0), reverse=True
        ):
            bound_player_name = None
            if norm_ip:
                device_ips = g.get("deviceIps") or {}
                if norm_ip in device_ips:
                    bound_player_name = device_ips[norm_ip]
                else:
                    for p in g.get("players", []):
                        if p.get("ip") and normalize_ip(p.get("ip")) == norm_ip:
                            bound_player_name = p["name"]
                            break

            result.append({
                "gameCode": code,
                "status": g.get("status", "LOBBY"),
                "allowJoin": g.get("allowJoin", True),
                "playerCount": len(g.get("players", [])),
                "expectedTotal": g.get("expectedTotal", 0),
                "allocationMode": g.get("allocationMode", "counts"),
                "createdAt": g.get("createdAt", 0),
                "roundNumber": g.get("roundNumber", 1),
                "previousPlayers": self.previous_players_by_code.get(code, []),
                "myBoundPlayer": bound_player_name,
            })
        return result

    def get_public_game_view(self, game_code, player_name=None, player_token=None, client_ip=None):
        g = self.games.get(game_code)
        if not g:
            return None

        status = g.get("status", "LOBBY")
        norm_ip = normalize_ip(client_ip) if client_ip else None
        my_player = None
        if player_name:
            norm = player_name.strip().lower()
            for p in g.get("players", []):
                if p["name"].strip().lower() == norm:
                    my_player = p
                    break
        elif norm_ip:
            for p in g.get("players", []):
                if p.get("ip") and normalize_ip(p.get("ip")) == norm_ip:
                    my_player = p
                    break

        # Role visibility rule from requirements-1 & requirements-2:
        # - In ROLES_ASSIGNED (pre-game), role is visible directly even on refresh.
        # - Once the game is STARTED, the player's screen hides the role by default,
        #   and allows the player to click and hold to view the role and hide again once released.
        my_role = None
        role_hidden_reason = None
        if my_player:
            if status == "ROLES_ASSIGNED":
                my_role = my_player.get("role")
            elif status == "STARTED":
                my_role = my_player.get("role")
                role_hidden_reason = "HOLD_TO_VIEW"
            elif status == "ENDED" and g.get("rules", {}).get("revealRolesOnEnd", True):
                my_role = my_player.get("role")

        public_players = []
        for p in g.get("players", []):
            entry = {
                "name": p["name"],
                "alive": p.get("alive", True),
                "claimed": p.get("claimed", False),
                "savedLastNight": p.get("savedLastNight", False),
                "killedLastNight": p.get("killedLastNight", False),
            }
            if (
                not p.get("alive", True)
                and g.get("rules", {}).get("revealRoleOnDeath", False)
            ) or (status == "ENDED" and g.get("rules", {}).get("revealRolesOnEnd", True)):
                entry["revealedRole"] = p.get("role")
            public_players.append(entry)

        return {
            "gameCode": g["gameCode"],
            "status": status,
            "roundNumber": g.get("roundNumber", 1),
            "phase": g.get("phase", "Night 1"),
            "allowJoin": g.get("allowJoin", True),
            "allocationMode": g.get("allocationMode", "counts"),
            "expectedTotal": g.get("expectedTotal", 0),
            "rules": g.get("rules", {}),
            "players": public_players,
            "announcement": g.get("announcement", ""),
            "myPlayer": {
                "name": my_player["name"],
                "ip": my_player.get("ip"),
                "alive": my_player.get("alive", True),
                "role": my_role,
                "roleHiddenReason": role_hidden_reason,
                "savedLastNight": my_player.get("savedLastNight", False),
                "killedLastNight": my_player.get("killedLastNight", False),
            } if my_player else None,
        }

    def get_god_game_view(self, game_code, passcode):
        g = self.games.get(game_code)
        if not g:
            return None, "Game not found."
        if str(g.get("passcode", "")) != str(passcode or "").strip():
            return None, "Invalid Game-God passcode."
        return {
            "gameCode": g["gameCode"],
            "status": g.get("status", "LOBBY"),
            "roundNumber": g.get("roundNumber", 1),
            "phase": g.get("phase", "Lobby"),
            "allowJoin": g.get("allowJoin", True),
            "allocationMode": g.get("allocationMode", "counts"),
            "roleCounts": g.get("roleCounts", {"mafia": 1, "detective": 1, "doctor": 1, "villager": 3}),
            "rolePercentages": g.get(
                "rolePercentages",
                {"mafia": 25, "detective": 15, "doctor": 15, "villager": 45},
            ),
            "expectedTotal": g.get("expectedTotal", 0),
            "rules": g.get("rules", {}),
            "players": g.get("players", []),
            "nightActions": g.get("nightActions", {"killTarget": "", "saveTarget": "", "investigateTarget": ""}),
            "announcement": g.get("announcement", ""),
            "history": g.get("history", []),
            "previousPlayers": self.previous_players_by_code.get(game_code, []),
            "createdAt": g.get("createdAt", 0),
        }, None


STORE = GameStore()
CONNECTED_CLIENTS = set()  # set of WebSocketConnection


def compute_roles_from_percentages(total_players, pcts):
    if total_players <= 0:
        return {"mafia": 0, "detective": 0, "doctor": 0, "villager": 0}
    mafia_pct = max(0, float(pcts.get("mafia", 25)))
    det_pct = max(0, float(pcts.get("detective", 15)))
    doc_pct = max(0, float(pcts.get("doctor", 15)))
    vil_pct = max(0, float(pcts.get("villager", 45)))
    total_pct = mafia_pct + det_pct + doc_pct + vil_pct
    if total_pct <= 0:
        mafia_pct, det_pct, doc_pct, vil_pct = 25, 15, 15, 45
        total_pct = 100.0

    raw = {
        "mafia": (mafia_pct / total_pct) * total_players,
        "detective": (det_pct / total_pct) * total_players,
        "doctor": (doc_pct / total_pct) * total_players,
        "villager": (vil_pct / total_pct) * total_players,
    }
    counts = {k: int(v) for k, v in raw.items()}
    # Ensure at least 1 mafia if mafia_pct > 0 and total_players >= 2
    if mafia_pct > 0 and total_players >= 2 and counts["mafia"] == 0:
        counts["mafia"] = 1

    current_sum = sum(counts.values())
    remainders = sorted(
        ["mafia", "detective", "doctor", "villager"],
        key=lambda k: (raw[k] - counts[k], k == "villager"),
        reverse=True,
    )
    idx = 0
    while current_sum < total_players:
        role_key = remainders[idx % len(remainders)]
        counts[role_key] += 1
        current_sum += 1
        idx += 1
    while current_sum > total_players:
        for role_key in ["villager", "doctor", "detective", "mafia"]:
            if counts[role_key] > 0 and current_sum > total_players:
                counts[role_key] -= 1
                current_sum -= 1
    return counts


class WebSocketConnection:
    def __init__(self, reader, writer, client_ip="127.0.0.1"):
        self.reader = reader
        self.writer = writer
        self.client_ip = normalize_ip(client_ip)
        self.subscribed_game = None
        self.player_name = None
        self.player_token = None
        self.god_passcode = None
        self.closed = False

    async def send_json(self, data):
        if self.closed:
            return
        try:
            payload = json.dumps(data).encode("utf-8")
            await self.send_frame(payload, opcode=0x1)
        except Exception:
            self.closed = True

    async def send_frame(self, payload: bytes, opcode: int = 0x1):
        header = bytearray()
        header.append(0x80 | (opcode & 0x0F))
        length = len(payload)
        if length < 126:
            header.append(length)
        elif length < 65536:
            header.append(126)
            header.extend(struct.pack("!H", length))
        else:
            header.append(127)
            header.extend(struct.pack("!Q", length))
        self.writer.write(header + payload)
        await self.writer.drain()

    async def read_frame(self):
        first_two = await self.reader.readexactly(2)
        b1, b2 = first_two[0], first_two[1]
        opcode = b1 & 0x0F
        masked = (b2 & 0x80) != 0
        length = b2 & 0x7F
        if length == 126:
            ext = await self.reader.readexactly(2)
            length = struct.unpack("!H", ext)[0]
        elif length == 127:
            ext = await self.reader.readexactly(8)
            length = struct.unpack("!Q", ext)[0]
        mask_key = await self.reader.readexactly(4) if masked else None
        payload = await self.reader.readexactly(length) if length > 0 else b""
        if masked and mask_key:
            payload = bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload))
        return opcode, payload


async def broadcast_games_list():
    dead = []
    for ws in list(CONNECTED_CLIENTS):
        if ws.closed:
            dead.append(ws)
            continue
        await ws.send_json({
            "type": "GAMES_LIST",
            "games": STORE.list_public_games(ws.client_ip),
            "previousPlayersByCode": STORE.previous_players_by_code,
        })
    for ws in dead:
        CONNECTED_CLIENTS.discard(ws)


async def broadcast_game_update(game_code):
    await broadcast_games_list()
    for ws in list(CONNECTED_CLIENTS):
        if ws.closed:
            CONNECTED_CLIENTS.discard(ws)
            continue
        if ws.subscribed_game == game_code:
            pub_view = STORE.get_public_game_view(
                game_code, ws.player_name, ws.player_token, ws.client_ip
            )
            if pub_view:
                await ws.send_json({"type": "GAME_STATE", "game": pub_view})
            if ws.god_passcode:
                god_view, err = STORE.get_god_game_view(game_code, ws.god_passcode)
                if god_view and not err:
                    await ws.send_json({"type": "GOD_STATE", "game": god_view})


async def handle_ws_message(ws: WebSocketConnection, msg: dict, port: int):
    action = msg.get("action")
    client_ip = normalize_ip(ws.client_ip or msg.get("clientIp") or "127.0.0.1")

    if action == "INIT":
        await ws.send_json({
            "type": "INIT_DATA",
            "games": STORE.list_public_games(client_ip),
            "previousPlayersByCode": STORE.previous_players_by_code,
            "serverInfo": {
                "ips": get_local_ips(),
                "port": port,
                "clientIp": client_ip,
            },
            "suggestedCode": generate_docker_code(STORE.games.keys()),
        })
        return

    if action == "GENERATE_CODE":
        await ws.send_json({
            "type": "GENERATED_CODE",
            "gameCode": generate_docker_code(STORE.games.keys()),
        })
        return

    if action == "CREATE_GAME":
        raw_code = (msg.get("gameCode") or "").strip().lower()
        raw_code = re.sub(r"[^a-z0-9_-]", "_", raw_code)
        if not raw_code:
            raw_code = generate_docker_code(STORE.games.keys())

        passcode = str(msg.get("passcode") or "").strip()
        if not re.match(r"^\d{4,8}$", passcode):
            await ws.send_json({
                "type": "ERROR",
                "message": "Passcode must be 4 to 8 digits (numbers only).",
            })
            return

        # If reusing existing game code, verify passcode or create fresh
        existing_game = STORE.games.get(raw_code)
        if existing_game and str(existing_game.get("passcode")) != passcode:
            await ws.send_json({
                "type": "ERROR",
                "message": f"Game code '{raw_code}' already exists with a different passcode. Pick a new code or enter its matching passcode.",
            })
            return

        allocation_mode = msg.get("allocationMode", "counts")
        allow_join = bool(msg.get("allowJoin", True))

        role_counts = msg.get("roleCounts") or {}
        mafia_c = max(0, int(role_counts.get("mafia", 1)))
        det_c = max(0, int(role_counts.get("detective", 1)))
        doc_c = max(0, int(role_counts.get("doctor", 1)))
        vil_c = max(0, int(role_counts.get("villager", 3)))

        role_pcts = msg.get("rolePercentages") or {
            "mafia": 25,
            "detective": 15,
            "doctor": 15,
            "villager": 45,
        }

        player_names_raw = msg.get("playerNames") or []
        seen_names = set()
        players = []
        for name in player_names_raw:
            clean = str(name).strip()
            if clean and clean.lower() not in seen_names:
                seen_names.add(clean.lower())
                players.append({
                    "name": clean,
                    "role": None,
                    "alive": True,
                    "claimed": False,
                    "token": None,
                    "ip": None,
                    "savedLastNight": False,
                    "killedLastNight": False,
                })

        expected_total = mafia_c + det_c + doc_c + vil_c
        if allocation_mode == "percentages":
            expected_total = len(players)

        if players:
            STORE.previous_players_by_code[raw_code] = [p["name"] for p in players]

        round_num = (existing_game.get("roundNumber", 0) + 1) if existing_game else 1
        STORE.games[raw_code] = {
            "gameCode": raw_code,
            "passcode": passcode,
            "status": "LOBBY",
            "roundNumber": round_num,
            "phase": "Lobby",
            "allowJoin": allow_join,
            "allocationMode": allocation_mode,
            "roleCounts": {
                "mafia": mafia_c,
                "detective": det_c,
                "doctor": doc_c,
                "villager": vil_c,
            },
            "rolePercentages": {
                "mafia": float(role_pcts.get("mafia", 25)),
                "detective": float(role_pcts.get("detective", 15)),
                "doctor": float(role_pcts.get("doctor", 15)),
                "villager": float(role_pcts.get("villager", 45)),
            },
            "expectedTotal": expected_total,
            "rules": {
                "killSaveMode": msg.get("rules", {}).get("killSaveMode", "standard"),
                "doctorSelfSave": bool(msg.get("rules", {}).get("doctorSelfSave", True)),
                "revealRoleOnDeath": bool(msg.get("rules", {}).get("revealRoleOnDeath", False)),
                "revealRolesOnEnd": bool(msg.get("rules", {}).get("revealRolesOnEnd", True)),
            },
            "players": players,
            "deviceIps": {},
            "nightActions": {
                "killTarget": "",
                "saveTarget": "",
                "investigateTarget": "",
            },
            "announcement": "Waiting for Game-God to confirm players and randomize roles.",
            "history": [f"Game '{raw_code}' (Round {round_num}) created by Game-God."],
            "createdAt": int(time.time() * 1000),
        }
        STORE.save()

        ws.subscribed_game = raw_code
        ws.god_passcode = passcode
        god_view, _ = STORE.get_god_game_view(raw_code, passcode)
        ips = get_local_ips()
        primary_ip = ips[0] if ips else "localhost"
        join_url = f"http://{primary_ip}:{port}/?gamecode={raw_code}"
        if god_view is not None:
            god_view["joinUrl"] = join_url
        print(f"  [Game Created] '{raw_code}' -> Shareable Join URL: {join_url}")
        await ws.send_json({"type": "GAME_CREATED", "game": god_view, "joinUrl": join_url})
        await broadcast_game_update(raw_code)
        return

    if action == "GOD_AUTH":
        game_code = (msg.get("gameCode") or "").strip().lower()
        if game_code not in STORE.games:
            norm = re.sub(r"[-_]+", "_", game_code)
            for k in STORE.games:
                if re.sub(r"[-_]+", "_", k.lower()) == norm:
                    game_code = k
                    break
        passcode = str(msg.get("passcode") or "").strip()
        god_view, err = STORE.get_god_game_view(game_code, passcode)
        if err:
            await ws.send_json({"type": "ERROR", "message": err})
            return
        ws.subscribed_game = game_code
        ws.god_passcode = passcode
        await ws.send_json({"type": "GOD_STATE", "game": god_view})
        return

    if action == "JOIN_PLAYER":
        game_code = (msg.get("gameCode") or "").strip().lower()
        if game_code not in STORE.games:
            norm = re.sub(r"[-_]+", "_", game_code)
            for k in STORE.games:
                if re.sub(r"[-_]+", "_", k.lower()) == norm:
                    game_code = k
                    break
        player_name = (msg.get("playerName") or "").strip()
        player_token = (msg.get("playerToken") or "").strip()
        is_reconnect = bool(msg.get("isReconnect", False))

        if not game_code or game_code not in STORE.games:
            await ws.send_json({
                "type": "ERROR",
                "message": f"Game code '{game_code}' was not found. Ask Game-God to create the game first.",
            })
            return
        if not player_name:
            await ws.send_json({
                "type": "ERROR",
                "message": "Please enter your player name.",
            })
            return

        g = STORE.games[game_code]
        if "deviceIps" not in g or not isinstance(g.get("deviceIps"), dict):
            g["deviceIps"] = {}

        norm_name = player_name.lower()

        # 1. Enforce 1 player per IP address for this game code (requirements-2 item 1)
        bound_by_ip = None
        for p in g["players"]:
            p_ip = normalize_ip(p.get("ip")) if p.get("ip") else None
            if (p_ip and p_ip == client_ip) or (player_token and p.get("token") == player_token):
                bound_by_ip = p
                break

        if bound_by_ip and bound_by_ip["name"].strip().lower() != norm_name:
            await ws.send_json({
                "type": "ERROR",
                "message": (
                    f"This device (IP: {client_ip}) has already joined game '{game_code}' "
                    f"as '{bound_by_ip['name']}'. Only one player is allowed per IP address in a game."
                ),
            })
            return

        existing_player = None
        for p in g["players"]:
            if p["name"].strip().lower() == norm_name:
                existing_player = p
                break

        if existing_player:
            if existing_player.get("claimed"):
                existing_ip = normalize_ip(existing_player.get("ip")) if existing_player.get("ip") else None
                same_ip = existing_ip and existing_ip == client_ip
                same_token_unclaimed_ip = (not existing_ip) and existing_player.get("token") == player_token
                if same_ip or same_token_unclaimed_ip:
                    # Same device/IP reconnecting to their own slot
                    existing_player["ip"] = client_ip
                    if player_token:
                        existing_player["token"] = player_token
                    g["deviceIps"][client_ip] = existing_player["name"]
                else:
                    await ws.send_json({
                        "type": "ERROR",
                        "message": f"Player name '{player_name}' is already taken by another device in game '{game_code}'!",
                    })
                    return
            else:
                # Slot was pre-populated by Game-God and not claimed yet; bind to this device's IP now!
                existing_player["claimed"] = True
                existing_player["ip"] = client_ip
                existing_player["token"] = player_token
                g["deviceIps"][client_ip] = existing_player["name"]
        else:
            # New player adding themselves to the game
            if g.get("status") != "LOBBY" and not g.get("allowJoin", True):
                await ws.send_json({
                    "type": "ERROR",
                    "message": "This game has already started and is no longer accepting new players.",
                })
                return
            if not g.get("allowJoin", True) and not is_reconnect:
                await ws.send_json({
                    "type": "ERROR",
                    "message": f"Player '{player_name}' is not on the pre-registered list and open joining is disabled by Game-God.",
                })
                return

            g["players"].append({
                "name": player_name,
                "role": None,
                "alive": True,
                "claimed": True,
                "token": player_token,
                "ip": client_ip,
                "savedLastNight": False,
                "killedLastNight": False,
            })
            g["deviceIps"][client_ip] = player_name
            g["history"].append(f"Player '{player_name}' joined from IP {client_ip}.")
            STORE.previous_players_by_code[game_code] = [p["name"] for p in g["players"]]
            STORE.save()

        ws.subscribed_game = game_code
        ws.player_name = existing_player["name"] if existing_player else player_name
        ws.player_token = player_token
        STORE.save()

        pub_view = STORE.get_public_game_view(
            game_code, ws.player_name, ws.player_token, client_ip
        )
        await ws.send_json({"type": "PLAYER_JOINED", "game": pub_view})
        await broadcast_game_update(game_code)
        return

    if action == "GOD_UPDATE_SETUP":
        game_code = (msg.get("gameCode") or "").strip().lower()
        passcode = str(msg.get("passcode") or "").strip()
        god_view, err = STORE.get_god_game_view(game_code, passcode)
        if err:
            await ws.send_json({"type": "ERROR", "message": err})
            return

        g = STORE.games[game_code]
        if "allowJoin" in msg:
            g["allowJoin"] = bool(msg["allowJoin"])
        if "allocationMode" in msg:
            g["allocationMode"] = msg["allocationMode"]
        if "roleCounts" in msg:
            rc = msg["roleCounts"]
            g["roleCounts"] = {
                "mafia": max(0, int(rc.get("mafia", 1))),
                "detective": max(0, int(rc.get("detective", 0))),
                "doctor": max(0, int(rc.get("doctor", 0))),
                "villager": max(0, int(rc.get("villager", 0))),
            }
            g["expectedTotal"] = sum(g["roleCounts"].values())
        if "rolePercentages" in msg:
            rp = msg["rolePercentages"]
            g["rolePercentages"] = {
                "mafia": max(0, float(rp.get("mafia", 25))),
                "detective": max(0, float(rp.get("detective", 15))),
                "doctor": max(0, float(rp.get("doctor", 15))),
                "villager": max(0, float(rp.get("villager", 45))),
            }
        if "rules" in msg:
            g["rules"].update(msg["rules"])

        if "addPlayerName" in msg:
            new_name = str(msg["addPlayerName"]).strip()
            if new_name:
                if any(p["name"].lower() == new_name.lower() for p in g["players"]):
                    await ws.send_json({
                        "type": "ERROR",
                        "message": f"Player '{new_name}' is already in the list.",
                    })
                    return
                g["players"].append({
                    "name": new_name,
                    "role": None,
                    "alive": True,
                    "claimed": False,
                    "token": None,
                    "ip": None,
                    "savedLastNight": False,
                    "killedLastNight": False,
                })
                STORE.previous_players_by_code[game_code] = [p["name"] for p in g["players"]]

        if "removePlayerName" in msg:
            rem_name = str(msg["removePlayerName"]).strip().lower()
            g["players"] = [p for p in g["players"] if p["name"].lower() != rem_name]
            g["deviceIps"] = {
                normalize_ip(p["ip"]): p["name"]
                for p in g["players"]
                if p.get("ip")
            }
            STORE.previous_players_by_code[game_code] = [p["name"] for p in g["players"]]

        STORE.save()
        await broadcast_game_update(game_code)
        return

    if action == "BEGIN_RANDOMIZATION":
        game_code = (msg.get("gameCode") or "").strip().lower()
        passcode = str(msg.get("passcode") or "").strip()
        _, err = STORE.get_god_game_view(game_code, passcode)
        if err:
            await ws.send_json({"type": "ERROR", "message": err})
            return

        g = STORE.games[game_code]
        players = g.get("players", [])
        total_players = len(players)
        if total_players == 0:
            await ws.send_json({
                "type": "ERROR",
                "message": "Cannot randomize roles with 0 players. Add players or let players join first.",
            })
            return

        if g.get("allocationMode") == "percentages":
            counts = compute_roles_from_percentages(total_players, g.get("rolePercentages", {}))
            g["roleCounts"] = counts
            g["expectedTotal"] = total_players
        else:
            counts = g.get("roleCounts", {})
            expected = sum(counts.values())
            if expected != total_players:
                # Auto-adjust villagers if confirmAdjust is passed, otherwise inform God
                if msg.get("autoAdjustVillagers", True):
                    special_sum = counts.get("mafia", 0) + counts.get("detective", 0) + counts.get("doctor", 0)
                    if special_sum <= total_players:
                        counts["villager"] = total_players - special_sum
                        g["roleCounts"] = counts
                        g["expectedTotal"] = total_players
                    else:
                        await ws.send_json({
                            "type": "ERROR",
                            "message": f"Role count mismatch: {special_sum} special roles (Mafia+Detective+Doctor) exceed {total_players} players.",
                        })
                        return
                else:
                    await ws.send_json({
                        "type": "ERROR",
                        "message": f"Total roles ({expected}) must match total players ({total_players}).",
                    })
                    return

        role_pool = (
            ["Mafia"] * counts.get("mafia", 0)
            + ["Detective"] * counts.get("detective", 0)
            + ["Doctor"] * counts.get("doctor", 0)
            + ["Villager"] * counts.get("villager", 0)
        )
        random.shuffle(role_pool)

        for idx, p in enumerate(players):
            p["role"] = role_pool[idx] if idx < len(role_pool) else "Villager"
            p["alive"] = True
            p["savedLastNight"] = False
            p["killedLastNight"] = False

        g["status"] = "ROLES_ASSIGNED"
        g["phase"] = "Role Reveal (Pre-Game)"
        g["announcement"] = "Roles have been assigned! Players can view/refresh their secret role now before the game starts."
        g["history"].append(
            f"Roles randomized for {total_players} players ({counts.get('mafia', 0)} Mafia, "
            f"{counts.get('detective', 0)} Detective, {counts.get('doctor', 0)} Doctor, {counts.get('villager', 0)} Villager)."
        )
        STORE.previous_players_by_code[game_code] = [p["name"] for p in players]
        STORE.save()
        await broadcast_game_update(game_code)
        return

    if action == "START_GAME":
        game_code = (msg.get("gameCode") or "").strip().lower()
        passcode = str(msg.get("passcode") or "").strip()
        _, err = STORE.get_god_game_view(game_code, passcode)
        if err:
            await ws.send_json({"type": "ERROR", "message": err})
            return

        g = STORE.games[game_code]
        if g.get("status") != "ROLES_ASSIGNED":
            await ws.send_json({
                "type": "ERROR",
                "message": "Please randomize roles first before starting the game.",
            })
            return

        g["status"] = "STARTED"
        g["phase"] = "Night 1"
        g["allowJoin"] = False
        g["announcement"] = "Game has started! Roles are now concealed — click and hold on your screen to peek at your role."
        g["history"].append("Game officially started (Night 1). Player roles are now concealed (click & hold to view).")
        STORE.save()
        await broadcast_game_update(game_code)
        return

    if action == "GOD_GAME_ACTION":
        game_code = (msg.get("gameCode") or "").strip().lower()
        passcode = str(msg.get("passcode") or "").strip()
        _, err = STORE.get_god_game_view(game_code, passcode)
        if err:
            await ws.send_json({"type": "ERROR", "message": err})
            return

        g = STORE.games[game_code]
        sub_action = msg.get("subAction")

        if sub_action == "TOGGLE_ALIVE":
            target = (msg.get("playerName") or "").strip().lower()
            for p in g["players"]:
                if p["name"].lower() == target:
                    p["alive"] = not p.get("alive", True)
                    state_str = "revived (Alive)" if p["alive"] else "eliminated (Dead)"
                    g["history"].append(f"Game-God marked {p['name']} as {state_str}.")
                    break

        elif sub_action == "RESOLVE_NIGHT":
            kill_target = (msg.get("killTarget") or "").strip()
            save_target = (msg.get("saveTarget") or "").strip()
            investigate_target = (msg.get("investigateTarget") or "").strip()

            for p in g["players"]:
                p["savedLastNight"] = False
                p["killedLastNight"] = False

            kill_Save_mode = g.get("rules", {}).get("killSaveMode", "standard")
            killed_player = None
            saved_player = None

            if save_target:
                for p in g["players"]:
                    if p["name"].lower() == save_target.lower():
                        saved_player = p
                        p["savedLastNight"] = True
                        break

            if kill_target:
                for p in g["players"]:
                    if p["name"].lower() == kill_target.lower():
                        if saved_player and saved_player["name"].lower() == p["name"].lower():
                            g["history"].append(
                                f"Night action: Mafia targeted {p['name']}, but Doctor saved them!"
                            )
                            g["announcement"] = (
                                f"Dawn breaks! {p['name']} was attacked in the night, but the Doctor saved them!"
                                if kill_Save_mode == "announce_save"
                                else "Dawn breaks! Nobody died last night."
                            )
                        else:
                            p["alive"] = False
                            p["killedLastNight"] = True
                            killed_player = p
                            g["history"].append(f"Night action: {p['name']} was eliminated by the Mafia.")
                            g["announcement"] = f"Dawn breaks! {p['name']} was eliminated during the night."
                        break
            else:
                g["announcement"] = "Dawn breaks! A quiet night passed with no Mafia kill."
                g["history"].append("Night resolved with no kill target.")

            if investigate_target:
                for p in g["players"]:
                    if p["name"].lower() == investigate_target.lower():
                        is_mafia = p.get("role") == "Mafia"
                        g["history"].append(
                            f"Detective investigated {p['name']} -> {'MAFIA' if is_mafia else 'NOT MAFIA (' + str(p.get('role')) + ')'}."
                        )
                        break

            g["phase"] = "Day Phase"

        elif sub_action == "SET_PHASE":
            new_phase = (msg.get("phase") or "Day Phase").strip()
            g["phase"] = new_phase
            if msg.get("announcement"):
                g["announcement"] = str(msg["announcement"]).strip()
            g["history"].append(f"Phase changed to {new_phase}.")

        elif sub_action == "UNLOCK_ROLES":
            # Allows God to switch back to ROLES_ASSIGNED if someone missed seeing their role
            g["status"] = "ROLES_ASSIGNED"
            g["phase"] = "Role Reveal (Pre-Game)"
            g["announcement"] = "Game-God unlocked role view! Refresh or check your screen to see your role."
            g["history"].append("Game-God temporarily unlocked role reveal (Pre-Game mode).")

        elif sub_action == "END_GAME":
            winner = (msg.get("winner") or "Game Over").strip()
            g["status"] = "ENDED"
            g["phase"] = f"Ended ({winner})"
            g["announcement"] = f"Game Over! {winner}"
            g["history"].append(f"Game ended: {winner}.")

        elif sub_action == "RESET_TO_LOBBY":
            # Keep players from previous run for the same game code
            for p in g["players"]:
                p["role"] = None
                p["alive"] = True
                p["savedLastNight"] = False
                p["killedLastNight"] = False
            g["status"] = "LOBBY"
            g["roundNumber"] = g.get("roundNumber", 1) + 1
            g["phase"] = "Lobby"
            g["announcement"] = f"Round {g['roundNumber']} Lobby open! Confirm players and randomize roles."
            g["history"].append(f"Reset to Lobby for Round {g['roundNumber']} with {len(g['players'])} players.")

        STORE.save()
        await broadcast_game_update(game_code)
        return


async def serve_static_file(writer, request_path: str, client_ip: str = "127.0.0.1"):
    clean_path = urlparse(request_path).path
    if clean_path in ("", "/"):
        clean_path = "/index.html"

    if clean_path == "/api/games":
        body = json.dumps({
            "games": STORE.list_public_games(client_ip),
            "previousPlayersByCode": STORE.previous_players_by_code,
            "clientIp": client_ip,
        }).encode("utf-8")
        headers = (
            "HTTP/1.1 200 OK\r\n"
            "Content-Type: application/json; charset=utf-8\r\n"
            f"Content-Length: {len(body)}\r\n"
            "Cache-Control: no-store\r\n"
            "Connection: close\r\n\r\n"
        ).encode("utf-8")
        writer.write(headers + body)
        await writer.drain()
        return

    file_path = (BASE_DIR / clean_path.lstrip("/")).resolve()
    if not str(file_path).startswith(str(BASE_DIR)) or not file_path.is_file():
        file_path = BASE_DIR / "index.html"

    try:
        content = file_path.read_bytes()
        mime_type, _ = mimetypes.guess_type(str(file_path))
        if not mime_type:
            mime_type = "application/octet-stream"
        if mime_type.startswith("text/") or mime_type in ("application/javascript", "application/json"):
            mime_type += "; charset=utf-8"

        headers = (
            "HTTP/1.1 200 OK\r\n"
            f"Content-Type: {mime_type}\r\n"
            f"Content-Length: {len(content)}\r\n"
            "Cache-Control: no-cache\r\n"
            "Connection: close\r\n\r\n"
        ).encode("utf-8")
        writer.write(headers + content)
        await writer.drain()
    except Exception:
        not_found = b"HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\nConnection: close\r\n\r\nNot Found"
        writer.write(not_found)
        await writer.drain()


async def handle_client(reader: asyncio.StreamReader, writer: asyncio.StreamWriter, port: int):
    try:
        request_line = await asyncio.wait_for(reader.readline(), timeout=10.0)
        if not request_line:
            writer.close()
            return
        parts = request_line.decode("utf-8", errors="ignore").strip().split(" ")
        if len(parts) < 2:
            writer.close()
            return
        method, path = parts[0], parts[1]

        headers = {}
        while True:
            line = await asyncio.wait_for(reader.readline(), timeout=10.0)
            if not line or line in (b"\r\n", b"\n"):
                break
            decoded = line.decode("utf-8", errors="ignore").strip()
            if ":" in decoded:
                k, v = decoded.split(":", 1)
                headers[k.strip().lower()] = v.strip()

        peername = writer.get_extra_info("peername")
        peer_ip = peername[0] if isinstance(peername, (tuple, list)) and len(peername) >= 1 else "127.0.0.1"
        forwarded_for = headers.get("x-forwarded-for", "").split(",")[0].strip()
        real_ip = headers.get("x-real-ip", "").strip()
        client_ip = normalize_ip(forwarded_for or real_ip or peer_ip)

        if headers.get("upgrade", "").lower() == "websocket":
            key = headers.get("sec-websocket-key", "")
            accept_raw = (key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode("utf-8")
            accept_key = base64.b64encode(hashlib.sha1(accept_raw).digest()).decode("utf-8")
            handshake = (
                "HTTP/1.1 101 Switching Protocols\r\n"
                "Upgrade: websocket\r\n"
                "Connection: Upgrade\r\n"
                f"Sec-WebSocket-Accept: {accept_key}\r\n\r\n"
            ).encode("utf-8")
            writer.write(handshake)
            await writer.drain()

            ws = WebSocketConnection(reader, writer, client_ip=client_ip)
            CONNECTED_CLIENTS.add(ws)
            try:
                while not ws.closed:
                    opcode, payload = await ws.read_frame()
                    if opcode == 0x8:  # Close frame
                        break
                    elif opcode == 0x9:  # Ping
                        await ws.send_frame(payload, opcode=0xA)
                    elif opcode == 0x1:  # Text
                        msg = json.loads(payload.decode("utf-8"))
                        await handle_ws_message(ws, msg, port)
            except (asyncio.IncompleteReadError, ConnectionResetError):
                pass
            except Exception:
                pass
            finally:
                ws.closed = True
                CONNECTED_CLIENTS.discard(ws)
                try:
                    writer.close()
                except Exception:
                    pass
        else:
            await serve_static_file(writer, path, client_ip=client_ip)
            writer.close()
    except Exception:
        try:
            writer.close()
        except Exception:
            pass


async def main():
    port = int(os.environ.get("PORT", "8080"))
    server = await asyncio.start_server(
        lambda r, w: handle_client(r, w, port), host="0.0.0.0", port=port
    )
    ips = get_local_ips()
    print("=" * 60)
    print("  MAFIA ROLE RANDOMIZER & GAME SERVER (Offline / Hotspot Ready)")
    print("=" * 60)
    print(f"  Local URL   : http://localhost:{port}")
    for ip in ips:
        print(f"  Hotspot URL : http://{ip}:{port}")
    print("=" * 60)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nServer stopped.")
