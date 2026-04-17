// Game State Manager for Plunder: A Pirate's Life
import { v4 as uuid } from 'uuid';
import {
  GAME_PHASES, TURN_PHASES, INITIAL_LIFE_PEGS, WIN_POINTS,
  STORM_SIZE, BUILD_COSTS, RESOURCE_TYPES, TILE_TYPES, SHIPLESS_MODES,
  MAX_CANNONS, MAX_MASTS, MAX_LIFE_PEGS, BRIBE_MODES, TRADE_KNOWLEDGE,
  REROLL_MODES, ISLAND_NAME_STYLES,
} from '../../shared/constants.js';
import { generateBoard, getStartingIslands } from './board.js';
import { createResourceDeck, createTreasureDeck, drawFromDeck, shuffle } from './decks.js';
import { assignIslandNames } from './islandNames.js';

export function createGameState(players, playerCount, settings = {}) {
  const boardData = generateBoard(playerCount);
  assignIslandNames(boardData.islands, settings.islandNameStyle || ISLAND_NAME_STYLES.CLASSIC);

  const state = {
    phase: GAME_PHASES.STARTING_ISLAND_PICK,
    board: boardData.board,
    islands: boardData.islands,
    totalCols: boardData.totalCols,
    totalRows: boardData.totalRows,
    panelLayout: boardData.panelLayout,
    walls: boardData.walls || [],
    wallSet: buildWallSet(boardData.walls || []),

    players: {},
    turnOrder: [],
    currentPlayerIndex: 0,
    turnPhase: null,

    resourceDeck: createResourceDeck(),
    treasureDeck: createTreasureDeck(),
    resourceBank: { wood: 10, iron: 10, rum: 10, gold: 10 },

    storm: null,
    treasureTokens: [],

    movePointsRemaining: 0,
    dieRoll: 0,
    hasRolled: false,

    islandPickOrder: [],
    islandPickIndex: 0,

    pendingTrade: null,
    pendingTreasure: null, // treasure card awaiting resolution (steal choice, storm discard)
    pendingStormCost: null, // { playerId, amount } — awaiting player choice on which resources to discard for storm entry/exit
    pendingAttack: null, // { type, attackerId, defenderId, attackerShipId, targetId, bribeOffer }
    pendingCombatReroll: null, // { type, attackerId, attackerShipId, targetId, attackRoll, defenseRoll, ... }
    lastShiplessRoll: null, // { dice: [die1, die2], playerId } — for reroll reference
    hasRerolledSailing: false,
    hasRerolledShipless: false,
    treaties: [], // active treaties: [{ player1, player2, turnNumber }]
    combatLog: [],
    attackedThisTurn: {}, // { [shipId]: Set([targetId1, targetId2]) } — prevents same ship attacking same target twice per turn
    turnNumber: 0,
    turnStartedAt: null,

    // Game settings (configurable in lobby)
    settings: {
      shiplessMode: settings.shiplessMode || SHIPLESS_MODES.RULEBOOK,
      bribeMode: settings.bribeMode || BRIBE_MODES.NONE,
      ppToWin: settings.ppToWin || WIN_POINTS,
      tradeKnowledge: settings.tradeKnowledge || TRADE_KNOWLEDGE.OPEN,
      rerollMode: settings.rerollMode || REROLL_MODES.NONE,
      lightenTheLoad: settings.lightenTheLoad !== undefined ? settings.lightenTheLoad : true,
      softTimerSeconds: settings.softTimerSeconds ?? 60,
      hardTimerSeconds: settings.hardTimerSeconds ?? 300,
      islandNameStyle: settings.islandNameStyle || ISLAND_NAME_STYLES.CLASSIC,
    },
  };

  // Initialize players
  for (const p of players) {
    state.players[p.id] = {
      id: p.id,
      name: p.name,
      color: p.color,
      ships: [],
      ownedIslands: [],
      resources: { wood: 0, iron: 0, rum: 0, gold: 0 },
      plunderPointCards: 0,
      connected: true,
      rerollsUsed: 0,
    };
  }

  // Roll for island pick order (highest first)
  const rolls = players.map(p => ({
    id: p.id,
    roll: rollDie(6)
  }));
  rolls.sort((a, b) => b.roll - a.roll);
  state.islandPickOrder = rolls.map(r => r.id);
  state.turnOrder = [...state.islandPickOrder].reverse(); // last picker goes first

  return state;
}

export function rollDie(sides = 6) {
  return Math.floor(Math.random() * sides) + 1;
}

export function getRandomBoardPosition(state) {
  const col = Math.floor(Math.random() * state.totalCols);
  const row = Math.floor(Math.random() * state.totalRows);
  return { col, row };
}

export function placeStorm(state) {
  let pos;
  let attempts = 0;
  do {
    pos = getRandomBoardPosition(state);
    attempts++;
  } while (isStormOnOneSkullPort(state, pos) && attempts < 100);

  state.storm = {
    center: pos,
    tiles: getStormTiles(pos, state.totalCols, state.totalRows),
  };
}

function isStormOnOneSkullPort(state, center) {
  const tiles = getStormTiles(center, state.totalCols, state.totalRows);
  for (const t of tiles) {
    const tile = state.board[t.row]?.[t.col];
    if (tile && tile.type === TILE_TYPES.PORT) {
      const island = state.islands[tile.portOf];
      if (island && island.skulls === 1) return true;
    }
  }
  return false;
}

function getStormTiles(center, maxCols, maxRows) {
  const tiles = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const r = center.row + dr;
      const c = center.col + dc;
      if (r >= 0 && r < maxRows && c >= 0 && c < maxCols) {
        tiles.push({ row: r, col: c });
      }
    }
  }
  return tiles;
}

function isInStorm(state, pos) {
  if (!state.storm) return false;
  return state.storm.tiles.some(t => t.col === pos.col && t.row === pos.row);
}

// Storm blocks resource collection when the island's center tile (skull/flag tile) is covered
function isIslandStormBlocked(state, islandId) {
  if (!state.storm) return false;
  const island = state.islands[islandId];
  if (!island || !island.tiles || island.tiles.length === 0) return false;

  // Find the island tile closest to the geometric center (same logic as client renderer)
  const cx = island.tiles.reduce((s, t) => s + t.col, 0) / island.tiles.length;
  const cy = island.tiles.reduce((s, t) => s + t.row, 0) / island.tiles.length;
  let bestTile = island.tiles[0];
  let bestDist = Infinity;
  for (const t of island.tiles) {
    const d = (t.col + 0.5 - cx) ** 2 + (t.row + 0.5 - cy) ** 2;
    if (d < bestDist) { bestDist = d; bestTile = t; }
  }

  return isInStorm(state, bestTile);
}

// ── Wall Barrier Helpers ───────────────────────────────────────

function wallKey(col1, row1, col2, row2) {
  if (col1 < col2 || (col1 === col2 && row1 < row2)) {
    return `${col1},${row1}|${col2},${row2}`;
  }
  return `${col2},${row2}|${col1},${row1}`;
}

function buildWallSet(walls) {
  return new Set(walls.map(w => wallKey(w.col1, w.row1, w.col2, w.row2)));
}

function hasWallBetween(state, posA, posB) {
  if (!state.wallSet || state.wallSet.size === 0) return false;
  return state.wallSet.has(wallKey(posA.col, posA.row, posB.col, posB.row));
}

// Rulebook: cannot collect treasure through a land barrier
function hasLandBarrierBetween(state, posA, posB) {
  // Check if the direct path between two adjacent tiles passes through a land barrier
  // For orthogonally adjacent tiles, the tile between them IS one of them, so we check
  // if either tile is a land barrier type
  const tileA = state.board[posA.row]?.[posA.col];
  const tileB = state.board[posB.row]?.[posB.col];
  if (!tileA || !tileB) return true;
  return tileA.type === TILE_TYPES.LAND_BARRIER || tileB.type === TILE_TYPES.LAND_BARRIER;
}

// Port approach restriction: ships can only ENTER a port from its open sides
function isPortEntryBlocked(state, fromPos, toPos) {
  const tile = state.board[toPos.row]?.[toPos.col];
  if (!tile || tile.type !== TILE_TYPES.PORT || !tile.openSides) return false;

  // Determine which direction the ship is approaching from
  const dc = toPos.col - fromPos.col;
  const dr = toPos.row - fromPos.row;
  let approachDir;
  if (dr === -1) approachDir = 'S'; // ship was below, approaching from south
  if (dr === 1) approachDir = 'N';  // ship was above, approaching from north
  if (dc === -1) approachDir = 'E'; // ship was right, approaching from east
  if (dc === 1) approachDir = 'W';  // ship was left, approaching from west

  return !tile.openSides.includes(approachDir);
}

// Rulebook: cannot interact across the storm border (one inside, one outside)
function isAcrossStormBorder(state, posA, posB) {
  if (!state.storm) return false;
  const aInStorm = isInStorm(state, posA);
  const bInStorm = isInStorm(state, posB);
  return aInStorm !== bInStorm;
}

export function placeTreasureTokens(state) {
  const playerCount = Object.keys(state.players).length;
  const tokenCount = playerCount <= 2 ? 2 : 4;

  state.treasureTokens = [];
  for (let i = 0; i < tokenCount; i++) {
    let pos;
    let attempts = 0;
    do {
      pos = getRandomBoardPosition(state);
      attempts++;
    } while (
      state.board[pos.row]?.[pos.col]?.type !== TILE_TYPES.SEA &&
      attempts < 100
    );
    state.treasureTokens.push({ id: uuid(), col: pos.col, row: pos.row });
  }
}

