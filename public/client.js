/**
 * REBOUND - High-Performance 2D Isometric (30°) Client, Renderer & Netcode
 * - Client-Side Prediction (CSP) + Server Reconciliation
 * - 45ms Entity Interpolation Buffer for Remote Entities
 * - Binary ArrayBuffer WebSocket Protocol (68-byte snapshots, 4-byte inputs)
 * - 30° Isometric Vector Renderer with Z-Axis Ground Shadow Readability
 */
(function () {
  'use strict';

  const Physics = window.ReboundPhysics;
  const Audio = window.ReboundAudio;
  const { CONFIG, INPUT, STATE, MATCH_PHASE } = Physics;

  // Isometric 30° Tilt Constants (GDD Section 2)
  const ISO_TILT_DEG = 30;
  const ISO_COS = Math.cos((ISO_TILT_DEG * Math.PI) / 180); // ~0.866025
  const ISO_SIN = Math.sin((ISO_TILT_DEG * Math.PI) / 180); // 0.5

  // DOM References
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d', { alpha: false });

  const hudLayer = document.getElementById('hudLayer');
  const lobbyOverlay = document.getElementById('lobbyOverlay');
  const mainLobbyView = document.getElementById('mainLobbyView');
  const roomStagingView = document.getElementById('roomStagingView');

  const scoreOrangeEl = document.getElementById('scoreOrange');
  const scoreBlueEl = document.getElementById('scoreBlue');
  const matchClockEl = document.getElementById('matchClock');
  const matchPhaseBadgeEl = document.getElementById('matchPhaseBadge');
  const overtimeBoostBadgeEl = document.getElementById('overtimeBoostBadge');

  const netModeBadgeEl = document.getElementById('netModeBadge');
  const pingStatEl = document.getElementById('pingStat');
  const fpsStatEl = document.getElementById('fpsStat');

  const centerBannerEl = document.getElementById('centerBanner');
  const bannerTitleEl = document.getElementById('bannerTitle');
  const bannerSubEl = document.getElementById('bannerSub');

  // Contextual HUD Elements
  const contextModeHeader = document.getElementById('contextModeHeader');
  const contextModeTitle = document.getElementById('contextModeTitle');
  const contextPassiveInfo = document.getElementById('contextPassiveInfo');
  const lblWasdTitle = document.getElementById('lblWasdTitle');
  const lblWasdSub = document.getElementById('lblWasdSub');
  const lblJTitle = document.getElementById('lblJTitle');
  const lblJSub = document.getElementById('lblJSub');
  const lblKTitle = document.getElementById('lblKTitle');
  const lblKSub = document.getElementById('lblKSub');
  const lblLTitle = document.getElementById('lblLTitle');
  const lblLSub = document.getElementById('lblLSub');
  const cardKeyJ = document.getElementById('cardKeyJ');
  const cardKeyK = document.getElementById('cardKeyK');
  const cardKeyL = document.getElementById('cardKeyL');

  // Lobby Elements
  const playerNameInput = document.getElementById('playerNameInput');
  const roomCodeInput = document.getElementById('roomCodeInput');
  const roomListContainer = document.getElementById('roomListContainer');
  const stagingRoomCode = document.getElementById('stagingRoomCode');
  const stagingShareUrl = document.getElementById('stagingShareUrl');
  const slotsOrange = document.getElementById('slotsOrange');
  const slotsBlue = document.getElementById('slotsBlue');
  const chkFillBots = document.getElementById('chkFillBots');

  // Client Runtime State
  let gameMode = 'lobby'; // 'lobby' | 'online' | 'sandbox'
  let ws = null;
  let mySlotIndex = 2;    // Default to Orange FWD (Slot 2)
  let currentRoomCode = null;
  let currentRoomState = null;

  // Deterministic World State (used for Sandbox & Client-Side Prediction)
  let world = Physics.createWorldState();

  // Client-Side Prediction & Interpolation Buffers (GDD Section 7)
  const INTERP_DELAY_MS = 45; // 40-50ms interpolation buffer
  let inputSeq = 0;
  let pendingInputs = [];     // [{ seq, inputMask }]
  let snapshotBuffer = [];    // [{ timestamp, snap }]
  let renderErrorX = 0;       // Smooth visual reconciliation offset
  let renderErrorY = 0;

  // Live Keyboard Input State (WASD + J, K, L)
  const keysDown = {
    w: false,
    a: false,
    s: false,
    d: false,
    j: false,
    k: false,
    l: false
  };

  // Visual Effects (Particles, Wall Ripples, Ball Trail)
  const particles = [];
  const wallRipples = [];
  const ballTrail = [];
  let bannerTimeout = null;
  let screenShake = 0;

  // Telemetry counters
  let pingMs = 0;
  let frameCount = 0;
  let lastFpsUpdate = performance.now();
  let currentFps = 60;

  // ===========================================================================
  // VIEWPORT & 30° ISOMETRIC PROJECTION MATH
  // ===========================================================================
  let viewScale = 1;
  let viewOffsetX = 0;
  let viewOffsetY = 0;

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const padX = 130;
    const padY = 175;
    const availW = window.innerWidth - padX;
    const availH = window.innerHeight - padY;

    const isoArenaH = CONFIG.ARENA_H * ISO_COS;
    viewScale = Math.min(availW / CONFIG.ARENA_W, availH / isoArenaH);
    viewOffsetX = (window.innerWidth - CONFIG.ARENA_W * viewScale) * 0.5;
    viewOffsetY = (window.innerHeight - isoArenaH * viewScale) * 0.5 + 6;
  }

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  /**
   * Project logical arena coordinates (x, y, z) to 2D Isometric 30° screen coordinates.
   * Slight perspective trapezoid gives authentic Sensible Soccer / Neo-Arcade depth.
   */
  function toIsoScreen(x, y, z = 0) {
    const normY = (y - CONFIG.ARENA_H * 0.5) / CONFIG.ARENA_H; // -0.5 .. +0.5
    const perspectiveSpread = 1 + normY * 0.09; // Subtle wider bottom, narrower top
    const centeredX = x - CONFIG.ARENA_W * 0.5;

    const sx = window.innerWidth * 0.5 + centeredX * perspectiveSpread * viewScale;
    const sy = viewOffsetY + y * ISO_COS * viewScale - z * ISO_COS * viewScale;
    return { x: sx, y: sy, scale: perspectiveSpread * viewScale };
  }

  // ===========================================================================
  // KEYBOARD INPUT HANDLING (WASD + J, K, L)
  // ===========================================================================
  window.addEventListener('keydown', (e) => {
    if (document.activeElement && document.activeElement.tagName === 'INPUT') {
      if (e.key === 'Enter' && document.activeElement === roomCodeInput) {
        document.getElementById('btnJoinByCode').click();
      }
      return;
    }

    const code = e.code;
    if (code === 'KeyW' || code === 'ArrowUp') keysDown.w = true;
    if (code === 'KeyS' || code === 'ArrowDown') keysDown.s = true;
    if (code === 'KeyA' || code === 'ArrowLeft') keysDown.a = true;
    if (code === 'KeyD' || code === 'ArrowRight') keysDown.d = true;
    if (code === 'KeyJ') keysDown.j = true;
    if (code === 'KeyK') keysDown.k = true;
    if (code === 'KeyL') keysDown.l = true;

    // Quick Role Switching with TAB or 1..6 in Sandbox / Singleplayer
    if (code === 'Tab' && (gameMode === 'sandbox' || gameMode === 'online')) {
      e.preventDefault();
      cycleControlledRole();
    }
    if (gameMode === 'sandbox' && code.startsWith('Digit')) {
      const num = parseInt(code.replace('Digit', ''), 10);
      if (num >= 1 && num <= 6) {
        switchSandboxSlot(num - 1);
      }
    }
    if (code === 'Escape' && gameMode !== 'lobby') {
      returnToLobby();
    }
  });

  window.addEventListener('keyup', (e) => {
    const code = e.code;
    if (code === 'KeyW' || code === 'ArrowUp') keysDown.w = false;
    if (code === 'KeyS' || code === 'ArrowDown') keysDown.s = false;
    if (code === 'KeyA' || code === 'ArrowLeft') keysDown.a = false;
    if (code === 'KeyD' || code === 'ArrowRight') keysDown.d = false;
    if (code === 'KeyJ') keysDown.j = false;
    if (code === 'KeyK') keysDown.k = false;
    if (code === 'KeyL') keysDown.l = false;
  });

  window.addEventListener('blur', () => {
    keysDown.w = keysDown.a = keysDown.s = keysDown.d = false;
    keysDown.j = keysDown.k = keysDown.l = false;
  });

  function buildInputMask() {
    let mask = 0;
    if (keysDown.w) mask |= INPUT.UP;
    if (keysDown.s) mask |= INPUT.DOWN;
    if (keysDown.a) mask |= INPUT.LEFT;
    if (keysDown.d) mask |= INPUT.RIGHT;
    if (keysDown.j) mask |= INPUT.J;
    if (keysDown.k) mask |= INPUT.K;
    if (keysDown.l) mask |= INPUT.L;
    return mask;
  }

  function switchSandboxSlot(newSlot) {
    if (newSlot < 0 || newSlot >= 6) return;
    world.players.forEach((p, idx) => {
      p.isBot = idx !== newSlot;
    });
    mySlotIndex = newSlot;
    world.players[mySlotIndex].name = getPlayerName();
  }

  function cycleControlledRole() {
    if (gameMode === 'sandbox') {
      const next = (mySlotIndex + 1) % 3; // Cycle GK -> MID -> FWD on Orange team
      switchSandboxSlot(next);
      showBanner(`ROL: ${world.players[next].role}`, 'Kontrol edilen pozisyon değiştirildi', 900);
    }
  }

  // ===========================================================================
  // WEBSOCKET CONNECTION & AUTHORITATIVE NETCODE (GDD Section 6 & 7)
  // ===========================================================================
  function connectWebSocket() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}`);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      // Check if URL has a Link & Play room path (/room/ANK-4091 or ?room=ANK-4091)
      const pathParts = location.pathname.split('/');
      const urlParams = new URLSearchParams(location.search);
      const roomFromUrl = (pathParts[1] === 'room' && pathParts[2]) ? pathParts[2] : urlParams.get('room');

      if (roomFromUrl) {
        roomCodeInput.value = roomFromUrl.toUpperCase();
        ws.send(JSON.stringify({
          type: 'join_room',
          name: getPlayerName(),
          code: roomFromUrl.toUpperCase()
        }));
      } else {
        ws.send(JSON.stringify({ type: 'get_lobbies' }));
      }
    };

    ws.onmessage = (event) => {
      // 1) Binary ArrayBuffer Snapshot (68 bytes at 30Hz)
      if (event.data instanceof ArrayBuffer) {
        const snap = Physics.decodeBinarySnapshot(event.data);
        if (snap) {
          onServerBinarySnapshot(snap);
        }
        return;
      }

      // 2) JSON Control / Event Packet
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (err) {
        return;
      }

      if (msg.type === 'lobby_list') {
        renderOpenRoomsList(msg.rooms || []);
      } else if (msg.type === 'joined_room') {
        mySlotIndex = msg.slotIndex;
        currentRoomCode = msg.room.code;
        currentRoomState = msg.room;
        window.history.replaceState({}, '', `/room/${currentRoomCode}`);
        if (msg.room.status === 'playing') {
          enterOnlineMatch(msg.room);
        } else {
          showRoomStaging(msg.room);
        }
      } else if (msg.type === 'slot_assigned') {
        mySlotIndex = msg.slotIndex;
      } else if (msg.type === 'room_state') {
        currentRoomState = msg;
        if (msg.status === 'lobby' && gameMode === 'online') {
          // Match finished -> Return to Room Staging Screen (GDD Section 6)
          gameMode = 'lobby';
          hudLayer.classList.add('hidden');
          lobbyOverlay.classList.remove('hidden');
          showRoomStaging(msg);
        } else if (gameMode === 'lobby' && currentRoomCode === msg.code) {
          showRoomStaging(msg);
        }
      } else if (msg.type === 'match_started') {
        enterOnlineMatch(msg.room);
      } else if (msg.type === 'game_events') {
        handleServerEvents(msg);
      } else if (msg.type === 'pong_check') {
        pingMs = Math.max(1, Math.round(performance.now() - msg.t));
        pingStatEl.textContent = `PING: ${pingMs}ms`;
      } else if (msg.type === 'error') {
        alert(msg.message);
      }
    };

    ws.onclose = () => {
      setTimeout(connectWebSocket, 2000);
    };
  }

  // Periodic Ping measurement
  setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping_check', t: performance.now() }));
    }
  }, 2000);

  /**
   * Handle 30Hz Authoritative Binary Snapshot:
   * - Server Reconciliation for Local Player
   * - Push to 45ms Interpolation Buffer for Remote Entities
   */
  function onServerBinarySnapshot(snap) {
    const now = performance.now();
    snapshotBuffer.push({ timestamp: now, snap });
    while (snapshotBuffer.length > 20) {
      snapshotBuffer.shift();
    }

    // Update authoritative match metadata
    world.phase = snap.phase;
    world.winnerTeam = snap.winnerTeam;
    world.score[0] = snap.score[0];
    world.score[1] = snap.score[1];
    world.shotSpeedMultiplier = snap.shotSpeedMultiplier;
    if (snap.phase === MATCH_PHASE.OVERTIME) {
      world.overtimeTicks = snap.clockTicks;
    } else {
      world.matchTicksRemaining = snap.clockTicks;
    }

    // CLIENT-SIDE PREDICTION & SERVER RECONCILIATION (GDD Section 7)
    const me = world.players[mySlotIndex];
    const serverMe = snap.players[mySlotIndex];
    if (!me || !serverMe) return;

    const prevPredX = me.x;
    const prevPredY = me.y;

    // Snap local player to authoritative state at ackSeq
    me.x = serverMe.x;
    me.y = serverMe.y;
    me.vx = serverMe.vx;
    me.vy = serverMe.vy;
    me.angle = serverMe.angle;
    me.state = serverMe.state;
    me.isGoalkeeper = serverMe.isGoalkeeper;
    me.chargeFrames = serverMe.chargeFrames;
    me.hasBall = serverMe.hasBall;

    // Also sync ball state before replaying unacknowledged inputs
    world.ball.x = snap.ball.x;
    world.ball.y = snap.ball.y;
    world.ball.z = snap.ball.z;
    world.ball.vx = snap.ball.vx;
    world.ball.vy = snap.ball.vy;
    world.ball.ownerId = snap.ball.ownerId;

    // Drop inputs already processed by the server (seq <= ackSeq)
    pendingInputs = pendingInputs.filter((inp) => {
      const diff = ((inp.seq - snap.ackSeq + 65536) % 65536);
      return diff > 0 && diff < 30000;
    });

    // Replay unacknowledged predicted inputs on local player
    for (let i = 0; i < pendingInputs.length; i++) {
      me.inputMask = pendingInputs[i].inputMask;
      Physics.stepPlayer(world, me);
      me.x += me.vx * Physics.DT;
      me.y += me.vy * Physics.DT;
    }

    // Smooth visual error offset if small discrepancy occurred
    const errX = prevPredX - me.x;
    const errY = prevPredY - me.y;
    if (Math.hypot(errX, errY) < 90) {
      renderErrorX = errX;
      renderErrorY = errY;
    } else {
      renderErrorX = 0;
      renderErrorY = 0;
    }
  }

  /**
   * Sample the 45ms Interpolation Buffer for Remote Players & Loose Ball (GDD Section 7)
   */
  function applyRemoteInterpolation() {
    if (snapshotBuffer.length < 2) return;

    const renderTime = performance.now() - INTERP_DELAY_MS;

    // Find surrounding snapshots [s0, s1]
    let s0 = snapshotBuffer[0];
    let s1 = snapshotBuffer[snapshotBuffer.length - 1];

    for (let i = 0; i < snapshotBuffer.length - 1; i++) {
      if (snapshotBuffer[i].timestamp <= renderTime && snapshotBuffer[i + 1].timestamp >= renderTime) {
        s0 = snapshotBuffer[i];
        s1 = snapshotBuffer[i + 1];
        break;
      }
    }

    const span = s1.timestamp - s0.timestamp;
    const t = span > 0 ? Physics.clamp((renderTime - s0.timestamp) / span, 0, 1) : 1;

    // Interpolate remote players
    for (let i = 0; i < 6; i++) {
      if (i === mySlotIndex) continue;
      const p = world.players[i];
      const p0 = s0.snap.players[i];
      const p1 = s1.snap.players[i];
      p.x = p0.x + (p1.x - p0.x) * t;
      p.y = p0.y + (p1.y - p0.y) * t;
      p.vx = p1.vx;
      p.vy = p1.vy;
      p.angle = Physics.normalizeAngle(p0.angle + Physics.angleDiff(p1.angle, p0.angle) * t);
      p.state = p1.state;
      p.isGoalkeeper = p1.isGoalkeeper;
      p.chargeFrames = p1.chargeFrames;
      p.hasBall = p1.hasBall;
    }

    // Interpolate ball if not currently held by local player
    if (world.ball.ownerId !== mySlotIndex) {
      const b0 = s0.snap.ball;
      const b1 = s1.snap.ball;
      world.ball.x = b0.x + (b1.x - b0.x) * t;
      world.ball.y = b0.y + (b1.y - b0.y) * t;
      world.ball.z = b0.z + (b1.z - b0.z) * t;
      world.ball.vx = b1.vx;
      world.ball.vy = b1.vy;
      world.ball.ownerId = b1.ownerId;
    } else {
      const me = world.players[mySlotIndex];
      world.ball.x = me.x + Math.cos(me.angle) * CONFIG.MAGNET_HOLD_OFFSET;
      world.ball.y = me.y + Math.sin(me.angle) * CONFIG.MAGNET_HOLD_OFFSET;
      world.ball.z = 0;
    }
  }

  // ===========================================================================
  // GAME EVENTS, AUDIO & VFX TRIGGERS
  // ===========================================================================
  function handleServerEvents(msg) {
    if (msg.events) {
      for (const ev of msg.events) {
        processGameEvent(ev);
      }
    }
  }

  function processGameEvent(ev) {
    Audio.play(ev.type, ev.power || 0.5);

    switch (ev.type) {
      case 'wall':
        wallRipples.push({ x: ev.x, y: ev.y, radius: 8, alpha: 1.0 });
        spawnParticles(ev.x, ev.y, 0, '#00e5ff', 7, 130);
        break;
      case 'shot':
        screenShake = Math.min(10, 4 + (ev.power || 0.5) * 7);
        spawnParticles(ev.x, ev.y, 4, '#ff9f43', 12, 220);
        break;
      case 'pass':
      case 'knock':
        spawnParticles(ev.x, ev.y, 2, '#ffffff', 6, 110);
        break;
      case 'lob':
        spawnParticles(ev.x, ev.y, 4, '#38bdf8', 10, 150);
        break;
      case 'stun':
        screenShake = 7;
        spawnParticles(ev.x, ev.y, 12, '#ffcf33', 16, 210);
        break;
      case 'gk_save':
        screenShake = 5;
        spawnParticles(ev.x, ev.y, 15, '#00e676', 14, 190);
        showBanner('KRİTİK KURTARIŞ!', 'Bölge Korumalı Kaleci Geçit Vermedi', 1100);
        break;
      case 'goal': {
        screenShake = 14;
        const teamColor = ev.team === 0 ? '#ff5500' : '#00d2ff';
        const teamTitle = ev.team === 0 ? 'TURUNCU TAKIM' : 'ELEKTRİK MAVİSİ';
        for (let i = 0; i < 45; i++) {
          spawnParticles(world.ball.x, world.ball.y, 15, i % 2 === 0 ? teamColor : '#ffcf33', 2, 340);
        }
        showBanner('GOOOOL!', `${ev.scorerName || teamTitle} AĞLARI HAVALANDIRDI!`, 2100);
        break;
      }
      case 'golden_goal_start':
        showBanner('ALTIN GOL!', 'Süre Bitti ve Skor Eşit — İlk Golü Atan Kazanır!', 2600);
        break;
      case 'overtime_boost':
        showBanner('EMNİYET KURALI AKTİF!', `Maksimum Şut Hızı %${Math.round(ev.multiplier * 100)} Seviyesine Çıktı!`, 2000);
        break;
      case 'match_end': {
        const winName = ev.winnerTeam === 0 ? 'TURUNCU TAKIM KAZANDI!' : 'MAVİ TAKIM KAZANDI!';
        showBanner('MAÇ BİTTİ!', winName, 3500);
        break;
      }
    }
  }

  function spawnParticles(x, y, z, color, count, maxSpeed) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = (0.25 + Math.random() * 0.75) * maxSpeed;
      particles.push({
        x,
        y,
        z,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        vz: (Math.random() - 0.2) * 140,
        color,
        life: 1.0,
        decay: 1.8 + Math.random() * 1.4,
        size: 2.5 + Math.random() * 3
      });
    }
  }

  function showBanner(title, sub, durationMs = 1800) {
    bannerTitleEl.textContent = title;
    bannerSubEl.textContent = sub;
    centerBannerEl.classList.remove('hidden');
    if (bannerTimeout) clearTimeout(bannerTimeout);
    bannerTimeout = setTimeout(() => {
      centerBannerEl.classList.add('hidden');
    }, durationMs);
  }

  // ===========================================================================
  // LOBBY & STAGING UI LOGIC (GDD Section 6)
  // ===========================================================================
  function getPlayerName() {
    const val = (playerNameInput.value || '').trim();
    return val || 'Kaptan';
  }

  function renderOpenRoomsList(roomsList) {
    roomListContainer.innerHTML = '';
    if (!roomsList.length) {
      roomListContainer.innerHTML = `<div class="room-item"><span class="room-item-sub">Açık oda yok. Hemen yeni bir oda kurun!</span></div>`;
      return;
    }

    roomsList.forEach((r) => {
      const row = document.createElement('div');
      row.className = 'room-item';
      const statusText = r.status === 'playing' ? `Maçta (${r.score[0]}-${r.score[1]})` : 'Lobide Bekliyor';
      row.innerHTML = `
        <div class="room-item-info">
          <span class="room-item-title">[${r.code}] ${r.name}</span>
          <span class="room-item-sub">${r.players}/6 Oyuncu • ${statusText} ${r.fillBots ? '• +AI Bot' : ''}</span>
        </div>
        <button class="btn btn-accent" data-code="${r.code}">KATIL</button>
      `;
      row.querySelector('button').addEventListener('click', () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'join_room',
            name: getPlayerName(),
            code: r.code
          }));
        }
      });
      roomListContainer.appendChild(row);
    });
  }

  function showRoomStaging(room) {
    mainLobbyView.classList.add('hidden');
    roomStagingView.classList.remove('hidden');
    stagingRoomCode.textContent = room.code;
    stagingShareUrl.value = `${location.origin}/room/${room.code}`;
    chkFillBots.checked = !!room.fillBots;

    slotsOrange.innerHTML = '';
    slotsBlue.innerHTML = '';

    room.slots.forEach((slot) => {
      const el = document.createElement('div');
      const isSelf = slot.slotIndex === mySlotIndex;
      el.className = `slot-row ${isSelf ? 'slot-self' : ''}`;
      el.innerHTML = `
        <div>
          <span class="slot-role-badge">${slot.role}</span>
          <strong style="margin-left:8px;">${slot.name}${isSelf ? ' (SEN)' : ''}</strong>
        </div>
        <span style="font-size:0.72rem;color:#94a3b8;">${slot.occupied ? 'İNSAN' : 'TIKLA SEÇ'}</span>
      `;
      if (!slot.occupied) {
        el.addEventListener('click', () => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'switch_slot', slotIndex: slot.slotIndex }));
          }
        });
      }
      if (slot.team === 0) {
        slotsOrange.appendChild(el);
      } else {
        slotsBlue.appendChild(el);
      }
    });
  }

  function enterOnlineMatch(room) {
    Audio.init();
    gameMode = 'online';
    pendingInputs = [];
    snapshotBuffer = [];
    world = Physics.createWorldState();
    if (room && room.slots) {
      room.slots.forEach((s, idx) => {
        world.players[idx].name = s.name;
        world.players[idx].isBot = s.isBot;
      });
    }
    lobbyOverlay.classList.add('hidden');
    hudLayer.classList.remove('hidden');
    netModeBadgeEl.textContent = 'CSP + AUTHORITATIVE';
    showBanner('MAÇ BAŞLIYOR!', 'WASD: Hareket | J: Pas/Şut/Pres | K: Lob/Kayma/Plonjon | L: Dürtme/Jockey', 2200);
  }

  function startSandboxMatch() {
    Audio.init();
    gameMode = 'sandbox';
    world = Physics.createWorldState();
    mySlotIndex = 2; // Start as Orange Forward
    for (let i = 0; i < 6; i++) {
      world.players[i].isBot = i !== mySlotIndex;
      if (i === mySlotIndex) {
        world.players[i].name = getPlayerName();
      }
    }
    Physics.resetPositionsForKickoff(world);
    world.phase = MATCH_PHASE.PLAYING;

    lobbyOverlay.classList.add('hidden');
    hudLayer.classList.remove('hidden');
    netModeBadgeEl.textContent = 'SANDBOX (0ms YEREL)';
    pingStatEl.textContent = 'PING: 0ms';
    showBanner('SANDBOX 3v3 AKTİF', '[TAB] veya [1-6] Tuşları İle Pozisyon (GK / MID / FWD) Değiştirebilirsiniz', 2400);
  }

  function returnToLobby() {
    if (gameMode === 'online' && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'leave_room' }));
    }
    gameMode = 'lobby';
    currentRoomCode = null;
    window.history.replaceState({}, '', '/');
    hudLayer.classList.add('hidden');
    lobbyOverlay.classList.remove('hidden');
    roomStagingView.classList.add('hidden');
    mainLobbyView.classList.remove('hidden');
  }

  // Bind Lobby Buttons
  document.getElementById('btnQuickMatch').addEventListener('click', () => {
    Audio.init();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'create_room',
        name: getPlayerName(),
        fillBots: true
      }));
      setTimeout(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'start_match' }));
        }
      }, 120);
    } else {
      startSandboxMatch();
    }
  });

  document.getElementById('btnCreateRoom').addEventListener('click', () => {
    Audio.init();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'create_room',
        name: getPlayerName(),
        fillBots: true
      }));
    }
  });

  document.getElementById('btnSandboxMode').addEventListener('click', () => {
    startSandboxMatch();
  });

  document.getElementById('btnJoinByCode').addEventListener('click', () => {
    const code = roomCodeInput.value.trim().toUpperCase();
    if (!code) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'join_room',
        name: getPlayerName(),
        code
      }));
    }
  });

  document.getElementById('btnRefreshRooms').addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'get_lobbies' }));
    }
  });

  document.getElementById('btnCopyRoomLink').addEventListener('click', () => {
    navigator.clipboard.writeText(stagingShareUrl.value);
    const btn = document.getElementById('btnCopyRoomLink');
    btn.textContent = 'KOPYALANDI!';
    setTimeout(() => { btn.textContent = 'LİNKİ KOPYALA'; }, 1500);
  });

  chkFillBots.addEventListener('change', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'toggle_bots', fillBots: chkFillBots.checked }));
    }
  });

  document.getElementById('btnStartMatchNow').addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'start_match' }));
    }
  });

  document.getElementById('btnLeaveRoom').addEventListener('click', returnToLobby);
  document.getElementById('btnLeaveMatch').addEventListener('click', returnToLobby);

  document.getElementById('btnSwitchRoleHud').addEventListener('click', cycleControlledRole);

  document.getElementById('btnToggleSound').addEventListener('click', (e) => {
    Audio.enabled = !Audio.enabled;
    e.target.textContent = Audio.enabled ? 'SES: AÇIK' : 'SES: KAPALI';
  });

  // ===========================================================================
  // FIXED 60Hz CLIENT SIMULATION & HUD UPDATE
  // ===========================================================================
  let lastSimTime = performance.now();
  let accumulator = 0;

  function updateSimulationStep() {
    const mask = buildInputMask();

    if (gameMode === 'online') {
      // 1) Send 4-byte Binary Input Packet to Authoritative Server
      inputSeq = (inputSeq + 1) & 0xFFFF;
      if (ws && ws.readyState === WebSocket.OPEN) {
        const binInput = Physics.encodeBinaryInput(mask, inputSeq);
        ws.send(binInput);
      }

      // 2) Client-Side Prediction (0ms local simulation for own character)
      const me = world.players[mySlotIndex];
      if (me && (world.phase === MATCH_PHASE.PLAYING || world.phase === MATCH_PHASE.OVERTIME)) {
        pendingInputs.push({ seq: inputSeq, inputMask: mask });
        if (pendingInputs.length > 90) pendingInputs.shift();
        me.inputMask = mask;
        Physics.stepPlayer(world, me);
        me.x += me.vx * Physics.DT;
        me.y += me.vy * Physics.DT;
      }

      // Decay visual reconciliation smoothing offset
      renderErrorX *= 0.82;
      renderErrorY *= 0.82;
    } else if (gameMode === 'sandbox') {
      // Full local 60Hz deterministic simulation with 3v3 AI bots
      for (let i = 0; i < 6; i++) {
        const p = world.players[i];
        if (i === mySlotIndex) {
          p.inputMask = mask;
        } else {
          p.inputMask = Physics.computeBotInput(world, p);
        }
      }
      Physics.stepWorld(world);

      if (world.events.length > 0) {
        for (const ev of world.events) {
          processGameEvent(ev);
        }
      }

      // In sandbox, auto-restart match after finished celebration
      if (world.phase === MATCH_PHASE.FINISHED && world.phaseTimer <= 0) {
        world.score = [0, 0];
        world.matchTicksRemaining = CONFIG.MATCH_DURATION_TICKS;
        world.overtimeTicks = 0;
        world.shotSpeedMultiplier = 1.0;
        Physics.resetPositionsForKickoff(world);
        world.phase = MATCH_PHASE.PLAYING;
      }
    } else {
      // Background attract mode (AI 3v3 match playing behind the lobby overlay!)
      for (let i = 0; i < 6; i++) {
        const p = world.players[i];
        p.isBot = true;
        p.inputMask = Physics.computeBotInput(world, p);
      }
      Physics.stepWorld(world);
      if (world.phase === MATCH_PHASE.FINISHED && world.phaseTimer <= 0) {
        world.score = [0, 0];
        world.matchTicksRemaining = CONFIG.MATCH_DURATION_TICKS;
        Physics.resetPositionsForKickoff(world);
        world.phase = MATCH_PHASE.PLAYING;
      }
    }

    // Update Ball Trail & VFX
    ballTrail.push({
      x: world.ball.x,
      y: world.ball.y,
      z: world.ball.z,
      speed: Math.hypot(world.ball.vx, world.ball.vy)
    });
    if (ballTrail.length > 14) ballTrail.shift();

    for (let i = particles.length - 1; i >= 0; i--) {
      const pt = particles[i];
      pt.x += pt.vx * Physics.DT;
      pt.y += pt.vy * Physics.DT;
      pt.z = Math.max(0, pt.z + pt.vz * Physics.DT);
      pt.vz -= 420 * Physics.DT;
      pt.life -= pt.decay * Physics.DT;
      if (pt.life <= 0) particles.splice(i, 1);
    }

    for (let i = wallRipples.length - 1; i >= 0; i--) {
      const rp = wallRipples[i];
      rp.radius += 160 * Physics.DT;
      rp.alpha -= 2.4 * Physics.DT;
      if (rp.alpha <= 0) wallRipples.splice(i, 1);
    }

    if (screenShake > 0) {
      screenShake *= 0.86;
      if (screenShake < 0.3) screenShake = 0;
    }

    updateHudElements();
  }

  /**
   * Update Scoreboard, Overtime Clock & Contextual Input Matrix HUD (GDD Section 3)
   */
  function updateHudElements() {
    if (gameMode === 'lobby') return;

    scoreOrangeEl.textContent = world.score[0];
    scoreBlueEl.textContent = world.score[1];

    if (world.phase === MATCH_PHASE.OVERTIME) {
      matchPhaseBadgeEl.textContent = '⚡ ALTIN GOL (OVERTIME) ⚡';
      matchPhaseBadgeEl.classList.add('overtime-active');
      const totalSec = Math.floor(world.overtimeTicks / 60);
      const mins = String(Math.floor(totalSec / 60)).padStart(2, '0');
      const secs = String(totalSec % 60).padStart(2, '0');
      matchClockEl.textContent = `+${mins}:${secs}`;
    } else {
      matchPhaseBadgeEl.textContent = 'ZERO-STOPPAGE 3v3';
      matchPhaseBadgeEl.classList.remove('overtime-active');
      const totalSec = Math.ceil(world.matchTicksRemaining / 60);
      const mins = String(Math.floor(totalSec / 60)).padStart(2, '0');
      const secs = String(totalSec % 60).padStart(2, '0');
      matchClockEl.textContent = `${mins}:${secs}`;
    }

    if (world.shotSpeedMultiplier > 1.01) {
      overtimeBoostBadgeEl.classList.remove('hidden');
      overtimeBoostBadgeEl.textContent = `EMNİYET KURALI — ŞUT HIZI: %${Math.round(world.shotSpeedMultiplier * 100)}`;
    } else {
      overtimeBoostBadgeEl.classList.add('hidden');
    }

    // Highlight pressed keys
    cardKeyJ.classList.toggle('active-press', keysDown.j);
    cardKeyK.classList.toggle('active-press', keysDown.k);
    cardKeyL.classList.toggle('active-press', keysDown.l);

    // Update Contextual Input Matrix based on Local Player's Live State (GDD Section 3)
    const me = world.players[mySlotIndex];
    if (!me) return;

    contextModeHeader.classList.remove('mode-offense', 'mode-defense', 'mode-gk');

    if (me.hasBall || world.ball.ownerId === me.id) {
      // CONTEXT 1: HÜCUM (Top Kontroldeyken)
      contextModeHeader.classList.add('mode-offense');
      contextModeTitle.textContent = 'HÜCUM MODU (TOP KONTROLDE - SOFT MAGNET)';
      contextPassiveInfo.textContent = me.state === STATE.CHARGING
        ? 'Şut Şarjı: Dönüş Açısı ±45° Kısıtlı | Hız %40’a Düşüyor'
        : 'Toplu Koşu Hızı: 0.85x | 180° Ani Dönüşte Top Açılır';

      lblWasdTitle.textContent = me.state === STATE.CHARGING ? '±45° Nişan Eğimi' : '8 Yönlü Top Sürme';
      lblWasdSub.textContent = me.state === STATE.CHARGING ? 'Şarj yön kısıtı aktif' : '60° Manyetik Koni (0.85x Hız)';

      lblJTitle.textContent = 'Yerden Pas / Şarjlı Şut';
      lblJSub.textContent = 'Bas-çek: Pas | Basılı tut (0.6s): Şut';

      lblKTitle.textContent = 'Aşırtma Pas / Lob (Z)';
      lblKSub.textContent = 'Kayarak gelen savunmayı aşırır';

      lblLTitle.textContent = me.state === STATE.CHARGING ? 'ŞUT İPTALİ (Cut)' : 'Dürtme / Çalım / Depar';
      lblLSub.textContent = me.state === STATE.CHARGING ? 'Şarjı iptal edip yana açar' : 'Topu ileri dürter ve hızlanır';
    } else if (me.isGoalkeeper) {
      // CONTEXT 3: KENDİ CEZA SAHASINDA (Bölge Korumalı Kaleci - GDD Section 5)
      contextModeHeader.classList.add('mode-gk');
      contextModeTitle.textContent = 'KALE BEKÇİSİ MODU (KENDİ CEZA SAHASINDA)';
      contextPassiveInfo.textContent = 'PASİF AKTİF: Sersemleme (Stun) Yemez & Z-Hava Toplarını Bloklar';

      lblWasdTitle.textContent = '8 Yönlü Pozisyon Alma';
      lblWasdSub.textContent = 'Ceza sahası koruma alanı';

      lblJTitle.textContent = 'Ayak Koyma / Pres';
      lblJSub.textContent = 'Kısa menzilli top çalma (0.5s CD)';

      lblKTitle.textContent = 'Plonjon / Uzanma (Dive)';
      lblKSub.textContent = 'Köşeye ani hitbox uzatması (0.8s Ceza)';

      lblLTitle.textContent = 'Pozisyon Düzeltme';
      lblLSub.textContent = 'Kale-top açıortayına hizalanır';
    } else {
      // CONTEXT 2: SAVUNMA (Topsuz / Rakipteyken)
      contextModeHeader.classList.add('mode-defense');
      contextModeTitle.textContent = 'SAVUNMA MODU (TOPSUZ / PRES)';
      contextPassiveInfo.textContent = 'Topsuz Tam Hız: 1.00x (%15 Hız Avantajı)';

      lblWasdTitle.textContent = '8 Yönlü Hareket';
      lblWasdSub.textContent = 'Tam Hız (1.0x) & Pres Açısı';

      lblJTitle.textContent = 'Ayak Koyma / Pres (Poke)';
      lblJSub.textContent = 'Manyetik bağı koparır (0.5s CD)';

      lblKTitle.textContent = 'Ayağa Kayma (Slide)';
      lblKSub.textContent = '1.8x İvme | 16f Stun / 26f Ceza (2.5s CD)';

      lblLTitle.textContent = 'Omuz Omuza (Jockey)';
      lblLSub.textContent = 'Fiziksel denge & omuz şarjı';
    }
  }

  // ===========================================================================
  // 2D ISOMETRIC (30°) NEO-ARCADE FLAT VECTOR RENDERER (GDD Section 2)
  // ===========================================================================
  function renderScene() {
    const w = window.innerWidth;
    const h = window.innerHeight;

    ctx.fillStyle = '#070a10';
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    if (screenShake > 0) {
      ctx.translate((Math.random() - 0.5) * screenShake, (Math.random() - 0.5) * screenShake);
    }

    drawIsometricArena();
    drawWallRipples();
    drawBallGroundShadowAndTarget();
    drawEntitiesSortedByDepth();
    drawParticles();

    ctx.restore();
  }

  /**
   * Draw the 30° Isometric Closed Bumper Pitch, Penalty Boxes, Goals & Markings
   */
  function drawIsometricArena() {
    const W = CONFIG.ARENA_W;
    const H = CONFIG.ARENA_H;
    const B = CONFIG.CORNER_BEVEL;
    const cy = H * 0.5;
    const goalTop = cy - CONFIG.GOAL_WIDTH * 0.5;
    const goalBot = cy + CONFIG.GOAL_WIDTH * 0.5;

    // 8 vertices of the octagonal beveled pitch
    const pitchPoly = [
      toIsoScreen(B, 0),
      toIsoScreen(W - B, 0),
      toIsoScreen(W, B),
      toIsoScreen(W, H - B),
      toIsoScreen(W - B, H),
      toIsoScreen(B, H),
      toIsoScreen(0, H - B),
      toIsoScreen(0, B)
    ];

    // 1) Outer Arena Base Platform / Rim Shadow
    ctx.save();
    ctx.beginPath();
    pitchPoly.forEach((pt, idx) => {
      if (idx === 0) ctx.moveTo(pt.x, pt.y + 16);
      else ctx.lineTo(pt.x, pt.y + 16);
    });
    ctx.closePath();
    ctx.fillStyle = '#04060a';
    ctx.fill();

    // 2) Matte Dark Indoor Floor (GDD Section 2: Mat koyu salon zemini)
    ctx.beginPath();
    pitchPoly.forEach((pt, idx) => {
      if (idx === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.closePath();
    const floorGrad = ctx.createLinearGradient(0, toIsoScreen(0, 0).y, 0, toIsoScreen(0, H).y);
    floorGrad.addColorStop(0, '#101722');
    floorGrad.addColorStop(0.5, '#131c2b');
    floorGrad.addColorStop(1, '#0e1520');
    ctx.fillStyle = floorGrad;
    ctx.fill();

    // Subtle alternating court stripes clipped to pitch
    ctx.clip();
    const stripeCount = 12;
    const stripeW = W / stripeCount;
    for (let i = 0; i < stripeCount; i++) {
      if (i % 2 === 0) {
        const p1 = toIsoScreen(i * stripeW, 0);
        const p2 = toIsoScreen((i + 1) * stripeW, 0);
        const p3 = toIsoScreen((i + 1) * stripeW, H);
        const p4 = toIsoScreen(i * stripeW, H);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p3.x, p3.y);
        ctx.lineTo(p4.x, p4.y);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.018)';
        ctx.fill();
      }
    }

    // 3) Left & Right Penalty Boxes (Zone-Protected Goalkeeper Trigger Areas - GDD Section 5)
    const penTop = cy - CONFIG.PENALTY_H * 0.5;
    const penBot = cy + CONFIG.PENALTY_H * 0.5;

    // Check if any player is active GK in each box to pulse the zone
    const orangeGkActive = world.players.some(p => p.team === 0 && p.isGoalkeeper);
    const blueGkActive = world.players.some(p => p.team === 1 && p.isGoalkeeper);

    // Left Penalty Box (Orange)
    drawIsoQuad(
      0, penTop, CONFIG.PENALTY_W, penBot,
      orangeGkActive ? 'rgba(255, 85, 0, 0.11)' : 'rgba(255, 85, 0, 0.045)',
      orangeGkActive ? 'rgba(255, 115, 40, 0.65)' : 'rgba(255, 85, 0, 0.28)',
      2
    );

    // Right Penalty Box (Electric Blue)
    drawIsoQuad(
      W - CONFIG.PENALTY_W, penTop, W, penBot,
      blueGkActive ? 'rgba(0, 210, 255, 0.11)' : 'rgba(0, 210, 255, 0.045)',
      blueGkActive ? 'rgba(40, 225, 255, 0.65)' : 'rgba(0, 210, 255, 0.28)',
      2
    );

    // 4) Center Line & Isometric Center Circle
    const midTop = toIsoScreen(W * 0.5, 0);
    const midBot = toIsoScreen(W * 0.5, H);
    ctx.beginPath();
    ctx.moveTo(midTop.x, midTop.y);
    ctx.lineTo(midBot.x, midBot.y);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.13)';
    ctx.lineWidth = 2;
    ctx.stroke();

    const centerPt = toIsoScreen(W * 0.5, cy);
    ctx.beginPath();
    ctx.ellipse(centerPt.x, centerPt.y, 92 * viewScale, 92 * ISO_COS * viewScale, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(centerPt.x, centerPt.y, 5 * viewScale, 5 * ISO_COS * viewScale, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.fill();

    ctx.restore(); // Remove pitch clip

    // 5) Draw 3D Isometric Goals (Left = Orange Defends, Right = Blue Defends)
    drawIsometricGoal(0, goalTop, goalBot, -CONFIG.GOAL_DEPTH, '#ff5500');
    drawIsometricGoal(W, goalTop, goalBot, CONFIG.GOAL_DEPTH, '#00d2ff');

    // 6) Elastic Bumper Walls (e = 0.88) with 3D Isometric Height Extrusion
    const wallHeightZ = 18;
    const wallSegments = [
      // Top wall
      { x1: B, y1: 0, x2: W - B, y2: 0, color: '#2a3b56' },
      // Top-Right bevel
      { x1: W - B, y1: 0, x2: W, y2: B, color: '#00a8cc' },
      // Right upper wall
      { x1: W, y1: B, x2: W, y2: goalTop, color: '#00d2ff' },
      // Right lower wall
      { x1: W, y1: goalBot, x2: W, y2: H - B, color: '#00d2ff' },
      // Bottom-Right bevel
      { x1: W, y1: H - B, x2: W - B, y2: H, color: '#00a8cc' },
      // Bottom wall
      { x1: W - B, y1: H, x2: B, y2: H, color: '#2a3b56' },
      // Bottom-Left bevel
      { x1: B, y1: H, x2: 0, y2: H - B, color: '#cc4400' },
      // Left lower wall
      { x1: 0, y1: H - B, x2: 0, y2: goalBot, color: '#ff5500' },
      // Left upper wall
      { x1: 0, y1: goalTop, x2: 0, y2: B, color: '#ff5500' },
      // Top-Left bevel
      { x1: 0, y1: B, x2: B, y2: 0, color: '#cc4400' }
    ];

    for (const seg of wallSegments) {
      const b1 = toIsoScreen(seg.x1, seg.y1, 0);
      const b2 = toIsoScreen(seg.x2, seg.y2, 0);
      const t1 = toIsoScreen(seg.x1, seg.y1, wallHeightZ);
      const t2 = toIsoScreen(seg.x2, seg.y2, wallHeightZ);

      // Extruded wall face
      ctx.beginPath();
      ctx.moveTo(b1.x, b1.y);
      ctx.lineTo(b2.x, b2.y);
      ctx.lineTo(t2.x, t2.y);
      ctx.lineTo(t1.x, t1.y);
      ctx.closePath();
      ctx.fillStyle = 'rgba(20, 30, 48, 0.85)';
      ctx.fill();

      // Glowing bumper top rail
      ctx.beginPath();
      ctx.moveTo(t1.x, t1.y);
      ctx.lineTo(t2.x, t2.y);
      ctx.strokeStyle = seg.color;
      ctx.lineWidth = 3.2;
      ctx.stroke();

      // Base line on floor
      ctx.beginPath();
      ctx.moveTo(b1.x, b1.y);
      ctx.lineTo(b2.x, b2.y);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  function drawIsoQuad(x1, y1, x2, y2, fillStyle, strokeStyle, lineWidth) {
    const p1 = toIsoScreen(x1, y1);
    const p2 = toIsoScreen(x2, y1);
    const p3 = toIsoScreen(x2, y2);
    const p4 = toIsoScreen(x1, y2);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.lineTo(p4.x, p4.y);
    ctx.closePath();
    if (fillStyle) {
      ctx.fillStyle = fillStyle;
      ctx.fill();
    }
    if (strokeStyle) {
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth || 1.5;
      ctx.stroke();
    }
  }

  function drawIsometricGoal(goalLineX, yTop, yBot, depthX, teamColor) {
    const crossbarZ = 56;
    const gFrontTop = toIsoScreen(goalLineX, yTop, 0);
    const gFrontBot = toIsoScreen(goalLineX, yBot, 0);
    const gBackTop = toIsoScreen(goalLineX + depthX, yTop, 0);
    const gBackBot = toIsoScreen(goalLineX + depthX, yBot, 0);

    const gTopCrossFront = toIsoScreen(goalLineX, yTop, crossbarZ);
    const gBotCrossFront = toIsoScreen(goalLineX, yBot, crossbarZ);
    const gTopCrossBack = toIsoScreen(goalLineX + depthX, yTop, crossbarZ * 0.85);
    const gBotCrossBack = toIsoScreen(goalLineX + depthX, yBot, crossbarZ * 0.85);

    // Goal Floor
    ctx.beginPath();
    ctx.moveTo(gFrontTop.x, gFrontTop.y);
    ctx.lineTo(gBackTop.x, gBackTop.y);
    ctx.lineTo(gBackBot.x, gBackBot.y);
    ctx.lineTo(gFrontBot.x, gFrontBot.y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(6, 10, 18, 0.88)';
    ctx.fill();
    ctx.strokeStyle = teamColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Goal Net Cage Frame
    ctx.beginPath();
    // Top side frame
    ctx.moveTo(gFrontTop.x, gFrontTop.y);
    ctx.lineTo(gTopCrossFront.x, gTopCrossFront.y);
    ctx.lineTo(gTopCrossBack.x, gTopCrossBack.y);
    ctx.lineTo(gBackTop.x, gBackTop.y);
    // Back frame
    ctx.moveTo(gBackTop.x, gBackTop.y);
    ctx.lineTo(gTopCrossBack.x, gTopCrossBack.y);
    ctx.lineTo(gBotCrossBack.x, gBotCrossBack.y);
    ctx.lineTo(gBackBot.x, gBackBot.y);
    // Bottom side frame
    ctx.moveTo(gFrontBot.x, gFrontBot.y);
    ctx.lineTo(gBotCrossFront.x, gBotCrossFront.y);
    ctx.lineTo(gBotCrossBack.x, gBotCrossBack.y);
    ctx.lineTo(gBackBot.x, gBackBot.y);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Front Goal Posts & Crossbar
    ctx.beginPath();
    ctx.moveTo(gFrontTop.x, gFrontTop.y);
    ctx.lineTo(gTopCrossFront.x, gTopCrossFront.y);
    ctx.lineTo(gBotCrossFront.x, gBotCrossFront.y);
    ctx.lineTo(gFrontBot.x, gFrontBot.y);
    ctx.strokeStyle = teamColor;
    ctx.lineWidth = 4;
    ctx.stroke();

    // Post base circles
    [gFrontTop, gFrontBot].forEach((postPt) => {
      ctx.beginPath();
      ctx.arc(postPt.x, postPt.y, 5.5 * viewScale, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = teamColor;
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  }

  /**
   * Draw Ball's Ground Shadow at Z=0 Projection (GDD Section 2: Z Ekseni Okunabilirliği)
   * "Top Z ekseninde yükseldikçe yerdeki gölge küçülür ve solar; oyuncu topun iniş noktasını
   *  havaya değil, yerdeki gölgenin merkezine bakarak hesaplar."
   */
  function drawBallGroundShadowAndTarget() {
    const ball = world.ball;
    const groundPt = toIsoScreen(ball.x, ball.y, 0);

    // Shadow shrinks and fades as Z increases
    const heightRatio = Physics.clamp(ball.z / 135, 0, 1);
    const shadowRadius = CONFIG.BALL_RADIUS * (1.05 - heightRatio * 0.62) * groundPt.scale;
    const shadowAlpha = 0.65 - heightRatio * 0.42;

    // If ball is airborne (Z > 6), draw a landing reticle & vertical drop guide line to ground shadow center
    if (ball.z > 6) {
      const airPt = toIsoScreen(ball.x, ball.y, ball.z);

      // Outer landing pulse ring on the ground
      ctx.beginPath();
      ctx.ellipse(
        groundPt.x,
        groundPt.y,
        CONFIG.BALL_RADIUS * 1.45 * groundPt.scale,
        CONFIG.BALL_RADIUS * 1.45 * ISO_COS * groundPt.scale,
        0, 0, Math.PI * 2
      );
      ctx.strokeStyle = `rgba(56, 189, 248, ${0.25 + (1 - heightRatio) * 0.45})`;
      ctx.lineWidth = 1.6;
      ctx.stroke();

      // Dashed vertical Z-height drop line connecting ball to ground shadow center
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(groundPt.x, groundPt.y);
      ctx.lineTo(airPt.x, airPt.y);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.restore();
    }

    // Dynamic Ground Shadow Ellipse
    ctx.beginPath();
    ctx.ellipse(
      groundPt.x,
      groundPt.y,
      Math.max(3, shadowRadius),
      Math.max(2, shadowRadius * ISO_COS),
      0, 0, Math.PI * 2
    );
    ctx.fillStyle = `rgba(0, 0, 0, ${shadowAlpha.toFixed(2)})`;
    ctx.fill();
  }

  /**
   * Draw all 6 Players and the Ball sorted by Y coordinate (Painter's Algorithm)
   */
  function drawEntitiesSortedByDepth() {
    const renderItems = [];

    for (let i = 0; i < world.players.length; i++) {
      const p = world.players[i];
      renderItems.push({ type: 'player', y: p.y, entity: p });
    }
    renderItems.push({ type: 'ball', y: world.ball.y + 1, entity: world.ball });

    renderItems.sort((a, b) => a.y - b.y);

    for (let i = 0; i < renderItems.length; i++) {
      const item = renderItems[i];
      if (item.type === 'player') {
        drawPlayer(item.entity);
      } else {
        drawBall(item.entity);
      }
    }
  }

  /**
   * Draw Neo-Arcade Vector Player (GDD Section 2, 4, 5):
   * - Oval/capsule body with isometric extrusion
   * - Minimalist high-contrast directional triangle / cleat tip
   * - Soft-Magnet 60° front cone & ±45° Shot Charge commitment arc
   * - Goalkeeper Zone Shield Aura, Dive Extended Hitbox, Stun Stars & Cooldown Arc
   */
  function drawPlayer(p) {
    const isMe = (gameMode !== 'lobby') && (p.id === mySlotIndex);
    const drawX = isMe ? p.x + renderErrorX : p.x;
    const drawY = isMe ? p.y + renderErrorY : p.y;

    const groundPt = toIsoScreen(drawX, drawY, 0);
    const s = groundPt.scale;
    const radius = (p.state === STATE.DIVING ? CONFIG.PLAYER_GK_DIVE_RADIUS : CONFIG.PLAYER_RADIUS) * s;

    const primaryColor = p.team === 0 ? '#ff5500' : '#00d2ff';
    const rimColor = p.team === 0 ? '#ff9f43' : '#70e5ff';
    const darkBaseColor = p.team === 0 ? '#992d00' : '#006280';

    // 1) Soft-Magnet 60° Front Control Cone (Drawn on ground for controlled player or ball carrier)
    if (isMe || p.hasBall) {
      const coneDist = CONFIG.MAGNET_DIST * s;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(groundPt.x, groundPt.y);
      ctx.arc(
        groundPt.x,
        groundPt.y,
        coneDist,
        p.angle - CONFIG.MAGNET_CONE_HALF_ANGLE,
        p.angle + CONFIG.MAGNET_CONE_HALF_ANGLE
      );
      ctx.closePath();
      ctx.fillStyle = p.hasBall ? 'rgba(255, 207, 51, 0.16)' : 'rgba(255, 255, 255, 0.05)';
      ctx.fill();
      ctx.strokeStyle = p.hasBall ? 'rgba(255, 207, 51, 0.45)' : 'rgba(255, 255, 255, 0.14)';
      ctx.lineWidth = 1.3;
      ctx.stroke();
      ctx.restore();
    }

    // 2) Shot Charge Commitment Cone (±45° Turn Restriction - GDD 4.2)
    if (p.state === STATE.CHARGING) {
      const chargeRatio = Physics.clamp(p.chargeFrames / CONFIG.CHARGE_MAX_FRAMES, 0, 1);
      const aimDist = (48 + chargeRatio * 55) * s;

      // ±45° commitment boundary lines
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(groundPt.x, groundPt.y);
      ctx.arc(
        groundPt.x,
        groundPt.y,
        aimDist,
        p.chargeLockAngle - CONFIG.CHARGE_MAX_TURN_ANGLE,
        p.chargeLockAngle + CONFIG.CHARGE_MAX_TURN_ANGLE
      );
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 82, 82, 0.13)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 207, 51, 0.55)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }

    // 3) Goalkeeper Zone Aura (GDD Section 5: Bölge Korumalı Kaleci)
    if (p.isGoalkeeper) {
      ctx.beginPath();
      ctx.ellipse(groundPt.x, groundPt.y, radius * 1.32, radius * 1.32 * ISO_COS, 0, 0, Math.PI * 2);
      ctx.strokeStyle = '#00e676';
      ctx.lineWidth = 2.2;
      ctx.stroke();
    }

    // 4) Local Player Selection Ring
    if (isMe) {
      ctx.beginPath();
      ctx.ellipse(groundPt.x, groundPt.y, radius * 1.18, radius * 1.18 * ISO_COS, 0, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }

    // 5) Player Ground Shadow
    ctx.beginPath();
    ctx.ellipse(groundPt.x, groundPt.y + 3 * s, radius * 1.02, radius * 1.02 * ISO_COS, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.48)';
    ctx.fill();

    // 6) Isometric Capsule / Oval Body Extrusion
    const bodyHeightZ = (p.state === STATE.SLIDING || p.state === STATE.DIVING || p.state === STATE.RECOVERY) ? 6 : 15;
    const topPt = toIsoScreen(drawX, drawY, bodyHeightZ);

    // Lower cylinder/capsule base
    ctx.beginPath();
    ctx.ellipse(groundPt.x, groundPt.y, radius, radius * ISO_COS, 0, 0, Math.PI * 2);
    ctx.fillStyle = darkBaseColor;
    ctx.fill();

    // Upper capsule top
    ctx.beginPath();
    ctx.ellipse(topPt.x, topPt.y, radius * 0.94, radius * 0.94 * ISO_COS, 0, 0, Math.PI * 2);
    ctx.fillStyle = p.state === STATE.STUNNED ? '#ff4757' : (p.state === STATE.RECOVERY ? '#64748b' : primaryColor);
    ctx.fill();
    ctx.strokeStyle = isMe ? '#ffffff' : rimColor;
    ctx.lineWidth = 2.2;
    ctx.stroke();

    // 7) Minimalist High-Contrast Directional Triangle / Cleat Tip (GDD Section 2)
    const tipDist = radius * 1.26;
    const baseDist = radius * 0.58;
    const spreadAngle = 0.52;

    const tipX = topPt.x + Math.cos(p.angle) * tipDist;
    const tipY = topPt.y + Math.sin(p.angle) * tipDist * ISO_COS;
    const leftX = topPt.x + Math.cos(p.angle - spreadAngle) * baseDist;
    const leftY = topPt.y + Math.sin(p.angle - spreadAngle) * baseDist * ISO_COS;
    const rightX = topPt.x + Math.cos(p.angle + spreadAngle) * baseDist;
    const rightY = topPt.y + Math.sin(p.angle + spreadAngle) * baseDist * ISO_COS;

    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(leftX, leftY);
    ctx.lineTo(rightX, rightY);
    ctx.closePath();
    ctx.fillStyle = p.hasBall ? '#ffcf33' : '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // Role Label inside Capsule ('GK', 'M', 'F')
    ctx.fillStyle = '#090d16';
    ctx.font = `900 ${Math.round(10 * s)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const shortRole = p.isGoalkeeper ? 'GK' : p.role[0];
    ctx.fillText(shortRole, topPt.x, topPt.y);

    // 8) Status Overlays: Shot Charge Bar, Stun Stars (16f), Recovery Bar (26f/48f), Slide Cooldown
    if (p.state === STATE.CHARGING) {
      const ratio = Physics.clamp(p.chargeFrames / CONFIG.CHARGE_MAX_FRAMES, 0, 1);
      const barW = 44 * s;
      const barH = 6 * s;
      const bx = topPt.x - barW * 0.5;
      const by = topPt.y - 28 * s;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);
      ctx.fillStyle = ratio > 0.8 ? '#ff4757' : '#ffcf33';
      ctx.fillRect(bx, by, barW * ratio, barH);
    } else if (p.state === STATE.STUNNED) {
      // Orbiting Stun Stars (16 frames)
      for (let k = 0; k < 3; k++) {
        const a = (performance.now() * 0.012) + (k * Math.PI * 2) / 3;
        const sx = topPt.x + Math.cos(a) * radius * 0.85;
        const sy = topPt.y - 16 * s + Math.sin(a) * radius * 0.4;
        ctx.beginPath();
        ctx.arc(sx, sy, 3.2 * s, 0, Math.PI * 2);
        ctx.fillStyle = '#ffcf33';
        ctx.fill();
      }
      ctx.fillStyle = '#ffcf33';
      ctx.font = `800 ${Math.round(9.5 * s)}px system-ui, sans-serif`;
      ctx.fillText('STUN!', topPt.x, topPt.y - 26 * s);
    } else if (p.state === STATE.RECOVERY) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = `800 ${Math.round(9 * s)}px system-ui, sans-serif`;
      ctx.fillText('TOPARLANMA', topPt.x, topPt.y - 25 * s);
    }

    // Slide / Dive Cooldown micro indicator beneath player
    if (p.slideCooldown > 0) {
      const cdRatio = p.slideCooldown / CONFIG.SLIDE_COOLDOWN_FRAMES;
      ctx.beginPath();
      ctx.arc(groundPt.x, groundPt.y, radius * 1.12, -Math.PI * 0.5, -Math.PI * 0.5 + Math.PI * 2 * cdRatio);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Player Name Tag
    ctx.fillStyle = isMe ? '#ffcf33' : 'rgba(241, 245, 249, 0.78)';
    ctx.font = `700 ${Math.round(10.5 * s)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(p.name, groundPt.x, groundPt.y + 24 * s);
  }

  /**
   * Draw Ball at (x, y, z) with Dynamic Velocity Trail & Isometric Elevation
   */
  function drawBall(ball) {
    // Draw Motion Trail
    for (let i = 0; i < ballTrail.length; i++) {
      const tr = ballTrail[i];
      if (tr.speed < 260) continue;
      const ratio = (i + 1) / ballTrail.length;
      const pt = toIsoScreen(tr.x, tr.y, tr.z);
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, CONFIG.BALL_RADIUS * 0.7 * ratio * pt.scale, 0, Math.PI * 2);
      ctx.fillStyle = tr.z > 28
        ? `rgba(56, 189, 248, ${ratio * 0.25})`
        : `rgba(255, 207, 51, ${ratio * 0.22})`;
      ctx.fill();
    }

    const pt = toIsoScreen(ball.x, ball.y, ball.z);
    // Slight apparent scale boost when high in the air for extra Z readability
    const airScale = 1 + Math.min(0.28, ball.z / 260);
    const r = CONFIG.BALL_RADIUS * pt.scale * airScale;

    // Outer Glow on Fast Shots or Aerial Lobs
    const speed = Math.hypot(ball.vx, ball.vy);
    if (speed > 650 || ball.z > 28) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, r * 1.35, 0, Math.PI * 2);
      ctx.fillStyle = ball.z > 28 ? 'rgba(56, 189, 248, 0.28)' : 'rgba(255, 120, 0, 0.28)';
      ctx.fill();
    }

    // Main Ball Sphere
    const grad = ctx.createRadialGradient(pt.x - r * 0.3, pt.y - r * 0.3, r * 0.15, pt.x, pt.y, r);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.7, '#e2e8f0');
    grad.addColorStop(1, '#94a3b8');

    ctx.beginPath();
    ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Neo-Arcade Geometric Panel Seam
    const spinPhase = (ball.x + ball.y) * 0.04;
    ctx.beginPath();
    ctx.arc(
      pt.x + Math.cos(spinPhase) * r * 0.28,
      pt.y + Math.sin(spinPhase) * r * 0.28,
      r * 0.36,
      0,
      Math.PI * 2
    );
    ctx.fillStyle = '#1e293b';
    ctx.fill();
  }

  function drawWallRipples() {
    for (const rp of wallRipples) {
      const pt = toIsoScreen(rp.x, rp.y, 6);
      ctx.beginPath();
      ctx.ellipse(pt.x, pt.y, rp.radius * pt.scale, rp.radius * ISO_COS * pt.scale, 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(0, 229, 255, ${rp.alpha.toFixed(2)})`;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  }

  function drawParticles() {
    for (const pt of particles) {
      const scr = toIsoScreen(pt.x, pt.y, pt.z);
      ctx.globalAlpha = Math.max(0, pt.life);
      ctx.beginPath();
      ctx.arc(scr.x, scr.y, pt.size * scr.scale, 0, Math.PI * 2);
      ctx.fillStyle = pt.color;
      ctx.fill();
    }
    ctx.globalAlpha = 1.0;
  }

  // ===========================================================================
  // MAIN 60+ FPS ANIMATION LOOP
  // ===========================================================================
  function mainLoop(now) {
    const dtMs = Math.min(100, now - lastSimTime);
    lastSimTime = now;
    accumulator += dtMs;

    const fixedStepMs = 1000 / Physics.TICK_RATE;
    while (accumulator >= fixedStepMs) {
      updateSimulationStep();
      accumulator -= fixedStepMs;
    }

    if (gameMode === 'online') {
      applyRemoteInterpolation();
    }

    renderScene();

    // FPS Counter
    frameCount++;
    if (now - lastFpsUpdate >= 500) {
      currentFps = Math.round((frameCount * 1000) / (now - lastFpsUpdate));
      fpsStatEl.textContent = `${currentFps} FPS`;
      frameCount = 0;
      lastFpsUpdate = now;
    }

    requestAnimationFrame(mainLoop);
  }

  // Start WebSocket & Render Loop
  connectWebSocket();
  requestAnimationFrame(mainLoop);
})();
