import { Routes, Route } from 'react-router-dom';
import { useState, useEffect, createContext, useContext } from 'react';
import { useSocket } from './hooks/useSocket';
import Home from './components/Lobby/Home';
import GamePage from './components/Game/GamePage';
import BugReportButton from './components/BugReportButton';

export const SocketContext = createContext(null);
export const PlayerContext = createContext(null);
export const AnimSpeedContext = createContext(null);

export function usePlayerContext() {
  return useContext(PlayerContext);
}
export function useSocketContext() {
  return useContext(SocketContext);
}
export function useAnimSpeed() {
  return useContext(AnimSpeedContext);
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

  const [animSpeed, setAnimSpeed] = useState(() => {
    const saved = parseInt(localStorage.getItem('plunder_anim_speed'));
    return (saved >= 1 && saved <= 5) ? saved : 3;
  });

  useEffect(() => {
    localStorage.setItem('plunder_anim_speed', String(animSpeed));
  }, [animSpeed]);

  return (
    <SocketContext.Provider value={socketUtils}>
      <PlayerContext.Provider value={{ playerInfo, setPlayerInfo }}>
        <AnimSpeedContext.Provider value={{ animSpeed, setAnimSpeed }}>
          <div className="min-h-screen bg-pirate-deepSea">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/game/:code" element={<GamePage />} />
            </Routes>
            <BugReportButton />
          </div>
        </AnimSpeedContext.Provider>
      </PlayerContext.Provider>
    </SocketContext.Provider>
  );
}
