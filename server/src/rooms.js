// Room Manager for Plunder: A Pirate's Life
import { v4 as uuid } from 'uuid';
import { PLAYER_COLORS, SHIPLESS_MODES } from '../../shared/constants.js';

const rooms = new Map();

// Word lists for room codes
const ADJECTIVES = [
  'skull', 'dark', 'golden', 'storm', 'iron', 'cursed', 'hidden', 'lost',
  'phantom', 'crimson', 'shadow', 'savage', 'dread', 'bloody', 'ghost',
  'ancient', 'sunken', 'wild', 'rogue', 'bold',
];
const NOUNS = [
  'reef', 'cove', 'wolf', 'shark', 'cannon', 'anchor', 'blade', 'flag',
  'isle', 'kraken', 'pearl', 'barrel', 'helm', 'compass', 'sail',
  'trident', 'serpent', 'plank', 'chest', 'tide',
];

function generateRoomCode() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)].toUpperCase();
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)].toUpperCase();
  const num = Math.floor(Math.random() * 99) + 1;
  const code = `${adj}-${noun}-${num}`;

  // Ensure uniqueness
  if (rooms.has(code)) return generateRoomCode();
  return code;
}

export function createRoom(hostSocketId, hostName) {
  const code = generateRoomCode();
  const hostId = uuid();

  const room = {
    code,
    hostId,
    players: [{
      id: hostId,
      socketId: hostSocketId,
      name: hostName,
      color: PLAYER_COLORS[0],
      ready: true,
      connected: true,
      sessionToken: uuid(),
    }],
    gameState: null,
    createdAt: Date.now(),
    started: false,
    settings: {
      shiplessMode: SHIPLESS_MODES.RULEBOOK,
    },
  };

  rooms.set(code, room);
  return room;
}

export function joinRoom(code, socketId, playerName) {
  if (!code) return { error: 'Room code is required' };
  const room = rooms.get(code.toUpperCase());
  if (!room) return { error: 'Room not found' };
  if (room.started) return { error: 'Game already in progress' };
  if (room.players.length >= 6) return { error: 'Room is full (max 6 players)' };

  // Find first available color
  const takenColors = room.players.map(p => p.color);
  const availableColor = PLAYER_COLORS.find(c => !takenColors.includes(c));

  const playerId = uuid();
  const player = {
    id: playerId,
    socketId,
    name: playerName,
    color: availableColor,
    ready: true,
    connected: true,
    sessionToken: uuid(),
  };

  room.players.push(player);
  return { room, player };
}

export function reconnectPlayer(code, sessionToken, newSocketId) {
  if (!code) return { error: 'Room code is required' };
  const room = rooms.get(code.toUpperCase());
  if (!room) return { error: 'Room not found' };

  const player = room.players.find(p => p.sessionToken === sessionToken);
  if (!player) return { error: 'Player not found' };

  player.socketId = newSocketId;
  player.connected = true;

  // Update in game state too if game started
  if (room.gameState && room.gameState.players[player.id]) {
    room.gameState.players[player.id].connected = true;
  }

  return { room, player };
}

export function changeColor(code, playerId, newColor) {
  const room = rooms.get(code);
  if (!room) return { error: 'Room not found' };

  const player = room.players.find(p => p.id === playerId);
  if (!player) return { error: 'Player not found' };

  const taken = room.players.some(p => p.id !== playerId && p.color === newColor);
  if (taken) return { error: 'Color already taken' };

  player.color = newColor;
  return { success: true, player };
}

export function removePlayer(code, socketId) {
  const room = rooms.get(code);
  if (!room) return null;

  const playerIndex = room.players.findIndex(p => p.socketId === socketId);
  if (playerIndex === -1) return null;

  const player = room.players[playerIndex];

  if (room.started) {
    // Mark as disconnected instead of removing
    player.connected = false;
    if (room.gameState && room.gameState.players[player.id]) {
      room.gameState.players[player.id].connected = false;
    }
  } else {
    room.players.splice(playerIndex, 1);
  }

  // If room is empty, clean up
  if (room.players.filter(p => p.connected).length === 0) {
    rooms.delete(code);
    return null;
  }

  return { room, player };
}

export function updateSettings(code, playerId, settings) {
  const room = rooms.get(code);
  if (!room) return { error: 'Room not found' };
  if (room.hostId !== playerId) return { error: 'Only the host can change settings' };
  if (room.started) return { error: 'Game already started' };

  if (settings.shiplessMode && Object.values(SHIPLESS_MODES).includes(settings.shiplessMode)) {
    room.settings.shiplessMode = settings.shiplessMode;
  }

  return { success: true, settings: room.settings };
}

export function getRoom(code) {
  return rooms.get(code?.toUpperCase());
}

export function getRoomBySocketId(socketId) {
  for (const [code, room] of rooms) {
    const player = room.players.find(p => p.socketId === socketId);
    if (player) return { room, player };
  }
  return null;
}

export function getPublicRoomState(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      color: p.color,
      ready: p.ready,
      connected: p.connected,
    })),
    started: room.started,
    settings: room.settings,
  };
}
