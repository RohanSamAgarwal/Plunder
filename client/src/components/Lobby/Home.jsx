import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSocketContext, usePlayerContext } from '../../App';

const EVENTS = {
  CREATE_ROOM: 'create-room',
  JOIN_ROOM: 'join-room',
};

function loadSavedSession() {
  for (const key of ['plunder-player', 'plunder_session']) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (parsed?.sessionToken && parsed?.roomCode && parsed?.name) return parsed;
    } catch { /* ignore malformed */ }
  }
  return null;
}

function clearSavedSession() {
  try {
    localStorage.removeItem('plunder-player');
    localStorage.removeItem('plunder_session');
  } catch { /* ignore */ }
}

export default function Home() {
  const { emit, connected } = useSocketContext();
  const { setPlayerInfo } = usePlayerContext();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [savedSession, setSavedSession] = useState(() => loadSavedSession());

  async function handleCreate() {
    if (!name.trim()) return setError('Enter your pirate name!');
    setLoading(true);
    setError('');

    const result = await emit(EVENTS.CREATE_ROOM, { name: name.trim() });
    if (result?.error) {
      setError(result.error);
      setLoading(false);
      return;
    }

    const info = {
      playerId: result.playerId,
      sessionToken: result.sessionToken,
      name: name.trim(),
      roomCode: result.code,
    };
    setPlayerInfo(info);
    try { localStorage.setItem('plunder_session', JSON.stringify(info)); } catch {}
    navigate(`/game/${result.code}`);
  }

  async function handleJoin() {
    if (!name.trim()) return setError('Enter your pirate name!');
    if (!joinCode.trim()) return setError('Enter a room code!');
    setLoading(true);
    setError('');

    const result = await emit(EVENTS.JOIN_ROOM, {
      code: joinCode.trim().toUpperCase(),
      name: name.trim(),
    });

    if (result?.error) {
      setError(result.error);
      setLoading(false);
      return;
    }

    const info = {
      playerId: result.playerId,
      sessionToken: result.sessionToken,
      name: name.trim(),
      roomCode: result.code,
    };
    setPlayerInfo(info);
    try { localStorage.setItem('plunder_session', JSON.stringify(info)); } catch {}
    navigate(`/game/${result.code}`);
  }

  function handleRejoin() {
    if (!savedSession) return;
    // Make sure playerInfo reflects the saved session so GamePage's
    // auto-reconnect sends the right sessionToken.
    setPlayerInfo(savedSession);
    navigate(`/game/${savedSession.roomCode}`);
  }

  function handleClearSaved() {
    clearSavedSession();
    setSavedSession(null);
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        {/* Title */}
        <div className="text-center mb-8">
          <h1 className="font-pirate text-5xl text-pirate-gold mb-2">
            Plunder
          </h1>
          <p className="font-pirate text-2xl text-pirate-tan">
            A Pirate's Life
          </p>
          <p className="text-sm text-gray-400 mt-2">
            ⚓ Command your fleet. Conquer islands. Rule the seas.
          </p>
        </div>

        {/* Connection status */}
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-xs text-gray-400">
            {connected ? 'Connected to server' : 'Connecting...'}
          </span>
        </div>

        {/* Rejoin banner — shown when a saved session is found */}
        {savedSession && (
          <div className="mb-5 bg-pirate-brown/80 border border-pirate-gold/50 rounded-lg p-4 shadow-lg shadow-black/40">
            <p className="text-[11px] uppercase tracking-wider text-pirate-gold/80 mb-1">Previous game</p>
            <p className="text-sm text-pirate-tan mb-3">
              You were last playing as <strong className="text-white">{savedSession.name}</strong>{' '}
              in <strong className="text-white font-mono">{savedSession.roomCode}</strong>.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleRejoin}
                disabled={!connected || loading}
                className="flex-1 bg-pirate-gold text-pirate-dark font-bold py-2 rounded
                           hover:bg-yellow-500 transition disabled:opacity-40 disabled:cursor-not-allowed text-sm">
                ⚓ Rejoin Game
              </button>
              <button
                onClick={handleClearSaved}
                className="bg-pirate-dark border border-pirate-tan/30 text-pirate-tan/70 px-3 py-2 rounded
                           hover:border-red-500/50 hover:text-red-400 transition text-xs">
                Forget
              </button>
            </div>
          </div>
        )}

        {/* Card */}
        <div className="bg-pirate-brown/60 border border-pirate-tan/20 rounded-lg p-6 space-y-6">
          {/* Name input */}
          <div>
            <label className="block text-sm text-pirate-tan mb-1">Your Pirate Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Captain Blackbeard"
              maxLength={20}
              className="w-full bg-pirate-dark border border-pirate-tan/30 rounded px-3 py-2
                         text-white placeholder-gray-500 focus:outline-none focus:border-pirate-gold"
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
          </div>

          {/* Create Game */}
          <button
            onClick={handleCreate}
            disabled={!connected || loading}
            className="w-full bg-pirate-gold text-pirate-dark font-bold py-3 rounded
                       hover:bg-yellow-500 transition disabled:opacity-50 disabled:cursor-not-allowed
                       font-pirate text-xl"
          >
            ⚔️ Create Game
          </button>

          {/* Divider */}
          <div className="flex items-center gap-4">
            <div className="flex-1 border-t border-pirate-tan/20" />
            <span className="text-pirate-tan/50 text-sm">or join a crew</span>
            <div className="flex-1 border-t border-pirate-tan/20" />
          </div>

          {/* Join Game */}
          <div className="flex gap-2">
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="ROOM-CODE-42"
              className="flex-1 bg-pirate-dark border border-pirate-tan/30 rounded px-3 py-2
                         text-white placeholder-gray-500 focus:outline-none focus:border-pirate-gold
                         uppercase tracking-wider"
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            />
            <button
              onClick={handleJoin}
              disabled={!connected || loading}
              className="bg-pirate-sea border border-pirate-tan/30 text-white px-4 py-2 rounded
                         hover:bg-pirate-sea/80 transition disabled:opacity-50"
            >
              Join
            </button>
          </div>

          {/* Error */}
          {error && (
            <p className="text-red-400 text-sm text-center animate-fade-in">
              ☠️ {error}
            </p>
          )}
        </div>

        <p className="text-center text-gray-500 text-xs mt-4">
          2–6 players • ~60 minutes • No account needed
        </p>
      </div>
    </div>
  );
}
