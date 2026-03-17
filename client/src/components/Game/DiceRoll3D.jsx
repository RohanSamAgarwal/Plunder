import { useState, useEffect } from 'react';
import { DiceFace, DiceCube, FACE_ROTATIONS } from './DiceFace';
import { useAnimSpeed } from '../../App';

export default function DiceRoll3D({ roll, totalMovePoints, isReroll, playerName, onComplete }) {
  const [phase, setPhase] = useState('rolling'); // rolling → landing → result → fadeout
  const { animSpeed } = useAnimSpeed();
  const m = animSpeed / 3; // multiplier: 1=0.33x, 3=1x, 5=1.67x

  useEffect(() => {
    const timers = [];

    // After tumble, land on the correct face
    timers.push(setTimeout(() => setPhase('landing'), 500 * m));

    // Show result text
    timers.push(setTimeout(() => setPhase('result'), 650 * m));

    // Begin fade out
    timers.push(setTimeout(() => setPhase('fadeout'), 1100 * m));

    // Remove component
    timers.push(setTimeout(() => onComplete(), 1400 * m));

    return () => timers.forEach(clearTimeout);
  }, [onComplete, m]);

  return (
    <div className={`dice-overlay ${phase === 'fadeout' ? 'dice-overlay-fadeout' : ''}`}>
      <div className="dice-anim-container">
        <DiceCube roll={roll} phase={phase} extraClass={isReroll ? 'dice-reroll' : ''} />

        <div className={`dice-result-text ${phase === 'result' || phase === 'fadeout' ? 'dice-result-visible' : ''}`}>
          <span className="dice-roll-value">{playerName} rolled {roll}!</span>
          <span className="dice-move-points">{totalMovePoints} total moves</span>
        </div>
      </div>
    </div>
  );
}