export function getCurrentPlayer(state) {
  const playerId = state.turnOrder[state.currentPlayerIndex];
  return state.players[playerId];
}

export function getAvailableStartingIslands(state) {
  return getStartingIslands(state.islands).filter(
    i => !i.owner
  );
}

export function pickStartingIsland(state, playerId, islandId) {
  const island = state.islands[islandId];
  if (!island) return { error: 'Island not found' };
  if (island.skulls !== 1) return { error: 'Must pick a 1-skull island' };
  if (island.owner) return { error: 'Island already taken' };

  // Check it's this player's turn to pick
  if (state.islandPickOrder[state.islandPickIndex] !== playerId) {
    return { error: 'Not your turn to pick' };
  }

  // Assign island
  island.owner = playerId;
  const player = state.players[playerId];
  player.ownedIslands.push(islandId);

  // Place a ship in the port
  if (island.port) {
    const ship = createShip(playerId, island.port);
    player.ships.push(ship);
  }

  // Draw 3 initial resource cards
  const drawn = drawFromDeck(state.resourceDeck, 3);
  for (const r of drawn) {
    player.resources[r]++;
  }

  // Advance pick order
  state.islandPickIndex++;

  // Check if all players have picked
  if (state.islandPickIndex >= state.islandPickOrder.length) {
    placeStorm(state);
    placeTreasureTokens(state);
    state.phase = GAME_PHASES.GAMEPLAY;
    state.currentPlayerIndex = 0;
    state.turnPhase = TURN_PHASES.DRAW_RESOURCES;
    state.turnNumber = 1;
  }

  return { success: true, drawn };
}

function createShip(ownerId, position) {
  return {
    id: uuid(),
    owner: ownerId,
    position: { ...position },
    lifePegs: INITIAL_LIFE_PEGS,
    masts: 0,
    cannons: 0,
    movesUsed: 0,
    doneForTurn: false,
    hasAttackedThisTurn: false,
    jettisonBonus: 0,
  };
}

// === TURN ACTIONS ===

export function drawResources(state, playerId) {
  const player = state.players[playerId];

  if (player.ships.length === 0) {
    return handleShiplessDraw(state, playerId);
  }

  // Storm-blocked islands (skull/flag tile covered by storm) don't generate resources
  let drawCount = 0;
  const blockedIslands = [];
  for (const islandId of player.ownedIslands) {
    if (isIslandStormBlocked(state, islandId)) {
      blockedIslands.push(islandId);
    } else {
      drawCount++;
    }
  }

  const drawn = drawFromDeck(state.resourceDeck, drawCount);
  for (const r of drawn) {
    player.resources[r]++;
  }

  state.turnPhase = TURN_PHASES.ROLL_FOR_MOVE;
  return { success: true, drawn, blockedIslands };
}

function handleShiplessDraw(state, playerId) {
  const player = state.players[playerId];
  const mode = state.settings.shiplessMode;

  // Storm-blocked islands (skull/flag tile covered) don't generate resources even for shipless captains
  let drawCount = 0;
  for (const islandId of player.ownedIslands) {
    if (!isIslandStormBlocked(state, islandId)) drawCount++;
  }
  const drawn = drawFromDeck(state.resourceDeck, drawCount);
  for (const r of drawn) {
    player.resources[r]++;
  }

  // Rulebook: if no islands AND no PP cards, take one resource of your choosing
  const needsFreeResource = player.ownedIslands.length === 0 && player.plunderPointCards === 0;
  const freeResourceNeeded = needsFreeResource && mode === SHIPLESS_MODES.RULEBOOK;

  if (mode === SHIPLESS_MODES.FREE_SHIP) {
    const ownedIsland = player.ownedIslands
      .map(id => state.islands[id])
      .find(i => i && i.port);
    if (ownedIsland && !isOccupied(state, ownedIsland.port, null)) {
      const ship = createShip(playerId, ownedIsland.port);
      player.ships.push(ship);
      state.turnPhase = TURN_PHASES.ROLL_FOR_MOVE;
      return { success: true, drawn, shipless: true, freeShip: true };
    }
    state.turnPhase = TURN_PHASES.PERFORM_ACTIONS;
    return { success: true, drawn, shipless: true, noPort: true };
  }

  if (mode === SHIPLESS_MODES.FREE_RESOURCES) {
    const bonus = drawFromDeck(state.resourceDeck, 3);
    for (const r of bonus) {
      player.resources[r]++;
    }
    state.turnPhase = TURN_PHASES.PERFORM_ACTIONS;
    return { success: true, drawn: [...drawn, ...bonus], shipless: true, bonusResources: true };
  }

  // RULEBOOK mode: need to roll doubles
  state.turnPhase = TURN_PHASES.PERFORM_ACTIONS;
  return { success: true, drawn, shipless: true, needsShiplessRoll: true, freeResourceNeeded };
}

// Shipless captain: choose a free resource (when you have no islands and no PP)
export function shiplessChooseResource(state, playerId, resourceType) {
  const player = state.players[playerId];
  if (player.ships.length > 0) return { error: 'You have ships' };
  if (player.ownedIslands.length > 0) return { error: 'You own islands' };
  if (player.plunderPointCards > 0) return { error: 'You have PP cards' };
  if (!RESOURCE_TYPES.includes(resourceType)) return { error: 'Invalid resource type' };

  player.resources[resourceType]++;
  return { success: true, resource: resourceType };
}

export function shiplessRoll(state, playerId) {
  const player = state.players[playerId];
  if (player.ships.length > 0) return { error: 'You have ships' };
  if (player.shiplessRecoveryBlocked) return { error: 'Cannot recover a ship this turn — wait until your next turn' };
  if (state.settings.shiplessMode !== SHIPLESS_MODES.RULEBOOK) {
    return { error: 'Shipless roll not available in this mode' };
  }

  const die1 = rollDie(6);
  const die2 = rollDie(6);
  const isDoubles = die1 === die2;

  // Store for potential reroll
  state.lastShiplessRoll = { dice: [die1, die2], playerId };
  state.hasRerolledShipless = false;

  if (isDoubles) {
    const placement = findShipPlacement(state, player);
    if (placement) {
      const ship = createShip(playerId, placement);
      ship.builtThisTurn = true;
      ship.doneForTurn = true;
      player.ships.push(ship);
      return { success: true, die1, die2, doubles: true, gotShip: true };
    }
    return { success: true, die1, die2, doubles: true, gotShip: false, noPort: true };
  }

  // Rulebook: if doubles fail, player can still use alternative methods
  return { success: true, die1, die2, doubles: false, canUseAlternatives: true };
}

// Shipless captain: exchange 1 PP card for a ship
export function shiplessExchangePP(state, playerId) {
  const player = state.players[playerId];
  if (player.ships.length > 0) return { error: 'You have ships' };
  if (player.shiplessRecoveryBlocked) return { error: 'Cannot recover a ship this turn — wait until your next turn' };
  if (player.plunderPointCards < 1) return { error: 'Not enough Plunder Point cards' };

  const placement = findShipPlacement(state, player);
  if (!placement) return { error: 'No available placement for new ship' };

  player.plunderPointCards--;
  const ship = createShip(playerId, placement);
  ship.builtThisTurn = true;
  ship.doneForTurn = true;
  player.ships.push(ship);
  return { success: true, ship, method: 'pp_exchange' };
}

// Shipless captain: exchange 5 gold for a ship
export function shiplessExchangeGold(state, playerId) {
  const player = state.players[playerId];
  if (player.ships.length > 0) return { error: 'You have ships' };
  if (player.shiplessRecoveryBlocked) return { error: 'Cannot recover a ship this turn — wait until your next turn' };
  if (player.resources.gold < 5) return { error: 'Need 5 gold' };

  const placement = findShipPlacement(state, player);
  if (!placement) return { error: 'No available placement for new ship' };

  player.resources.gold -= 5;
  const ship = createShip(playerId, placement);
  ship.builtThisTurn = true;
  ship.doneForTurn = true;
  player.ships.push(ship);
  return { success: true, ship, method: 'gold_exchange' };
}

// Shipless captain: disown an island to get a ship
export function shiplessDisownIsland(state, playerId, islandId) {
  const player = state.players[playerId];
  if (player.ships.length > 0) return { error: 'You have ships' };
  if (player.shiplessRecoveryBlocked) return { error: 'Cannot recover a ship this turn — wait until your next turn' };
  if (!player.ownedIslands.includes(islandId)) return { error: 'You do not own this island' };

  const island = state.islands[islandId];
  if (!island) return { error: 'Island not found' };

  // Remove ownership
  player.ownedIslands = player.ownedIslands.filter(id => id !== islandId);
  island.owner = null;

  const placement = findShipPlacement(state, player);
  if (!placement) return { error: 'No available placement for new ship' };

  const ship = createShip(playerId, placement);
  ship.builtThisTurn = true;
  ship.doneForTurn = true;
  player.ships.push(ship);
  return { success: true, ship, method: 'disown_island', disownedIsland: islandId };
}

