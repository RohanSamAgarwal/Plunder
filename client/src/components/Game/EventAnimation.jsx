import { useState, useEffect } from 'react';
import { useAnimSpeed } from '../../App';

/**
 * Reusable event animation overlay.
 * Shows an icon + title + subtitle with pop-in, hold, and fade-out phases.
 * Used for turn transitions, trade results, treaty results, bribe outcomes,
 * island captures, ship sinkings, etc.
 */
export default function EventAnimation({ icon, title, subtitle, color = '#d4a017', onComplete }) {
  const { animSpeed } = useAnimSpeed();
  const m = animSpeed / 3;
  const [phase, setPhase] = useState('enter'); // enter → hold → fadeout

  useEffect(() => {
    const timers = [];
    timers.push(setTimeout(() => setPhase('hold'), 300 * m));
    timers.push(setTimeout(() => setPhase('fadeout'), 2000 * m));
    timers.push(setTimeout(() => onComplete(), 2400 * m));
    return () => timers.forEach(clearTimeout);
  }, [onComplete, m]);

  return (
    <div className={`event-anim-overlay ${phase === 'fadeout' ? 'event-anim-fadeout' : ''}`}>
      <div className={`event-anim-card ${phase === 'enter' ? 'event-anim-enter' : 'event-anim-visible'}`}>
        <span className="event-anim-icon">{icon}</span>
        <span className="event-anim-title" style={{ color }}>{title}</span>
        {subtitle && <span className="event-anim-subtitle">{subtitle}</span>}
      </div>
    </div>
  );
}
