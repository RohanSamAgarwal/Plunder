import { useState, useEffect, useMemo } from 'react';
import { useAnimSpeed } from '../../App';

const RESOURCE_INFO = {
  wood:  { emoji: '🪵', label: 'Wood',  color: '#8B5E3C' },
  iron:  { emoji: '⛏️', label: 'Iron',  color: '#9CA3AF' },
  rum:   { emoji: '🍺', label: 'Rum',   color: '#C2410C' },
  gold:  { emoji: '🪙', label: 'Gold',  color: '#EAB308' },
};

/**
 * Resource draw animation.
 * - Local player: sees floating resource icons with labels
 * - Other players: sees generic card backs + "drew X cards" text
 */
export default function ResourceDrawAnimation({ playerName, drawn, count, isLocal, onComplete }) {
  const { animSpeed } = useAnimSpeed();
  const m = animSpeed / 3;
  const [phase, setPhase] = useState('enter'); // enter → hold → fadeout

  // Summarize drawn resources for local player
  const resourceItems = useMemo(() => {
    if (!drawn || !Array.isArray(drawn)) return [];
    const counts = {};
    drawn.forEach(r => { counts[r] = (counts[r] || 0) + 1; });
    return Object.entries(counts).map(([type, qty]) => ({
      type,
      qty,
      ...(RESOURCE_INFO[type] || { emoji: '📦', label: type, color: '#aaa' }),
    }));
  }, [drawn]);

  const totalItems = isLocal ? resourceItems.length : (count || 0);

  useEffect(() => {
    const timers = [];
    timers.push(setTimeout(() => setPhase('hold'), 400 * m));
    timers.push(setTimeout(() => setPhase('fadeout'), 2200 * m));
    timers.push(setTimeout(() => onComplete(), 2600 * m));
    return () => timers.forEach(clearTimeout);
  }, [onComplete, m]);

  return (
    <div className={`resource-draw-overlay ${phase === 'fadeout' ? 'resource-draw-fadeout' : ''}`}>
      <div className="resource-draw-container">
        {/* Header */}
        <div className={`resource-draw-header ${phase !== 'enter' ? 'resource-draw-header-visible' : ''}`}>
          {isLocal ? 'Resources Collected!' : `${playerName} drew ${count} card${count !== 1 ? 's' : ''}`}
        </div>

        {/* Resource items or card backs */}
        <div className="resource-draw-items">
          {isLocal ? (
            // Local player: show actual resources
            resourceItems.map((item, i) => (
              <div
                key={item.type}
                className={`resource-draw-item ${phase !== 'enter' ? 'resource-draw-item-visible' : ''}`}
                style={{
                  animationDelay: `${i * 200 * m}ms`,
                  '--resource-color': item.color,
                }}
              >
                <span className="resource-draw-emoji">{item.emoji}</span>
                <span className="resource-draw-qty" style={{ color: item.color }}>
                  {item.qty > 1 ? `×${item.qty}` : ''} {item.label}
                </span>
              </div>
            ))
          ) : (
            // Other players: show card backs
            Array.from({ length: Math.min(count || 0, 6) }, (_, i) => (
              <div
                key={i}
                className={`resource-draw-card ${phase !== 'enter' ? 'resource-draw-item-visible' : ''}`}
                style={{ animationDelay: `${i * 150 * m}ms` }}
              >
                <div className="resource-draw-card-inner">
                  <span className="resource-draw-card-icon">🂠</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