// Helper: find ship placement (port or adjacent to existing ships)
function findShipPlacement(state, player) {
  // Try port first
  const ownedIsland = player.ownedIslands
    .map(id => state.islands[id])
    .find(i => i && i.port && !isOccupied(state, i.port, null));
  if (ownedIsland) return ownedIsland.port;

  // Try adjacent to existing ships
  for (const ship of player.ships) {
    for (const [dc, dr] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const adjPos = { col: ship.position.col + dc, row: ship.position.row + dr };
      if (adjPos.col < 0 || adjPos.col >= state.totalCols || adjPos.row < 0 || adjPos.row >= state.totalRows) continue;
      const tile = state.board[adjPos.row]?.[adjPos.col];
      if (!tile || (tile.type !== TILE_TYPES.SEA && tile.type !== TILE_TYPES.PORT)) continue;
      if (isOccupied(state, adjPos, null)) continue;
      return adjPos;
    }
  }

  // Shipless with no ships — place at random port or sea tile near owned island
  for (const islandId of player.ownedIslands) {
    const island = state.islands[islandId];
    if (island?.port && !isOccupied(state, island.port, null)) return island.port;
  }

  // Last resort: random sea tile
  let attempts = 0;
  while (attempts < 100) {
    const pos = getRandomBoardPosition(state);
    const tile = state.board[pos.row]?.[pos.col];
    if (tile?.type === TILE_TYPES.SEA && !isOccupied(state, pos, null)) return pos;
    attempts++;
  }
  return null;
}

export function rollSailingDie(state) {
  const roll = rollDie(6);
  state.dieRoll = roll;
  state.hasRolled = true;

  let stormMoved = false;
  if (roll === 1) {
    placeStorm(state);
    stormMoved = true;
  }

  const player = getCurrentPlayer(state);
  let totalMovePoints = roll;
  for (const ship of player.ships) {
    // Only count masts that existed before the roll (not built this turn)
    const effectiveMasts = ship.masts - (ship.mastBuiltThisTurn || 0);
    totalMovePoints += Math.max(0, effectiveMasts);
  }
  state.movePointsRemaining = totalMovePoints;

  state.turnPhase = TURN_PHASES.PERFORM_ACTIONS;

  for (const ship of player.ships) {
    ship.movesUsed = 0;
    ship.doneForTurn = ship.builtThisTurn || false; // Ships built this turn can't move
  }

  return { roll, totalMovePoints, stormMoved, stormPosition: state.storm };
}

// === REROLL HELPERS ===

function canReroll(state, playerId) {
  const mode = state.settings.rerollMode;
  if (mode === REROLL_MODES.NONE) return false;
  const player = state.players[playerId];
  if (mode === REROLL_MODES.ONE_PER_GAME) return player.rerollsUsed < 1;
  if (mode === REROLL_MODES.SPEND_RESOURCES) return true; // cost checked separately
  return false;
}

function validateResourceCost(player, resourceCost) {
  if (!resourceCost || typeof resourceCost !== 'object') return { error: 'Resource cost required' };
  let total = 0;
  for (const res of RESOURCE_TYPES) {
    const amt = resourceCost[res] || 0;
    if (amt < 0 || !Number.isInteger(amt)) return { error: 'Invalid resource amount' };
    if (amt > (player.resources[res] || 0)) return { error: `Not enough ${res}` };
    total += amt;
  }
  if (total !== 3) return { error: 'Must spend exactly 3 resources' };
  return { valid: true };
}

function consumeReroll(state, playerId, resourceCost) {
  const player = state.players[playerId];
  player.rerollsUsed++;
  if (state.settings.rerollMode === REROLL_MODES.SPEND_RESOURCES && resourceCost) {
    for (const res of RESOURCE_TYPES) {
      const amt = resourceCost[res] || 0;
      if (amt > 0) player.resources[res] -= amt;
    }
  }
}

// === SAILING DIE REROLL ===

export function rerollSailingDie(state, playerId, resourceCost) {
  const currentId = state.turnOrder[state.currentPlayerIndex];
  if (currentId !== playerId) return { error: 'Not your turn' };
  if (!state.hasRolled) return { error: 'Must roll first' };
  if (state.hasRerolledSailing) return { error: 'Already rerolled this turn' };
  if (!canReroll(state, playerId)) return { error: 'No reroll available' };

  const player = state.players[playerId];
  if (state.settings.rerollMode === REROLL_MODES.SPEND_RESOURCES) {
    const v = validateResourceCost(player, resourceCost);
    if (v.error) return v;
  }

  // Re-roll the die (no storm on reroll)
  const roll = rollDie(6);
  state.dieRoll = roll;
  state.hasRerolledSailing = true;

  // Recalculate move points from scratch
  let totalMovePoints = roll;
  for (const ship of player.ships) {
    const effectiveMasts = ship.masts - (ship.mastBuiltThisTurn || 0);
    totalMovePoints += Math.max(0, effectiveMasts);
  }
  state.movePointsRemaining = totalMovePoints;

  consumeReroll(state, playerId, resourceCost);

  return { success: true, roll, totalMovePoints };
}

// === SHIPLESS DIE REROLL ===

export function rerollShiplessDie(state, playerId, dieIndex, resourceCost) {
  const player = state.players[playerId];
  if (player.ships.length > 0) return { error: 'You have ships' };
  if (!state.lastShiplessRoll) return { error: 'No shipless roll to reroll' };
  if (state.lastShiplessRoll.playerId !== playerId) return { error: 'Not your roll' };
  if (state.hasRerolledShipless) return { error: 'Already rerolled shipless dice' };
  if (dieIndex !== 0 && dieIndex !== 1) return { error: 'Invalid die index' };
  if (!canReroll(state, playerId)) return { error: 'No reroll available' };

  if (state.settings.rerollMode === REROLL_MODES.SPEND_RESOURCES) {
    const v = validateResourceCost(player, resourceCost);
    if (v.error) return v;
  }

  const dice = [...state.lastShiplessRoll.dice];
  dice[dieIndex] = rollDie(6);
  state.lastShiplessRoll.dice = dice;
  state.hasRerolledShipless = true;

  consumeReroll(state, playerId, resourceCost);

  const isDoubles = dice[0] === dice[1];
  if (isDoubles) {
    const placement = findShipPlacement(state, player);
    if (placement) {
      const ship = createShip(playerId, placement);
      ship.builtThisTurn = true;
      ship.doneForTurn = true;
      player.ships.push(ship);
      return { success: true, die1: dice[0], die2: dice[1], doubles: true, gotShip: true };
    }
    return { success: true, die1: dice[0], die2: dice[1], doubles: true, gotShip: false, noPort: true };
  }

  return { success: true, die1: dice[0], die2: dice[1], doubles: false };
}

export function moveShip(state, playerId, shipId, path) {
  if (state.pendingStormCost) return { error: 'Must resolve storm cost first' };
  if (state.pendingAttack) return { error: 'Must resolve pending attack first' };
  if (state.pendingCombatReroll) return { error: 'Must resolve combat reroll first' };

  const player = state.players[playerId];
  const ship = player.ships.find(s => s.id === shipId);
  if (!ship) return { error: 'Ship not found' };
  if (ship.doneForTurn) return { error: 'Ship is done for this turn' };

  const moveCost = path.length;
  const bonus = ship.jettisonBonus || 0;
  const totalAvailable = state.movePointsRemaining + bonus;
  if (moveCost > totalAvailable) {
    return { error: 'Not enough move points' };
  }

  let current = { ...ship.position };
  for (const step of path) {
    const dx = Math.abs(step.col - current.col);
    const dy = Math.abs(step.row - current.row);
    if (dx + dy !== 1) return { error: 'Movement must be orthogonal' };

    const tile = state.board[step.row]?.[step.col];
    if (!tile) return { error: 'Out of bounds' };
    if (tile.type !== TILE_TYPES.SEA && tile.type !== TILE_TYPES.PORT) {
      return { error: 'Cannot move through islands' };
    }

    // Check for wall barriers between current position and next step
    if (hasWallBetween(state, current, step)) {
      return { error: 'Path blocked by wall' };
    }

    // Check port approach direction restriction (entry only — exit is unrestricted)
    if (isPortEntryBlocked(state, current, step)) {
      return { error: 'Cannot enter port from this direction' };
    }

    const occupied = isOccupied(state, step, shipId);
    if (occupied) return { error: 'Space occupied by another ship' };

    current = step;
  }

  // Check storm costs (Rulebook: treasure card movement costs nothing for storm)
  const stormTiles = state.storm ? state.storm.tiles : [];
  let stormCost = 0;
  const wasInStorm = stormTiles.some(t => t.col === ship.position.col && t.row === ship.position.row);
  const entersStorm = path.some(p => stormTiles.some(t => t.col === p.col && t.row === p.row));
  const finalInStorm = stormTiles.some(t => t.col === current.col && t.row === current.row);

  if (!ship.movedByTreasure) {
    if (!wasInStorm && entersStorm) stormCost += 2;
    if (wasInStorm && !finalInStorm) stormCost += 2;
  }

  const totalResources = Object.values(player.resources).reduce((a, b) => a + b, 0);
  if (stormCost > 0 && totalResources < stormCost) {
    return { error: `Need ${stormCost} resources to enter/exit the storm` };
  }

  // Save original position before applying movement (for storm cancel)
  const originalPosition = { ...ship.position };

  // Apply movement — consume from global pool first, then jettison bonus
  ship.position = current;
  ship.movesUsed += moveCost;
  const fromGlobal = Math.min(moveCost, state.movePointsRemaining);
  state.movePointsRemaining -= fromGlobal;
  ship.jettisonBonus = Math.max(0, bonus - (moveCost - fromGlobal));

  // If storm cost is owed, set pending state for player to choose which resources to pay
  if (stormCost > 0) {
    state.pendingStormCost = {
      playerId,
      amount: stormCost,
      shipId,
      previousPosition: originalPosition,
      moveCost,
    };
  }

  // Check for treasure tokens along the path (player can choose to pick up)
  // Rulebook: multiple Xs can occupy the same space — find ALL tokens at each step
  const treasuresOnPath = [];
  for (const step of path) {
    const tokensAtStep = state.treasureTokens.filter(
      t => t.col === step.col && t.row === step.row
    );
    for (const token of tokensAtStep) {
      treasuresOnPath.push({ ...token });
    }
  }

  return { success: true, newPosition: current, stormCost, treasuresOnPath };
}

