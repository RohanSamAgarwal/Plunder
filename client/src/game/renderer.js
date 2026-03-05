// Canvas-based board renderer for Plunder: A Pirate's Life
// Rich procedural rendering with layered islands, depth-aware ocean, and detailed decorations
// Dynamically sized for any viewport — targets ~80px tiles at 1920×1080

const COLORS = {
  // Ocean
  sea1: '#1a4a6b',
  sea2: '#174060',
  seaDeep: '#0f2d45',
  seaShallow: '#1f6080',
  seaFoam: '#2a7a9a',
  seaCaustic: 'rgba(80,200,240,0.06)',
  seaWave: 'rgba(100,180,220,0.10)',
  // Beach / Shore
  sand: '#d4b067',
  sandDark: '#b8963a',
  sandWet: '#a08540',
  beachLight: '#e8cc88',
  beachWet: '#8a7538',
  beachFoam: 'rgba(220,240,255,0.18)',
  // Vegetation
  green1: '#4a8c3f',
  green2: '#3d7a34',
  greenDark: '#2d5c26',
  greenLight: '#5aad4a',
  palmTrunk: '#6b4226',
  palmFrond: '#3d8b2f',
  palmFrondLight: '#5aad3a',
  flowerRed: '#c0392b',
  flowerYellow: '#f1c40f',
  cliffBrown: '#5a4030',
  // Merchant
  merchantSand: '#c9a84c',
  merchantGreen: '#5a9944',
  canopyRed: '#b03030',
  crateWood: '#7a5a30',
  // Obstacles / normal islands
  rock: '#6b6b5a',
  rockDark: '#4a4a3d',
  rockLight: '#8a8a76',
  coralPink: '#c0756b',
  coralOrange: '#d4845a',
  seaweedGreen: '#2d6b3a',
  tidePool: '#1a5060',
  barnacle: '#9a9080',
  // Port
  portWater: '#1e5570',
  portDock: '#8b7355',
  portDockLight: '#a08a66',
  plankDark: '#6b5030',
  ropeColor: '#a09070',
  lanternGlow: 'rgba(255,200,80,0.25)',
  // Storm
  stormDark: 'rgba(40, 15, 70, 0.38)',
  stormLight: 'rgba(60, 25, 100, 0.2)',
  stormBorder: '#8b5cf6',
  stormCloud: 'rgba(30,15,50,0.15)',
  rainDrop: 'rgba(180,200,220,0.18)',
  // Treasure
  treasure: '#ffd700',
  // UI
  gridLine: 'rgba(255,255,255,0.04)',
  gridLabel: '#6b6050',
  highlight: 'rgba(255, 215, 0, 0.3)',
  moveHighlight: 'rgba(0, 200, 255, 0.2)',
  moveBorder: 'rgba(0, 200, 255, 0.55)',
};

const SHIP_COLORS = {
  red: '#ef4444', blue: '#3b82f6', green: '#22c55e',
  yellow: '#eab308', purple: '#a855f7', orange: '#f97316',
};

// ── Offscreen Board Cache ────────────────────────────────────────
let _cachedBoard = null; // { canvas, tileSize, boardKey }

function computeBoardKey(board, totalCols, totalRows, walls) {
  // Simple hash of tile types + positions + walls for cache invalidation
  let hash = 0;
  for (let r = 0; r < totalRows; r++) {
    for (let c = 0; c < totalCols; c++) {
      const t = board[r][c];
      const typeVal = t.type.charCodeAt(0) + (t.type.charCodeAt(1) || 0);
      hash = ((hash << 5) - hash + typeVal + c * 31 + r * 37) | 0;
    }
  }
  // Include walls in hash
  if (walls) {
    for (const w of walls) {
      hash = ((hash << 5) - hash + w.col1 * 13 + w.row1 * 17 + w.col2 * 19 + w.row2 * 23) | 0;
    }
  }
  return hash;
}

// Calculate optimal tile size for the viewport
export function calculateLayout(viewportW, viewportH, sidebarW = 400, topBarH = 52) {
  const areaW = viewportW - sidebarW - 16; // 16px breathing room
  const areaH = viewportH - topBarH - 8;
  const gridPad = 30;
  const fromW = Math.floor((areaW - gridPad * 2) / 18);
  const fromH = Math.floor((areaH - gridPad * 2) / 12);
  const tileSize = Math.max(48, Math.min(fromW, fromH, 96));
  return { tileSize, gridPad };
}

export function drawBoard(ctx, canvas, gameState, options = {}, layout = { tileSize: 80, gridPad: 30 }) {
  const { selectedShip, hoveredTile, validMoves, selectedIsland } = options;
  const { board, totalCols, totalRows, storm, treasureTokens, islands, players } = gameState;
  const ts = layout.tileSize;
  const gp = layout.gridPad;

  const boardW = totalCols * ts;
  const boardH = totalRows * ts;
  canvas.width = boardW + gp * 2;
  canvas.height = boardH + gp * 2;

  // ── Static Layer (cached) ──
  const boardKey = computeBoardKey(board, totalCols, totalRows, gameState.walls);
  if (_cachedBoard && _cachedBoard.boardKey === boardKey && _cachedBoard.tileSize === ts) {
    // Draw from cache
    ctx.drawImage(_cachedBoard.canvas, 0, 0);
  } else {
    // Build static layer
    drawStaticLayer(ctx, canvas, gameState, layout);
    // Cache it
    try {
      const cacheCanvas = document.createElement('canvas');
      cacheCanvas.width = canvas.width;
      cacheCanvas.height = canvas.height;
      const cacheCtx = cacheCanvas.getContext('2d');
      cacheCtx.drawImage(canvas, 0, 0);
      _cachedBoard = { canvas: cacheCanvas, tileSize: ts, boardKey };
    } catch (e) {
      // Cache failure is non-critical
    }
  }

  // ── Dynamic Layer (per-frame) ──
  drawDynamicLayer(ctx, gameState, options, layout);
}

