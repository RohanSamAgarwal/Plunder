// Game State Manager for Plunder: A Pirate's Life
import { v4 as uuid } from 'uuid';
import {
  GAME_PHASES, TURN_PHASES, INITIAL_LIFE_PEGS, WIN_POINTS,
  STORM_SIZE, BUILD_COSTS, RESOURCE_TYPES, TILE_TYPES, SHIPLESS_MODES,
} from '../../shared/constants.js';
import { generateBoard, getStartingIslands } from './board.js';
import { createResourceDeck, createTreasureDeck, drawFromDeck } from './decks.js';

export function createGameState(players, playerCount, settings = {}) {
  const boardData = generateBoard(playerCount);

  const state = {
    phase: GAME_PHASES.STARTING_ISLAND_PICK,
    board: boardData.board,
    islands: boardData.islands,
    totalCols: boardData.totalCols,
    totalRows: boardData.totalRows,
    panelLayout: boardData.panelLayout,

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
    treaties: [], // active treaties: [{ player1, player2, turnNumber }]
    combatLog: [],
    turnNumber: 0,

    // Game settings (configurable in lobby)
    settings: {
      shiplessMode: settings.shiplessMode || SHIPLESS_MODES.RULEBOOK,
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

export function placeTreasureTokens(state) {
  const count = Object.keys(state.players).length >= 5 ? 4 : 3;
  const is2Player = Object.keys(state.players).length === 2;
  const tokenCount = is2Player ? 2 : count;

  state.treasureTokens = [];
  for (let i = 0; i < tokenCount; i++) {
    let pos;
    let attempts = 0;
    do {
      pos = getRandomBoardPosition(state);
      attempts++;
    } while (
      (state.treasureTokens.some(t => t.col === pos.col && t.row === pos.row) ||
       state.board[pos.row]?.[pos.col]?.type !== TILE_TYPES.SEA) &&
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
  };
}

// === TURN ACTIONS ===

export function drawResources(state, playerId) {
  const player = state.players[playerId];
  const islandCount = player.ownedIslands.length;

  if (player.ships.length === 0) {
    return handleShiplessDraw(state, playerId);
  }

  const count = Math.max(islandCount, 0);
  const drawn = drawFromDeck(state.resourceDeck, count);
  for (const r of drawn) {
    player.resources[r]++;
  }

  state.turnPhase = TURN_PHASES.ROLL_FOR_MOVE;
  return { success: true, drawn };
}

function handleShiplessDraw(state, playerId) {
  const player = state.players[playerId];
  const mode = state.settings.shiplessMode;

  // Still draw resources for owned islands
  const islandCount = player.ownedIslands.length;
  const drawn = drawFromDeck(state.resourceDeck, islandCount);
  for (const r of drawn) {
    player.resources[r]++;
  }

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
  return { success: true, drawn, shipless: true, needsShiplessRoll: true };
}

export function shiplessRoll(state, playerId) {
  const player = state.players[playerId];
  if (player.ships.length > 0) return { error: 'You have ships' };
  if (state.settings.shiplessMode !== SHIPLESS_MODES.RULEBOOK) {
    return { error: 'Shipless roll not available in this mode' };
  }

  const die1 = rollDie(6);
  const die2 = rollDie(6);
  const isDoubles = die1 === die2;

  if (isDoubles) {
    const ownedIsland = player.ownedIslands
      .map(id => state.islands[id])
      .find(i => i && i.port && !isOccupied(state, i.port, null));
    if (ownedIsland) {
      const ship = createShip(playerId, ownedIsland.port);
      player.ships.push(ship);
      return { success: true, die1, die2, doubles: true, gotShip: true };
    }
    return { success: true, die1, die2, doubles: true, gotShip: false, noPort: true };
  }

  return { success: true, die1, die2, doubles: false };
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
    totalMovePoints += ship.masts;
  }
  state.movePointsRemaining = totalMovePoints;

  state.turnPhase = TURN_PHASES.PERFORM_ACTIONS;

  for (const ship of player.ships) {
    ship.movesUsed = 0;
    ship.doneForTurn = false;
  }

  return { roll, totalMovePoints, stormMoved, stormPosition: state.storm };
}

export function moveShip(state, playerId, shipId, path) {
  const player = state.players[playerId];
  const ship = player.ships.find(s => s.id === shipId);
  if (!ship) return { error: 'Ship not found' };
  if (ship.doneForTurn) return { error: 'Ship is done for this turn' };

  const moveCost = path.length;
  if (moveCost > state.movePointsRemaining) {
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

    const occupied = isOccupied(state, step, shipId);
    if (occupied) return { error: 'Space occupied by another ship' };

    current = step;
  }

  // Check storm costs
  const stormTiles = state.storm ? state.storm.tiles : [];
  let stormCost = 0;
  const wasInStorm = stormTiles.some(t => t.col === ship.position.col && t.row === ship.position.row);
  const entersStorm = path.some(p => stormTiles.some(t => t.col === p.col && t.row === p.row));
  const finalInStorm = stormTiles.some(t => t.col === current.col && t.row === current.row);

  if (!wasInStorm && entersStorm) stormCost += 2;
  if (wasInStorm && !finalInStorm) stormCost += 2;

  const totalResources = Object.values(player.resources).reduce((a, b) => a + b, 0);
  if (stormCost > 0 && totalResources < stormCost) {
    return { error: `Need ${stormCost} resources to enter/exit the storm` };
  }

  // Apply movement
  ship.position = current;
  ship.movesUsed += moveCost;
  state.movePointsRemaining -= moveCost;

  // Check for treasure tokens along the path (player can choose to pick up)
  const treasuresOnPath = [];
  for (const step of path) {
    const tokenIndex = state.treasureTokens.findIndex(
      t => t.col === step.col && t.row === step.row
    );
    if (tokenIndex !== -1) {
      treasuresOnPath.push({ ...state.treasureTokens[tokenIndex] });
    }
  }

  return { success: true, newPosition: current, stormCost, treasuresOnPath };
}

// Player chooses to collect a specific treasure token
export function collectTreasure(state, playerId, tokenId) {
  const tokenIndex = state.treasureTokens.findIndex(t => t.id === tokenId);
  if (tokenIndex === -1) return { error: 'Treasure token not found' };

  state.treasureTokens.splice(tokenIndex, 1);

  const cards = drawFromDeck(state.treasureDeck, 1);
  if (cards.length === 0) return { error: 'No treasure cards left' };

  const card = cards[0];
  return applyTreasureCard(state, playerId, card);
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
      if (total >= WIN_POINTS) {
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
    const ownedIsland = player.ownedIslands
      .map(id => state.islands[id])
      .find(i => i && i.port && !isOccupied(state, i.port, null));
    if (!ownedIsland) {
      refundCost(player, cost);
      return { error: 'No available port for new ship' };
    }
    const newShip = createShip(playerId, ownedIsland.port);
    player.ships.push(newShip);
    return { success: true, ship: newShip };
  }

  if (buildType === 'plunderPoint') {
    player.plunderPointCards++;
    const total = calculatePlunderPoints(state, playerId);
    if (total >= WIN_POINTS) {
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
    if (ship.cannons >= 3) return refundAndError(player, cost, 'Max cannons reached');
    ship.cannons++;
  } else if (buildType === 'mast') {
    if (ship.masts >= 3) return refundAndError(player, cost, 'Max masts reached');
    ship.masts++;
  } else if (buildType === 'lifePeg') {
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

export function attackIsland(state, playerId, shipId, islandId) {
  const player = state.players[playerId];
  const ship = player.ships.find(s => s.id === shipId);
  const island = state.islands[islandId];

  if (!ship || !island) return { error: 'Invalid ship or island' };
  if (island.type !== 'resource') return { error: 'Cannot attack this island' };
  if (island.owner === playerId) return { error: 'You already own this island' };

  if (island.port && isInStorm(state, island.port)) {
    return { error: 'Cannot attack islands in the storm' };
  }

  if (!island.port || ship.position.col !== island.port.col || ship.position.row !== island.port.row) {
    return { error: 'Must be in the island port to attack' };
  }

  if (island.owner && hasTreaty(state, playerId, island.owner)) {
    return { error: 'You have a treaty with this player this turn' };
  }

  const attackRoll = rollDie(6) + ship.cannons;
  const defenseRoll = rollDie(6) + island.skulls;
  const attackerWins = attackRoll >= defenseRoll;
  ship.doneForTurn = true;

  if (attackerWins) {
    if (island.owner) {
      const prevOwner = state.players[island.owner];
      prevOwner.ownedIslands = prevOwner.ownedIslands.filter(id => id !== islandId);
    }
    island.owner = playerId;
    player.ownedIslands.push(islandId);
    return { success: true, won: true, attackRoll, defenseRoll };
  } else {
    ship.lifePegs--;
    const sunk = ship.lifePegs <= 0;
    if (sunk) {
      player.ships = player.ships.filter(s => s.id !== shipId);
    }
    return { success: true, won: false, attackRoll, defenseRoll, sunk };
  }
}

export function attackShip(state, attackerId, attackerShipId, defenderShipId) {
  const attacker = state.players[attackerId];
  const attackerShip = attacker.ships.find(s => s.id === attackerShipId);
  if (!attackerShip) return { error: 'Attacker ship not found' };

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

  const attackRoll = rollDie(6) + attackerShip.cannons;
  const defenseRoll = rollDie(6) + defenderShip.cannons;
  const attackerWins = attackRoll >= defenseRoll;

  if (attackerWins) {
    defenderShip.lifePegs--;
    const sunk = defenderShip.lifePegs <= 0;
    if (sunk) {
      defender.ships = defender.ships.filter(s => s.id !== defenderShipId);
      attacker.plunderPointCards++;
      const total = calculatePlunderPoints(state, attackerId);
      if (total >= WIN_POINTS) {
        state.phase = GAME_PHASES.GAME_OVER;
        state.winner = attackerId;
      }
    }
    return { success: true, attackerWon: true, attackRoll, defenseRoll, sunk };
  } else {
    attackerShip.lifePegs--;
    const sunk = attackerShip.lifePegs <= 0;
    if (sunk) {
      attacker.ships = attacker.ships.filter(s => s.id !== attackerShipId);
      defender.plunderPointCards++;
      const total = calculatePlunderPoints(state, defender.id);
      if (total >= WIN_POINTS) {
        state.phase = GAME_PHASES.GAME_OVER;
        state.winner = defender.id;
      }
    }
    return { success: true, attackerWon: false, attackRoll, defenseRoll, sunk };
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
      if (island?.port && s1.position.col === island.port.col && s1.position.row === island.port.row) {
        return true;
      }
    }
  }

  for (const s2 of p2.ships) {
    for (const islandId of p1.ownedIslands) {
      const island = state.islands[islandId];
      if (island?.port && s2.position.col === island.port.col && s2.position.row === island.port.row) {
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

  if (isPlayerAtMerchant(state, fromId)) return true;

  for (const s1 of from.ships) {
    for (const s2 of to.ships) {
      const dx = Math.abs(s1.position.col - s2.position.col);
      const dy = Math.abs(s1.position.row - s2.position.row);
      if (dx + dy <= 1) return true;
    }
  }

  for (const s1 of from.ships) {
    for (const islandId of to.ownedIslands) {
      const island = state.islands[islandId];
      if (island?.port && s1.position.col === island.port.col && s1.position.row === island.port.row) {
        return true;
      }
    }
  }
  for (const s2 of to.ships) {
    for (const islandId of from.ownedIslands) {
      const island = state.islands[islandId];
      if (island?.port && s2.position.col === island.port.col && s2.position.row === island.port.row) {
        return true;
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

export function endTurn(state) {
  state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.turnOrder.length;
  state.turnPhase = TURN_PHASES.DRAW_RESOURCES;
  state.movePointsRemaining = 0;
  state.dieRoll = 0;
  state.hasRolled = false;
  state.pendingTrade = null;
  state.pendingTreasure = null;
  state.turnNumber++;

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
    tradeEligible,
    treaties: state.treaties.filter(t => t.turnNumber === state.turnNumber),
    settings: state.settings,
    atMerchant: forPlayerId ? isPlayerAtMerchant(state, forPlayerId) : false,
  };
}

function getTotalResources(player) {
  return Object.values(player.resources).reduce((a, b) => a + b, 0);
}
