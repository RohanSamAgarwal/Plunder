import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useSocketContext } from '../../App';
import { drawBoard, canvasToGrid, getValidMoves, calculateLayout } from '../../game/renderer';
import ActionPanel from './ActionPanel';
import ChatLog from './ChatLog';

const SIDEBAR_W = 400;
const TOP_BAR_H = 52;

const EVENTS = {
  PICK_STARTING_ISLAND: 'pick-starting-island',
  DRAW_RESOURCES: 'draw-resources',
  ROLL_SAILING_DIE: 'roll-sailing-die',
  MOVE_SHIP: 'move-ship',
  BUILD: 'build',
  ATTACK_ISLAND: 'attack-island',
  ATTACK_SHIP: 'attack-ship',
  END_TURN: 'end-turn',
  PROPOSE_TRADE: 'propose-trade',
  RESPOND_TRADE: 'respond-trade',
  COLLECT_TREASURE: 'collect-treasure',
};

export default function GameView({ gameState, playerInfo, messages, pendingTrade, pendingTreaty, roomCode }) {
  const { emit } = useSocketContext();
  const canvasRef = useRef(null);
  const [selectedShip, setSelectedShip] = useState(null);
  const [hoveredTile, setHoveredTile] = useState(null);
  const [validMoves, setValidMoves] = useState([]);
  const [notification, setNotification] = useState('');
  const [treasuresFound, setTreasuresFound] = useState([]);

  // Dynamic layout calculation
  const [layout, setLayout] = useState(() =>
    calculateLayout(window.innerWidth, window.innerHeight, SIDEBAR_W, TOP_BAR_H)
  );

  useEffect(() => {
    function onResize() {
      setLayout(calculateLayout(window.innerWidth, window.innerHeight, SIDEBAR_W, TOP_BAR_H));
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const myId = playerInfo?.playerId;
  const currentPlayerId = gameState?.currentPlayerId;
  const isMyTurn = currentPlayerId === myId;
  const turnPhase = gameState?.turnPhase;
  const phase = gameState?.phase;
  const myPlayer = gameState?.players?.[myId];

  // Canvas dimensions
  const canvasW = useMemo(() => {
    if (!gameState) return 800;
    return gameState.totalCols * layout.tileSize + layout.gridPad * 2;
  }, [gameState?.totalCols, layout]);

  const canvasH = useMemo(() => {
    if (!gameState) return 600;
    return gameState.totalRows * layout.tileSize + layout.gridPad * 2;
  }, [gameState?.totalRows, layout]);

  // Redraw board whenever state changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !gameState) return;
    const ctx = canvas.getContext('2d');
    drawBoard(ctx, canvas, gameState, {
      selectedShip,
      hoveredTile,
      validMoves,
    }, layout);
  }, [gameState, selectedShip, hoveredTile, validMoves, layout]);

  // Update valid moves when ship selected
  useEffect(() => {
    if (selectedShip && gameState && isMyTurn && turnPhase === 'perform_actions') {
      const moves = getValidMoves(gameState, selectedShip, gameState.movePointsRemaining);
      setValidMoves(moves);
    } else {
      setValidMoves([]);
    }
  }, [selectedShip, gameState?.movePointsRemaining, isMyTurn, turnPhase]);

  function notify(msg) {
    setNotification(msg);
    setTimeout(() => setNotification(''), 3000);
  }

  // Canvas click handler
  const handleCanvasClick = useCallback((e) => {
    if (!gameState) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    const { col, row } = canvasToGrid(x, y, layout);

    if (col < 0 || col >= gameState.totalCols || row < 0 || row >= gameState.totalRows) return;

    // ISLAND PICKING PHASE
    if (phase === 'starting_island_pick') {
      const pickOrder = gameState.islandPickOrder;
      const pickIndex = gameState.islandPickIndex;
      if (pickOrder[pickIndex] !== myId) {
        notify('Not your turn to pick!');
        return;
      }
      const island = Object.values(gameState.islands).find(i =>
        i.type === 'resource' && i.skulls === 1 && !i.owner &&
        i.tiles.some(t => t.col === col && t.row === row)
      );
      if (island) {
        emit(EVENTS.PICK_STARTING_ISLAND, { islandId: island.id });
      } else {
        notify('Click a 1-skull island to start!');
      }
      return;
    }

    // GAMEPLAY
    if (!isMyTurn) return;

    // Select/deselect ship
    const clickedShip = findShipAt(gameState, col, row, myId);
    if (clickedShip) {
      setSelectedShip(prev => prev?.id === clickedShip.id ? null : clickedShip);
      return;
    }

    // Move selected ship
    if (selectedShip && turnPhase === 'perform_actions') {
      const isValid = validMoves.some(m => m.col === col && m.row === row);
      if (isValid) {
        const path = findPath(gameState, selectedShip.position, { col, row });
        if (path.length > 0) {
          emit(EVENTS.MOVE_SHIP, { shipId: selectedShip.id, path }).then(result => {
            if (result?.error) notify(result.error);
            else {
              setSelectedShip(null);
              setValidMoves([]);
              if (result.treasuresOnPath?.length > 0) {
                setTreasuresFound(result.treasuresOnPath);
              }
            }
          });
        }
        return;
      }
    }

    // Click on enemy ship (for attack)
    const enemyShip = findEnemyShipAt(gameState, col, row, myId);
    if (enemyShip && selectedShip && turnPhase === 'perform_actions') {
      emit(EVENTS.ATTACK_SHIP, {
        attackerShipId: selectedShip.id,
        defenderShipId: enemyShip.id,
      }).then(result => {
        if (result?.error) notify(result.error);
        else {
          notify(result.attackerWon ? 'You won the battle!' : 'You lost the battle!');
          setSelectedShip(null);
        }
      });
      return;
    }

    // Click on island port (for attack)
    const tile = gameState.board[row]?.[col];
    if (tile?.type === 'port' && tile.portOf && selectedShip && turnPhase === 'perform_actions') {
      const island = gameState.islands[tile.portOf];
      if (island && island.type === 'resource' && island.owner !== myId) {
        emit(EVENTS.ATTACK_ISLAND, {
          shipId: selectedShip.id,
          islandId: island.id,
        }).then(result => {
          if (result?.error) notify(result.error);
          else {
            notify(result.won ? 'Island conquered!' : 'Attack failed!');
            setSelectedShip(null);
          }
        });
      }
    }
  }, [gameState, selectedShip, validMoves, isMyTurn, turnPhase, phase, myId, emit, layout]);

  const handleCanvasMouseMove = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas || !gameState) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    const { col, row } = canvasToGrid(x, y, layout);
    setHoveredTile({ col, row });
  }, [gameState, layout]);

  // Turn actions
  async function handleDrawResources() {
    const result = await emit(EVENTS.DRAW_RESOURCES, {});
    if (result?.error) notify(result.error);
    else if (result?.drawn) notify(`Drew: ${result.drawn.join(', ')}`);
  }

  async function handleRollDie() {
    const result = await emit(EVENTS.ROLL_SAILING_DIE, {});
    if (result?.error) notify(result.error);
    else notify(`Rolled ${result.roll}! (${result.totalMovePoints} total moves)`);
  }

  async function handleBuild(buildType, targetShipId) {
    const result = await emit(EVENTS.BUILD, { buildType, targetShipId });
    if (result?.error) notify(result.error);
    else notify(`Built ${buildType}!`);
  }

  async function handleEndTurn() {
    const result = await emit(EVENTS.END_TURN, {});
    if (result?.error) notify(result.error);
    setSelectedShip(null);
    setValidMoves([]);
  }

  async function handleTradeResponse(accepted) {
    await emit(EVENTS.RESPOND_TRADE, { accepted });
  }

  async function handleCollectTreasure(tokenId) {
    const result = await emit(EVENTS.COLLECT_TREASURE, { tokenId });
    if (result?.error) notify(result.error);
    else if (result?.card) notify(`Treasure: ${result.card.description}`);
    setTreasuresFound(prev => prev.filter(t => t.id !== tokenId));
  }

  function handleDeclineTreasure(tokenId) {
    setTreasuresFound(prev => prev.filter(t => t.id !== tokenId));
  }

  if (!gameState) return <div className="text-pirate-tan p-4">Loading game...</div>;

  const currentPlayer = gameState.players[currentPlayerId];
  const sortedPlayers = Object.values(gameState.players);
  const ppToWin = gameState.settings?.ppToWin || 10;

  return (
    <div className="h-screen flex flex-col bg-pirate-deepSea overflow-hidden">
      {/* ═══ Top Bar ═══ */}
      <div className="flex-shrink-0 bg-gradient-to-b from-pirate-brown to-pirate-dark border-b border-pirate-tan/20 px-5 flex items-center justify-between"
           style={{ height: TOP_BAR_H }}>
        {/* Left: Logo + room code */}
        <div className="flex items-center gap-3">
          <span className="font-pirate text-pirate-gold text-2xl tracking-wide">Plunder</span>
          <span className="text-pirate-tan/30 text-[10px] font-mono">{roomCode}</span>
        </div>

        {/* Center: Turn info */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-pirate-tan/60">Turn {gameState.turnNumber}</span>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full ring-2 ring-pirate-gold/60"
                 style={{ backgroundColor: currentPlayer ? getColorHex(currentPlayer.color) : '#fff' }} />
            <span className="text-sm font-bold" style={{ color: currentPlayer ? getColorHex(currentPlayer.color) : '#fff' }}>
              {currentPlayer?.name}
            </span>
            {isMyTurn && <span className="text-pirate-gold text-xs font-bold animate-pulse-gold px-1.5 py-0.5 rounded text-[10px]">YOUR TURN</span>}
          </div>
        </div>

        {/* Right: Player PP bars */}
        <div className="flex items-center gap-4">
          {sortedPlayers.map(p => {
            const pct = Math.min(100, (p.plunderPoints / ppToWin) * 100);
            const color = getColorHex(p.color);
            return (
              <div key={p.id} className="flex items-center gap-2" title={`${p.name}: ${p.plunderPoints}/${ppToWin} PP`}>
                <div className="w-3.5 h-3.5 rounded-full border-2 border-white/20" style={{ backgroundColor: color }} />
                <div className="w-20 h-2 rounded-full bg-pirate-dark/60 overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
                </div>
                <span className="text-[11px] font-mono text-white/80">{p.plunderPoints}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ═══ Notification ═══ */}
      {notification && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50
                        bg-pirate-brown border border-pirate-gold px-5 py-2.5 rounded-lg
                        text-pirate-gold text-sm animate-slide-down shadow-lg shadow-black/40">
          {notification}
        </div>
      )}

      {/* ═══ Pending trade modal ═══ */}
      {pendingTrade && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50
                        bg-pirate-brown border border-pirate-tan/30 p-4 rounded-lg shadow-lg max-w-sm">
          <h3 className="text-pirate-gold font-pirate text-lg mb-2">Trade Proposal</h3>
          <p className="text-sm text-pirate-tan mb-2">
            <strong>{pendingTrade.fromName}</strong> offers:
          </p>
          <div className="grid grid-cols-2 gap-2 text-sm mb-3">
            <div>
              <span className="text-green-400">Gives you:</span>
              {Object.entries(pendingTrade.offer).filter(([,v]) => v > 0).map(([k,v]) => (
                <div key={k}>{v}x {k}</div>
              ))}
            </div>
            <div>
              <span className="text-red-400">Wants:</span>
              {Object.entries(pendingTrade.request).filter(([,v]) => v > 0).map(([k,v]) => (
                <div key={k}>{v}x {k}</div>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => handleTradeResponse(true)}
              className="flex-1 bg-green-600 text-white py-1.5 rounded text-sm hover:bg-green-500"
            >
              Accept
            </button>
            <button
              onClick={() => handleTradeResponse(false)}
              className="flex-1 bg-red-600 text-white py-1.5 rounded text-sm hover:bg-red-500"
            >
              Decline
            </button>
          </div>
        </div>
      )}

      {/* ═══ Treasure found prompt ═══ */}
      {treasuresFound.length > 0 && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50
                        bg-pirate-brown border border-pirate-gold p-4 rounded-lg shadow-lg max-w-sm">
          <h3 className="text-pirate-gold font-pirate text-lg mb-2">X Marks the Spot!</h3>
          <p className="text-sm text-pirate-tan mb-3">
            You found {treasuresFound.length} treasure{treasuresFound.length > 1 ? 's' : ''}! Pick up or leave?
          </p>
          {treasuresFound.map(token => (
            <div key={token.id} className="flex gap-2 mb-2">
              <button
                onClick={() => handleCollectTreasure(token.id)}
                className="flex-1 bg-pirate-gold text-pirate-dark py-1.5 rounded text-sm font-bold hover:bg-yellow-500"
              >
                Pick Up
              </button>
              <button
                onClick={() => handleDeclineTreasure(token.id)}
                className="flex-1 bg-pirate-dark border border-pirate-tan/30 text-pirate-tan py-1.5 rounded text-sm hover:border-pirate-tan"
              >
                Leave It
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ═══ Main Layout ═══ */}
      <div className="flex-1 flex overflow-hidden">
        {/* Board area */}
        <div className="flex-1 overflow-auto flex items-center justify-center p-2">
          {phase === 'starting_island_pick' && (
            <div className="absolute top-20 left-1/2 -translate-x-1/2 z-40
                            bg-pirate-brown/90 border border-pirate-gold px-4 py-2 rounded text-center">
              <p className="text-pirate-gold font-pirate text-lg">
                {gameState.islandPickOrder[gameState.islandPickIndex] === myId
                  ? 'Click a 1-skull island to claim as your starting island!'
                  : `Waiting for ${gameState.players[gameState.islandPickOrder[gameState.islandPickIndex]]?.name} to pick...`
                }
              </p>
            </div>
          )}
          <canvas
            ref={canvasRef}
            width={canvasW}
            height={canvasH}
            className="game-board-canvas"
            style={{ maxWidth: '100%', maxHeight: '100%' }}
            onClick={handleCanvasClick}
            onMouseMove={handleCanvasMouseMove}
          />
        </div>

        {/* Right panel */}
        <div className="border-l border-pirate-tan/20 bg-pirate-brown/40 flex flex-col"
             style={{ width: SIDEBAR_W }}>
          <ActionPanel
            gameState={gameState}
            myPlayer={myPlayer}
            isMyTurn={isMyTurn}
            turnPhase={turnPhase}
            phase={phase}
            selectedShip={selectedShip}
            onDrawResources={handleDrawResources}
            onRollDie={handleRollDie}
            onBuild={handleBuild}
            onEndTurn={handleEndTurn}
            emit={emit}
            pendingTreaty={pendingTreaty}
          />
          <ChatLog messages={messages} emit={emit} />
        </div>
      </div>
    </div>
  );
}

function findShipAt(gameState, col, row, playerId) {
  const player = gameState.players[playerId];
  return player?.ships?.find(s => s.position.col === col && s.position.row === row);
}

function findEnemyShipAt(gameState, col, row, excludePlayerId) {
  for (const [id, player] of Object.entries(gameState.players)) {
    if (id === excludePlayerId) continue;
    const ship = player.ships?.find(s => s.position.col === col && s.position.row === row);
    if (ship) return ship;
  }
  return null;
}

function findPath(gameState, start, target) {
  const { board, totalCols, totalRows, players } = gameState;
  const key = (c, r) => `${c},${r}`;
  const visited = new Map();
  const queue = [{ col: start.col, row: start.row, parent: null }];
  visited.set(key(start.col, start.row), null);

  const occupied = new Set();
  for (const p of Object.values(players)) {
    for (const s of p.ships || []) {
      if (s.position.col !== start.col || s.position.row !== start.row) {
        occupied.add(key(s.position.col, s.position.row));
      }
    }
  }

  while (queue.length > 0) {
    const current = queue.shift();

    if (current.col === target.col && current.row === target.row) {
      const path = [];
      let node = current;
      while (node.parent) {
        path.unshift({ col: node.col, row: node.row });
        node = node.parent;
      }
      return path;
    }

    for (const [dc, dr] of [[0,1],[0,-1],[1,0],[-1,0]]) {
      const nc = current.col + dc;
      const nr = current.row + dr;
      const k = key(nc, nr);

      if (nc < 0 || nc >= totalCols || nr < 0 || nr >= totalRows) continue;
      if (visited.has(k)) continue;

      const tile = board[nr][nc];
      if (tile.type !== 'sea' && tile.type !== 'port') continue;
      if (occupied.has(k) && !(nc === target.col && nr === target.row)) continue;

      visited.set(k, current);
      queue.push({ col: nc, row: nr, parent: current });
    }
  }

  return [];
}

function getColorHex(color) {
  const map = {
    red: '#ef4444', blue: '#3b82f6', green: '#22c55e',
    yellow: '#eab308', purple: '#a855f7', orange: '#f97316',
  };
  return map[color] || '#fff';
}