function drawStaticLayer(ctx, canvas, gameState, layout) {
  const { board, totalCols, totalRows, islands, players } = gameState;
  const ts = layout.tileSize;
  const gp = layout.gridPad;
  const boardW = totalCols * ts;
  const boardH = totalRows * ts;

  // Background
  ctx.fillStyle = '#0a1e2a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Grid labels
  const labelSize = Math.max(9, Math.round(ts * 0.14));
  ctx.font = `bold ${labelSize}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.gridLabel;
  for (let c = 0; c < totalCols; c++) {
    const x = gp + c * ts + ts / 2;
    ctx.fillText(String(c + 1), x, gp / 2);
    ctx.fillText(String(c + 1), x, boardH + gp + gp / 2);
  }
  for (let r = 0; r < totalRows; r++) {
    const y = gp + r * ts + ts / 2;
    ctx.fillText(String.fromCharCode(65 + r), gp / 2, y);
    ctx.fillText(String.fromCharCode(65 + r), boardW + gp + gp / 2, y);
  }

  // Pre-compute island neighbor set for shore blending
  const islandSet = new Set();
  for (let r = 0; r < totalRows; r++) {
    for (let c = 0; c < totalCols; c++) {
      const t = board[r][c];
      if (t.type === 'island' || t.type === 'merchant' || t.type === 'normal_island') {
        islandSet.add(`${c},${r}`);
      }
    }
  }

  // Draw tiles
  for (let r = 0; r < totalRows; r++) {
    for (let c = 0; c < totalCols; c++) {
      const tile = board[r][c];
      const x = gp + c * ts;
      const y = gp + r * ts;

      switch (tile.type) {
        case 'sea':
          drawSeaTile(ctx, x, y, c, r, ts, islandSet);
          break;
        case 'island':
          drawIslandTile(ctx, x, y, c, r, ts, islandSet);
          break;
        case 'merchant':
          drawMerchantTile(ctx, x, y, c, r, ts, islandSet);
          break;
        case 'port':
          drawPortTile(ctx, x, y, c, r, ts, tile, islands, players);
          break;
        case 'normal_island':
          drawRockTile(ctx, x, y, c, r, ts, islandSet, tile);
          break;
        case 'land_barrier':
          drawLandBarrier(ctx, x, y, ts);
          break;
        default:
          drawSeaTile(ctx, x, y, c, r, ts, islandSet);
      }

      // Grid lines
      ctx.strokeStyle = COLORS.gridLine;
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x, y, ts, ts);
    }
  }

  // Wall barriers between tiles
  drawWalls(ctx, gameState, ts, gp);

  // Island decorations (flags, skull badges)
  for (let r = 0; r < totalRows; r++) {
    for (let c = 0; c < totalCols; c++) {
      const tile = board[r][c];
      if (tile.type !== 'island' || !tile.skulls) continue;
      const x = gp + c * ts;
      const y = gp + r * ts;

      const island = findIslandById(islands, tile.islandId);
      if (island && island.tiles[0]?.col === c && island.tiles[0]?.row === r) {
        drawSkullBadge(ctx, x, y, tile.skulls, ts);

        if (island.owner && players[island.owner]) {
          drawOwnerFlag(ctx, x + ts - Math.round(ts * 0.06), y + Math.round(ts * 0.04), SHIP_COLORS[players[island.owner].color], ts);
        }
      }
    }
  }

  // Compass rose
  drawCompassRose(ctx, canvas.width - gp + 2, canvas.height - gp + 2, gp * 0.7);

  // Board edge vignette
  drawBoardEdge(ctx, canvas.width, canvas.height, gp, totalCols * ts, totalRows * ts);
}

function drawDynamicLayer(ctx, gameState, options, layout) {
  const { selectedShip, hoveredTile, validMoves, selectedIsland } = options;
  const { board, totalCols, totalRows, storm, treasureTokens, islands, players } = gameState;
  const ts = layout.tileSize;
  const gp = layout.gridPad;

  // Valid move highlights
  if (validMoves) {
    for (const m of validMoves) {
      const x = gp + m.col * ts;
      const y = gp + m.row * ts;
      ctx.fillStyle = COLORS.moveHighlight;
      ctx.fillRect(x, y, ts, ts);
      ctx.strokeStyle = COLORS.moveBorder;
      ctx.lineWidth = 2;
      ctx.setLineDash([ts * 0.08, ts * 0.08]);
      ctx.strokeRect(x + 1, y + 1, ts - 2, ts - 2);
      ctx.setLineDash([]);
    }
  }

  // Hover
  if (hoveredTile) {
    const x = gp + hoveredTile.col * ts;
    const y = gp + hoveredTile.row * ts;
    ctx.fillStyle = COLORS.highlight;
    ctx.fillRect(x, y, ts, ts);
  }

  // Storm
  if (storm) drawStorm(ctx, storm, ts, gp);

  // Treasure tokens
  for (const token of treasureTokens || []) {
    drawTreasure(ctx, token, ts, gp);
  }

  // Ships
  for (const player of Object.values(players)) {
    for (const ship of player.ships || []) {
      drawShip(ctx, ship, player.color, selectedShip?.id === ship.id, ts, gp);
    }
  }

  // Selected island highlight
  if (selectedIsland && islands[selectedIsland]) {
    const isl = islands[selectedIsland];
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 3;
    for (const t of isl.tiles) {
      ctx.strokeRect(gp + t.col * ts + 1, gp + t.row * ts + 1, ts - 2, ts - 2);
    }
  }
}

// ── Tile Renderers ─────────────────────────────────────────────

function drawSeaTile(ctx, x, y, col, row, ts, islandSet) {
  // Depth-aware base: deeper blue away from islands
  const nearIsland = islandSet.has(`${col},${row - 1}`) || islandSet.has(`${col},${row + 1}`) ||
                     islandSet.has(`${col - 1},${row}`) || islandSet.has(`${col + 1},${row}`);
  const base = nearIsland ? COLORS.seaShallow : ((row + col) % 2 === 0 ? COLORS.sea1 : COLORS.sea2);
  ctx.fillStyle = base;
  ctx.fillRect(x, y, ts, ts);

  // Depth gradient overlay
  if (!nearIsland) {
    const grad = ctx.createRadialGradient(x + ts * 0.4, y + ts * 0.4, 0, x + ts / 2, y + ts / 2, ts * 0.9);
    grad.addColorStop(0, 'rgba(15, 45, 69, 0.18)');
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, ts, ts);
  } else {
    // Shallow water brightening near islands
    const grad = ctx.createRadialGradient(x + ts / 2, y + ts / 2, ts * 0.1, x + ts / 2, y + ts / 2, ts * 0.7);
    grad.addColorStop(0, 'rgba(31, 96, 128, 0.12)');
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, ts, ts);
  }

  // Wave lines (5 per tile with varied amplitude)
  const seed = (col * 7 + row * 13) % 17;
  for (let i = 0; i < 5; i++) {
    const waveOpacity = 0.05 + (i % 3) * 0.02;
    ctx.strokeStyle = `rgba(100, 180, 220, ${waveOpacity})`;
    ctx.lineWidth = 0.8 + (i % 2) * 0.4;
    const waveY = y + ts * 0.08 + i * ts * 0.18 + ((seed + i * 3) % 7);
    const amp = ts * 0.025 + (i % 3) * ts * 0.015;
    ctx.beginPath();
    ctx.moveTo(x, waveY);
    ctx.quadraticCurveTo(x + ts * 0.25, waveY - amp, x + ts * 0.5, waveY + ((seed + i) % 3) * 0.5);
    ctx.quadraticCurveTo(x + ts * 0.75, waveY + amp, x + ts, waveY);
    ctx.stroke();
  }

  // Caustic light spots (2-3 per tile)
  const causticCount = 2 + (seed % 2);
  for (let i = 0; i < causticCount; i++) {
    const cx = x + ((seed * 11 + i * 31) % Math.round(ts * 0.7)) + ts * 0.15;
    const cy = y + ((seed * 17 + i * 23) % Math.round(ts * 0.7)) + ts * 0.15;
    const cr = ts * 0.03 + (i % 2) * ts * 0.02;
    ctx.fillStyle = COLORS.seaCaustic;
    ctx.beginPath();
    ctx.arc(cx, cy, cr, 0, Math.PI * 2);
    ctx.fill();
  }

  // Shore wash and foam on tiles adjacent to land
  drawShoreWash(ctx, x, y, col, row, ts, islandSet);
}

function drawShoreWash(ctx, x, y, col, row, ts, islandSet) {
  const shoreW = Math.round(ts * 0.16);
  const shoreColor = 'rgba(160, 210, 230, 0.15)';
  const foamColor = COLORS.beachFoam;
  const foamDotR = Math.max(1, ts * 0.015);

  const sides = [
    { has: islandSet.has(`${col},${row - 1}`), dir: 'N' },
    { has: islandSet.has(`${col},${row + 1}`), dir: 'S' },
    { has: islandSet.has(`${col - 1},${row}`), dir: 'W' },
    { has: islandSet.has(`${col + 1},${row}`), dir: 'E' },
  ];

  for (const side of sides) {
    if (!side.has) continue;
    let g;
    if (side.dir === 'N') {
      g = ctx.createLinearGradient(x, y, x, y + shoreW);
      g.addColorStop(0, shoreColor); g.addColorStop(1, 'transparent');
      ctx.fillStyle = g; ctx.fillRect(x, y, ts, shoreW);
    } else if (side.dir === 'S') {
      g = ctx.createLinearGradient(x, y + ts, x, y + ts - shoreW);
      g.addColorStop(0, shoreColor); g.addColorStop(1, 'transparent');
      ctx.fillStyle = g; ctx.fillRect(x, y + ts - shoreW, ts, shoreW);
    } else if (side.dir === 'W') {
      g = ctx.createLinearGradient(x, y, x + shoreW, y);
      g.addColorStop(0, shoreColor); g.addColorStop(1, 'transparent');
      ctx.fillStyle = g; ctx.fillRect(x, y, shoreW, ts);
    } else {
      g = ctx.createLinearGradient(x + ts, y, x + ts - shoreW, y);
      g.addColorStop(0, shoreColor); g.addColorStop(1, 'transparent');
      ctx.fillStyle = g; ctx.fillRect(x + ts - shoreW, y, shoreW, ts);
    }

    // Foam particles along shore edge
    ctx.fillStyle = foamColor;
    const foamSeed = col * 11 + row * 7;
    for (let f = 0; f < 4; f++) {
      let fx, fy;
      const offset = ((foamSeed + f * 13) % Math.round(ts * 0.8)) + ts * 0.1;
      if (side.dir === 'N') { fx = x + offset; fy = y + ((foamSeed + f) % Math.round(shoreW * 0.6)); }
      else if (side.dir === 'S') { fx = x + offset; fy = y + ts - ((foamSeed + f) % Math.round(shoreW * 0.6)); }
      else if (side.dir === 'W') { fy = y + offset; fx = x + ((foamSeed + f) % Math.round(shoreW * 0.6)); }
      else { fy = y + offset; fx = x + ts - ((foamSeed + f) % Math.round(shoreW * 0.6)); }
      ctx.beginPath();
      ctx.arc(fx, fy, foamDotR, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawIslandTile(ctx, x, y, col, row, ts, islandSet) {
  // Water-neighbor detection
  const hasWN = !islandSet.has(`${col},${row - 1}`);
  const hasWS = !islandSet.has(`${col},${row + 1}`);
  const hasWW = !islandSet.has(`${col - 1},${row}`);
  const hasWE = !islandSet.has(`${col + 1},${row}`);
  const waterSides = (hasWN ? 1 : 0) + (hasWS ? 1 : 0) + (hasWW ? 1 : 0) + (hasWE ? 1 : 0);
  const isEdge = waterSides > 0;

  // Layer 1: Beach ring (sandy base on water-facing edges)
  const beachW = Math.round(ts * 0.15);
  ctx.fillStyle = COLORS.beachLight;
  ctx.fillRect(x, y, ts, ts);

  // Wet sand gradient at waterline edges
  if (hasWN) {
    const g = ctx.createLinearGradient(x, y, x, y + beachW);
    g.addColorStop(0, COLORS.beachWet); g.addColorStop(0.5, COLORS.sandDark); g.addColorStop(1, COLORS.sand);
    ctx.fillStyle = g; ctx.fillRect(x, y, ts, beachW);
  }
  if (hasWS) {
    const g = ctx.createLinearGradient(x, y + ts, x, y + ts - beachW);
    g.addColorStop(0, COLORS.beachWet); g.addColorStop(0.5, COLORS.sandDark); g.addColorStop(1, COLORS.sand);
    ctx.fillStyle = g; ctx.fillRect(x, y + ts - beachW, ts, beachW);
  }
  if (hasWW) {
    const g = ctx.createLinearGradient(x, y, x + beachW, y);
    g.addColorStop(0, COLORS.beachWet); g.addColorStop(0.5, COLORS.sandDark); g.addColorStop(1, COLORS.sand);
    ctx.fillStyle = g; ctx.fillRect(x, y, beachW, ts);
  }
  if (hasWE) {
    const g = ctx.createLinearGradient(x + ts, y, x + ts - beachW, y);
    g.addColorStop(0, COLORS.beachWet); g.addColorStop(0.5, COLORS.sandDark); g.addColorStop(1, COLORS.sand);
    ctx.fillStyle = g; ctx.fillRect(x + ts - beachW, y, beachW, ts);
  }

  // Layer 2: Vegetation — canopy blobs
  const inset = Math.round(ts * 0.12);
  const gx = x + (hasWW ? inset + 3 : 1);
  const gy = y + (hasWN ? inset + 3 : 1);
  const gw = ts - (hasWW ? inset + 3 : 1) - (hasWE ? inset + 3 : 1);
  const gh = ts - (hasWN ? inset + 3 : 1) - (hasWS ? inset + 3 : 1);

  if (gw > 6 && gh > 6) {
    // Base vegetation fill
    const greenVar = ((col * 7 + row * 13) % 3 === 0) ? COLORS.green2 : COLORS.green1;
    ctx.fillStyle = greenVar;
    roundRect(ctx, gx, gy, gw, gh, Math.round(ts * 0.08));
    ctx.fill();

    // Canopy blobs (overlapping circles for organic feel)
    const blobCount = 3 + ((col * 3 + row * 5) % 3);
    for (let b = 0; b < blobCount; b++) {
      const blobR = ts * 0.08 + ((col * 7 + b * 11 + row) % 5) * ts * 0.015;
      const bx = gx + ((col * 13 + b * 19 + row * 3) % Math.max(gw - 8, 1)) + 4;
      const by = gy + ((row * 11 + b * 17 + col * 5) % Math.max(gh - 8, 1)) + 4;
      const bColor = b % 3 === 0 ? COLORS.greenDark : (b % 3 === 1 ? greenVar : COLORS.greenLight);
      ctx.fillStyle = bColor;
      ctx.beginPath();
      ctx.arc(bx, by, blobR, 0, Math.PI * 2);
      ctx.fill();
    }

    // Layer 5: Flower details (tiny colored dots)
    const flowerSeed = col * 23 + row * 31;
    const flowerCount = 1 + (flowerSeed % 3);
    for (let f = 0; f < flowerCount; f++) {
      const fx = gx + ((flowerSeed + f * 29) % Math.max(gw - 6, 1)) + 3;
      const fy = gy + ((flowerSeed + f * 37) % Math.max(gh - 6, 1)) + 3;
      ctx.fillStyle = f % 2 === 0 ? COLORS.flowerRed : COLORS.flowerYellow;
      ctx.beginPath();
      ctx.arc(fx, fy, Math.max(1, ts * 0.018), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Layer 3: Palm trees on edge tiles
  if (isEdge && ts >= 50) {
    const palmSeed = col * 17 + row * 29;
    const palmCount = 1 + (palmSeed % 2);
    for (let p = 0; p < palmCount; p++) {
      // Position palm near water edge
      let px, py;
      if (hasWN && p === 0) { px = x + ts * 0.3 + (palmSeed % Math.round(ts * 0.4)); py = y + ts * 0.25; }
      else if (hasWS && p === 0) { px = x + ts * 0.3 + (palmSeed % Math.round(ts * 0.4)); py = y + ts * 0.75; }
      else if (hasWW) { px = x + ts * 0.25; py = y + ts * 0.3 + (palmSeed % Math.round(ts * 0.4)); }
      else if (hasWE) { px = x + ts * 0.75; py = y + ts * 0.3 + (palmSeed % Math.round(ts * 0.4)); }
      else { px = x + ts * 0.5; py = y + ts * 0.5; }

      drawPalmTree(ctx, px, py, ts);
    }
  }

  // Layer 4: Cliff edges (dark shadow on water-facing edges with 2+ adjacent water)
  if (waterSides >= 2) {
    ctx.strokeStyle = COLORS.cliffBrown;
    ctx.lineWidth = Math.max(1.5, ts * 0.025);
    if (hasWN) {
      ctx.beginPath(); ctx.moveTo(x + 2, y + 1); ctx.lineTo(x + ts - 2, y + 1); ctx.stroke();
    }
    if (hasWS) {
      ctx.beginPath(); ctx.moveTo(x + 2, y + ts - 1); ctx.lineTo(x + ts - 2, y + ts - 1); ctx.stroke();
    }
    if (hasWW) {
      ctx.beginPath(); ctx.moveTo(x + 1, y + 2); ctx.lineTo(x + 1, y + ts - 2); ctx.stroke();
    }
    if (hasWE) {
      ctx.beginPath(); ctx.moveTo(x + ts - 1, y + 2); ctx.lineTo(x + ts - 1, y + ts - 2); ctx.stroke();
    }
  }
}

function drawPalmTree(ctx, px, py, ts) {
  const trunkH = ts * 0.2;
  const trunkW = Math.max(1.5, ts * 0.03);

  // Curved trunk
  ctx.strokeStyle = COLORS.palmTrunk;
  ctx.lineWidth = trunkW;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(px, py + trunkH * 0.3);
  ctx.quadraticCurveTo(px + ts * 0.03, py, px - ts * 0.01, py - trunkH * 0.5);
  ctx.stroke();

  // Fronds (3-4 arcs radiating from top)
  const topX = px - ts * 0.01;
  const topY = py - trunkH * 0.5;
  ctx.strokeStyle = COLORS.palmFrond;
  ctx.lineWidth = Math.max(1, ts * 0.015);
  const frondAngles = [-2.2, -1.5, -0.8, 0.3];
  for (let i = 0; i < frondAngles.length; i++) {
    const angle = frondAngles[i];
    const frondLen = ts * 0.1 + (i % 2) * ts * 0.03;
    const endX = topX + Math.cos(angle) * frondLen;
    const endY = topY + Math.sin(angle) * frondLen;
    const cpX = topX + Math.cos(angle) * frondLen * 0.5 + (i % 2 ? -1 : 1) * ts * 0.02;
    const cpY = topY + Math.sin(angle) * frondLen * 0.5 - ts * 0.02;
    ctx.strokeStyle = i % 2 === 0 ? COLORS.palmFrond : COLORS.palmFrondLight;
    ctx.beginPath();
    ctx.moveTo(topX, topY);
    ctx.quadraticCurveTo(cpX, cpY, endX, endY);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
}

function drawMerchantTile(ctx, x, y, col, row, ts, islandSet) {
  // Sandy base with warmer tone
  ctx.fillStyle = COLORS.merchantSand;
  ctx.fillRect(x, y, ts, ts);

  // Vegetation area
  const inset = Math.round(ts * 0.1);
  ctx.fillStyle = COLORS.merchantGreen;
  roundRect(ctx, x + inset, y + inset, ts - inset * 2, ts - inset * 2, Math.round(ts * 0.08));
  ctx.fill();

  // Darker vegetation patches
  const seed = col * 11 + row * 7;
  ctx.fillStyle = COLORS.greenDark;
  for (let i = 0; i < 2; i++) {
    const sx = x + inset + ((seed + i * 17) % Math.max(ts - inset * 2 - 8, 1)) + 4;
    const sy = y + inset + ((seed + i * 23) % Math.max(ts - inset * 2 - 8, 1)) + 4;
    ctx.beginPath();
    ctx.arc(sx, sy, ts * 0.05, 0, Math.PI * 2);
    ctx.fill();
  }

  // Market stall
  drawMarketStall(ctx, x + ts / 2, y + ts / 2, ts);
}

function drawMarketStall(ctx, cx, cy, ts) {
  const stallW = ts * 0.35;
  const stallH = ts * 0.3;

  // Two wooden posts
  ctx.strokeStyle = COLORS.crateWood;
  ctx.lineWidth = Math.max(1.5, ts * 0.025);
  ctx.beginPath();
  ctx.moveTo(cx - stallW * 0.4, cy + stallH * 0.3);
  ctx.lineTo(cx - stallW * 0.4, cy - stallH * 0.4);
  ctx.moveTo(cx + stallW * 0.4, cy + stallH * 0.3);
  ctx.lineTo(cx + stallW * 0.4, cy - stallH * 0.4);
  ctx.stroke();

  // Canopy (colored triangle)
  ctx.fillStyle = COLORS.canopyRed;
  ctx.beginPath();
  ctx.moveTo(cx - stallW * 0.5, cy - stallH * 0.25);
  ctx.lineTo(cx + stallW * 0.5, cy - stallH * 0.25);
  ctx.lineTo(cx + stallW * 0.55, cy - stallH * 0.55);
  ctx.lineTo(cx - stallW * 0.55, cy - stallH * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.2)';
  ctx.lineWidth = 0.5;
  ctx.stroke();

  // Barrel underneath
  drawBarrelIcon(ctx, cx, cy + stallH * 0.1, ts * 0.35);

  // Crate beside stall
  ctx.fillStyle = COLORS.crateWood;
  const crateS = ts * 0.07;
  roundRect(ctx, cx + stallW * 0.35, cy + stallH * 0.05, crateS, crateS, 1);
  ctx.fill();
  ctx.strokeStyle = '#5a4020';
  ctx.lineWidth = 0.5;
  ctx.stroke();
}

function drawBarrelIcon(ctx, cx, cy, size) {
  const w = size * 0.5;
  const h = size * 0.65;
  // Barrel body
  ctx.fillStyle = '#8B6914';
  roundRect(ctx, cx - w / 2, cy - h / 2, w, h, size * 0.12);
  ctx.fill();
  ctx.strokeStyle = '#5a4510';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // Metal bands
  ctx.strokeStyle = '#a0a0a0';
  ctx.lineWidth = Math.max(1, size * 0.04);
  ctx.beginPath();
  ctx.moveTo(cx - w / 2 + 1, cy - h * 0.18);
  ctx.lineTo(cx + w / 2 - 1, cy - h * 0.18);
  ctx.moveTo(cx - w / 2 + 1, cy + h * 0.18);
  ctx.lineTo(cx + w / 2 - 1, cy + h * 0.18);
  ctx.stroke();
}

function drawPortTile(ctx, x, y, col, row, ts, tile, islands, players) {
  // Deep port water
  ctx.fillStyle = COLORS.portWater;
  ctx.fillRect(x, y, ts, ts);

  // Subtle ripples
  ctx.strokeStyle = 'rgba(60,140,180,0.06)';
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 3; i++) {
    const ry = y + ts * 0.2 + i * ts * 0.25;
    ctx.beginPath();
    ctx.moveTo(x, ry);
    ctx.quadraticCurveTo(x + ts * 0.5, ry - ts * 0.02, x + ts, ry);
    ctx.stroke();
  }

  // Multi-plank dock
  const plankW = Math.round(ts * 0.45);
  const plankH = Math.max(3, Math.round(ts * 0.055));
  const dockX = x + ts / 2 - plankW / 2;
  const dockBaseY = y + ts - plankH * 6;

  for (let p = 0; p < 4; p++) {
    const py = dockBaseY + p * (plankH + 1);
    const pw = plankW - (p % 2) * ts * 0.05;
    const pColor = p % 2 === 0 ? COLORS.portDock : COLORS.plankDark;
    ctx.fillStyle = pColor;
    ctx.fillRect(dockX + (plankW - pw) / 2, py, pw, plankH);
    // Wood grain
    ctx.strokeStyle = 'rgba(90,70,40,0.25)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(dockX + (plankW - pw) / 2 + 2, py + plankH / 2);
    ctx.lineTo(dockX + (plankW - pw) / 2 + pw - 2, py + plankH / 2);
    ctx.stroke();
  }

  // Mooring posts
  const postW = Math.max(2, ts * 0.04);
  const postH = Math.max(4, ts * 0.08);
  ctx.fillStyle = COLORS.portDockLight;
  ctx.fillRect(dockX - postW, dockBaseY - postH * 0.5, postW, postH + plankH * 2);
  ctx.fillRect(dockX + plankW, dockBaseY - postH * 0.5, postW, postH + plankH * 2);
  // Post tops
  ctx.fillStyle = '#c0a870';
  ctx.fillRect(dockX - postW - 1, dockBaseY - postH * 0.5 - 1, postW + 2, 2);
  ctx.fillRect(dockX + plankW - 1, dockBaseY - postH * 0.5 - 1, postW + 2, 2);

  // Rope coil near one post
  ctx.strokeStyle = COLORS.ropeColor;
  ctx.lineWidth = Math.max(0.8, ts * 0.012);
  const ropeX = dockX - postW - ts * 0.04;
  const ropeY = dockBaseY + plankH;
  ctx.beginPath();
  ctx.arc(ropeX, ropeY, ts * 0.025, 0, Math.PI * 1.5);
  ctx.stroke();

  // Lantern glow
  ctx.fillStyle = COLORS.lanternGlow;
  const lanternGrad = ctx.createRadialGradient(dockX + plankW + postW / 2, dockBaseY - postH * 0.3, 0,
    dockX + plankW + postW / 2, dockBaseY - postH * 0.3, ts * 0.1);
  lanternGrad.addColorStop(0, 'rgba(255,200,80,0.3)');
  lanternGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = lanternGrad;
  ctx.fillRect(dockX + plankW - ts * 0.05, dockBaseY - postH - ts * 0.05, ts * 0.15, ts * 0.15);

  // Anchor icon
  drawAnchorIcon(ctx, x + ts / 2, y + ts * 0.32, ts * 0.38);
}

function drawAnchorIcon(ctx, cx, cy, size) {
  ctx.strokeStyle = '#9ab0c0';
  ctx.lineWidth = Math.max(1.5, size * 0.06);
  ctx.lineCap = 'round';
  // Ring at top
  ctx.beginPath();
  ctx.arc(cx, cy - size * 0.32, size * 0.08, 0, Math.PI * 2);
  ctx.stroke();
  // Vertical shaft
  ctx.beginPath();
  ctx.moveTo(cx, cy - size * 0.24);
  ctx.lineTo(cx, cy + size * 0.25);
  ctx.stroke();
  // Crossbar
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.2, cy - size * 0.1);
  ctx.lineTo(cx + size * 0.2, cy - size * 0.1);
  ctx.stroke();
  // Bottom curve (fluke)
  ctx.beginPath();
  ctx.arc(cx, cy + size * 0.1, size * 0.2, 0, Math.PI);
  ctx.stroke();
  // Fluke tips
  const flukeR = size * 0.2;
  ctx.beginPath();
  ctx.moveTo(cx - flukeR, cy + size * 0.1);
  ctx.lineTo(cx - flukeR - size * 0.06, cy + size * 0.04);
  ctx.moveTo(cx + flukeR, cy + size * 0.1);
  ctx.lineTo(cx + flukeR + size * 0.06, cy + size * 0.04);
  ctx.stroke();
  ctx.lineCap = 'butt';
}

function drawRockTile(ctx, x, y, col, row, ts, islandSet, tile) {
  const isBorder = tile?.isBorderObstacle;

  // Sea base underneath (so rock floats on water)
  const seaBase = (row + col) % 2 === 0 ? COLORS.sea1 : COLORS.seaShallow;
  ctx.fillStyle = seaBase;
  ctx.fillRect(x, y, ts, ts);

  // Wave on water background
  ctx.strokeStyle = 'rgba(100,180,220,0.05)';
  ctx.lineWidth = 0.8;
  const wSeed = col * 7 + row * 13;
  const wY = y + ts * 0.15 + (wSeed % 5);
  ctx.beginPath();
  ctx.moveTo(x, wY);
  ctx.quadraticCurveTo(x + ts * 0.5, wY - ts * 0.02, x + ts, wY);
  ctx.stroke();

  // Irregular rock polygon (6-8 vertices)
  const seed = (col * 17 + row * 11);
  const vertCount = 6 + (seed % 3);
  const rockR = ts * 0.32;
  const rcx = x + ts / 2;
  const rcy = y + ts / 2;

  ctx.fillStyle = isBorder ? '#5e5e4e' : COLORS.rock;
  ctx.beginPath();
  for (let v = 0; v < vertCount; v++) {
    const angle = (v / vertCount) * Math.PI * 2 - Math.PI / 2;
    const jitter = 0.7 + ((seed * 7 + v * 13) % 11) / 30;
    const vr = rockR * jitter;
    const vx = rcx + Math.cos(angle) * vr;
    const vy = rcy + Math.sin(angle) * vr;
    if (v === 0) ctx.moveTo(vx, vy);
    else ctx.lineTo(vx, vy);
  }
  ctx.closePath();
  ctx.fill();

  // Rock outline
  ctx.strokeStyle = COLORS.rockDark;
  ctx.lineWidth = Math.max(1, ts * 0.02);
  ctx.stroke();

  // Dark spots on rock
  ctx.fillStyle = COLORS.rockDark;
  const s1x = rcx + ((seed * 3) % Math.round(rockR * 0.5)) - rockR * 0.25;
  const s1y = rcy + ((seed * 5) % Math.round(rockR * 0.5)) - rockR * 0.25;
  ctx.beginPath();
  ctx.arc(s1x, s1y, ts * 0.04, 0, Math.PI * 2);
  ctx.fill();

  // Light highlight
  ctx.fillStyle = COLORS.rockLight;
  ctx.beginPath();
  ctx.arc(rcx - rockR * 0.15, rcy - rockR * 0.2, ts * 0.035, 0, Math.PI * 2);
  ctx.fill();

  // Coral accents at rock base (2-3 small colored circles)
  const coralCount = 2 + (seed % 2);
  for (let c = 0; c < coralCount; c++) {
    const angle = ((seed + c * 5) % vertCount) / vertCount * Math.PI * 2;
    const cx = rcx + Math.cos(angle) * rockR * 0.85;
    const cy = rcy + Math.sin(angle) * rockR * 0.85;
    ctx.fillStyle = c % 2 === 0 ? COLORS.coralPink : COLORS.coralOrange;
    ctx.beginPath();
    ctx.arc(cx, cy, ts * 0.025 + (c % 2) * ts * 0.01, 0, Math.PI * 2);
    ctx.fill();
  }

  // Seaweed strands (1-2 wavy green lines)
  ctx.strokeStyle = COLORS.seaweedGreen;
  ctx.lineWidth = Math.max(1, ts * 0.015);
  for (let s = 0; s < 1 + (seed % 2); s++) {
    const angle = ((seed * 3 + s * 7) % vertCount) / vertCount * Math.PI * 2;
    const sx = rcx + Math.cos(angle) * rockR * 0.7;
    const sy = rcy + Math.sin(angle) * rockR * 0.7;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(sx + ts * 0.03, sy + ts * 0.06, sx - ts * 0.01, sy + ts * 0.1);
    ctx.stroke();
  }

  // Tide pool on rock surface
  ctx.fillStyle = COLORS.tidePool;
  const tpx = rcx + ((seed * 11) % Math.round(rockR * 0.4)) - rockR * 0.2;
  const tpy = rcy + ((seed * 13) % Math.round(rockR * 0.4));
  ctx.beginPath();
  ctx.ellipse(tpx, tpy, ts * 0.03, ts * 0.02, 0, 0, Math.PI * 2);
  ctx.fill();

  // Border obstacle barnacle texture
  if (isBorder) {
    ctx.fillStyle = COLORS.barnacle;
    for (let b = 0; b < 3; b++) {
      const bx = rcx + ((seed * 19 + b * 7) % Math.round(rockR * 0.6)) - rockR * 0.3;
      const by = rcy + ((seed * 23 + b * 11) % Math.round(rockR * 0.6)) - rockR * 0.3;
      ctx.beginPath();
      ctx.arc(bx, by, ts * 0.015, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawLandBarrier(ctx, x, y, ts) {
  ctx.fillStyle = '#3a3a2a';
  ctx.fillRect(x, y, ts, ts);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  const step = Math.max(4, Math.round(ts * 0.1));
  for (let i = 0; i < ts * 2; i += step) {
    ctx.beginPath();
    ctx.moveTo(x + i, y);
    ctx.lineTo(x, y + i);
    ctx.stroke();
  }
}

// ── Decorations ────────────────────────────────────────────────

function drawSkullBadge(ctx, x, y, skulls, ts) {
  const skullSize = Math.round(ts * 0.18);
  const spacing = Math.round(ts * 0.2);
  const badgeW = skulls * spacing + Math.round(ts * 0.1);
  const badgeH = Math.round(ts * 0.22);
  const bx = x + ts / 2 - badgeW / 2;
  const by = y + Math.round(ts * 0.04);

  // Badge background
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  roundRect(ctx, bx, by, badgeW, badgeH, Math.round(ts * 0.04));
  ctx.fill();

  // Draw skull icons
  for (let i = 0; i < skulls; i++) {
    const sx = bx + Math.round(ts * 0.05) + i * spacing + spacing / 2;
    const sy = by + badgeH / 2;
    drawSkullIcon(ctx, sx, sy, skullSize);
  }
}

function drawSkullIcon(ctx, cx, cy, size) {
  // Skull dome
  ctx.fillStyle = '#d8d0c0';
  ctx.beginPath();
  ctx.arc(cx, cy - size * 0.08, size * 0.32, Math.PI, 0);
  ctx.lineTo(cx + size * 0.22, cy + size * 0.15);
  ctx.quadraticCurveTo(cx, cy + size * 0.28, cx - size * 0.22, cy + size * 0.15);
  ctx.closePath();
  ctx.fill();
  // Eye sockets
  ctx.fillStyle = '#1a0f0a';
  ctx.beginPath();
  ctx.arc(cx - size * 0.1, cy - size * 0.02, size * 0.07, 0, Math.PI * 2);
  ctx.arc(cx + size * 0.1, cy - size * 0.02, size * 0.07, 0, Math.PI * 2);
  ctx.fill();
  // Nose
  ctx.beginPath();
  ctx.moveTo(cx, cy + size * 0.05);
  ctx.lineTo(cx - size * 0.04, cy + size * 0.12);
  ctx.lineTo(cx + size * 0.04, cy + size * 0.12);
  ctx.closePath();
  ctx.fill();
}

function drawOwnerFlag(ctx, x, y, color, ts) {
  const poleH = Math.round(ts * 0.35);
  const flagW = Math.round(ts * 0.2);
  const flagH = Math.round(ts * 0.15);

  // Pole
  ctx.strokeStyle = '#8b7355';
  ctx.lineWidth = Math.max(1.5, ts * 0.025);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + poleH);
  ctx.stroke();

  // Triangular flag with wave
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x - flagW * 0.6, y + flagH * 0.35, x - flagW, y + flagH * 0.4);
  ctx.lineTo(x, y + flagH);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawStorm(ctx, storm, ts, gp) {
  // Cloud overlay per tile
  for (const t of storm.tiles) {
    const x = gp + t.col * ts;
    const y = gp + t.row * ts;

    // Radial gradient
    const grad = ctx.createRadialGradient(x + ts / 2, y + ts / 2, 0, x + ts / 2, y + ts / 2, ts * 0.85);
    grad.addColorStop(0, COLORS.stormDark);
    grad.addColorStop(1, COLORS.stormLight);
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, ts, ts);

    // Cloud puffs (5 per tile with size variation)
    const seed = t.col * 7 + t.row * 13;
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = i < 2 ? COLORS.stormCloud : 'rgba(40, 20, 60, 0.10)';
      const cx = x + ((seed + i * 17) % Math.round(ts * 0.7)) + ts * 0.15;
      const cy = y + ((seed + i * 23) % Math.round(ts * 0.7)) + ts * 0.15;
      const cr = ts * 0.12 + (i % 3) * ts * 0.06;
      ctx.beginPath();
      ctx.arc(cx, cy, cr, 0, Math.PI * 2);
      ctx.fill();
    }

    // Rain streaks (4-6 diagonal lines)
    ctx.strokeStyle = COLORS.rainDrop;
    ctx.lineWidth = 0.8;
    const rainCount = 4 + (seed % 3);
    for (let r = 0; r < rainCount; r++) {
      const rx = x + ((seed + r * 19) % Math.round(ts * 0.85)) + ts * 0.05;
      const ry = y + ((seed + r * 11) % Math.round(ts * 0.6)) + ts * 0.1;
      const rainLen = ts * 0.08 + (r % 3) * ts * 0.04;
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx - rainLen * 0.2, ry + rainLen);
      ctx.stroke();
    }

    // Lightning bolt on some tiles (brighter)
    if ((t.col + t.row) % 3 === 0) {
      drawLightningBolt(ctx, x + ts * 0.3, y + ts * 0.1, x + ts * 0.55, y + ts * 0.85, ts);
    }
  }

  // Storm border with glow
  const minC = Math.min(...storm.tiles.map(t => t.col));
  const maxC = Math.max(...storm.tiles.map(t => t.col));
  const minR = Math.min(...storm.tiles.map(t => t.row));
  const maxR = Math.max(...storm.tiles.map(t => t.row));

  ctx.save();
  ctx.shadowColor = COLORS.stormBorder;
  ctx.shadowBlur = 6;
  ctx.strokeStyle = COLORS.stormBorder;
  ctx.lineWidth = 2;
  ctx.setLineDash([ts * 0.1, ts * 0.1]);
  ctx.strokeRect(gp + minC * ts, gp + minR * ts, (maxC - minC + 1) * ts, (maxR - minR + 1) * ts);
  ctx.setLineDash([]);
  ctx.restore();

  // Lightning icon at storm center
  const cx = gp + storm.center.col * ts + ts / 2;
  const cy = gp + storm.center.row * ts + ts / 2;
  drawLightningIcon(ctx, cx, cy, ts * 0.5);
}

function drawLightningBolt(ctx, x1, y1, x2, y2, ts) {
  ctx.save();
  ctx.shadowColor = 'rgba(180,150,255,0.4)';
  ctx.shadowBlur = 3;
  ctx.strokeStyle = 'rgba(180, 150, 255, 0.35)';
  ctx.lineWidth = Math.max(1.5, ts * 0.025);

  // Multi-segment zigzag
  const segments = 3;
  const dx = (x2 - x1) / segments;
  const dy = (y2 - y1) / segments;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  for (let s = 1; s < segments; s++) {
    const jx = x1 + dx * s + (s % 2 === 0 ? ts * 0.04 : -ts * 0.05);
    const jy = y1 + dy * s;
    ctx.lineTo(jx, jy);
  }
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

function drawLightningIcon(ctx, cx, cy, size) {
  ctx.fillStyle = 'rgba(255, 220, 100, 0.6)';
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.05, cy - size * 0.35);
  ctx.lineTo(cx + size * 0.15, cy - size * 0.35);
  ctx.lineTo(cx + size * 0.02, cy - size * 0.02);
  ctx.lineTo(cx + size * 0.18, cy - size * 0.02);
  ctx.lineTo(cx - size * 0.08, cy + size * 0.38);
  ctx.lineTo(cx + size * 0.02, cy + size * 0.05);
  ctx.lineTo(cx - size * 0.14, cy + size * 0.05);
  ctx.closePath();
  ctx.fill();
}

function drawTreasure(ctx, token, ts, gp) {
  const cx = gp + token.col * ts + ts / 2;
  const cy = gp + token.row * ts + ts / 2;
  const size = ts * 0.32;

  // Parchment circle background
  ctx.fillStyle = 'rgba(200, 170, 90, 0.2)';
  ctx.beginPath();
  ctx.arc(cx, cy, size, 0, Math.PI * 2);
  ctx.fill();

  // Glowing X mark (drawn lines, not text)
  ctx.save();
  ctx.shadowColor = '#ffd700';
  ctx.shadowBlur = ts * 0.12;
  ctx.strokeStyle = COLORS.treasure;
  ctx.lineWidth = Math.max(2, ts * 0.05);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.55, cy - size * 0.55);
  ctx.lineTo(cx + size * 0.55, cy + size * 0.55);
  ctx.moveTo(cx + size * 0.55, cy - size * 0.55);
  ctx.lineTo(cx - size * 0.55, cy + size * 0.55);
  ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.restore();
}

// ── Ship Rendering ─────────────────────────────────────────────

function drawShip(ctx, ship, color, isSelected, ts, gp) {
  const x = gp + ship.position.col * ts;
  const y = gp + ship.position.row * ts;
  const cx = x + ts / 2;
  const cy = y + ts / 2;
  const shipColor = SHIP_COLORS[color] || '#fff';

  // Selection glow
  if (isSelected) {
    ctx.save();
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = ts * 0.2;
  }

  // ── Hull (top-down ship shape) ──
  const hullHW = ts * 0.28; // half-width
  const bowY = cy - ts * 0.34;  // pointed bow tip
  const sternY = cy + ts * 0.28;

  ctx.fillStyle = shipColor;
  ctx.beginPath();
  ctx.moveTo(cx, bowY); // bow point
  ctx.quadraticCurveTo(cx + hullHW * 0.5, bowY + ts * 0.1, cx + hullHW, cy + ts * 0.04); // starboard bow curve
  ctx.lineTo(cx + hullHW * 0.85, sternY); // starboard stern
  ctx.quadraticCurveTo(cx, sternY + ts * 0.06, cx - hullHW * 0.85, sternY); // stern curve
  ctx.lineTo(cx - hullHW, cy + ts * 0.04); // port stern
  ctx.quadraticCurveTo(cx - hullHW * 0.5, bowY + ts * 0.1, cx, bowY); // port bow curve
  ctx.closePath();
  ctx.fill();

  // Hull outline
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = Math.max(1, ts * 0.02);
  ctx.stroke();

  // Deck line (inner)
  ctx.strokeStyle = darkenColor(shipColor, 0.15);
  ctx.lineWidth = Math.max(0.8, ts * 0.012);
  ctx.beginPath();
  ctx.ellipse(cx, cy, hullHW * 0.65, ts * 0.2, 0, 0, Math.PI * 2);
  ctx.stroke();

  if (isSelected) ctx.restore();

  // ── Mast pegs (top area of ship) ──
  const mastY = cy - ts * 0.15;
  for (let m = 0; m < 2; m++) {
    const mx = cx + (m === 0 ? -ts * 0.05 : ts * 0.05);
    const my = mastY + m * ts * 0.06;
    if (m < ship.masts) {
      // Mast pole
      ctx.strokeStyle = '#d4c4a0';
      ctx.lineWidth = Math.max(1, ts * 0.018);
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(mx, my - ts * 0.15);
      ctx.stroke();
      // Sail triangle
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.moveTo(mx, my - ts * 0.13);
      ctx.lineTo(mx + ts * 0.08, my - ts * 0.05);
      ctx.lineTo(mx, my - ts * 0.03);
      ctx.closePath();
      ctx.fill();
    } else {
      // Empty slot
      ctx.strokeStyle = 'rgba(200,200,200,0.2)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(mx, my - ts * 0.04, ts * 0.02, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // ── Cannon pegs (port/left side) ──
  const cannonX = cx - hullHW * 0.65;
  const cannonBaseY = cy + ts * 0.02;
  for (let c = 0; c < 2; c++) {
    const filled = c < ship.cannons;
    const py = cannonBaseY + c * ts * 0.1;
    drawPeg(ctx, cannonX, py, ts * 0.032, filled ? '#444' : null, filled ? '#222' : 'rgba(100,100,100,0.25)');
  }

  // ── Life pegs (starboard/right side) ──
  const lifeX = cx + hullHW * 0.65;
  const lifeBaseY = cy - ts * 0.04;
  for (let l = 0; l < 3; l++) {
    const filled = l < ship.lifePegs;
    const py = lifeBaseY + l * ts * 0.09;
    drawPeg(ctx, lifeX, py, ts * 0.032, filled ? '#ff4444' : null, filled ? '#cc0000' : 'rgba(255,80,80,0.2)');
  }

  // ── Selection ring ──
  if (isSelected) {
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 2;
    ctx.setLineDash([ts * 0.06, ts * 0.06]);
    ctx.beginPath();
    ctx.arc(cx, cy, ts / 2 - 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawPeg(ctx, x, y, r, fillColor, strokeColor) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (fillColor) {
    ctx.fillStyle = fillColor;
    ctx.fill();
  }
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = Math.max(0.8, r * 0.3);
  ctx.stroke();
}

// ── Wall Barriers ──────────────────────────────────────────────

function drawWalls(ctx, gameState, ts, gp) {
  const walls = gameState.walls;
  if (!walls || walls.length === 0) return;

  for (const wall of walls) {
    const { col1, row1, col2, row2 } = wall;
    const isVertical = row1 === row2; // Same row, adjacent cols = vertical edge between them

    if (isVertical) {
      // Vertical wall: between (col1,row1) and (col2,row2) where col2 = col1+1
      // The wall sits on the vertical line between the two tiles
      const edgeX = gp + Math.max(col1, col2) * ts; // Right edge of left tile = left edge of right tile
      const tileY = gp + row1 * ts;
      drawWallRock(ctx, edgeX, tileY + ts * 0.2, ts * 0.24, ts * 0.6, col1 + row1);
    } else {
      // Horizontal wall: between (col1,row1) and (col2,row2) where row2 = row1+1
      // The wall sits on the horizontal line between the two tiles
      const tileX = gp + col1 * ts;
      const edgeY = gp + Math.max(row1, row2) * ts; // Bottom edge of top tile = top edge of bottom tile
      drawWallRock(ctx, tileX + ts * 0.2, edgeY, ts * 0.6, ts * 0.24, col1 + row1 + 7);
    }
  }
}

function drawWallRock(ctx, x, y, w, h, seed) {
  ctx.save();

  // Irregular rocky polygon
  const pts = [];
  const steps = 8;
  const cx = x + w / 2, cy = y + h / 2;
  const rx = w / 2, ry = h / 2;
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    const jitter = 0.7 + ((seed * 31 + i * 17) % 100) / 100 * 0.3;
    pts.push({
      x: cx + Math.cos(angle) * rx * jitter,
      y: cy + Math.sin(angle) * ry * jitter,
    });
  }

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.moveTo(pts[0].x + 1, pts[0].y + 1);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x + 1, pts[i].y + 1);
  ctx.closePath();
  ctx.fill();

  // Rock body
  ctx.fillStyle = COLORS.rock;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fill();

  // Highlights
  ctx.fillStyle = COLORS.rockLight;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  ctx.lineTo(pts[1].x, pts[1].y);
  ctx.lineTo(cx, cy);
  ctx.closePath();
  ctx.fill();

  // Dark edge
  ctx.strokeStyle = COLORS.rockDark;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.stroke();

  // Coral accent
  const coralX = cx + ((seed * 13) % 5 - 2) * (w * 0.06);
  const coralY = cy + ((seed * 7) % 5 - 2) * (h * 0.06);
  ctx.fillStyle = COLORS.coralPink;
  ctx.beginPath();
  ctx.arc(coralX, coralY, Math.min(w, h) * 0.08, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// ── Compass Rose ──────────────────────────────────────────────

function drawCompassRose(ctx, cx, cy, size) {
  ctx.save();
  ctx.globalAlpha = 0.35;

  // 4-point star
  const outerR = size * 0.4;
  const innerR = size * 0.15;

  ctx.fillStyle = '#c9a84c';
  ctx.strokeStyle = '#8b7355';
  ctx.lineWidth = 1;

  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    const px = cx + Math.cos(angle) * r;
    const py = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Center circle
  ctx.fillStyle = '#8b7355';
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.05, 0, Math.PI * 2);
  ctx.fill();

  // Cardinal labels
  const labelSize = Math.max(6, Math.round(size * 0.2));
  ctx.font = `bold ${labelSize}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#c9a84c';

  ctx.fillText('N', cx, cy - outerR - labelSize * 0.7);
  ctx.fillText('S', cx, cy + outerR + labelSize * 0.7);
  ctx.fillText('E', cx + outerR + labelSize * 0.6, cy);
  ctx.fillText('W', cx - outerR - labelSize * 0.6, cy);

  ctx.restore();
}

