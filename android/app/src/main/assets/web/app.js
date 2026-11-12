(() => {
  'use strict';

  // Docker-style word lists (matching Python `names-generator` / Docker container names)
  const ADJECTIVES = [
    'admiring', 'adoring', 'affectionate', 'agitated', 'amazing', 'awesome', 'blissful',
    'bold', 'brave', 'busy', 'charming', 'clever', 'cool', 'compassionate', 'competent',
    'confident', 'cranky', 'crazy', 'dazzling', 'determined', 'dreamy', 'eager', 'ecstatic',
    'elastic', 'elated', 'elegant', 'eloquent', 'epic', 'exciting', 'fervent', 'festive',
    'flamboyant', 'focused', 'friendly', 'frosty', 'funny', 'gallant', 'gifted', 'goofy',
    'gracious', 'great', 'happy', 'hardcore', 'heuristic', 'hopeful', 'hungry', 'infallible',
    'inspiring', 'intelligent', 'jolly', 'jovial', 'keen', 'kind', 'laughing', 'loving',
    'lucid', 'magical', 'mystifying', 'modest', 'musing', 'naughty', 'nervous', 'nice',
    'nifty', 'nostalgic', 'objective', 'optimistic', 'peaceful', 'pedantic', 'pensive',
    'practical', 'priceless', 'quirky', 'quizzical', 'recursing', 'relaxed', 'reverent',
    'romantic', 'serene', 'sharp', 'silly', 'stoic', 'strange', 'stupefied', 'suspicious',
    'sweet', 'tender', 'thirsty', 'trusting', 'unruffled', 'upbeat', 'vibrant', 'vigilant',
    'vigorous', 'wizardly', 'wonderful', 'xenodochial', 'youthful', 'zealous', 'zen'
  ];

  const SURNAMES = [
    'albattani', 'allen', 'almeida', 'archimedes', 'aryabhata', 'austin', 'babbage',
    'banach', 'bardeen', 'bartik', 'bassi', 'bell', 'benz', 'bhabha', 'bhaskara',
    'blackwell', 'bohr', 'booth', 'borg', 'bose', 'bouman', 'brahmagupta', 'brattain',
    'carson', 'chandrasekhar', 'chatterjee', 'chebyshev', 'clarke', 'cori', 'cray',
    'curie', 'darwin', 'davinci', 'dijkstra', 'easley', 'edison', 'einstein', 'elion',
    'engelbart', 'euclid', 'euler', 'faraday', 'fermat', 'fermi', 'feynman', 'franklin',
    'galileo', 'gates', 'gauss', 'Germain', 'goldwasser', 'goodall', 'grothendieck',
    'hamilton', 'hawking', 'heisenberg', 'herschel', 'hertz', 'hodgkin', 'hofstadter',
    'hopper', 'hypatia', 'jemison', 'johnson', 'kalam', 'kapitsa', 'keller', 'kepler',
    'khayyam', 'kilby', 'knuth', 'kowalevski', 'lamarr', 'lamport', 'leakey', 'liskov',
    'lovelace', 'lumiere', 'mahavira', 'maxwell', 'mccarthy', 'mcclintock', 'mendel',
    'mendeleev', 'meitner', 'merkle', 'mirzakhani', 'moore', 'morse', 'napier', 'nash',
    'neumann', 'newton', 'nightingale', 'nobel', 'noether', 'noyce', 'panini', 'pascal',
    'pasteur', 'perlman', 'poincare', 'ptolemy', 'raman', 'ramanujan', 'ritchie',
    'roentgen', 'rosalind', 'rubin', 'saha', 'satoshi', 'shamir', 'shannon', 'shockley',
    'solomon', 'stonebraker', 'sutherland', 'swartz', 'tesla', 'thompson', 'torvalds',
    'turing', 'varahamihira', 'vaughan', 'visvesvaraya', 'wiles', 'wozniak', 'wright',
    'wu', 'yalow', 'yonath'
  ].map((s) => s.toLowerCase());

  const ROLE_DESCRIPTIONS = {
    Mafia: 'Eliminate innocent townsfolk each night without exposing your identity during the day.',
    Detective: 'Investigate one player each night to learn whether they belong to the Mafia.',
    Doctor: 'Protect one player each night from being eliminated by the Mafia.',
    Villager: 'Find the Mafia during Day discussions and vote to eliminate suspects.'
  };

  // Storage Keys
  const STORAGE_KEYS = {
    LAST_GAME_CODE: 'mafia_last_game_code',
    LAST_PLAYER_NAME: 'mafia_last_player_name',
    DEVICE_TOKEN: 'mafia_device_token',
    ACTIVE_SESSION: 'mafia_active_session', // { mode: 'player'|'god', gameCode, playerName, passcode }
    LOCAL_GAMES_DB: 'mafia_local_games_db',
    PREV_PLAYERS_BY_CODE: 'mafia_prev_players_by_code'
  };

  function getOrCreateDeviceToken() {
    let token = localStorage.getItem(STORAGE_KEYS.DEVICE_TOKEN);
    if (!token) {
      token = 'dev_' + Math.random().toString(36).slice(2, 11) + '_' + Date.now().toString(36);
      localStorage.setItem(STORAGE_KEYS.DEVICE_TOKEN, token);
    }
    return token;
  }

  function generateDockerName(existingCodes = []) {
    const existing = new Set(existingCodes.map((c) => c.toLowerCase()));
    for (let i = 0; i < 100; i++) {
      const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
      const sur = SURNAMES[Math.floor(Math.random() * SURNAMES.length)];
      const candidate = `${adj}_${sur}`;
      if (!existing.has(candidate)) return candidate;
    }
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const sur = SURNAMES[Math.floor(Math.random() * SURNAMES.length)];
    return `${adj}_${sur}_${Math.floor(10 + Math.random() * 89)}`;
  }

  // Application State
  const state = {
    ws: null,
    wsConnected: false,
    broadcastChannel: typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('mafia_hotspot_channel') : null,
    runningGames: [],
    previousPlayersByCode: {},
    serverInfo: {
      ips: [window.location.hostname || 'localhost'],
      port: window.location.port || '8080',
      clientIp: '127.0.0.1'
    },
    allocationMode: 'counts', // 'counts' | 'percentages'
    currentPlayerGame: null,
    currentGodGame: null,
    godCredentials: { gameCode: '', passcode: '' },
    currentView: 'join',
    wakeLockMode: 'auto' // 'auto' (awake till roles assigned) | 'always' | 'off'
  };

  // ==================== HOST WAKE LOCK MANAGER ====================
  // Keeps the host device awake till roles are assigned (Screen Wake Lock API + WebAudio keep-alive fallback)
  const hostWakeLock = {
    sentinel: null,
    audioCtx: null,
    oscillator: null,
    keepAliveTimer: null,
    isActive: false,

    shouldKeepAwake() {
      if (state.wakeLockMode === 'off') return false;
      if (state.wakeLockMode === 'always') {
        return state.currentView === 'create' || state.currentView === 'god-dashboard';
      }
      // Default 'auto': keep host device awake while creating a game or in God Dashboard LOBBY till roles are assigned
      if (state.currentView === 'create') return true;
      if (
        state.currentView === 'god-dashboard' &&
        (!state.currentGodGame || state.currentGodGame.status === 'LOBBY')
      ) {
        return true;
      }
      return false;
    },

    async acquire() {
      this.isActive = true;
      // 1. Native Screen Wake Lock API
      if ('wakeLock' in navigator && navigator.wakeLock?.request) {
        try {
          if (!this.sentinel) {
            this.sentinel = await navigator.wakeLock.request('screen');
            this.sentinel.addEventListener('release', () => {
              this.sentinel = null;
              if (this.shouldKeepAwake() && document.visibilityState === 'visible') {
                this.acquire();
              }
            });
          }
        } catch {
          // Fallback below handles non-HTTPS hotspot origins
        }
      }

      // 2. Silent Web Audio oscillator fallback for mobile hotspot HTTP origins
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
          if (!this.audioCtx) {
            this.audioCtx = new AudioContextClass();
          }
          if (this.audioCtx.state === 'suspended') {
            await this.audioCtx.resume();
          }
          if (!this.oscillator) {
            const osc = this.audioCtx.createOscillator();
            const gain = this.audioCtx.createGain();
            gain.gain.setValueAtTime(0.00001, this.audioCtx.currentTime);
            osc.frequency.setValueAtTime(1, this.audioCtx.currentTime);
            osc.connect(gain);
            gain.connect(this.audioCtx.destination);
            osc.start();
            this.oscillator = osc;
          }
        }
      } catch {
        // ignore audio context restrictions before user gesture
      }

      // 3. Periodic lightweight WS ping while awake in Lobby so hotspot socket never idles out
      if (!this.keepAliveTimer) {
        this.keepAliveTimer = setInterval(() => {
          if (this.shouldKeepAwake() && state.wsConnected && state.ws?.readyState === WebSocket.OPEN) {
            state.ws.send(JSON.stringify({ action: 'INIT' }));
          }
        }, 15000);
      }

      this.updateUI();
    },

    async release() {
      this.isActive = false;
      if (this.sentinel) {
        try {
          await this.sentinel.release();
        } catch {
          // ignore
        }
        this.sentinel = null;
      }
      if (this.oscillator) {
        try {
          this.oscillator.stop();
          this.oscillator.disconnect();
        } catch {
          // ignore
        }
        this.oscillator = null;
      }
      if (this.keepAliveTimer) {
        clearInterval(this.keepAliveTimer);
        this.keepAliveTimer = null;
      }
      this.updateUI();
    },

    sync() {
      if (this.shouldKeepAwake()) {
        this.acquire();
      } else {
        this.release();
      }
    },

    updateUI() {
      const active = this.isActive && this.shouldKeepAwake();
      if (el.createWakeLockBar) {
        el.createWakeLockBar.classList.toggle('inactive', !active);
        if (el.createWakeLockState) {
          el.createWakeLockState.textContent = active ? 'AWAKE' : 'IDLE';
        }
      }
      if (el.godWakeLockBar) {
        el.godWakeLockBar.classList.toggle('inactive', !active);
        const rolesAssigned =
          state.currentGodGame && state.currentGodGame.status !== 'LOBBY';
        if (el.godWakeLockText) {
          if (active) {
            el.godWakeLockText.innerHTML =
              '&#9728; Host Device Kept Awake (Preventing Sleep Before Roles Assigned)';
          } else if (rolesAssigned && state.wakeLockMode === 'auto') {
            el.godWakeLockText.innerHTML =
              '&#x2714; Roles Assigned — Host Wake Lock Released';
          } else {
            el.godWakeLockText.innerHTML = 'Host Wake Lock: Off';
          }
        }
        if (el.godToggleWakeLockBtn) {
          const modeLabel =
            state.wakeLockMode === 'auto'
              ? 'Mode: Till Roles Assigned'
              : state.wakeLockMode === 'always'
              ? 'Mode: Always Awake'
              : 'Mode: Off';
          el.godToggleWakeLockBtn.textContent = modeLabel;
        }
      }
    }
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      hostWakeLock.sync();
    }
  });

  ['click', 'touchstart'].forEach((evtName) => {
    document.addEventListener(
      evtName,
      () => {
        if (hostWakeLock.shouldKeepAwake()) {
          hostWakeLock.acquire();
        }
      },
      { passive: true }
    );
  });

  // DOM Elements
  const el = {
    connBadge: document.getElementById('connBadge'),
    connText: document.getElementById('connText'),
    alertBanner: document.getElementById('alertBanner'),
    alertText: document.getElementById('alertText'),
    alertCloseBtn: document.getElementById('alertCloseBtn'),
    brandHomeBtn: document.getElementById('brandHomeBtn'),
    mainNavTabs: document.getElementById('mainNavTabs'),
    browserUrlBanner: document.getElementById('browserUrlBanner'),
    browserUrlText: document.getElementById('browserUrlText'),
    copyBrowserUrlBtn: document.getElementById('copyBrowserUrlBtn'),

    // Views
    viewJoin: document.getElementById('viewJoin'),
    viewCreate: document.getElementById('viewCreate'),
    viewGodLogin: document.getElementById('viewGodLogin'),
    viewPlayerRoom: document.getElementById('viewPlayerRoom'),
    viewGodDashboard: document.getElementById('viewGodDashboard'),

    // Join View
    runningGamesCountBadge: document.getElementById('runningGamesCountBadge'),
    playerJoinForm: document.getElementById('playerJoinForm'),
    joinGameCodeInput: document.getElementById('joinGameCodeInput'),
    cachedCodeHint: document.getElementById('cachedCodeHint'),
    deviceIpHint: document.getElementById('deviceIpHint'),
    comboToggleBtn: document.getElementById('comboToggleBtn'),
    gameCodeDropdown: document.getElementById('gameCodeDropdown'),
    joinPlayerNameInput: document.getElementById('joinPlayerNameInput'),
    refreshGamesBtn: document.getElementById('refreshGamesBtn'),
    runningGamesQuickList: document.getElementById('runningGamesQuickList'),

    // Create View
    createWakeLockBar: document.getElementById('createWakeLockBar'),
    createWakeLockState: document.getElementById('createWakeLockState'),
    createGameForm: document.getElementById('createGameForm'),
    createGameCodeInput: document.getElementById('createGameCodeInput'),
    regenCodeBtn: document.getElementById('regenCodeBtn'),
    createInviteUrlDisplay: document.getElementById('createInviteUrlDisplay'),
    copyCreateInviteUrlBtn: document.getElementById('copyCreateInviteUrlBtn'),
    shareCreateInviteUrlBtn: document.getElementById('shareCreateInviteUrlBtn'),
    createPasscodeInput: document.getElementById('createPasscodeInput'),
    createAllowJoinToggle: document.getElementById('createAllowJoinToggle'),
    totalPlayersCalcBadge: document.getElementById('totalPlayersCalcBadge'),
    modeCountsBtn: document.getElementById('modeCountsBtn'),
    modePctBtn: document.getElementById('modePctBtn'),
    countsConfigBox: document.getElementById('countsConfigBox'),
    pctConfigBox: document.getElementById('pctConfigBox'),
    countMafia: document.getElementById('countMafia'),
    countDetective: document.getElementById('countDetective'),
    countDoctor: document.getElementById('countDoctor'),
    countVillager: document.getElementById('countVillager'),
    pctMafia: document.getElementById('pctMafia'),
    pctDetective: document.getElementById('pctDetective'),
    pctDoctor: document.getElementById('pctDoctor'),
    pctVillager: document.getElementById('pctVillager'),
    autofillPrevPlayersBtn: document.getElementById('autofillPrevPlayersBtn'),
    createPlayerNamesInput: document.getElementById('createPlayerNamesInput'),
    createNamesCountHint: document.getElementById('createNamesCountHint'),
    createKillSaveMode: document.getElementById('createKillSaveMode'),

    // God Login View
    godLoginForm: document.getElementById('godLoginForm'),
    godLoginCodeInput: document.getElementById('godLoginCodeInput'),
    godLoginPasscodeInput: document.getElementById('godLoginPasscodeInput'),

    // Player Room View
    playerRoomCode: document.getElementById('playerRoomCode'),
    playerRoomStatusBadge: document.getElementById('playerRoomStatusBadge'),
    playerRefreshBtn: document.getElementById('playerRefreshBtn'),
    playerLeaveBtn: document.getElementById('playerLeaveBtn'),
    playerRoomMyName: document.getElementById('playerRoomMyName'),
    playerRoomPhase: document.getElementById('playerRoomPhase'),
    playerAnnouncementText: document.getElementById('playerAnnouncementText'),
    playerRoleContainer: document.getElementById('playerRoleContainer'),
    playerRoomRosterCount: document.getElementById('playerRoomRosterCount'),
    playerRoomRosterList: document.getElementById('playerRoomRosterList'),

    // God Dashboard View
    godRoundBadge: document.getElementById('godRoundBadge'),
    godHotspotUrlDisplay: document.getElementById('godHotspotUrlDisplay'),
    godBannerCode: document.getElementById('godBannerCode'),
    godJoinUrlDisplay: document.getElementById('godJoinUrlDisplay'),
    copyGodJoinUrlBtn: document.getElementById('copyGodJoinUrlBtn'),
    shareGodJoinUrlBtn: document.getElementById('shareGodJoinUrlBtn'),
    godWakeLockBar: document.getElementById('godWakeLockBar'),
    godWakeLockText: document.getElementById('godWakeLockText'),
    godToggleWakeLockBtn: document.getElementById('godToggleWakeLockBtn'),
    godStatusBadge: document.getElementById('godStatusBadge'),
    godExitBtn: document.getElementById('godExitBtn'),
    godPhaseSubtitle: document.getElementById('godPhaseSubtitle'),
    godBeginRandomizeBtn: document.getElementById('godBeginRandomizeBtn'),
    godStartGameBtn: document.getElementById('godStartGameBtn'),
    godUnlockRolesBtn: document.getElementById('godUnlockRolesBtn'),
    godNewRoundBtn: document.getElementById('godNewRoundBtn'),
    godAllocModeLabel: document.getElementById('godAllocModeLabel'),
    godToggleAllocModeBtn: document.getElementById('godToggleAllocModeBtn'),
    godCountsRow: document.getElementById('godCountsRow'),
    godPctRow: document.getElementById('godPctRow'),
    godCountMafia: document.getElementById('godCountMafia'),
    godCountDetective: document.getElementById('godCountDetective'),
    godCountDoctor: document.getElementById('godCountDoctor'),
    godCountVillager: document.getElementById('godCountVillager'),
    godPctMafia: document.getElementById('godPctMafia'),
    godPctDetective: document.getElementById('godPctDetective'),
    godPctDoctor: document.getElementById('godPctDoctor'),
    godPctVillager: document.getElementById('godPctVillager'),
    godSaveSetupBtn: document.getElementById('godSaveSetupBtn'),
    godPlayerCountBadge: document.getElementById('godPlayerCountBadge'),
    godAddPlayerInput: document.getElementById('godAddPlayerInput'),
    godAddPlayerBtn: document.getElementById('godAddPlayerBtn'),
    godPlayersList: document.getElementById('godPlayersList'),
    godCurrentPhaseBadge: document.getElementById('godCurrentPhaseBadge'),
    godKillTargetSelect: document.getElementById('godKillTargetSelect'),
    godSaveTargetSelect: document.getElementById('godSaveTargetSelect'),
    godInvestigateTargetSelect: document.getElementById('godInvestigateTargetSelect'),
    godResolveNightBtn: document.getElementById('godResolveNightBtn'),
    godRuleKillSaveSelect: document.getElementById('godRuleKillSaveSelect'),
    godRuleAllowJoinToggle: document.getElementById('godRuleAllowJoinToggle'),
    godRuleSelfSaveToggle: document.getElementById('godRuleSelfSaveToggle'),
    godRuleRevealDeathToggle: document.getElementById('godRuleRevealDeathToggle'),
    godEndMafiaWinBtn: document.getElementById('godEndMafiaWinBtn'),
    godEndVillageWinBtn: document.getElementById('godEndVillageWinBtn'),
    godHistoryLog: document.getElementById('godHistoryLog')
  };

  // ==================== ALERT HELPER ====================
  let alertTimer = null;
  function showAlert(message, type = 'error') {
    if (alertTimer) clearTimeout(alertTimer);
    el.alertBanner.className = `banner banner-${type}`;
    el.alertText.textContent = message;
    el.alertBanner.classList.remove('hidden');
    alertTimer = setTimeout(() => {
      el.alertBanner.classList.add('hidden');
    }, 6000);
  }

  el.alertCloseBtn.addEventListener('click', () => {
    el.alertBanner.classList.add('hidden');
  });

  // ==================== LOCAL FALLBACK ENGINE ====================
  // Used if the page is opened directly without `server.py` running, and also syncs state to God's phone browser storage!
  function loadLocalDB() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.LOCAL_GAMES_DB);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveLocalDB(gamesObj) {
    try {
      localStorage.setItem(STORAGE_KEYS.LOCAL_GAMES_DB, JSON.stringify(gamesObj));
    } catch {
      // ignore storage errors
    }
  }

  function loadPrevPlayersMap() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.PREV_PLAYERS_BY_CODE);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function savePrevPlayersMap(mapObj) {
    try {
      localStorage.setItem(STORAGE_KEYS.PREV_PLAYERS_BY_CODE, JSON.stringify(mapObj));
    } catch {
      // ignore
    }
  }

  function computeRolesFromPercentagesClient(totalPlayers, pcts) {
    if (totalPlayers <= 0) return { mafia: 0, detective: 0, doctor: 0, villager: 0 };
    let m = Math.max(0, Number(pcts.mafia ?? 25));
    let d = Math.max(0, Number(pcts.detective ?? 15));
    let doc = Math.max(0, Number(pcts.doctor ?? 15));
    let v = Math.max(0, Number(pcts.villager ?? 45));
    let sum = m + d + doc + v;
    if (sum <= 0) {
      m = 25; d = 15; doc = 15; v = 45; sum = 100;
    }
    const raw = {
      mafia: (m / sum) * totalPlayers,
      detective: (d / sum) * totalPlayers,
      doctor: (doc / sum) * totalPlayers,
      villager: (v / sum) * totalPlayers
    };
    const counts = {
      mafia: Math.floor(raw.mafia),
      detective: Math.floor(raw.detective),
      doctor: Math.floor(raw.doctor),
      villager: Math.floor(raw.villager)
    };
    if (m > 0 && totalPlayers >= 2 && counts.mafia === 0) counts.mafia = 1;
    let currentSum = counts.mafia + counts.detective + counts.doctor + counts.villager;
    const order = ['mafia', 'detective', 'doctor', 'villager'].sort(
      (a, b) => (raw[b] - counts[b]) - (raw[a] - counts[a])
    );
    let idx = 0;
    while (currentSum < totalPlayers) {
      counts[order[idx % order.length]]++;
      currentSum++;
      idx++;
    }
    while (currentSum > totalPlayers) {
      for (const k of ['villager', 'doctor', 'detective', 'mafia']) {
        if (counts[k] > 0 && currentSum > totalPlayers) {
          counts[k]--;
          currentSum--;
        }
      }
    }
    return counts;
  }

  function buildPublicGameViewLocal(g, playerName) {
    const status = g.status || 'LOBBY';
    const norm = (playerName || '').trim().toLowerCase();
    const myPlayer = norm
      ? (g.players || []).find((p) => p.name.trim().toLowerCase() === norm)
      : null;

    let myRole = null;
    let roleHiddenReason = null;
    if (myPlayer) {
      if (status === 'ROLES_ASSIGNED') {
        myRole = myPlayer.role;
      } else if (status === 'STARTED') {
        myRole = myPlayer.role;
        roleHiddenReason = 'HOLD_TO_VIEW';
      } else if (status === 'ENDED' && g.rules?.revealRolesOnEnd !== false) {
        myRole = myPlayer.role;
      }
    }

    return {
      gameCode: g.gameCode,
      status,
      roundNumber: g.roundNumber || 1,
      phase: g.phase || 'Lobby',
      allowJoin: g.allowJoin !== false,
      allocationMode: g.allocationMode || 'counts',
      expectedTotal: g.expectedTotal || 0,
      rules: g.rules || {},
      announcement: g.announcement || '',
      players: (g.players || []).map((p) => {
        const item = {
          name: p.name,
          alive: p.alive !== false,
          claimed: !!p.claimed,
          savedLastNight: !!p.savedLastNight,
          killedLastNight: !!p.killedLastNight
        };
        if ((!item.alive && g.rules?.revealRoleOnDeath) || status === 'ENDED') {
          item.revealedRole = p.role;
        }
        return item;
      }),
      myPlayer: myPlayer
        ? {
            name: myPlayer.name,
            alive: myPlayer.alive !== false,
            role: myRole,
            roleHiddenReason
          }
        : null
    };
  }

  function handleLocalAction(msg) {
    const db = loadLocalDB();
    const prevMap = loadPrevPlayersMap();
    const action = msg.action;

    const syncLocalState = (gameCode) => {
      const myToken = getOrCreateDeviceToken();
      const myIp = state.serverInfo?.clientIp || '127.0.0.1';
      const gamesList = Object.values(db)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .map((g) => {
          const boundP = (g.players || []).find(
            (p) => (p.ip && p.ip === myIp) || (p.token && p.token === myToken)
          );
          return {
            gameCode: g.gameCode,
            status: g.status,
            allowJoin: g.allowJoin,
            playerCount: (g.players || []).length,
            expectedTotal: g.expectedTotal || 0,
            allocationMode: g.allocationMode || 'counts',
            createdAt: g.createdAt || 0,
            roundNumber: g.roundNumber || 1,
            previousPlayers: prevMap[g.gameCode] || [],
            myBoundPlayer: boundP ? boundP.name : null
          };
        });

      handleServerPayload({
        type: 'GAMES_LIST',
        games: gamesList,
        previousPlayersByCode: prevMap
      });

      if (gameCode && db[gameCode]) {
        const g = db[gameCode];
        if (state.currentPlayerGame && state.currentPlayerGame.gameCode === gameCode) {
          const myName = state.currentPlayerGame.myPlayer?.name;
          handleServerPayload({
            type: 'GAME_STATE',
            game: buildPublicGameViewLocal(g, myName)
          });
        }
        if (
          state.godCredentials.gameCode === gameCode &&
          String(state.godCredentials.passcode) === String(g.passcode)
        ) {
          handleServerPayload({
            type: 'GOD_STATE',
            game: { ...g, previousPlayers: prevMap[gameCode] || [] }
          });
        }
      }

      if (state.broadcastChannel) {
        state.broadcastChannel.postMessage({ type: 'LOCAL_SYNC', gameCode });
      }
    };

    if (action === 'INIT') {
      syncLocalState(null);
      return;
    }

    if (action === 'GENERATE_CODE') {
      handleServerPayload({
        type: 'GENERATED_CODE',
        gameCode: generateDockerName(Object.keys(db))
      });
      return;
    }

    if (action === 'CREATE_GAME') {
      const code = (msg.gameCode || generateDockerName(Object.keys(db)))
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '_');
      const passcode = String(msg.passcode || '').trim();
      if (!/^\d{4,8}$/.test(passcode)) {
        showAlert('Passcode must be 4 to 8 digits.');
        return;
      }
      if (db[code] && String(db[code].passcode) !== passcode) {
        showAlert(`Game code '${code}' already exists with a different passcode.`);
        return;
      }

      const seen = new Set();
      const players = [];
      for (const rawName of msg.playerNames || []) {
        const clean = String(rawName).trim();
        if (clean && !seen.has(clean.toLowerCase())) {
          seen.add(clean.toLowerCase());
          players.push({
            name: clean,
            role: null,
            alive: true,
            claimed: false,
            token: null,
            savedLastNight: false,
            killedLastNight: false
          });
        }
      }

      if (players.length > 0) {
        prevMap[code] = players.map((p) => p.name);
        savePrevPlayersMap(prevMap);
      }

      const rc = msg.roleCounts || { mafia: 1, detective: 1, doctor: 1, villager: 3 };
      const expectedTotal =
        msg.allocationMode === 'percentages'
          ? players.length
          : (rc.mafia || 0) + (rc.detective || 0) + (rc.doctor || 0) + (rc.villager || 0);

      const roundNumber = db[code] ? (db[code].roundNumber || 1) + 1 : 1;
      db[code] = {
        gameCode: code,
        passcode,
        status: 'LOBBY',
        roundNumber,
        phase: 'Lobby',
        allowJoin: msg.allowJoin !== false,
        allocationMode: msg.allocationMode || 'counts',
        roleCounts: rc,
        rolePercentages: msg.rolePercentages || { mafia: 25, detective: 15, doctor: 15, villager: 45 },
        expectedTotal,
        rules: msg.rules || {
          killSaveMode: 'announce_save',
          doctorSelfSave: true,
          revealRoleOnDeath: false,
          revealRolesOnEnd: true
        },
        players,
        announcement: 'Waiting for Game-God to confirm players and randomize roles.',
        history: [`Game '${code}' (Round ${roundNumber}) created by Game-God.`],
        createdAt: Date.now()
      };
      saveLocalDB(db);
      state.godCredentials = { gameCode: code, passcode };
      handleServerPayload({
        type: 'GAME_CREATED',
        game: { ...db[code], previousPlayers: prevMap[code] || [] }
      });
      syncLocalState(code);
      return;
    }

    if (action === 'GOD_AUTH') {
      const code = (msg.gameCode || '').trim().toLowerCase();
      const passcode = String(msg.passcode || '').trim();
      const g = db[code];
      if (!g) {
        showAlert(`Game '${code}' not found.`);
        return;
      }
      if (String(g.passcode) !== passcode) {
        showAlert('Invalid Game-God passcode.');
        return;
      }
      state.godCredentials = { gameCode: code, passcode };
      handleServerPayload({
        type: 'GOD_STATE',
        game: { ...g, previousPlayers: prevMap[code] || [] }
      });
      return;
    }

    if (action === 'JOIN_PLAYER') {
      let code = (msg.gameCode || '').trim().toLowerCase();
      if (!db[code]) {
        const norm = code.replace(/[-_]+/g, '_');
        const matchedKey = Object.keys(db).find((k) => k.toLowerCase().replace(/[-_]+/g, '_') === norm);
        if (matchedKey) code = matchedKey;
      }
      const playerName = (msg.playerName || '').trim();
      const token = msg.playerToken || getOrCreateDeviceToken();
      const clientIp = state.serverInfo?.clientIp || '127.0.0.1';
      const g = db[code];
      if (!g) {
        showAlert(`Game code '${code}' not found. Ask Game-God to create it first.`);
        return;
      }
      if (!g.deviceIps) g.deviceIps = {};

      // Enforce 1 player per IP address / device for this game code
      const boundByIp = g.players.find(
        (p) => (p.ip && p.ip === clientIp) || (p.token && p.token === token)
      );
      if (boundByIp && boundByIp.name.toLowerCase() !== playerName.toLowerCase()) {
        showAlert(
          `This device (IP: ${clientIp}) has already joined game '${code}' as '${boundByIp.name}'. Only one player per IP address is allowed in a game.`
        );
        return;
      }

      const existing = g.players.find((p) => p.name.toLowerCase() === playerName.toLowerCase());
      if (existing) {
        if (
          existing.claimed &&
          ((existing.ip && existing.ip !== clientIp) ||
            (!existing.ip && existing.token && existing.token !== token))
        ) {
          showAlert(`Player name '${playerName}' is already taken by another device in game '${code}'!`);
          return;
        }
        existing.claimed = true;
        existing.token = token;
        existing.ip = clientIp;
        g.deviceIps[clientIp] = existing.name;
      } else {
        if (!g.allowJoin) {
          showAlert(`Player '${playerName}' is not on the pre-registered list and open joining is locked.`);
          return;
        }
        g.players.push({
          name: playerName,
          role: null,
          alive: true,
          claimed: true,
          token,
          ip: clientIp,
          savedLastNight: false,
          killedLastNight: false
        });
        g.deviceIps[clientIp] = playerName;
        g.history.push(`Player '${playerName}' joined from IP ${clientIp}.`);
        prevMap[code] = g.players.map((p) => p.name);
        savePrevPlayersMap(prevMap);
      }
      saveLocalDB(db);
      handleServerPayload({
        type: 'PLAYER_JOINED',
        game: buildPublicGameViewLocal(g, existing ? existing.name : playerName)
      });
      syncLocalState(code);
      return;
    }

    if (action === 'GOD_UPDATE_SETUP') {
      const code = (msg.gameCode || '').trim().toLowerCase();
      const g = db[code];
      if (!g || String(g.passcode) !== String(msg.passcode)) {
        showAlert('Unauthorized Game-God action.');
        return;
      }
      if ('allowJoin' in msg) g.allowJoin = !!msg.allowJoin;
      if ('allocationMode' in msg) g.allocationMode = msg.allocationMode;
      if ('roleCounts' in msg) {
        g.roleCounts = msg.roleCounts;
        g.expectedTotal =
          (g.roleCounts.mafia || 0) +
          (g.roleCounts.detective || 0) +
          (g.roleCounts.doctor || 0) +
          (g.roleCounts.villager || 0);
      }
      if ('rolePercentages' in msg) g.rolePercentages = msg.rolePercentages;
      if ('rules' in msg) g.rules = { ...g.rules, ...msg.rules };
      if (msg.addPlayerName) {
        const newName = msg.addPlayerName.trim();
        if (g.players.some((p) => p.name.toLowerCase() === newName.toLowerCase())) {
          showAlert(`Player '${newName}' is already in the game.`);
          return;
        }
        g.players.push({
          name: newName,
          role: null,
          alive: true,
          claimed: false,
          token: null,
          savedLastNight: false,
          killedLastNight: false
        });
        prevMap[code] = g.players.map((p) => p.name);
        savePrevPlayersMap(prevMap);
      }
      if (msg.removePlayerName) {
        const rem = msg.removePlayerName.trim().toLowerCase();
        g.players = g.players.filter((p) => p.name.toLowerCase() !== rem);
        prevMap[code] = g.players.map((p) => p.name);
        savePrevPlayersMap(prevMap);
      }
      saveLocalDB(db);
      syncLocalState(code);
      return;
    }

    if (action === 'BEGIN_RANDOMIZATION') {
      const code = (msg.gameCode || '').trim().toLowerCase();
      const g = db[code];
      if (!g || String(g.passcode) !== String(msg.passcode)) return;
      const total = g.players.length;
      if (total === 0) {
        showAlert('Add at least 1 player before randomizing roles.');
        return;
      }
      let counts = { ...g.roleCounts };
      if (g.allocationMode === 'percentages') {
        counts = computeRolesFromPercentagesClient(total, g.rolePercentages);
        g.roleCounts = counts;
      } else {
        const special = (counts.mafia || 0) + (counts.detective || 0) + (counts.doctor || 0);
        if (special > total) {
          showAlert(`Special roles (${special}) exceed total players (${total}).`);
          return;
        }
        counts.villager = total - special;
        g.roleCounts = counts;
      }
      const pool = [
        ...Array(counts.mafia || 0).fill('Mafia'),
        ...Array(counts.detective || 0).fill('Detective'),
        ...Array(counts.doctor || 0).fill('Doctor'),
        ...Array(counts.villager || 0).fill('Villager')
      ];
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      g.players.forEach((p, idx) => {
        p.role = pool[idx] || 'Villager';
        p.alive = true;
      });
      g.status = 'ROLES_ASSIGNED';
      g.phase = 'Role Reveal (Pre-Game)';
      g.announcement = 'Roles have been assigned! Players can view or refresh their role now before the game starts.';
      g.history.push(`Roles randomized for ${total} players.`);
      prevMap[code] = g.players.map((p) => p.name);
      savePrevPlayersMap(prevMap);
      saveLocalDB(db);
      syncLocalState(code);
      return;
    }

    if (action === 'START_GAME') {
      const code = (msg.gameCode || '').trim().toLowerCase();
      const g = db[code];
      if (!g || String(g.passcode) !== String(msg.passcode)) return;
      g.status = 'STARTED';
      g.phase = 'Night 1';
      g.allowJoin = false;
      g.announcement = 'Game has started! Role display is now locked on player devices.';
      g.history.push('Game started (Night 1). Player roles are now hidden on refresh.');
      saveLocalDB(db);
      syncLocalState(code);
      return;
    }

    if (action === 'GOD_GAME_ACTION') {
      const code = (msg.gameCode || '').trim().toLowerCase();
      const g = db[code];
      if (!g || String(g.passcode) !== String(msg.passcode)) return;
      const sub = msg.subAction;

      if (sub === 'TOGGLE_ALIVE') {
        const p = g.players.find((x) => x.name.toLowerCase() === (msg.playerName || '').toLowerCase());
        if (p) {
          p.alive = !p.alive;
          g.history.push(`Game-God marked ${p.name} as ${p.alive ? 'Alive' : 'Eliminated'}.`);
        }
      } else if (sub === 'RESOLVE_NIGHT') {
        const killT = (msg.killTarget || '').trim();
        const saveT = (msg.saveTarget || '').trim();
        const invT = (msg.investigateTarget || '').trim();
        if (killT) {
          const victim = g.players.find((x) => x.name.toLowerCase() === killT.toLowerCase());
          if (victim) {
            if (saveT && saveT.toLowerCase() === victim.name.toLowerCase()) {
              g.announcement =
                g.rules?.killSaveMode === 'announce_save'
                  ? `Dawn breaks! ${victim.name} was attacked, but saved by the Doctor!`
                  : 'Dawn breaks! Nobody died last night.';
              g.history.push(`Night: Mafia targeted ${victim.name}, saved by Doctor.`);
            } else {
              victim.alive = false;
              g.announcement = `Dawn breaks! ${victim.name} was eliminated during the night.`;
              g.history.push(`Night: ${victim.name} was eliminated by Mafia.`);
            }
          }
        } else {
          g.announcement = 'Dawn breaks! A quiet night passed with no Mafia kill.';
        }
        if (invT) {
          const suspect = g.players.find((x) => x.name.toLowerCase() === invT.toLowerCase());
          if (suspect) {
            g.history.push(
              `Detective investigated ${suspect.name} -> ${suspect.role === 'Mafia' ? 'MAFIA' : 'NOT MAFIA'}.`
            );
          }
        }
        g.phase = 'Day Phase';
      } else if (sub === 'UNLOCK_ROLES') {
        g.status = 'ROLES_ASSIGNED';
        g.phase = 'Role Reveal (Pre-Game)';
        g.announcement = 'Game-God unlocked role reveal! Refresh or view your role now.';
      } else if (sub === 'END_GAME') {
        g.status = 'ENDED';
        g.phase = `Ended (${msg.winner})`;
        g.announcement = `Game Over! ${msg.winner}`;
        g.history.push(`Game ended: ${msg.winner}.`);
      } else if (sub === 'RESET_TO_LOBBY') {
        g.players.forEach((p) => {
          p.role = null;
          p.alive = true;
        });
        g.status = 'LOBBY';
        g.roundNumber = (g.roundNumber || 1) + 1;
        g.phase = 'Lobby';
        g.announcement = `Round ${g.roundNumber} Lobby open!`;
      }
      saveLocalDB(db);
      syncLocalState(code);
    }
  }

  // ==================== WEBSOCKET CLIENT ====================
  function sendAction(payload) {
    if (state.ws && state.wsConnected && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify(payload));
    } else {
      handleLocalAction(payload);
    }
  }

  function connectWebSocket() {
    if (!window.location.protocol.startsWith('http')) {
      setConnectionStatus(false);
      handleLocalAction({ action: 'INIT' });
      restoreSavedSession();
      return;
    }

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws`;

    try {
      const ws = new WebSocket(wsUrl);
      state.ws = ws;

      ws.addEventListener('open', () => {
        state.wsConnected = true;
        setConnectionStatus(true);
        sendAction({ action: 'INIT' });
        restoreSavedSession();
      });

      ws.addEventListener('message', (event) => {
        try {
          const data = JSON.parse(event.data);
          handleServerPayload(data);
        } catch {
          // ignore malformed payload
        }
      });

      ws.addEventListener('close', () => {
        state.wsConnected = false;
        setConnectionStatus(false);
        setTimeout(connectWebSocket, 3000);
      });

      ws.addEventListener('error', () => {
        state.wsConnected = false;
        setConnectionStatus(false);
      });
    } catch {
      setConnectionStatus(false);
      handleLocalAction({ action: 'INIT' });
      restoreSavedSession();
    }
  }

  function setConnectionStatus(isLiveWs) {
    if (isLiveWs) {
      el.connBadge.classList.remove('local');
      el.connText.textContent = 'Hotspot WS Live';
    } else {
      el.connBadge.classList.add('local');
      el.connText.textContent = 'Offline Local Mode';
    }
  }

  if (state.broadcastChannel) {
    state.broadcastChannel.addEventListener('message', (ev) => {
      if (ev.data?.type === 'LOCAL_SYNC' && !state.wsConnected) {
        handleLocalAction({ action: 'INIT' });
      }
    });
  }

  // ==================== SERVER MESSAGE HANDLER ====================
  function handleServerPayload(data) {
    switch (data.type) {
      case 'INIT_DATA': {
        state.runningGames = data.games || [];
        state.previousPlayersByCode = {
          ...loadPrevPlayersMap(),
          ...(data.previousPlayersByCode || {})
        };
        savePrevPlayersMap(state.previousPlayersByCode);
        if (data.serverInfo) {
          state.serverInfo = data.serverInfo;
          updateBrowserUrlBanner();
        }
        if (data.suggestedCode && !el.createGameCodeInput.value) {
          el.createGameCodeInput.value = data.suggestedCode;
        }
        renderRunningGamesUI();
        applyDefaultCachedGameCode();
        break;
      }

      case 'GAMES_LIST': {
        state.runningGames = data.games || [];
        if (data.previousPlayersByCode) {
          state.previousPlayersByCode = {
            ...state.previousPlayersByCode,
            ...data.previousPlayersByCode
          };
          savePrevPlayersMap(state.previousPlayersByCode);
        }
        renderRunningGamesUI();
        applyDefaultCachedGameCode();
        break;
      }

      case 'GENERATED_CODE': {
        el.createGameCodeInput.value = data.gameCode;
        updateCreateInvitePreview();
        checkPreviousPlayersForCode(data.gameCode);
        break;
      }

      case 'GAME_CREATED': {
        const g = data.game;
        state.currentGodGame = g;
        cacheGameCode(g.gameCode);
        saveActiveSession({
          mode: 'god',
          gameCode: g.gameCode,
          passcode: state.godCredentials.passcode
        });
        renderGodDashboard(g);
        switchView('god-dashboard');
        const inviteUrl = buildGameInviteUrl(g.gameCode);
        showAlert(`Game '${g.gameCode}' created! Share link: ${inviteUrl}`, 'success');
        break;
      }

      case 'GOD_STATE': {
        const g = data.game;
        state.currentGodGame = g;
        cacheGameCode(g.gameCode);
        saveActiveSession({
          mode: 'god',
          gameCode: g.gameCode,
          passcode: state.godCredentials.passcode
        });
        renderGodDashboard(g);
        switchView('god-dashboard');
        break;
      }

      case 'PLAYER_JOINED':
      case 'GAME_STATE': {
        const g = data.game;
        state.currentPlayerGame = g;
        cacheGameCode(g.gameCode);
        if (g.myPlayer?.name) {
          localStorage.setItem(STORAGE_KEYS.LAST_PLAYER_NAME, g.myPlayer.name);
          saveActiveSession({
            mode: 'player',
            gameCode: g.gameCode,
            playerName: g.myPlayer.name
          });
        }
        renderPlayerRoom(g);
        if (data.type === 'PLAYER_JOINED') {
          switchView('player-room');
        }
        break;
      }

      case 'ERROR': {
        showAlert(data.message || 'An error occurred.', 'error');
        break;
      }
    }
  }

  // ==================== CACHING, URL GAMECODE & SESSION RESTORE ====================
  function getGameCodeFromUrl() {
    try {
      const searchParams = new URLSearchParams(window.location.search);
      for (const [k, v] of searchParams.entries()) {
        const keyLow = k.trim().toLowerCase();
        if (
          (keyLow === 'gamecode' || keyLow === 'game_code' || keyLow === 'code' || keyLow === 'game') &&
          v &&
          v.trim()
        ) {
          return v.trim().toLowerCase();
        }
      }
      if (window.location.hash && window.location.hash.includes('?')) {
        const hashQuery = window.location.hash.slice(window.location.hash.indexOf('?'));
        const hashParams = new URLSearchParams(hashQuery);
        for (const [k, v] of hashParams.entries()) {
          const keyLow = k.trim().toLowerCase();
          if (
            (keyLow === 'gamecode' || keyLow === 'game_code' || keyLow === 'code' || keyLow === 'game') &&
            v &&
            v.trim()
          ) {
            return v.trim().toLowerCase();
          }
        }
      }
    } catch {
      // ignore URL parsing errors
    }
    return '';
  }

  function resolveMatchingGameCode(rawCode) {
    const clean = (rawCode || '').trim().toLowerCase();
    if (!clean) return '';
    const exact = state.runningGames.find((g) => g.gameCode.toLowerCase() === clean);
    if (exact) return exact.gameCode;
    const norm = clean.replace(/[-_]+/g, '_');
    const fuzzy = state.runningGames.find((g) => g.gameCode.toLowerCase().replace(/[-_]+/g, '_') === norm);
    return fuzzy ? fuzzy.gameCode : clean;
  }

  function cacheGameCode(code) {
    if (!code) return;
    localStorage.setItem(STORAGE_KEYS.LAST_GAME_CODE, code.trim().toLowerCase());
  }

  function updateBoundPlayerHint(code) {
    const clean = resolveMatchingGameCode(code);
    const g = state.runningGames.find((x) => x.gameCode.toLowerCase() === clean.toLowerCase());
    const ip = state.serverInfo?.clientIp || '127.0.0.1';
    if (g && g.myBoundPlayer) {
      el.joinPlayerNameInput.value = g.myBoundPlayer;
      if (el.deviceIpHint) {
        el.deviceIpHint.textContent = `IP ${ip} bound to "${g.myBoundPlayer}"`;
      }
    } else if (el.deviceIpHint) {
      el.deviceIpHint.textContent = `1 player per IP (${ip})`;
    }
  }

  function applyDefaultCachedGameCode() {
    const urlCode = getGameCodeFromUrl();
    const cachedCode = localStorage.getItem(STORAGE_KEYS.LAST_GAME_CODE);
    const cachedName = localStorage.getItem(STORAGE_KEYS.LAST_PLAYER_NAME);

    if (cachedName && !el.joinPlayerNameInput.value) {
      el.joinPlayerNameInput.value = cachedName;
    }

    if (urlCode) {
      const resolvedUrlCode = resolveMatchingGameCode(urlCode);
      el.joinGameCodeInput.value = resolvedUrlCode;
      el.cachedCodeHint.textContent = 'Auto-filled from shared link';
      cacheGameCode(resolvedUrlCode);
    } else if (!el.joinGameCodeInput.value) {
      if (cachedCode) {
        el.joinGameCodeInput.value = resolveMatchingGameCode(cachedCode);
        el.cachedCodeHint.textContent = 'Default: your last game code';
      } else if (state.runningGames.length > 0) {
        el.joinGameCodeInput.value = state.runningGames[0].gameCode;
        el.cachedCodeHint.textContent = 'Latest active game';
      }
    } else {
      el.joinGameCodeInput.value = resolveMatchingGameCode(el.joinGameCodeInput.value);
    }

    if (cachedCode && !el.godLoginCodeInput.value) {
      el.godLoginCodeInput.value = cachedCode;
    }

    updateBoundPlayerHint(el.joinGameCodeInput.value);
  }

  function saveActiveSession(sessionObj) {
    if (!sessionObj) {
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_SESSION);
    } else {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_SESSION, JSON.stringify(sessionObj));
    }
  }

  function restoreSavedSession() {
    try {
      const urlCode = getGameCodeFromUrl();
      const raw = localStorage.getItem(STORAGE_KEYS.ACTIVE_SESSION);
      if (!raw) return;
      const sess = JSON.parse(raw);

      // If player opened a direct ?gamecode=... invite link for a specific game,
      // only auto-restore if their saved session matches that game code!
      if (urlCode) {
        const normUrl = urlCode.replace(/[-_]+/g, '_');
        const normSess = (sess.gameCode || '').trim().toLowerCase().replace(/[-_]+/g, '_');
        if (normUrl !== normSess) {
          switchView('join');
          applyDefaultCachedGameCode();
          return;
        }
      }

      if (sess.mode === 'player' && sess.gameCode && sess.playerName) {
        sendAction({
          action: 'JOIN_PLAYER',
          gameCode: sess.gameCode,
          playerName: sess.playerName,
          playerToken: getOrCreateDeviceToken(),
          isReconnect: true
        });
      } else if (sess.mode === 'god' && sess.gameCode && sess.passcode) {
        state.godCredentials = { gameCode: sess.gameCode, passcode: sess.passcode };
        sendAction({
          action: 'GOD_AUTH',
          gameCode: sess.gameCode,
          passcode: sess.passcode
        });
      }
    } catch {
      // ignore
    }
  }

  // ==================== VIEW NAVIGATION ====================
  function switchView(viewName) {
    state.currentView = viewName;
    const allViews = [
      el.viewJoin,
      el.viewCreate,
      el.viewGodLogin,
      el.viewPlayerRoom,
      el.viewGodDashboard
    ];
    allViews.forEach((v) => v.classList.add('hidden'));

    document.querySelectorAll('.mode-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === viewName);
    });

    if (viewName === 'join') {
      el.mainNavTabs.classList.remove('hidden');
      el.viewJoin.classList.remove('hidden');
    } else if (viewName === 'create') {
      el.mainNavTabs.classList.remove('hidden');
      el.viewCreate.classList.remove('hidden');
      if (!el.createGameCodeInput.value) {
        el.createGameCodeInput.value = generateDockerName(
          state.runningGames.map((g) => g.gameCode)
        );
      }
      updateCreateInvitePreview();
      updateCreateTotalBadge();
    } else if (viewName === 'god-login') {
      el.mainNavTabs.classList.remove('hidden');
      el.viewGodLogin.classList.remove('hidden');
    } else if (viewName === 'player-room') {
      el.mainNavTabs.classList.add('hidden');
      el.viewPlayerRoom.classList.remove('hidden');
    } else if (viewName === 'god-dashboard') {
      el.mainNavTabs.classList.add('hidden');
      el.viewGodDashboard.classList.remove('hidden');
    }

    hostWakeLock.sync();
  }

  document.querySelectorAll('.mode-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      switchView(btn.dataset.tab);
    });
  });

  el.brandHomeBtn.addEventListener('click', () => {
    saveActiveSession(null);
    switchView('join');
  });

  // ==================== AUTO-TYPE + DROPDOWN COMBO FOR GAME CODES ====================
  function statusBadgeClass(status) {
    if (status === 'ROLES_ASSIGNED') return 'badge-reveal';
    if (status === 'STARTED') return 'badge-started';
    if (status === 'ENDED') return 'badge-ended';
    return 'badge-lobby';
  }

  function statusLabelText(status) {
    if (status === 'ROLES_ASSIGNED') return 'ROLE REVEAL';
    if (status === 'STARTED') return 'IN PROGRESS';
    if (status === 'ENDED') return 'ENDED';
    return 'LOBBY OPEN';
  }

  function renderGameCodeDropdown(filterText = '') {
    const query = filterText.trim().toLowerCase();
    const cachedCode = localStorage.getItem(STORAGE_KEYS.LAST_GAME_CODE);
    const matches = state.runningGames.filter((g) =>
      !query || g.gameCode.toLowerCase().includes(query)
    );

    if (matches.length === 0) {
      el.gameCodeDropdown.innerHTML = `
        <div class="combo-empty">
          ${
            state.runningGames.length === 0
              ? 'No running games yet. Ask Game-God to create a game.'
              : `No running game matching "${escapeHtml(filterText)}".`
          }
        </div>
      `;
      return;
    }

    el.gameCodeDropdown.innerHTML = matches
      .map((g) => {
        const isLast = cachedCode && g.gameCode === cachedCode;
        return `
          <div class="combo-item ${el.joinGameCodeInput.value === g.gameCode ? 'selected' : ''}" data-code="${escapeHtml(g.gameCode)}">
            <div>
              <div class="combo-code">${escapeHtml(g.gameCode)}</div>
              ${isLast ? '<div style="font-size:0.7rem;color:#fda4af;">Last played on this device</div>' : ''}
            </div>
            <div class="combo-meta">
              <span>${g.playerCount} players</span>
              <span class="badge ${statusBadgeClass(g.status)}">${statusLabelText(g.status)}</span>
            </div>
          </div>
        `;
      })
      .join('');

    el.gameCodeDropdown.querySelectorAll('.combo-item').forEach((item) => {
      item.addEventListener('click', () => {
        const selectedCode = item.dataset.code;
        el.joinGameCodeInput.value = selectedCode;
        cacheGameCode(selectedCode);
        updateBoundPlayerHint(selectedCode);
        el.gameCodeDropdown.classList.add('hidden');
      });
    });
  }

  function renderRunningGamesUI() {
    el.runningGamesCountBadge.textContent = `${state.runningGames.length} Running`;
    renderGameCodeDropdown(el.joinGameCodeInput.value);

    if (state.runningGames.length === 0) {
      el.runningGamesQuickList.innerHTML = `
        <div class="combo-empty">
          No active games yet. Game-God can tap <strong>Create (God)</strong> above to start one.
        </div>
      `;
      return;
    }

    const cachedCode = localStorage.getItem(STORAGE_KEYS.LAST_GAME_CODE);
    el.runningGamesQuickList.innerHTML = state.runningGames
      .map((g) => {
        const isCached = cachedCode && g.gameCode === cachedCode;
        return `
          <div class="player-row" style="cursor:pointer;" data-select-code="${escapeHtml(g.gameCode)}">
            <div class="player-info">
              <span class="code-input" style="color:#fff;">${escapeHtml(g.gameCode)}</span>
              <span class="badge ${statusBadgeClass(g.status)}">${statusLabelText(g.status)}</span>
              ${isCached ? '<span class="badge badge-reveal">Last Used</span>' : ''}
              ${g.myBoundPlayer ? `<span class="ip-tag">Joined as ${escapeHtml(g.myBoundPlayer)}</span>` : ''}
            </div>
            <div class="player-actions">
              <span style="font-size:0.8rem;color:var(--text-muted);">${g.playerCount} Players</span>
              <button type="button" class="btn btn-sm btn-secondary">Select</button>
            </div>
          </div>
        `;
      })
      .join('');

    el.runningGamesQuickList.querySelectorAll('[data-select-code]').forEach((row) => {
      row.addEventListener('click', () => {
        const code = row.dataset.selectCode;
        el.joinGameCodeInput.value = code;
        cacheGameCode(code);
        updateBoundPlayerHint(code);
        el.joinPlayerNameInput.focus();
      });
    });
  }

  el.joinGameCodeInput.addEventListener('input', () => {
    renderGameCodeDropdown(el.joinGameCodeInput.value);
    updateBoundPlayerHint(el.joinGameCodeInput.value);
    el.gameCodeDropdown.classList.remove('hidden');
  });

  el.joinGameCodeInput.addEventListener('focus', () => {
    renderGameCodeDropdown('');
    el.gameCodeDropdown.classList.remove('hidden');
  });

  el.comboToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    renderGameCodeDropdown('');
    el.gameCodeDropdown.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#gameCodeCombo')) {
      el.gameCodeDropdown.classList.add('hidden');
    }
  });

  el.refreshGamesBtn.addEventListener('click', () => {
    sendAction({ action: 'INIT' });
  });

  // ==================== PLAYER JOIN SUBMISSION ====================
  el.playerJoinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const gameCode = el.joinGameCodeInput.value.trim().toLowerCase();
    const playerName = el.joinPlayerNameInput.value.trim();
    if (!gameCode || !playerName) {
      showAlert('Please enter both a running game code and your player name.');
      return;
    }
    cacheGameCode(gameCode);
    localStorage.setItem(STORAGE_KEYS.LAST_PLAYER_NAME, playerName);

    sendAction({
      action: 'JOIN_PLAYER',
      gameCode,
      playerName,
      playerToken: getOrCreateDeviceToken(),
      isReconnect: false
    });
  });

  // ==================== CREATE GAME (GAME-GOD) ====================
  function parsePlayerNamesList(rawText) {
    if (!rawText) return [];
    const seen = new Set();
    const result = [];
    rawText
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((name) => {
        const low = name.toLowerCase();
        if (!seen.has(low)) {
          seen.add(low);
          result.push(name);
        }
      });
    return result;
  }

  function updateCreateTotalBadge() {
    const names = parsePlayerNamesList(el.createPlayerNamesInput.value);
    el.createNamesCountHint.textContent = `${names.length} player name(s) entered upfront.`;

    if (state.allocationMode === 'counts') {
      const m = Math.max(0, parseInt(el.countMafia.value, 10) || 0);
      const det = Math.max(0, parseInt(el.countDetective.value, 10) || 0);
      const doc = Math.max(0, parseInt(el.countDoctor.value, 10) || 0);
      const vil = Math.max(0, parseInt(el.countVillager.value, 10) || 0);
      const total = m + det + doc + vil;
      el.totalPlayersCalcBadge.textContent = `Total Players: ${total} (${m}M + ${det}Det + ${doc}Doc + ${vil}V)`;
    } else {
      const m = Math.max(0, parseFloat(el.pctMafia.value) || 0);
      const det = Math.max(0, parseFloat(el.pctDetective.value) || 0);
      const doc = Math.max(0, parseFloat(el.pctDoctor.value) || 0);
      const vil = Math.max(0, parseFloat(el.pctVillager.value) || 0);
      const sum = Math.round(m + det + doc + vil);
      el.totalPlayersCalcBadge.textContent = `Percentage Sum: ${sum}%`;
    }
  }

  [
    el.countMafia,
    el.countDetective,
    el.countDoctor,
    el.countVillager,
    el.pctMafia,
    el.pctDetective,
    el.pctDoctor,
    el.pctVillager,
    el.createPlayerNamesInput
  ].forEach((inp) => {
    inp.addEventListener('input', updateCreateTotalBadge);
  });

  el.modeCountsBtn.addEventListener('click', () => {
    state.allocationMode = 'counts';
    el.modeCountsBtn.classList.add('active');
    el.modePctBtn.classList.remove('active');
    el.countsConfigBox.classList.remove('hidden');
    el.pctConfigBox.classList.add('hidden');
    updateCreateTotalBadge();
  });

  el.modePctBtn.addEventListener('click', () => {
    state.allocationMode = 'percentages';
    el.modePctBtn.classList.add('active');
    el.modeCountsBtn.classList.remove('active');
    el.pctConfigBox.classList.remove('hidden');
    el.countsConfigBox.classList.add('hidden');
    updateCreateTotalBadge();
  });

  el.regenCodeBtn.addEventListener('click', () => {
    sendAction({ action: 'GENERATE_CODE' });
  });

  function checkPreviousPlayersForCode(code) {
    const clean = (code || '').trim().toLowerCase();
    const prev = state.previousPlayersByCode[clean];
    if (prev && prev.length > 0 && !el.createPlayerNamesInput.value.trim()) {
      el.createPlayerNamesInput.value = prev.join(', ');
      updateCreateTotalBadge();
      showAlert(`Auto-filled ${prev.length} players from previous run of '${clean}'.`, 'info');
    }
  }

  el.createGameCodeInput.addEventListener('input', () => {
    updateCreateInvitePreview();
  });

  el.createGameCodeInput.addEventListener('change', () => {
    updateCreateInvitePreview();
    checkPreviousPlayersForCode(el.createGameCodeInput.value);
  });

  el.autofillPrevPlayersBtn.addEventListener('click', () => {
    const code = el.createGameCodeInput.value.trim().toLowerCase();
    let list = state.previousPlayersByCode[code];
    if (!list || list.length === 0) {
      const lastCode = localStorage.getItem(STORAGE_KEYS.LAST_GAME_CODE);
      if (lastCode && state.previousPlayersByCode[lastCode]?.length) {
        list = state.previousPlayersByCode[lastCode];
      } else {
        const allLists = Object.values(state.previousPlayersByCode).filter((arr) => arr.length > 0);
        if (allLists.length > 0) list = allLists[allLists.length - 1];
      }
    }
    if (list && list.length > 0) {
      el.createPlayerNamesInput.value = list.join(', ');
      updateCreateTotalBadge();
      showAlert(`Auto-filled ${list.length} player names from previous run!`, 'info');
    } else {
      showAlert('No previous player roster found yet.', 'info');
    }
  });

  el.createGameForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const gameCode = el.createGameCodeInput.value.trim().toLowerCase();
    const passcode = el.createPasscodeInput.value.trim();

    if (!/^\d{4,8}$/.test(passcode)) {
      showAlert('Passcode must be 4 to 8 digits (numbers only).');
      return;
    }

    const playerNames = parsePlayerNamesList(el.createPlayerNamesInput.value);
    const roleCounts = {
      mafia: Math.max(0, parseInt(el.countMafia.value, 10) || 0),
      detective: Math.max(0, parseInt(el.countDetective.value, 10) || 0),
      doctor: Math.max(0, parseInt(el.countDoctor.value, 10) || 0),
      villager: Math.max(0, parseInt(el.countVillager.value, 10) || 0)
    };
    const rolePercentages = {
      mafia: Math.max(0, parseFloat(el.pctMafia.value) || 0),
      detective: Math.max(0, parseFloat(el.pctDetective.value) || 0),
      doctor: Math.max(0, parseFloat(el.pctDoctor.value) || 0),
      villager: Math.max(0, parseFloat(el.pctVillager.value) || 0)
    };

    state.godCredentials = { gameCode, passcode };

    sendAction({
      action: 'CREATE_GAME',
      gameCode,
      passcode,
      allowJoin: el.createAllowJoinToggle.checked,
      allocationMode: state.allocationMode,
      roleCounts,
      rolePercentages,
      playerNames,
      rules: {
        killSaveMode: el.createKillSaveMode.value,
        doctorSelfSave: true,
        revealRoleOnDeath: false,
        revealRolesOnEnd: true
      }
    });
  });

  // ==================== GOD LOGIN FORM ====================
  el.godLoginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const gameCode = el.godLoginCodeInput.value.trim().toLowerCase();
    const passcode = el.godLoginPasscodeInput.value.trim();
    if (!gameCode || !/^\d{4,8}$/.test(passcode)) {
      showAlert('Enter a valid game code and 4–8 digit passcode.');
      return;
    }
    state.godCredentials = { gameCode, passcode };
    sendAction({
      action: 'GOD_AUTH',
      gameCode,
      passcode
    });
  });

  // ==================== PLAYER ROOM VIEW ====================
  function renderPlayerRoom(g) {
    el.playerRoomCode.textContent = g.gameCode;
    el.playerRoomStatusBadge.className = `badge ${statusBadgeClass(g.status)}`;
    el.playerRoomStatusBadge.textContent = statusLabelText(g.status);
    el.playerRoomMyName.textContent = g.myPlayer ? g.myPlayer.name : 'Spectator';
    el.playerRoomPhase.textContent = g.phase || 'Lobby';
    el.playerAnnouncementText.textContent = g.announcement || 'Connected to game.';

    // Role card logic per requirements:
    // - Lobby: waiting for randomization
    // - ROLES_ASSIGNED (game has not started yet): player CAN see their role even on refresh
    // - STARTED (game has started): player CANNOT see their role on refresh
    const my = g.myPlayer;
    if (!my) {
      el.playerRoleContainer.innerHTML = `
        <div class="role-reveal-card">
          <div class="badge badge-lobby">Not Joined</div>
          <div class="role-big-title">Spectating</div>
          <p class="role-description">You are not registered as a player in this game.</p>
        </div>
      `;
    } else if (g.status === 'LOBBY') {
      el.playerRoleContainer.innerHTML = `
        <div class="role-reveal-card">
          <div class="badge badge-lobby">Waiting for Randomization</div>
          <div class="role-big-title" style="font-size:1.35rem;">Role Not Assigned Yet</div>
          <p class="role-description">
            You are in the lobby! Once Game-God clicks <strong>"Begin Randomization"</strong>, your role will appear here (or tap Refresh).
          </p>
        </div>
      `;
    } else if (g.status === 'ROLES_ASSIGNED' && my.role) {
      const desc = ROLE_DESCRIPTIONS[my.role] || '';
      el.playerRoleContainer.innerHTML = `
        <div class="role-reveal-card role-${escapeHtml(my.role)}" id="secretRoleCard">
          <div class="badge badge-reveal">Your Secret Role (Pre-Game)</div>
          <div class="role-big-title">${escapeHtml(my.role)}</div>
          <p class="role-description">${escapeHtml(desc)}</p>
          <div style="margin-top:14px;font-size:0.76rem;color:var(--text-muted);">
            Once Game-God starts the game, your screen will conceal your role (click &amp; hold to peek).
          </div>
        </div>
      `;
    } else if (g.status === 'STARTED') {
      const desc = ROLE_DESCRIPTIONS[my.role] || '';
      el.playerRoleContainer.innerHTML = `
        <div class="role-reveal-card" id="startedRoleCard">
          <div id="startedConcealedView">
            <div class="badge badge-started">&#x1F512; Game In Progress</div>
            <div class="role-big-title" style="font-size:1.35rem;">Role Hidden</div>
            <p class="role-description">
              Your role is concealed for secrecy during gameplay.
              Status: <strong>${my.alive ? 'ALIVE' : 'ELIMINATED'}</strong>
            </p>
          </div>
          <div id="startedRevealedView" class="hidden">
            <div class="badge badge-reveal">Peeking Secret Role</div>
            <div class="role-big-title" id="startedRoleTitle">${escapeHtml(my.role || 'Assigned')}</div>
            <p class="role-description">${escapeHtml(desc)}</p>
          </div>
          ${
            my.role
              ? `<button type="button" class="hold-peek-btn" id="holdToViewRoleBtn">
                  &#x1F441; Click &amp; Hold to View Role
                </button>`
              : ''
          }
        </div>
      `;

      const holdBtn = document.getElementById('holdToViewRoleBtn');
      const cardEl = document.getElementById('startedRoleCard');
      const concealedEl = document.getElementById('startedConcealedView');
      const revealedEl = document.getElementById('startedRevealedView');

      if (holdBtn && cardEl && concealedEl && revealedEl) {
        const showRoleWhileHeld = (ev) => {
          if (ev && ev.type === 'mousedown' && ev.button !== 0) return;
          holdBtn.classList.add('holding');
          holdBtn.innerHTML = '&#x1F441; Release to Hide Role';
          concealedEl.classList.add('hidden');
          revealedEl.classList.remove('hidden');
          if (my.role) {
            cardEl.classList.add(`role-${my.role}`);
          }
        };

        const hideRoleOnRelease = () => {
          holdBtn.classList.remove('holding');
          holdBtn.innerHTML = '&#x1F441; Click &amp; Hold to View Role';
          revealedEl.classList.add('hidden');
          concealedEl.classList.remove('hidden');
          if (my.role) {
            cardEl.classList.remove(`role-${my.role}`);
          }
        };

        holdBtn.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          showRoleWhileHeld(e);
        });
        holdBtn.addEventListener('mousedown', showRoleWhileHeld);
        holdBtn.addEventListener(
          'touchstart',
          (e) => {
            e.preventDefault();
            showRoleWhileHeld(e);
          },
          { passive: false }
        );

        ['pointerup', 'pointerleave', 'pointercancel', 'mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach(
          (evt) => {
            holdBtn.addEventListener(evt, hideRoleOnRelease);
          }
        );
        holdBtn.addEventListener('contextmenu', (e) => e.preventDefault());
        window.addEventListener('blur', hideRoleOnRelease, { once: false });
      }
    } else if (g.status === 'ENDED') {
      el.playerRoleContainer.innerHTML = `
        <div class="role-reveal-card ${my.role ? 'role-' + escapeHtml(my.role) : ''}">
          <div class="badge badge-ended">Game Over</div>
          <div class="role-big-title">${escapeHtml(my.role || 'Ended')}</div>
          <p class="role-description">${escapeHtml(g.announcement || 'The game has concluded.')}</p>
        </div>
      `;
    }

    // Render public player list (without exposing secret roles!)
    const players = g.players || [];
    el.playerRoomRosterCount.textContent = `${players.length} Players`;
    el.playerRoomRosterList.innerHTML = players
      .map((p) => {
        const isMe = my && p.name.toLowerCase() === my.name.toLowerCase();
        return `
          <div class="player-row ${p.alive ? '' : 'dead'}">
            <div class="player-info">
              <span class="player-name">${escapeHtml(p.name)} ${isMe ? '(You)' : ''}</span>
              ${p.revealedRole ? `<span class="role-pill ${escapeHtml(p.revealedRole)}">${escapeHtml(p.revealedRole)}</span>` : ''}
            </div>
            <div class="player-actions">
              <span class="badge ${p.alive ? 'badge-reveal' : 'badge-started'}">
                ${p.alive ? 'Alive' : 'Eliminated'}
              </span>
            </div>
          </div>
        `;
      })
      .join('');
  }

  el.playerRefreshBtn.addEventListener('click', () => {
    if (state.currentPlayerGame && state.currentPlayerGame.myPlayer) {
      sendAction({
        action: 'JOIN_PLAYER',
        gameCode: state.currentPlayerGame.gameCode,
        playerName: state.currentPlayerGame.myPlayer.name,
        playerToken: getOrCreateDeviceToken(),
        isReconnect: true
      });
    } else {
      sendAction({ action: 'INIT' });
    }
  });

  el.playerLeaveBtn.addEventListener('click', () => {
    saveActiveSession(null);
    switchView('join');
  });

  // ==================== GAME-GOD DASHBOARD & SHAREABLE URLS ====================
  function getPrimaryBrowserUrl() {
    const rawIps = state.serverInfo?.ips || [];
    const nonLoopback = rawIps.filter((ip) => ip && ip !== '127.0.0.1' && ip !== 'localhost');
    const host =
      nonLoopback[0] ||
      (window.location.hostname && window.location.hostname !== '127.0.0.1' && window.location.hostname !== 'localhost'
        ? window.location.hostname
        : '192.168.43.1');
    const port = state.serverInfo?.port || window.location.port || '8080';
    return `http://${host}:${port}`;
  }

  function buildGameInviteUrl(gameCode) {
    const base = getPrimaryBrowserUrl();
    const clean = (gameCode || '').trim().toLowerCase();
    if (!clean) return base;
    return `${base}/?gamecode=${encodeURIComponent(clean)}`;
  }

  function copyTextToClipboard(text, successMsg) {
    if (window.AndroidBridge && typeof window.AndroidBridge.copyText === 'function') {
      window.AndroidBridge.copyText(text);
      showAlert(successMsg || `Copied: ${text}`, 'success');
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => showAlert(successMsg || `Copied: ${text}`, 'success'))
        .catch(() => fallbackCopyText(text, successMsg));
    } else {
      fallbackCopyText(text, successMsg);
    }
  }

  function fallbackCopyText(text, successMsg) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showAlert(successMsg || `Copied: ${text}`, 'success');
    } catch {
      showAlert(`Share this URL: ${text}`, 'info');
    }
  }

  function shareGameInviteUrl(gameCode) {
    const url = buildGameInviteUrl(gameCode);
    const clean = (gameCode || '').trim().toLowerCase();
    if (window.AndroidBridge && typeof window.AndroidBridge.shareUrl === 'function') {
      window.AndroidBridge.shareUrl(url, clean);
      return;
    }
    if (navigator.share) {
      navigator
        .share({
          title: `Join Mafia Game (${clean})`,
          text: `Join our Mafia game '${clean}'! Open this link in your browser:`,
          url
        })
        .catch(() => {});
      return;
    }
    copyTextToClipboard(url, `Copied invite link: ${url}`);
  }

  function updateCreateInvitePreview() {
    if (!el.createInviteUrlDisplay) return;
    const code = (el.createGameCodeInput?.value || '').trim().toLowerCase();
    el.createInviteUrlDisplay.textContent = buildGameInviteUrl(code);
  }

  function updateBrowserUrlBanner() {
    const url = getPrimaryBrowserUrl();
    if (el.browserUrlText) {
      el.browserUrlText.textContent = url;
    }
    if (el.godHotspotUrlDisplay) {
      el.godHotspotUrlDisplay.textContent = url;
    }
    updateCreateInvitePreview();
    if (state.currentGodGame && el.godJoinUrlDisplay) {
      el.godJoinUrlDisplay.textContent = buildGameInviteUrl(state.currentGodGame.gameCode);
    }
  }

  if (el.copyBrowserUrlBtn) {
    el.copyBrowserUrlBtn.addEventListener('click', () => {
      const url = getPrimaryBrowserUrl();
      copyTextToClipboard(url, `Copied browser URL: ${url}`);
    });
  }

  if (el.copyCreateInviteUrlBtn) {
    el.copyCreateInviteUrlBtn.addEventListener('click', () => {
      const url = buildGameInviteUrl(el.createGameCodeInput.value);
      copyTextToClipboard(url, `Copied join URL: ${url}`);
    });
  }

  if (el.shareCreateInviteUrlBtn) {
    el.shareCreateInviteUrlBtn.addEventListener('click', () => {
      shareGameInviteUrl(el.createGameCodeInput.value);
    });
  }

  if (el.copyGodJoinUrlBtn) {
    el.copyGodJoinUrlBtn.addEventListener('click', () => {
      const code = state.currentGodGame?.gameCode || el.godBannerCode.textContent;
      const url = buildGameInviteUrl(code);
      copyTextToClipboard(url, `Copied join URL: ${url}`);
    });
  }

  if (el.shareGodJoinUrlBtn) {
    el.shareGodJoinUrlBtn.addEventListener('click', () => {
      const code = state.currentGodGame?.gameCode || el.godBannerCode.textContent;
      shareGameInviteUrl(code);
    });
  }

  function renderGodDashboard(g) {
    const url = getPrimaryBrowserUrl();
    const joinUrl = buildGameInviteUrl(g.gameCode);
    el.godHotspotUrlDisplay.textContent = url;
    if (el.browserUrlText) {
      el.browserUrlText.textContent = url;
    }
    if (el.godJoinUrlDisplay) {
      el.godJoinUrlDisplay.textContent = joinUrl;
    }
    el.godBannerCode.textContent = g.gameCode;
    el.godRoundBadge.textContent = `Round ${g.roundNumber || 1}`;

    el.godStatusBadge.className = `badge ${statusBadgeClass(g.status)}`;
    el.godStatusBadge.textContent = statusLabelText(g.status);
    el.godCurrentPhaseBadge.textContent = g.phase || 'Lobby';

    if (g.status === 'LOBBY') {
      el.godPhaseSubtitle.textContent =
        'Players can join using the game code. Confirm counts/percentages and click "Begin Randomization".';
      el.godBeginRandomizeBtn.textContent = 'Begin Randomization (Assign Roles)';
      el.godStartGameBtn.classList.add('hidden');
      el.godUnlockRolesBtn.classList.add('hidden');
    } else if (g.status === 'ROLES_ASSIGNED') {
      el.godPhaseSubtitle.textContent =
        'Roles are assigned! Players can refresh and view their role now. Once everyone has seen their role, click "Start Game" to lock role visibility.';
      el.godBeginRandomizeBtn.textContent = 'Re-Randomize Roles';
      el.godStartGameBtn.classList.remove('hidden');
      el.godUnlockRolesBtn.classList.add('hidden');
    } else if (g.status === 'STARTED') {
      el.godPhaseSubtitle.textContent =
        'Game is in progress! Player screens conceal roles by default (click & hold to peek).';
      el.godBeginRandomizeBtn.textContent = 'Re-Randomize Roles';
      el.godStartGameBtn.classList.add('hidden');
      el.godUnlockRolesBtn.classList.remove('hidden');
    } else {
      el.godPhaseSubtitle.textContent = 'Game has ended. Start a New Round to play again with the same players!';
      el.godStartGameBtn.classList.add('hidden');
      el.godUnlockRolesBtn.classList.add('hidden');
    }

    hostWakeLock.sync();

    // Role Allocation UI
    const isPct = g.allocationMode === 'percentages';
    el.godAllocModeLabel.textContent = isPct ? 'By Percentage (%)' : 'Fixed Counts';
    el.godToggleAllocModeBtn.textContent = isPct ? 'Switch to Fixed Counts' : 'Switch to % Mode';
    el.godCountsRow.classList.toggle('hidden', isPct);
    el.godPctRow.classList.toggle('hidden', !isPct);

    if (g.roleCounts) {
      el.godCountMafia.value = g.roleCounts.mafia ?? 1;
      el.godCountDetective.value = g.roleCounts.detective ?? 1;
      el.godCountDoctor.value = g.roleCounts.doctor ?? 1;
      el.godCountVillager.value = g.roleCounts.villager ?? 3;
    }
    if (g.rolePercentages) {
      el.godPctMafia.value = g.rolePercentages.mafia ?? 25;
      el.godPctDetective.value = g.rolePercentages.detective ?? 15;
      el.godPctDoctor.value = g.rolePercentages.doctor ?? 15;
      el.godPctVillager.value = g.rolePercentages.villager ?? 45;
    }

    // Players list with SECRET ROLES visible ONLY to Game-God
    const players = g.players || [];
    el.godPlayerCountBadge.textContent = `${players.length} Players`;

    if (players.length === 0) {
      el.godPlayersList.innerHTML = `
        <div class="combo-empty">
          No players added yet. Players can join with code <strong>${escapeHtml(g.gameCode)}</strong> or you can add them above.
        </div>
      `;
    } else {
      el.godPlayersList.innerHTML = players
        .map((p) => `
          <div class="player-row ${p.alive ? '' : 'dead'}">
            <div class="player-info">
              <span class="player-name">${escapeHtml(p.name)}</span>
              ${
                p.role
                  ? `<span class="role-pill ${escapeHtml(p.role)}">${escapeHtml(p.role)}</span>`
                  : '<span class="badge badge-lobby">Unassigned</span>'
              }
              ${
                p.claimed
                  ? `<span style="font-size:0.72rem;color:#34d399;">&#9679; Linked${
                      p.ip ? ` (${escapeHtml(p.ip)})` : ''
                    }</span>`
                  : '<span style="font-size:0.72rem;color:var(--text-muted);">&#9675; Not Linked</span>'
              }
            </div>
            <div class="player-actions">
              <button
                type="button"
                class="btn btn-sm btn-secondary"
                data-toggle-alive="${escapeHtml(p.name)}"
              >
                ${p.alive ? 'Kill / Eliminate' : 'Revive'}
              </button>
              <button
                type="button"
                class="btn btn-sm btn-secondary"
                data-remove-player="${escapeHtml(p.name)}"
                title="Remove player"
              >
                &times;
              </button>
            </div>
          </div>
        `)
        .join('');

      el.godPlayersList.querySelectorAll('[data-toggle-alive]').forEach((btn) => {
        btn.addEventListener('click', () => {
          sendAction({
            action: 'GOD_GAME_ACTION',
            gameCode: g.gameCode,
            passcode: state.godCredentials.passcode,
            subAction: 'TOGGLE_ALIVE',
            playerName: btn.dataset.toggleAlive
          });
        });
      });

      el.godPlayersList.querySelectorAll('[data-remove-player]').forEach((btn) => {
        btn.addEventListener('click', () => {
          sendAction({
            action: 'GOD_UPDATE_SETUP',
            gameCode: g.gameCode,
            passcode: state.godCredentials.passcode,
            removePlayerName: btn.dataset.removePlayer
          });
        });
      });
    }

    // Populate Night Action Target Dropdowns (Alive Players)
    const alivePlayers = players.filter((p) => p.alive);
    const optionsHtml = alivePlayers
      .map((p) => `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)} (${escapeHtml(p.role || 'No Role')})</option>`)
      .join('');

    el.godKillTargetSelect.innerHTML = `<option value="">-- No Kill / Select Target --</option>${optionsHtml}`;
    el.godSaveTargetSelect.innerHTML = `<option value="">-- No Save / Select Target --</option>${optionsHtml}`;
    el.godInvestigateTargetSelect.innerHTML = `<option value="">-- Optional: Select Investigated Player --</option>${optionsHtml}`;

    // Rules UI
    if (g.rules) {
      el.godRuleKillSaveSelect.value = g.rules.killSaveMode || 'announce_save';
      el.godRuleSelfSaveToggle.checked = g.rules.doctorSelfSave !== false;
      el.godRuleRevealDeathToggle.checked = !!g.rules.revealRoleOnDeath;
    }
    el.godRuleAllowJoinToggle.checked = g.allowJoin !== false;

    // History Log
    const history = (g.history || []).slice().reverse();
    el.godHistoryLog.innerHTML = history
      .map((entry) => `<div class="history-item">${escapeHtml(entry)}</div>`)
      .join('');
  }

  // God Dashboard Event Listeners
  if (el.godToggleWakeLockBtn) {
    el.godToggleWakeLockBtn.addEventListener('click', () => {
      const order = ['auto', 'always', 'off'];
      const nextIdx = (order.indexOf(state.wakeLockMode) + 1) % order.length;
      state.wakeLockMode = order[nextIdx];
      hostWakeLock.sync();
      hostWakeLock.updateUI();
    });
  }

  el.godExitBtn.addEventListener('click', () => {
    saveActiveSession(null);
    switchView('join');
  });

  el.godBeginRandomizeBtn.addEventListener('click', () => {
    if (!state.currentGodGame) return;
    sendAction({
      action: 'BEGIN_RANDOMIZATION',
      gameCode: state.currentGodGame.gameCode,
      passcode: state.godCredentials.passcode,
      autoAdjustVillagers: true
    });
  });

  el.godStartGameBtn.addEventListener('click', () => {
    if (!state.currentGodGame) return;
    sendAction({
      action: 'START_GAME',
      gameCode: state.currentGodGame.gameCode,
      passcode: state.godCredentials.passcode
    });
  });

  el.godUnlockRolesBtn.addEventListener('click', () => {
    if (!state.currentGodGame) return;
    sendAction({
      action: 'GOD_GAME_ACTION',
      gameCode: state.currentGodGame.gameCode,
      passcode: state.godCredentials.passcode,
      subAction: 'UNLOCK_ROLES'
    });
  });

  el.godNewRoundBtn.addEventListener('click', () => {
    if (!state.currentGodGame) return;
    sendAction({
      action: 'GOD_GAME_ACTION',
      gameCode: state.currentGodGame.gameCode,
      passcode: state.godCredentials.passcode,
      subAction: 'RESET_TO_LOBBY'
    });
  });

  el.godToggleAllocModeBtn.addEventListener('click', () => {
    if (!state.currentGodGame) return;
    const nextMode =
      state.currentGodGame.allocationMode === 'percentages' ? 'counts' : 'percentages';
    sendAction({
      action: 'GOD_UPDATE_SETUP',
      gameCode: state.currentGodGame.gameCode,
      passcode: state.godCredentials.passcode,
      allocationMode: nextMode
    });
  });

  el.godSaveSetupBtn.addEventListener('click', () => {
    if (!state.currentGodGame) return;
    sendAction({
      action: 'GOD_UPDATE_SETUP',
      gameCode: state.currentGodGame.gameCode,
      passcode: state.godCredentials.passcode,
      roleCounts: {
        mafia: Math.max(0, parseInt(el.godCountMafia.value, 10) || 0),
        detective: Math.max(0, parseInt(el.godCountDetective.value, 10) || 0),
        doctor: Math.max(0, parseInt(el.godCountDoctor.value, 10) || 0),
        villager: Math.max(0, parseInt(el.godCountVillager.value, 10) || 0)
      },
      rolePercentages: {
        mafia: Math.max(0, parseFloat(el.godPctMafia.value) || 0),
        detective: Math.max(0, parseFloat(el.godPctDetective.value) || 0),
        doctor: Math.max(0, parseFloat(el.godPctDoctor.value) || 0),
        villager: Math.max(0, parseFloat(el.godPctVillager.value) || 0)
      }
    });
    showAlert('Role distribution updated!', 'success');
  });

  function addPlayerFromGodInput() {
    if (!state.currentGodGame) return;
    const name = el.godAddPlayerInput.value.trim();
    if (!name) return;
    sendAction({
      action: 'GOD_UPDATE_SETUP',
      gameCode: state.currentGodGame.gameCode,
      passcode: state.godCredentials.passcode,
      addPlayerName: name
    });
    el.godAddPlayerInput.value = '';
  }

  el.godAddPlayerBtn.addEventListener('click', addPlayerFromGodInput);
  el.godAddPlayerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addPlayerFromGodInput();
    }
  });

  el.godResolveNightBtn.addEventListener('click', () => {
    if (!state.currentGodGame) return;
    sendAction({
      action: 'GOD_GAME_ACTION',
      gameCode: state.currentGodGame.gameCode,
      passcode: state.godCredentials.passcode,
      subAction: 'RESOLVE_NIGHT',
      killTarget: el.godKillTargetSelect.value,
      saveTarget: el.godSaveTargetSelect.value,
      investigateTarget: el.godInvestigateTargetSelect.value
    });
  });

  function pushGodRuleUpdate() {
    if (!state.currentGodGame) return;
    sendAction({
      action: 'GOD_UPDATE_SETUP',
      gameCode: state.currentGodGame.gameCode,
      passcode: state.godCredentials.passcode,
      allowJoin: el.godRuleAllowJoinToggle.checked,
      rules: {
        killSaveMode: el.godRuleKillSaveSelect.value,
        doctorSelfSave: el.godRuleSelfSaveToggle.checked,
        revealRoleOnDeath: el.godRuleRevealDeathToggle.checked
      }
    });
  }

  el.godRuleKillSaveSelect.addEventListener('change', pushGodRuleUpdate);
  el.godRuleAllowJoinToggle.addEventListener('change', pushGodRuleUpdate);
  el.godRuleSelfSaveToggle.addEventListener('change', pushGodRuleUpdate);
  el.godRuleRevealDeathToggle.addEventListener('change', pushGodRuleUpdate);

  el.godEndMafiaWinBtn.addEventListener('click', () => {
    if (!state.currentGodGame) return;
    sendAction({
      action: 'GOD_GAME_ACTION',
      gameCode: state.currentGodGame.gameCode,
      passcode: state.godCredentials.passcode,
      subAction: 'END_GAME',
      winner: 'Mafia Wins!'
    });
  });

  el.godEndVillageWinBtn.addEventListener('click', () => {
    if (!state.currentGodGame) return;
    sendAction({
      action: 'GOD_GAME_ACTION',
      gameCode: state.currentGodGame.gameCode,
      passcode: state.godCredentials.passcode,
      subAction: 'END_GAME',
      winner: 'Villagers Win!'
    });
  });

  // ==================== UTILITIES & SERVICE WORKER ====================
  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

  // Initialize default generated code & connect
  el.createGameCodeInput.value = generateDockerName();
  updateBrowserUrlBanner();
  applyDefaultCachedGameCode();
  connectWebSocket();
})();