// Lightening the Load: jettison cannons for bonus movement
export function jettisonCannons(state, playerId, shipId, count) {
  if (!state.settings.lightenTheLoad) return { error: 'Lightening the Load is disabled' };
  if (state.turnPhase !== TURN_PHASES.PERFORM_ACTIONS) return { error: 'Can only jettison during action phase' };
  if (state.turnOrder[state.currentPlayerIndex] !== playerId) return { error: 'Not your turn' };
  if (state.pendingStormCost) return { error: 'Must resolve storm cost first' };
  if (state.pendingAttack) return { error: 'Must resolve pending attack first' };

  const player = state.players[playerId];
  if (!player) return { error: 'Player not found' };

  const ship = player.ships.find(s => s.id === shipId);
  if (!ship) return { error: 'Ship not found' };

  if (count !== 1 && count !== 2) return { error: 'Can only jettison 1 or 2 cannons' };
  if (ship.cannons < count) return { error: 'Ship does not have enough cannons' };
  if (ship.jettisonBonus > 0) return { error: 'Ship has already jettisoned cannons this turn' };

  ship.cannons -= count;
  ship.jettisonBonus = count === 1 ? 1 : 3;

  return { success: true, bonusMoves: ship.jettisonBonus, cannonsRemaining: ship.cannons };
}

// Player chooses to collect a specific treasure token
export function collectTreasure(state, playerId, tokenId) {
  const tokenIndex = state.treasureTokens.findIndex(t => t.id === tokenId);
  if (tokenIndex === -1) return { error: 'Treasure token not found' };

  const token = state.treasureTokens[tokenIndex];
  const player = state.players[playerId];

  // Rulebook: X is inaccessible if another player's ship is on it
  const shipOnToken = Object.values(state.players).some(p =>
    p.id !== playerId && p.ships.some(s =>
      s.position.col === token.col && s.position.row === token.row
    )
  );
  if (shipOnToken) {
    return { error: 'Another player\'s ship is on this treasure token' };
  }

  // Verify player has a ship on or adjacent to the token
  const collectingShip = player.ships.find(s =>
    s.position.col === token.col && s.position.row === token.row
  );
  if (!collectingShip) {
    // Rulebook: if X is on land, ship must be on an adjoining ocean space (not through a land barrier)
    const adjacentShip = player.ships.find(s => {
      const dx = Math.abs(s.position.col - token.col);
      const dy = Math.abs(s.position.row - token.row);
      if (dx + dy !== 1) return false;
      // Check for land barrier or wall between ship and treasure
      if (hasLandBarrierBetween(state, s.position, token)) return false;
      if (hasWallBetween(state, s.position, token)) return false;
      return true;
    });
    if (!adjacentShip) return { error: 'No ship on or adjacent to the treasure (or blocked by land barrier)' };

    // Rulebook: cannot collect across storm border
    if (isAcrossStormBorder(state, adjacentShip.position, token)) {
      return { error: 'Cannot collect treasure across the storm border' };
    }
  }

  // Rulebook: after collecting, relocate the X token to new random sea tile (not remove it)
  relocateTreasureToken(state, tokenIndex);

  const cards = drawFromDeck(state.treasureDeck, 1);
  if (cards.length === 0) return { error: 'No treasure cards left' };

  const card = cards[0];
  const result = applyTreasureCard(state, playerId, card);

  // Reshuffle deck after drawing the last card
  if (state.treasureDeck.length === 0) {
    state.treasureDeck = shuffle(createTreasureDeck());
    result.reshuffled = true;
  }

  return result;
}

function relocateTreasureToken(state, tokenIndex) {
  let pos;
  let attempts = 0;
  do {
    pos = getRandomBoardPosition(state);
    attempts++;
  } while (
    state.board[pos.row]?.[pos.col]?.type !== TILE_TYPES.SEA &&
    attempts < 100
  );
  state.treasureTokens[tokenIndex] = { id: state.treasureTokens[tokenIndex].id, col: pos.col, row: pos.row };
}

function applyTreasureCard(state, playerId, card) {
  const player = state.players[playerId];

  switch (card.type) {
    case 'gold': {
      player.resources.gold += card.amount;
      return { success: true, card, applied: true };
    }
    case 'resource': {
      player.resources[card.resource] += card.amount;
      return { success: true, card, applied: true };
    }
    case 'plunder_point': {
      player.plunderPointCards += card.amount;
      const total = calculatePlunderPoints(state, playerId);
      if (total >= state.settings.ppToWin) {
        state.phase = GAME_PHASES.GAME_OVER;
        state.winner = playerId;
      }
      return { success: true, card, applied: true };
    }
    case 'steal': {
      const otherPlayers = Object.keys(state.players).filter(id => id !== playerId);
      if (otherPlayers.length === 0) {
        return { success: true, card, applied: false, noTargets: true };
      }
      state.pendingTreasure = { type: 'steal', playerId, amount: card.amount, card };
      return { success: true, card, applied: false, needsTarget: true };
    }
    case 'storm': {
      const totalRes = Object.values(player.resources).reduce((a, b) => a + b, 0);
      if (totalRes === 0) {
        return { success: true, card, applied: true, noResources: true };
      }
      const toDiscard = Math.min(2, totalRes);
      state.pendingTreasure = { type: 'storm_discard', playerId, amount: toDiscard, card };
      return { success: true, card, applied: false, needsDiscard: toDiscard };
    }
    case 'end_turn': {
      return { success: true, card, applied: true, endsTurn: true };
    }
    case 'free_cannon': {
      // Find a ship that can receive a cannon
      const eligibleShip = player.ships.find(s => s.cannons < MAX_CANNONS);
      if (eligibleShip) {
        eligibleShip.cannons++;
        return { success: true, card, applied: true, upgradedShip: eligibleShip.id };
      }
      return { success: true, card, applied: false, noEligibleShip: true };
    }
    case 'free_mast': {
      const eligibleShip = player.ships.find(s => s.masts < MAX_MASTS);
      if (eligibleShip) {
        eligibleShip.masts++;
        return { success: true, card, applied: true, upgradedShip: eligibleShip.id };
      }
      return { success: true, card, applied: false, noEligibleShip: true };
    }
    case 'free_life': {
      const eligibleShip = player.ships.find(s => s.lifePegs < MAX_LIFE_PEGS);
      if (eligibleShip) {
        eligibleShip.lifePegs++;
        return { success: true, card, applied: true, upgradedShip: eligibleShip.id };
      }
      return { success: true, card, applied: false, noEligibleShip: true };
    }
    case 'lose_resource': {
      const loseType = card.resource;
      const loseAmt = Math.min(card.amount, player.resources[loseType] || 0);
      player.resources[loseType] -= loseAmt;
      return { success: true, card, applied: true, lost: { [loseType]: loseAmt } };
    }
    default:
      return { success: true, card, applied: true };
  }
}

export function resolveTreasureSteal(state, playerId, targetId) {
  if (!state.pendingTreasure || state.pendingTreasure.type !== 'steal') {
    return { error: 'No pending steal' };
  }
  if (state.pendingTreasure.playerId !== playerId) {
    return { error: 'Not your pending treasure' };
  }

  const target = state.players[targetId];
  if (!target) return { error: 'Target not found' };

  const amount = state.pendingTreasure.amount;
  const stolen = [];

  const targetResources = [];
  for (const [type, count] of Object.entries(target.resources)) {
    for (let i = 0; i < count; i++) targetResources.push(type);
  }

  // Shuffle
  for (let i = targetResources.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [targetResources[i], targetResources[j]] = [targetResources[j], targetResources[i]];
  }

  const toSteal = Math.min(amount, targetResources.length);
  const player = state.players[playerId];
  for (let i = 0; i < toSteal; i++) {
    const res = targetResources[i];
    target.resources[res]--;
    player.resources[res]++;
    stolen.push(res);
  }

  state.pendingTreasure = null;
  return { success: true, stolen, targetId };
}

export function resolveTreasureStormDiscard(state, playerId, discards) {
  if (!state.pendingTreasure || state.pendingTreasure.type !== 'storm_discard') {
    return { error: 'No pending storm discard' };
  }
  if (state.pendingTreasure.playerId !== playerId) {
    return { error: 'Not your pending treasure' };
  }

  const player = state.players[playerId];
  const amount = state.pendingTreasure.amount;

  let totalDiscard = 0;
  for (const [res, count] of Object.entries(discards)) {
    if (count < 0) return { error: 'Invalid discard' };
    if (player.resources[res] < count) return { error: `Not enough ${res}` };
    totalDiscard += count;
  }
  if (totalDiscard !== amount) return { error: `Must discard exactly ${amount} resources` };

  for (const [res, count] of Object.entries(discards)) {
    player.resources[res] -= count;
  }

  state.pendingTreasure = null;
  return { success: true, discarded: discards };
}

