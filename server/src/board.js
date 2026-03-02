// Procedural Board Generator for Plunder: A Pirate's Life
// Generates organic island shapes with guaranteed no dead-ends for ship navigation
//
// Based on the physical game board:
// - 6 panels (6x6 each), arranged 3x2 = 18 cols x 12 rows
// - Islands are organic blobs (not rectangular)
// - Each panel has 1-3 islands of varying size
// - Ports (anchors) sit on sea tiles adjacent to islands
// - Skull counts: 1, 2, or 3 (defense + resource tier)
// - Merchant islands have barrel markers, cannot be owned
// - No dead-ends: every navigable tile must have >= 2 navigable orthogonal neighbors

import { TILE_TYPES } from '../../shared/constants.js';

const PANEL_SIZE = 6;

// Panel configs describe what islands to generate per panel
const PANEL_CONFIGS = [
  { islands: [{ skulls: 1, size: [2, 3] }, { skulls: 1, size: [2, 3] }] },
  { islands: [{ skulls: 2, size: [3, 5] }, { skulls: 1, size: [2, 3] }] },
  { islands: [{ skulls: 3, size: [4, 6] }] },
  { islands: [{ skulls: 1, size: [2, 3] }, { skulls: 0, size: [2, 3], merchant: true }] },
  { islands: [{ skulls: 2, size: [3, 5] }, { skulls: 0, size: [2, 3], merchant: true }] },
  { islands: [{ skulls: 1, size: [2, 3] }, { skulls: 1, size: [2, 3] }, { skulls: 0, size: [1, 2], obstacle: true }] },
  { islands: [{ skulls: 2, size: [4, 6] }] },
  { islands: [{ skulls: 1, size: [2, 2] }, { skulls: 1, size: [2, 2] }, { skulls: 0, size: [2, 2], merchant: true }] },
];

// ── Island Shape Generation ────────────────────────────────────

function growIslandShape(targetSize, gridWidth, gridHeight, occupiedSet) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const seedCol = 1 + Math.floor(Math.random() * (gridWidth - 2));
    const seedRow = 1 + Math.floor(Math.random() * (gridHeight - 2));
    if (occupiedSet.has(`${seedCol},${seedRow}`)) continue;

    const tiles = [{ col: seedCol, row: seedRow }];
    const tileSet = new Set([`${seedCol},${seedRow}`]);
    const candidates = [];

    addNeighborCandidates(seedCol, seedRow, gridWidth, gridHeight, tileSet, occupiedSet, candidates);

    while (tiles.length < targetSize && candidates.length > 0) {
      candidates.sort(() => Math.random() - 0.5);
      let bestIdx = 0, bestScore = -1;
      for (let i = 0; i < Math.min(candidates.length, 5); i++) {
        const score = countIslandNeighbors(candidates[i].col, candidates[i].row, tileSet);
        if (score > bestScore) { bestScore = score; bestIdx = i; }
      }

      const chosen = candidates.splice(bestIdx, 1)[0];
      const key = `${chosen.col},${chosen.row}`;
      if (tileSet.has(key) || occupiedSet.has(key)) continue;

      tiles.push(chosen);
      tileSet.add(key);
      addNeighborCandidates(chosen.col, chosen.row, gridWidth, gridHeight, tileSet, occupiedSet, candidates);
    }

    if (tiles.length >= targetSize) return tiles;
  }
  return null;
}

function addNeighborCandidates(col, row, w, h, tileSet, occupiedSet, candidates) {
  for (const [dc, dr] of [[0,1],[0,-1],[1,0],[-1,0]]) {
    const nc = col + dc, nr = row + dr;
    const key = `${nc},${nr}`;
    if (nc >= 0 && nc < w && nr >= 0 && nr < h &&
        !tileSet.has(key) && !occupiedSet.has(key) &&
        !candidates.some(c => c.col === nc && c.row === nr)) {
      candidates.push({ col: nc, row: nr });
    }
  }
}

function countIslandNeighbors(col, row, tileSet) {
  let count = 0;
  for (const [dc, dr] of [[0,1],[0,-1],[1,0],[-1,0]]) {
    if (tileSet.has(`${col+dc},${row+dr}`)) count++;
  }
  return count;
}

// ── Port Placement ─────────────────────────────────────────────

