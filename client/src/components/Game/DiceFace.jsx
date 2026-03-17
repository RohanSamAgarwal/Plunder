// Pip layouts for each dice face (row, col positions in a 3x3 grid)
export const PIP_LAYOUTS = {
  1: [[1, 1]],
  2: [[0, 2], [2, 0]],
  3: [[0, 2], [1, 1], [2, 0]],
  4: [[0, 0], [0, 2], [2, 0], [2, 2]],
  5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
  6: [[0, 0], [0, 2], [1, 0], [1, 2], [2, 0], [2, 2]],
};

// Rotation to show each face forward
export const FACE_ROTATIONS = {
  1: 'rotateX(0deg) rotateY(0deg)',
  2: 'rotateX(0deg) rotateY(-90deg)',
  3: 'rotateX(-90deg) rotateY(0deg)',
  4: 'rotateX(90deg) rotateY(0deg)',
  5: 'rotateX(0deg) rotateY(90deg)',
  6: 'rotateX(180deg) rotateY(0deg)',
};

export function DiceFace({ value }) {
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

// Reusable 3D dice cube that tumbles and lands on a given face
export function DiceCube({ roll, phase, extraClass = '' }) {
  const cubeClasses = [
    'dice-cube',
    phase === 'rolling' ? 'dice-rolling' : '',
    phase !== 'rolling' ? 'dice-landed' : '',
    extraClass,
  ].filter(Boolean).join(' ');

  const landingTransform = FACE_ROTATIONS[roll] || FACE_ROTATIONS[1];

  return (
    <div className="dice-scene">
      <div
        className={cubeClasses}
        style={phase !== 'rolling' ? { transform: landingTransform } : undefined}
      >
        <div className="dice-face dice-front"><DiceFace value={1} /></div>
        <div className="dice-face dice-back"><DiceFace value={6} /></div>
        <div className="dice-face dice-right"><DiceFace value={2} /></div>
        <div className="dice-face dice-left"><DiceFace value={5} /></div>
        <div className="dice-face dice-top"><DiceFace value={3} /></div>
        <div className="dice-face dice-bottom"><DiceFace value={4} /></div>
      </div>
    </div>
  );
}
