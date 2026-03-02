import { Routes, Route } from 'react-router-dom';
import { useState, useEffect, createContext, useContext } from 'react';
import { useSocket } from './hooks/useSocket';
import Home from './components/Lobby/Home';
import GamePage from './components/Game/GamePage';

export const SocketContext = createContext(null);
export const PlayerContext = createContext(null);

export function usePlayerContext() {
  return useContext(PlayerContext);
}
export function useSocketContext() {
  return useContext(SocketContext);
}

export default function App() {
  const socketUtils = useSocket();
  const [playerInfo, setPlayerInfo] = useState(() => {
    const saved = localStorage.getItem('plunder-player');
    return saved ? JSON.parse(saved) : null;
  });

  useEffect(() => {
    if (playerInfo) {
      localStorage.setItem('plunder-player', JSON.stringify(playerInfo));
    }
  }, [playerInfo]);

  return (
    <SocketContext.Provider value={socketUtils}>
      <PlayerContext.Provider value={{ playerInfo, setPlayerInfo }}>
        <div className="min-h-screen bg-pirate-deepSea">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/game/:code" element={<GamePage />} />
          </Routes>
        </div>
      </PlayerContext.Provider>
    </SocketContext.Provider>
  );
}