// Resolve storm entry/exit cost — player chooses which resources to pay
export function resolveStormCost(state, playerId, discards) {
  if (!state.pendingStormCost) {
    return { error: 'No pending storm cost' };
  }
  if (state.pendingStormCost.playerId !== playerId) {
    return { error: 'Not your pending storm cost' };
  }

  const player = state.players[playerId];
  const amount = state.pendingStormCost.amount;

  let totalDiscard = 0;
  for (const [res, count] of Object.entries(discards)) {
    if (count < 0) return { error: 'Invalid discard' };
    if (player.resources[res] < count) return { error: `Not enough ${res}` };
    totalDiscard += count;
  }
  if (totalDiscard !== amount) return { error: `Must discard exactly ${amount} resources` };

  for (const [res, count] of Object.entries(discards)) {
    player.resources[res] -= count;
  }

  state.pendingStormCost = null;
  return { success: true, discarded: discards };
}

// Cancel a storm move — undo the ship movement and restore move points
export function cancelStormMove(state, playerId) {
  if (!state.pendingStormCost) {
    return { error: 'No pending storm cost' };
  }
  if (state.pendingStormCost.playerId !== playerId) {
    return { error: 'Not your pending storm cost' };
  }

  const player = state.players[playerId];
  const ship = player.ships.find(s => s.id === state.pendingStormCost.shipId);
  if (!ship) return { error: 'Ship not found' };

  // Undo the move
  ship.position = state.pendingStormCost.previousPosition;
  ship.movesUsed -= state.pendingStormCost.moveCost;
  state.movePointsRemaining += state.pendingStormCost.moveCost;

  state.pendingStormCost = null;
  return { success: true };
}

function isOccupied(state, pos, excludeShipId) {
  for (const player of Object.values(state.players)) {
    for (const ship of player.ships) {
      if (ship.id !== excludeShipId && ship.position.col === pos.col && ship.position.row === pos.row) {
        return true;
      }
    }
  }
  return false;
}

// Building is allowed at any time during the player's turn
export function buildItem(state, playerId, buildType, targetShipId) {
  const player = state.players[playerId];
  const cost = BUILD_COSTS[buildType];
  if (!cost) return { error: 'Invalid build type' };

  for (const [resource, amount] of Object.entries(cost)) {
    if (player.resources[resource] < amount) {
      return { error: `Not enough ${resource}` };
    }
  }

  for (const [resource, amount] of Object.entries(cost)) {
    player.resources[resource] -= amount;
  }

  if (buildType === 'ship') {
    if (player.ships.length >= 3) {
      refundCost(player, cost);
      return { error: 'Maximum 3 ships' };
    }

    // Rulebook: Place ship in an available port OR any adjoining ocean space next to one of your ships
    let placementPos = null;
    let placedAtPort = false;

    // First try: available port on owned island
    const ownedIsland = player.ownedIslands
      .map(id => state.islands[id])
      .find(i => i && i.port && !isOccupied(state, i.port, null));
    if (ownedIsland) {
      placementPos = ownedIsland.port;
      placedAtPort = true;
    }

    // Second try: adjacent sea tile next to any existing ship
    if (!placementPos && player.ships.length > 0) {
      for (const existingShip of player.ships) {
        for (const [dc, dr] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          const adjPos = { col: existingShip.position.col + dc, row: existingShip.position.row + dr };
          if (adjPos.col < 0 || adjPos.col >= state.totalCols || adjPos.row < 0 || adjPos.row >= state.totalRows) continue;
          const tile = state.board[adjPos.row]?.[adjPos.col];
          if (!tile || (tile.type !== TILE_TYPES.SEA && tile.type !== TILE_TYPES.PORT)) continue;
          if (isOccupied(state, adjPos, null)) continue;
          placementPos = adjPos;
          break;
        }
        if (placementPos) break;
      }
    }

    if (!placementPos) {
      refundCost(player, cost);
      return { error: 'No available port or adjacent space for new ship' };
    }
    const newShip = createShip(playerId, placementPos);
    // Rulebook: new ships cannot move or attack the turn they are acquired
    newShip.builtThisTurn = true;
    newShip.doneForTurn = true;
    player.ships.push(newShip);
    return { success: true, ship: newShip, placedAtPort };
  }

  if (buildType === 'plunderPoint') {
    player.plunderPointCards++;
    const total = calculatePlunderPoints(state, playerId);
    if (total >= state.settings.ppToWin) {
      state.phase = GAME_PHASES.GAME_OVER;
      state.winner = playerId;
    }
    return { success: true, plunderPoints: total };
  }

  const ship = player.ships.find(s => s.id === targetShipId);
  if (!ship) {
    refundCost(player, cost);
    return { error: 'Ship not found' };
  }

  if (buildType === 'cannon') {
    if (ship.cannons >= MAX_CANNONS) return refundAndError(player, cost, `Max cannons reached (${MAX_CANNONS})`);
    ship.cannons++;
  } else if (buildType === 'mast') {
    if (ship.masts >= MAX_MASTS) return refundAndError(player, cost, `Max masts reached (${MAX_MASTS})`);
    ship.masts++;
    // Rulebook: mast built after rolling does not grant extra movement this turn
    if (state.hasRolled) {
      ship.mastBuiltThisTurn = (ship.mastBuiltThisTurn || 0) + 1;
    }
  } else if (buildType === 'lifePeg') {
    if (ship.lifePegs >= MAX_LIFE_PEGS) return refundAndError(player, cost, `Max life pegs reached (${MAX_LIFE_PEGS})`);
    ship.lifePegs++;
  }

  return { success: true, ship };
}

function refundCost(player, cost) {
  for (const [resource, amount] of Object.entries(cost)) {
    player.resources[resource] += amount;
  }
}

function refundAndError(player, cost, message) {
  refundCost(player, cost);
  return { error: message };
}

// === COMBAT ===

// --- Validation helpers (shared by instant and bribe flows) ---

function validateIslandAttack(state, playerId, shipId, islandId) {
  if (state.pendingAttack) return { error: 'Another attack is pending' };
  const player = state.players[playerId];
  const ship = player.ships.find(s => s.id === shipId);
  const island = state.islands[islandId];

  if (!ship || !island) return { error: 'Invalid ship or island' };
  if (ship.doneForTurn || ship.hasAttackedThisTurn) return { error: 'This ship cannot attack this turn' };
  if (island.type !== 'resource') return { error: 'Cannot attack this island' };
  if (island.owner === playerId) return { error: 'You already own this island' };

  if (!island.port || ship.position.col !== island.port.col || ship.position.row !== island.port.row) {
    return { error: 'Must be in the island port to attack' };
  }

  // Note: no storm-border check here — the ship is docked at the island's own port,
  // so by definition it's adjacent to the island. An attack can't meaningfully be
  // "across" the storm border when the attacker is already at the target's dock.

  if (island.owner && hasTreaty(state, playerId, island.owner)) {
    return { error: 'You have a treaty with this player this turn' };
  }

  if (state.attackedThisTurn[shipId]?.has(islandId)) {
    return { error: 'This ship already attacked this island this turn' };
  }

  return { valid: true, player, ship, island };
}

function validateShipAttack(state, attackerId, attackerShipId, defenderShipId) {
  if (state.pendingAttack) return { error: 'Another attack is pending' };
  const attacker = state.players[attackerId];
  const attackerShip = attacker.ships.find(s => s.id === attackerShipId);
  if (!attackerShip) return { error: 'Attacker ship not found' };
  if (attackerShip.doneForTurn || attackerShip.hasAttackedThisTurn) return { error: 'This ship cannot attack this turn' };

  let defender = null;
  let defenderShip = null;
  for (const p of Object.values(state.players)) {
    const s = p.ships.find(s => s.id === defenderShipId);
    if (s) { defender = p; defenderShip = s; break; }
  }
  if (!defenderShip) return { error: 'Defender ship not found' };

  if (hasTreaty(state, attackerId, defender.id)) {
    return { error: 'You have a treaty with this player this turn' };
  }

  const dx = Math.abs(attackerShip.position.col - defenderShip.position.col);
  const dy = Math.abs(attackerShip.position.row - defenderShip.position.row);
  if (dx + dy !== 1) return { error: 'Must be adjacent to attack' };

  if (hasLandBarrierBetween(state, attackerShip.position, defenderShip.position)) {
    return { error: 'Cannot attack through a land barrier' };
  }

  if (isAcrossStormBorder(state, attackerShip.position, defenderShip.position)) {
    return { error: 'Cannot attack across the storm border' };
  }

  if (state.attackedThisTurn[attackerShipId]?.has(defenderShipId)) {
    return { error: 'This ship already attacked this target this turn' };
  }

  return { valid: true, attacker, attackerShip, defender, defenderShip };
}

// --- Combat execution helpers ---

function rollCombatDice(state, playerId, shipId, targetId, type) {
  const player = state.players[playerId];
  const ship = player.ships.find(s => s.id === shipId);

  let attackDie = rollDie(6);
  let defenseDie = rollDie(6);
  let attackerCannons = ship.cannons;
  let defenderModifier = 0;
  let defenderId = null;

  if (type === 'island') {
    const island = state.islands[targetId];
    defenderModifier = island.skulls;
    defenderId = island.owner || null;
  } else {
    // ship combat
    let defenderShip = null;
    for (const p of Object.values(state.players)) {
      const s = p.ships.find(s => s.id === targetId);
      if (s) { defenderShip = s; defenderId = p.id; break; }
    }
    defenderModifier = defenderShip ? defenderShip.cannons : 0;
  }

  return { attackDie, defenseDie, attackerCannons, defenderModifier, defenderId };
}

