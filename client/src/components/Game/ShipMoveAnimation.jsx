import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useAnimSpeed } from '../../App';

const COLOR_MAP = {
  red: '#ef4444',
  blue: '#3b82f6',
  green: '#22c55e',
  yellow: '#eab308',
  purple: '#a855f7',
  orange: '#f97316',
};

function darkenColor(hex, amount) {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.max(0, (num >> 16) - Math.round(255 * amount));
  const g = Math.max(0, ((num >> 8) & 0xff) - Math.round(255 * amount));
  const b = Math.max(0, (num & 0xff) - Math.round(255 * amount));
  return `rgb(${r},${g},${b})`;
}

/**
 * Draw the ship piece onto an offscreen canvas, matching the renderer style.
 * Ship faces "up" (bow at top) by default.
 */
function drawShipPiece(ctx, cx, cy, ts, shipColor, masts, cannons) {
  // ── Hull ──
  const hullHW = ts * 0.24;
  const bowY = cy - ts * 0.30;
  const sternY = cy + ts * 0.24;

  ctx.fillStyle = shipColor;
  ctx.beginPath();
  ctx.moveTo(cx, bowY);
  ctx.quadraticCurveTo(cx + hullHW * 0.5, bowY + ts * 0.1, cx + hullHW, cy + ts * 0.04);
  ctx.lineTo(cx + hullHW * 0.85, sternY);
  ctx.quadraticCurveTo(cx, sternY + ts * 0.06, cx - hullHW * 0.85, sternY);
  ctx.lineTo(cx - hullHW, cy + ts * 0.04);
  ctx.quadraticCurveTo(cx - hullHW * 0.5, bowY + ts * 0.1, cx, bowY);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = Math.max(1.5, ts * 0.025);
  ctx.stroke();

  // Deck inset
  ctx.fillStyle = darkenColor(shipColor, 0.14);
  ctx.beginPath();
  ctx.ellipse(cx, cy, hullHW * 0.55, ts * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();

  // Mast
  ctx.strokeStyle = '#b0a070';
  ctx.lineWidth = Math.max(1.2, ts * 0.018);
  ctx.beginPath();
  ctx.moveTo(cx, cy + ts * 0.08);
  ctx.lineTo(cx, cy - ts * 0.16);
  ctx.stroke();

  // ── Sail badges (LEFT side) ──
  const badgeR = ts * 0.19;
  const badgeLX = cx - hullHW - badgeR * 0.4;
  for (let m = 0; m < 2; m++) {
    const by = cy - ts * 0.12 + m * (badgeR * 2.2);
    if (m < masts) {
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(badgeLX, by, badgeR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Sail icon
      const iconS = badgeR * 0.88;
      ctx.strokeStyle = '#c8b880';
      ctx.lineWidth = Math.max(1.8, ts * 0.026);
      ctx.beginPath();
      ctx.moveTo(badgeLX - iconS * 0.18, by + iconS * 0.7);
      ctx.lineTo(badgeLX - iconS * 0.18, by - iconS * 0.8);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(badgeLX - iconS * 0.18, by - iconS * 0.7);
      ctx.lineTo(badgeLX + iconS * 0.8, by + iconS * 0.15);
      ctx.lineTo(badgeLX - iconS * 0.18, by + iconS * 0.55);
      ctx.closePath();
      ctx.fill();
    }
  }

  // ── Cannon badges (RIGHT side) ──
  const badgeRX = cx + hullHW + badgeR * 0.4;
  for (let c = 0; c < 2; c++) {
    const by = cy - ts * 0.12 + c * (badgeR * 2.2);
    if (c < cannons) {
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(badgeRX, by, badgeR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Cannon icon
      const iconS = badgeR * 0.8;
      ctx.fillStyle = '#999';
      ctx.beginPath();
      ctx.arc(badgeRX + iconS * 0.05, by + iconS * 0.18, iconS * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#666';
      ctx.save();
      ctx.translate(badgeRX, by);
      ctx.rotate(-Math.PI * 0.3);
      ctx.fillRect(-iconS * 0.26, -iconS * 1.05, iconS * 0.52, iconS * 0.95);
      ctx.restore();
      ctx.fillStyle = '#ffcc33';
      ctx.beginPath();
      ctx.arc(badgeRX - iconS * 0.35, by - iconS * 0.7, iconS * 0.22, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export default function ShipMoveAnimation({ path, playerColor, ship, layout, canvasW, canvasH, onComplete }) {
  const { animSpeed } = useAnimSpeed();
  const m = animSpeed / 3;
  const shipCanvasRef = useRef(null);

  const masts = ship?.masts || 1;
  const cannons = ship?.cannons || 0;

  // Convert grid positions to pixel percentages
  const positions = useMemo(() => {
    if (!path || path.length < 2) return [];
    const { tileSize: ts, gridPad: gp } = layout;
    return path.map(({ col, row }) => ({
      leftPct: ((gp + col * ts + ts / 2) / canvasW) * 100,
      topPct: ((gp + row * ts + ts / 2) / canvasH) * 100,
    }));
  }, [path, layout, canvasW, canvasH]);

  // Compute rotation angles for each step (direction of travel)
  const angles = useMemo(() => {
    if (positions.length < 2) return [0];
    const result = [0]; // first position: angle from first to second
    for (let i = 1; i < positions.length; i++) {
      const dx = positions[i].leftPct - positions[i - 1].leftPct;
      const dy = positions[i].topPct - positions[i - 1].topPct;
      // atan2 gives angle from positive X axis; ship faces up (negative Y) by default
      // So rotation = atan2(dx, -dy) to point bow in direction of travel
      const angle = Math.atan2(dx, -dy);
      result.push(angle);
    }
    // First position uses same angle as first movement
    result[0] = result[1];
    return result;
  }, [positions]);

  const [stepIndex, setStepIndex] = useState(0);
  const [phase, setPhase] = useState('moving'); // moving → fadeout

  const perStepMs = 180 * m; // time per tile hop
  const totalSteps = positions.length - 1;

  // Draw ship piece onto canvas once
  const shipColor = COLOR_MAP[playerColor] || '#ffffff';
  const tileSize = layout?.tileSize || 60;
  const canvasSize = Math.round(tileSize * 1.6); // enough room for badges

  const drawShip = useCallback(() => {
    const canvas = shipCanvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasSize * dpr;
    canvas.height = canvasSize * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, canvasSize, canvasSize);
    drawShipPiece(ctx, canvasSize / 2, canvasSize / 2, tileSize, shipColor, masts, cannons);
  }, [canvasSize, tileSize, shipColor, masts, cannons]);

  useEffect(() => {
    drawShip();
  }, [drawShip]);

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
  const currentAngle = angles[stepIndex] || 0;

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
      {/* Moving ship piece */}
      <canvas
        ref={shipCanvasRef}
        className={`ship-move-canvas ${phase === 'fadeout' ? 'ship-move-fadeout' : ''}`}
        style={{
          position: 'absolute',
          left: `${current.leftPct}%`,
          top: `${current.topPct}%`,
          width: `${canvasSize}px`,
          height: `${canvasSize}px`,
          transform: `translate(-50%, -50%) rotate(${currentAngle}rad)`,
          transition: `left ${perStepMs}ms ease-in-out, top ${perStepMs}ms ease-in-out, transform ${perStepMs}ms ease-in-out`,
          pointerEvents: 'none',
          zIndex: 50,
        }}
      />
    </>
  );
}
