// Canvas-based board renderer for Plunder: A Pirate's Life
// Draws organic islands with vegetation, sandy shores, and ocean waves
// Dynamically sized for any viewport — targets ~80px tiles at 1920×1080

const COLORS = {
  // Ocean
  sea1: '#1a4a6b',
  sea2: '#174060',
  seaDeep: '#123550',
  shallowSea: '#1f5a7d',
  // Islands
  sand: '#d4b067',
  sandDark: '#b8963a',
  sandWet: '#a08540',
  green1: '#4a8c3f',
  green2: '#3d7a34',
  greenDark: '#2d5c26',
  greenLight: '#5aad4a',
  // Merchant
  merchantSand: '#c9a84c',
  merchantGreen: '#5a9944',
  // Obstacles / normal islands
  rock: '#6b6b5a',
  rockDark: '#4a4a3d',
  rockLight: '#7d7d6a',
  // Port
  portWater: '#1e5570',
  portDock: '#8b7355',
  portDockLight: '#a08a66',
  // Storm
  stormDark: 'rgba(40, 15, 70, 0.35)',
  stormLight: 'rgba(60, 25, 100, 0.2)',
  stormBorder: '#8b5cf6',
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
          drawRockTile(ctx, x, y, c, r, ts, islandSet);
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

      // Valid move highlights
      if (validMoves?.some(m => m.col === c && m.row === r)) {
        ctx.fillStyle = COLORS.moveHighlight;
        ctx.fillRect(x, y, ts, ts);
        ctx.strokeStyle = COLORS.moveBorder;
        ctx.lineWidth = 2;
        ctx.setLineDash([ts * 0.08, ts * 0.08]);
        ctx.strokeRect(x + 1, y + 1, ts - 2, ts - 2);
        ctx.setLineDash([]);
      }

      // Hover
      if (hoveredTile?.col === c && hoveredTile?.row === r) {
        ctx.fillStyle = COLORS.highlight;
        ctx.fillRect(x, y, ts, ts);
      }
    }
  }

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

  // Board edge vignette
  drawBoardEdge(ctx, canvas.width, canvas.height, gp);
}

// ── Tile Renderers ─────────────────────────────────────────────

function drawSeaTile(ctx, x, y, col, row, ts, islandSet) {
  // Gradient base for depth variation
  const base = (row + col) % 2 === 0 ? COLORS.sea1 : COLORS.sea2;
  ctx.fillStyle = base;
  ctx.fillRect(x, y, ts, ts);

  // Subtle radial depth
  const grad = ctx.createRadialGradient(x + ts * 0.4, y + ts * 0.4, 0, x + ts / 2, y + ts / 2, ts * 0.9);
  grad.addColorStop(0, 'rgba(30, 90, 130, 0.12)');
  grad.addColorStop(1, 'transparent');
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, ts, ts);

  // Wave lines (3 per tile)
  ctx.strokeStyle = 'rgba(100, 180, 220, 0.06)';
  ctx.lineWidth = 1;
  const seed = (col * 7 + row * 13) % 17;
  for (let i = 0; i < 3; i++) {
    const waveY = y + ts * 0.15 + i * ts * 0.28 + (seed % 5);
    const amp = ts * 0.035;
    ctx.beginPath();
    ctx.moveTo(x, waveY);
    ctx.quadraticCurveTo(x + ts * 0.25, waveY - amp, x + ts * 0.5, waveY);
    ctx.quadraticCurveTo(x + ts * 0.75, waveY + amp, x + ts, waveY);
    ctx.stroke();
  }

  // Shore wash on tiles adjacent to land
  drawShoreWash(ctx, x, y, col, row, ts, islandSet);
}

function drawShoreWash(ctx, x, y, col, row, ts, islandSet) {
  const shoreW = Math.round(ts * 0.12);
  const shoreColor = 'rgba(160, 200, 220, 0.08)';
  if (islandSet.has(`${col},${row - 1}`)) {
    const g = ctx.createLinearGradient(x, y, x, y + shoreW);
    g.addColorStop(0, shoreColor);
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, ts, shoreW);
  }
  if (islandSet.has(`${col},${row + 1}`)) {
    const g = ctx.createLinearGradient(x, y + ts, x, y + ts - shoreW);
    g.addColorStop(0, shoreColor);
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.fillRect(x, y + ts - shoreW, ts, shoreW);
  }
  if (islandSet.has(`${col - 1},${row}`)) {
    const g = ctx.createLinearGradient(x, y, x + shoreW, y);
    g.addColorStop(0, shoreColor);
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, shoreW, ts);
  }
  if (islandSet.has(`${col + 1},${row}`)) {
    const g = ctx.createLinearGradient(x + ts, y, x + ts - shoreW, y);
    g.addColorStop(0, shoreColor);
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.fillRect(x + ts - shoreW, y, shoreW, ts);
  }
}