function startCombatWithReroll(state, type, attackerId, attackerShipId, targetId) {
  const { attackDie, defenseDie, attackerCannons, defenderModifier, defenderId } =
    rollCombatDice(state, attackerId, attackerShipId, targetId, type);

  // Mark attacked this turn
  if (!state.attackedThisTurn[attackerShipId]) state.attackedThisTurn[attackerShipId] = new Set();
  state.attackedThisTurn[attackerShipId].add(targetId);

  // Mark ship as having attacked (but still allow movement)
  const attackerPlayer = state.players[attackerId];
  const ship = attackerPlayer.ships.find(s => s.id === attackerShipId);
  if (ship) ship.hasAttackedThisTurn = true;

  const attackerCanReroll = canReroll(state, attackerId);
  const defenderCanReroll = defenderId && canReroll(state, defenderId);

  // If neither side can reroll, resolve immediately
  if (!attackerCanReroll && !defenderCanReroll) {
    const attackRoll = attackDie + attackerCannons;
    const defenseRoll = defenseDie + defenderModifier;
    if (type === 'island') {
      return resolveIslandCombatFromRolls(state, attackerId, attackerShipId, targetId, attackRoll, defenseRoll);
    } else {
      return resolveShipCombatFromRolls(state, attackerId, attackerShipId, targetId, attackRoll, defenseRoll);
    }
  }

  // Determine initial phase
  let initialPhase = 'attacker_reroll';
  if (!attackerCanReroll) initialPhase = 'defender_reroll';

  state.pendingCombatReroll = {
    type,
    attackerId,
    attackerShipId,
    targetId,
    attackDie,
    defenseDie,
    attackerCannons,
    defenderModifier,
    defenderId,
    attackerHasRerolled: false,
    defenderHasRerolled: false,
    phase: initialPhase,
  };

  return { success: true, pendingReroll: true };
}

function resolveIslandCombatFromRolls(state, attackerId, attackerShipId, islandId, attackRoll, defenseRoll) {
  const player = state.players[attackerId];
  const ship = player.ships.find(s => s.id === attackerShipId);
  const island = state.islands[islandId];
  const attackerWins = attackRoll >= defenseRoll;

  if (attackerWins) {
    if (island.owner) {
      const prevOwner = state.players[island.owner];
      prevOwner.ownedIslands = prevOwner.ownedIslands.filter(id => id !== islandId);
    }
    island.owner = attackerId;
    player.ownedIslands.push(islandId);
    return { success: true, won: true, attackRoll, defenseRoll };
  } else {
    if (ship) {
      ship.lifePegs--;
      const sunk = ship.lifePegs <= 0;
      let ownerGotPP = false;
      if (sunk) {
        player.ships = player.ships.filter(s => s.id !== attackerShipId);
        if (player.ships.length === 0) {
          player.shiplessRecoveryBlocked = true;
        }
        if (island.owner && island.owner !== attackerId) {
          const islandOwner = state.players[island.owner];
          islandOwner.plunderPointCards++;
          ownerGotPP = true;
          const total = calculatePlunderPoints(state, island.owner);
          if (total >= state.settings.ppToWin) {
            state.phase = GAME_PHASES.GAME_OVER;
            state.winner = island.owner;
          }
        }
      }
      return { success: true, won: false, attackRoll, defenseRoll, sunk, ownerGotPP };
    }
    return { success: true, won: false, attackRoll, defenseRoll };
  }
}

function resolveShipCombatFromRolls(state, attackerId, attackerShipId, defenderShipId, attackRoll, defenseRoll) {
  const attacker = state.players[attackerId];
  const attackerShip = attacker.ships.find(s => s.id === attackerShipId);
  let defender = null;
  let defenderShip = null;
  for (const p of Object.values(state.players)) {
    const s = p.ships.find(s => s.id === defenderShipId);
    if (s) { defender = p; defenderShip = s; break; }
  }
  const attackerWins = attackRoll >= defenseRoll;

  if (attackerWins) {
    if (defenderShip) {
      defenderShip.lifePegs--;
      const sunk = defenderShip.lifePegs <= 0;
      if (sunk) {
        defender.ships = defender.ships.filter(s => s.id !== defenderShipId);
        if (defender.ships.length === 0) {
          defender.shiplessRecoveryBlocked = true;
        }
        attacker.plunderPointCards++;
        const total = calculatePlunderPoints(state, attackerId);
        if (total >= state.settings.ppToWin) {
          state.phase = GAME_PHASES.GAME_OVER;
          state.winner = attackerId;
        }
      }
      return { success: true, attackerWon: true, attackRoll, defenseRoll, sunk };
    }
    return { success: true, attackerWon: true, attackRoll, defenseRoll };
  } else {
    if (attackerShip) {
      attackerShip.lifePegs--;
      const sunk = attackerShip.lifePegs <= 0;
      if (sunk) {
        attacker.ships = attacker.ships.filter(s => s.id !== attackerShipId);
        if (attacker.ships.length === 0) {
          attacker.shiplessRecoveryBlocked = true;
        }
        if (defender) {
          defender.plunderPointCards++;
          const total = calculatePlunderPoints(state, defender.id);
          if (total >= state.settings.ppToWin) {
            state.phase = GAME_PHASES.GAME_OVER;
            state.winner = defender.id;
          }
        }
      }
      return { success: true, attackerWon: false, attackRoll, defenseRoll, sunk };
    }
    return { success: true, attackerWon: false, attackRoll, defenseRoll };
  }
}

function executeIslandCombat(state, playerId, shipId, islandId) {
  const player = state.players[playerId];
  const ship = player.ships.find(s => s.id === shipId);
  const island = state.islands[islandId];

  // If rerolls are enabled, enter the reroll flow instead of instant resolve
  if (state.settings.rerollMode !== REROLL_MODES.NONE) {
    return startCombatWithReroll(state, 'island', playerId, shipId, islandId);
  }

  const attackDie = rollDie(6);
  const defenseDie = rollDie(6);
  const attackRoll = attackDie + ship.cannons;
  const defenseRoll = defenseDie + island.skulls;
  ship.hasAttackedThisTurn = true;

  if (!state.attackedThisTurn[shipId]) state.attackedThisTurn[shipId] = new Set();
  state.attackedThisTurn[shipId].add(islandId);

  const result = resolveIslandCombatFromRolls(state, playerId, shipId, islandId, attackRoll, defenseRoll);
  result.attackDie = attackDie;
  result.defenseDie = defenseDie;
  result.attackerCannons = ship.cannons;
  result.defenderModifier = island.skulls;
  return result;
}

function executeShipCombat(state, attackerId, attackerShipId, defenderShipId) {
  // If rerolls are enabled, enter the reroll flow
  if (state.settings.rerollMode !== REROLL_MODES.NONE) {
    return startCombatWithReroll(state, 'ship', attackerId, attackerShipId, defenderShipId);
  }

  const attacker = state.players[attackerId];
  const attackerShip = attacker.ships.find(s => s.id === attackerShipId);
  let defenderShip = null;
  for (const p of Object.values(state.players)) {
    const s = p.ships.find(s => s.id === defenderShipId);
    if (s) { defenderShip = s; break; }
  }

  const attackDie = rollDie(6);
  const defenseDie = rollDie(6);
  const attackRoll = attackDie + attackerShip.cannons;
  const defenseRoll = defenseDie + defenderShip.cannons;

  attackerShip.hasAttackedThisTurn = true;

  if (!state.attackedThisTurn[attackerShipId]) state.attackedThisTurn[attackerShipId] = new Set();
  state.attackedThisTurn[attackerShipId].add(defenderShipId);

  const result = resolveShipCombatFromRolls(state, attackerId, attackerShipId, defenderShipId, attackRoll, defenseRoll);
  result.attackDie = attackDie;
  result.defenseDie = defenseDie;
  result.attackerCannons = attackerShip.cannons;
  result.defenderModifier = defenderShip.cannons;
  return result;
}

// === COMBAT REROLL FUNCTIONS ===

export function rerollCombatDie(state, playerId, resourceCost) {
  const pending = state.pendingCombatReroll;
  if (!pending) return { error: 'No pending combat reroll' };

  if (pending.phase === 'attacker_reroll') {
    if (pending.attackerId !== playerId) return { error: 'Not the attacker' };
  } else if (pending.phase === 'defender_reroll') {
    if (pending.defenderId !== playerId) return { error: 'Not the defender' };
  } else {
    return { error: 'Combat reroll phase is over' };
  }

  if (!canReroll(state, playerId)) return { error: 'No reroll available' };

  const player = state.players[playerId];
  if (state.settings.rerollMode === REROLL_MODES.SPEND_RESOURCES) {
    const v = validateResourceCost(player, resourceCost);
    if (v.error) return v;
  }

  if (pending.phase === 'attacker_reroll') {
    pending.attackDie = rollDie(6);
    pending.attackerHasRerolled = true;
    consumeReroll(state, playerId, resourceCost);
    // Advance to defender phase if there is a defender who can reroll
    if (pending.defenderId && canReroll(state, pending.defenderId)) {
      pending.phase = 'defender_reroll';
    } else {
      // Skip defender phase, resolve
      return finishCombatReroll(state);
    }
  } else if (pending.phase === 'defender_reroll') {
    pending.defenseDie = rollDie(6);
    pending.defenderHasRerolled = true;
    consumeReroll(state, playerId, resourceCost);
    return finishCombatReroll(state);
  }

  return { success: true, phase: pending.phase, pendingCombatReroll: pending };
}

