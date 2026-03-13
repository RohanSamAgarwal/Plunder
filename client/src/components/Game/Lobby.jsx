import { useState } from 'react';
import { useSocketContext } from '../../App';

const PLAYER_COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange'];
const COLOR_HEX = {
  red: '#ef4444', blue: '#3b82f6', green: '#22c55e',
  yellow: '#eab308', purple: '#a855f7', orange: '#f97316',
};

export default function Lobby({ room, playerInfo, messages, onStartGame }) {
  const { emit } = useSocketContext();
  const [chatInput, setChatInput] = useState('');
  const [copied, setCopied] = useState(false);

  const isHost = playerInfo?.playerId === room.hostId;
  const inviteLink = `${window.location.origin}/game/${room.code}`;

  function copyLink() {
    navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function sendChat() {
    if (!chatInput.trim()) return;
    emit('chat-message', { message: chatInput.trim() });
    setChatInput('');
  }

  async function changeColor(color) {
    await emit('choose-color', { color });
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-lg w-full space-y-4">
        {/* Header */}
        <div className="text-center">
          <h1 className="font-pirate text-4xl text-pirate-gold">⚓ Crew Assembly</h1>
          <p className="text-pirate-tan/70 mt-1">Waiting for players to join...</p>
        </div>

        {/* Room Code & Invite */}
        <div className="bg-pirate-brown/60 border border-pirate-tan/20 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-pirate-tan text-sm">Room Code</span>
            <span className="font-mono text-xl text-white tracking-widest">{room.code}</span>
          </div>
          <button
            onClick={copyLink}
            className="w-full bg-pirate-dark border border-pirate-tan/30 rounded px-3 py-2
                       text-sm text-pirate-tan hover:border-pirate-gold transition truncate"
          >
            {copied ? '✅ Link copied!' : `📋 Copy invite link`}
          </button>
        </div>

        {/* Players */}
        <div className="bg-pirate-brown/60 border border-pirate-tan/20 rounded-lg p-4">
          <h3 className="text-pirate-tan text-sm mb-3">
            Crew ({room.players.length}/6)
          </h3>
          <div className="space-y-2">
            {room.players.map((p) => (
              <div key={p.id} className="flex items-center gap-3 bg-pirate-dark/50 rounded px-3 py-2">
                <div
                  className="w-4 h-4 rounded-full border-2 border-white/30"
                  style={{ backgroundColor: COLOR_HEX[p.color] }}
                />
                <span className="flex-1 text-white">
                  {p.name}
                  {p.id === room.hostId && (
                    <span className="text-pirate-gold text-xs ml-2">👑 HOST</span>
                  )}
                  {p.id === playerInfo?.playerId && (
                    <span className="text-gray-400 text-xs ml-2">(you)</span>
                  )}
                </span>
              </div>
            ))}
          </div>

          {/* Color picker for current player */}
          <div className="mt-3 pt-3 border-t border-pirate-tan/10">
            <span className="text-xs text-pirate-tan/70">Your color:</span>
            <div className="flex gap-2 mt-1">
              {PLAYER_COLORS.map((color) => {
                const taken = room.players.some(
                  p => p.color === color && p.id !== playerInfo?.playerId
                );
                const isYours = room.players.find(
                  p => p.id === playerInfo?.playerId
                )?.color === color;
                return (
                  <button
                    key={color}
                    onClick={() => !taken && changeColor(color)}
                    disabled={taken}
                    className={`w-8 h-8 rounded-full border-2 transition
                      ${isYours ? 'border-white scale-110' : 'border-transparent'}
                      ${taken ? 'opacity-30 cursor-not-allowed' : 'hover:scale-110 cursor-pointer'}`}
                    style={{ backgroundColor: COLOR_HEX[color] }}
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* Game Settings */}
        <div className="bg-pirate-brown/60 border border-pirate-tan/20 rounded-lg p-4">
          <h3 className="text-pirate-tan text-sm mb-3">
            ⚙️ Game Settings
            {!isHost && (
              <span className="text-pirate-tan/50 text-xs ml-2">(only the captain can change)</span>
            )}
          </h3>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-pirate-tan/70 mb-1">
                Shipless Captain Mode
              </label>
              <select
                value={room.settings?.shiplessMode ?? 'rulebook'}
                onChange={(e) =>
                  emit('update-settings', {
                    settings: { shiplessMode: e.target.value },
                  })
                }
                disabled={!isHost}
                className={`w-full bg-pirate-dark border border-pirate-tan/30 rounded px-3 py-2
                           text-sm text-white focus:outline-none focus:border-pirate-gold
                           ${!isHost ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <option value="rulebook">Rulebook (Roll Doubles)</option>
                <option value="free_ship">Free Ship Next Turn</option>
                <option value="free_resources">Bonus Resources</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-pirate-tan/70 mb-1">
                Attack Bribe Mode
              </label>
              <select
                value={room.settings?.bribeMode ?? 'none'}
                onChange={(e) =>
                  emit('update-settings', {
                    settings: { bribeMode: e.target.value },
                  })
                }
                disabled={!isHost}
                className={`w-full bg-pirate-dark border border-pirate-tan/30 rounded px-3 py-2
                           text-sm text-white focus:outline-none focus:border-pirate-gold
                           ${!isHost ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <option value="none">None (Instant Attacks)</option>
                <option value="honor">Honor (Bribe Cancels Attack)</option>
                <option value="ruthless">Ruthless (Bribe + Attack Possible)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-pirate-tan/70 mb-1">
                Points to Win
              </label>
              <input
                type="number"
                min={0}
                max={99}
                value={room.settings?.ppToWin ?? 10}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val) && val >= 0 && val <= 99) {
                    emit('update-settings', { settings: { ppToWin: val } });
                  }
                }}
                disabled={!isHost}
                className={`w-full bg-pirate-dark border border-pirate-tan/30 rounded px-3 py-2
                           text-sm text-white focus:outline-none focus:border-pirate-gold
                           ${!isHost ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
              />
            </div>
            <div>
              <label className="block text-xs text-pirate-tan/70 mb-1">
                Trade Knowledge
              </label>
              <select
                value={room.settings?.tradeKnowledge ?? 'open'}
                onChange={(e) =>
                  emit('update-settings', {
                    settings: { tradeKnowledge: e.target.value },
                  })
                }
                disabled={!isHost}
                className={`w-full bg-pirate-dark border border-pirate-tan/30 rounded px-3 py-2
                           text-sm text-white focus:outline-none focus:border-pirate-gold
                           ${!isHost ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <option value="open">Open (Everyone Sees Details)</option>
                <option value="selective">Selective (Names Only)</option>
                <option value="hidden">Hidden (Private Trades)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-pirate-tan/70 mb-1">
                Reroll Mode
              </label>
              <select
                value={room.settings?.rerollMode ?? 'none'}
                onChange={(e) =>
                  emit('update-settings', {
                    settings: { rerollMode: e.target.value },
                  })
                }
                disabled={!isHost}
                className={`w-full bg-pirate-dark border border-pirate-tan/30 rounded px-3 py-2
                           text-sm text-white focus:outline-none focus:border-pirate-gold
                           ${!isHost ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <option value="none">No Rerolls</option>
                <option value="one_per_game">1 Reroll Per Game</option>
                <option value="spend_resources">Spend 3 Resources</option>
              </select>
            </div>
          </div>
        </div>

        {/* Chat */}
        <div className="bg-pirate-brown/60 border border-pirate-tan/20 rounded-lg p-4">
          <div className="h-32 overflow-y-auto mb-2 space-y-1">
            {messages.length === 0 && (
              <p className="text-gray-500 text-sm italic">No messages yet...</p>
            )}
            {messages.map((msg, i) => (
              <div key={i} className="text-sm">
                {msg.system ? (
                  <span className="text-pirate-tan/50 italic">{msg.message}</span>
                ) : (
                  <>
                    <span className="text-pirate-gold">{msg.name}: </span>
                    <span className="text-white">{msg.message}</span>
                  </>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Send a message..."
              className="flex-1 bg-pirate-dark border border-pirate-tan/30 rounded px-3 py-1.5
                         text-sm text-white placeholder-gray-500 focus:outline-none focus:border-pirate-gold"
              onKeyDown={(e) => e.key === 'Enter' && sendChat()}
            />
            <button
              onClick={sendChat}
              className="bg-pirate-sea border border-pirate-tan/30 text-white px-3 py-1.5 rounded text-sm hover:bg-pirate-sea/80"
            >
              Send
            </button>
          </div>
        </div>

        {/* Start Button (host only) */}
        {isHost && (
          <button
            onClick={onStartGame}
            disabled={room.players.length < 2}
            className="w-full bg-pirate-gold text-pirate-dark font-bold py-3 rounded
                       hover:bg-yellow-500 transition disabled:opacity-50 disabled:cursor-not-allowed
                       font-pirate text-xl"
          >
            🏴‍☠️ Set Sail! ({room.players.length} players)
          </button>
        )}
        {!isHost && (
          <p className="text-center text-pirate-tan/50 text-sm">
            Waiting for the captain to start the game...
          </p>
        )}
      </div>
    </div>
  );
}