// ── Board Edge Vignette ────────────────────────────────────────

function drawBoardEdge(ctx, canvasW, canvasH, gp, boardW, boardH) {
  const edgeSize = Math.round(gp * 0.8);

  // Top
  let g = ctx.createLinearGradient(0, 0, 0, edgeSize);
  g.addColorStop(0, 'rgba(10, 30, 42, 0.85)');
  g.addColorStop(1, 'transparent');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvasW, edgeSize);
  // Bottom
  g = ctx.createLinearGradient(0, canvasH, 0, canvasH - edgeSize);
  g.addColorStop(0, 'rgba(10, 30, 42, 0.85)');
  g.addColorStop(1, 'transparent');
  ctx.fillStyle = g;
  ctx.fillRect(0, canvasH - edgeSize, canvasW, edgeSize);
  // Left
  g = ctx.createLinearGradient(0, 0, edgeSize, 0);
  g.addColorStop(0, 'rgba(10, 30, 42, 0.85)');
  g.addColorStop(1, 'transparent');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, edgeSize, canvasH);
  // Right
  g = ctx.createLinearGradient(canvasW, 0, canvasW - edgeSize, 0);
  g.addColorStop(0, 'rgba(10, 30, 42, 0.85)');
  g.addColorStop(1, 'transparent');
  ctx.fillStyle = g;
  ctx.fillRect(canvasW - edgeSize, 0, edgeSize, canvasH);

  // Inner gold border at board boundary
  ctx.strokeStyle = 'rgba(200, 170, 100, 0.12)';
  ctx.lineWidth = 1;
  ctx.strokeRect(gp - 1, gp - 1, boardW + 2, boardH + 2);
}