export function skipCombatReroll(state, playerId) {
  const pending = state.pendingCombatReroll;
  if (!pending) return { error: 'No pending combat reroll' };

  if (pending.phase === 'attacker_reroll') {
    if (pending.attackerId !== playerId) return { error: 'Not the attacker' };
    // Advance to defender phase if there is a defender who can reroll
    if (pending.defenderId && canReroll(state, pending.defenderId)) {
      pending.phase = 'defender_reroll';
    } else {
      return finishCombatReroll(state);
    }
  } else if (pending.phase === 'defender_reroll') {
    if (pending.defenderId !== playerId) return { error: 'Not the defender' };
    return finishCombatReroll(state);
  } else {
    return { error: 'Combat reroll phase is over' };
  }

  return { success: true, phase: pending.phase, pendingCombatReroll: pending };
}

function finishCombatReroll(state) {
  const pending = state.pendingCombatReroll;
  const attackRoll = pending.attackDie + pending.attackerCannons;
  const defenseRoll = pending.defenseDie + pending.defenderModifier;

  let combat;
  if (pending.type === 'island') {
    combat = resolveIslandCombatFromRolls(state, pending.attackerId, pending.attackerShipId, pending.targetId, attackRoll, defenseRoll);
  } else {
    combat = resolveShipCombatFromRolls(state, pending.attackerId, pending.attackerShipId, pending.targetId, attackRoll, defenseRoll);
  }

  combat.attackDie = pending.attackDie;
  combat.defenseDie = pending.defenseDie;
  combat.attackerCannons = pending.attackerCannons;
  combat.defenderModifier = pending.defenderModifier;

  const combatType = pending.type;
  state.pendingCombatReroll = null;
  return { success: true, resolved: true, combat, combatType, attackRoll, defenseRoll };
}

// --- Public attack functions (validate → instant or pending) ---

export function attackIsland(state, playerId, shipId, islandId) {
  const v = validateIslandAttack(state, playerId, shipId, islandId);
  if (v.error) return v;

  // Unowned islands or bribe mode off: instant combat
  if (!v.island.owner || state.settings.bribeMode === BRIBE_MODES.NONE) {
    return executeIslandCombat(state, playerId, shipId, islandId);
  }

  // Create pending attack for bribe flow
  state.pendingAttack = {
    type: 'island',
    attackerId: playerId,
    defenderId: v.island.owner,
    attackerShipId: shipId,
    targetId: islandId,
    bribeOffer: undefined, // undefined = defender hasn't responded yet
  };
  return { success: true, pending: true };
}

export function attackShip(state, attackerId, attackerShipId, defenderShipId) {
  const v = validateShipAttack(state, attackerId, attackerShipId, defenderShipId);
  if (v.error) return v;

  // Bribe mode off: instant combat
  if (state.settings.bribeMode === BRIBE_MODES.NONE) {
    return executeShipCombat(state, attackerId, attackerShipId, defenderShipId);
  }

  // Create pending attack for bribe flow
  state.pendingAttack = {
    type: 'ship',
    attackerId,
    defenderId: v.defender.id,
    attackerShipId,
    targetId: defenderShipId,
    bribeOffer: undefined,
  };
  return { success: true, pending: true };
}

// --- Bribe flow functions ---

export function submitBribeOffer(state, defenderId, offer) {
  const pending = state.pendingAttack;
  if (!pending) return { error: 'No pending attack' };
  if (pending.defenderId !== defenderId) return { error: 'Not the defender' };
  if (pending.bribeOffer !== undefined) return { error: 'Already responded' };

  if (offer) {
    const defender = state.players[defenderId];
    for (const [res, amt] of Object.entries(offer)) {
      if (amt < 0) return { error: 'Invalid amount' };
      if ((defender.resources[res] || 0) < amt) return { error: `Not enough ${res}` };
    }
    const total = Object.values(offer).reduce((s, v) => s + v, 0);
    if (total === 0) offer = null; // zero-total = no bribe
  }

  pending.bribeOffer = offer; // null = declined, object = bribe offered
  return { success: true, offer };
}

export function resolveAttackBribe(state, attackerId, decision) {
  const pending = state.pendingAttack;
  if (!pending) return { error: 'No pending attack' };
  if (pending.attackerId !== attackerId) return { error: 'Not the attacker' };
  if (pending.bribeOffer === undefined) return { error: 'Defender has not responded yet' };

  const attacker = state.players[attackerId];
  const defender = state.players[pending.defenderId];
  const bribe = pending.bribeOffer;
  const bribeMode = state.settings.bribeMode;

  switch (decision) {
    case 'accept': {
      // Accept bribe, cancel attack (both modes)
      if (!bribe) return { error: 'No bribe to accept' };
      transferBribeResources(defender, attacker, bribe);
      state.pendingAttack = null;
      return { success: true, outcome: 'bribe_accepted', bribe, attackCancelled: true };
    }
    case 'accept_and_attack': {
      // Ruthless only: accept bribe AND still attack
      if (bribeMode !== BRIBE_MODES.RUTHLESS) return { error: 'Not allowed in honor mode' };
      if (!bribe) return { error: 'No bribe to accept' };
      transferBribeResources(defender, attacker, bribe);
      const combat = pending.type === 'ship'
        ? executeShipCombat(state, pending.attackerId, pending.attackerShipId, pending.targetId)
        : executeIslandCombat(state, pending.attackerId, pending.attackerShipId, pending.targetId);
      state.pendingAttack = null;
      return { success: true, outcome: 'bribe_accepted_and_attacked', bribe, combat };
    }
    case 'reject': {
      // Reject bribe (or no bribe), proceed with attack
      const combat = pending.type === 'ship'
        ? executeShipCombat(state, pending.attackerId, pending.attackerShipId, pending.targetId)
        : executeIslandCombat(state, pending.attackerId, pending.attackerShipId, pending.targetId);
      state.pendingAttack = null;
      return { success: true, outcome: 'bribe_rejected', combat };
    }
    case 'cancel': {
      // Cancel attack entirely
      state.pendingAttack = null;
      return { success: true, outcome: 'attack_cancelled', attackCancelled: true };
    }
    default:
      return { error: 'Invalid decision' };
  }
}

function transferBribeResources(from, to, resources) {
  for (const [res, amt] of Object.entries(resources)) {
    if (amt > 0) {
      from.resources[res] -= amt;
      to.resources[res] += amt;
    }
  }
}

export function cancelPendingAttackForPlayer(state, playerId) {
  if (!state.pendingAttack) return;
  if (state.pendingAttack.attackerId === playerId || state.pendingAttack.defenderId === playerId) {
    state.pendingAttack = null;
  }
}

// === TREATIES ===

export function proposeTreaty(state, proposerId, targetId, offer) {
  const proposer = state.players[proposerId];
  const target = state.players[targetId];
  if (!proposer || !target) return { error: 'Player not found' };

  if (!arePlayersAdjacent(state, proposerId, targetId)) {
    return { error: 'Must be adjacent to propose a treaty' };
  }

  if (hasTreaty(state, proposerId, targetId)) {
    return { error: 'Already have a treaty this turn' };
  }

  return { success: true, treaty: { proposerId, targetId, offer } };
}

export function resolveTreaty(state, accepted, proposerId, targetId, offer) {
  if (accepted) {
    const proposer = state.players[proposerId];
    const target = state.players[targetId];

    for (const [res, amt] of Object.entries(offer)) {
      if ((proposer.resources[res] || 0) < amt) {
        return { error: 'Proposer lacks resources' };
      }
    }

    for (const [res, amt] of Object.entries(offer)) {
      if (amt > 0) {
        proposer.resources[res] -= amt;
        target.resources[res] += amt;
      }
    }

    state.treaties.push({
      player1: proposerId,
      player2: targetId,
      turnNumber: state.turnNumber,
    });

    return { success: true, accepted: true };
  }

  return { success: true, accepted: false };
}

function hasTreaty(state, player1Id, player2Id) {
  return state.treaties.some(t =>
    t.turnNumber === state.turnNumber &&
    ((t.player1 === player1Id && t.player2 === player2Id) ||
     (t.player1 === player2Id && t.player2 === player1Id))
  );
}

function arePlayersAdjacent(state, player1Id, player2Id) {
  const p1 = state.players[player1Id];
  const p2 = state.players[player2Id];
  if (!p1 || !p2) return false;

  for (const s1 of p1.ships) {
    for (const s2 of p2.ships) {
      const dx = Math.abs(s1.position.col - s2.position.col);
      const dy = Math.abs(s1.position.row - s2.position.row);
      if (dx + dy === 1) return true;
    }
    for (const islandId of p2.ownedIslands) {
      const island = state.islands[islandId];
      const islandPorts = island?.ports?.length ? island.ports : (island?.port ? [island.port] : []);
      if (islandPorts.some(p => s1.position.col === p.col && s1.position.row === p.row)) {
        return true;
      }
    }
  }

  for (const s2 of p2.ships) {
    for (const islandId of p1.ownedIslands) {
      const island = state.islands[islandId];
      const islandPorts = island?.ports?.length ? island.ports : (island?.port ? [island.port] : []);
      if (islandPorts.some(p => s2.position.col === p.col && s2.position.row === p.row)) {
        return true;
      }
    }
  }

  return false;
}

// === TRADING ===

