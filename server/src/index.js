// Plunder: A Pirate's Life - Server Entry Point
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import cors from 'cors';
import { EVENTS, GAME_PHASES, TURN_PHASES, TRADE_KNOWLEDGE } from '../../shared/constants.js';
import {
  createRoom, joinRoom, removePlayer, getRoom,
  getRoomBySocketId, getPublicRoomState, changeColor, reconnectPlayer,
  updateSettings,
} from './rooms.js';
import {
  createGameState, getPublicGameState, pickStartingIsland,
  getAvailableStartingIslands, drawResources, rollSailingDie,
  moveShip, undoMove, buildItem, attackIsland, attackShip, endTurn, calculatePlunderPoints,
  collectTreasure, resolveTreasureSteal, resolveTreasureStormDiscard, resolveTreasureFreeUpgrade, resolveStormCost, cancelStormMove,
  merchantBankTrade, canTrade, proposeTreaty, resolveTreaty,
  shiplessRoll, shiplessExchangePP, shiplessExchangeGold,
  shiplessDisownIsland, shiplessChooseResource,
  submitBribeOffer, resolveAttackBribe, cancelPendingAttackForPlayer,
  rerollSailingDie, rerollShiplessDie, rerollCombatDie, skipCombatReroll,
  jettisonCannons, forceEndTurn,
} from './gameState.js';
import {
  startTurnTimers, stopTurnTimers, handleSkipVote, onPlayerDisconnectDuringVote,
} from './turnTimer.js';
import { logger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.NODE_ENV === 'production'
      ? (process.env.ALLOWED_ORIGIN
          ? [process.env.ALLOWED_ORIGIN]
          : process.env.RAILWAY_PUBLIC_DOMAIN
            ? [`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`]
            : false)
      : ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
    methods: ['GET', 'POST'],
  },
});

app.use(cors());
app.use(express.json());

// Serve static frontend in production
const clientBuildPath = join(__dirname, '../../client/dist');
app.use(express.static(clientBuildPath));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// API endpoint for room info (for invite links)
app.get('/api/room/:code', (req, res) => {
  const room = getRoom(req.params.code);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json(getPublicRoomState(room));
});

// Bug report endpoint — creates a GitHub Issue
app.post('/api/bugs', async (req, res) => {
  const { description, playerName, roomCode, url, userAgent } = req.body;
  if (!description || typeof description !== 'string' || !description.trim()) {
    return res.status(400).json({ error: 'Description is required' });
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    logger.error('github_token_missing', { endpoint: '/api/bugs' });
    return res.status(500).json({ error: 'Bug reporting is not configured' });
  }

  // Normalize optional context
  const trimmed = description.trim();
  const reporter = (typeof playerName === 'string' && playerName.trim()) ? playerName.trim() : 'Anonymous';
  const code = (typeof roomCode === 'string' && roomCode.trim()) ? roomCode.trim().toUpperCase() : null;
  const reportedUrl = (typeof url === 'string' && url.trim()) ? url.trim() : null;
  const ua = (typeof userAgent === 'string' && userAgent.trim()) ? userAgent.trim() : null;

  const title = trimmed.length > 80 ? trimmed.slice(0, 77) + '...' : trimmed;

  // Assemble a rich issue body: description first, then a context table
  // (player / room / URL / UA / timestamp) that's easy to skim.
  const contextLines = [
    `- **Reported by:** ${reporter}`,
    `- **Room code:** ${code ? '`' + code + '`' : '_not in a game_'}`,
    `- **URL:** ${reportedUrl || '_unknown_'}`,
    `- **User agent:** ${ua ? '`' + ua + '`' : '_unknown_'}`,
    `- **Submitted:** ${new Date().toISOString()}`,
  ];
  let body = `${trimmed}\n\n---\n\n### Context\n${contextLines.join('\n')}`;

  // If we have a room code and a matching per-game log on disk, point the
  // AI / reviewer at the /api/game-log endpoint so it can pull the session
  // log for context. We don't embed the whole log in the issue body since
  // it can be thousands of lines.
  if (code) {
    const logEntries = logger.readGameLog(code, 1);
    if (logEntries.length > 0) {
      body += `\n- **Game log:** available on the server at ` +
              `\`server/logs/games/${code}.jsonl\` ` +
              `(fetch via \`GET /api/game-log/${code}?logToken=...\`).`;
    }
  }

  try {
    const ghRes = await fetch('https://api.github.com/repos/RohanSamAgarwal/Plunder/issues', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title,
        body,
        labels: ['bug', 'in-game bug report'],
      }),
    });

    if (!ghRes.ok) {
      const err = await ghRes.text();
      logger.error('github_api_error', { status: ghRes.status, body: err });
      return res.status(500).json({ error: 'Failed to create bug report' });
    }

    const issue = await ghRes.json();
    logger.info('bug_report_created', { issueNumber: issue.number, reporter, code });
    if (code) {
      logger.gameLog(code, 'bug_report_created', {
        issueNumber: issue.number, reporter, description: trimmed,
      });
    }
    res.json({ success: true, issueNumber: issue.number });
  } catch (err) {
    logger.error('bug_report_failed', { message: err?.message, stack: err?.stack });
    res.status(500).json({ error: 'Failed to create bug report' });
  }
});

// Fetch a per-game log by room code. Access is gated by the logToken that
// was issued when the room was created (and included in the first line of
// the game log). Anyone who was in the game will have it in localStorage.
app.get('/api/game-log/:code', (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  const provided = req.query.logToken
    || (req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.slice(7)
        : null);
  if (!provided) return res.status(401).json({ error: 'logToken required' });

  const entries = logger.readGameLog(code);
  if (entries.length === 0) {
    return res.status(404).json({ error: 'No log for that room code' });
  }
  // The first entry is room_created with the logToken. Verify it.
  const first = entries[0];
  const expected = first?.logToken;
  if (!expected || expected !== provided) {
    return res.status(403).json({ error: 'Invalid logToken for this room' });
  }
  // Strip the logToken from the first entry before returning to avoid leaking
  // it back through the API response.
  const sanitizedFirst = { ...first };
  delete sanitizedFirst.logToken;
  const returned = [sanitizedFirst, ...entries.slice(1)];
  res.json({ code, count: returned.length, entries: returned });
});

