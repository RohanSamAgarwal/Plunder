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
let _islandOutlines = null; // Map<islandId, { path, centerX, centerY }>

// ── Depth Map (BFS distance from land) ──────────────────────────
function computeDepthMap(board, totalCols, totalRows) {
  const depth = Array.from({ length: totalRows }, () => new Array(totalCols).fill(999));
  const queue = [];
  for (let r = 0; r < totalRows; r++) {
    for (let c = 0; c < totalCols; c++) {
      const t = board[r][c].type;
      if (t === 'island' || t === 'merchant' || t === 'normal_island' || t === 'port') {
        depth[r][c] = 0;
        queue.push([c, r]);
      }
    }
  }
  let head = 0;
  while (head < queue.length) {
    const [cx, cy] = queue[head++];
    const d = depth[cy][cx] + 1;
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx >= 0 && nx < totalCols && ny >= 0 && ny < totalRows && depth[ny][nx] > d) {
        depth[ny][nx] = d;
        queue.push([nx, ny]);
      }
    }
  }
  return depth;
}

// ── Island Outline (organic shape) ──────────────────────────────
function computeIslandOutline(tiles, ts, islandId, gp, padding = 0) {
  if (!tiles || tiles.length === 0) return null;

  const tileSet = new Set(tiles.map(t => `${t.col},${t.row}`));
  const pad = padding || ts * 0.08; // outward expansion for organic feel

  // Trace boundary edges: collect all tile-edge segments where one side is island, other isn't
  // Each edge is between two grid-corner points
  const edges = [];
  for (const t of tiles) {
    const { col, row } = t;
    // Check 4 neighbors — if absent, that edge is a boundary
    if (!tileSet.has(`${col},${row - 1}`)) // top edge
      edges.push({ x1: col, y1: row, x2: col + 1, y2: row, dir: 'T' });
    if (!tileSet.has(`${col},${row + 1}`)) // bottom edge
      edges.push({ x1: col + 1, y1: row + 1, x2: col, y2: row + 1, dir: 'B' });
    if (!tileSet.has(`${col - 1},${row}`)) // left edge
      edges.push({ x1: col, y1: row + 1, x2: col, y2: row, dir: 'L' });
    if (!tileSet.has(`${col + 1},${row}`)) // right edge
      edges.push({ x1: col + 1, y1: row, x2: col + 1, y2: row + 1, dir: 'R' });
  }

  if (edges.length === 0) return null;

  // Chain edges into ordered loop (each edge endpoint matches next edge startpoint)
  const edgeMap = new Map();
  for (const e of edges) {
    const key = `${e.x1},${e.y1}`;
    if (!edgeMap.has(key)) edgeMap.set(key, []);
    edgeMap.get(key).push(e);
  }

  const ordered = [edges[0]];
  const usedSet = new Set([0]);
  let current = ordered[0];

  for (let safety = 0; safety < edges.length + 5; safety++) {
    const endKey = `${current.x2},${current.y2}`;
    const candidates = edgeMap.get(endKey);
    if (!candidates) break;
    let found = false;
    for (const cand of candidates) {
      const idx = edges.indexOf(cand);
      if (!usedSet.has(idx)) {
        usedSet.add(idx);
        ordered.push(cand);
        current = cand;
        found = true;
        break;
      }
    }
    if (!found) break;
  }

  // Convert grid corners to pixel coords and compute center
  const points = ordered.map(e => ({
    x: gp + e.x1 * ts,
    y: gp + e.y1 * ts,
  }));

  const centerX = tiles.reduce((s, t) => s + gp + t.col * ts + ts / 2, 0) / tiles.length;
  const centerY = tiles.reduce((s, t) => s + gp + t.row * ts + ts / 2, 0) / tiles.length;

  // Merge colinear consecutive points (same x or same y)
  const merged = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = points[i];
    const next = points[(i + 1) % points.length];
    // Skip if prev→curr→next are colinear
    const dx1 = curr.x - prev.x, dy1 = curr.y - prev.y;
    const dx2 = next.x - curr.x, dy2 = next.y - curr.y;
    if (dx1 * dy2 - dy1 * dx2 !== 0) {
      merged.push(curr);
    }
  }

  // Apply corner rounding + wobble to create organic Path2D
  const seed = hashStr(islandId);
  const path = new Path2D();
  const n = merged.length;
  if (n < 3) {
    // Single tile or line - draw as rounded rect
    const minX = Math.min(...tiles.map(t => t.col));
    const minY = Math.min(...tiles.map(t => t.row));
    const maxX = Math.max(...tiles.map(t => t.col));
    const maxY = Math.max(...tiles.map(t => t.row));
    const rx = gp + minX * ts - pad;
    const ry = gp + minY * ts - pad;
    const rw = (maxX - minX + 1) * ts + pad * 2;
    const rh = (maxY - minY + 1) * ts + pad * 2;
    const rr = ts * 0.35;
    roundRectPath(path, rx, ry, rw, rh, rr);
    return { path, centerX, centerY };
  }

  // For each corner: offset outward from center, then apply Bezier rounding
  const cornerR = ts * 0.3;
  const wobbleAmt = ts * 0.06;

  for (let i = 0; i < n; i++) {
    const p = merged[i];
    const prev = merged[(i - 1 + n) % n];
    const next = merged[(i + 1) % n];

    // Direction vectors
    const dxIn = p.x - prev.x, dyIn = p.y - prev.y;
    const dxOut = next.x - p.x, dyOut = next.y - p.y;
    const lenIn = Math.sqrt(dxIn * dxIn + dyIn * dyIn) || 1;
    const lenOut = Math.sqrt(dxOut * dxOut + dyOut * dyOut) || 1;

    // Perpendicular outward (away from center)
    const mx = p.x - centerX, my = p.y - centerY;
    const mLen = Math.sqrt(mx * mx + my * my) || 1;
    const outX = mx / mLen, outY = my / mLen;

    // Deterministic wobble
    const w = ((seed * (i + 1) * 7 + i * 31) % 100) / 100 - 0.5;
    const wobX = outX * (pad + w * wobbleAmt);
    const wobY = outY * (pad + w * wobbleAmt);

    // Offset point
    const ox = p.x + wobX;
    const oy = p.y + wobY;

    // Rounding: use limited radius
    const r = Math.min(cornerR, lenIn * 0.4, lenOut * 0.4);

    // Points before and after corner
    const bx = ox - (dxIn / lenIn) * r;
    const by = oy - (dyIn / lenIn) * r;
    const ax = ox + (dxOut / lenOut) * r;
    const ay = oy + (dyOut / lenOut) * r;

    if (i === 0) {
      path.moveTo(bx, by);
    } else {
      path.lineTo(bx, by);
    }
    path.quadraticCurveTo(ox, oy, ax, ay);
  }
  path.closePath();

  return { path, centerX, centerY };
}

