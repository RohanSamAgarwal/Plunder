import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useSocketContext } from '../../App';
import { drawBoard, canvasToGrid, getValidMoves, calculateLayout } from '../../game/renderer';
import ActionPanel from './ActionPanel';
import ChatLog from './ChatLog';
import PortArrivalPrompt from './PortArrivalPrompt';
import DiceRoll3D from './DiceRoll3D';
import CannonFireAnimation from './CannonFireAnimation';
import CombatAnimation from './CombatAnimation';
import BuildAnimation from './BuildAnimation';
import ShipLaunchAnimation from './ShipLaunchAnimation';
import ShipMoveAnimation from './ShipMoveAnimation';
import StormAnimation from './StormAnimation';
import EventAnimation from './EventAnimation';
import ResourceDrawAnimation from './ResourceDrawAnimation';
import GameStartAnimation from './GameStartAnimation';
import GameOverAnimation from './GameOverAnimation';
import { useAnimSpeed } from '../../App';

const SIDEBAR_W = 400;
const TOP_BAR_H = 52;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 0.1;

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

const RESOURCE_META = {
  wood: { label: 'Wood', color: '#8B5E3C' },
  iron: { label: 'Iron', color: '#9CA3AF' },
  rum: { label: 'Rum', color: '#C2410C' },
  gold: { label: 'Gold', color: '#EAB308' },
};
const EMPTY_RESOURCES = { wood: 0, iron: 0, rum: 0, gold: 0 };

