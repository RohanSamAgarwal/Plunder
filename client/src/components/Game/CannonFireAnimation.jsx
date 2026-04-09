import { useEffect, useRef } from 'react';
import { useAnimSpeed } from '../../App';

/**
 * Canvas-based cannon fire animation.
 * Fires an arcing cannonball from attacker to defender with:
 *   - Muzzle flash at origin
 *   - Smoke trail particles
 *   - Impact explosion with sparks
 *
 * Plays BEFORE the dice overlay to build dramatic tension.
 */
export default function CannonFireAnimation({
  attackerPos,
  defenderPos,
  cannons = 1,
  layout,
  canvasW,
  canvasH,
  onComplete,
}) {
  const canvasRef = useRef(null);
  const { animSpeed } = useAnimSpeed();
  const m = animSpeed / 3;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !attackerPos || !defenderPos) {
      onComplete();
      return;
    }

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasW * dpr;
    canvas.height = canvasH * dpr;
    ctx.scale(dpr, dpr);

    const { tileSize: ts, gridPad: gp } = layout;

    // Convert grid positions to pixel coordinates
    const ax = gp + attackerPos.col * ts + ts / 2;
    const ay = gp + attackerPos.row * ts + ts / 2;
    const dx = gp + defenderPos.col * ts + ts / 2;
    const dy = gp + defenderPos.row * ts + ts / 2;

    // Distance between attacker and defender
    const dist = Math.sqrt((dx - ax) ** 2 + (dy - ay) ** 2);
    const arcHeight = Math.max(ts * 0.8, dist * 0.3); // parabolic arc peak

    // Timing (all scaled by m)
    const muzzleEnd = 150 * m;
    const flightEnd = 700 * m;
    const impactEnd = 1100 * m;
    const totalDuration = 1500 * m;

    // Particle arrays
    const smokeParticles = [];
    const sparkParticles = [];

    const startTime = performance.now();
    let raf;

    function lerp(a, b, t) {
      return a + (b - a) * t;
    }

    function easeOutCubic(t) {
      return 1 - (1 - t) ** 3;
    }

    function easeInQuad(t) {
      return t * t;
    }

    function frame(now) {
      const elapsed = now - startTime;
      const progress = elapsed / totalDuration;

      ctx.clearRect(0, 0, canvasW, canvasH);

      // Semi-transparent backdrop (builds up then fades)
      const backdropAlpha = progress < 0.1
        ? progress / 0.1 * 0.2
        : progress > 0.8
          ? (1 - progress) / 0.2 * 0.2
          : 0.2;
      ctx.fillStyle = `rgba(0, 0, 0, ${backdropAlpha})`;
      ctx.fillRect(0, 0, canvasW, canvasH);

      // ── Phase 1: Muzzle Flash ──
      if (elapsed < muzzleEnd) {
        const flashT = elapsed / muzzleEnd;
        const flashSize = ts * (0.3 + easeOutCubic(flashT) * 0.5);
        const flashAlpha = 1 - flashT;

        // Bright muzzle flash
        const flashGrad = ctx.createRadialGradient(ax, ay, 0, ax, ay, flashSize);
        flashGrad.addColorStop(0, `rgba(255, 240, 150, ${flashAlpha})`);
        flashGrad.addColorStop(0.4, `rgba(255, 180, 50, ${flashAlpha * 0.8})`);
        flashGrad.addColorStop(1, `rgba(255, 100, 20, 0)`);
        ctx.fillStyle = flashGrad;
        ctx.beginPath();
        ctx.arc(ax, ay, flashSize, 0, Math.PI * 2);
        ctx.fill();

        // Muzzle smoke puff
        ctx.fillStyle = `rgba(180, 170, 150, ${flashAlpha * 0.5})`;
        ctx.beginPath();
        ctx.arc(ax, ay - ts * 0.1 * flashT, ts * 0.15 * (1 + flashT), 0, Math.PI * 2);
        ctx.fill();
      }

      // ── Phase 2: Cannonball Flight ──
      if (elapsed >= muzzleEnd * 0.5 && elapsed < flightEnd) {
        const flightElapsed = elapsed - muzzleEnd * 0.5;
        const flightDuration = flightEnd - muzzleEnd * 0.5;
        const t = Math.min(1, flightElapsed / flightDuration);
        const easedT = easeInQuad(t * 0.3) + t * 0.7; // slight acceleration feel

        // Parabolic arc: ball position
        const ballX = lerp(ax, dx, easedT);
        const ballY = lerp(ay, dy, easedT) - arcHeight * Math.sin(Math.PI * easedT);

        // Spawn smoke trail particles
        if (Math.random() < 0.7) {
          smokeParticles.push({
            x: ballX + (Math.random() - 0.5) * ts * 0.1,
            y: ballY + (Math.random() - 0.5) * ts * 0.1,
            vx: (Math.random() - 0.5) * 0.3,
            vy: -Math.random() * 0.5 - 0.2,
            size: ts * (0.04 + Math.random() * 0.06),
            life: 1,
            decay: 0.015 + Math.random() * 0.01,
          });
        }

        // Draw cannonball
        const ballRadius = ts * 0.07;
        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
        ctx.shadowBlur = ts * 0.08;
        ctx.shadowOffsetY = ts * 0.03;

        // Dark iron ball
        const ballGrad = ctx.createRadialGradient(
          ballX - ballRadius * 0.3, ballY - ballRadius * 0.3, 0,
          ballX, ballY, ballRadius
        );
        ballGrad.addColorStop(0, '#555');
        ballGrad.addColorStop(0.7, '#222');
        ballGrad.addColorStop(1, '#111');
        ctx.fillStyle = ballGrad;
        ctx.beginPath();
        ctx.arc(ballX, ballY, ballRadius, 0, Math.PI * 2);
        ctx.fill();

        // Specular highlight
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.beginPath();
        ctx.arc(ballX - ballRadius * 0.25, ballY - ballRadius * 0.25, ballRadius * 0.3, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
      }

      // ── Phase 3: Impact Explosion ──
      if (elapsed >= flightEnd && elapsed < impactEnd) {
        const impactT = (elapsed - flightEnd) / (impactEnd - flightEnd);

        // Spawn spark particles on first frame
        if (sparkParticles.length === 0) {
          const sparkCount = 10 + Math.floor(Math.random() * 6);
          for (let i = 0; i < sparkCount; i++) {
            const angle = (Math.PI * 2 * i) / sparkCount + (Math.random() - 0.5) * 0.5;
            const speed = ts * (0.02 + Math.random() * 0.03);
            sparkParticles.push({
              x: dx,
              y: dy,
              vx: Math.cos(angle) * speed,
              vy: Math.sin(angle) * speed,
              size: ts * (0.02 + Math.random() * 0.03),
              life: 1,
              decay: 0.02 + Math.random() * 0.015,
              color: Math.random() > 0.4 ? 'fire' : 'ember',
            });
          }
        }

        // Expanding explosion ring
        const ringRadius = ts * (0.15 + easeOutCubic(impactT) * 0.6);
        const ringAlpha = 1 - impactT;
        ctx.strokeStyle = `rgba(255, 180, 50, ${ringAlpha * 0.8})`;
        ctx.lineWidth = ts * 0.04 * (1 - impactT);
        ctx.beginPath();
        ctx.arc(dx, dy, ringRadius, 0, Math.PI * 2);
        ctx.stroke();

        // Inner explosion glow
        const glowSize = ts * (0.2 + easeOutCubic(impactT) * 0.3);
        const glowAlpha = (1 - impactT) * 0.9;
        const glowGrad = ctx.createRadialGradient(dx, dy, 0, dx, dy, glowSize);
        glowGrad.addColorStop(0, `rgba(255, 240, 200, ${glowAlpha})`);
        glowGrad.addColorStop(0.3, `rgba(255, 160, 50, ${glowAlpha * 0.7})`);
        glowGrad.addColorStop(0.6, `rgba(255, 80, 20, ${glowAlpha * 0.4})`);
        glowGrad.addColorStop(1, 'rgba(200, 50, 10, 0)');
        ctx.fillStyle = glowGrad;
        ctx.beginPath();
        ctx.arc(dx, dy, glowSize, 0, Math.PI * 2);
        ctx.fill();

        // Impact smoke
        ctx.fillStyle = `rgba(120, 110, 100, ${(1 - impactT) * 0.3})`;
        ctx.beginPath();
        ctx.arc(dx, dy - ts * 0.1 * impactT, ts * (0.15 + impactT * 0.2), 0, Math.PI * 2);
        ctx.fill();
      }

      // ── Phase 4: Smoke Clear / Fade ──
      if (elapsed >= impactEnd) {
        const fadeT = (elapsed - impactEnd) / (totalDuration - impactEnd);
        // Lingering smoke
        ctx.fillStyle = `rgba(100, 95, 85, ${(1 - fadeT) * 0.15})`;
        ctx.beginPath();
        ctx.arc(dx, dy - ts * 0.15, ts * (0.2 + fadeT * 0.15), 0, Math.PI * 2);
        ctx.fill();
      }

      // ── Update & Draw Smoke Particles ──
      for (let i = smokeParticles.length - 1; i >= 0; i--) {
        const p = smokeParticles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= p.decay;
        p.size *= 1.008; // slowly expand

        if (p.life <= 0) {
          smokeParticles.splice(i, 1);
          continue;
        }

        ctx.fillStyle = `rgba(160, 155, 140, ${p.life * 0.4})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── Update & Draw Spark Particles ──
      for (let i = sparkParticles.length - 1; i >= 0; i--) {
        const p = sparkParticles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.08; // gravity
        p.life -= p.decay;

        if (p.life <= 0) {
          sparkParticles.splice(i, 1);
          continue;
        }

        if (p.color === 'fire') {
          ctx.fillStyle = `rgba(255, ${Math.floor(150 + p.life * 100)}, 30, ${p.life})`;
        } else {
          ctx.fillStyle = `rgba(255, ${Math.floor(80 + p.life * 60)}, 10, ${p.life * 0.8})`;
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        ctx.fill();
      }

      // Continue or finish
      if (elapsed < totalDuration) {
        raf = requestAnimationFrame(frame);
      } else {
        onComplete();
      }
    }

    raf = requestAnimationFrame(frame);

    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [attackerPos, defenderPos, cannons, layout, canvasW, canvasH, m, onComplete]);

  if (!attackerPos || !defenderPos) return null;

  return (
    <canvas
      ref={canvasRef}
      className="cannon-fire-canvas"
      style={{
        width: `${canvasW}px`,
        height: `${canvasH}px`,
      }}
    />
  );
}
