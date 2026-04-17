import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSocketContext, usePlayerContext, useAnimSpeed } from '../../App';
import Lobby from './Lobby';
import GameView from './GameView';

const EVENTS = {
  JOIN_ROOM: 'join-room',
  PLAYER_JOINED: 'player-joined',
  PLAYER_LEFT: 'player-left',
  PLAYER_RECONNECTED: 'player-reconnected',
  START_GAME: 'start-game',
  GAME_STARTED: 'game-started',
  GAME_STATE_UPDATE: 'game-state-update',
  COLOR_CHOSEN: 'color-chosen',
  SETTINGS_UPDATED: 'settings-updated',
  CHAT_BROADCAST: 'chat-broadcast',
  TURN_ENDED: 'turn-ended',
  DIE_ROLLED: 'die-rolled',
  COMBAT_RESULT: 'combat-result',
  TRADE_PROPOSED: 'trade-proposed',
  TRADE_RESOLVED: 'trade-resolved',
  BUILT: 'built',
  TREASURE_COLLECTED: 'treasure-collected',
  TREASURE_DECK_RESHUFFLED: 'treasure-deck-reshuffled',
  TREATY_PROPOSED: 'treaty-proposed',
  TREATY_RESOLVED: 'treaty-resolved',
  ATTACK_BRIBE_PENDING: 'attack-bribe-pending',
  ATTACK_BRIBE_DECISION: 'attack-bribe-decision',
  ATTACK_BRIBE_RESOLVED: 'attack-bribe-resolved',
  SHIP_MOVED: 'ship-moved',
  STORM_SPAWNED: 'storm-spawned',
  RESOURCES_DRAWN: 'resources-drawn',
};

let animIdCounter = 0;

// localStorage helpers for session persistence
function saveSession(data) {
  try { localStorage.setItem('plunder_session', JSON.stringify(data)); } catch {}
}
function loadSession() {
  try { return JSON.parse(localStorage.getItem('plunder_session')); } catch { return null; }
}
function clearSession() {
  try { localStorage.removeItem('plunder_session'); } catch {}
}

