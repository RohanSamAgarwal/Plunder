import { useState, useEffect, useMemo } from 'react';
import { useAnimSpeed } from '../../App';

const COLOR_MAP = {
  red: '#ef4444',
  blue: '#3b82f6',
  green: '#22c55e',
  yellow: '#eab308',
  purple: '#a855f7',
  orange: '#f97316',
};

export default function ShipMoveAnimation({ path, playerColor, layout, canvasW, canvasH, onComplete }) {
  const { animSpeed } = useAnimSpeed();
  const m = animSpeed / 3;

  // Convert grid positions to pixel percentages
  const positions = useMemo(() => {
    if (!path || path.length < 2) return [];
    const { tileSize: ts, gridPad: gp } = layout;
    return path.map(({ col, row }) => ({
      leftPct: ((gp + col * ts + ts / 2) / canvasW) * 100,
      topPct: ((gp + row * ts + ts / 2) / canvasH) * 100,
    }));
  }, [path, layout, canvasW, canvasH]);

  const [stepIndex, setStepIndex] = useState(0);
  const [phase, setPhase] = useState('moving'); // moving → fadeout

  const perStepMs = 180 * m; // time per tile hop
  const totalSteps = positions.length - 1;

  useEffect(() => {
    if (totalSteps <= 0) {
      onComplete();
      return;
    }

    const timers = [];

    // Animate step by step
    for (let i = 1; i <= totalSteps; i++) {
      timers.push(setTimeout(() => setStepIndex(i), perStepMs * i));
    }

    // Start fadeout after last step + small hold
    timers.push(setTimeout(() => setPhase('fadeout'), perStepMs * totalSteps + 200 * m));

    // Remove component
    timers.push(setTimeout(() => onComplete(), perStepMs * totalSteps + 500 * m));

    return () => timers.forEach(clearTimeout);
  }, [totalSteps, perStepMs, m, onComplete]);

  if (positions.length < 2) return null;

  const current = positions[stepIndex] || positions[0];
  const color = COLOR_MAP[playerColor] || '#ffffff';

  // Trail: show fading dots for previous positions
  const trail = positions.slice(Math.max(0, stepIndex - 3), stepIndex);

  return (
    <>
      {/* Wake trail */}
      {trail.map((pos, i) => (
        <div
          key={`trail-${i}`}
          className="ship-move-trail"
          style={{
            left: `${pos.leftPct}%`,
            top: `${pos.topPct}%`,
            opacity: 0.15 + (i / trail.length) * 0.25,
          }}
        />
      ))}
      {/* Moving ship icon */}
      <div
        className={`ship-move-icon ${phase === 'fadeout' ? 'ship-move-fadeout' : ''}`}
        style={{
          left: `${current.leftPct}%`,
          top: `${current.topPct}%`,
          transition: `left ${perStepMs}ms ease-in-out, top ${perStepMs}ms ease-in-out`,
          '--ship-color': color,
        }}
      >
        ⛵
      </div>
    </>
  );
}