function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function roundRectPath(path, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  path.moveTo(x + r, y);
  path.lineTo(x + w - r, y);
  path.quadraticCurveTo(x + w, y, x + w, y + r);
  path.lineTo(x + w, y + h - r);
  path.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  path.lineTo(x + r, y + h);
  path.quadraticCurveTo(x, y + h, x, y + h - r);
  path.lineTo(x, y + r);
  path.quadraticCurveTo(x, y, x + r, y);
  path.closePath();
}

// ── Organic Island Drawing ──────────────────────────────────────
function drawShoreRing(ctx, outlinePath, ts) {
  ctx.save();
  // Outer shallow-water glow
  ctx.strokeStyle = 'rgba(100, 180, 210, 0.12)';
  ctx.lineWidth = ts * 0.4;
  ctx.lineJoin = 'round';
  ctx.stroke(outlinePath);
  // Inner shore wash
  ctx.strokeStyle = 'rgba(160, 210, 230, 0.18)';
  ctx.lineWidth = ts * 0.2;
  ctx.stroke(outlinePath);
  // Foam edge
  ctx.strokeStyle = 'rgba(220, 240, 255, 0.15)';
  ctx.lineWidth = ts * 0.08;
  ctx.stroke(outlinePath);
  ctx.restore();
}

function drawOrganicIsland(ctx, island, outline, ts, gp, islandSet) {
  if (!outline) return;
  const { path, centerX, centerY } = outline;
  const isMerchant = island.type === 'merchant';

  // Shore ring (on the water beneath)
  drawShoreRing(ctx, path, ts);

  // Beach fill
  ctx.fillStyle = isMerchant ? COLORS.merchantSand : COLORS.beachLight;
  ctx.fill(path);

  // Wet sand edge (stroke inside the path)
  ctx.save();
  ctx.clip(path);
  ctx.strokeStyle = isMerchant ? '#b09030' : COLORS.sandDark;
  ctx.lineWidth = ts * 0.14;
  ctx.stroke(path);

  // Inner vegetation
  const innerPad = -ts * 0.15;
  const innerOutline = computeIslandOutline(island.tiles, ts, island.id + '_inner', gp, innerPad);
  if (innerOutline) {
    const greenVar = isMerchant ? COLORS.merchantGreen : COLORS.green1;
    ctx.fillStyle = greenVar;
    ctx.fill(innerOutline.path);

    // Vegetation blobs
    for (const tile of island.tiles) {
      const tx = gp + tile.col * ts + ts / 2;
      const ty = gp + tile.row * ts + ts / 2;
      const blobSeed = tile.col * 7 + tile.row * 13;
      const blobCount = 3 + (blobSeed % 3);
      for (let b = 0; b < blobCount; b++) {
        const blobR = ts * 0.07 + ((blobSeed + b * 11) % 5) * ts * 0.012;
        const bx = tx + ((blobSeed + b * 19) % Math.round(ts * 0.5)) - ts * 0.25;
        const by = ty + ((blobSeed + b * 17) % Math.round(ts * 0.5)) - ts * 0.25;
        const bColor = b % 3 === 0 ? COLORS.greenDark : (b % 3 === 1 ? greenVar : COLORS.greenLight);
        ctx.fillStyle = bColor;
        ctx.beginPath();
        ctx.arc(bx, by, blobR, 0, Math.PI * 2);
        ctx.fill();
      }

      // Flowers
      const flowerSeed = tile.col * 23 + tile.row * 31;
      const flowerCount = 1 + (flowerSeed % 3);
      for (let f = 0; f < flowerCount; f++) {
        const fx = tx + ((flowerSeed + f * 29) % Math.round(ts * 0.4)) - ts * 0.2;
        const fy = ty + ((flowerSeed + f * 37) % Math.round(ts * 0.4)) - ts * 0.2;
        ctx.fillStyle = f % 2 === 0 ? COLORS.flowerRed : COLORS.flowerYellow;
        ctx.beginPath();
        ctx.arc(fx, fy, Math.max(1, ts * 0.018), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Palm trees on edge tiles
  if (ts >= 50) {
    for (const tile of island.tiles) {
      const k = `${tile.col},${tile.row}`;
      const hasWN = !islandSet.has(`${tile.col},${tile.row - 1}`);
      const hasWS = !islandSet.has(`${tile.col},${tile.row + 1}`);
      const hasWW = !islandSet.has(`${tile.col - 1},${tile.row}`);
      const hasWE = !islandSet.has(`${tile.col + 1},${tile.row}`);
      const isEdge = hasWN || hasWS || hasWW || hasWE;
      if (!isEdge) continue;
      const palmSeed = tile.col * 17 + tile.row * 29;
      const px0 = gp + tile.col * ts;
      const py0 = gp + tile.row * ts;
      let px, py;
      if (hasWN) { px = px0 + ts * 0.3 + (palmSeed % Math.round(ts * 0.4)); py = py0 + ts * 0.25; }
      else if (hasWS) { px = px0 + ts * 0.3 + (palmSeed % Math.round(ts * 0.4)); py = py0 + ts * 0.75; }
      else if (hasWW) { px = px0 + ts * 0.25; py = py0 + ts * 0.3 + (palmSeed % Math.round(ts * 0.4)); }
      else { px = px0 + ts * 0.75; py = py0 + ts * 0.3 + (palmSeed % Math.round(ts * 0.4)); }
      drawPalmTree(ctx, px, py, ts);
    }
  }

  // Merchant stall
  if (isMerchant) {
    drawMarketStall(ctx, centerX, centerY, ts);
  }

  ctx.restore(); // release clip

  // Subtle outline stroke
  ctx.strokeStyle = 'rgba(90, 70, 40, 0.3)';
  ctx.lineWidth = Math.max(1, ts * 0.02);
  ctx.stroke(path);
}

function computeBoardKey(board, totalCols, totalRows, walls) {
  // Simple hash of tile types + positions + walls for cache invalidation
  let hash = 0;
  for (let r = 0; r < totalRows; r++) {
    for (let c = 0; c < totalCols; c++) {
      const t = board[r][c];
      const typeVal = t.type.charCodeAt(0) + (t.type.charCodeAt(1) || 0);
      hash = ((hash << 5) - hash + typeVal + c * 31 + r * 37) | 0;
      // Include port shape in hash for cache invalidation
      if (t.portShape) {
        hash = ((hash << 5) - hash + t.portShape.charCodeAt(0) + c * 41 + r * 43) | 0;
      }
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

  // Pre-compute island neighbor set for shore blending (includes port tiles)
  const islandSet = new Set();
  for (let r = 0; r < totalRows; r++) {
    for (let c = 0; c < totalCols; c++) {
      const t = board[r][c];
      if (t.type === 'island' || t.type === 'merchant' || t.type === 'normal_island' || t.type === 'port') {
        islandSet.add(`${c},${r}`);
      }
    }
  }

  // Compute depth map for water color gradients
  const depthMap = computeDepthMap(board, totalCols, totalRows);

  // Compute organic island outlines (include port tile in each island's outline)
  _islandOutlines = new Map();
  for (const [id, island] of Object.entries(islands)) {
    if (island.type === 'obstacle') continue;
    if (!island.tiles || island.tiles.length === 0) continue;
    // Expand tile set to include port tile so the outline encompasses the harbor
    const expandedTiles = [...island.tiles];
    if (island.port) {
      expandedTiles.push({ col: island.port.col, row: island.port.row });
    }
    const outline = computeIslandOutline(expandedTiles, ts, id, gp);
    if (outline) _islandOutlines.set(id, outline);
  }

  // Draw tiles — skip island/merchant tiles (drawn organically below)
  for (let r = 0; r < totalRows; r++) {
    for (let c = 0; c < totalCols; c++) {
      const tile = board[r][c];
      const x = gp + c * ts;
      const y = gp + r * ts;

      switch (tile.type) {
        case 'sea':
          drawSeaTile(ctx, x, y, c, r, ts, islandSet, depthMap);
          break;
        case 'island':
        case 'merchant':
          // Draw sea underneath (organic island shape drawn later on top)
          drawSeaTile(ctx, x, y, c, r, ts, islandSet, depthMap);
          break;
        case 'port':
          // Draw sea underneath — organic island shape + harbor cove drawn later
          drawSeaTile(ctx, x, y, c, r, ts, islandSet, depthMap);
          break;
        case 'normal_island':
          drawRockTile(ctx, x, y, c, r, ts, islandSet, tile);
          break;
        case 'land_barrier':
          drawLandBarrier(ctx, x, y, ts);
          break;
        default:
          drawSeaTile(ctx, x, y, c, r, ts, islandSet, depthMap);
      }

      // Subtle grid lines — only on water, very faint dashed
      if (tile.type === 'sea') {
        ctx.strokeStyle = 'rgba(100, 150, 180, 0.04)';
        ctx.lineWidth = 0.3;
        ctx.setLineDash([ts * 0.12, ts * 0.18]);
        ctx.strokeRect(x, y, ts, ts);
        ctx.setLineDash([]);
      }
    }
  }

  // Draw organic island shapes on top of sea
  for (const [id, island] of Object.entries(islands)) {
    if (island.type === 'obstacle') continue;
    const outline = _islandOutlines.get(id);
    if (outline) drawOrganicIsland(ctx, island, outline, ts, gp, islandSet);
  }

  // Carve harbor coves into port tiles (after organic islands are drawn)
  for (const [id, island] of Object.entries(islands)) {
    if (island.type === 'obstacle') continue;
    if (island.port && island.port.openSides) {
      drawHarborCove(ctx, island, ts, gp, board);
    }
  }

  // Wall barriers between tiles
  drawWalls(ctx, gameState, ts, gp);

  // Island decorations — positioned at tile closest to island center
  for (const [id, island] of Object.entries(islands)) {
    if (island.type === 'obstacle' || !island.skulls) continue;
    const outline = _islandOutlines.get(id);
    if (!outline) continue;
    if (!island.tiles || island.tiles.length === 0) continue;

    const { centerX, centerY } = outline;

    // Find the actual island tile closest to the computed center
    let bestTile = island.tiles[0];
    let bestDist = Infinity;
    for (const t of island.tiles) {
      const tx = gp + t.col * ts + ts / 2;
      const ty = gp + t.row * ts + ts / 2;
      const d = (tx - centerX) ** 2 + (ty - centerY) ** 2;
      if (d < bestDist) { bestDist = d; bestTile = t; }
    }
    // Center of the closest tile
    const tileCX = gp + bestTile.col * ts + ts / 2;
    const tileCY = gp + bestTile.row * ts + ts / 2;

    drawSkullBadge(ctx, tileCX, tileCY, island.skulls, ts);

    if (island.owner && players[island.owner]) {
      drawOwnerFlag(ctx, tileCX + ts * 0.35, tileCY - ts * 0.35, SHIP_COLORS[players[island.owner].color], ts);
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

  // Selected island highlight — use organic outline if available
  if (selectedIsland && islands[selectedIsland]) {
    const outline = _islandOutlines?.get(selectedIsland);
    if (outline) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 215, 0, 0.7)';
      ctx.lineWidth = ts * 0.06;
      ctx.shadowColor = '#ffd700';
      ctx.shadowBlur = ts * 0.2;
      ctx.stroke(outline.path);
      ctx.shadowBlur = 0;
      // Inner bright stroke
      ctx.strokeStyle = 'rgba(255, 235, 100, 0.5)';
      ctx.lineWidth = ts * 0.03;
      ctx.stroke(outline.path);
      ctx.restore();
    } else {
      // Fallback for islands without outlines
      const isl = islands[selectedIsland];
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 3;
      for (const t of isl.tiles) {
        ctx.strokeRect(gp + t.col * ts + 1, gp + t.row * ts + 1, ts - 2, ts - 2);
      }
    }
  }
}

// ── Tile Renderers ─────────────────────────────────────────────

function drawSeaTile(ctx, x, y, col, row, ts, islandSet, depthMap) {
  // Depth-aware base: smooth gradient from shallow to deep
  const dist = depthMap ? depthMap[row]?.[col] ?? 4 : 4;

  let base;
  if (dist <= 1) {
    base = '#1f6a8a'; // shallow — bright blue-green
  } else if (dist === 2) {
    base = '#1a5878'; // medium shallow
  } else if (dist === 3) {
    base = (row + col) % 2 === 0 ? '#184d6e' : '#164563';
  } else {
    base = (row + col) % 2 === 0 ? COLORS.sea1 : COLORS.sea2;
  }
  ctx.fillStyle = base;
  ctx.fillRect(x, y, ts, ts);

  // Depth gradient overlay — darker in deep water
  if (dist >= 3) {
    const grad = ctx.createRadialGradient(x + ts * 0.4, y + ts * 0.4, 0, x + ts / 2, y + ts / 2, ts * 0.9);
    grad.addColorStop(0, 'rgba(15, 45, 69, 0.15)');
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, ts, ts);
  } else if (dist <= 1) {
    // Bright shallow shimmer
    const grad = ctx.createRadialGradient(x + ts / 2, y + ts / 2, ts * 0.1, x + ts / 2, y + ts / 2, ts * 0.7);
    grad.addColorStop(0, 'rgba(40, 130, 170, 0.10)');
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, ts, ts);
  }

  // Wave lines (5 per tile with varied amplitude)
  const seed = (col * 7 + row * 13) % 17;
  const waveAlphaScale = dist <= 1 ? 0.6 : 1.0; // softer waves near shore
  for (let i = 0; i < 5; i++) {
    const waveOpacity = (0.05 + (i % 3) * 0.02) * waveAlphaScale;
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

  // Caustic light spots (2-3 per tile, brighter in shallow water)
  const causticCount = 2 + (seed % 2);
  const causticAlpha = dist <= 2 ? 0.08 : 0.06;
  for (let i = 0; i < causticCount; i++) {
    const cx = x + ((seed * 11 + i * 31) % Math.round(ts * 0.7)) + ts * 0.15;
    const cy = y + ((seed * 17 + i * 23) % Math.round(ts * 0.7)) + ts * 0.15;
    const cr = ts * 0.03 + (i % 2) * ts * 0.02;
    ctx.fillStyle = `rgba(80, 200, 240, ${causticAlpha})`;
    ctx.beginPath();
    ctx.arc(cx, cy, cr, 0, Math.PI * 2);
    ctx.fill();
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

// ── Harbor Cove Rendering ─────────────────────────────────────

function drawHarborCove(ctx, island, ts, gp, board) {
  const port = island.port;
  if (!port || !port.openSides) return;

  const px = gp + port.col * ts;
  const py = gp + port.row * ts;
  const openSides = port.openSides;
  const inset = ts * 0.18; // land border thickness on blocked sides
  const cornerR = ts * 0.12;

  // Determine harbor water bounds — start inset, extend to tile edge on open sides
  let left = px + inset;
  let right = px + ts - inset;
  let top = py + inset;
  let bottom = py + ts - inset;

  if (openSides.includes('N')) top = py - ts * 0.02;
  if (openSides.includes('S')) bottom = py + ts + ts * 0.02;
  if (openSides.includes('W')) left = px - ts * 0.02;
  if (openSides.includes('E')) right = px + ts + ts * 0.02;

  ctx.save();

  // Harbor water fill with rounded corners
  const harborPath = new Path2D();
  roundRectPath(harborPath, left, top, right - left, bottom - top, cornerR);
  ctx.fillStyle = COLORS.portWater;
  ctx.fill(harborPath);

  // Subtle water ripples inside harbor
  ctx.strokeStyle = 'rgba(60,140,180,0.08)';
  ctx.lineWidth = 0.8;
  const rippleDir = (right - left) > (bottom - top); // horizontal if wider
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    if (rippleDir) {
      const ry = top + (bottom - top) * (0.2 + i * 0.25);
      ctx.moveTo(left + 3, ry);
      ctx.quadraticCurveTo((left + right) / 2, ry - ts * 0.015, right - 3, ry);
    } else {
      const rx = left + (right - left) * (0.2 + i * 0.25);
      ctx.moveTo(rx, top + 3);
      ctx.quadraticCurveTo(rx - ts * 0.015, (top + bottom) / 2, rx, bottom - 3);
    }
    ctx.stroke();
  }

  // Beach/foam edges where harbor water meets island land (blocked sides)
  ctx.lineWidth = Math.max(1, ts * 0.03);
  if (!openSides.includes('N') && top > py) {
    ctx.strokeStyle = 'rgba(220, 200, 160, 0.5)';
    ctx.beginPath(); ctx.moveTo(left + cornerR, top); ctx.lineTo(right - cornerR, top); ctx.stroke();
  }
  if (!openSides.includes('S') && bottom < py + ts) {
    ctx.strokeStyle = 'rgba(220, 200, 160, 0.5)';
    ctx.beginPath(); ctx.moveTo(left + cornerR, bottom); ctx.lineTo(right - cornerR, bottom); ctx.stroke();
  }
  if (!openSides.includes('W') && left > px) {
    ctx.strokeStyle = 'rgba(220, 200, 160, 0.5)';
    ctx.beginPath(); ctx.moveTo(left, top + cornerR); ctx.lineTo(left, bottom - cornerR); ctx.stroke();
  }
  if (!openSides.includes('E') && right < px + ts) {
    ctx.strokeStyle = 'rgba(220, 200, 160, 0.5)';
    ctx.beginPath(); ctx.moveTo(right, top + cornerR); ctx.lineTo(right, bottom - cornerR); ctx.stroke();
  }

  // Draw dock/pier inside the harbor (on the island-facing side)
  drawHarborDock(ctx, left, top, right, bottom, openSides, ts);

  // Draw anchor icon in the harbor water
  const anchorCX = (left + right) / 2;
  const anchorCY = (top + bottom) / 2;
  drawHarborAnchor(ctx, anchorCX, anchorCY, Math.min(right - left, bottom - top) * 0.45);

  ctx.restore();
}

function drawHarborDock(ctx, left, top, right, bottom, openSides, ts) {
  const hW = right - left;
  const hH = bottom - top;

  // Find a blocked (island-facing) side to place the dock against
  let dockX, dockY, dockW, dockH;
  const plankColor1 = COLORS.portDock;
  const plankColor2 = COLORS.plankDark;

  if (!openSides.includes('N') && top > 0) {
    // Dock on north side (top), extending downward
    dockW = Math.min(hW * 0.5, ts * 0.35);
    dockH = Math.min(hH * 0.22, ts * 0.14);
    dockX = left + (hW - dockW) / 2;
    dockY = top;
  } else if (!openSides.includes('S')) {
    dockW = Math.min(hW * 0.5, ts * 0.35);
    dockH = Math.min(hH * 0.22, ts * 0.14);
    dockX = left + (hW - dockW) / 2;
    dockY = bottom - dockH;
  } else if (!openSides.includes('W')) {
    dockW = Math.min(hW * 0.22, ts * 0.14);
    dockH = Math.min(hH * 0.5, ts * 0.35);
    dockX = left;
    dockY = top + (hH - dockH) / 2;
  } else if (!openSides.includes('E')) {
    dockW = Math.min(hW * 0.22, ts * 0.14);
    dockH = Math.min(hH * 0.5, ts * 0.35);
    dockX = right - dockW;
    dockY = top + (hH - dockH) / 2;
  } else {
    // All sides open — small dock in center
    dockW = ts * 0.18;
    dockH = ts * 0.18;
    dockX = left + (hW - dockW) / 2;
    dockY = top + (hH - dockH) / 2;
  }

  // Draw planks
  ctx.fillStyle = plankColor1;
  ctx.fillRect(dockX, dockY, dockW, dockH);

  // Plank grain lines
  ctx.strokeStyle = 'rgba(90,70,40,0.3)';
  ctx.lineWidth = 0.5;
  const isHoriz = dockW > dockH;
  if (isHoriz) {
    for (let i = 1; i <= 2; i++) {
      const ly = dockY + (dockH / 3) * i;
      ctx.beginPath(); ctx.moveTo(dockX + 1, ly); ctx.lineTo(dockX + dockW - 1, ly); ctx.stroke();
    }
  } else {
    for (let i = 1; i <= 2; i++) {
      const lx = dockX + (dockW / 3) * i;
      ctx.beginPath(); ctx.moveTo(lx, dockY + 1); ctx.lineTo(lx, dockY + dockH - 1); ctx.stroke();
    }
  }

  // Mooring posts at dock ends
  const postSz = Math.max(2, ts * 0.03);
  ctx.fillStyle = COLORS.portDockLight;
  if (isHoriz) {
    ctx.fillRect(dockX - postSz / 2, dockY + dockH / 2 - postSz / 2, postSz, postSz);
    ctx.fillRect(dockX + dockW - postSz / 2, dockY + dockH / 2 - postSz / 2, postSz, postSz);
  } else {
    ctx.fillRect(dockX + dockW / 2 - postSz / 2, dockY - postSz / 2, postSz, postSz);
    ctx.fillRect(dockX + dockW / 2 - postSz / 2, dockY + dockH - postSz / 2, postSz, postSz);
  }
}

function drawHarborAnchor(ctx, cx, cy, size) {
  if (size < 6) return; // too small to render
  ctx.strokeStyle = 'rgba(154, 176, 192, 0.5)';
  ctx.lineWidth = Math.max(1, size * 0.07);
  ctx.lineCap = 'round';
  const s = size * 0.5;
  // Ring
  ctx.beginPath();
  ctx.arc(cx, cy - s * 0.32, s * 0.08, 0, Math.PI * 2);
  ctx.stroke();
  // Shaft
  ctx.beginPath();
  ctx.moveTo(cx, cy - s * 0.24);
  ctx.lineTo(cx, cy + s * 0.25);
  ctx.stroke();
  // Crossbar
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.2, cy - s * 0.1);
  ctx.lineTo(cx + s * 0.2, cy - s * 0.1);
  ctx.stroke();
  // Fluke
  ctx.beginPath();
  ctx.arc(cx, cy + s * 0.1, s * 0.2, 0, Math.PI);
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

function drawSkullBadge(ctx, tileCX, tileCY, skulls, ts) {
  // All skulls must fit within one tile, centered horizontally and vertically
  // Scale skull size based on count so they always fit within ts width
  const maxWidth = ts * 0.85; // usable width within one tile
  const skullSize = Math.round(Math.min(ts * 0.34, maxWidth / skulls * 0.85));
  const spacing = Math.round(Math.min(ts * 0.36, maxWidth / skulls));
  const totalW = (skulls - 1) * spacing; // distance from first to last skull center

  // Center the row of skulls at the tile center
  const startX = tileCX - totalW / 2;

  for (let i = 0; i < skulls; i++) {
    drawSkullIcon(ctx, startX + i * spacing, tileCY, skullSize);
  }
}

function drawSkullIcon(ctx, cx, cy, size) {
  const s = size;
  const lw = Math.max(1.2, s * 0.06);

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Drop shadow for readability on any background
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = s * 0.12;
  ctx.shadowOffsetY = s * 0.03;

  // ── Head (very round) ──
  const headR = s * 0.36;
  const headY = cy - s * 0.05;
  ctx.fillStyle = '#ede6d6';
  ctx.strokeStyle = '#2a1f14';
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.arc(cx, headY, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // ── Jaw (rounded trapezoid, overlaps bottom of head) ──
  ctx.shadowColor = 'transparent'; // no double shadow
  const jawTop = headY + headR * 0.55;
  const jawBot = headY + headR * 1.25;
  const jawWTop = headR * 0.75;
  const jawWBot = headR * 0.5;
  ctx.fillStyle = '#ede6d6';
  ctx.beginPath();
  ctx.moveTo(cx - jawWTop, jawTop);
  ctx.quadraticCurveTo(cx - jawWBot * 1.1, jawBot, cx, jawBot + s * 0.02);
  ctx.quadraticCurveTo(cx + jawWBot * 1.1, jawBot, cx + jawWTop, jawTop);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#2a1f14';
  ctx.lineWidth = lw;
  ctx.stroke();

  // Cover the line between head and jaw (fill over the seam)
  ctx.fillStyle = '#ede6d6';
  ctx.beginPath();
  ctx.arc(cx, headY, headR - lw * 0.6, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.closePath();
  ctx.fill();

  // ── Eyes (large circles) ──
  const eyeR = s * 0.1;
  const eyeY = headY - s * 0.02;
  const eyeSpread = s * 0.15;
  ctx.fillStyle = '#2a1f14';
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(cx + dir * eyeSpread, eyeY, eyeR, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── Nose (small upward-pointing dot/triangle) ──
  const noseY = headY + s * 0.1;
  ctx.beginPath();
  ctx.arc(cx, noseY, s * 0.04, 0, Math.PI * 2);
  ctx.fill();

  // ── Smile (curved line) ──
  ctx.strokeStyle = '#2a1f14';
  ctx.lineWidth = Math.max(1, s * 0.04);
  const smileY = headY + s * 0.2;
  const smileW = s * 0.16;
  ctx.beginPath();
  ctx.moveTo(cx - smileW, smileY);
  ctx.quadraticCurveTo(cx, smileY + s * 0.08, cx + smileW, smileY);
  ctx.stroke();

  ctx.restore();
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
      // Check port approach direction restriction (entry only)
      if (tile.type === 'port' && tile.openSides) {
        let approachDir;
        if (dr === -1) approachDir = 'S';
        if (dr === 1) approachDir = 'N';
        if (dc === -1) approachDir = 'E';
        if (dc === 1) approachDir = 'W';
        if (!tile.openSides.includes(approachDir)) continue;
      }
      visited.add(k);
      queue.push({ col: nc, row: nr, cost: cur.cost + 1 });
    }
  }

  return valid;
}