export function canTrade(state, fromId, toId) {
  const from = state.players[fromId];
  const to = state.players[toId];
  if (!from || !to) return false;

  // Rulebook: if at a merchant island, can trade with ALL players
  if (isPlayerAtMerchant(state, fromId)) return true;

  for (const s1 of from.ships) {
    for (const s2 of to.ships) {
      const dx = Math.abs(s1.position.col - s2.position.col);
      const dy = Math.abs(s1.position.row - s2.position.row);
      if (dx + dy === 1) {
        // Rulebook: cannot trade through a land barrier
        if (hasLandBarrierBetween(state, s1.position, s2.position)) continue;
        // Rulebook: cannot trade across storm border
        if (!isAcrossStormBorder(state, s1.position, s2.position)) return true;
      }
    }
  }

  for (const s1 of from.ships) {
    for (const islandId of to.ownedIslands) {
      const island = state.islands[islandId];
      const islandPorts = island?.ports?.length ? island.ports : (island?.port ? [island.port] : []);
      for (const p of islandPorts) {
        if (s1.position.col === p.col && s1.position.row === p.row) {
          // Rulebook: storm-covered ports cannot be used for trade
          if (!isInStorm(state, p)) return true;
        }
      }
    }
  }
  for (const s2 of to.ships) {
    for (const islandId of from.ownedIslands) {
      const island = state.islands[islandId];
      const islandPorts = island?.ports?.length ? island.ports : (island?.port ? [island.port] : []);
      for (const p of islandPorts) {
        if (s2.position.col === p.col && s2.position.row === p.row) {
          if (!isInStorm(state, p)) return true;
        }
      }
    }
  }

  return false;
}

export function isPlayerAtMerchant(state, playerId) {
  const player = state.players[playerId];
  for (const ship of player.ships) {
    const tile = state.board[ship.position.row]?.[ship.position.col];
    if (tile?.type === TILE_TYPES.PORT && tile.isMerchant) {
      if (!isInStorm(state, ship.position)) return true;
    }
  }
  return false;
}

export function merchantBankTrade(state, playerId, give, receive) {
  const player = state.players[playerId];

  if (!isPlayerAtMerchant(state, playerId)) {
    return { error: 'Must be docked at a merchant island' };
  }

  let giveTotal = 0;
  for (const [res, amt] of Object.entries(give)) {
    if (amt < 0) return { error: 'Invalid amount' };
    if (player.resources[res] < amt) return { error: `Not enough ${res}` };
    giveTotal += amt;
  }
  if (giveTotal !== 2) return { error: 'Must give exactly 2 resources' };

  if (!RESOURCE_TYPES.includes(receive)) return { error: 'Invalid resource type' };

  if (state.resourceBank[receive] <= 0) {
    return { error: 'Bank is out of that resource' };
  }

  for (const [res, amt] of Object.entries(give)) {
    player.resources[res] -= amt;
    state.resourceBank[res] = (state.resourceBank[res] || 0) + amt;
  }
  player.resources[receive]++;
  state.resourceBank[receive]--;

  return { success: true, gave: give, received: receive };
}

// === TURN MANAGEMENT ===

function _advanceTurn(state) {
  state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.turnOrder.length;
  state.turnPhase = TURN_PHASES.DRAW_RESOURCES;
  state.movePointsRemaining = 0;
  state.dieRoll = 0;
  state.hasRolled = false;
  state.hasRerolledSailing = false;
  state.hasRerolledShipless = false;
  state.lastShiplessRoll = null;
  state.pendingCombatReroll = null;
  state.pendingTrade = null;
  state.pendingTreasure = null;
  state.pendingAttack = null;
  state.pendingStormCost = null;
  state.attackedThisTurn = {};
  state.turnStartedAt = null;
  // Rulebook: clear shipless recovery block — flag only lasts the turn it was set
  for (const p of Object.values(state.players)) {
    delete p.shiplessRecoveryBlocked;
  }
  state.turnNumber++;

  // Clear per-ship turn flags
  for (const p of Object.values(state.players)) {
    for (const ship of p.ships) {
      delete ship.builtThisTurn;
      delete ship.mastBuiltThisTurn;
      delete ship.hasAttackedThisTurn;
      ship.doneForTurn = false;
      ship.jettisonBonus = 0;
    }
  }

  // Skip disconnected players
  let skipped = 0;
  while (
    skipped < state.turnOrder.length &&
    !state.players[state.turnOrder[state.currentPlayerIndex]]?.connected
  ) {
    state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.turnOrder.length;
    state.turnNumber++;
    skipped++;
  }

  return {
    nextPlayer: state.turnOrder[state.currentPlayerIndex],
    turnNumber: state.turnNumber,
  };
}

export function endTurn(state) {
  if (state.pendingStormCost) return { error: 'Must resolve storm cost before ending turn' };
  if (state.pendingAttack) return { error: 'Must resolve pending attack before ending turn' };
  if (state.pendingCombatReroll) return { error: 'Must resolve combat reroll before ending turn' };
  return _advanceTurn(state);
}

export function forceEndTurn(state) {
  // Clear all pending state so the turn can advance regardless
  state.pendingStormCost = null;
  state.pendingAttack = null;
  state.pendingCombatReroll = null;
  state.pendingTrade = null;
  state.pendingTreasure = null;
  return { ..._advanceTurn(state), forced: true };
}

export function calculatePlunderPoints(state, playerId) {
  const player = state.players[playerId];
  let points = 0;
  points += player.ships.length;
  points += player.ownedIslands.length;
  points += player.plunderPointCards;
  return points;
}

export function getPublicGameState(state, forPlayerId) {
  const publicPlayers = {};
  for (const [id, p] of Object.entries(state.players)) {
    publicPlayers[id] = {
      id: p.id,
      name: p.name,
      color: p.color,
      ships: p.ships,
      ownedIslands: p.ownedIslands,
      resources: id === forPlayerId ? p.resources : getTotalResources(p),
      plunderPointCards: p.plunderPointCards,
      plunderPoints: calculatePlunderPoints(state, id),
      connected: p.connected,
      shiplessRecoveryBlocked: p.shiplessRecoveryBlocked || false,
      rerollsUsed: p.rerollsUsed || 0,
    };
  }

  const tradeEligible = {};
  if (forPlayerId) {
    for (const id of Object.keys(state.players)) {
      if (id !== forPlayerId) {
        tradeEligible[id] = canTrade(state, forPlayerId, id);
      }
    }
  }

  return {
    phase: state.phase,
    board: state.board,
    islands: state.islands,
    totalCols: state.totalCols,
    totalRows: state.totalRows,
    walls: state.walls || [],
    players: publicPlayers,
    turnOrder: state.turnOrder,
    currentPlayerIndex: state.currentPlayerIndex,
    currentPlayerId: state.turnOrder[state.currentPlayerIndex],
    turnPhase: state.turnPhase,
    storm: state.storm,
    treasureTokens: state.treasureTokens,
    movePointsRemaining: state.movePointsRemaining,
    dieRoll: state.dieRoll,
    hasRolled: state.hasRolled || false,
    islandPickOrder: state.islandPickOrder,
    islandPickIndex: state.islandPickIndex,
    turnNumber: state.turnNumber,
    winner: state.winner || null,
    resourceDeckCount: state.resourceDeck.length,
    treasureDeckCount: state.treasureDeck.length,
    resourceBank: state.resourceBank,
    pendingTreasure: state.pendingTreasure,
    pendingStormCost: state.pendingStormCost,
    pendingAttack: state.pendingAttack ? {
      type: state.pendingAttack.type,
      attackerId: state.pendingAttack.attackerId,
      defenderId: state.pendingAttack.defenderId,
      attackerShipId: state.pendingAttack.attackerShipId,
      targetId: state.pendingAttack.targetId,
      // Only show bribe offer to attacker after defender has responded
      bribeOffer: (forPlayerId === state.pendingAttack.attackerId && state.pendingAttack.bribeOffer !== undefined)
        ? state.pendingAttack.bribeOffer : undefined,
      defenderResponded: state.pendingAttack.bribeOffer !== undefined,
      phase: state.pendingAttack.bribeOffer === undefined ? 'awaiting_defender' : 'awaiting_attacker',
    } : null,
    tradeEligible,
    treaties: state.treaties.filter(t => t.turnNumber === state.turnNumber),
    turnStartedAt: state.turnStartedAt,
    settings: state.settings,
    atMerchant: forPlayerId ? isPlayerAtMerchant(state, forPlayerId) : false,
    hasRerolledSailing: state.hasRerolledSailing || false,
    hasRerolledShipless: state.hasRerolledShipless || false,
    lastShiplessRoll: state.lastShiplessRoll || null,
    pendingCombatReroll: state.pendingCombatReroll ? {
      type: state.pendingCombatReroll.type,
      attackerId: state.pendingCombatReroll.attackerId,
      attackerShipId: state.pendingCombatReroll.attackerShipId,
      targetId: state.pendingCombatReroll.targetId,
      attackDie: state.pendingCombatReroll.attackDie,
      defenseDie: state.pendingCombatReroll.defenseDie,
      attackerCannons: state.pendingCombatReroll.attackerCannons,
      defenderModifier: state.pendingCombatReroll.defenderModifier,
      defenderId: state.pendingCombatReroll.defenderId,
      attackerHasRerolled: state.pendingCombatReroll.attackerHasRerolled,
      defenderHasRerolled: state.pendingCombatReroll.defenderHasRerolled,
      phase: state.pendingCombatReroll.phase,
    } : null,
  };
}

function getTotalResources(player) {
  return Object.values(player.resources).reduce((a, b) => a + b, 0);
}
