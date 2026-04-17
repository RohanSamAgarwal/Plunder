import { useEffect, useState } from 'react';

const API_URL = import.meta.env.PROD ? '' : 'http://localhost:3001';

function loadGameHistory() {
  try {
    const raw = localStorage.getItem('plunder_game_history');
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function saveGameHistory(list) {
  try { localStorage.setItem('plunder_game_history', JSON.stringify(list)); }
  catch { /* ignore */ }
}

function formatTimestamp(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString([], {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch { return iso; }
}

function formatRelativeDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const now = new Date();
  const diff = now - d;
  const day = 24 * 60 * 60 * 1000;
  if (diff < day) return 'Today ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diff < 2 * day) return 'Yesterday';
  return d.toLocaleDateString();
}

export default function GameLogsModal({ open, onClose }) {
  const [history, setHistory] = useState(() => loadGameHistory());
  const [selected, setSelected] = useState(null); // { code, logToken, name }
  const [entries, setEntries] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (open) setHistory(loadGameHistory());
  }, [open]);

  async function fetchLog(item) {
    setSelected(item);
    setEntries(null);
    setError('');
    setLoading(true);
    try {
      const res = await fetch(
        `${API_URL}/api/game-log/${encodeURIComponent(item.code)}?logToken=${encodeURIComponent(item.logToken)}`,
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || `Server returned ${res.status}`);
      } else {
        setEntries(data.entries || []);
      }
    } catch (err) {
      setError(err?.message || 'Failed to fetch log');
    } finally {
      setLoading(false);
    }
  }

  function downloadLog() {
    if (!entries || !selected) return;
    const lines = entries.map(e => JSON.stringify(e)).join('\n');
    const blob = new Blob([lines], { type: 'application/x-ndjson' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `plunder-${selected.code}.jsonl`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function forgetGame(code) {
    const next = history.filter(h => h.code !== code);
    saveGameHistory(next);
    setHistory(next);
    if (selected?.code === code) { setSelected(null); setEntries(null); }
  }

  if (!open) return null;

  const filteredEntries = entries && filter
    ? entries.filter(e =>
        JSON.stringify(e).toLowerCase().includes(filter.toLowerCase()))
    : entries;

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/70 p-3"
         onClick={onClose}>
      <div className="bg-pirate-dark border border-pirate-tan/30 rounded-lg shadow-2xl shadow-black
                      w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-pirate-tan/20 bg-pirate-brown">
          <h2 className="font-pirate text-2xl text-pirate-gold">📜 Previous Game Logs</h2>
          <button onClick={onClose}
            className="text-pirate-tan/60 hover:text-pirate-tan text-xl px-2">✕</button>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* Left column — game list */}
          <div className="w-64 border-r border-pirate-tan/20 overflow-y-auto">
            {history.length === 0 ? (
              <p className="p-4 text-xs text-pirate-tan/50">No saved games yet. Create or join a game and it will show up here.</p>
            ) : (
              <ul>
                {history.map(item => {
                  const active = selected?.code === item.code;
                  return (
                    <li key={item.code}>
                      <button
                        onClick={() => fetchLog(item)}
                        className={`w-full text-left px-3 py-2 border-b border-pirate-tan/10 transition
                                    ${active ? 'bg-pirate-brown/60' : 'hover:bg-pirate-brown/30'}`}>
                        <div className="text-sm font-mono text-pirate-gold truncate">{item.code}</div>
                        <div className="text-[11px] text-pirate-tan/60 truncate">
                          {item.name} &middot; {formatRelativeDate(item.lastSeenAt)}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Right column — log viewer */}
          <div className="flex-1 flex flex-col min-w-0">
            {!selected ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-pirate-tan/50 text-sm">Pick a game from the list to view its log.</p>
              </div>
            ) : (
              <>
                <div className="px-4 py-2 border-b border-pirate-tan/20 bg-pirate-brown/40 flex items-center gap-2 flex-wrap">
                  <div className="flex-1 min-w-[140px]">
                    <div className="text-xs text-pirate-tan/60">Room</div>
                    <div className="text-sm font-mono text-pirate-gold">{selected.code}</div>
                  </div>
                  <input
                    type="text"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Filter events..."
                    className="bg-pirate-dark border border-pirate-tan/30 rounded px-2 py-1 text-xs text-white
                               focus:outline-none focus:border-pirate-gold w-40"
                  />
                  <button onClick={downloadLog} disabled={!entries || entries.length === 0}
                    className="bg-pirate-gold text-pirate-dark px-3 py-1.5 rounded text-xs font-bold
                               hover:bg-yellow-500 disabled:opacity-40 transition">
                    Download .jsonl
                  </button>
                  <button onClick={() => forgetGame(selected.code)}
                    className="bg-pirate-dark border border-pirate-tan/30 text-pirate-tan/70
                               hover:border-red-500/50 hover:text-red-400 px-2 py-1.5 rounded text-xs transition">
                    Forget
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-3 bg-black/30 font-mono text-[11px] leading-snug">
                  {loading && <p className="text-pirate-tan/60">Loading log...</p>}
                  {error && <p className="text-red-400">Error: {error}</p>}
                  {!loading && !error && filteredEntries?.length === 0 && (
                    <p className="text-pirate-tan/50">No entries match the filter.</p>
                  )}
                  {filteredEntries?.map((entry, i) => (
                    <LogEntry key={i} entry={entry} />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function LogEntry({ entry }) {
  const colorClass =
    entry.level === 'error' ? 'text-red-400'
    : entry.level === 'warn' ? 'text-yellow-400'
    : 'text-pirate-tan/90';
  const { t, level, event, code, ...rest } = entry;
  return (
    <div className={`border-l-2 border-pirate-tan/10 pl-2 mb-1 ${colorClass}`}>
      <div className="flex gap-2 flex-wrap">
        <span className="text-pirate-tan/40 whitespace-nowrap">{formatTimestamp(t)}</span>
        <span className="font-bold text-white whitespace-nowrap">{event}</span>
      </div>
      {Object.keys(rest).length > 0 && (
        <pre className="text-pirate-tan/70 whitespace-pre-wrap break-all pl-1">
          {JSON.stringify(rest)}
        </pre>
      )}
    </div>
  );
}
