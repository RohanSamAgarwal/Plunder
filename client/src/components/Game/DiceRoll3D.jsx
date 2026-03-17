import { useState, useEffect } from 'react';
import { DiceFace, DiceCube, FACE_ROTATIONS } from './DiceFace';

export default function DiceRoll3D({ roll, totalMovePoints, isReroll, playerName, onComplete }) {
  const [phase, setPhase] = useState('rolling'); // rolling → landing → result → fadeout

  useEffect(() => {
    const timers = [];

    // After tumble, land on the correct face
    timers.push(setTimeout(() => setPhase('landing'), 500));

    // Show result text
    timers.push(setTimeout(() => setPhase('result'), 650));

    // Begin fade out
    timers.push(setTimeout(() => setPhase('fadeout'), 1100));

    // Remove component
    timers.push(setTimeout(() => onComplete(), 1400));

    return () => timers.forEach(clearTimeout);
  }, [onComplete]);

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
