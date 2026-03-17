import { useState, useEffect } from 'react';
import { useAnimSpeed } from '../../App';

export default function StormAnimation({ center, layout, canvasW, canvasH, onComplete }) {
  const { animSpeed } = useAnimSpeed();
  const m = animSpeed / 3;
  const [phase, setPhase] = useState('flash1'); // flash1 → dark → flash2 → shake → fadeout

  useEffect(() => {
    const timers = [];
    timers.push(setTimeout(() => setPhase('dark'), 100 * m));
    timers.push(setTimeout(() => setPhase('flash2'), 300 * m));
    timers.push(setTimeout(() => setPhase('shake'), 450 * m));
    timers.push(setTimeout(() => setPhase('fadeout'), 800 * m));
    timers.push(setTimeout(() => onComplete(), 1100 * m));
    return () => timers.forEach(clearTimeout);
  }, [onComplete, m]);

  // Position over the 3x3 storm area
  const { tileSize: ts, gridPad: gp } = layout;
  const stormLeft = ((gp + (center.col - 1) * ts) / canvasW) * 100;
  const stormTop = ((gp + (center.row - 1) * ts) / canvasH) * 100;
  const stormW = ((ts * 3) / canvasW) * 100;
  const stormH = ((ts * 3) / canvasH) * 100;

  const isFlash = phase === 'flash1' || phase === 'flash2';
  const isShake = phase === 'shake';

  return (
    <>
      {/* Full-screen flash overlay */}
      <div
        className={`storm-flash ${isFlash ? 'storm-flash-on' : ''} ${phase === 'fadeout' ? 'storm-flash-fade' : ''}`}
      />
      {/* Storm area effect */}
      <div
        className={`storm-area ${isShake ? 'storm-shake' : ''} ${phase === 'fadeout' ? 'storm-area-fade' : ''}`}
        style={{
          left: `${stormLeft}%`,
          top: `${stormTop}%`,
          width: `${stormW}%`,
          height: `${stormH}%`,
        }}
      >
        <span className="storm-bolt">⚡</span>
        <span className="storm-text">Storm!</span>
      </div>
    </>
  );
}