function findPortPosition(islandTiles, gridWidth, gridHeight, occupiedSet) {
  const islandSet = new Set(islandTiles.map(t => `${t.col},${t.row}`));
  const candidates = [];

  for (const tile of islandTiles) {
    for (const [dc, dr] of [[0,1],[0,-1],[1,0],[-1,0]]) {
      const nc = tile.col + dc, nr = tile.row + dr;
      const key = `${nc},${nr}`;
      if (nc >= 0 && nc < gridWidth && nr >= 0 && nr < gridHeight &&
          !islandSet.has(key) && !occupiedSet.has(key)) {
        let openness = 0;
        for (const [dc2, dr2] of [[0,1],[0,-1],[1,0],[-1,0]]) {
          const k2 = `${nc+dc2},${nr+dr2}`;
          if (nc+dc2 >= 0 && nc+dc2 < gridWidth && nr+dr2 >= 0 && nr+dr2 < gridHeight &&
              !islandSet.has(k2) && !occupiedSet.has(k2)) {
            openness++;
          }
        }
        candidates.push({ col: nc, row: nr, openness });
      }
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.openness - a.openness);
  const topN = Math.min(3, candidates.length);
  return candidates[Math.floor(Math.random() * topN)];
}

// ── Dead-End Detection & Fixing ────────────────────────────────

function findDeadEnds(grid, width, height) {
  const deadEnds = [];
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const tile = grid[r][c];
      if (tile.type !== TILE_TYPES.SEA && tile.type !== TILE_TYPES.PORT) continue;
      let nav = 0;
      for (const [dc, dr] of [[0,1],[0,-1],[1,0],[-1,0]]) {
        const nc = c+dc, nr = r+dr;
        if (nc >= 0 && nc < width && nr >= 0 && nr < height) {
          const n = grid[nr][nc];
          if (n.type === TILE_TYPES.SEA || n.type === TILE_TYPES.PORT) nav++;
        }
      }
      if (nav <= 1) deadEnds.push({ col: c, row: r });
    }
  }
  return deadEnds;
}

function fixDeadEnds(grid, width, height, islands) {
  for (let iter = 0; iter < 50; iter++) {
    const deadEnds = findDeadEnds(grid, width, height);
    if (deadEnds.length === 0) return true;

    for (const de of deadEnds) {
      // If this dead-end is a port, we can't just fill it in — try to open a path instead
      if (grid[de.row][de.col].type === TILE_TYPES.PORT) {
        // Try to open a neighboring island tile into sea
        let opened = false;
        for (const [dc, dr] of [[0,1],[0,-1],[1,0],[-1,0]]) {
          const nc = de.col+dc, nr = de.row+dr;
          if (nc >= 0 && nc < width && nr >= 0 && nr < height) {
            const n = grid[nr][nc];
            if (n.type === TILE_TYPES.NORMAL_ISLAND) {
              grid[nr][nc] = { type: TILE_TYPES.SEA, col: nc, row: nr };
              opened = true;
              break;
            }
          }
        }
        if (!opened) {
          // Convert a neighboring non-critical island tile to sea
          for (const [dc, dr] of [[0,1],[0,-1],[1,0],[-1,0]]) {
            const nc = de.col+dc, nr = de.row+dr;
            if (nc >= 0 && nc < width && nr >= 0 && nr < height) {
              const n = grid[nr][nc];
              if (n.type === TILE_TYPES.ISLAND && n.islandId) {
                const island = islands.find(i => i.id === n.islandId);
                if (island && island.tiles.length > 1) {
                  grid[nr][nc] = { type: TILE_TYPES.SEA, col: nc, row: nr };
                  island.tiles = island.tiles.filter(t => !(t.col === nc && t.row === nr));
                  break;
                }
              }
            }
          }
        }
        continue;
      }

      // For sea dead-ends: fill them in by extending nearest island
      let filled = false;
      for (const [dc, dr] of [[0,1],[0,-1],[1,0],[-1,0]]) {
        const nc = de.col+dc, nr = de.row+dr;
        if (nc >= 0 && nc < width && nr >= 0 && nr < height) {
          const n = grid[nr][nc];
          if (n.type === TILE_TYPES.ISLAND || n.type === TILE_TYPES.NORMAL_ISLAND) {
            grid[de.row][de.col] = {
              type: TILE_TYPES.NORMAL_ISLAND,
              islandId: n.islandId || `rock_${de.col}_${de.row}`,
              col: de.col, row: de.row,
            };
            filled = true;
            break;
          }
        }
      }
      if (!filled) {
        grid[de.row][de.col] = {
          type: TILE_TYPES.NORMAL_ISLAND,
          islandId: `rock_${de.col}_${de.row}`,
          col: de.col, row: de.row,
        };
      }
    }
  }
  return findDeadEnds(grid, width, height).length === 0;
}

