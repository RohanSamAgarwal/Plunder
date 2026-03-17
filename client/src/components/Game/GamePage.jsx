import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSocketContext, usePlayerContext } from '../../App';
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

  const [room, setRoom] = useState(null);
  const [gameState, setGameState] = useState(null);
  const [messages, setMessages] = useState([]);
  const [pendingTrade, setPendingTrade] = useState(null);
  const [pendingTreaty, setPendingTreaty] = useState(null);
  const [pendingAttackBribe, setPendingAttackBribe] = useState(null);
  const [attackBribeDecision, setAttackBribeDecision] = useState(null);
  const [drawnCard, setDrawnCard] = useState(null);
  const [deckShuffling, setDeckShuffling] = useState(false);
  const [animations, setAnimations] = useState([]);
  const [diceRollAnim, setDiceRollAnim] = useState(null);
  const [combatAnim, setCombatAnim] = useState(null);
  const [buildAnim, setBuildAnim] = useState(null);
  const [shipLaunchAnim, setShipLaunchAnim] = useState(null);
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
      on(EVENTS.PLAYER_JOINED, ({ room: r }) => setRoom(r)),
      on(EVENTS.PLAYER_LEFT, ({ room: r }) => setRoom(r)),
      on(EVENTS.PLAYER_RECONNECTED, ({ playerId, name }) => {
        addSystemMessage(`${name} reconnected`);
      }),
      on(EVENTS.COLOR_CHOSEN, ({ room: r }) => setRoom(r)),
      on(EVENTS.SETTINGS_UPDATED, ({ room: r }) => setRoom(r)),
      on(EVENTS.GAME_STARTED, ({ gameState: gs, yourPlayerId, startingIslands }) => {
        setGameState(gs);
      }),
      on(EVENTS.GAME_STATE_UPDATE, ({ gameState: gs }) => {
        setGameState(gs);
      }),
      on(EVENTS.CHAT_BROADCAST, (msg) => {
        setMessages(prev => [...prev, msg]);
      }),
      on(EVENTS.TURN_ENDED, ({ nextPlayer }) => {
        // Clear pending modals on turn end
        setPendingTrade(null);
        setPendingTreaty(null);
        setPendingAttackBribe(null);
        setAttackBribeDecision(null);
      }),
      on(EVENTS.DIE_ROLLED, ({ playerId, playerName, roll, totalMovePoints, reroll, stormMoved }) => {
        if (stormMoved) addSystemMessage('The storm has moved!');
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
          addSystemMessage(`${result.attacker} ${won ? 'conquered' : 'failed to take'} an island! (${result.attackRoll} vs ${result.defenseRoll})`);
        } else {
          const won = result.attackerWon;
          addSystemMessage(`Ship combat! ${result.attacker} ${won ? 'won' : 'lost'}! (${result.attackRoll} vs ${result.defenseRoll})`);
        }
        setCombatAnim(result);
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
        addAnimation('trade', data.accepted ? '\uD83E\uDD1D' : '\u274C', data.accepted ? 'Trade completed!' : 'Trade declined', null, data.accepted ? 2500 : 2000);
      }),
      on(EVENTS.BUILT, ({ playerName, buildType, location }) => {
        const label = buildType === 'ship' ? 'a ship' : buildType === 'plunderPoint' ? 'a plunder point' : `a ${buildType}`;
        addSystemMessage(`${playerName} built ${label}`);
        if (buildType === 'ship') {
          setShipLaunchAnim({ playerName, location });
        } else {
          setBuildAnim({ playerName, buildType, location });
        }
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
        } else if (data.attackCancelled) {
          addSystemMessage(`${data.attackerName} cancelled the attack.`);
        } else if (data.outcome === 'bribe_accepted_and_attacked') {
          addSystemMessage(`${data.attackerName} accepted the bribe but attacked anyway!`);
        } else if (data.outcome === 'bribe_rejected') {
          addSystemMessage(`${data.attackerName} rejected the bribe and attacked!`);
        }
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
      combatAnim={combatAnim}
      onCombatComplete={() => setCombatAnim(null)}
      buildAnim={buildAnim}
      onBuildComplete={() => setBuildAnim(null)}
      shipLaunchAnim={shipLaunchAnim}
      onShipLaunchComplete={() => setShipLaunchAnim(null)}
      roomCode={code}
    />
  );
}
