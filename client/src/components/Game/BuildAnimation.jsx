import { useState, useEffect } from 'react';
import { useAnimSpeed } from '../../App';

const BUILD_ICONS = {
  mast: '🔱',
  cannon: '💣',
  lifePeg: '❤️',
  plunderPoint: '⭐',
  ship: '⛵',
};

const BUILD_LABELS = {
  mast: '+1 Mast',
  cannon: '+1 Cannon',
  lifePeg: '+1 Life Peg',
  plunderPoint: '+1 Plunder Point',
  ship: 'Ship Launched!',
};

export default function BuildAnimation({ buildType, playerName, onComplete }) {
  const [phase, setPhase] = useState('pop'); // pop → float → done
  const { animSpeed } = useAnimSpeed();
  const m = animSpeed / 3;

  useEffect(() => {
    const timers = [];
    // Start floating up after pop
    timers.push(setTimeout(() => setPhase('float'), 100 * m));
    // Remove component
    timers.push(setTimeout(() => onComplete(), 1400 * m));
    return () => timers.forEach(clearTimeout);
  }, [onComplete, m]);

  const icon = BUILD_ICONS[buildType] || '🔨';
  const label = BUILD_LABELS[buildType] || buildType;

  return (
    <div className={`build-anim build-anim-${phase}`}>
      <span className="build-anim-icon">{icon}</span>
      <span className="build-anim-label">{label}</span>
      <span className="build-anim-player">{playerName}</span>
    </div>
  );
}