function isSeaConnected(grid, width, height) {
  let start = null, total = 0;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (grid[r][c].type === TILE_TYPES.SEA || grid[r][c].type === TILE_TYPES.PORT) {
        total++;
        if (!start) start = { col: c, row: r };
      }
    }
  }
  if (!start) return false;

  const visited = new Set();
  const queue = [start];
  visited.add(`${start.col},${start.row}`);

  while (queue.length > 0) {
    const cur = queue.shift();
    for (const [dc, dr] of [[0,1],[0,-1],[1,0],[-1,0]]) {
      const nc = cur.col+dc, nr = cur.row+dr, key = `${nc},${nr}`;
      if (nc >= 0 && nc < width && nr >= 0 && nr < height && !visited.has(key)) {
        const t = grid[nr][nc];
        if (t.type === TILE_TYPES.SEA || t.type === TILE_TYPES.PORT) {
          visited.add(key);
          queue.push({ col: nc, row: nr });
        }
      }
    }
  }
  return visited.size === total;
}

// ── Panel Generation ───────────────────────────────────────────

function generatePanel(panelId, config) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const grid = [];
    for (let r = 0; r < PANEL_SIZE; r++) {
      grid[r] = [];
      for (let c = 0; c < PANEL_SIZE; c++) {
        grid[r][c] = { type: TILE_TYPES.SEA, col: c, row: r };
      }
    }

    const islands = [];
    const occupiedSet = new Set();
    let ok = true;

    for (let i = 0; i < config.islands.length; i++) {
      const spec = config.islands[i];
      const targetSize = spec.size[0] + Math.floor(Math.random() * (spec.size[1] - spec.size[0] + 1));
      const islandId = `${panelId}_island_${i}`;

      // Buffer around existing islands
      const buffered = new Set(occupiedSet);
      for (const key of occupiedSet) {
        const [c, r] = key.split(',').map(Number);
        for (const [dc, dr] of [[0,1],[0,-1],[1,0],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]]) {
          buffered.add(`${c+dc},${r+dr}`);
        }
      }

      const tiles = growIslandShape(targetSize, PANEL_SIZE, PANEL_SIZE, buffered);
      if (!tiles) { ok = false; break; }

      let tileType = TILE_TYPES.ISLAND;
      if (spec.merchant) tileType = TILE_TYPES.MERCHANT;
      if (spec.obstacle) tileType = TILE_TYPES.NORMAL_ISLAND;

      for (const t of tiles) {
        grid[t.row][t.col] = { type: tileType, islandId, skulls: spec.skulls || 0, col: t.col, row: t.row };
        occupiedSet.add(`${t.col},${t.row}`);
      }

      const island = {
        id: islandId, tiles: [...tiles], skulls: spec.skulls || 0,
        type: spec.merchant ? 'merchant' : spec.obstacle ? 'obstacle' : 'resource',
        port: null,
      };

      if (!spec.obstacle) {
        const port = findPortPosition(tiles, PANEL_SIZE, PANEL_SIZE, occupiedSet);
        if (!port) { ok = false; break; }
        grid[port.row][port.col] = { type: TILE_TYPES.PORT, portOf: islandId, isMerchant: !!spec.merchant, col: port.col, row: port.row };
        occupiedSet.add(`${port.col},${port.row}`);
        island.port = { col: port.col, row: port.row };
      }

      islands.push(island);
    }

    if (!ok) continue;
    fixDeadEnds(grid, PANEL_SIZE, PANEL_SIZE, islands);
    if (!isSeaConnected(grid, PANEL_SIZE, PANEL_SIZE)) continue;
    if (findDeadEnds(grid, PANEL_SIZE, PANEL_SIZE).length > 0) continue;

    return { grid, islands };
  }

  // Fallback
  return generateFallbackPanel(panelId);
}

