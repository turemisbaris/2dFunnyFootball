/**
 * REBOUND - Dedicated Authoritative Server (Node.js + Binary WebSocket)
 * - 60Hz Deterministic Custom Physics Tick
 * - 30Hz Binary ArrayBuffer Snapshot Broadcast (~68 bytes)
 * - Link & Play Room Management (/room/ANK-4091)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');
const Physics = require('./public/shared/physics.js');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

// HTTP Server with support for Link & Play routes (/room/ANK-4091)
const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(urlObj.pathname);

  // API endpoint for open rooms if needed
  if (pathname === '/api/rooms') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(getPublicRoomList()));
    return;
  }

  // Link & Play route: /room/ANK-4091 -> serve index.html
  if (pathname === '/' || pathname.startsWith('/room/')) {
    pathname = '/index.html';
  }

  const safePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!safePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(safePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    const ext = path.extname(safePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

// Active Rooms Map: code -> Room
const rooms = new Map();
const PREFIXES = ['ANK', 'IST', 'IZM', 'REB', 'NEO', 'HEX', 'ARC', 'PRO'];

function generateRoomCode() {
  for (let attempt = 0; attempt < 50; attempt++) {
    const prefix = PREFIXES[Math.floor(Math.random() * PREFIXES.length)];
    const num = Math.floor(1000 + Math.random() * 9000);
    const code = `${prefix}-${num}`;
    if (!rooms.has(code)) return code;
  }
  return `REB-${Date.now().toString().slice(-4)}`;
}

function createRoom(hostName, customCode, fillBots = true) {
  const code = customCode && !rooms.has(customCode) ? customCode : generateRoomCode();
  const world = Physics.createWorldState();
  world.phase = Physics.MATCH_PHASE.WAITING;

  const room = {
    code,
    name: `${hostName || 'Misafir'} Odası`,
    createdAt: Date.now(),
    status: 'lobby', // 'lobby' | 'playing'
    fillBots: fillBots,
    world,
    // 6 slots (0..2 = Orange GK/MID/FWD, 3..5 = Blue GK/MID/FWD)
    slots: [null, null, null, null, null, null],
    clients: new Set()
  };

  rooms.set(code, room);
  return room;
}

// Create a default public lobby room so the lobby list always has an active room on startup
createRoom('Arena #1', 'ANK-4091', true);

function getPublicRoomList() {
  const list = [];
  for (const room of rooms.values()) {
    const humanCount = room.slots.filter(Boolean).length;
    list.push({
      code: room.code,
      name: room.name,
      status: room.status,
      players: humanCount,
      maxPlayers: 6,
      fillBots: room.fillBots,
      score: room.world.score
    });
  }
  return list;
}

function broadcastLobbyList() {
  const payload = JSON.stringify({
    type: 'lobby_list',
    rooms: getPublicRoomList()
  });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN && !client.roomCode) {
      client.send(payload);
    }
  }
}

function serializeRoomState(room) {
  return {
    type: 'room_state',
    code: room.code,
    name: room.name,
    status: room.status,
    fillBots: room.fillBots,
    phase: room.world.phase,
    score: room.world.score,
    slots: room.slots.map((client, idx) => {
      const team = idx < 3 ? 0 : 1;
      const role = Physics.SPAWN_POSITIONS[team][idx % 3].role;
      return {
        slotIndex: idx,
        team,
        role,
        occupied: !!client,
        name: client ? client.playerName : (room.fillBots ? `BOT (${role})` : 'BOŞ SLOT'),
        isBot: !client
      };
    })
  };
}

function broadcastRoomState(room) {
  const msg = JSON.stringify(serializeRoomState(room));
  for (const client of room.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
  broadcastLobbyList();
}

function startMatchInRoom(room) {
  room.status = 'playing';
  const world = room.world;
  world.tick = 0;
  world.score = [0, 0];
  world.winnerTeam = -1;
  world.matchTicksRemaining = Physics.CONFIG.MATCH_DURATION_TICKS;
  world.overtimeTicks = 0;
  world.shotSpeedMultiplier = 1.0;

  for (let i = 0; i < 6; i++) {
    const client = room.slots[i];
    const p = world.players[i];
    const role = Physics.SPAWN_POSITIONS[p.team][p.roleIndex].role;
    if (client) {
      p.isBot = false;
      p.name = client.playerName;
    } else {
      p.isBot = true;
      p.name = `BOT-${role}`;
    }
  }

  Physics.resetPositionsForKickoff(world);
  world.phase = Physics.MATCH_PHASE.COUNTDOWN;
  world.phaseTimer = 120; // 2s countdown

  broadcastRoomState(room);
  const startMsg = JSON.stringify({
    type: 'match_started',
    room: serializeRoomState(room)
  });
  for (const client of room.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(startMsg);
    }
  }
}

function assignClientToSlot(room, client, preferredSlot) {
  // Remove from current slot if any
  for (let i = 0; i < 6; i++) {
    if (room.slots[i] === client) {
      room.slots[i] = null;
    }
  }

  if (typeof preferredSlot === 'number' && preferredSlot >= 0 && preferredSlot < 6 && !room.slots[preferredSlot]) {
    room.slots[preferredSlot] = client;
    client.slotIndex = preferredSlot;
    return preferredSlot;
  }

  // Balance teams: pick first available slot alternating Orange (0,1,2) and Blue (3,4,5)
  const order = [2, 5, 1, 4, 0, 3]; // Prefer FWD, then MID, then GK for first joiners
  for (const idx of order) {
    if (!room.slots[idx]) {
      room.slots[idx] = client;
      client.slotIndex = idx;
      return idx;
    }
  }
  client.slotIndex = -1;
  return -1;
}

function removeClientFromRoom(client) {
  if (!client.roomCode) return;
  const room = rooms.get(client.roomCode);
  client.roomCode = null;
  if (!room) return;

  room.clients.delete(client);
  for (let i = 0; i < 6; i++) {
    if (room.slots[i] === client) {
      room.slots[i] = null;
      // GDD Section 6: Bağlantısı kopan olursa maç kalan oyuncularla tamamlanır
      if (room.status === 'playing') {
        room.world.players[i].isBot = true;
        room.world.players[i].name = `BOT-${room.world.players[i].role}`;
      }
    }
  }

  if (room.clients.size === 0 && room.code !== 'ANK-4091') {
    rooms.delete(room.code);
    broadcastLobbyList();
  } else {
    if (room.clients.size === 0 && room.code === 'ANK-4091') {
      room.status = 'lobby';
      room.world.phase = Physics.MATCH_PHASE.WAITING;
    }
    broadcastRoomState(room);
  }
}

wss.on('connection', (ws) => {
  ws.playerName = 'Oyuncu';
  ws.roomCode = null;
  ws.slotIndex = -1;
  ws.lastInputSeq = 0;

  // Send initial open lobby list
  ws.send(JSON.stringify({
    type: 'lobby_list',
    rooms: getPublicRoomList()
  }));

  ws.on('message', (data, isBinary) => {
    // 1) Binary ArrayBuffer Input Packet (High-Frequency 60Hz Client Input)
    if (isBinary) {
      if (!ws.roomCode || ws.slotIndex < 0 || ws.slotIndex >= 6) return;
      const room = rooms.get(ws.roomCode);
      if (!room || room.status !== 'playing') return;

      const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      const decoded = Physics.decodeBinaryInput(buf);
      if (decoded) {
        const p = room.world.players[ws.slotIndex];
        if (p) {
          p.inputMask = decoded.inputMask;
          ws.lastInputSeq = decoded.seq;
        }
      }
      return;
    }

    // 2) JSON Control / Lobby Messages
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (e) {
      return;
    }

    if (msg.type === 'get_lobbies') {
      ws.send(JSON.stringify({
        type: 'lobby_list',
        rooms: getPublicRoomList()
      }));
      return;
    }

    if (msg.type === 'create_room') {
      removeClientFromRoom(ws);
      ws.playerName = (msg.name || 'Oyuncu').slice(0, 16);
      const room = createRoom(ws.playerName, msg.roomCode, msg.fillBots !== false);
      room.clients.add(ws);
      ws.roomCode = room.code;
      assignClientToSlot(room, ws, 2); // Start as Orange Forward
      ws.send(JSON.stringify({
        type: 'joined_room',
        slotIndex: ws.slotIndex,
        room: serializeRoomState(room)
      }));
      broadcastRoomState(room);
      return;
    }

    if (msg.type === 'join_room') {
      removeClientFromRoom(ws);
      ws.playerName = (msg.name || 'Oyuncu').slice(0, 16);
      const code = (msg.code || '').toUpperCase().trim();
      let room = rooms.get(code);
      if (!room) {
        // Link & Play: if someone opens /room/XYZ-1234 directly, create it on the fly!
        room = createRoom(ws.playerName, code || undefined, true);
      }

      const slot = assignClientToSlot(room, ws);
      if (slot === -1) {
        ws.send(JSON.stringify({ type: 'error', message: 'Bu oda tamamen dolu (3v3)!' }));
        return;
      }

      room.clients.add(ws);
      ws.roomCode = room.code;

      // If match is already playing, seamlessly replace bot in that slot
      if (room.status === 'playing') {
        const p = room.world.players[slot];
        p.isBot = false;
        p.name = ws.playerName;
      }

      ws.send(JSON.stringify({
        type: 'joined_room',
        slotIndex: ws.slotIndex,
        room: serializeRoomState(room)
      }));
      broadcastRoomState(room);

      // GDD Section 6: 3v3 dolunca maç otomatik başlar
      const humanCount = room.slots.filter(Boolean).length;
      if (room.status === 'lobby' && humanCount === 6) {
        startMatchInRoom(room);
      }
      return;
    }

    if (msg.type === 'switch_slot') {
      if (!ws.roomCode) return;
      const room = rooms.get(ws.roomCode);
      if (!room || room.status !== 'lobby') return;
      const targetSlot = Number(msg.slotIndex);
      if (targetSlot >= 0 && targetSlot < 6 && !room.slots[targetSlot]) {
        assignClientToSlot(room, ws, targetSlot);
        ws.send(JSON.stringify({
          type: 'slot_assigned',
          slotIndex: ws.slotIndex
        }));
        broadcastRoomState(room);
      }
      return;
    }

    if (msg.type === 'toggle_bots') {
      if (!ws.roomCode) return;
      const room = rooms.get(ws.roomCode);
      if (!room || room.status !== 'lobby') return;
      room.fillBots = !!msg.fillBots;
      broadcastRoomState(room);
      return;
    }

    if (msg.type === 'start_match') {
      if (!ws.roomCode) return;
      const room = rooms.get(ws.roomCode);
      if (!room || room.status !== 'lobby') return;
      startMatchInRoom(room);
      return;
    }

    if (msg.type === 'leave_room') {
      removeClientFromRoom(ws);
      ws.send(JSON.stringify({
        type: 'lobby_list',
        rooms: getPublicRoomList()
      }));
      return;
    }

    if (msg.type === 'ping_check') {
      ws.send(JSON.stringify({ type: 'pong_check', t: msg.t }));
    }
  });

  ws.on('close', () => {
    removeClientFromRoom(ws);
  });
});

// =============================================================================
// AUTHORITATIVE 60Hz GAME LOOP & 30Hz BINARY SNAPSHOT BROADCAST (GDD Section 7)
// =============================================================================
let serverTickCounter = 0;

setInterval(() => {
  serverTickCounter++;

  for (const room of rooms.values()) {
    if (room.status !== 'playing') continue;

    const world = room.world;

    // Update AI bots for slots without a connected human player
    for (let i = 0; i < 6; i++) {
      const p = world.players[i];
      if (!room.slots[i]) {
        p.isBot = true;
        if (room.fillBots) {
          p.inputMask = Physics.computeBotInput(world, p);
        } else {
          p.inputMask = 0;
        }
      }
    }

    // Advance deterministic physics by 1 tick (1/60s)
    Physics.stepWorld(world);

    // Broadcast high-priority gameplay events (Goals, Golden Goal, Overtime Boost, Saves)
    if (world.events.length > 0) {
      const eventMsg = JSON.stringify({
        type: 'game_events',
        tick: world.tick,
        events: world.events,
        score: world.score,
        phase: world.phase,
        lastScorerName: world.lastScorerName,
        lastScorerTeam: world.lastScorerTeam
      });
      for (const client of room.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(eventMsg);
        }
      }
    }

    // Check if match finished celebration timer expired -> return to room lobby (GDD Section 6)
    if (world.phase === Physics.MATCH_PHASE.FINISHED && world.phaseTimer <= 0) {
      room.status = 'lobby';
      world.phase = Physics.MATCH_PHASE.WAITING;
      broadcastRoomState(room);
      continue;
    }

    // Broadcast Binary ArrayBuffer Snapshot at 30Hz (every 2nd server tick)
    if (serverTickCounter % 2 === 0) {
      for (const client of room.clients) {
        if (client.readyState === WebSocket.OPEN) {
          const snapshotBuf = Physics.encodeBinarySnapshot(world, client.lastInputSeq);
          client.send(snapshotBuf, { binary: true });
        }
      }
    }
  }
}, 1000 / Physics.TICK_RATE);

server.listen(PORT, () => {
  console.log(`\n=============================================================`);
  console.log(`  REBOUND - 2D Isometric Arcade Football Server Running!`);
  console.log(`  URL: http://localhost:${PORT}`);
  console.log(`  Default Room Link: http://localhost:${PORT}/room/ANK-4091`);
  console.log(`=============================================================\n`);
});