function drawIslandTile(ctx, x, y, col, row, ts, islandSet) {
  // Sandy shore base
  ctx.fillStyle = COLORS.sand;
  ctx.fillRect(x, y, ts, ts);

  // Water-neighbor detection for organic vegetation edges
  const hasWN = !islandSet.has(`${col},${row - 1}`);
  const hasWS = !islandSet.has(`${col},${row + 1}`);
  const hasWW = !islandSet.has(`${col - 1},${row}`);
  const hasWE = !islandSet.has(`${col + 1},${row}`);

  const inset = Math.round(ts * 0.1);
  const gx = x + (hasWW ? inset + 2 : 0);
  const gy = y + (hasWN ? inset + 2 : 0);
  const gw = ts - (hasWW ? inset + 2 : 0) - (hasWE ? inset + 2 : 0);
  const gh = ts - (hasWN ? inset + 2 : 0) - (hasWS ? inset + 2 : 0);

  if (gw > 4 && gh > 4) {
    // Main vegetation layer
    const greenVar = ((col * 7 + row * 13) % 3 === 0) ? COLORS.green2 : COLORS.green1;
    ctx.fillStyle = greenVar;
    roundRect(ctx, gx, gy, gw, gh, Math.round(ts * 0.06));
    ctx.fill();

    // Darker vegetation patches
    ctx.fillStyle = COLORS.greenDark;
    const spotCount = 2 + ((col * 3 + row * 7) % 3);
    for (let s = 0; s < spotCount; s++) {
      const sx = gx + ((col * 11 + s * 17) % Math.max(gw - 8, 1)) + 4;
      const sy = gy + ((row * 13 + s * 23) % Math.max(gh - 8, 1)) + 4;
      const sr = ts * 0.05 + (s % 2) * ts * 0.02;
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fill();
    }

    // Tree canopy highlights
    ctx.fillStyle = COLORS.greenLight;
    for (let t = 0; t < 3; t++) {
      const tx = gx + ((col * 7 + t * 19 + row) % Math.max(gw - 6, 1)) + 3;
      const ty = gy + ((row * 11 + t * 13 + col) % Math.max(gh - 6, 1)) + 3;
      ctx.beginPath();
      ctx.arc(tx, ty, ts * 0.03, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Shore edge gradients (sandy to water)
  const shoreW = Math.round(ts * 0.1);
  if (hasWN) {
    const g = ctx.createLinearGradient(x, y, x, y + shoreW);
    g.addColorStop(0, COLORS.sandDark);
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, ts, shoreW);
  }
  if (hasWS) {
    const g = ctx.createLinearGradient(x, y + ts, x, y + ts - shoreW);
    g.addColorStop(0, COLORS.sandDark);
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.fillRect(x, y + ts - shoreW, ts, shoreW);
  }
  if (hasWW) {
    const g = ctx.createLinearGradient(x, y, x + shoreW, y);
    g.addColorStop(0, COLORS.sandDark);
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, shoreW, ts);
  }
  if (hasWE) {
    const g = ctx.createLinearGradient(x + ts, y, x + ts - shoreW, y);
    g.addColorStop(0, COLORS.sandDark);
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.fillRect(x + ts - shoreW, y, shoreW, ts);
  }
}

function drawMerchantTile(ctx, x, y, col, row, ts, islandSet) {
  ctx.fillStyle = COLORS.merchantSand;
  ctx.fillRect(x, y, ts, ts);

  const inset = Math.round(ts * 0.1);
  ctx.fillStyle = COLORS.merchantGreen;
  roundRect(ctx, x + inset, y + inset, ts - inset * 2, ts - inset * 2, Math.round(ts * 0.06));
  ctx.fill();

  // Drawn barrel icon (replaces emoji)
  drawBarrelIcon(ctx, x + ts / 2, y + ts / 2, ts * 0.5);
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

  // Dock planks
  const plankW = Math.round(ts * 0.4);
  const plankH = Math.max(3, Math.round(ts * 0.06));
  ctx.fillStyle = COLORS.portDock;
  ctx.fillRect(x + ts / 2 - plankW / 2, y + ts - plankH * 3, plankW, plankH);
  ctx.fillStyle = COLORS.portDockLight;
  ctx.fillRect(x + ts / 2 - plankW * 0.3, y + ts - plankH * 5, plankW * 0.6, plankH);
  // Wood grain lines
  ctx.strokeStyle = 'rgba(90, 70, 40, 0.3)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(x + ts / 2 - plankW / 2 + 2, y + ts - plankH * 3 + plankH / 2);
  ctx.lineTo(x + ts / 2 + plankW / 2 - 2, y + ts - plankH * 3 + plankH / 2);
  ctx.stroke();

  // Drawn anchor icon (replaces emoji)
  drawAnchorIcon(ctx, x + ts / 2, y + ts * 0.4, ts * 0.4);
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

function drawRockTile(ctx, x, y, col, row, ts, islandSet) {
  ctx.fillStyle = COLORS.rock;
  ctx.fillRect(x, y, ts, ts);

  // Rocky texture spots
  ctx.fillStyle = COLORS.rockDark;
  const seed1 = (col * 17 + row * 11) % 15;
  const seed2 = (col * 23 + row * 7) % 12;
  ctx.beginPath();
  ctx.arc(x + ts * 0.25 + seed1 % (ts * 0.2), y + ts * 0.3 + seed2 % (ts * 0.2), ts * 0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + ts * 0.6 + (seed2 % (ts * 0.15)), y + ts * 0.55 + (seed1 % (ts * 0.15)), ts * 0.06, 0, Math.PI * 2);
  ctx.fill();

  // Light highlights
  ctx.fillStyle = COLORS.rockLight;
  ctx.beginPath();
  ctx.arc(x + ts * 0.45, y + ts * 0.2, ts * 0.04, 0, Math.PI * 2);
  ctx.fill();
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

    // Cloud puffs
    ctx.fillStyle = 'rgba(40, 20, 60, 0.12)';
    const seed = t.col * 7 + t.row * 13;
    for (let i = 0; i < 3; i++) {
      const cx = x + ((seed + i * 17) % Math.round(ts * 0.7)) + ts * 0.15;
      const cy = y + ((seed + i * 23) % Math.round(ts * 0.7)) + ts * 0.15;
      ctx.beginPath();
      ctx.arc(cx, cy, ts * 0.18 + (i % 2) * ts * 0.08, 0, Math.PI * 2);
      ctx.fill();
    }

    // Lightning bolt on some tiles
    if ((t.col + t.row) % 3 === 0) {
      drawLightningBolt(ctx, x + ts * 0.3, y + ts * 0.1, x + ts * 0.55, y + ts * 0.85, ts);
    }
  }

  // Dashed border
  const minC = Math.min(...storm.tiles.map(t => t.col));
  const maxC = Math.max(...storm.tiles.map(t => t.col));
  const minR = Math.min(...storm.tiles.map(t => t.row));
  const maxR = Math.max(...storm.tiles.map(t => t.row));
  ctx.strokeStyle = COLORS.stormBorder;
  ctx.lineWidth = 2;
  ctx.setLineDash([ts * 0.1, ts * 0.1]);
  ctx.strokeRect(gp + minC * ts, gp + minR * ts, (maxC - minC + 1) * ts, (maxR - minR + 1) * ts);
  ctx.setLineDash([]);

  // Lightning icon at storm center
  const cx = gp + storm.center.col * ts + ts / 2;
  const cy = gp + storm.center.row * ts + ts / 2;
  drawLightningIcon(ctx, cx, cy, ts * 0.5);
}

function drawLightningBolt(ctx, x1, y1, x2, y2, ts) {
  ctx.strokeStyle = 'rgba(180, 150, 255, 0.2)';
  ctx.lineWidth = Math.max(1, ts * 0.02);
  const midX = (x1 + x2) / 2 + ts * 0.06;
  const midY = (y1 + y2) / 2;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(midX - ts * 0.04, midY);
  ctx.lineTo(midX + ts * 0.04, midY + ts * 0.02);
  ctx.lineTo(x2, y2);
  ctx.stroke();
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

// ── Board Edge Vignette ────────────────────────────────────────

function drawBoardEdge(ctx, canvasW, canvasH, gp) {
  const edgeSize = Math.round(gp * 0.6);
  // Top
  let g = ctx.createLinearGradient(0, 0, 0, edgeSize);
  g.addColorStop(0, 'rgba(10, 30, 42, 0.7)');
  g.addColorStop(1, 'transparent');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvasW, edgeSize);
  // Bottom
  g = ctx.createLinearGradient(0, canvasH, 0, canvasH - edgeSize);
  g.addColorStop(0, 'rgba(10, 30, 42, 0.7)');
  g.addColorStop(1, 'transparent');
  ctx.fillStyle = g;
  ctx.fillRect(0, canvasH - edgeSize, canvasW, edgeSize);
  // Left
  g = ctx.createLinearGradient(0, 0, edgeSize, 0);
  g.addColorStop(0, 'rgba(10, 30, 42, 0.7)');
  g.addColorStop(1, 'transparent');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, edgeSize, canvasH);
  // Right
  g = ctx.createLinearGradient(canvasW, 0, canvasW - edgeSize, 0);
  g.addColorStop(0, 'rgba(10, 30, 42, 0.7)');
  g.addColorStop(1, 'transparent');
  ctx.fillStyle = g;
  ctx.fillRect(canvasW - edgeSize, 0, edgeSize, canvasH);
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

export function getValidMoves(gameState, ship, maxMoves) {
  const { board, totalCols, totalRows, players } = gameState;
  const visited = new Set();
  const queue = [{ ...ship.position, cost: 0 }];
  const valid = [];
  const key = (c, r) => `${c},${r}`;

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
      visited.add(k);
      queue.push({ col: nc, row: nr, cost: cur.cost + 1 });
    }
  }

  return valid;
}