function generateFallbackPanel(panelId) {
  const grid = [];
  for (let r = 0; r < PANEL_SIZE; r++) {
    grid[r] = [];
    for (let c = 0; c < PANEL_SIZE; c++) {
      grid[r][c] = { type: TILE_TYPES.SEA, col: c, row: r };
    }
  }
  const id = `${panelId}_island_0`;
  grid[2][2] = { type: TILE_TYPES.ISLAND, islandId: id, skulls: 1, col: 2, row: 2 };
  grid[2][3] = { type: TILE_TYPES.ISLAND, islandId: id, skulls: 1, col: 3, row: 2 };
  grid[3][2] = { type: TILE_TYPES.PORT, portOf: id, col: 2, row: 3 };

  return {
    grid,
    islands: [{
      id, tiles: [{ col: 2, row: 2 }, { col: 3, row: 2 }],
      skulls: 1, type: 'resource', port: { col: 2, row: 3 },
    }],
  };
}

// ── Full Board Generation ──────────────────────────────────────

export function generateBoard(playerCount = 4) {
  const is2Player = playerCount === 2;
  const panelCols = is2Player ? 2 : 3;
  const panelRows = 2;
  const numPanels = panelCols * panelRows;
  const totalCols = panelCols * PANEL_SIZE;
  const totalRows = panelRows * PANEL_SIZE;

  for (let boardAttempt = 0; boardAttempt < 50; boardAttempt++) {
    const configs = choosePanelConfigs(numPanels, is2Player);
    const panels = [];

    for (let i = 0; i < numPanels; i++) {
      panels.push(generatePanel(`p${i}`, configs[i]));
    }

    // Shuffle panel order
    const order = Array.from({ length: numPanels }, (_, i) => i);
    shuffleArray(order);

    // Assemble full board
    const board = [];
    const islandsMap = {};

    for (let r = 0; r < totalRows; r++) {
      board[r] = [];
      for (let c = 0; c < totalCols; c++) {
        const pr = Math.floor(r / PANEL_SIZE);
        const pc = Math.floor(c / PANEL_SIZE);
        const pi = order[pr * panelCols + pc];
        const lr = r % PANEL_SIZE;
        const lc = c % PANEL_SIZE;

        const tile = { ...panels[pi].grid[lr][lc] };
        const posKey = `${pr}_${pc}`;
        if (tile.islandId) tile.islandId = `${posKey}_${tile.islandId}`;
        if (tile.portOf) tile.portOf = `${posKey}_${tile.portOf}`;
        tile.col = c;
        tile.row = r;
        board[r][c] = tile;
      }
    }

    // Build island registry
    for (let r = 0; r < totalRows; r++) {
      for (let c = 0; c < totalCols; c++) {
        const tile = board[r][c];
        if ((tile.type === TILE_TYPES.ISLAND || tile.type === TILE_TYPES.MERCHANT ||
             tile.type === TILE_TYPES.NORMAL_ISLAND) && tile.islandId) {
          if (!islandsMap[tile.islandId]) {
            islandsMap[tile.islandId] = {
              id: tile.islandId, tiles: [], port: null,
              skulls: tile.skulls || 0,
              type: tile.type === TILE_TYPES.MERCHANT ? 'merchant' :
                    tile.type === TILE_TYPES.NORMAL_ISLAND ? 'obstacle' : 'resource',
              owner: null,
            };
          }
          islandsMap[tile.islandId].tiles.push({ col: c, row: r });
        }
        if (tile.type === TILE_TYPES.PORT && tile.portOf && islandsMap[tile.portOf]) {
          islandsMap[tile.portOf].port = { col: c, row: r };
        }
      }
    }

    // Full-board dead-end fix and validation
    const allIslandsList = Object.values(islandsMap);
    fixDeadEnds(board, totalCols, totalRows, allIslandsList);

    if (!isSeaConnected(board, totalCols, totalRows)) continue;
    if (findDeadEnds(board, totalCols, totalRows).length > 0) continue;

    const oneSkull = Object.values(islandsMap).filter(i => i.type === 'resource' && i.skulls === 1 && i.port).length;
    const merchants = Object.values(islandsMap).filter(i => i.type === 'merchant').length;
    // Need at least one 1-skull per player for starting islands
    // Need at least 1 merchant (unless 2-player mode which has no merchants)
    if (oneSkull < playerCount) continue;
    if (!is2Player && merchants < 1) continue;

    return { board, islands: islandsMap, totalCols, totalRows, panelLayout: order };
  }

  // Last resort fallback
  console.warn('Board generation used fallback');
  return generateSimpleFallback(is2Player ? 12 : 18, 12);
}

