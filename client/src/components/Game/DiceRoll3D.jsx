import { useState, useEffect } from 'react';

// Pip layouts for each dice face (row, col positions in a 3x3 grid)
const PIP_LAYOUTS = {
  1: [[1, 1]],
  2: [[0, 2], [2, 0]],
  3: [[0, 2], [1, 1], [2, 0]],
  4: [[0, 0], [0, 2], [2, 0], [2, 2]],
  5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
  6: [[0, 0], [0, 2], [1, 0], [1, 2], [2, 0], [2, 2]],
};

// Rotation to show each face forward
const FACE_ROTATIONS = {
  1: 'rotateX(0deg) rotateY(0deg)',
  2: 'rotateX(0deg) rotateY(-90deg)',
  3: 'rotateX(-90deg) rotateY(0deg)',
  4: 'rotateX(90deg) rotateY(0deg)',
  5: 'rotateX(0deg) rotateY(90deg)',
  6: 'rotateX(180deg) rotateY(0deg)',
};

function DiceFace({ value }) {
  const pips = PIP_LAYOUTS[value];
  return (
    <div className="dice-pips">
      {pips.map((pos, i) => (
        <div
          key={i}
          className="dice-pip"
          style={{
            gridRow: pos[0] + 1,
            gridColumn: pos[1] + 1,
          }}
        />
      ))}
    </div>
  );
}

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

  const cubeClasses = [
    'dice-cube',
    phase === 'rolling' ? 'dice-rolling' : '',
    phase !== 'rolling' ? 'dice-landed' : '',
    isReroll ? 'dice-reroll' : '',
  ].filter(Boolean).join(' ');

  const landingTransform = FACE_ROTATIONS[roll] || FACE_ROTATIONS[1];

  return (
    <div className={`dice-overlay ${phase === 'fadeout' ? 'dice-overlay-fadeout' : ''}`}>
      <div className="dice-anim-container">
        <div className="dice-scene">
          <div
            className={cubeClasses}
            style={phase !== 'rolling' ? { transform: landingTransform } : undefined}
          >
            {/* Front face = 1 */}
            <div className="dice-face dice-front"><DiceFace value={1} /></div>
            {/* Back face = 6 */}
            <div className="dice-face dice-back"><DiceFace value={6} /></div>
            {/* Right face = 2 */}
            <div className="dice-face dice-right"><DiceFace value={2} /></div>
            {/* Left face = 5 */}
            <div className="dice-face dice-left"><DiceFace value={5} /></div>
            {/* Top face = 3 */}
            <div className="dice-face dice-top"><DiceFace value={3} /></div>
            {/* Bottom face = 4 */}
            <div className="dice-face dice-bottom"><DiceFace value={4} /></div>
          </div>
        </div>

        <div className={`dice-result-text ${phase === 'result' || phase === 'fadeout' ? 'dice-result-visible' : ''}`}>
          <span className="dice-roll-value">{playerName} rolled {roll}!</span>
          <span className="dice-move-points">{totalMovePoints} total moves</span>
        </div>
      </div>
    </div>
  );
}