export default function GamePage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { emit, on, connected } = useSocketContext();
  const { playerInfo, setPlayerInfo } = usePlayerContext();
  const { animSpeed } = useAnimSpeed();

  const [room, setRoom] = useState(null);
  const [gameState, setGameState] = useState(null);
  const [messages, setMessages] = useState([]);
  const [pendingTrade, setPendingTrade] = useState(null);
  const [pendingTreaty, setPendingTreaty] = useState(null);
  const [pendingAttackBribe, setPendingAttackBribe] = useState(null);
  const [attackBribeDecision, setAttackBribeDecision] = useState(null);
  const [skipVoteActive, setSkipVoteActive] = useState(false);
  const [drawnCard, setDrawnCard] = useState(null);
  const [deckShuffling, setDeckShuffling] = useState(false);
  const [animations, setAnimations] = useState([]);
  const [diceRollAnim, setDiceRollAnim] = useState(null);
  const [cannonFireAnim, setCannonFireAnim] = useState(null);
  const [combatAnim, setCombatAnim] = useState(null);
  const pendingCombatRef = useRef(null);
  const [buildAnim, setBuildAnim] = useState(null);
  const [shipLaunchAnim, setShipLaunchAnim] = useState(null);
  const [shipMoveAnim, setShipMoveAnim] = useState(null);
  const [stormAnim, setStormAnim] = useState(null);
  const [eventAnim, setEventAnim] = useState(null);
  const [resourceDrawAnim, setResourceDrawAnim] = useState(null);
  const [gameStartAnim, setGameStartAnim] = useState(false);
  const [gameOverAnim, setGameOverAnim] = useState(null);
  const [needsJoin, setNeedsJoin] = useState(false);
  const [joinName, setJoinName] = useState('');
  const [error, setError] = useState('');

  // Auto-join via invite link or reconnect from localStorage
  useEffect(() => {
    if (!connected) return;

    // Try to restore session from localStorage if we don't have playerInfo
    let info = playerInfo;
    if (!info?.roomCode && code) {
      const saved = loadSession();
      if (saved?.roomCode === code) {
        info = saved;
        setPlayerInfo(saved);
      }
    }

    if (info?.roomCode === code) {
      // Try reconnecting with session token
      emit(EVENTS.JOIN_ROOM, {
        code,
        name: info.name,
        sessionToken: info.sessionToken,
      }).then((result) => {
        if (result?.error) {
          clearSession();
          setNeedsJoin(true);
        } else {
          setRoom(result.room);
          if (result.gameState) {
            setGameState(result.gameState);
          }
        }
      });
    } else {
      setNeedsJoin(true);
    }
  }, [connected, code]);

  // Socket event listeners
  useEffect(() => {
    if (!connected) return;

    const unsubs = [
      on(EVENTS.PLAYER_JOINED, ({ player, room: r }) => {
        setRoom(r);
        if (player?.name) {
          addSystemMessage(`${player.name} joined the game`);
          setEventAnim({ icon: '⚓', title: `${player.name} Joined!`, color: '#4ade80' });
        }
      }),
      on(EVENTS.PLAYER_LEFT, ({ name, room: r }) => {
        setRoom(r);
        if (name) {
          addSystemMessage(`${name} left the game`);
          setEventAnim({ icon: '🚢', title: `${name} Left`, color: '#f87171' });
        }
      }),
      on(EVENTS.PLAYER_RECONNECTED, ({ playerId, name }) => {
        addSystemMessage(`${name} reconnected`);
        setEventAnim({ icon: '⚓', title: `${name} Reconnected`, color: '#4ade80' });
      }),
      on(EVENTS.COLOR_CHOSEN, ({ room: r }) => setRoom(r)),
      on(EVENTS.SETTINGS_UPDATED, ({ room: r }) => setRoom(r)),
      on(EVENTS.GAME_STARTED, ({ gameState: gs, yourPlayerId, startingIslands }) => {
        setGameState(gs);
        setGameStartAnim(true);
      }),
      on(EVENTS.GAME_STATE_UPDATE, ({ gameState: gs }) => {
        // Detect game over
        if (gs.phase === 'game_over' && gs.winner && !gameOverAnim) {
          const winnerPlayer = gs.players?.[gs.winner];
          setGameOverAnim({ winnerName: winnerPlayer?.name || 'Unknown' });
        }
        setGameState(gs);
      }),
      on(EVENTS.CHAT_BROADCAST, (msg) => {
        setMessages(prev => [...prev, msg]);
      }),
      on(EVENTS.TURN_ENDED, ({ nextPlayer, nextPlayerName }) => {
        // Clear pending modals on turn end
        setPendingTrade(null);
        setPendingTreaty(null);
        setPendingAttackBribe(null);
        setAttackBribeDecision(null);
        setSkipVoteActive(false);
        setEventAnim({ icon: '🏴‍☠️', title: `${nextPlayerName || 'Next'}'s Turn`, color: '#d4a017' });
      }),
      on(EVENTS.DIE_ROLLED, ({ playerId, playerName, roll, totalMovePoints, reroll, stormMoved }) => {
        if (stormMoved) addSystemMessage('The storm has moved!');
        addSystemMessage(`${playerName || 'A player'} rolled a ${roll} (${totalMovePoints} move${totalMovePoints !== 1 ? 's' : ''})`);
        setDiceRollAnim({
          roll,
          totalMovePoints,
          isReroll: !!reroll,
          playerName: playerName || 'A player',
        });
      }),
      on(EVENTS.COMBAT_RESULT, (result) => {
        if (result.type === 'island') {
          const won = result.won;
          const target = result.islandName ? `**${result.islandName}**` : 'an island';
          addSystemMessage(`${result.attacker} ${won ? 'conquered' : 'failed to take'} ${target}! (${result.attackRoll} vs ${result.defenseRoll})`);
        } else {
          const won = result.attackerWon;
          addSystemMessage(`Ship combat! ${result.attacker} ${won ? 'won' : 'lost'}! (${result.attackRoll} vs ${result.defenseRoll})`);
        }
        // Two-phase: cannon fire first, then dice overlay
        if (result.attackerLocation && result.defenderLocation) {
          pendingCombatRef.current = result;
          setCannonFireAnim(result);
        } else {
          // No positions available (bribe/reroll path) — skip cannon fire
          setCombatAnim(result);
        }
        // Queue follow-up event animation for island capture or ship sunk
        // Delay accounts for cannon fire (~1500ms×m) + dice (~3800ms×m)
        const sm = animSpeed / 3; // speed multiplier
        const cannonDelay = (result.attackerLocation && result.defenderLocation) ? 1500 * sm : 0;
        const diceDelay = 3800 * sm;
        if (result.type === 'island' && result.won) {
          setTimeout(() => setEventAnim({ icon: '🏴‍☠️', title: 'Island Captured!', subtitle: `${result.attacker} seized the island`, color: '#4ade80' }), cannonDelay + diceDelay);
        } else if (result.sunk) {
          const sunkName = result.attackerWon ? result.defender : result.attacker;
          setTimeout(() => setEventAnim({ icon: '💀', title: 'Ship Sunk!', subtitle: `${sunkName}'s ship was destroyed`, color: '#f87171' }), cannonDelay + diceDelay);
        }
      }),
      on(EVENTS.TRADE_PROPOSED, (trade) => {
        setPendingTrade(trade);
      }),
      on(EVENTS.TRADE_RESOLVED, (data) => {
        setPendingTrade(null);
        if (data.fromName && data.toName) {
          if (data.offer) {
            addSystemMessage(data.accepted
              ? `Trade completed between ${data.fromName} and ${data.toName}!`
              : `Trade declined between ${data.fromName} and ${data.toName}.`);
          } else {
            addSystemMessage(data.accepted
              ? `${data.fromName} and ${data.toName} completed a trade.`
              : `${data.fromName} and ${data.toName} declined a trade.`);
          }
        } else {
          addSystemMessage(data.accepted ? 'Trade completed!' : 'Trade declined.');
        }
        setEventAnim({
          icon: data.accepted ? '🤝' : '❌',
          title: data.accepted ? 'Trade Completed!' : 'Trade Declined',
          subtitle: data.fromName && data.toName ? `${data.fromName} & ${data.toName}` : undefined,
          color: data.accepted ? '#4ade80' : '#f87171',
        });
      }),
      on(EVENTS.BUILT, ({ playerName, buildType, location }) => {
        const label = buildType === 'ship' ? 'a ship' : buildType === 'plunderPoint' ? 'a plunder point' : `a ${buildType}`;
        addSystemMessage(`${playerName} built ${label}`);
        if (buildType === 'ship') {
          setShipLaunchAnim({ playerName, location });
        } else {
          setBuildAnim({ playerName, buildType, location });
          // Extra event animations for special builds
          if (buildType === 'plunderPoint') {
            setTimeout(() => setEventAnim({ icon: '⭐', title: 'Plunder Point!', subtitle: `${playerName} bought a plunder point`, color: '#eab308' }), 1500);
          } else if (buildType === 'lifePeg') {
            setTimeout(() => setEventAnim({ icon: '🔧', title: 'Ship Repaired!', subtitle: `${playerName} restored a life peg`, color: '#4ade80' }), 1500);
          }
        }
      }),
      on(EVENTS.SHIP_MOVED, ({ playerName, playerColor, path, arrivedAtPort, ship }) => {
        setShipMoveAnim({ playerName, playerColor, path, ship });
        if (arrivedAtPort) {
          const pathLen = path?.length || 0;
          setTimeout(() => setEventAnim({ icon: '⚓', title: 'Port Arrival', subtitle: `${playerName} docked at port`, color: '#60a5fa' }), pathLen * 180 + 300);
        }
      }),
      on(EVENTS.STORM_SPAWNED, ({ center }) => {
        addSystemMessage('⚡ The storm has moved!');
        setStormAnim({ center });
      }),
      on(EVENTS.RESOURCES_DRAWN, ({ playerName, playerId, drawn, count }) => {
        const isLocal = playerId === playerInfo?.playerId;
        if (isLocal && drawn) {
          // Local player: show detailed resource breakdown in chat
          const counts = {};
          drawn.forEach(r => { counts[r] = (counts[r] || 0) + 1; });
          const summary = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ');
          if (summary) addSystemMessage(`You drew ${summary}`);
        } else {
          addSystemMessage(`${playerName} drew ${count} resource card${count !== 1 ? 's' : ''}`);
        }
        setResourceDrawAnim({ playerName, drawn: drawn || null, count: count || 0, isLocal });
      }),
      on(EVENTS.TREASURE_COLLECTED, ({ playerName, card }) => {
        addSystemMessage(`${playerName} found treasure: ${card.description}`);
        setDrawnCard({ playerName, card });
      }),
      on(EVENTS.TREASURE_DECK_RESHUFFLED, () => {
        setDeckShuffling(true);
        setTimeout(() => setDeckShuffling(false), 5000);
      }),
      on(EVENTS.TREATY_PROPOSED, (treaty) => {
        setPendingTreaty(treaty);
      }),
      on(EVENTS.TREATY_RESOLVED, ({ accepted, proposerId, targetId }) => {
        setPendingTreaty(null);
        addSystemMessage(accepted ? 'Treaty agreed! No attacks this turn.' : 'Treaty declined.');
        setEventAnim({
          icon: accepted ? '🕊️' : '⚔️',
          title: accepted ? 'Treaty Agreed!' : 'Treaty Declined',
          color: accepted ? '#4ade80' : '#f87171',
        });
      }),
      on(EVENTS.ATTACK_BRIBE_PENDING, (data) => {
        setPendingAttackBribe(data);
      }),
      on(EVENTS.ATTACK_BRIBE_DECISION, (data) => {
        setAttackBribeDecision(data);
        setPendingAttackBribe(null);
      }),
      on(EVENTS.ATTACK_BRIBE_RESOLVED, (data) => {
        setPendingAttackBribe(null);
        setAttackBribeDecision(null);
        if (data.attackCancelled && data.bribe) {
          addSystemMessage(`${data.attackerName} accepted a bribe and cancelled the attack.`);
          setEventAnim({ icon: '💰', title: 'Bribe Accepted!', subtitle: 'Attack cancelled', color: '#eab308' });
        } else if (data.attackCancelled) {
          addSystemMessage(`${data.attackerName} cancelled the attack.`);
        } else if (data.outcome === 'bribe_accepted_and_attacked') {
          addSystemMessage(`${data.attackerName} accepted the bribe but attacked anyway!`);
          setEventAnim({ icon: '🏴‍☠️', title: 'Betrayal!', subtitle: `${data.attackerName} took the bribe AND attacked!`, color: '#f87171' });
        } else if (data.outcome === 'bribe_rejected') {
          addSystemMessage(`${data.attackerName} rejected the bribe and attacked!`);
          setEventAnim({ icon: '⚔️', title: 'Bribe Rejected!', subtitle: 'Prepare for battle!', color: '#f87171' });
        }
      }),
      on(EVENTS.TREASURE_STEAL_RESOLVED, ({ thiefName, targetName, count }) => {
        addSystemMessage(`${thiefName} stole ${count} resource${count !== 1 ? 's' : ''} from ${targetName}!`);
      }),
      on(EVENTS.TURN_TIMER_VOTE_START, () => {
        setSkipVoteActive(true);
      }),
      on(EVENTS.TURN_TIMER_VOTE_RESULT, ({ passed, skippedPlayerName }) => {
        setSkipVoteActive(false);
        if (passed) {
          addSystemMessage(`Vote passed! ${skippedPlayerName}'s turn was skipped.`);
          setEventAnim({ icon: '⏭️', title: 'Turn Skipped!', subtitle: `${skippedPlayerName} was voted out`, color: '#f59e0b' });
        } else {
          addSystemMessage('Vote failed — turn continues.');
        }
      }),
      on(EVENTS.TURN_TIMER_EXPIRED, ({ skippedPlayerName }) => {
        setSkipVoteActive(false);
        addSystemMessage(`Time's up! ${skippedPlayerName}'s turn was auto-skipped.`);
        setEventAnim({ icon: '⏰', title: 'Time Expired!', subtitle: `${skippedPlayerName}'s turn ended`, color: '#ef4444' });
      }),
    ];

    return () => unsubs.forEach(u => u?.());
  }, [connected, on]);

  function addSystemMessage(text) {
    setMessages(prev => [...prev, {
      system: true,
      message: text,
      timestamp: Date.now(),
    }]);
  }

  function addAnimation(type, icon, text, location, duration = 3000) {
    const id = ++animIdCounter;
    const anim = { id, type, icon, text, col: location?.col, row: location?.row, duration };
    setAnimations(prev => [...prev, anim]);
    setTimeout(() => {
      setAnimations(prev => prev.filter(a => a.id !== id));
    }, duration);
  }

  async function handleJoinFromLink() {
    if (!joinName.trim()) return setError('Enter your name!');
    const result = await emit(EVENTS.JOIN_ROOM, {
      code,
      name: joinName.trim(),
    });
    if (result?.error) {
      setError(result.error);
      return;
    }
    const info = {
      playerId: result.playerId,
      sessionToken: result.sessionToken,
      name: joinName.trim(),
      roomCode: result.code,
    };
    setPlayerInfo(info);
    saveSession(info); // persist to localStorage
    setRoom(result.room);
    setNeedsJoin(false);
    if (result.gameState) setGameState(result.gameState);
  }

  // Join-from-link screen
  if (needsJoin) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-sm w-full bg-pirate-brown/60 border border-pirate-tan/20 rounded-lg p-6">
          <h2 className="font-pirate text-3xl text-pirate-gold text-center mb-2">
            Join the Crew
          </h2>
          <p className="text-center text-pirate-tan/70 text-sm mb-4">
            Room: <span className="font-mono text-white">{code}</span>
          </p>
          <input
            type="text"
            value={joinName}
            onChange={(e) => setJoinName(e.target.value)}
            placeholder="Your pirate name"
            maxLength={20}
            className="w-full bg-pirate-dark border border-pirate-tan/30 rounded px-3 py-2 mb-3
                       text-white placeholder-gray-500 focus:outline-none focus:border-pirate-gold"
            onKeyDown={(e) => e.key === 'Enter' && handleJoinFromLink()}
          />
          <button
            onClick={handleJoinFromLink}
            disabled={!connected}
            className="w-full bg-pirate-gold text-pirate-dark font-bold py-2 rounded
                       hover:bg-yellow-500 transition font-pirate text-lg"
          >
            Board the Ship
          </button>
          {error && <p className="text-red-400 text-sm text-center mt-2">{error}</p>}
        </div>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-pirate-tan animate-pulse font-pirate text-xl">
          Loading...
        </div>
      </div>
    );
  }

  // Lobby vs Game
  if (!gameState) {
    return (
      <Lobby
        room={room}
        playerInfo={playerInfo}
        messages={messages}
        onStartGame={async () => {
          const result = await emit(EVENTS.START_GAME, {});
          if (result?.error) setError(result.error);
        }}
      />
    );
  }

  return (
    <GameView
      gameState={gameState}
      playerInfo={playerInfo}
      messages={messages}
      pendingTrade={pendingTrade}
      pendingTreaty={pendingTreaty}
      pendingAttackBribe={pendingAttackBribe}
      attackBribeDecision={attackBribeDecision}
      drawnCard={drawnCard}
      onDismissCard={() => setDrawnCard(null)}
      deckShuffling={deckShuffling}
      animations={animations}
      diceRollAnim={diceRollAnim}
      onDiceRollComplete={() => setDiceRollAnim(null)}
      cannonFireAnim={cannonFireAnim}
      onCannonFireComplete={() => {
        setCannonFireAnim(null);
        if (pendingCombatRef.current) {
          setCombatAnim(pendingCombatRef.current);
          pendingCombatRef.current = null;
        }
      }}
      combatAnim={combatAnim}
      onCombatComplete={() => setCombatAnim(null)}
      buildAnim={buildAnim}
      onBuildComplete={() => setBuildAnim(null)}
      shipLaunchAnim={shipLaunchAnim}
      onShipLaunchComplete={() => setShipLaunchAnim(null)}
      shipMoveAnim={shipMoveAnim}
      onShipMoveComplete={() => setShipMoveAnim(null)}
      stormAnim={stormAnim}
      onStormComplete={() => setStormAnim(null)}
      eventAnim={eventAnim}
      onEventComplete={() => setEventAnim(null)}
      resourceDrawAnim={resourceDrawAnim}
      onResourceDrawComplete={() => setResourceDrawAnim(null)}
      gameStartAnim={gameStartAnim}
      onGameStartComplete={() => setGameStartAnim(false)}
      gameOverAnim={gameOverAnim}
      onGameOverComplete={() => setGameOverAnim(null)}
      roomCode={code}
      skipVoteActive={skipVoteActive}
    />
  );
}
