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
  moveShip, buildItem, attackIsland, attackShip, endTurn, calculatePlunderPoints,
  collectTreasure, resolveTreasureSteal, resolveTreasureStormDiscard, resolveStormCost,
  merchantBankTrade, canTrade, proposeTreaty, resolveTreaty,
  shiplessRoll, shiplessExchangePP, shiplessExchangeGold,
  shiplessDisownIsland, shiplessChooseResource,
  submitBribeOffer, resolveAttackBribe, cancelPendingAttackForPlayer,
} from './gameState.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.NODE_ENV === 'production'
      ? (process.env.RAILWAY_PUBLIC_DOMAIN
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

// === SOCKET.IO HANDLERS ===

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // --- LOBBY ---

  socket.on(EVENTS.CREATE_ROOM, ({ name }, callback) => {
    const room = createRoom(socket.id, name);
    socket.join(room.code);
    const player = room.players[0];
    callback({
      code: room.code,
      playerId: player.id,
      sessionToken: player.sessionToken,
      room: getPublicRoomState(room),
    });
    console.log(`Room ${room.code} created by ${name}`);
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
        return;
      }
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

    console.log(`${name} joined room ${room.code}`);
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
    console.log(`Game started in room ${room.code} with ${room.players.length} players`);
  });

  // --- GAMEPLAY ---

  socket.on(EVENTS.PICK_STARTING_ISLAND, ({ islandId }, callback) => {
    const found = getRoomBySocketId(socket.id);
    if (!found || !found.room.gameState) return callback?.({ error: 'No game' });

    const state = found.room.gameState;
    const result = pickStartingIsland(state, found.player.id, islandId);
    if (result.error) return callback?.({ error: result.error });

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
      ...result,
    });
  });

  socket.on(EVENTS.MOVE_SHIP, ({ shipId, path }, callback) => {
    const found = getRoomBySocketId(socket.id);
    if (!found || !found.room.gameState) return callback?.({ error: 'No game' });

    const state = found.room.gameState;
    if (state.turnOrder[state.currentPlayerIndex] !== found.player.id) {
      return callback?.({ error: 'Not your turn' });
    }

    const result = moveShip(state, found.player.id, shipId, path);
    if (result.error) return callback?.(result);

    broadcastGameState(found.room);
    callback?.(result);
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
    } else {
      callback?.(result);
      const island = state.islands[islandId];
      io.to(found.room.code).emit(EVENTS.COMBAT_RESULT, {
        type: 'island',
        attacker: found.player.name,
        location: island?.port || null,
        ...result,
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
    } else {
      callback?.(result);
      // Find attacker ship position for the animation location
      const attackerShip = state.players[found.player.id]?.ships?.find(s => s.id === attackerShipId);
      io.to(found.room.code).emit(EVENTS.COMBAT_RESULT, {
        type: 'ship',
        attacker: found.player.name,
        location: attackerShip?.position || null,
        ...result,
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

    // Also emit COMBAT_RESULT if combat happened (for chat log)
    if (result.combat) {
      io.to(found.room.code).emit(EVENTS.COMBAT_RESULT, {
        type: pendingType || 'ship',
        attacker: found.player.name,
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
    }

    if (result.reshuffled) {
      io.to(found.room.code).emit(EVENTS.TREASURE_DECK_RESHUFFLED);
    }

    // Handle end_turn treasure card
    if (result.endsTurn) {
      const endResult = endTurn(state);
      broadcastGameState(found.room);
      io.to(found.room.code).emit(EVENTS.TURN_ENDED, endResult);
    }
  });

  socket.on(EVENTS.RESOLVE_TREASURE, ({ targetId, discards }, callback) => {
    const found = getRoomBySocketId(socket.id);
    if (!found || !found.room.gameState) return callback?.({ error: 'No game' });

    const state = found.room.gameState;
    const pending = state.pendingTreasure;
    if (!pending) return callback?.({ error: 'No pending treasure' });

    let result;
    if (pending.type === 'steal') {
      result = resolveTreasureSteal(state, found.player.id, targetId);
    } else if (pending.type === 'storm_discard') {
      result = resolveTreasureStormDiscard(state, found.player.id, discards);
    } else {
      return callback?.({ error: 'Unknown pending type' });
    }

    broadcastGameState(found.room);
    callback?.(result);
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
    broadcastGameState(found.room);
    callback?.(result);

    io.to(found.room.code).emit(EVENTS.TURN_ENDED, result);
  });

  // --- DISCONNECT ---

  socket.on('disconnect', () => {
    const found = getRoomBySocketId(socket.id);
    if (found) {
      const result = removePlayer(found.room.code, socket.id);
      if (result) {
        io.to(found.room.code).emit(EVENTS.PLAYER_LEFT, {
          playerId: result.player.id,
          name: result.player.name,
          room: getPublicRoomState(result.room),
        });
        if (found.room.gameState) {
          cancelPendingAttackForPlayer(found.room.gameState, result.player.id);
          broadcastGameState(found.room);
        }
      }
    }
    console.log(`Player disconnected: ${socket.id}`);
  });
});

function broadcastGameState(room) {
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

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Plunder server running on port ${PORT}`);
});
