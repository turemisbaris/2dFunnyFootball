/**
 * REBOUND - Deterministic Custom 2D.5 (Isometric Z-Axis) Physics & Rules Engine
 * Shared between Authoritative Node.js Server and Browser Client (CSP & Reconciliation).
 * Zero external physics dependencies. Runs at fixed 60Hz (dt = 1/60s).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ReboundPhysics = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TICK_RATE = 60;
  const DT = 1 / TICK_RATE;
  const SNAPSHOT_RATE = 30;

  // Input Bitmask Flags
  const INPUT = {
    UP: 1 << 0,    // W
    DOWN: 1 << 1,  // S
    LEFT: 1 << 2,  // A
    RIGHT: 1 << 3, // D
    J: 1 << 4,     // Pass / Charged Shot (Offense) | Poke (Defense/GK)
    K: 1 << 5,     // Lob (Offense) | Slide Tackle (Defense) | Dive/Plonjon (GK)
    L: 1 << 6      // Knock-ahead / Shot Cancel (Offense) | Jockey (Defense) | Snap Pos (GK)
  };

  // Player Action States
  const STATE = {
    NORMAL: 0,
    CHARGING: 1,
    SLIDING: 2,
    DIVING: 3,
    STUNNED: 4,
    RECOVERY: 5,
    POKING: 6,
    JOCKEY: 7
  };

  // Match Phases
  const MATCH_PHASE = {
    WAITING: 0,
    COUNTDOWN: 1,
    PLAYING: 2,
    GOAL_SCORED: 3,
    OVERTIME: 4,
    FINISHED: 5
  };

  // Arena & Physics Constants (GDD Section 4, 5, 7)
  const CONFIG = {
    // Arena dimensions (logical court coordinates centered at 600, 340)
    ARENA_W: 1200,
    ARENA_H: 680,
    CORNER_BEVEL: 56,      // Diagonal corner bumpers so ball never traps
    GOAL_WIDTH: 196,       // Y span of goal mouth
    GOAL_DEPTH: 48,        // Depth of goal net
    PENALTY_W: 195,        // Penalty box width from goal line
    PENALTY_H: 350,        // Penalty box height
    WALL_RESTITUTION: 0.88,// GDD 5: Elastik duvarlar (e = 0.88)

    // Player physics
    PLAYER_RADIUS: 20,
    PLAYER_GK_DIVE_RADIUS: 33, // Extended hitbox during GK Plonjon (Dive)
    BASE_SPEED: 305,           // 1.0x Topsuz Oyuncu Hızı
    DRIBBLE_SPEED_MULT: 0.85,  // 0.85x Toplu Oyuncu Hızı (%15 hız cezası)
    CHARGE_MIN_SPEED_MULT: 0.40, // Şarj boyunca hız kademeli %40'a kadar düşer
    PLAYER_ACCEL: 2400,
    PLAYER_FRICTION: 11.5,
    PLAYER_HEIGHT: 28,         // Standard player Z-height hitbox
    GK_HEIGHT: 135,            // Goalkeeper passive aerial block Z-height

    // Soft-Magnet Dribble (GDD 4.1)
    MAGNET_CONE_HALF_ANGLE: Math.PI / 6, // 60° total cone (±30°)
    MAGNET_DIST: 37,                     // Front control distance from center
    MAGNET_HOLD_OFFSET: 27,              // Distance in front of player where ball locks
    TURN_LOSS_COS: -0.65,                // ~130°-180° sudden turn threshold

    // Shot Charge & Commitment (GDD 4.2)
    CHARGE_MAX_FRAMES: 36,               // 0.6s at 60Hz
    CHARGE_MAX_TURN_ANGLE: Math.PI / 4,  // ±45° turn restriction while charging
    PASS_SPEED: 570,
    SHOT_MIN_SPEED: 610,
    SHOT_MAX_SPEED: 1120,

    // Z-Axis & Lob (GDD 4.3)
    GRAVITY_Z: 920,
    LOB_XY_SPEED: 535,
    LOB_Z_SPEED: 455,
    BALL_BOUNCE_Z: 0.56,

    // Slide, Poke, Stun, Dive (GDD 4.4 & 5)
    SLIDE_SPEED_MULT: 1.8,               // 1.8x ivme
    SLIDE_FRAMES: 24,                    // 0.4s (24 frames)
    STUN_FRAMES: 16,                     // 16 frames (~0.26s) Sersemleme
    SLIDE_RECOVERY_FRAMES: 26,           // 26 frames (~0.43s) Toparlanma (boşa kayma)
    SLIDE_COOLDOWN_FRAMES: 150,          // 2.5s (150 frames) Cooldown

    POKE_FRAMES: 8,                      // Short poke duration
    POKE_COOLDOWN_FRAMES: 30,            // 0.5s Cooldown
    POKE_REACH: 50,

    DIVE_SPEED_MULT: 2.05,               // Plonjon burst
    DIVE_FRAMES: 18,                     // 0.3s active dive extension
    DIVE_RECOVERY_FRAMES: 48,            // 0.8s (48 frames) boşa uzanma cezası
    DIVE_COOLDOWN_FRAMES: 75,            // 1.25s cooldown after dive

    JOCKEY_FRAMES: 16,
    JOCKEY_COOLDOWN_FRAMES: 48,
    KNOCK_AHEAD_IMPULSE: 440,
    KNOCK_SPRINT_FRAMES: 22,

    // Ball physics
    BALL_RADIUS: 13,
    BALL_GROUND_FRICTION: 1.55,
    BALL_AIR_DRAG: 0.35,
    BALL_MAX_SPEED: 1450,

    // Match Rules (GDD 5)
    MATCH_DURATION_TICKS: 180 * 60,      // 3 minutes (180s)
    MAX_GOALS: 3,                        // First to 3 goals wins
    OVERTIME_BOOST_START_TICKS: 120 * 60,// After 2 minutes of Overtime
    OVERTIME_BOOST_INTERVAL_TICKS: 30 * 60, // Every 30s
    OVERTIME_BOOST_STEP: 0.10            // +10% max shot speed
  };

  // Spawn templates for 3v3 (0: GK, 1: MID, 2: FWD)
  const SPAWN_POSITIONS = {
    0: [ // Team 0: Orange (Left)
      { x: 115, y: 340, angle: 0, role: 'GK' },
      { x: 330, y: 230, angle: 0, role: 'MID' },
      { x: 465, y: 425, angle: 0, role: 'FWD' }
    ],
    1: [ // Team 1: Electric Blue (Right)
      { x: 1085, y: 340, angle: Math.PI, role: 'GK' },
      { x: 870, y: 450, angle: Math.PI, role: 'MID' },
      { x: 735, y: 255, angle: Math.PI, role: 'FWD' }
    ]
  };

  function clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
  }

  function normalizeAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  function angleDiff(target, current) {
    return normalizeAngle(target - current);
  }

  function createPlayer(slotIndex, team, roleIndex, name, isBot) {
    const spawn = SPAWN_POSITIONS[team][roleIndex];
    return {
      id: slotIndex,
      team: team,           // 0 = Orange, 1 = Blue
      roleIndex: roleIndex, // 0 = GK, 1 = MID, 2 = FWD
      role: spawn.role,
      name: name || (isBot ? `BOT-${spawn.role}` : `Oyuncu ${slotIndex + 1}`),
      isBot: !!isBot,

      // Kinematics
      x: spawn.x,
      y: spawn.y,
      vx: 0,
      vy: 0,
      angle: spawn.angle,

      // Contextual state & timers (in frames)
      state: STATE.NORMAL,
      stateTimer: 0,
      chargeFrames: 0,
      chargeLockAngle: 0,
      slideCooldown: 0,
      pokeCooldown: 0,
      jockeyCooldown: 0,
      sprintTimer: 0,
      dribbleLockout: 0,    // Frames before player can re-magnetize ball

      // Action flags
      actionHit: false,     // Whether slide or dive made valid contact
      hasBall: false,
      isGoalkeeper: roleIndex === 0, // True when inside own penalty box

      // Input tracking for edge triggers (press vs release)
      inputMask: 0,
      prevInputMask: 0,
      lastProcessedInputSeq: 0
    };
  }

  function createBall() {
    return {
      x: CONFIG.ARENA_W / 2,
      y: CONFIG.ARENA_H / 2,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      ownerId: -1,          // -1 if loose, 0..5 if held in soft-magnet cone
      lastTouchId: -1,
      lastTouchTeam: -1,
      wallBounceTick: -100
    };
  }

  function createWorldState() {
    const players = [];
    for (let i = 0; i < 6; i++) {
      const team = i < 3 ? 0 : 1;
      const roleIndex = i % 3;
      players.push(createPlayer(i, team, roleIndex, '', true));
    }
    return {
      tick: 0,
      phase: MATCH_PHASE.PLAYING,
      phaseTimer: 0,
      matchTicksRemaining: CONFIG.MATCH_DURATION_TICKS,
      overtimeTicks: 0,
      shotSpeedMultiplier: 1.0,
      score: [0, 0],
      winnerTeam: -1,
      lastScorerName: '',
      lastScorerTeam: -1,
      ball: createBall(),
      players: players,
      events: [] // Transient events for audio/VFX (wall hit, kick, stun, save, goal)
    };
  }

  function cloneWorldState(src) {
    return {
      tick: src.tick,
      phase: src.phase,
      phaseTimer: src.phaseTimer,
      matchTicksRemaining: src.matchTicksRemaining,
      overtimeTicks: src.overtimeTicks,
      shotSpeedMultiplier: src.shotSpeedMultiplier,
      score: [src.score[0], src.score[1]],
      winnerTeam: src.winnerTeam,
      lastScorerName: src.lastScorerName,
      lastScorerTeam: src.lastScorerTeam,
      ball: Object.assign({}, src.ball),
      players: src.players.map(p => Object.assign({}, p)),
      events: []
    };
  }

  function resetPositionsForKickoff(world) {
    world.ball.x = CONFIG.ARENA_W / 2;
    world.ball.y = CONFIG.ARENA_H / 2;
    world.ball.z = 0;
    world.ball.vx = 0;
    world.ball.vy = 0;
    world.ball.vz = 0;
    world.ball.ownerId = -1;

    for (let i = 0; i < world.players.length; i++) {
      const p = world.players[i];
      const spawn = SPAWN_POSITIONS[p.team][p.roleIndex];
      p.x = spawn.x;
      p.y = spawn.y;
      p.vx = 0;
      p.vy = 0;
      p.angle = spawn.angle;
      p.state = STATE.NORMAL;
      p.stateTimer = 0;
      p.chargeFrames = 0;
      p.slideCooldown = 0;
      p.pokeCooldown = 0;
      p.jockeyCooldown = 0;
      p.sprintTimer = 0;
      p.dribbleLockout = 0;
      p.actionHit = false;
      p.hasBall = false;
      p.isGoalkeeper = isInOwnPenaltyBox(p);
    }
  }

  /**
   * Checks if player is inside their own penalty area (GDD Section 5: Bölge Korumalı Kaleci)
   */
  function isInOwnPenaltyBox(p) {
    const cy = CONFIG.ARENA_H / 2;
    const halfH = CONFIG.PENALTY_H / 2;
    if (p.y < cy - halfH || p.y > cy + halfH) return false;
    if (p.team === 0) {
      return p.x <= CONFIG.PENALTY_W;
    } else {
      return p.x >= CONFIG.ARENA_W - CONFIG.PENALTY_W;
    }
  }

  /**
   * Release ball from current owner if any
   */
  function releaseBall(world, lockoutFrames) {
    if (world.ball.ownerId !== -1) {
      const prevOwner = world.players[world.ball.ownerId];
      if (prevOwner) {
        prevOwner.hasBall = false;
        if (prevOwner.state === STATE.CHARGING) {
          prevOwner.state = STATE.NORMAL;
          prevOwner.chargeFrames = 0;
        }
        if (lockoutFrames) {
          prevOwner.dribbleLockout = Math.max(prevOwner.dribbleLockout, lockoutFrames);
        }
      }
      world.ball.ownerId = -1;
    }
  }

  /**
   * Compute Overtime Shot Speed Multiplier (GDD Section 5: Emniyet Kuralı)
   * After 2 minutes of Overtime, every 30s max shot speed increases by +10%
   */
  function computeOvertimeMultiplier(overtimeTicks) {
    if (overtimeTicks < CONFIG.OVERTIME_BOOST_START_TICKS) return 1.0;
    const extraTicks = overtimeTicks - CONFIG.OVERTIME_BOOST_START_TICKS;
    const steps = 1 + Math.floor(extraTicks / CONFIG.OVERTIME_BOOST_INTERVAL_TICKS);
    return 1.0 + steps * CONFIG.OVERTIME_BOOST_STEP;
  }

  /**
   * Step a single player's input, movement, and contextual actions
   */
  function stepPlayer(world, p) {
    const mask = p.inputMask;
    const prev = p.prevInputMask;
    const jPressed = (mask & INPUT.J) !== 0 && (prev & INPUT.J) === 0;
    const jHeld = (mask & INPUT.J) !== 0;
    const jReleased = (mask & INPUT.J) === 0 && (prev & INPUT.J) !== 0;
    const kPressed = (mask & INPUT.K) !== 0 && (prev & INPUT.K) === 0;
    const lPressed = (mask & INPUT.L) !== 0 && (prev & INPUT.L) === 0;

    // Decrement cooldowns
    if (p.slideCooldown > 0) p.slideCooldown--;
    if (p.pokeCooldown > 0) p.pokeCooldown--;
    if (p.jockeyCooldown > 0) p.jockeyCooldown--;
    if (p.sprintTimer > 0) p.sprintTimer--;
    if (p.dribbleLockout > 0) p.dribbleLockout--;

    // Check Goalkeeper zone status (GDD Section 5)
    p.isGoalkeeper = isInOwnPenaltyBox(p);
    // Passive: Goalkeeper cannot be stunned!
    if (p.isGoalkeeper && p.state === STATE.STUNNED) {
      p.state = STATE.NORMAL;
      p.stateTimer = 0;
    }

    // Desired 8-way movement vector from WASD
    let dx = 0;
    let dy = 0;
    if (mask & INPUT.UP) dy -= 1;
    if (mask & INPUT.DOWN) dy += 1;
    if (mask & INPUT.LEFT) dx -= 1;
    if (mask & INPUT.RIGHT) dx += 1;
    if (dx !== 0 && dy !== 0) {
      const inv = 1 / Math.SQRT2;
      dx *= inv;
      dy *= inv;
    }
    const hasMoveInput = dx !== 0 || dy !== 0;
    const inputAngle = hasMoveInput ? Math.atan2(dy, dx) : p.angle;

    // Handle active timed states (STUNNED, RECOVERY, SLIDING, DIVING, POKING, JOCKEY)
    if (p.state === STATE.STUNNED || p.state === STATE.RECOVERY) {
      // Cannot steer or trigger actions while Stunned (16f) or in Recovery (26f / 48f)
      p.vx -= p.vx * CONFIG.PLAYER_FRICTION * DT;
      p.vy -= p.vy * CONFIG.PLAYER_FRICTION * DT;
      p.stateTimer--;
      if (p.stateTimer <= 0) {
        p.state = STATE.NORMAL;
      }
      p.prevInputMask = mask;
      return;
    }

    if (p.state === STATE.SLIDING) {
      // Maintain slide impulse with slight decay
      p.vx *= 0.975;
      p.vy *= 0.975;
      p.stateTimer--;
      if (p.stateTimer <= 0) {
        // GDD 4.4: Boşa kayma -> 26 frame (~0.43s) Toparlanma cezası
        if (!p.actionHit) {
          p.state = STATE.RECOVERY;
          p.stateTimer = CONFIG.SLIDE_RECOVERY_FRAMES;
          p.vx *= 0.2;
          p.vy *= 0.2;
          world.events.push({ type: 'whiff', x: p.x, y: p.y, playerId: p.id });
        } else {
          p.state = STATE.NORMAL;
        }
        p.slideCooldown = CONFIG.SLIDE_COOLDOWN_FRAMES; // 2.5s cooldown
      }
      p.prevInputMask = mask;
      return;
    }

    if (p.state === STATE.DIVING) {
      p.vx *= 0.96;
      p.vy *= 0.96;
      p.stateTimer--;
      if (p.stateTimer <= 0) {
        // GDD 5: Boşa uzanma cezası 0.8 saniye (48 frames)
        if (!p.actionHit) {
          p.state = STATE.RECOVERY;
          p.stateTimer = CONFIG.DIVE_RECOVERY_FRAMES;
          p.vx *= 0.15;
          p.vy *= 0.15;
        } else {
          p.state = STATE.NORMAL;
        }
        p.slideCooldown = CONFIG.DIVE_COOLDOWN_FRAMES;
      }
      p.prevInputMask = mask;
      return;
    }

    if (p.state === STATE.POKING || p.state === STATE.JOCKEY) {
      p.stateTimer--;
      if (p.stateTimer <= 0) {
        p.state = STATE.NORMAL;
      }
    }

    // =========================================================================
    // CONTEXT 1: HÜCUM (TOP KONTROLDEYKEN) - p.hasBall === true
    // =========================================================================
    if (p.hasBall && world.ball.ownerId === p.id) {
      // Check Sudden 180° Turn Momentum Loss (GDD 4.1)
      const currentSpeed = Math.hypot(p.vx, p.vy);
      if (hasMoveInput && currentSpeed > CONFIG.BASE_SPEED * 0.55 && p.state !== STATE.CHARGING) {
        const moveCos = (p.vx * dx + p.vy * dy) / currentSpeed;
        if (moveCos < CONFIG.TURN_LOSS_COS) {
          // Top momentumunu koruyarak koniden çıkar ve 1-2 metre ayağından açılır!
          const prevVx = p.vx;
          const prevVy = p.vy;
          const norm = Math.hypot(prevVx, prevVy) || 1;
          releaseBall(world, 20);
          world.ball.vx = prevVx * 1.35 + (prevVx / norm) * 95;
          world.ball.vy = prevVy * 1.35 + (prevVy / norm) * 95;
          world.events.push({ type: 'turn_loss', x: p.x, y: p.y, playerId: p.id });
        }
      }

      // If still holding the ball:
      if (p.hasBall) {
        // 1) Start or Continue Charging J (GDD 4.2)
        if (jPressed && p.state !== STATE.CHARGING) {
          p.state = STATE.CHARGING;
          p.chargeFrames = 1;
          p.chargeLockAngle = p.angle;
        } else if (p.state === STATE.CHARGING && jHeld) {
          if (p.chargeFrames < CONFIG.CHARGE_MAX_FRAMES) {
            p.chargeFrames++;
          }
          // Shot Cancel with L while charging! (GDD 4.2: Şut İptali)
          if (lPressed) {
            p.state = STATE.NORMAL;
            p.chargeFrames = 0;
            // Softly nudge ball sideways and give agility step
            const cutAngle = hasMoveInput ? inputAngle : (p.angle + Math.PI / 3);
            p.angle = cutAngle;
            p.vx = Math.cos(cutAngle) * CONFIG.BASE_SPEED * 0.92;
            p.vy = Math.sin(cutAngle) * CONFIG.BASE_SPEED * 0.92;
            world.events.push({ type: 'shot_cancel', x: p.x, y: p.y, playerId: p.id });
            p.prevInputMask = mask;
            return;
          }
        }

        // 2) Release J -> Execute Ground Pass (tap) or Charged Shot (hold)
        if (p.state === STATE.CHARGING && jReleased) {
          const chargeRatio = clamp(p.chargeFrames / CONFIG.CHARGE_MAX_FRAMES, 0, 1);
          const isTapPass = p.chargeFrames <= 7;
          let kickAngle = p.angle;

          // Subtle pass target assist within ±12° for quick ground pass
          if (isTapPass) {
            let bestScore = Infinity;
            for (let i = 0; i < world.players.length; i++) {
              const mate = world.players[i];
              if (mate.team === p.team && mate.id !== p.id) {
                const toMateAngle = Math.atan2(mate.y - p.y, mate.x - p.x);
                const diff = Math.abs(angleDiff(toMateAngle, kickAngle));
                if (diff < 0.21 && diff < bestScore) { // ~12 degrees
                  bestScore = diff;
                  kickAngle = toMateAngle;
                }
              }
            }
          }

          const shotMult = world.shotSpeedMultiplier || 1.0;
          const speed = isTapPass
            ? CONFIG.PASS_SPEED
            : (CONFIG.SHOT_MIN_SPEED + (CONFIG.SHOT_MAX_SPEED - CONFIG.SHOT_MIN_SPEED) * chargeRatio) * shotMult;

          releaseBall(world, 15);
          world.ball.x = p.x + Math.cos(kickAngle) * (CONFIG.PLAYER_RADIUS + CONFIG.BALL_RADIUS + 3);
          world.ball.y = p.y + Math.sin(kickAngle) * (CONFIG.PLAYER_RADIUS + CONFIG.BALL_RADIUS + 3);
          world.ball.vx = Math.cos(kickAngle) * speed + p.vx * 0.18;
          world.ball.vy = Math.sin(kickAngle) * speed + p.vy * 0.18;
          // Slight rising drive on heavy shots, keeping it under GK head height
          world.ball.vz = isTapPass ? 0 : chargeRatio * 145;
          world.ball.lastTouchId = p.id;
          world.ball.lastTouchTeam = p.team;

          p.state = STATE.NORMAL;
          p.chargeFrames = 0;
          world.events.push({
            type: isTapPass ? 'pass' : 'shot',
            power: chargeRatio,
            x: world.ball.x,
            y: world.ball.y,
            playerId: p.id
          });
          p.prevInputMask = mask;
          return;
        }

        // 3) K Key on Offense -> Aşırtma Pas / Lob (Z Ekseni Vuruşu - GDD 4.3)
        if (kPressed) {
          const lobAngle = hasMoveInput ? inputAngle : p.angle;
          p.angle = lobAngle;
          releaseBall(world, 18);
          world.ball.x = p.x + Math.cos(lobAngle) * (CONFIG.PLAYER_RADIUS + CONFIG.BALL_RADIUS + 2);
          world.ball.y = p.y + Math.sin(lobAngle) * (CONFIG.PLAYER_RADIUS + CONFIG.BALL_RADIUS + 2);
          world.ball.vx = Math.cos(lobAngle) * CONFIG.LOB_XY_SPEED + p.vx * 0.25;
          world.ball.vy = Math.sin(lobAngle) * CONFIG.LOB_XY_SPEED + p.vy * 0.25;
          world.ball.vz = CONFIG.LOB_Z_SPEED;
          world.ball.z = Math.max(world.ball.z, 6);
          world.ball.lastTouchId = p.id;
          world.ball.lastTouchTeam = p.team;
          p.state = STATE.NORMAL;
          p.chargeFrames = 0;
          world.events.push({ type: 'lob', x: world.ball.x, y: world.ball.y, playerId: p.id });
          p.prevInputMask = mask;
          return;
        }

        // 4) L Key on Offense (when not charging) -> Dürtme / Çalım / Depar (Knock-ahead)
        if (lPressed && p.state !== STATE.CHARGING) {
          const knockAngle = hasMoveInput ? inputAngle : p.angle;
          p.angle = knockAngle;
          releaseBall(world, 12);
          world.ball.x = p.x + Math.cos(knockAngle) * (CONFIG.PLAYER_RADIUS + CONFIG.BALL_RADIUS + 5);
          world.ball.y = p.y + Math.sin(knockAngle) * (CONFIG.PLAYER_RADIUS + CONFIG.BALL_RADIUS + 5);
          world.ball.vx = Math.cos(knockAngle) * CONFIG.KNOCK_AHEAD_IMPULSE + p.vx * 0.35;
          world.ball.vy = Math.sin(knockAngle) * CONFIG.KNOCK_AHEAD_IMPULSE + p.vy * 0.35;
          world.ball.vz = 55; // tiny hop
          world.ball.lastTouchId = p.id;
          world.ball.lastTouchTeam = p.team;
          p.sprintTimer = CONFIG.KNOCK_SPRINT_FRAMES; // brief sprint boost to chase knock-ahead
          world.events.push({ type: 'knock', x: world.ball.x, y: world.ball.y, playerId: p.id });
          p.prevInputMask = mask;
          return;
        }
      }
    } else {
      // =========================================================================
      // CONTEXT 2 & 3: SAVUNMA (TOPSUZ / RAKİPTEYKEN) & KALECİ (CEZA SAHASINDA)
      // =========================================================================
      if (p.state === STATE.CHARGING) {
        p.state = STATE.NORMAL;
        p.chargeFrames = 0;
      }

      // J Key: Ayak Koyma / Pres (Poke) - GDD 4.4 (0.5s cooldown, breaks magnet, no stun)
      if (jPressed && p.pokeCooldown <= 0) {
        if (hasMoveInput) p.angle = inputAngle;
        p.state = STATE.POKING;
        p.stateTimer = CONFIG.POKE_FRAMES;
        p.pokeCooldown = CONFIG.POKE_COOLDOWN_FRAMES;
        p.vx += Math.cos(p.angle) * 140;
        p.vy += Math.sin(p.angle) * 140;
        performPokeCheck(world, p);
        world.events.push({ type: 'poke', x: p.x, y: p.y, playerId: p.id });
      }

      // K Key: Contextual!
      // Inside Own Penalty Box -> Plonjon / Uzanma (Dive) (GDD 5)
      // Outside Own Penalty Box -> Ayağa Kayma (Slide Tackle) (GDD 4.4)
      if (kPressed && p.slideCooldown <= 0) {
        if (hasMoveInput) p.angle = inputAngle;
        if (p.isGoalkeeper) {
          p.state = STATE.DIVING;
          p.stateTimer = CONFIG.DIVE_FRAMES;
          p.actionHit = false;
          const diveSpeed = CONFIG.BASE_SPEED * CONFIG.DIVE_SPEED_MULT;
          p.vx = Math.cos(p.angle) * diveSpeed;
          p.vy = Math.sin(p.angle) * diveSpeed;
          world.events.push({ type: 'dive', x: p.x, y: p.y, playerId: p.id });
        } else {
          p.state = STATE.SLIDING;
          p.stateTimer = CONFIG.SLIDE_FRAMES;
          p.actionHit = false;
          const slideSpeed = CONFIG.BASE_SPEED * CONFIG.SLIDE_SPEED_MULT;
          p.vx = Math.cos(p.angle) * slideSpeed;
          p.vy = Math.sin(p.angle) * slideSpeed;
          world.events.push({ type: 'slide', x: p.x, y: p.y, playerId: p.id });
        }
        p.prevInputMask = mask;
        return;
      }

      // L Key: Contextual!
      // Inside Own Penalty Box -> Pozisyon Düzeltme (Goal-line Bisector Alignment)
      // Outside Own Penalty Box -> Omuz Omuza / Denge (Jockey)
      if (lPressed && p.jockeyCooldown <= 0) {
        p.state = STATE.JOCKEY;
        p.stateTimer = CONFIG.JOCKEY_FRAMES;
        p.jockeyCooldown = CONFIG.JOCKEY_COOLDOWN_FRAMES;
        if (p.isGoalkeeper) {
          // Snap angle toward ball and nudge toward ideal goal-protecting line
          const goalX = p.team === 0 ? 55 : CONFIG.ARENA_W - 55;
          const goalY = CONFIG.ARENA_H / 2;
          const targetY = clamp(goalY + (world.ball.y - goalY) * 0.42, goalY - 85, goalY + 85);
          const toIdealX = goalX - p.x;
          const toIdealY = targetY - p.y;
          const dist = Math.hypot(toIdealX, toIdealY) || 1;
          p.vx = (toIdealX / dist) * CONFIG.BASE_SPEED * 1.15;
          p.vy = (toIdealY / dist) * CONFIG.BASE_SPEED * 1.15;
          p.angle = Math.atan2(world.ball.y - p.y, world.ball.x - p.x);
        } else {
          if (hasMoveInput) p.angle = inputAngle;
          p.vx += Math.cos(p.angle) * 165;
          p.vy += Math.sin(p.angle) * 165;
        }
        world.events.push({ type: 'jockey', x: p.x, y: p.y, playerId: p.id });
      }
    }

    // =========================================================================
    // MOVEMENT & FACING ANGLE (WITH GDD 4.1 & 4.2 CONSTRAINTS)
    // =========================================================================
    let speedMult = 1.0;
    if (p.hasBall) {
      // GDD 4.1: Toplu Oyuncu Hızı 0.85x
      speedMult = CONFIG.DRIBBLE_SPEED_MULT;
      if (p.state === STATE.CHARGING) {
        // GDD 4.2: Şarj süresi boyunca koşu hızı kademeli olarak %40'a kadar düşer
        const chargeProgress = clamp(p.chargeFrames / CONFIG.CHARGE_MAX_FRAMES, 0, 1);
        speedMult = CONFIG.DRIBBLE_SPEED_MULT - (CONFIG.DRIBBLE_SPEED_MULT - CONFIG.CHARGE_MIN_SPEED_MULT) * chargeProgress;
      }
    } else if (p.sprintTimer > 0) {
      speedMult = 1.16;
    }

    // Update facing angle
    if (p.state === STATE.CHARGING) {
      // GDD 4.2: Şarj başladığı andan itibaren oyuncu sadece ±45° komşu açılara meyledebilir
      if (hasMoveInput) {
        const diffFromLock = clamp(
          angleDiff(inputAngle, p.chargeLockAngle),
          -CONFIG.CHARGE_MAX_TURN_ANGLE,
          CONFIG.CHARGE_MAX_TURN_ANGLE
        );
        p.angle = normalizeAngle(p.chargeLockAngle + diffFromLock);
      }
    } else if (hasMoveInput) {
      const diff = angleDiff(inputAngle, p.angle);
      p.angle = normalizeAngle(p.angle + diff * 0.38);
    }

    // Apply acceleration and friction
    const maxSpeed = CONFIG.BASE_SPEED * speedMult;
    if (hasMoveInput) {
      let moveAngle = inputAngle;
      if (p.state === STATE.CHARGING) {
        // Also constrain movement direction during charge commitment
        moveAngle = p.angle;
      }
      const targetVx = Math.cos(moveAngle) * maxSpeed;
      const targetVy = Math.sin(moveAngle) * maxSpeed;
      p.vx += (targetVx - p.vx) * Math.min(1, CONFIG.PLAYER_ACCEL * DT / maxSpeed);
      p.vy += (targetVy - p.vy) * Math.min(1, CONFIG.PLAYER_ACCEL * DT / maxSpeed);
    } else {
      p.vx -= p.vx * CONFIG.PLAYER_FRICTION * DT;
      p.vy -= p.vy * CONFIG.PLAYER_FRICTION * DT;
      if (Math.hypot(p.vx, p.vy) < 4) {
        p.vx = 0;
        p.vy = 0;
      }
    }

    p.prevInputMask = mask;
  }

  /**
   * Short-range Poke (Ayak Koyma - J on Defense) breaks opponent magnet link without stunning
   */
  function performPokeCheck(world, poker) {
    const ball = world.ball;
    const tipX = poker.x + Math.cos(poker.angle) * 24;
    const tipY = poker.y + Math.sin(poker.angle) * 24;
    const distToBall = Math.hypot(ball.x - tipX, ball.y - tipY);

    if (distToBall <= CONFIG.POKE_REACH && ball.z <= CONFIG.PLAYER_HEIGHT + 8) {
      releaseBall(world, 24);
      const pokeAngle = Math.atan2(ball.y - poker.y, ball.x - poker.x);
      ball.vx = Math.cos(pokeAngle) * 430 + poker.vx * 0.4;
      ball.vy = Math.sin(pokeAngle) * 430 + poker.vy * 0.4;
      ball.lastTouchId = poker.id;
      ball.lastTouchTeam = poker.team;
      world.events.push({ type: 'poke_hit', x: ball.x, y: ball.y, playerId: poker.id });
    }
  }

  /**
   * Integrate positions, resolve Player-Player, Player-Wall, Ball-Wall, Z-Axis, and Soft-Magnet
   */
  function stepPhysics(world) {
    const ball = world.ball;
    const players = world.players;

    // 1. Integrate player positions & constrain to arena walls
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      p.x += p.vx * DT;
      p.y += p.vy * DT;
      constrainPlayerToArena(p);
      p.isGoalkeeper = isInOwnPenaltyBox(p);
    }

    // 2. Player-Player Circle Collisions (including Slide Stun & Jockey)
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        resolvePlayerPlayerCollision(world, players[i], players[j]);
      }
    }

    // 3. Ball integration & Soft-Magnet Dribble
    if (ball.ownerId !== -1) {
      const owner = players[ball.ownerId];
      if (!owner || owner.state === STATE.STUNNED || owner.state === STATE.RECOVERY) {
        releaseBall(world, 18);
      } else {
        // GDD 4.1: Top bu koniye girdiğinde hızı oyuncunun hızına kilitlenir (v_top = v_oyuncu)
        const targetX = owner.x + Math.cos(owner.angle) * CONFIG.MAGNET_HOLD_OFFSET;
        const targetY = owner.y + Math.sin(owner.angle) * CONFIG.MAGNET_HOLD_OFFSET;
        ball.x += (targetX - ball.x) * 0.55 + owner.vx * DT;
        ball.y += (targetY - ball.y) * 0.55 + owner.vy * DT;
        ball.vx = owner.vx;
        ball.vy = owner.vy;
        ball.z = 0;
        ball.vz = 0;
        owner.hasBall = true;
        ball.lastTouchId = owner.id;
        ball.lastTouchTeam = owner.team;
      }
    }

    if (ball.ownerId === -1) {
      // Free ball kinematics + 1D Z-Axis Gravity (GDD 7: Z_hiz -= g)
      ball.x += ball.vx * DT;
      ball.y += ball.vy * DT;

      if (ball.z > 0 || ball.vz !== 0) {
        ball.vz -= CONFIG.GRAVITY_Z * DT;
        ball.z += ball.vz * DT;
        if (ball.z <= 0) {
          ball.z = 0;
          if (Math.abs(ball.vz) > 65) {
            ball.vz = -ball.vz * CONFIG.BALL_BOUNCE_Z;
            world.events.push({ type: 'bounce', x: ball.x, y: ball.y });
          } else {
            ball.vz = 0;
          }
        }
      }

      // Ground friction vs Air drag
      const drag = ball.z > 2 ? CONFIG.BALL_AIR_DRAG : CONFIG.BALL_GROUND_FRICTION;
      ball.vx -= ball.vx * drag * DT;
      ball.vy -= ball.vy * drag * DT;

      const bSpeed = Math.hypot(ball.vx, ball.vy);
      if (bSpeed > CONFIG.BALL_MAX_SPEED) {
        const scale = CONFIG.BALL_MAX_SPEED / bSpeed;
        ball.vx *= scale;
        ball.vy *= scale;
      } else if (bSpeed < 3 && ball.z === 0) {
        ball.vx = 0;
        ball.vy = 0;
      }
    }

    // 4. Player-Ball interactions (Soft-Magnet Capture, Slide/Dive deflections, GK Aerial Block)
    for (let i = 0; i < players.length; i++) {
      resolvePlayerBallInteraction(world, players[i], ball);
    }

    // 5. Bumper Wall Collisions (e = 0.88) & Goal Detection
    const scoredTeam = resolveBallArenaAndGoals(world, ball);
    if (scoredTeam !== -1 && (world.phase === MATCH_PHASE.PLAYING || world.phase === MATCH_PHASE.OVERTIME)) {
      handleGoalScored(world, scoredTeam);
    }
  }

  /**
   * Player-Player collision resolution + Slide Tackle Stun (GDD 4.4)
   */
  function resolvePlayerPlayerCollision(world, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    const minDist = CONFIG.PLAYER_RADIUS * 2;
    if (dist >= minDist || dist === 0) return;

    const nx = dx / dist;
    const ny = dy / dist;
    const overlap = minDist - dist;

    // Separate circles
    a.x -= nx * overlap * 0.5;
    a.y -= ny * overlap * 0.5;
    b.x += nx * overlap * 0.5;
    b.y += ny * overlap * 0.5;

    // Check Slide Tackle impacts (GDD 4.4: Başarılı Temas -> 16 frame Stun, top sahipsiz kalır)
    if (a.state === STATE.SLIDING && a.team !== b.team) {
      a.actionHit = true;
      applySlideImpact(world, a, b, nx, ny);
    }
    if (b.state === STATE.SLIDING && b.team !== a.team) {
      b.actionHit = true;
      applySlideImpact(world, b, a, -nx, -ny);
    }

    // Check Jockey / Omuz Omuza physical bump (L key on defense)
    if (a.state === STATE.JOCKEY && a.team !== b.team) {
      b.vx += nx * 240;
      b.vy += ny * 240;
      if (b.hasBall) {
        releaseBall(world, 20);
        world.ball.vx += nx * 260;
        world.ball.vy += ny * 260;
      }
    }
    if (b.state === STATE.JOCKEY && b.team !== a.team) {
      a.vx -= nx * 240;
      a.vy -= ny * 240;
      if (a.hasBall) {
        releaseBall(world, 20);
        world.ball.vx -= nx * 260;
        world.ball.vy -= ny * 260;
      }
    }

    // Elastic velocity exchange
    const rvx = b.vx - a.vx;
    const rvy = b.vy - a.vy;
    const velAlongNormal = rvx * nx + rvy * ny;
    if (velAlongNormal < 0) {
      const impulse = -0.65 * velAlongNormal;
      a.vx -= impulse * nx;
      a.vy -= impulse * ny;
      b.vx += impulse * nx;
      b.vy += impulse * ny;
    }
  }

  function applySlideImpact(world, slider, victim, nx, ny) {
    // Release ball if victim had it
    if (victim.hasBall && world.ball.ownerId === victim.id) {
      releaseBall(world, 28);
      world.ball.vx = nx * 360 + slider.vx * 0.45;
      world.ball.vy = ny * 360 + slider.vy * 0.45;
      world.ball.vz = 90;
      world.ball.lastTouchId = slider.id;
      world.ball.lastTouchTeam = slider.team;
    }
    // GDD Section 5: Goalkeeper inside own penalty box is IMMUNE to Stun!
    if (!victim.isGoalkeeper) {
      victim.state = STATE.STUNNED;
      victim.stateTimer = CONFIG.STUN_FRAMES; // 16 frames (~0.26s)
      victim.vx = nx * 220;
      victim.vy = ny * 220;
      world.events.push({ type: 'stun', x: victim.x, y: victim.y, playerId: victim.id, byId: slider.id });
    } else {
      world.events.push({ type: 'gk_armor', x: victim.x, y: victim.y, playerId: victim.id });
    }
  }

  /**
   * Player-Ball Interaction:
   * - Z-Axis Height check (GDD 4.3 & Section 5 GK Aerial Block)
   * - GK Plonjon (Dive) extended hitbox save
   * - Slide tackle ball sweep
   * - Soft-Magnet 60° front cone capture (GDD 4.1)
   */
  function resolvePlayerBallInteraction(world, p, ball) {
    if (p.state === STATE.STUNNED || p.state === STATE.RECOVERY) return;
    if (ball.ownerId === p.id) return;

    const dx = ball.x - p.x;
    const dy = ball.y - p.y;
    const dist = Math.hypot(dx, dy);

    // Effective hitbox radius (Extended during GK Plonjon / Dive! GDD Section 5)
    const pRadius = p.state === STATE.DIVING ? CONFIG.PLAYER_GK_DIVE_RADIUS : CONFIG.PLAYER_RADIUS;
    const minDist = pRadius + CONFIG.BALL_RADIUS;

    // 1. Z-Axis Check (GDD 4.3 & 5)
    if (ball.z > CONFIG.PLAYER_HEIGHT) {
      // Standard ground players are bypassed by aerial balls!
      // Exception: Goalkeeper in own penalty box blocks aerial balls with their height!
      if (p.isGoalkeeper && ball.z <= CONFIG.GK_HEIGHT && dist <= minDist + 4) {
        const nx = dist > 0 ? dx / dist : Math.cos(p.angle);
        const ny = dist > 0 ? dy / dist : Math.sin(p.angle);
        ball.z = CONFIG.PLAYER_HEIGHT;
        ball.vz = -Math.abs(ball.vz) * 0.45 - 60; // Knocked down off keeper's head/hands
        ball.vx = nx * 360 + p.vx * 0.4;
        ball.vy = ny * 360 + p.vy * 0.4;
        ball.lastTouchId = p.id;
        ball.lastTouchTeam = p.team;
        if (p.state === STATE.DIVING) p.actionHit = true;
        world.events.push({ type: 'gk_save', x: ball.x, y: ball.y, playerId: p.id });
      }
      return;
    }

    // 2. Check Soft-Magnet 60° Front Cone Capture (GDD 4.1)
    if (
      p.dribbleLockout <= 0 &&
      p.state !== STATE.SLIDING &&
      p.state !== STATE.DIVING &&
      dist <= CONFIG.MAGNET_DIST
    ) {
      const angleToBall = Math.atan2(dy, dx);
      const angleErr = Math.abs(angleDiff(angleToBall, p.angle));
      const ballSpeed = Math.hypot(ball.vx, ball.vy);

      // Can capture if inside ±30° (60° total) cone and ball isn't a point-blank rocket from someone else
      if (angleErr <= CONFIG.MAGNET_CONE_HALF_ANGLE) {
        if (ball.ownerId === -1 && (ballSpeed < 780 || p.isGoalkeeper)) {
          ball.ownerId = p.id;
          p.hasBall = true;
          ball.z = 0;
          ball.vz = 0;
          ball.lastTouchId = p.id;
          ball.lastTouchTeam = p.team;
          return;
        }
      }
    }

    // 3. Physical Circle-Circle collision with the ball (body rebound, slide tackle sweep, GK dive save)
    if (dist < minDist && dist > 0) {
      const nx = dx / dist;
      const ny = dy / dist;
      const overlap = minDist - dist;

      if (p.state === STATE.DIVING) {
        // GK Plonjon (Dive) parry!
        p.actionHit = true;
        releaseBall(world, 22);
        ball.x += nx * (overlap + 4);
        ball.y += ny * (overlap + 4);
        const deflectSpeed = Math.max(540, Math.hypot(ball.vx, ball.vy) * 0.85);
        ball.vx = nx * deflectSpeed + p.vx * 0.35;
        ball.vy = ny * deflectSpeed + p.vy * 0.35;
        ball.lastTouchId = p.id;
        ball.lastTouchTeam = p.team;
        world.events.push({ type: 'gk_save', x: ball.x, y: ball.y, playerId: p.id });
        return;
      }

      if (p.state === STATE.SLIDING) {
        // Slide tackle sweeps the ball cleanly
        p.actionHit = true;
        releaseBall(world, 22);
        ball.x += nx * (overlap + 4);
        ball.y += ny * (overlap + 4);
        ball.vx = Math.cos(p.angle) * 520 + nx * 160;
        ball.vy = Math.sin(p.angle) * 520 + ny * 160;
        ball.vz = 75;
        ball.lastTouchId = p.id;
        ball.lastTouchTeam = p.team;
        world.events.push({ type: 'slide_hit', x: ball.x, y: ball.y, playerId: p.id });
        return;
      }

      // If ball is loose and hits player body outside magnet cone, bounce or trap
      if (ball.ownerId === -1) {
        ball.x += nx * overlap;
        ball.y += ny * overlap;
        const rvx = ball.vx - p.vx;
        const rvy = ball.vy - p.vy;
        const vn = rvx * nx + rvy * ny;
        if (vn < 0) {
          ball.vx -= (1 + 0.55) * vn * nx;
          ball.vy -= (1 + 0.55) * vn * ny;
        }
        ball.lastTouchId = p.id;
        ball.lastTouchTeam = p.team;
      }
    }
  }

  /**
   * Keep player inside closed arena + corner bevels
   */
  function constrainPlayerToArena(p) {
    const r = CONFIG.PLAYER_RADIUS;
    const cy = CONFIG.ARENA_H / 2;
    const goalHalf = CONFIG.GOAL_WIDTH / 2;
    const inGoalMouthY = p.y > cy - goalHalf + r * 0.6 && p.y < cy + goalHalf - r * 0.6;

    const minX = inGoalMouthY ? -CONFIG.GOAL_DEPTH + r : r;
    const maxX = inGoalMouthY ? CONFIG.ARENA_W + CONFIG.GOAL_DEPTH - r : CONFIG.ARENA_W - r;

    if (p.x < minX) { p.x = minX; if (p.vx < 0) p.vx = 0; }
    if (p.x > maxX) { p.x = maxX; if (p.vx > 0) p.vx = 0; }
    if (p.y < r) { p.y = r; if (p.vy < 0) p.vy = 0; }
    if (p.y > CONFIG.ARENA_H - r) { p.y = CONFIG.ARENA_H - r; if (p.vy > 0) p.vy = 0; }

    // Corner bevel planes: x + y >= B, (W - x) + y >= B, etc.
    const bevel = CONFIG.CORNER_BEVEL + r * 0.8;
    const corners = [
      { cx: 0, cy: 0, nx: Math.SQRT1_2, ny: Math.SQRT1_2 },
      { cx: CONFIG.ARENA_W, cy: 0, nx: -Math.SQRT1_2, ny: Math.SQRT1_2 },
      { cx: 0, cy: CONFIG.ARENA_H, nx: Math.SQRT1_2, ny: -Math.SQRT1_2 },
      { cx: CONFIG.ARENA_W, cy: CONFIG.ARENA_H, nx: -Math.SQRT1_2, ny: -Math.SQRT1_2 }
    ];
    for (let i = 0; i < corners.length; i++) {
      const c = corners[i];
      const dist = (p.x - c.cx) * c.nx + (p.y - c.cy) * c.ny;
      if (dist < bevel * Math.SQRT1_2) {
        const push = bevel * Math.SQRT1_2 - dist;
        p.x += c.nx * push;
        p.y += c.ny * push;
      }
    }
  }

  /**
   * Elastic Bumper Wall Physics (e = 0.88) & Goal Line Detection (GDD Section 5)
   * Returns 0 if Team 0 scored (in Right goal), 1 if Team 1 scored (in Left goal), or -1.
   */
  function resolveBallArenaAndGoals(world, ball) {
    const r = CONFIG.BALL_RADIUS;
    const e = CONFIG.WALL_RESTITUTION; // 0.88
    const cy = CONFIG.ARENA_H / 2;
    const goalTop = cy - CONFIG.GOAL_WIDTH / 2;
    const goalBot = cy + CONFIG.GOAL_WIDTH / 2;

    // Top & Bottom Bumper Walls
    if (ball.y < r) {
      ball.y = r;
      if (ball.vy < 0) {
        ball.vy = -ball.vy * e;
        onWallBounce(world, ball, ball.x, 0);
      }
    } else if (ball.y > CONFIG.ARENA_H - r) {
      ball.y = CONFIG.ARENA_H - r;
      if (ball.vy > 0) {
        ball.vy = -ball.vy * e;
        onWallBounce(world, ball, ball.x, CONFIG.ARENA_H);
      }
    }

    // Corner Bevel Bumpers (45° elastic bumpers prevent corner deadlocks)
    const bevel = CONFIG.CORNER_BEVEL;
    const corners = [
      { cx: 0, cy: 0, nx: Math.SQRT1_2, ny: Math.SQRT1_2 },
      { cx: CONFIG.ARENA_W, cy: 0, nx: -Math.SQRT1_2, ny: Math.SQRT1_2 },
      { cx: 0, cy: CONFIG.ARENA_H, nx: Math.SQRT1_2, ny: -Math.SQRT1_2 },
      { cx: CONFIG.ARENA_W, cy: CONFIG.ARENA_H, nx: -Math.SQRT1_2, ny: -Math.SQRT1_2 }
    ];
    const minCornerProj = bevel * Math.SQRT1_2 + r;
    for (let i = 0; i < corners.length; i++) {
      const c = corners[i];
      const proj = (ball.x - c.cx) * c.nx + (ball.y - c.cy) * c.ny;
      if (proj < minCornerProj) {
        const push = minCornerProj - proj;
        ball.x += c.nx * push;
        ball.y += c.ny * push;
        const vn = ball.vx * c.nx + ball.vy * c.ny;
        if (vn < 0) {
          ball.vx -= (1 + e) * vn * c.nx;
          ball.vy -= (1 + e) * vn * c.ny;
          onWallBounce(world, ball, ball.x, ball.y);
        }
      }
    }

    // Goal Post Circle Collisions (4 posts at x=0 and x=ARENA_W, y=goalTop and y=goalBot)
    const posts = [
      { x: 0, y: goalTop },
      { x: 0, y: goalBot },
      { x: CONFIG.ARENA_W, y: goalTop },
      { x: CONFIG.ARENA_W, y: goalBot }
    ];
    const postRadius = 7;
    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      const dx = ball.x - post.x;
      const dy = ball.y - post.y;
      const dist = Math.hypot(dx, dy);
      if (dist < r + postRadius && dist > 0) {
        const nx = dx / dist;
        const ny = dy / dist;
        ball.x = post.x + nx * (r + postRadius);
        ball.y = post.y + ny * (r + postRadius);
        const vn = ball.vx * nx + ball.vy * ny;
        if (vn < 0) {
          ball.vx -= (1 + 0.9) * vn * nx;
          ball.vy -= (1 + 0.9) * vn * ny;
          onWallBounce(world, ball, post.x, post.y);
        }
      }
    }

    // Left & Right Walls vs Goal Mouths
    const inGoalY = ball.y > goalTop + r * 0.4 && ball.y < goalBot - r * 0.4;
    if (!inGoalY) {
      if (ball.x < r) {
        ball.x = r;
        if (ball.vx < 0) {
          ball.vx = -ball.vx * e;
          onWallBounce(world, ball, 0, ball.y);
        }
      } else if (ball.x > CONFIG.ARENA_W - r) {
        ball.x = CONFIG.ARENA_W - r;
        if (ball.vx > 0) {
          ball.vx = -ball.vx * e;
          onWallBounce(world, ball, CONFIG.ARENA_W, ball.y);
        }
      }
    } else {
      // Ball crossed into Left Goal (Team 1 Blue scores!)
      if (ball.x < -r * 0.6) {
        return 1;
      }
      // Ball crossed into Right Goal (Team 0 Orange scores!)
      if (ball.x > CONFIG.ARENA_W + r * 0.6) {
        return 0;
      }
    }

    return -1;
  }

  function onWallBounce(world, ball, wx, wy) {
    if (ball.ownerId !== -1) {
      releaseBall(world, 8);
    }
    world.ball.wallBounceTick = world.tick;
    world.events.push({ type: 'wall', x: wx, y: wy });
  }

  function handleGoalScored(world, scoringTeam) {
    releaseBall(world, 30);
    world.score[scoringTeam]++;
    world.lastScorerTeam = scoringTeam;
    const touchPlayer = world.players[world.ball.lastTouchId];
    world.lastScorerName = touchPlayer ? touchPlayer.name : (scoringTeam === 0 ? 'TURUNCU TAKIM' : 'MAVİ TAKIM');

    world.events.push({
      type: 'goal',
      team: scoringTeam,
      scorerName: world.lastScorerName,
      score: [world.score[0], world.score[1]]
    });

    // Check immediate Win Condition: Golden Goal (Overtime) or First to 3 Goals (GDD Section 5)
    if (world.phase === MATCH_PHASE.OVERTIME || world.score[scoringTeam] >= CONFIG.MAX_GOALS) {
      world.phase = MATCH_PHASE.FINISHED;
      world.winnerTeam = scoringTeam;
      world.phaseTimer = 240; // 4 seconds celebration before returning/reset
    } else {
      world.phase = MATCH_PHASE.GOAL_SCORED;
      world.phaseTimer = 135; // 2.25s brief celebration then kickoff
    }
  }

  /**
   * Advance the entire deterministic world by 1 tick (1/60s)
   */
  function stepWorld(world) {
    world.tick++;
    world.events.length = 0;

    if (world.phase === MATCH_PHASE.COUNTDOWN) {
      world.phaseTimer--;
      if (world.phaseTimer <= 0) {
        world.phase = MATCH_PHASE.PLAYING;
        world.events.push({ type: 'whistle_start' });
      }
      return;
    }

    if (world.phase === MATCH_PHASE.GOAL_SCORED) {
      // Let ball roll inside goal net with high damping during brief celebration
      world.ball.x += world.ball.vx * DT;
      world.ball.y += world.ball.vy * DT;
      world.ball.vx *= 0.92;
      world.ball.vy *= 0.92;
      world.ball.y = clamp(world.ball.y, CONFIG.ARENA_H / 2 - CONFIG.GOAL_WIDTH / 2 + 12, CONFIG.ARENA_H / 2 + CONFIG.GOAL_WIDTH / 2 - 12);
      world.ball.x = clamp(world.ball.x, -CONFIG.GOAL_DEPTH + 12, CONFIG.ARENA_W + CONFIG.GOAL_DEPTH - 12);

      world.phaseTimer--;
      if (world.phaseTimer <= 0) {
        resetPositionsForKickoff(world);
        world.phase = MATCH_PHASE.PLAYING;
        world.events.push({ type: 'kickoff' });
      }
      return;
    }

    if (world.phase === MATCH_PHASE.FINISHED) {
      if (world.phaseTimer > 0) world.phaseTimer--;
      return;
    }

    // Match Clock & Overtime Transition (GDD Section 5: Zero-Stoppage Golden Goal)
    if (world.phase === MATCH_PHASE.PLAYING) {
      if (world.matchTicksRemaining > 0) {
        world.matchTicksRemaining--;
      }
      if (world.matchTicksRemaining <= 0) {
        if (world.score[0] !== world.score[1]) {
          world.phase = MATCH_PHASE.FINISHED;
          world.winnerTeam = world.score[0] > world.score[1] ? 0 : 1;
          world.phaseTimer = 240;
          world.events.push({ type: 'match_end', winnerTeam: world.winnerTeam });
          return;
        } else {
          // GDD Section 5: Süre bittiğinde skor eşitse oyun duraksamadan akar -> ALTIN GOL!
          world.phase = MATCH_PHASE.OVERTIME;
          world.overtimeTicks = 0;
          world.events.push({ type: 'golden_goal_start' });
        }
      }
    } else if (world.phase === MATCH_PHASE.OVERTIME) {
      world.overtimeTicks++;
      const prevMult = world.shotSpeedMultiplier;
      world.shotSpeedMultiplier = computeOvertimeMultiplier(world.overtimeTicks);
      if (world.shotSpeedMultiplier > prevMult) {
        world.events.push({ type: 'overtime_boost', multiplier: world.shotSpeedMultiplier });
      }
    }

    // Step all players & physics
    for (let i = 0; i < world.players.length; i++) {
      stepPlayer(world, world.players[i]);
    }
    stepPhysics(world);
  }

  /**
   * Tactical Role-Based 3v3 AI Bot Controller (GK, MID, FWD)
   * Generates a valid contextual `inputMask` (WASD + J, K, L) for bot players.
   */
  function computeBotInput(world, bot) {
    if (world.phase !== MATCH_PHASE.PLAYING && world.phase !== MATCH_PHASE.OVERTIME) {
      return 0;
    }
    if (bot.state === STATE.STUNNED || bot.state === STATE.RECOVERY) {
      return 0;
    }

    const ball = world.ball;
    const isOrange = bot.team === 0;
    const attackDir = isOrange ? 1 : -1;
    const enemyGoalX = isOrange ? CONFIG.ARENA_W : 0;
    const ownGoalX = isOrange ? 0 : CONFIG.ARENA_W;
    const goalCenterY = CONFIG.ARENA_H / 2;

    let mask = 0;

    // Helper to convert desired target (tx, ty) to 8-way WASD flags
    function moveToward(tx, ty, stopRadius) {
      const dx = tx - bot.x;
      const dy = ty - bot.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= (stopRadius || 12)) return;
      if (dx > 14) mask |= INPUT.RIGHT;
      else if (dx < -14) mask |= INPUT.LEFT;
      if (dy > 14) mask |= INPUT.DOWN;
      else if (dy < -14) mask |= INPUT.UP;
    }

    // CASE 1: Bot currently has the ball (HÜCUM)
    if (bot.hasBall && ball.ownerId === bot.id) {
      const distToEnemyGoal = Math.hypot(enemyGoalX - bot.x, goalCenterY - bot.y);

      // Steer toward enemy goal with slight evasion of nearest defender
      let targetY = goalCenterY + Math.sin(world.tick * 0.05 + bot.id) * 65;
      moveToward(enemyGoalX, targetY, 5);

      // If GK has ball in own box, pass forward or lob to teammate quickly
      if (bot.role === 'GK') {
        if (bot.state !== STATE.CHARGING) {
          mask |= INPUT.J; // Start pass
        }
        return mask;
      }

      // Check if an opponent is sliding right at the bot -> Lob (K) or Knock-ahead (L)
      for (let i = 0; i < world.players.length; i++) {
        const opp = world.players[i];
        if (opp.team !== bot.team) {
          const dOpp = Math.hypot(opp.x - bot.x, opp.y - bot.y);
          if (opp.state === STATE.SLIDING && dOpp < 130) {
            mask |= INPUT.K; // Lob over sliding defender!
            return mask;
          }
        }
      }

      // If within shooting range, hold J to charge shot, release when charged
      if (distToEnemyGoal < 470) {
        const targetCharge = distToEnemyGoal < 260 ? 14 : 26;
        if (bot.chargeFrames < targetCharge) {
          mask |= INPUT.J; // Hold J to charge
        } else {
          // Release J to fire!
          mask &= ~INPUT.J;
        }
      } else if ((world.tick + bot.id * 19) % 95 === 0) {
        // Occasional quick pass or knock-ahead sprint
        mask |= (bot.role === 'FWD') ? INPUT.L : INPUT.J;
      }
      return mask;
    }

    // CASE 2: Bot does NOT have the ball (SAVUNMA / POZİSYON ALMA)
    const distToBall = Math.hypot(ball.x - bot.x, ball.y - bot.y);
    const ballOwner = ball.ownerId !== -1 ? world.players[ball.ownerId] : null;
    const teamHasBall = ballOwner && ballOwner.team === bot.team;

    if (bot.role === 'GK') {
      // Goalkeeper stays in own penalty box, tracks ball Y and bisects angle
      const homeX = isOrange ? 95 : CONFIG.ARENA_W - 95;
      const clampY = clamp(goalCenterY + (ball.y - goalCenterY) * 0.52, goalCenterY - 110, goalCenterY + 110);

      // If ball is loose right inside own penalty box, go grab or poke it
      const ballInOwnBox = isOrange ? (ball.x < CONFIG.PENALTY_W + 30) : (ball.x > CONFIG.ARENA_W - CONFIG.PENALTY_W - 30);
      if (ballInOwnBox && Math.abs(ball.y - goalCenterY) < CONFIG.PENALTY_H / 2 && distToBall < 180) {
        moveToward(ball.x, ball.y, 4);
      } else {
        moveToward(homeX, clampY, 10);
      }

      // Active GK Plonjon (Dive - K) when fast shot is heading toward own goal!
      const shotApproaching = isOrange ? (ball.vx < -340 && ball.x < 340) : (ball.vx > 340 && ball.x > CONFIG.ARENA_W - 340);
      if (shotApproaching && distToBall < 135 && distToBall > 28 && bot.slideCooldown <= 0) {
        moveToward(ball.x + ball.vx * 0.08, ball.y + ball.vy * 0.08, 2);
        mask |= INPUT.K; // Trigger GK Dive (Plonjon)!
      } else if (distToBall < 48 && ballOwner && ballOwner.team !== bot.team && bot.pokeCooldown <= 0) {
        mask |= INPUT.J; // Poke
      }
      return mask;
    }

    // Determine if this field bot (MID or FWD) is the closest non-GK teammate to the ball
    let isClosestChaser = true;
    for (let i = 0; i < world.players.length; i++) {
      const mate = world.players[i];
      if (mate.team === bot.team && mate.id !== bot.id && mate.role !== 'GK') {
        if (Math.hypot(ball.x - mate.x, ball.y - mate.y) < distToBall - 25) {
          isClosestChaser = false;
        }
      }
    }

    if (!teamHasBall && isClosestChaser) {
      // Press the ball / ball carrier!
      moveToward(ball.x + ball.vx * 0.08, ball.y + ball.vy * 0.08, 4);

      if (ballOwner && ballOwner.team !== bot.team) {
        if (distToBall < 48 && bot.pokeCooldown <= 0) {
          mask |= INPUT.J; // Poke (Ayak Koyma)
        } else if (distToBall > 58 && distToBall < 125 && bot.slideCooldown <= 0 && (world.tick + bot.id * 13) % 35 === 0) {
          mask |= INPUT.K; // Slide Tackle (Ayağa Kayma)
        }
      }
    } else {
      // Tactical off-the-ball positioning based on role (MID vs FWD)
      if (bot.role === 'MID') {
        const supportX = clamp(ball.x - attackDir * 190, 220, CONFIG.ARENA_W - 220);
        const supportY = ball.y < goalCenterY ? goalCenterY + 115 : goalCenterY - 115;
        moveToward(supportX, supportY, 22);
      } else {
        // FWD pushes high into offensive space
        const fwdX = clamp(ball.x + attackDir * 210, 280, CONFIG.ARENA_W - 280);
        const fwdY = ball.y < goalCenterY ? goalCenterY + 135 : goalCenterY - 135;
        moveToward(fwdX, fwdY, 22);
      }
    }

    return mask;
  }

  // ===========================================================================
  // COMPACT BINARY PROTOCOL (GDD Section 7: WebSocket Binary ArrayBuffer)
  // ===========================================================================
  // Packet Type 1 (Server -> Client Snapshot): 68 bytes total!
  //   Header (12 bytes):
  //     [0]     Uint8   packetType (1 = SNAPSHOT)
  //     [1]     Uint8   phase | (winnerTeam + 1) << 4
  //     [2..3]  Uint16  tick (mod 65536)
  //     [4..5]  Uint16  matchTicksRemaining (or overtimeTicks in OVERTIME)
  //     [6]     Uint8   score0
  //     [7]     Uint8   score1
  //     [8]     Uint8   shotSpeedMultiplier * 10 (e.g. 10 = 1.0x, 12 = 1.2x)
  //     [9]     Int8    ball.ownerId
  //     [10..11] Uint16 lastAckSeq for recipient player
  //   Ball (8 bytes):
  //     [12..13] Int16  ball.x * 10
  //     [14..15] Int16  ball.y * 10
  //     [16..17] Int16  ball.z * 10
  //     [18]     Int8   clamp(ball.vx / 12, -127, 127)
  //     [19]     Int8   clamp(ball.vy / 12, -127, 127)
  //   6 Players x 8 bytes = 48 bytes (Offsets 20..67):
  //     +0..1  Int16  p.x * 10
  //     +2..3  Int16  p.y * 10
  //     +4     Int8   clamp(p.vx / 6, -127, 127)
  //     +5     Int8   clamp(p.vy / 6, -127, 127)
  //     +6     Int8   Math.round(p.angle * (127 / Math.PI))
  //     +7     Uint8  (p.state & 0x07) | ((p.isGoalkeeper ? 1 : 0) << 3) | (Math.min(15, Math.floor(p.chargeFrames / 2.4)) << 4)
  // Total = 12 + 8 + 48 = 68 bytes (~8 bytes per entity as specified in GDD Section 7!)

  const PACKET_TYPE = {
    SNAPSHOT: 1,
    INPUT: 2
  };

  function encodeBinarySnapshot(world, ackSeq) {
    const buf = new ArrayBuffer(68);
    const view = new DataView(buf);

    view.setUint8(0, PACKET_TYPE.SNAPSHOT);
    const encodedPhase = (world.phase & 0x0F) | (((world.winnerTeam + 1) & 0x0F) << 4);
    view.setUint8(1, encodedPhase);
    view.setUint16(2, world.tick & 0xFFFF, true);
    const clockTicks = world.phase === MATCH_PHASE.OVERTIME ? world.overtimeTicks : world.matchTicksRemaining;
    view.setUint16(4, clamp(clockTicks, 0, 65535), true);
    view.setUint8(6, world.score[0]);
    view.setUint8(7, world.score[1]);
    view.setUint8(8, Math.round((world.shotSpeedMultiplier || 1.0) * 10));
    view.setInt8(9, world.ball.ownerId);
    view.setUint16(10, (ackSeq || 0) & 0xFFFF, true);

    // Ball (8 bytes)
    view.setInt16(12, Math.round(world.ball.x * 10), true);
    view.setInt16(14, Math.round(world.ball.y * 10), true);
    view.setInt16(16, Math.round(world.ball.z * 10), true);
    view.setInt8(18, clamp(Math.round(world.ball.vx / 12), -127, 127));
    view.setInt8(19, clamp(Math.round(world.ball.vy / 12), -127, 127));

    // 6 Players (8 bytes each = 48 bytes)
    for (let i = 0; i < 6; i++) {
      const p = world.players[i];
      const base = 20 + i * 8;
      view.setInt16(base + 0, Math.round(p.x * 10), true);
      view.setInt16(base + 2, Math.round(p.y * 10), true);
      view.setInt8(base + 4, clamp(Math.round(p.vx / 6), -127, 127));
      view.setInt8(base + 5, clamp(Math.round(p.vy / 6), -127, 127));
      view.setInt8(base + 6, clamp(Math.round((p.angle / Math.PI) * 127), -127, 127));
      const chargeNibble = clamp(Math.round((p.chargeFrames / CONFIG.CHARGE_MAX_FRAMES) * 15), 0, 15);
      const packedFlags = (p.state & 0x07) | ((p.isGoalkeeper ? 1 : 0) << 3) | (chargeNibble << 4);
      view.setUint8(base + 7, packedFlags);
    }

    return buf;
  }

  function decodeBinarySnapshot(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    if (view.getUint8(0) !== PACKET_TYPE.SNAPSHOT) return null;

    const encodedPhase = view.getUint8(1);
    const phase = encodedPhase & 0x0F;
    const winnerTeam = ((encodedPhase >> 4) & 0x0F) - 1;
    const tick = view.getUint16(2, true);
    const clockTicks = view.getUint16(4, true);
    const score0 = view.getUint8(6);
    const score1 = view.getUint8(7);
    const shotSpeedMultiplier = view.getUint8(8) / 10;
    const ownerId = view.getInt8(9);
    const ackSeq = view.getUint16(10, true);

    const ball = {
      x: view.getInt16(12, true) / 10,
      y: view.getInt16(14, true) / 10,
      z: view.getInt16(16, true) / 10,
      vx: view.getInt8(18) * 12,
      vy: view.getInt8(19) * 12,
      ownerId: ownerId
    };

    const players = [];
    for (let i = 0; i < 6; i++) {
      const base = 20 + i * 8;
      const packedFlags = view.getUint8(base + 7);
      const state = packedFlags & 0x07;
      const isGoalkeeper = ((packedFlags >> 3) & 1) === 1;
      const chargeNibble = (packedFlags >> 4) & 0x0F;
      players.push({
        id: i,
        x: view.getInt16(base + 0, true) / 10,
        y: view.getInt16(base + 2, true) / 10,
        vx: view.getInt8(base + 4) * 6,
        vy: view.getInt8(base + 5) * 6,
        angle: (view.getInt8(base + 6) / 127) * Math.PI,
        state: state,
        isGoalkeeper: isGoalkeeper,
        chargeFrames: Math.round((chargeNibble / 15) * CONFIG.CHARGE_MAX_FRAMES),
        hasBall: ownerId === i
      });
    }

    return {
      tick,
      phase,
      winnerTeam,
      clockTicks,
      score: [score0, score1],
      shotSpeedMultiplier,
      ackSeq,
      ball,
      players
    };
  }

  // Client -> Server Binary Input Packet (4 bytes):
  //   [0] Uint8  PACKET_TYPE.INPUT (2)
  //   [1] Uint8  inputMask (WASD + JKL)
  //   [2..3] Uint16 inputSeq
  function encodeBinaryInput(inputMask, seq) {
    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    view.setUint8(0, PACKET_TYPE.INPUT);
    view.setUint8(1, inputMask & 0xFF);
    view.setUint16(2, seq & 0xFFFF, true);
    return buf;
  }

  function decodeBinaryInput(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    if (view.byteLength < 4 || view.getUint8(0) !== PACKET_TYPE.INPUT) return null;
    return {
      inputMask: view.getUint8(1),
      seq: view.getUint16(2, true)
    };
  }

  return {
    TICK_RATE,
    DT,
    SNAPSHOT_RATE,
    INPUT,
    STATE,
    MATCH_PHASE,
    CONFIG,
    SPAWN_POSITIONS,
    PACKET_TYPE,
    clamp,
    normalizeAngle,
    angleDiff,
    createPlayer,
    createBall,
    createWorldState,
    cloneWorldState,
    resetPositionsForKickoff,
    isInOwnPenaltyBox,
    stepPlayer,
    stepPhysics,
    stepWorld,
    computeBotInput,
    encodeBinarySnapshot,
    decodeBinarySnapshot,
    encodeBinaryInput,
    decodeBinaryInput
  };
});
