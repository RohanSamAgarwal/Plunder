import { useState, useEffect } from 'react';
import { useAnimSpeed } from '../../App';

export default function GameOverAnimation({ winnerName, onComplete }) {
  const { animSpeed } = useAnimSpeed();
  const m = animSpeed / 3;
  const [phase, setPhase] = useState('enter'); // enter → hold → fadeout

  useEffect(() => {
    const timers = [];
    timers.push(setTimeout(() => setPhase('hold'), 500 * m));
    timers.push(setTimeout(() => setPhase('fadeout'), 5000 * m));
    timers.push(setTimeout(() => onComplete(), 5500 * m));
    return () => timers.forEach(clearTimeout);
  }, [onComplete, m]);

  return (
    <div className={`game-over-overlay ${phase === 'fadeout' ? 'game-over-fadeout' : ''}`}>
      <div className={`game-over-content ${phase === 'enter' ? 'game-over-enter' : 'game-over-visible'}`}>
        <span className="game-over-icon">👑</span>
        <h1 className="game-over-title">{winnerName} Wins!</h1>
        <p className="game-over-subtitle">All hail the Pirate King!</p>
        <div className="game-over-sparkles">
          {'✨🏴‍☠️⚓💰🗡️✨'.split('').map((e, i) => (
            <span key={i} className="game-over-sparkle" style={{ animationDelay: `${i * 0.15}s` }}>{e}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