export default function GameView({ gameState, playerInfo, messages, pendingTrade, pendingTreaty, pendingAttackBribe, attackBribeDecision, drawnCard, onDismissCard, deckShuffling, animations, diceRollAnim, onDiceRollComplete, cannonFireAnim, onCannonFireComplete, combatAnim, onCombatComplete, buildAnim, onBuildComplete, shipLaunchAnim, onShipLaunchComplete, shipMoveAnim, onShipMoveComplete, stormAnim, onStormComplete, eventAnim, onEventComplete, resourceDrawAnim, onResourceDrawComplete, gameStartAnim, onGameStartComplete, gameOverAnim, onGameOverComplete, roomCode, skipVoteActive }) {
  const { emit } = useSocketContext();
  const { animSpeed, setAnimSpeed } = useAnimSpeed();
  const canvasRef = useRef(null);
  const boardContainerRef = useRef(null);
  const [selectedShip, setSelectedShip] = useState(null);
  const [zoomLevel, setZoomLevel] = useState(1.0);
  const [hoveredTile, setHoveredTile] = useState(null);
  const [validMoves, setValidMoves] = useState([]);
  const [notification, setNotification] = useState('');
  const [treasuresFound, setTreasuresFound] = useState([]);
  const [bribeOffer, setBribeOffer] = useState({ ...EMPTY_RESOURCES });
  const [bribeSubmitted, setBribeSubmitted] = useState(false);
  const [portArrivalShipId, setPortArrivalShipId] = useState(null);
  const [panelAutoOpen, setPanelAutoOpen] = useState(null); // { section, key } | null
  const [activeTab, setActiveTab] = useState('controls');
  const [unreadCount, setUnreadCount] = useState(0);
  const activeTabRef = useRef('controls');

  // Reset bribe submitted state when bribe flow completes
  useEffect(() => {
    if (!pendingAttackBribe) setBribeSubmitted(false);
  }, [pendingAttackBribe]);

  // Clear port arrival prompt when the user deselects or selects a different ship
  useEffect(() => {
    if (!selectedShip || selectedShip.id !== portArrivalShipId) {
      if (portArrivalShipId) setPortArrivalShipId(null);
    }
  }, [selectedShip, portArrivalShipId]);

  // Clear port arrival prompt on turn change
  useEffect(() => { setPortArrivalShipId(null); }, [gameState?.turnNumber]);

  // Turn timer countdown
  const [turnElapsed, setTurnElapsed] = useState(0);
  const [hasVoted, setHasVoted] = useState(false);
  useEffect(() => {
    if (!gameState?.turnStartedAt) { setTurnElapsed(0); return; }
    const tick = () => setTurnElapsed(Math.floor((Date.now() - gameState.turnStartedAt) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [gameState?.turnStartedAt]);

  // Reset vote state on new turn
  useEffect(() => { setHasVoted(false); }, [gameState?.turnNumber]);

  const hardTimer = gameState?.settings?.hardTimerSeconds || 0;
  const timeRemaining = hardTimer > 0 ? Math.max(0, hardTimer - turnElapsed) : null;

  // Track unread messages when on controls tab
  const prevMsgCount = useRef(messages?.length || 0);
  useEffect(() => {
    const count = messages?.length || 0;
    if (count > prevMsgCount.current && activeTabRef.current !== 'log') {
      setUnreadCount(prev => prev + (count - prevMsgCount.current));
    }
    prevMsgCount.current = count;
  }, [messages]);

  function switchTab(tab) {
    setActiveTab(tab);
    activeTabRef.current = tab;
    if (tab === 'log') setUnreadCount(0);
  }

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

  // Zoom: derive effective layout from base layout × zoomLevel
  const zoomedLayout = useMemo(() => ({
    tileSize: Math.round(layout.tileSize * zoomLevel),
    gridPad: layout.gridPad,
  }), [layout, zoomLevel]);

  // Wheel zoom handler — must use useEffect with passive:false to allow preventDefault
  useEffect(() => {
    const container = boardContainerRef.current;
    if (!container) return;

    function handleWheel(e) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;

      const scrollLeft = container.scrollLeft;
      const scrollTop = container.scrollTop;
      const viewCenterX = scrollLeft + container.clientWidth / 2;
      const viewCenterY = scrollTop + container.clientHeight / 2;

      setZoomLevel(prev => {
        const next = Math.round((prev + delta) * 10) / 10;
        const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, next));
        if (clamped !== prev) {
          const ratio = clamped / prev;
          requestAnimationFrame(() => {
            container.scrollLeft = viewCenterX * ratio - container.clientWidth / 2;
            container.scrollTop = viewCenterY * ratio - container.clientHeight / 2;
          });
        }
        return clamped;
      });
    }

    // Right-click drag to pan
    let isPanning = false;
    let panStartX = 0, panStartY = 0;
    let scrollStartX = 0, scrollStartY = 0;

    function handleMouseDown(e) {
      if (e.button !== 2) return; // right-click only
      // Only pan if content overflows (board doesn't fit in viewport)
      if (container.scrollWidth <= container.clientWidth && container.scrollHeight <= container.clientHeight) return;
      isPanning = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
      scrollStartX = container.scrollLeft;
      scrollStartY = container.scrollTop;
      container.style.cursor = 'grabbing';
      e.preventDefault();
    }

    function handleMouseMove(e) {
      if (!isPanning) return;
      const dx = e.clientX - panStartX;
      const dy = e.clientY - panStartY;
      container.scrollLeft = scrollStartX - dx;
      container.scrollTop = scrollStartY - dy;
    }

    function handleMouseUp(e) {
      if (!isPanning) return;
      isPanning = false;
      container.style.cursor = '';
    }

    function handleContextMenu(e) {
      if (container.scrollWidth > container.clientWidth || container.scrollHeight > container.clientHeight) {
        e.preventDefault(); // suppress context menu when pannable
      }
    }

    container.addEventListener('wheel', handleWheel, { passive: false });
    container.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    container.addEventListener('contextmenu', handleContextMenu);
    return () => {
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      container.removeEventListener('contextmenu', handleContextMenu);
    };
  }, []);

  const myId = playerInfo?.playerId;
  const currentPlayerId = gameState?.currentPlayerId;
  const isMyTurn = currentPlayerId === myId;
  const turnPhase = gameState?.turnPhase;
  const phase = gameState?.phase;
  const myPlayer = gameState?.players?.[myId];

  // Canvas dimensions (use zoomed layout)
  const canvasW = useMemo(() => {
    if (!gameState) return 800;
    return gameState.totalCols * zoomedLayout.tileSize + zoomedLayout.gridPad * 2;
  }, [gameState?.totalCols, zoomedLayout]);

  const canvasH = useMemo(() => {
    if (!gameState) return 600;
    return gameState.totalRows * zoomedLayout.tileSize + zoomedLayout.gridPad * 2;
  }, [gameState?.totalRows, zoomedLayout]);

  // Continuous board redraw for wave animation + interaction pulses
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !gameState) return;
    const ctx = canvas.getContext('2d');

    const draw = () => drawBoard(ctx, canvas, gameState, {
      selectedShip, hoveredTile, validMoves,
    }, zoomedLayout);

    draw();

    // Full-speed loop when interacting, slow loop (~12fps) for ambient waves
    const interacting = selectedShip || hoveredTile;
    let raf;
    let lastFrame = 0;
    const interval = interacting ? 0 : 80; // 0 = every frame, 80ms ≈ 12fps

    const loop = (now) => {
      if (now - lastFrame >= interval) {
        draw();
        lastFrame = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [gameState, selectedShip, hoveredTile, validMoves, zoomedLayout]);

  // Update valid moves when ship selected
  useEffect(() => {
    if (selectedShip && gameState && isMyTurn && turnPhase === 'perform_actions') {
      const bonus = selectedShip.jettisonBonus || 0;
      const moves = getValidMoves(gameState, selectedShip, gameState.movePointsRemaining + bonus);
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
    const { col, row } = canvasToGrid(x, y, zoomedLayout);

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
          const shipIdMoving = selectedShip.id;
          const destTile = gameState.board?.[row]?.[col];
          const arrivedAtPort = destTile?.type === 'port';
          emit(EVENTS.MOVE_SHIP, { shipId: shipIdMoving, path }).then(result => {
            if (result?.error) notify(result.error);
            else {
              setValidMoves([]);
              if (arrivedAtPort) {
                // Keep ship selected so ActionPanel shortcuts remain visible
                setPortArrivalShipId(shipIdMoving);
              } else {
                setSelectedShip(null);
              }
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
        else if (result?.pending) {
          notify('Attack initiated! Waiting for defender...');
          setSelectedShip(null);
        } else {
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
          else if (result?.pending) {
            notify('Attack initiated! Waiting for defender...');
            setSelectedShip(null);
          } else {
            notify(result.won ? 'Island conquered!' : 'Attack failed!');
            setSelectedShip(null);
          }
        });
      }
    }
  }, [gameState, selectedShip, validMoves, isMyTurn, turnPhase, phase, myId, emit, zoomedLayout]);

  const handleCanvasMouseMove = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas || !gameState) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    const { col, row } = canvasToGrid(x, y, zoomedLayout);
    setHoveredTile({ col, row });
  }, [gameState, zoomedLayout]);

  // Turn actions
  async function handleDrawResources() {
    const result = await emit(EVENTS.DRAW_RESOURCES, {});
    if (result?.error) notify(result.error);
    else if (result?.drawn) notify(`Drew: ${result.drawn.join(', ')}`);
  }

  async function handleRollDie() {
    const result = await emit(EVENTS.ROLL_SAILING_DIE, {});
    if (result?.error) notify(result.error);
    // Success: 3D dice animation handles the display via DIE_ROLLED event
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

  async function handleBribeOffer() {
    const total = Object.values(bribeOffer).reduce((s, v) => s + v, 0);
    await emit('attack-bribe-offer', { offer: total > 0 ? bribeOffer : null });
    setBribeOffer({ ...EMPTY_RESOURCES });
    setBribeSubmitted(true);
  }

  async function handleBribeDecline() {
    await emit('attack-bribe-offer', { offer: null });
    setBribeOffer({ ...EMPTY_RESOURCES });
    setBribeSubmitted(true);
  }

  async function handleBribeResolve(decision) {
    const result = await emit('attack-bribe-resolve', { decision });
    if (result?.error) notify(result.error);
    else if (result?.combat) {
      if (result.combat.attackerWon !== undefined) {
        notify(result.combat.attackerWon ? 'You won the battle!' : 'You lost the battle!');
      } else {
        notify(result.combat.won ? 'Island conquered!' : 'Attack failed!');
      }
    } else if (result?.attackCancelled) {
      notify('Attack cancelled.');
    }
  }

  const myResources = myPlayer?.resources || {};

  // Combat reroll state
  const [combatRerollCost, setCombatRerollCost] = useState({ ...EMPTY_RESOURCES });
  const [showCombatRerollPicker, setShowCombatRerollPicker] = useState(false);
  const pendingCombatReroll = gameState?.pendingCombatReroll;
  const rerollMode = gameState?.settings?.rerollMode || 'none';

  const isMyCombatRerollTurn = (() => {
    if (!pendingCombatReroll) return false;
    if (pendingCombatReroll.phase === 'attacker_reroll' && pendingCombatReroll.attackerId === myPlayer?.id) return true;
    if (pendingCombatReroll.phase === 'defender_reroll' && pendingCombatReroll.defenderId === myPlayer?.id) return true;
    return false;
  })();

  const combatRerollCostTotal = Object.values(combatRerollCost).reduce((s, v) => s + v, 0);

  async function handleCombatReroll() {
    if (rerollMode === 'spend_resources') {
      if (combatRerollCostTotal !== 3) return;
      await emit('reroll-combat', { resourceCost: combatRerollCost });
    } else {
      await emit('reroll-combat', {});
    }
    setShowCombatRerollPicker(false);
    setCombatRerollCost({ ...EMPTY_RESOURCES });
  }

  async function handleSkipCombatReroll() {
    await emit('skip-combat-reroll', {});
    setShowCombatRerollPicker(false);
    setCombatRerollCost({ ...EMPTY_RESOURCES });
  }

  if (!gameState) return <div className="text-pirate-tan p-4">Loading game...</div>;

  const currentPlayer = gameState.players[currentPlayerId];
  const ppToWin = gameState.settings?.ppToWin || 10;
  const sortedPlayers = Object.values(gameState.players).slice().sort((a, b) => b.plunderPoints - a.plunderPoints);

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
          {timeRemaining !== null && gameState?.turnStartedAt && (
            <span className={`text-xs font-mono ml-2 px-1.5 py-0.5 rounded ${
              timeRemaining <= 10 ? 'text-red-400 animate-pulse font-bold' :
              timeRemaining <= 30 ? 'text-yellow-400' :
              'text-pirate-tan/50'
            }`}>
              {Math.floor(timeRemaining / 60)}:{String(timeRemaining % 60).padStart(2, '0')}
            </span>
          )}
        </div>

        {/* Right: Plunder Points leaderboard */}
        <div className="flex items-center gap-3">
          <span className="text-pirate-tan/50 text-[10px] mr-1">Plunder Points</span>
          {sortedPlayers.map(p => {
            const color = getColorHex(p.color);
            return (
              <div key={p.id} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-[11px] text-white/70 max-w-[60px] truncate">{p.name}</span>
                <span className="text-[11px] font-bold text-white">{p.plunderPoints}</span>
              </div>
            );
          })}
          <span className="text-pirate-tan/40 text-[10px] ml-1">/ {ppToWin} to win</span>
        </div>
      </div>

      {/* ═══ Deck Shuffling Overlay ═══ */}
      {deckShuffling && (
        <div className="deck-shuffle-overlay">
          <div className="deck-shuffle-content">
            <div className="deck-shuffle-cards">
              {[0, 1, 2, 3, 4, 5].map(i => (
                <div key={i}
                  className="deck-shuffle-card"
                  style={{
                    animationDelay: `${i * 0.12}s`,
                    animationName: i % 2 === 0 ? 'shuffleFanLeft' : 'shuffleFanRight',
                    zIndex: 6 - i,
                  }}>
                  {/* Card back design */}
                  <div className="deck-card-back">
                    <div className="deck-card-border">
                      <div className="deck-card-inner">
                        {/* Skull & crossbones */}
                        <div className="deck-card-skull">💀</div>
                        <div className="deck-card-swords">⚔️</div>
                        {/* Corner gems */}
                        <span className="deck-card-gem deck-card-gem-tl">◆</span>
                        <span className="deck-card-gem deck-card-gem-tr">◆</span>
                        <span className="deck-card-gem deck-card-gem-bl">◆</span>
                        <span className="deck-card-gem deck-card-gem-br">◆</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <p className="deck-shuffle-text">
              Shuffling the treasure deck...
            </p>
            <div className="deck-shuffle-sparkles">
              {'✨💰✨'.split('').map((e, i) => (
                <span key={i} className="deck-shuffle-sparkle" style={{ animationDelay: `${i * 0.3}s` }}>{e}</span>
              ))}
            </div>
          </div>
        </div>
      )}

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

      {/* ═══ Defender Bribe Popup ═══ */}
      {pendingAttackBribe && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50
                        bg-pirate-brown border border-red-500/50 p-4 rounded-lg shadow-lg max-w-sm w-80">
          {bribeSubmitted ? (
            <>
              <h3 className="text-amber-400 font-pirate text-lg mb-2">Bribe Sent!</h3>
              <p className="text-sm text-pirate-tan">
                Waiting for <strong className="text-white">{pendingAttackBribe.attackerName}</strong> to decide...
              </p>
              <div className="mt-3 flex justify-center">
                <div className="animate-pulse text-pirate-gold text-2xl">⏳</div>
              </div>
            </>
          ) : (
            <>
              <h3 className="text-red-400 font-pirate text-lg mb-2">Under Attack!</h3>
              <p className="text-sm text-pirate-tan mb-3">
                <strong className="text-white">{pendingAttackBribe.attackerName}</strong> is attacking your {pendingAttackBribe.type === 'ship' ? 'ship' : 'island'}! Offer a bribe?
              </p>
              <div className="grid grid-cols-4 gap-1 mb-2">
                {Object.entries(RESOURCE_META).map(([r, meta]) => (
                  <div key={r} className="text-center">
                    <div className="text-[10px] font-bold" style={{ color: meta.color }}>{meta.label}</div>
                    <div className="text-[10px] text-pirate-tan/50 mb-0.5">({myResources[r] || 0})</div>
                    <input type="number" min="0" max={myResources[r] || 0} value={bribeOffer[r]}
                      onChange={(e) => setBribeOffer(prev => ({ ...prev, [r]: Math.min(parseInt(e.target.value) || 0, myResources[r] || 0) }))}
                      className="w-full bg-pirate-dark border border-pirate-tan/20 rounded text-center text-xs py-0.5 text-white" />
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={handleBribeOffer}
                  disabled={Object.values(bribeOffer).reduce((s, v) => s + v, 0) === 0}
                  className="flex-1 bg-amber-600 hover:bg-amber-500 text-white py-1.5 rounded text-sm font-bold
                             disabled:opacity-40 disabled:cursor-not-allowed transition">
                  Offer Bribe
                </button>
                <button onClick={handleBribeDecline}
                  className="flex-1 bg-gray-600 hover:bg-gray-500 text-white py-1.5 rounded text-sm transition">
                  Decline
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══ Attacker Bribe Decision Popup ═══ */}
      {attackBribeDecision && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50
                        bg-pirate-brown border border-pirate-gold/50 p-4 rounded-lg shadow-lg max-w-sm w-80">
          <h3 className="text-pirate-gold font-pirate text-lg mb-2">Bribe Offered</h3>
          {attackBribeDecision.offer ? (
            <>
              <p className="text-sm text-pirate-tan mb-2">
                <strong className="text-white">{attackBribeDecision.defenderName}</strong> offers a bribe:
              </p>
              <div className="grid grid-cols-4 gap-1 mb-3">
                {Object.entries(attackBribeDecision.offer).filter(([, v]) => v > 0).map(([r, v]) => (
                  <div key={r} className="text-center bg-pirate-dark/50 rounded p-1.5">
                    <div className="text-[10px] font-bold" style={{ color: RESOURCE_META[r]?.color }}>{RESOURCE_META[r]?.label}</div>
                    <div className="text-sm font-bold text-green-400">+{v}</div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-pirate-tan mb-3">
              <strong className="text-white">{attackBribeDecision.defenderName}</strong> declined to offer a bribe.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {attackBribeDecision.offer && (
              <button onClick={() => handleBribeResolve('accept')}
                className="flex-1 bg-green-700 hover:bg-green-600 text-white py-1.5 rounded text-xs font-bold transition min-w-[100px]">
                Accept Bribe (No Attack)
              </button>
            )}
            {attackBribeDecision.offer && attackBribeDecision.bribeMode === 'ruthless' && (
              <button onClick={() => handleBribeResolve('accept_and_attack')}
                className="flex-1 bg-orange-700 hover:bg-orange-600 text-white py-1.5 rounded text-xs font-bold transition min-w-[100px]">
                Accept Bribe + Attack
              </button>
            )}
            <button onClick={() => handleBribeResolve('reject')}
              className="flex-1 bg-red-700 hover:bg-red-600 text-white py-1.5 rounded text-xs font-bold transition min-w-[100px]">
              {attackBribeDecision.offer ? 'Reject + Attack' : 'Attack'}
            </button>
            <button onClick={() => handleBribeResolve('cancel')}
              className="flex-1 bg-gray-600 hover:bg-gray-500 text-white py-1.5 rounded text-xs transition min-w-[100px]">
              Cancel Attack
            </button>
          </div>
        </div>
      )}

      {/* ═══ Port Arrival Prompt ═══ */}
      {portArrivalShipId && selectedShip && selectedShip.id === portArrivalShipId && isMyTurn && (
        <PortArrivalPrompt
          ship={selectedShip}
          gameState={gameState}
          myPlayer={myPlayer}
          emit={emit}
          onDismiss={() => setPortArrivalShipId(null)}
          onOpenMerchant={() => setPanelAutoOpen({ section: 'merchant', key: Date.now() })}
          onOpenTrade={() => setPanelAutoOpen({ section: 'trade', key: Date.now() })}
          onOpenBuild={() => setPanelAutoOpen({ section: 'build', key: Date.now() })}
        />
      )}

      {/* ═══ Turn Timer Vote Popup ═══ */}
      {skipVoteActive && !isMyTurn && !hasVoted && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50
                        bg-pirate-brown border border-amber-500/50 p-4 rounded-lg shadow-lg max-w-sm w-72">
          <h3 className="text-amber-400 font-pirate text-lg mb-2">Skip Turn?</h3>
          <p className="text-sm text-pirate-tan mb-3">
            <strong className="text-white">{currentPlayer?.name}</strong> is taking too long. Skip their turn?
          </p>
          <div className="flex gap-2">
            <button onClick={() => { emit('turn-timer-vote', { vote: true }); setHasVoted(true); }}
              className="flex-1 bg-red-700 hover:bg-red-600 text-white py-1.5 rounded text-sm font-bold transition">
              Yes, Skip
            </button>
            <button onClick={() => { emit('turn-timer-vote', { vote: false }); setHasVoted(true); }}
              className="flex-1 bg-gray-600 hover:bg-gray-500 text-white py-1.5 rounded text-sm transition">
              No, Wait
            </button>
          </div>
        </div>
      )}
      {skipVoteActive && !isMyTurn && hasVoted && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50
                        bg-pirate-brown border border-amber-500/30 p-3 rounded-lg shadow-lg max-w-sm w-60 text-center">
          <p className="text-sm text-pirate-tan">Vote cast. Waiting for others...</p>
        </div>
      )}
      {skipVoteActive && isMyTurn && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50
                        bg-red-900/90 border border-red-500 px-4 py-2 rounded-lg shadow-lg">
          <p className="text-red-200 text-sm font-bold animate-pulse">
            Players are voting to skip your turn!
          </p>
        </div>
      )}

      {/* ═══ Combat Reroll Popup ═══ */}
      {isMyCombatRerollTurn && pendingCombatReroll && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50
                        bg-pirate-brown border border-amber-500/50 p-4 rounded-lg shadow-lg max-w-sm w-80">
          <h3 className="text-amber-400 font-pirate text-lg mb-2">Combat Reroll</h3>
          <p className="text-sm text-pirate-tan mb-3">
            {pendingCombatReroll.phase === 'attacker_reroll' ? 'You are the attacker.' : 'You are the defender.'}
            {' '}Reroll your die?
          </p>

          {/* Dice display */}
          <div className="flex items-center justify-center gap-4 mb-3">
            <div className="text-center">
              <div className="text-[10px] text-pirate-tan/70 mb-1">Attack</div>
              <div className={`rounded-lg w-12 h-12 flex items-center justify-center text-xl font-bold shadow-inner
                              ${pendingCombatReroll.phase === 'attacker_reroll' ? 'bg-amber-100 text-amber-800 border-2 border-amber-400' : 'bg-white text-pirate-dark'}`}>
                {pendingCombatReroll.attackDie}
              </div>
              <div className="text-[10px] text-pirate-tan/50 mt-0.5">+{pendingCombatReroll.attackerCannons} cannons</div>
              <div className="text-xs font-bold text-white">= {pendingCombatReroll.attackDie + pendingCombatReroll.attackerCannons}</div>
            </div>
            <div className="text-pirate-tan/40 text-lg font-bold">vs</div>
            <div className="text-center">
              <div className="text-[10px] text-pirate-tan/70 mb-1">Defense</div>
              <div className={`rounded-lg w-12 h-12 flex items-center justify-center text-xl font-bold shadow-inner
                              ${pendingCombatReroll.phase === 'defender_reroll' ? 'bg-amber-100 text-amber-800 border-2 border-amber-400' : 'bg-white text-pirate-dark'}`}>
                {pendingCombatReroll.defenseDie}
              </div>
              <div className="text-[10px] text-pirate-tan/50 mt-0.5">
                +{pendingCombatReroll.defenderModifier} {pendingCombatReroll.type === 'island' ? 'skulls' : 'cannons'}
              </div>
              <div className="text-xs font-bold text-white">= {pendingCombatReroll.defenseDie + pendingCombatReroll.defenderModifier}</div>
            </div>
          </div>

          {/* Resource picker for spend mode */}
          {showCombatRerollPicker && rerollMode === 'spend_resources' && (
            <div className="bg-pirate-dark border border-amber-500/40 rounded-lg p-2 space-y-2 mb-3">
              <p className="text-[10px] text-amber-400 font-bold">Choose 3 resources to spend:</p>
              <div className="grid grid-cols-4 gap-1">
                {Object.entries(RESOURCE_META).map(([r, meta]) => (
                  <div key={r} className="text-center">
                    <div className="text-[10px] font-bold" style={{ color: meta.color }}>{meta.label}</div>
                    <input type="number" min="0" max={myResources[r] || 0} value={combatRerollCost[r]}
                      onChange={(e) => setCombatRerollCost(prev => ({ ...prev, [r]: Math.min(parseInt(e.target.value) || 0, myResources[r] || 0) }))}
                      className="w-full bg-pirate-dark border border-pirate-tan/20 rounded text-center text-xs py-0.5 text-white" />
                  </div>
                ))}
              </div>
              <div className="text-[10px] text-pirate-tan/60 text-right">
                Selected: {combatRerollCostTotal} / 3
              </div>
              <div className="flex gap-1.5">
                <button onClick={handleCombatReroll} disabled={combatRerollCostTotal !== 3}
                  className="flex-1 bg-amber-700 hover:bg-amber-600 text-white py-1 rounded text-xs transition
                             disabled:opacity-40 disabled:cursor-not-allowed">
                  Confirm Reroll
                </button>
                <button onClick={() => { setShowCombatRerollPicker(false); setCombatRerollCost({ ...EMPTY_RESOURCES }); }}
                  className="flex-1 bg-gray-600 hover:bg-gray-500 text-white py-1 rounded text-xs transition">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Action buttons */}
          {!showCombatRerollPicker && (
            <div className="flex gap-2">
              <button onClick={() => {
                if (rerollMode === 'spend_resources') {
                  setShowCombatRerollPicker(true);
                  setCombatRerollCost({ ...EMPTY_RESOURCES });
                } else {
                  handleCombatReroll();
                }
              }}
                className="flex-1 bg-amber-700 hover:bg-amber-600 text-white py-1.5 rounded text-sm font-bold transition">
                🎲 Reroll {rerollMode === 'one_per_game'
                  ? `(${1 - (myPlayer?.rerollsUsed || 0)} left)`
                  : rerollMode === 'spend_resources'
                    ? '(3 Resources)'
                    : ''}
              </button>
              <button onClick={handleSkipCombatReroll}
                className="flex-1 bg-gray-600 hover:bg-gray-500 text-white py-1.5 rounded text-sm transition">
                Keep Roll
              </button>
            </div>
          )}
        </div>
      )}

      {/* ═══ Drawn Treasure Card Display ═══ */}
      {drawnCard && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50
                        bg-pirate-brown border-2 border-pirate-gold p-5 rounded-lg shadow-lg shadow-black/50 w-80">
          <p className="text-sm text-pirate-tan mb-3 text-center">
            <strong className="text-white">{drawnCard.playerName}</strong> has drawn...
          </p>
          <div className={`rounded-lg p-4 text-center border ${
            ['steal', 'storm', 'end_turn', 'lose_resource'].includes(drawnCard.card.type)
              ? 'bg-red-900/30 border-red-500/40'
              : 'bg-amber-900/30 border-amber-500/40'
          }`}>
            <div className="text-2xl mb-2">
              {drawnCard.card.type === 'gold' && '\u{1FA99}'}
              {drawnCard.card.type === 'resource' && '\u{1F4E6}'}
              {drawnCard.card.type === 'plunder_point' && '\u2620\uFE0F'}
              {drawnCard.card.type === 'steal' && '\u{1F5E1}\uFE0F'}
              {drawnCard.card.type === 'storm' && '\u26C8\uFE0F'}
              {drawnCard.card.type === 'end_turn' && '\u{1F6D1}'}
              {drawnCard.card.type === 'lose_resource' && '\u{1F4A8}'}
              {drawnCard.card.type === 'free_cannon' && '\u{1F4A3}'}
              {drawnCard.card.type === 'free_mast' && '\u26F5'}
              {drawnCard.card.type === 'free_life' && '\u2764\uFE0F'}
            </div>
            <h3 className={`font-pirate text-lg mb-1 ${
              ['steal', 'storm', 'end_turn', 'lose_resource'].includes(drawnCard.card.type)
                ? 'text-red-400'
                : 'text-pirate-gold'
            }`}>
              {drawnCard.card.type === 'gold' && 'Gold!'}
              {drawnCard.card.type === 'resource' && 'Supplies!'}
              {drawnCard.card.type === 'plunder_point' && 'Plunder Point!'}
              {drawnCard.card.type === 'steal' && 'Steal!'}
              {drawnCard.card.type === 'storm' && 'Storm!'}
              {drawnCard.card.type === 'end_turn' && 'Turn Ends!'}
              {drawnCard.card.type === 'lose_resource' && 'Loss!'}
              {drawnCard.card.type === 'free_cannon' && 'Free Cannon!'}
              {drawnCard.card.type === 'free_mast' && 'Free Mast!'}
              {drawnCard.card.type === 'free_life' && 'Free Life Peg!'}
            </h3>
            {(() => {
              const parts = drawnCard.card.description.split(/(?<=!)\s+/);
              return parts.length > 1 ? (
                <>
                  <p className="text-sm text-white font-bold">{parts[0]}</p>
                  <p className="text-xs text-pirate-tan mt-1">{parts.slice(1).join(' ')}</p>
                </>
              ) : (
                <p className="text-sm text-pirate-tan">{drawnCard.card.description}</p>
              );
            })()}
          </div>
          <button onClick={onDismissCard}
            className="w-full mt-3 bg-pirate-dark hover:bg-pirate-dark/80 border border-pirate-tan/30
                       text-pirate-tan py-2 rounded text-sm transition">
            Dismiss
          </button>
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
        <div className="flex-1 relative">
        <div ref={boardContainerRef} className={`absolute inset-0 overflow-auto p-2 ${zoomLevel <= 1 ? 'flex items-center justify-center' : ''}`}>
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
          <div className="relative inline-block" style={zoomLevel <= 1 ? { maxWidth: '100%', maxHeight: '100%' } : { margin: 'auto' }}>
            <canvas
              ref={canvasRef}
              width={canvasW}
              height={canvasH}
              className="game-board-canvas"
              style={zoomLevel <= 1 ? { maxWidth: '100%', maxHeight: '100%' } : {}}
              onClick={handleCanvasClick}
              onMouseMove={handleCanvasMouseMove}
            />
            {/* 3D Dice roll overlay */}
            {diceRollAnim && (
              <DiceRoll3D
                roll={diceRollAnim.roll}
                totalMovePoints={diceRollAnim.totalMovePoints}
                isReroll={diceRollAnim.isReroll}
                playerName={diceRollAnim.playerName}
                onComplete={onDiceRollComplete}
              />
            )}
            {/* Cannon fire animation (plays before dice) */}
            {cannonFireAnim && cannonFireAnim.attackerLocation && cannonFireAnim.defenderLocation && (
              <CannonFireAnimation
                attackerPos={cannonFireAnim.attackerLocation}
                defenderPos={cannonFireAnim.defenderLocation}
                cannons={cannonFireAnim.attackerCannons || 1}
                layout={zoomedLayout}
                canvasW={canvasW}
                canvasH={canvasH}
                onComplete={onCannonFireComplete}
              />
            )}
            {/* Combat dice duel overlay */}
            {combatAnim && (
              <CombatAnimation
                combatResult={combatAnim}
                onComplete={onCombatComplete}
              />
            )}
            {/* Build floating icon overlay */}
            {buildAnim && (() => {
              const loc = buildAnim.location;
              const hasPos = loc?.col != null && loc?.row != null;
              const style = hasPos
                ? {
                    left: `${((zoomedLayout.gridPad + loc.col * zoomedLayout.tileSize + zoomedLayout.tileSize / 2) / canvasW) * 100}%`,
                    top: `${((zoomedLayout.gridPad + loc.row * zoomedLayout.tileSize) / canvasH) * 100}%`,
                    transform: 'translate(-50%, -50%)',
                  }
                : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
              return (
                <div className="absolute pointer-events-none" style={style}>
                  <BuildAnimation
                    buildType={buildAnim.buildType}
                    playerName={buildAnim.playerName}
                    onComplete={onBuildComplete}
                  />
                </div>
              );
            })()}
            {/* Ship launch splash overlay */}
            {shipLaunchAnim && (() => {
              const loc = shipLaunchAnim.location;
              const hasPos = loc?.col != null && loc?.row != null;
              const style = hasPos
                ? {
                    left: `${((zoomedLayout.gridPad + loc.col * zoomedLayout.tileSize + zoomedLayout.tileSize / 2) / canvasW) * 100}%`,
                    top: `${((zoomedLayout.gridPad + loc.row * zoomedLayout.tileSize) / canvasH) * 100}%`,
                    transform: 'translate(-50%, -50%)',
                  }
                : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
              return (
                <div className="absolute pointer-events-none" style={style}>
                  <ShipLaunchAnimation
                    playerName={shipLaunchAnim.playerName}
                    onComplete={onShipLaunchComplete}
                  />
                </div>
              );
            })()}
            {/* Ship move sliding overlay */}
            {shipMoveAnim && shipMoveAnim.path?.length >= 2 && (
              <ShipMoveAnimation
                path={shipMoveAnim.path}
                playerColor={shipMoveAnim.playerColor}
                ship={shipMoveAnim.ship}
                layout={zoomedLayout}
                canvasW={canvasW}
                canvasH={canvasH}
                onComplete={onShipMoveComplete}
              />
            )}
            {/* Storm lightning flash overlay */}
            {stormAnim && stormAnim.center && (
              <StormAnimation
                center={stormAnim.center}
                layout={zoomedLayout}
                canvasW={canvasW}
                canvasH={canvasH}
                onComplete={onStormComplete}
              />
            )}
            {/* Event animation overlay (turn transition, trade, treaty, etc.) */}
            {eventAnim && (
              <EventAnimation
                icon={eventAnim.icon}
                title={eventAnim.title}
                subtitle={eventAnim.subtitle}
                color={eventAnim.color}
                onComplete={onEventComplete}
              />
            )}
            {/* Resource draw animation */}
            {resourceDrawAnim && (
              <ResourceDrawAnimation
                playerName={resourceDrawAnim.playerName}
                drawn={resourceDrawAnim.drawn}
                count={resourceDrawAnim.count}
                isLocal={resourceDrawAnim.isLocal}
                onComplete={onResourceDrawComplete}
              />
            )}
            {/* Game start animation */}
            {gameStartAnim && (
              <GameStartAnimation onComplete={onGameStartComplete} />
            )}
            {/* Game over animation */}
            {gameOverAnim && (
              <GameOverAnimation
                winnerName={gameOverAnim.winnerName}
                onComplete={onGameOverComplete}
              />
            )}
            {/* Animation overlays - positioned relative to rendered canvas size */}
            {animations?.length > 0 && (
              <div className="absolute inset-0 pointer-events-none overflow-visible">
                {animations.map(anim => {
                  const hasPos = anim.col != null && anim.row != null;
                  if (hasPos) {
                    const xPct = ((zoomedLayout.gridPad + anim.col * zoomedLayout.tileSize + zoomedLayout.tileSize / 2) / canvasW) * 100;
                    const yPct = ((zoomedLayout.gridPad + anim.row * zoomedLayout.tileSize) / canvasH) * 100;
                    return (
                      <div key={anim.id} className="absolute anim-board-popup-at"
                        style={{ left: `${xPct}%`, top: `${yPct}%`, animationDuration: `${anim.duration}ms` }}>
                        <div className="bg-pirate-dark/90 border border-pirate-gold/60 rounded-lg px-3 py-2 text-center shadow-lg shadow-black/50 whitespace-nowrap">
                          <span className="text-lg">{anim.icon}</span>
                          <p className="text-xs text-pirate-tan font-bold mt-0.5">{anim.text}</p>
                        </div>
                      </div>
                    );
                  }
                  // No position: show centered on board
                  return (
                    <div key={anim.id} className="absolute inset-0 flex items-center justify-center anim-board-popup-center"
                      style={{ animationDuration: `${anim.duration}ms` }}>
                      <div className="bg-pirate-dark/90 border border-pirate-gold/60 rounded-lg px-5 py-3 text-center shadow-lg shadow-black/50">
                        <span className="text-2xl">{anim.icon}</span>
                        <p className="text-sm text-pirate-tan font-bold mt-1">{anim.text}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        {/* Reset view button — resets zoom and scroll position */}
        {zoomLevel !== 1.0 && (
          <div className="absolute bottom-3 left-3 z-10 flex items-center gap-1.5
                          bg-pirate-dark/80 border border-pirate-tan/20 rounded px-2 py-1
                          text-pirate-tan/70 text-xs select-none cursor-pointer
                          hover:border-pirate-tan/40 hover:text-pirate-tan transition"
               onClick={() => {
                 setZoomLevel(1.0);
                 const container = boardContainerRef.current;
                 if (container) {
                   // Double-RAF ensures scroll reset happens after React re-render
                   requestAnimationFrame(() => {
                     requestAnimationFrame(() => {
                       container.scrollLeft = 0;
                       container.scrollTop = 0;
                     });
                   });
                 }
               }}
               title="Reset zoom and pan">
            🔍 {Math.round(zoomLevel * 100)}% — Reset View
          </div>
        )}
        </div>

        {/* Right panel */}
        <div className="border-l border-pirate-tan/20 bg-pirate-brown/40 flex flex-col"
             style={{ width: SIDEBAR_W }}>
          {/* Tab bar */}
          <div className="flex border-b border-pirate-tan/20 bg-pirate-dark/40 shrink-0">
            <button
              onClick={() => switchTab('controls')}
              className={`flex-1 px-3 py-2 text-sm font-pirate transition-colors
                ${activeTab === 'controls'
                  ? 'text-pirate-gold border-b-2 border-pirate-gold'
                  : 'text-pirate-tan/50 hover:text-pirate-tan/80'}`}
            >
              Controls
            </button>
            <button
              onClick={() => switchTab('log')}
              className={`flex-1 px-3 py-2 text-sm font-pirate transition-colors relative
                ${activeTab === 'log'
                  ? 'text-pirate-gold border-b-2 border-pirate-gold'
                  : 'text-pirate-tan/50 hover:text-pirate-tan/80'}`}
            >
              Chat & Log
              {unreadCount > 0 && activeTab !== 'log' && (
                <span className="absolute -top-0.5 ml-1 inline-flex items-center justify-center
                                 min-w-[18px] h-[18px] px-1 rounded-full bg-pirate-gold text-pirate-dark
                                 text-[10px] font-bold">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>
            {/* Animation speed toggle */}
            <div className="anim-speed-toggle">
              <span className="anim-speed-label">⏱</span>
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  onClick={() => setAnimSpeed(n)}
                  className={`anim-speed-btn ${animSpeed === n ? 'anim-speed-btn-active' : ''}`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          {/* Tab content */}
          {activeTab === 'controls' ? (
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
              panelAutoOpen={panelAutoOpen}
            />
          ) : (
            <ChatLog messages={messages} emit={emit} />
          )}
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
  // Canonical wall key (matches server's wallKey and renderer's canonicalWallKey)
  const wKey = (c1, r1, c2, r2) =>
    (c1 < c2 || (c1 === c2 && r1 < r2))
      ? `${c1},${r1}|${c2},${r2}`
      : `${c2},${r2}|${c1},${r1}`;

  const wallSet = new Set((gameState.walls || []).map(
    w => wKey(w.col1, w.row1, w.col2, w.row2)
  ));

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

      // Skip neighbors that are on the other side of a wall from current
      if (wallSet.has(wKey(current.col, current.row, nc, nr))) continue;

      // Port entry must come in through an open side (matches server validation)
      if (tile.type === 'port' && tile.openSides) {
        let approachDir;
        if (dr === -1) approachDir = 'S';
        else if (dr === 1) approachDir = 'N';
        else if (dc === -1) approachDir = 'E';
        else if (dc === 1) approachDir = 'W';
        if (approachDir && !tile.openSides.includes(approachDir)) continue;
      }

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
