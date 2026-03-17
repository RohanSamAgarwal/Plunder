import { useState, useEffect } from 'react';
import { useAnimSpeed } from '../../App';

export default function GameStartAnimation({ onComplete }) {
  const { animSpeed } = useAnimSpeed();
  const m = animSpeed / 3;
  const [phase, setPhase] = useState('enter'); // enter → hold → fadeout

  useEffect(() => {
    const timers = [];
    timers.push(setTimeout(() => setPhase('hold'), 400 * m));
    timers.push(setTimeout(() => setPhase('fadeout'), 2500 * m));
    timers.push(setTimeout(() => onComplete(), 3000 * m));
    return () => timers.forEach(clearTimeout);
  }, [onComplete, m]);

  return (
    <div className={`game-start-overlay ${phase === 'fadeout' ? 'game-start-fadeout' : ''}`}>
      <div className={`game-start-content ${phase === 'enter' ? 'game-start-enter' : 'game-start-visible'}`}>
        <span className="game-start-icon">🏴‍☠️</span>
        <h1 className="game-start-title">Set Sail!</h1>
        <p className="game-start-subtitle">The seas await, captain...</p>
      </div>
    </div>
  );
}