function choosePanelConfigs(numPanels, is2Player = false) {
  // Every panel gets at least one 1-skull island to maximize starting positions
  // Plus we ensure variety with 2-skull, 3-skull, and merchants

  // 2-player variant: no merchant islands
  if (is2Player) {
    const twoPlayerPanels = [
      { islands: [{ skulls: 1, size: [2, 3] }, { skulls: 1, size: [2, 3] }] },
      { islands: [{ skulls: 1, size: [2, 3] }, { skulls: 2, size: [3, 4] }] },
      { islands: [{ skulls: 1, size: [2, 3] }, { skulls: 1, size: [2, 3] }, { skulls: 0, size: [1, 2], obstacle: true }] },
      { islands: [{ skulls: 1, size: [2, 3] }, { skulls: 3, size: [3, 5] }] },
    ];
    shuffleArray(twoPlayerPanels);
    return twoPlayerPanels.slice(0, numPanels);
  }

  const guaranteed6 = [
    { islands: [{ skulls: 1, size: [2, 3] }, { skulls: 1, size: [2, 3] }] },
    { islands: [{ skulls: 1, size: [2, 3] }, { skulls: 2, size: [3, 4] }] },
    { islands: [{ skulls: 1, size: [2, 3] }, { skulls: 0, size: [2, 3], merchant: true }] },
    { islands: [{ skulls: 1, size: [2, 3] }, { skulls: 1, size: [2, 3] }, { skulls: 0, size: [1, 2], obstacle: true }] },
    { islands: [{ skulls: 1, size: [2, 3] }, { skulls: 3, size: [3, 5] }] },
    { islands: [{ skulls: 1, size: [2, 2] }, { skulls: 2, size: [3, 4] }, { skulls: 0, size: [2, 2], merchant: true }] },
  ];

  if (numPanels <= 4) {
    const small = guaranteed6.slice(0, 4);
    shuffleArray(small);
    return small.slice(0, numPanels);
  }

  const configs = [...guaranteed6];
  shuffleArray(configs);
  return configs.slice(0, numPanels);
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function generateSimpleFallback(totalCols, totalRows) {
  const board = [];
  const islands = {};
  for (let r = 0; r < totalRows; r++) {
    board[r] = [];
    for (let c = 0; c < totalCols; c++) {
      board[r][c] = { type: TILE_TYPES.SEA, col: c, row: r };
    }
  }
  const spots = [
    { c: 2, r: 2, sk: 1 }, { c: 8, r: 2, sk: 1 }, { c: 14, r: 2, sk: 1 },
    { c: 2, r: 8, sk: 1 }, { c: 8, r: 8, sk: 1 }, { c: 14, r: 8, sk: 1 },
    { c: 5, r: 5, sk: 2 }, { c: 11, r: 5, sk: 3 },
    { c: 14, r: 5, sk: 0, m: true },
  ];
  for (let i = 0; i < spots.length; i++) {
    const s = spots[i];
    if (s.c >= totalCols || s.r >= totalRows) continue;
    const id = `fb_${i}`;
    const type = s.m ? TILE_TYPES.MERCHANT : TILE_TYPES.ISLAND;
    board[s.r][s.c] = { type, islandId: id, skulls: s.sk, col: s.c, row: s.r };
    board[s.r][s.c+1] = { type, islandId: id, skulls: s.sk, col: s.c+1, row: s.r };
    board[s.r+1][s.c] = { type: TILE_TYPES.PORT, portOf: id, col: s.c, row: s.r+1 };
    islands[id] = {
      id, tiles: [{ col: s.c, row: s.r }, { col: s.c+1, row: s.r }],
      port: { col: s.c, row: s.r+1 }, skulls: s.sk,
      type: s.m ? 'merchant' : 'resource', owner: null,
    };
  }
  return { board, islands, totalCols, totalRows, panelLayout: [0,1,2,3,4,5] };
}

export function getStartingIslands(islands) {
  return Object.values(islands).filter(i => i.type === 'resource' && i.skulls === 1 && i.port);
}