// Admin: fetch the most recent log entries. Requires LOG_ACCESS_TOKEN env var
// to be set on the server; caller provides it via `?token=` or Authorization
// header. If LOG_ACCESS_TOKEN is unset, the endpoint returns 503 so it can't be
// scraped from a misconfigured deploy.
app.get('/api/logs/recent', (req, res) => {
  const serverToken = process.env.LOG_ACCESS_TOKEN;
  if (!serverToken) {
    return res.status(503).json({ error: 'Log access not configured (set LOG_ACCESS_TOKEN)' });
  }
  const provided = req.query.token
    || (req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.slice(7)
        : null);
  if (!provided || provided !== serverToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const limit = Math.min(parseInt(req.query.limit, 10) || 500, 5000);
  const level = req.query.level; // optional filter: 'info' | 'warn' | 'error'
  let entries = logger.readRecent(limit);
  if (level) entries = entries.filter(e => e.level === level);
  res.json({ count: entries.length, entries });
});

// === SOCKET.IO HANDLERS ===

io.on('connection', (socket) => {
  logger.info('socket_connected', { socketId: socket.id });

  socket.on('error', (err) => {
    logger.error('socket_error', { socketId: socket.id, message: err?.message, stack: err?.stack });
  });

  // --- LOBBY ---

  socket.on(EVENTS.CREATE_ROOM, ({ name }, callback) => {
    const room = createRoom(socket.id, name);
    socket.join(room.code);
    const player = room.players[0];
    callback({
      code: room.code,
      playerId: player.id,
      sessionToken: player.sessionToken,
      logToken: room.logToken,
      room: getPublicRoomState(room),
    });
    // Record the room's log token as the very first line of the per-game log
    // so that later fetches can verify access without relying on in-memory
    // room state (which is lost on server restart).
    logger.gameLog(room.code, 'room_created', {
      hostName: name, hostId: player.id, logToken: room.logToken,
    });
  });

  socket.on(EVENTS.JOIN_ROOM, ({ code, name, sessionToken }, callback) => {
    // Try reconnection first
    if (sessionToken) {
      const result = reconnectPlayer(code, sessionToken, socket.id);
      if (result.room) {
        socket.join(result.room.code);
        const room = result.room;
        callback({
          code: room.code,
          playerId: result.player.id,
          sessionToken: result.player.sessionToken,
          logToken: room.logToken,
          room: getPublicRoomState(room),
          reconnected: true,
          gameState: room.gameState
            ? getPublicGameState(room.gameState, result.player.id)
            : null,
        });
        socket.to(room.code).emit(EVENTS.PLAYER_RECONNECTED, {
          playerId: result.player.id,
          name: result.player.name,
        });
        logger.gameLog(room.code, 'player_reconnected', {
          name: result.player.name,
          playerId: result.player.id,
        });
        return;
      }
      logger.warn('reconnect_failed', { code, reason: 'invalid_session_or_room' });
    }

    const result = joinRoom(code, socket.id, name);
    if (result.error) {
      callback({ error: result.error });
      return;
    }

    const { room, player } = result;
    socket.join(room.code);
    callback({
      code: room.code,
      playerId: player.id,
      sessionToken: player.sessionToken,
      logToken: room.logToken,
      room: getPublicRoomState(room),
    });

    socket.to(room.code).emit(EVENTS.PLAYER_JOINED, {
      player: {
        id: player.id,
        name: player.name,
        color: player.color,
      },
      room: getPublicRoomState(room),
    });

    logger.gameLog(room.code, 'player_joined', { name, playerId: player.id });
  });

  socket.on(EVENTS.CHOOSE_COLOR, ({ color }, callback) => {
    const found = getRoomBySocketId(socket.id);
    if (!found) return callback({ error: 'Not in a room' });

    const result = changeColor(found.room.code, found.player.id, color);
    if (result.error) return callback({ error: result.error });

    callback({ success: true });
    io.to(found.room.code).emit(EVENTS.COLOR_CHOSEN, {
      room: getPublicRoomState(found.room),
    });
  });

  socket.on(EVENTS.UPDATE_SETTINGS, ({ settings }, callback) => {
    const found = getRoomBySocketId(socket.id);
    if (!found) return callback?.({ error: 'Not in a room' });

    const result = updateSettings(found.room.code, found.player.id, settings);
    if (result.error) return callback?.({ error: result.error });

    callback?.({ success: true, settings: result.settings });
    io.to(found.room.code).emit(EVENTS.SETTINGS_UPDATED, {
      room: getPublicRoomState(found.room),
    });
  });

  socket.on(EVENTS.CHAT_MESSAGE, ({ message }) => {
    const found = getRoomBySocketId(socket.id);
    if (!found) return;

    io.to(found.room.code).emit(EVENTS.CHAT_BROADCAST, {
      playerId: found.player.id,
      name: found.player.name,
      message,
      timestamp: Date.now(),
    });
  });

  // --- START GAME ---

  socket.on(EVENTS.START_GAME, (_, callback) => {
    const found = getRoomBySocketId(socket.id);
    if (!found) return callback({ error: 'Not in a room' });
    if (found.player.id !== found.room.hostId) return callback({ error: 'Only host can start' });
    if (found.room.players.length < 2) return callback({ error: 'Need at least 2 players' });

    const room = found.room;
    room.started = true;

    // Create game state with room settings
    const gamePlayers = room.players.map(p => ({
      id: p.id,
      name: p.name,
      color: p.color,
    }));
    room.gameState = createGameState(gamePlayers, room.players.length, room.settings);

    // Send personalized state to each player
    for (const player of room.players) {
      const sock = io.sockets.sockets.get(player.socketId);
      if (sock) {
        sock.emit(EVENTS.GAME_STARTED, {
          gameState: getPublicGameState(room.gameState, player.id),
          yourPlayerId: player.id,
          startingIslands: getAvailableStartingIslands(room.gameState),
        });
      }
    }

    callback({ success: true });
    logger.gameLog(room.code, 'game_started', {
      players: room.players.map(p => ({ id: p.id, name: p.name, color: p.color })),
      settings: room.settings,
    });
  });

  // --- GAMEPLAY ---

  socket.on(EVENTS.PICK_STARTING_ISLAND, ({ islandId }, callback) => {
    const found = getRoomBySocketId(socket.id);
    if (!found || !found.room.gameState) return callback?.({ error: 'No game' });

    const state = found.room.gameState;
    const result = pickStartingIsland(state, found.player.id, islandId);
    if (result.error) return callback?.({ error: result.error });

    logger.gameLog(found.room.code, 'starting_island_picked', {
      playerId: found.player.id,
      playerName: found.player.name,
      islandId,
    });

    // Start turn timers when gameplay begins
    if (state.phase === 'gameplay') {
      startTurnTimers(found.room, io, broadcastGameState);
      logger.gameLog(found.room.code, 'gameplay_phase_begin', {
        firstPlayer: state.players[state.turnOrder[state.currentPlayerIndex]]?.name,
      });
    }

    broadcastGameState(found.room);

    callback?.({
      success: true,
      drawn: result.drawn,
      startingIslands: getAvailableStartingIslands(state),
    });
  });

  socket.on(EVENTS.DRAW_RESOURCES, (_, callback) => {
    const found = getRoomBySocketId(socket.id);
    if (!found || !found.room.gameState) return callback?.({ error: 'No game' });

    const state = found.room.gameState;
    if (state.turnOrder[state.currentPlayerIndex] !== found.player.id) {
      return callback?.({ error: 'Not your turn' });
    }

    const result = drawResources(state, found.player.id);
    broadcastGameState(found.room);
    callback?.(result);

    if (result.drawn && result.drawn.length > 0) {
      // To drawing player only — includes resource details
      socket.emit(EVENTS.RESOURCES_DRAWN, {
        playerName: found.player.name,
        playerId: found.player.id,
        drawn: result.drawn,
        count: result.drawn.length,
      });
      // To everyone else — count only (resource types are private)
      socket.to(found.room.code).emit(EVENTS.RESOURCES_DRAWN, {
        playerName: found.player.name,
        playerId: found.player.id,
        count: result.drawn.length,
      });
    }
  });

  socket.on(EVENTS.ROLL_SAILING_DIE, (_, callback) => {
    const found = getRoomBySocketId(socket.id);
    if (!found || !found.room.gameState) return callback?.({ error: 'No game' });

    const state = found.room.gameState;
    if (state.turnOrder[state.currentPlayerIndex] !== found.player.id) {
      return callback?.({ error: 'Not your turn' });
    }
    if (state.turnPhase !== TURN_PHASES.ROLL_FOR_MOVE) {
      return callback?.({ error: 'Wrong phase' });
    }

    const result = rollSailingDie(state);
    broadcastGameState(found.room);
    callback?.(result);

    io.to(found.room.code).emit(EVENTS.DIE_ROLLED, {
      playerId: found.player.id,
      playerName: found.player.name,
      ...result,
    });
    logger.gameLog(found.room.code, 'sailing_die_rolled', {
      playerName: found.player.name,
      roll: result.roll,
      totalMovePoints: result.totalMovePoints,
      stormMoved: !!result.stormMoved,
    });

    // If storm moved, broadcast storm animation
    if (result.stormMoved && state.storm) {
      io.to(found.room.code).emit('storm-spawned', {
        center: state.storm.center,
      });
    }
  });

  socket.on(EVENTS.MOVE_SHIP, ({ shipId, path }, callback) => {
    const found = getRoomBySocketId(socket.id);
    if (!found || !found.room.gameState) return callback?.({ error: 'No game' });

    const state = found.room.gameState;
    if (state.turnOrder[state.currentPlayerIndex] !== found.player.id) {
      return callback?.({ error: 'Not your turn' });
    }

    const ship = state.players[found.player.id]?.ships?.find(s => s.id === shipId);
    const oldPosition = ship ? { ...ship.position } : null;
    const shipInfo = ship ? { masts: ship.masts, cannons: ship.cannons } : { masts: 1, cannons: 0 };

    const result = moveShip(state, found.player.id, shipId, path);
    if (result.error) return callback?.(result);

    broadcastGameState(found.room);
    callback?.(result);

    // Broadcast movement path for animation
    if (oldPosition && result.newPosition) {
      const destTile = state.board?.[result.newPosition.row]?.[result.newPosition.col];
      const arrivedAtPort = destTile?.type === 'port' || false;
      io.to(found.room.code).emit(EVENTS.SHIP_MOVED, {
        playerId: found.player.id,
        playerName: found.player.name,
        playerColor: found.player.color,
        shipId,
        path: [oldPosition, ...path],
        arrivedAtPort,
        ship: shipInfo,
      });
      logger.gameLog(found.room.code, 'ship_moved', {
        playerName: found.player.name,
        shipId,
        from: oldPosition,
        to: result.newPosition,
        pathLen: path.length,
        arrivedAtPort,
      });
    }
  });

  socket.on(EVENTS.UNDO_MOVE, (_, callback) => {
    const found = getRoomBySocketId(socket.id);
    if (!found || !found.room.gameState) return callback?.({ error: 'No game' });

    const state = found.room.gameState;
    if (state.turnOrder[state.currentPlayerIndex] !== found.player.id) {
      return callback?.({ error: 'Not your turn' });
    }

    const result = undoMove(state, found.player.id);
    if (result.error) return callback?.(result);

    broadcastGameState(found.room);
    callback?.(result);
    io.to(found.room.code).emit(EVENTS.MOVE_UNDONE, {
      playerId: found.player.id,
      playerName: found.player.name,
      shipId: result.shipId,
      restoredPosition: result.restoredPosition,
    });
    logger.gameLog(found.room.code, 'move_undone', {
      playerName: found.player.name,
      shipId: result.shipId,
      restoredPosition: result.restoredPosition,
    });
  });

  // Lightening the Load: jettison cannons for bonus movement
  socket.on(EVENTS.JETTISON_CANNONS, ({ shipId, count }, callback) => {
    const found = getRoomBySocketId(socket.id);
    if (!found || !found.room.gameState) return callback?.({ error: 'No game' });

    const state = found.room.gameState;
    const result = jettisonCannons(state, found.player.id, shipId, count);
    if (result.error) return callback?.(result);

    broadcastGameState(found.room);
    callback?.(result);
    if (result.success) {
      logger.gameLog(found.room.code, 'cannons_jettisoned', {
        playerName: found.player.name, shipId, count,
      });
    }
  });

  // Building is allowed at any time during the player's turn
  socket.on(EVENTS.BUILD, ({ buildType, targetShipId }, callback) => {
    const found = getRoomBySocketId(socket.id);
    if (!found || !found.room.gameState) return callback?.({ error: 'No game' });

    const state = found.room.gameState;
    if (state.turnOrder[state.currentPlayerIndex] !== found.player.id) {
      return callback?.({ error: 'Not your turn' });
    }

    const result = buildItem(state, found.player.id, buildType, targetShipId);
    broadcastGameState(found.room);
    callback?.(result);

    if (result.success) {
      const ship = result.ship || state.players[found.player.id]?.ships?.[0];
      io.to(found.room.code).emit(EVENTS.BUILT, {
        playerName: found.player.name,
        buildType,
        location: ship?.position || null,
      });
      logger.gameLog(found.room.code, 'built', {
        playerName: found.player.name,
        buildType,
        shipId: ship?.id || null,
        location: ship?.position || null,
      });
    }
  });

  socket.on(EVENTS.ATTACK_ISLAND, ({ shipId, islandId }, callback) => {
    const found = getRoomBySocketId(socket.id);
    if (!found || !found.room.gameState) return callback?.({ error: 'No game' });

    const state = found.room.gameState;
    const result = attackIsland(state, found.player.id, shipId, islandId);
    if (result.error) return callback?.(result);

    broadcastGameState(found.room);

    if (result.pending) {
      // Bribe flow: notify defender
      const defenderPlayer = found.room.players.find(p => p.id === state.pendingAttack.defenderId);
      if (defenderPlayer) {
        const defenderSocket = io.sockets.sockets.get(defenderPlayer.socketId);
        defenderSocket?.emit(EVENTS.ATTACK_BRIBE_PENDING, {
          attackerId: found.player.id,
          attackerName: found.player.name,
          type: 'island',
          targetId: islandId,
        });
      }
      callback?.({ success: true, pending: true });
      logger.gameLog(found.room.code, 'island_attack_pending_bribe', {
        attackerName: found.player.name, shipId, islandId,
      });
    } else if (result.pendingReroll) {
      // Combat reroll flow: dice rolled, awaiting reroll decisions
      callback?.({ success: true, pendingReroll: true });
      logger.gameLog(found.room.code, 'island_attack_pending_reroll', {
        attackerName: found.player.name, shipId, islandId,
      });
    } else {
      callback?.(result);
      const island = state.islands[islandId];
      const attackerShipForIsland = state.players[found.player.id]?.ships?.find(s => s.id === shipId);
      io.to(found.room.code).emit(EVENTS.COMBAT_RESULT, {
        type: 'island',
        attacker: found.player.name,
        defender: island?.owner ? state.players[island.owner]?.name || 'Island' : 'Island',
        islandName: island?.name || null,
        location: island?.port || null,
        attackerLocation: attackerShipForIsland?.position || null,
        defenderLocation: island?.port || null,
        ...result,
      });
      logger.gameLog(found.room.code, 'island_combat_result', {
        attackerName: found.player.name,
        islandId,
        islandName: island?.name || null,
        defender: island?.owner ? state.players[island.owner]?.name || 'Island' : 'Island',
        attackRoll: result.attackRoll,
        defenseRoll: result.defenseRoll,
        won: result.won,
      });
    }
  });

  socket.on(EVENTS.ATTACK_SHIP, ({ attackerShipId, defenderShipId }, callback) => {
    const found = getRoomBySocketId(socket.id);
    if (!found || !found.room.gameState) return callback?.({ error: 'No game' });

    const state = found.room.gameState;
    const result = attackShip(state, found.player.id, attackerShipId, defenderShipId);
    if (result.error) return callback?.(result);

    broadcastGameState(found.room);

    if (result.pending) {
      // Bribe flow: notify defender
      const defenderPlayer = found.room.players.find(p => p.id === state.pendingAttack.defenderId);
      if (defenderPlayer) {
        const defenderSocket = io.sockets.sockets.get(defenderPlayer.socketId);
        defenderSocket?.emit(EVENTS.ATTACK_BRIBE_PENDING, {
          attackerId: found.player.id,
          attackerName: found.player.name,
          type: 'ship',
          defenderShipId,
        });
      }
      callback?.({ success: true, pending: true });
      logger.gameLog(found.room.code, 'ship_attack_pending_bribe', {
        attackerName: found.player.name, attackerShipId, defenderShipId,
      });
    } else if (result.pendingReroll) {
      // Combat reroll flow: dice rolled, awaiting reroll decisions
      callback?.({ success: true, pendingReroll: true });
      logger.gameLog(found.room.code, 'ship_attack_pending_reroll', {
        attackerName: found.player.name, attackerShipId, defenderShipId,
      });
    } else {
      callback?.(result);
      // Find attacker/defender ship positions and defender name for the animation
      const attackerShip = state.players[found.player.id]?.ships?.find(s => s.id === attackerShipId);
      let defenderName = 'Ship';
      let defenderShip = null;
      for (const p of Object.values(state.players)) {
        const ds = p.ships.find(s => s.id === defenderShipId);
        if (ds) { defenderName = p.name; defenderShip = ds; break; }
      }
      io.to(found.room.code).emit(EVENTS.COMBAT_RESULT, {
        type: 'ship',
        attacker: found.player.name,
        defender: defenderName,
        location: attackerShip?.position || null,
        attackerLocation: attackerShip?.position || null,
        defenderLocation: defenderShip?.position || null,
        ...result,
      });
      logger.gameLog(found.room.code, 'ship_combat_result', {
        attackerName: found.player.name,
        defenderName,
        attackerShipId,
        defenderShipId,
        attackRoll: result.attackRoll,
        defenseRoll: result.defenseRoll,
        attackerWon: result.attackerWon,
      });
    }
  });

  // --- ATTACK BRIBE FLOW ---

  socket.on(EVENTS.ATTACK_BRIBE_OFFER, ({ offer }, callback) => {
    const found = getRoomBySocketId(socket.id);
    if (!found || !found.room.gameState) return callback?.({ error: 'No game' });

    const state = found.room.gameState;
    const result = submitBribeOffer(state, found.player.id, offer);
    if (result.error) return callback?.(result);

    broadcastGameState(found.room);

    // Notify attacker with bribe details
    const attackerPlayer = found.room.players.find(p => p.id === state.pendingAttack.attackerId);
    if (attackerPlayer) {
      const attackerSocket = io.sockets.sockets.get(attackerPlayer.socketId);
      attackerSocket?.emit(EVENTS.ATTACK_BRIBE_DECISION, {
        defenderId: found.player.id,
        defenderName: found.player.name,
        offer: result.offer,
        bribeMode: state.settings.bribeMode,
        type: state.pendingAttack.type,
      });
    }
    callback?.({ success: true });
    logger.gameLog(found.room.code, 'bribe_offered', {
      defenderName: found.player.name,
      offer: result.offer,
    });
  });

  socket.on(EVENTS.ATTACK_BRIBE_RESOLVE, ({ decision }, callback) => {
    const found = getRoomBySocketId(socket.id);
    if (!found || !found.room.gameState) return callback?.({ error: 'No game' });

    const state = found.room.gameState;
    const pendingType = state.pendingAttack?.type;
    const result = resolveAttackBribe(state, found.player.id, decision);
    if (result.error) return callback?.(result);

    broadcastGameState(found.room);
    callback?.(result);

    // Broadcast outcome to all players
    io.to(found.room.code).emit(EVENTS.ATTACK_BRIBE_RESOLVED, {
      outcome: result.outcome,
      attackerName: found.player.name,
      combat: result.combat || null,
      bribe: result.bribe || null,
      attackCancelled: result.attackCancelled || false,
    });
    logger.gameLog(found.room.code, 'bribe_resolved', {
      attackerName: found.player.name,
      decision,
      outcome: result.outcome,
      attackCancelled: !!result.attackCancelled,
    });

    // Also emit COMBAT_RESULT if combat happened and resolved (not pending reroll)
    if (result.combat && !result.combat.pendingReroll) {
      io.to(found.room.code).emit(EVENTS.COMBAT_RESULT, {
        type: pendingType || 'ship',
        attacker: found.player.name,
        ...result.combat,
      });
    }
  });

  // --- REROLL HANDLERS ---

  socket.on(EVENTS.REROLL_SAILING_DIE, ({ resourceCost }, callback) => {
    const found = getRoomBySocketId(socket.id);
    if (!found || !found.room.gameState) return callback?.({ error: 'No game' });

    const state = found.room.gameState;
    const result = rerollSailingDie(state, found.player.id, resourceCost);
    if (result.error) return callback?.(result);

    broadcastGameState(found.room);
    callback?.(result);

    io.to(found.room.code).emit(EVENTS.DIE_ROLLED, {
      playerId: found.player.id,
      playerName: found.player.name,
      reroll: true,
      ...result,
    });

    if (result.stormMoved && state.storm) {
      io.to(found.room.code).emit('storm-spawned', {
        center: state.storm.center,
      });
    }
  });

  socket.on(EVENTS.REROLL_SHIPLESS, ({ dieIndex, resourceCost }, callback) => {
    const found = getRoomBySocketId(socket.id);
    if (!found || !found.room.gameState) return callback?.({ error: 'No game' });

    const state = found.room.gameState;
    const result = rerollShiplessDie(state, found.player.id, dieIndex, resourceCost);
    if (result.error) return callback?.(result);

    broadcastGameState(found.room);
    callback?.(result);
  });

  socket.on(EVENTS.REROLL_COMBAT, ({ resourceCost }, callback) => {
    const found = getRoomBySocketId(socket.id);
    if (!found || !found.room.gameState) return callback?.({ error: 'No game' });

    const state = found.room.gameState;
    // Capture pending info before reroll clears it
    const pending = state.pendingCombatReroll;
    const result = rerollCombatDie(state, found.player.id, resourceCost);
    if (result.error) return callback?.(result);

    broadcastGameState(found.room);
    callback?.(result);

    if (result.resolved && result.combat) {
      const attackerName = state.players[pending.attackerId]?.name || found.player.name;
      let defender;
      let islandName = null;
      if (pending.type === 'island') {
        const island = state.islands[pending.targetId];
        defender = island?.owner ? state.players[island.owner]?.name || 'Island' : 'Island';
        islandName = island?.name || null;
      } else {
        defender = state.players[pending.defenderId]?.name || 'Ship';
      }
      io.to(found.room.code).emit(EVENTS.COMBAT_RESULT, {
        type: result.combatType || 'ship',
        attacker: attackerName,
        defender,
        islandName,
        ...result.combat,
      });
    }
  });

  socket.on(EVENTS.SKIP_COMBAT_REROLL, (_, callback) => {
    const found = getRoomBySocketId(socket.id);
    if (!found || !found.room.gameState) return callback?.({ error: 'No game' });

    const state = found.room.gameState;
    // Capture pending info before skip clears it
    const pending = state.pendingCombatReroll;
    const result = skipCombatReroll(state, found.player.id);
    if (result.error) return callback?.(result);

    broadcastGameState(found.room);
    callback?.(result);

    if (result.resolved && result.combat) {
      const attackerName = state.players[pending.attackerId]?.name || found.player.name;
      let defender;
      let islandName = null;
      if (pending.type === 'island') {
        const island = state.islands[pending.targetId];
        defender = island?.owner ? state.players[island.owner]?.name || 'Island' : 'Island';
        islandName = island?.name || null;
      } else {
        defender = state.players[pending.defenderId]?.name || 'Ship';
      }
      io.to(found.room.code).emit(EVENTS.COMBAT_RESULT, {
        type: result.combatType || 'ship',
        attacker: attackerName,
        defender,
        islandName,
        ...result.combat,
      });
    }
  });

  // --- TREASURE ---

  socket.on(EVENTS.COLLECT_TREASURE, ({ tokenId }, callback) => {
    const found = getRoomBySocketId(socket.id);
    if (!found || !found.room.gameState) return callback?.({ error: 'No game' });

    const state = found.room.gameState;
    if (state.turnOrder[state.currentPlayerIndex] !== found.player.id) {
      return callback?.({ error: 'Not your turn' });
    }

    const result = collectTreasure(state, found.player.id, tokenId);
    broadcastGameState(found.room);
    callback?.(result);

    if (result.card) {
      io.to(found.room.code).emit(EVENTS.TREASURE_COLLECTED, {
        playerId: found.player.id,
        playerName: found.player.name,
        card: result.card,
      });
      logger.gameLog(found.room.code, 'treasure_collected', {
        playerName: found.player.name,
        cardType: result.card?.type,
        cardDescription: result.card?.description,
      });
    }

    if (result.reshuffled) {
      io.to(found.room.code).emit(EVENTS.TREASURE_DECK_RESHUFFLED);
    }

    // Handle end_turn treasure card
    if (result.endsTurn) {
      stopTurnTimers(found.room);
      const endResult = endTurn(state);
      broadcastGameState(found.room);
      const nextName = state.players[endResult.nextPlayer]?.name || 'Unknown';
      io.to(found.room.code).emit(EVENTS.TURN_ENDED, { ...endResult, nextPlayerName: nextName });
      logger.gameLog(found.room.code, 'turn_ended', {
        previousPlayer: found.player.name,
        nextPlayer: nextName,
        reason: 'treasure_end_turn',
      });
      startTurnTimers(found.room, io, broadcastGameState);
    }
  });

  socket.on(EVENTS.RESOLVE_TREASURE, ({ targetId, discards, shipId }, callback) => {
    const found = getRoomBySocketId(socket.id);
    if (!found || !found.room.gameState) return callback?.({ error: 'No game' });

    const state = found.room.gameState;
    const pending = state.pendingTreasure;
    if (!pending) return callback?.({ error: 'No pending treasure' });

    let result;
    if (pending.type === 'steal') {
      result = resolveTreasureSteal(state, found.player.id, targetId);
      if (result.success) {
        const targetName = state.players[targetId]?.name || 'Unknown';
        io.to(found.room.code).emit(EVENTS.TREASURE_STEAL_RESOLVED, {
          thiefName: found.player.name,
          targetName,
          count: result.stolen?.length || 0,
        });
      }
    } else if (pending.type === 'storm_discard') {
      result = resolveTreasureStormDiscard(state, found.player.id, discards);
    } else if (pending.type === 'free_upgrade') {
      result = resolveTreasureFreeUpgrade(state, found.player.id, shipId);
    } else {
      return callback?.({ error: 'Unknown pending type' });
    }

    broadcastGameState(found.room);
    callback?.(result);
    if (result?.success) {
      logger.gameLog(found.room.code, 'treasure_resolved', {
        playerName: found.player.name,
        type: pending.type,
        targetId: targetId || undefined,
        shipId: shipId || undefined,
      });
    }
  });

  // --- STORM COST ---

  socket.on('resolve-storm-cost', ({ discards }, callback) => {
    const found = getRoomBySocketId(socket.id);
    if (!found || !found.room.gameState) return callback?.({ error: 'No game' });

    const state = found.room.gameState;
    if (state.turnOrder[state.currentPlayerIndex] !== found.player.id) {
      return callback?.({ error: 'Not your turn' });
    }

    const result = resolveStormCost(state, found.player.id, discards);
    broadcastGameState(found.room);
    callback?.(result);
  });

  socket.on('cancel-storm-move', (_, callback) => {
    const found = getRoomBySocketId(socket.id);
    if (!found || !found.room.gameState) return callback?.({ error: 'No game' });

    const state = found.room.gameState;
    if (state.turnOrder[state.currentPlayerIndex] !== found.player.id) {
      return callback?.({ error: 'Not your turn' });
    }

    const result = cancelStormMove(state, found.player.id);
    broadcastGameState(found.room);
    callback?.(result);
  });

  // --- TRADE ---

  socket.on(EVENTS.PROPOSE_TRADE, ({ toPlayerId, offer, request }, callback) => {
    const found = getRoomBySocketId(socket.id);
    if (!found || !found.room.gameState) return callback?.({ error: 'No game' });

    const state = found.room.gameState;

    // Check trade proximity
    if (!canTrade(state, found.player.id, toPlayerId)) {
      return callback?.({ error: 'Not close enough to trade. Must be adjacent, at port, or at merchant island.' });
    }

    state.pendingTrade = {
      fromId: found.player.id,
      toId: toPlayerId,
      offer,
      request,
    };
    state.undoableMove = null;

    const targetPlayer = found.room.players.find(p => p.id === toPlayerId);
    if (targetPlayer) {
      const targetSocket = io.sockets.sockets.get(targetPlayer.socketId);
      if (targetSocket) {
        targetSocket.emit(EVENTS.TRADE_PROPOSED, {
          fromId: found.player.id,
          fromName: found.player.name,
          offer,
          request,
        });
      }
    }
    callback?.({ success: true });
    logger.gameLog(found.room.code, 'trade_proposed', {
      fromName: found.player.name,
      toName: targetPlayer?.name || null,
      offer, request,
    });
  });

  socket.on(EVENTS.RESPOND_TRADE, ({ accepted }, callback) => {
    const found = getRoomBySocketId(socket.id);
    if (!found || !found.room.gameState) return callback?.({ error: 'No game' });

    const state = found.room.gameState;
    const trade = state.pendingTrade;
    if (!trade || trade.toId !== found.player.id) {
      return callback?.({ error: 'No pending trade for you' });
    }

    if (accepted) {
      const from = state.players[trade.fromId];
      const to = state.players[trade.toId];

      for (const [res, amt] of Object.entries(trade.offer)) {
        if (from.resources[res] < amt) {
          state.pendingTrade = null;
          return callback?.({ error: 'Proposer lacks resources' });
        }
      }
      for (const [res, amt] of Object.entries(trade.request)) {
        if (to.resources[res] < amt) {
          state.pendingTrade = null;
          return callback?.({ error: 'You lack resources' });
        }
      }

      for (const [res, amt] of Object.entries(trade.offer)) {
        from.resources[res] -= amt;
        to.resources[res] += amt;
      }
      for (const [res, amt] of Object.entries(trade.request)) {
        to.resources[res] -= amt;
        from.resources[res] += amt;
      }
    }

    state.pendingTrade = null;
    broadcastGameState(found.room);

    // Trade knowledge modes determine what other players see
    const tradeKnowledge = state.settings.tradeKnowledge || TRADE_KNOWLEDGE.OPEN;
    const fromPlayer = found.room.players.find(p => p.id === trade.fromId);
    const toPlayer = found.room.players.find(p => p.id === trade.toId);
    const fromName = fromPlayer?.name || 'Unknown';
    const toName = toPlayer?.name || 'Unknown';

    const fullDetails = {
      accepted,
      fromId: trade.fromId,
      toId: trade.toId,
      fromName,
      toName,
      offer: trade.offer,
      request: trade.request,
    };

    if (tradeKnowledge === TRADE_KNOWLEDGE.OPEN) {
      // Everyone sees full details
      io.to(found.room.code).emit(EVENTS.TRADE_RESOLVED, fullDetails);
    } else if (tradeKnowledge === TRADE_KNOWLEDGE.SELECTIVE) {
      // Parties get full details
      const partyIds = [trade.fromId, trade.toId];
      for (const p of found.room.players) {
        const sock = io.sockets.sockets.get(p.socketId);
        if (!sock) continue;
        if (partyIds.includes(p.id)) {
          sock.emit(EVENTS.TRADE_RESOLVED, fullDetails);
        } else {
          sock.emit(EVENTS.TRADE_RESOLVED, { accepted, fromId: trade.fromId, toId: trade.toId, fromName, toName });
        }
      }
    } else {
      // Hidden: only parties see the trade
      for (const p of found.room.players) {
        if (p.id === trade.fromId || p.id === trade.toId) {
          const sock = io.sockets.sockets.get(p.socketId);
          if (sock) sock.emit(EVENTS.TRADE_RESOLVED, fullDetails);
        }
      }
    }
    callback?.({ success: true, accepted });
    logger.gameLog(found.room.code, 'trade_resolved', {
      fromName, toName, accepted,
      offer: trade.offer, request: trade.request,
    });
  });

  // --- MERCHANT BANK TRADE ---

  socket.on(EVENTS.MERCHANT_TRADE, ({ give, receive }, callback) => {
    const found = getRoomBySocketId(socket.id);
    if (!found || !found.room.gameState) return callback?.({ error: 'No game' });

    const state = found.room.gameState;
    if (state.turnOrder[state.currentPlayerIndex] !== found.player.id) {
      return callback?.({ error: 'Not your turn' });
    }

    const result = merchantBankTrade(state, found.player.id, give, receive);
    broadcastGameState(found.room);
    callback?.(result);
    if (result?.success) {
      logger.gameLog(found.room.code, 'merchant_trade', {
        playerName: found.player.name, give, receive,
      });
    }
  });

  // --- TREATY ---

  socket.on(EVENTS.PROPOSE_TREATY, ({ targetId, offer }, callback) => {
    const found = getRoomBySocketId(socket.id);
    if (!found || !found.room.gameState) return callback?.({ error: 'No game' });

    const state = found.room.gameState;
    const result = proposeTreaty(state, found.player.id, targetId, offer);
    if (result.error) return callback?.(result);

    // Notify target
    const targetPlayer = found.room.players.find(p => p.id === targetId);
    if (targetPlayer) {
      const targetSocket = io.sockets.sockets.get(targetPlayer.socketId);
      if (targetSocket) {
        targetSocket.emit(EVENTS.TREATY_PROPOSED, {
          proposerId: found.player.id,
          proposerName: found.player.name,
          offer,
        });
      }
    }
    callback?.({ success: true });
    logger.gameLog(found.room.code, 'treaty_proposed', {
      proposerName: found.player.name,
      targetName: targetPlayer?.name || null, offer,
    });
  });

  socket.on(EVENTS.RESPOND_TREATY, ({ accepted, proposerId, offer }, callback) => {
    const found = getRoomBySocketId(socket.id);
    if (!found || !found.room.gameState) return callback?.({ error: 'No game' });

    const state = found.room.gameState;
    const result = resolveTreaty(state, accepted, proposerId, found.player.id, offer);
    broadcastGameState(found.room);

    io.to(found.room.code).emit(EVENTS.TREATY_RESOLVED, {
      accepted,
      proposerId,
      targetId: found.player.id,
    });
    callback?.(result);
    const proposerName = state.players[proposerId]?.name || 'Unknown';
    logger.gameLog(found.room.code, 'treaty_resolved', {
      proposerName,
      targetName: found.player.name,
      accepted,
    });
  });

  // --- SHIPLESS CAPTAIN ---

  socket.on(EVENTS.SHIPLESS_ROLL, (_, callback) => {
    const found = getRoomBySocketId(socket.id);
    if (!found || !found.room.gameState) return callback?.({ error: 'No game' });

    const state = found.room.gameState;
    if (state.turnOrder[state.currentPlayerIndex] !== found.player.id) {
      return callback?.({ error: 'Not your turn' });
    }

    const result = shiplessRoll(state, found.player.id);
    broadcastGameState(found.room);
    callback?.(result);
  });

  socket.on(EVENTS.SHIPLESS_EXCHANGE_PP, (_, callback) => {
    const found = getRoomBySocketId(socket.id);
    if (!found || !found.room.gameState) return callback?.({ error: 'No game' });
    const state = found.room.gameState;
    if (state.turnOrder[state.currentPlayerIndex] !== found.player.id) {
      return callback?.({ error: 'Not your turn' });
    }
    const result = shiplessExchangePP(state, found.player.id);
    broadcastGameState(found.room);
    callback?.(result);
  });

  socket.on(EVENTS.SHIPLESS_EXCHANGE_GOLD, (_, callback) => {
    const found = getRoomBySocketId(socket.id);
    if (!found || !found.room.gameState) return callback?.({ error: 'No game' });
    const state = found.room.gameState;
    if (state.turnOrder[state.currentPlayerIndex] !== found.player.id) {
      return callback?.({ error: 'Not your turn' });
    }
    const result = shiplessExchangeGold(state, found.player.id);
    broadcastGameState(found.room);
    callback?.(result);
  });

  socket.on(EVENTS.SHIPLESS_DISOWN_ISLAND, ({ islandId }, callback) => {
    const found = getRoomBySocketId(socket.id);
    if (!found || !found.room.gameState) return callback?.({ error: 'No game' });
    const state = found.room.gameState;
    if (state.turnOrder[state.currentPlayerIndex] !== found.player.id) {
      return callback?.({ error: 'Not your turn' });
    }
    const result = shiplessDisownIsland(state, found.player.id, islandId);
    broadcastGameState(found.room);
    callback?.(result);
  });

  socket.on(EVENTS.SHIPLESS_CHOOSE_RESOURCE, ({ resourceType }, callback) => {
    const found = getRoomBySocketId(socket.id);
    if (!found || !found.room.gameState) return callback?.({ error: 'No game' });
    const state = found.room.gameState;
    if (state.turnOrder[state.currentPlayerIndex] !== found.player.id) {
      return callback?.({ error: 'Not your turn' });
    }
    const result = shiplessChooseResource(state, found.player.id, resourceType);
    broadcastGameState(found.room);
    callback?.(result);
  });

  // --- END TURN ---

  socket.on(EVENTS.END_TURN, (_, callback) => {
    const found = getRoomBySocketId(socket.id);
    if (!found || !found.room.gameState) return callback?.({ error: 'No game' });

    const state = found.room.gameState;
    if (state.turnOrder[state.currentPlayerIndex] !== found.player.id) {
      return callback?.({ error: 'Not your turn' });
    }

    const result = endTurn(state);
    if (result.error) return callback?.(result);

    stopTurnTimers(found.room);
    broadcastGameState(found.room);
    callback?.(result);

    const nextPlayerName = state.players[result.nextPlayer]?.name || 'Unknown';
    io.to(found.room.code).emit(EVENTS.TURN_ENDED, { ...result, nextPlayerName });
    logger.gameLog(found.room.code, 'turn_ended', {
      previousPlayer: found.player.name,
      nextPlayer: nextPlayerName,
      reason: 'normal',
    });

    startTurnTimers(found.room, io, broadcastGameState);
  });

  // --- TURN TIMER VOTE ---

  socket.on(EVENTS.TURN_TIMER_VOTE, ({ vote }, callback) => {
    const found = getRoomBySocketId(socket.id);
    if (!found || !found.room.gameState) return callback?.({ error: 'No game' });
    const result = handleSkipVote(found.room, found.player.id, !!vote, io);
    callback?.(result || { success: true });
  });

  // --- DISCONNECT ---

  socket.on('disconnect', (reason) => {
    const found = getRoomBySocketId(socket.id);
    let playerName = null;
    let roomCode = null;
    let gameInProgress = false;
    if (found) {
      playerName = found.player?.name;
      roomCode = found.room?.code;
      gameInProgress = !!found.room?.gameState;
      const result = removePlayer(found.room.code, socket.id);
      if (result) {
        io.to(found.room.code).emit(EVENTS.PLAYER_LEFT, {
          playerId: result.player.id,
          name: result.player.name,
          room: getPublicRoomState(result.room),
        });
        if (found.room.gameState) {
          cancelPendingAttackForPlayer(found.room.gameState, result.player.id);
          if (found.room.skipVote) {
            onPlayerDisconnectDuringVote(found.room, result.player.id);
          }
          broadcastGameState(found.room);
        }
      }
    }
    logger.info('socket_disconnected', {
      socketId: socket.id,
      reason,
      name: playerName,
      code: roomCode,
      gameInProgress,
    });
    if (roomCode) {
      // Also append to the per-game log so a game log alone is enough to debug
      logger.gameLog(roomCode, 'player_disconnected', {
        name: playerName, reason, gameInProgress,
      });
    }
  });
});

function broadcastGameState(room) {
  // Log game_over exactly once, when the phase transitions into it
  if (room.gameState?.phase === 'game_over' && !room._gameOverLogged) {
    room._gameOverLogged = true;
    stopTurnTimers(room);
    const winnerId = room.gameState.winner;
    const winnerName = winnerId ? room.gameState.players[winnerId]?.name : null;
    logger.gameLog(room.code, 'game_over', {
      winnerId,
      winnerName,
      turnNumber: room.gameState.turnNumber,
    });
  }
  for (const player of room.players) {
    if (!player.connected) continue;
    const sock = io.sockets.sockets.get(player.socketId);
    if (sock) {
      sock.emit(EVENTS.GAME_STATE_UPDATE, {
        gameState: getPublicGameState(room.gameState, player.id),
      });
    }
  }
}

// Catch-all for SPA routing in production
app.get('*', (req, res) => {
  res.sendFile(join(clientBuildPath, 'index.html'));
});

// Ensure issue labels exist in the GitHub repo
async function ensureLabels() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return;
  const labels = [
    { name: 'bug', color: 'd73a4a', description: 'Something isn\'t working' },
    { name: 'in-game bug report', color: '1d76db', description: 'Submitted via in-game bug report button' },
  ];
  for (const label of labels) {
    try {
      const res = await fetch('https://api.github.com/repos/RohanSamAgarwal/Plunder/labels', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(label),
      });
      if (res.ok) console.log(`Created "${label.name}" label`);
      else if (res.status === 422) console.log(`"${label.name}" label already exists`);
      else console.warn(`Could not create "${label.name}" label:`, res.status);
    } catch (err) {
      console.warn(`Failed to ensure "${label.name}" label:`, err.message);
    }
  }
}

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  logger.info('server_started', { port: PORT, nodeEnv: process.env.NODE_ENV || 'development' });
  ensureLabels();
});