// ── Utility ────────────────────────────────────────────────────

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function darkenColor(hex, amount) {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.max(0, (num >> 16) - Math.round(255 * amount));
  const g = Math.max(0, ((num >> 8) & 0xff) - Math.round(255 * amount));
  const b = Math.max(0, (num & 0xff) - Math.round(255 * amount));
  return `rgb(${r},${g},${b})`;
}

function findIslandById(islands, id) {
  return islands[id] || null;
}

export function canvasToGrid(canvasX, canvasY, layout) {
  const col = Math.floor((canvasX - layout.gridPad) / layout.tileSize);
  const row = Math.floor((canvasY - layout.gridPad) / layout.tileSize);
  return { col, row };
}

function canonicalWallKey(c1, r1, c2, r2) {
  if (c1 < c2 || (c1 === c2 && r1 < r2)) return `${c1},${r1}|${c2},${r2}`;
  return `${c2},${r2}|${c1},${r1}`;
}

export function getValidMoves(gameState, ship, maxMoves) {
  const { board, totalCols, totalRows, players } = gameState;
  const visited = new Set();
  const queue = [{ ...ship.position, cost: 0 }];
  const valid = [];
  const key = (c, r) => `${c},${r}`;

  // Build wall lookup set
  const wallSet = new Set((gameState.walls || []).map(
    w => canonicalWallKey(w.col1, w.row1, w.col2, w.row2)
  ));

  const occupied = new Set();
  for (const p of Object.values(players)) {
    for (const s of p.ships || []) {
      if (s.id !== ship.id) occupied.add(key(s.position.col, s.position.row));
    }
  }

  visited.add(key(ship.position.col, ship.position.row));

  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur.cost > 0) valid.push({ col: cur.col, row: cur.row });
    if (cur.cost >= maxMoves) continue;

    for (const [dc, dr] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const nc = cur.col + dc, nr = cur.row + dr;
      const k = key(nc, nr);
      if (nc < 0 || nc >= totalCols || nr < 0 || nr >= totalRows) continue;
      if (visited.has(k)) continue;
      const tile = board[nr][nc];
      if (tile.type !== 'sea' && tile.type !== 'port') continue;
      if (occupied.has(k)) continue;
      // Check for wall between current tile and neighbor
      if (wallSet.has(canonicalWallKey(cur.col, cur.row, nc, nr))) continue;
      visited.add(k);
      queue.push({ col: nc, row: nr, cost: cur.cost + 1 });
    }
  }

  return valid;
}
