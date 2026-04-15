# Plunder Development Session — April 14, 2026

This document provides context for continuing development in a new Claude session.

## What Was Done This Session

### 1. Flag/Sail Flutter Animation
- Canvas-rendered flags and ship sails now flutter with wind direction matching wave shimmer
- Uses `Date.now() * 0.0008` time base and `col * 0.5 + row * 0.3` phase for wind consistency
- Updated `drawOwnerFlag()` and `drawShip()` in `client/src/game/renderer.js`

### 2. Ship Movement Animation Upgrade
- Replaced the ⛵ emoji in `ShipMoveAnimation.jsx` with the actual rendered ship piece
- Ship rotates to point in travel direction via `Math.atan2(dx, -dy)`
- Draws hull, deck, mast, sail badges, cannon badges matching renderer's `drawShip` style
- File: `client/src/components/Game/ShipMoveAnimation.jsx`

### 3. Cannon Fire Animation
- Dramatic canvas-based cannon fire effect that plays BEFORE the combat dice overlay
- Phases: muzzle flash (0-150ms) → cannonball flight with parabolic arc (150-700ms) → impact explosion with sparks (700-1100ms) → smoke clear (1100-1500ms)
- All timing scaled by `animSpeed / 3`
- Particle system for smoke trail and spark particles
- File: `client/src/components/Game/CannonFireAnimation.jsx`
- Sequencing managed via `pendingCombatRef` in `GamePage.jsx`

### 4. Deck Shuffle Upgrade
- Upgraded existing shuffle overlay with pirate/treasure themed card backs
- Skull & crossbones, gold borders, corner gems
- Styles in `client/src/index.css`

### 5. Resource Collection Animation
- Visual feedback for resource draws with **privacy requirement**
- Only the receiving player sees what resources were drawn (actual resource types)
- Other players see only how many cards were drawn (generic card backs)
- Server-side: `socket.emit()` sends full details to caller, `socket.to(room).emit()` sends count only
- File: `client/src/components/Game/ResourceDrawAnimation.jsx`

### 6. "Lightening the Load" House Rule (COMPLETE)
New game mechanic: ships can jettison cannons for bonus movement.
- 1 cannon = +1 move, 2 cannons = +3 moves
- Bonus movement is per-ship only (not added to global pool)
- Selectable in game settings, on by default

**Files modified:**
- `shared/constants.js` — Added `JETTISON_CANNONS: 'jettison-cannons'` event
- `server/src/rooms.js` — Added `lightenTheLoad: true` default setting + validation
- `server/src/gameState.js` — Added `jettisonCannons()` function, updated `moveShip()` for bonus consumption, added `jettisonBonus: 0` to `createShip()`, reset in `endTurn()`
- `server/src/index.js` — Added JETTISON_CANNONS socket handler
- `client/src/components/Game/ActionPanel.jsx` — Added jettison buttons (conditional on setting, ship selection, cannon count, hasn't jettisoned yet), bonus move display in moves counter
- `client/src/components/Game/GameView.jsx` — Updated `getValidMoves()` call to include `ship.jettisonBonus`
- `client/src/components/Game/Lobby.jsx` — Added toggle switch for "Lightening the Load" setting

### 7. Homeserver Deployment Fix
- Removed `railway.toml` (migrated from Railway to homeserver)
- Fixed React Router `basename` for `/plunder/` path prefix in `client/src/main.jsx`
- The homeserver (Ubuntu, codenamed "Kamino") runs:
  - Caddy as reverse proxy (strips `/plunder` prefix before forwarding to Express)
  - Cron job every 5 minutes pulling from GitHub and rebuilding Docker
  - App served at `rohansagarwal.com/plunder/`

## Architecture Quick Reference

- **Frontend:** React + Vite, canvas-based board rendering with static/dynamic layer caching
- **Backend:** Node.js + Express + Socket.IO
- **Deployment:** Docker on Ubuntu homeserver, Caddy reverse proxy
- **Animation system:** CSS overlays positioned via percentage-based coordinates, `requestAnimationFrame` for canvas animations, `useAnimSpeed()` hook with `m = animSpeed / 3` multiplier

### Key Patterns
- Socket.IO privacy: `socket.emit()` = caller only, `socket.to(room).emit()` = everyone else
- Game settings flow: defined in `shared/constants.js` → stored in `server/src/rooms.js` → validated in `updateSettings()` → consumed in `server/src/gameState.js` → displayed in `Lobby.jsx`
- Action panel: buttons conditional on `turnPhase === 'perform_actions'`, emit pattern: `await emit(eventName, { shipId: selectedShip.id, ... })`
- Per-ship bonus: `jettisonBonus` field on ship object, consumed in `moveShip()` after global `movePointsRemaining`

### Important Files
| File | Purpose |
|------|---------|
| `shared/constants.js` | Events, phases, game constants |
| `server/src/rooms.js` | Room creation, settings management |
| `server/src/gameState.js` | Core game logic (~1900+ lines) |
| `server/src/index.js` | Socket event handlers |
| `client/src/game/renderer.js` | Canvas board renderer, BFS pathfinding |
| `client/src/components/Game/GamePage.jsx` | Central state management, animation orchestration |
| `client/src/components/Game/GameView.jsx` | Board canvas + all animation overlays |
| `client/src/components/Game/ActionPanel.jsx` | Player action UI (build, trade, jettison, etc.) |
| `client/src/components/Game/Lobby.jsx` | Pre-game lobby with settings |
| `client/src/hooks/useSocket.js` | Socket.IO client connection |
