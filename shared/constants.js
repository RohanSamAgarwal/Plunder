// Shared constants for Plunder: A Pirate's Life

export const PLAYER_COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange'];

export const GRID_COLS = 18;
export const GRID_ROWS = 12;
export const PANEL_SIZE = 6; // each panel is 6x6

export const TILE_TYPES = {
  SEA: 'sea',
  ISLAND: 'island',
  MERCHANT: 'merchant',
  PORT: 'port',
  NORMAL_ISLAND: 'normal_island',
  LAND_BARRIER: 'land_barrier',
};

export const RESOURCE_TYPES = ['wood', 'iron', 'rum', 'gold'];

export const BUILD_COSTS = {
  ship: { wood: 2, iron: 1, rum: 0, gold: 2 },
  cannon: { wood: 0, iron: 2, rum: 1, gold: 1 },
  mast: { wood: 1, iron: 0, rum: 2, gold: 0 },
  lifePeg: { wood: 1, iron: 1, rum: 1, gold: 1 },
  plunderPoint: { wood: 0, iron: 0, rum: 0, gold: 5 },
};

export const GAME_PHASES = {
  LOBBY: 'lobby',
  STARTING_ISLAND_PICK: 'starting_island_pick',
  GAMEPLAY: 'gameplay',
  GAME_OVER: 'game_over',
};

export const TURN_PHASES = {
  DRAW_RESOURCES: 'draw_resources',
  ROLL_FOR_MOVE: 'roll_for_move',
  PERFORM_ACTIONS: 'perform_actions',
  TURN_END: 'turn_end',
};

export const WIN_POINTS = 10;

export const STORM_SIZE = 3; // 3x3 grid

export const INITIAL_LIFE_PEGS = 3;
export const MAX_UPGRADES = 3; // max cannons, masts per ship

export const SHIP_MAX_PER_PLAYER = 3;

// Shipless captain recovery modes (configurable in lobby)
export const SHIPLESS_MODES = {
  RULEBOOK: 'rulebook',       // Roll 2 dice, doubles = free ship; can trade PP for ships
  FREE_SHIP: 'free_ship',     // Free ship at owned port on next turn
  FREE_RESOURCES: 'free_resources', // Extra resources to help rebuild
};

export const EVENTS = {
  // Lobby
  CREATE_ROOM: 'create-room',
  ROOM_CREATED: 'room-created',
  JOIN_ROOM: 'join-room',
  PLAYER_JOINED: 'player-joined',
  PLAYER_LEFT: 'player-left',
  PLAYER_RECONNECTED: 'player-reconnected',
  START_GAME: 'start-game',
  GAME_STARTED: 'game-started',
  LOBBY_STATE: 'lobby-state',
  ERROR: 'error',
  CHOOSE_COLOR: 'choose-color',
  COLOR_CHOSEN: 'color-chosen',
  CHAT_MESSAGE: 'chat-message',
  CHAT_BROADCAST: 'chat-broadcast',
  UPDATE_SETTINGS: 'update-settings',
  SETTINGS_UPDATED: 'settings-updated',

  // Gameplay
  GAME_STATE_UPDATE: 'game-state-update',
  PICK_STARTING_ISLAND: 'pick-starting-island',
  ISLAND_PICKED: 'island-picked',
  DRAW_RESOURCES: 'draw-resources',
  RESOURCES_DRAWN: 'resources-drawn',
  ROLL_SAILING_DIE: 'roll-sailing-die',
  DIE_ROLLED: 'die-rolled',
  MOVE_SHIP: 'move-ship',
  SHIP_MOVED: 'ship-moved',
  BUILD: 'build',
  BUILT: 'built',
  ATTACK_ISLAND: 'attack-island',
  ATTACK_SHIP: 'attack-ship',
  COMBAT_RESULT: 'combat-result',
  PROPOSE_TRADE: 'propose-trade',
  TRADE_PROPOSED: 'trade-proposed',
  RESPOND_TRADE: 'respond-trade',
  TRADE_RESOLVED: 'trade-resolved',
  MERCHANT_TRADE: 'merchant-trade',
  MERCHANT_TRADED: 'merchant-traded',
  COLLECT_TREASURE: 'collect-treasure',
  TREASURE_COLLECTED: 'treasure-collected',
  RESOLVE_TREASURE: 'resolve-treasure',
  TREASURE_RESOLVED: 'treasure-resolved',
  DECLINE_TREASURE: 'decline-treasure',
  PROPOSE_TREATY: 'propose-treaty',
  TREATY_PROPOSED: 'treaty-proposed',
  RESPOND_TREATY: 'respond-treaty',
  TREATY_RESOLVED: 'treaty-resolved',
  SHIPLESS_ROLL: 'shipless-roll',
  SHIPLESS_RESULT: 'shipless-result',
  SHIPLESS_CHOOSE_RESOURCE: 'shipless-choose-resource',
  END_TURN: 'end-turn',
  TURN_ENDED: 'turn-ended',
  GAME_OVER: 'game-over',
};
