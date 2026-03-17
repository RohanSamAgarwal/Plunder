import { useState, useEffect } from 'react';
import { useAnimSpeed } from '../../App';

export default function ShipLaunchAnimation({ playerName, onComplete }) {
  const [phase, setPhase] = useState('drop'); // drop → splash → hold → fadeout
  const { animSpeed } = useAnimSpeed();
  const m = animSpeed / 3;

  useEffect(() => {
    const timers = [];

    // Ship drops in
    timers.push(setTimeout(() => setPhase('splash'), 300 * m));

    // Hold with ripples visible
    timers.push(setTimeout(() => setPhase('hold'), 600 * m));

    // Fade out
    timers.push(setTimeout(() => setPhase('fadeout'), 1800 * m));

    // Remove
    timers.push(setTimeout(() => onComplete(), 2100 * m));

    return () => timers.forEach(clearTimeout);
  }, [onComplete, m]);

  return (
    <div className={`ship-launch ship-launch-${phase}`}>
      <div className="ship-launch-ship">⛵</div>
      <div className="ship-launch-ripple">
        <span className="ship-launch-wave ship-launch-wave-l">~</span>
        <span className="ship-launch-droplet">💦</span>
        <span className="ship-launch-wave ship-launch-wave-r">~</span>
      </div>
      <div className="ship-launch-label">{playerName}</div>
      <div className="ship-launch-text">Ship Launched!</div>
    </div>
  );
}
