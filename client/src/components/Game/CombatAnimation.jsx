import { useState, useEffect } from 'react';
import { DiceCube } from './DiceFace';
import { useAnimSpeed } from '../../App';

export default function CombatAnimation({ combatResult, onComplete }) {
  const [phase, setPhase] = useState('rolling'); // rolling → landing → result → fadeout
  const { animSpeed } = useAnimSpeed();
  const m = animSpeed / 3; // multiplier: 1=0.33x, 3=1x, 5=1.67x

  useEffect(() => {
    const timers = [];

    // After tumble, land on the correct face
    timers.push(setTimeout(() => setPhase('landing'), 500 * m));

    // Hold landed state so players can see the final face clearly before totals appear
    timers.push(setTimeout(() => setPhase('result'), 1500 * m));

    // Begin fade out (extra hold so players can read the result)
    timers.push(setTimeout(() => setPhase('fadeout'), 4500 * m));

    // Remove component
    timers.push(setTimeout(() => onComplete(), 4800 * m));

    return () => timers.forEach(clearTimeout);
  }, [onComplete, m]);

  const {
    attacker,
    defender,
    attackDie,
    defenseDie,
    attackRoll,
    defenseRoll,
    attackerCannons = 0,
    defenderModifier = 0,
  } = combatResult;

  // Determine winner
  const attackerWon = combatResult.won ?? combatResult.attackerWon ?? false;

  return (
    <div className={`combat-overlay ${phase === 'fadeout' ? 'combat-overlay-fadeout' : ''}`}>
      <div className="combat-duel-container">
        {/* Labels */}
        <div className="combat-labels">
          <span className="combat-label combat-label-attacker">{attacker}</span>
          <span className="combat-vs">⚔️</span>
          <span className="combat-label combat-label-defender">{defender}</span>
        </div>

        {/* Dice */}
        <div className="combat-dice-row">
          <div className="combat-die combat-die-attacker">
            <DiceCube roll={attackDie || 1} phase={phase} extraClass="combat-cube-attacker" />
            <div className={`combat-die-badge combat-die-badge-attacker ${phase !== 'rolling' ? 'combat-die-badge-visible' : ''}`}>
              🎲 <span className="combat-die-badge-value">{attackDie || '?'}</span>
            </div>
          </div>

          <div className="combat-vs-icon">VS</div>

          <div className="combat-die combat-die-defender">
            <DiceCube roll={defenseDie || 1} phase={phase} extraClass="combat-cube-defender" />
            <div className={`combat-die-badge combat-die-badge-defender ${phase !== 'rolling' ? 'combat-die-badge-visible' : ''}`}>
              🎲 <span className="combat-die-badge-value">{defenseDie || '?'}</span>
            </div>
          </div>
        </div>

        {/* Score breakdown + totals */}
        <div className={`combat-totals ${phase === 'result' || phase === 'fadeout' ? 'combat-totals-visible' : ''}`}>
          <div className="combat-total-side combat-total-attacker">
            <span className="combat-breakdown">
              <span className="combat-die-value">{attackDie}</span> + {attackerCannons} 💣
            </span>
            <span className="combat-equals">=</span>
            <span className="combat-score">{attackRoll}</span>
          </div>
          <span className="combat-score-vs">vs</span>
          <div className="combat-total-side combat-total-defender">
            <span className="combat-breakdown">
              <span className="combat-die-value">{defenseDie}</span> + {defenderModifier} {combatResult.type === 'island' ? '💀' : '💣'}
            </span>
            <span className="combat-equals">=</span>
            <span className="combat-score">{defenseRoll}</span>
          </div>
        </div>

        {/* Outcome */}
        <div className={`combat-outcome ${phase === 'result' || phase === 'fadeout' ? 'combat-outcome-visible' : ''}`}>
          <span className={`combat-winner ${attackerWon ? 'combat-win' : 'combat-lose'}`}>
            {attackerWon
              ? `⚔️ ${attacker} wins!`
              : `🛡️ ${defender} defends!`}
          </span>
        </div>
      </div>
    </div>
  );
}
