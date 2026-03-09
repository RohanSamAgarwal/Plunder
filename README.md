# 🏴‍☠️ Plunder: A Pirate's Life — Online Multiplayer

A faithful digital adaptation of the board game "Plunder: A Pirate's Life" supporting 2–6 players online. Each player connects from their own browser — no accounts needed.

## Quick Start

### Prerequisites
- Node.js 18+
- npm

### Local Development

```bash
# Install all dependencies
npm install
cd client && npm install
cd ../server && npm install
cd ..

# Run both client and server in dev mode
npm run dev
```

- **Frontend**: http://localhost:5173
- **Backend**: http://localhost:3001
- Vite proxies Socket.IO and API requests to the backend automatically

### How to Play (locally)

1. Open http://localhost:5173 in your browser
2. Enter a pirate name and click **Create Game**
3. Share the invite link or room code with friends
4. Friends open the link and enter their names
5. Host clicks **Set Sail!** to start

## Deploying to Railway

1. Push this repo to GitHub
2. Create a new project on [Railway](https://railway.app)
3. Connect your GitHub repo
4. Railway auto-detects the `railway.json` config
5. Deploy! Railway provides a public URL

The app is configured as a single service — Express serves both the API/WebSocket server and the built React frontend.

### Environment Variables
- `PORT` — Set automatically by Railway
- `NODE_ENV` — Set to `production` for deployment

## Project Structure

```
plunder/
├── client/                 # React frontend (Vite)
│   ├── src/
│   │   ├── components/
│   │   │   ├── Game/       # Game views (board, actions, chat)
│   │   │   └── Lobby/      # Home page, room join
│   │   ├── game/
│   │   │   └── renderer.js # Canvas board renderer
│   │   └── hooks/
│   │       └── useSocket.js
│   └── package.json
├── server/                 # Node.js backend
│   ├── src/
│   │   ├── index.js        # Express + Socket.IO server
│   │   ├── rooms.js        # Room management
│   │   ├── gameState.js    # Core game logic
│   │   ├── board.js        # Board generation
│   │   └── decks.js        # Resource & treasure decks
│   └── package.json
├── shared/
│   └── constants.js        # Shared types & constants
├── railway.json            # Railway deploy config
└── DESIGN.md               # Full design document
```

## Game Features

### Implemented (Phase 1)
- ✅ Room creation with invite links
- ✅ Lobby with player color picker + chat
- ✅ Modular board generation (6 shuffled panels)
- ✅ Canvas-based board rendering
- ✅ Starting island selection

### Implemented (Phase 2)
- ✅ Turn system (draw → roll → actions → end)
- ✅ Ship movement with pathfinding
- ✅ Resource drawing
- ✅ Sailing die + storm movement

### Implemented (Phase 3)
- ✅ Building (ships, cannons, masts, life pegs, plunder points)
- ✅ Island combat
- ✅ Ship-to-ship combat
- ✅ Treasure tokens
- ✅ Plunder point tracking + win condition

### Implemented (Phase 4)
- ✅ Player-to-player trading
- ✅ In-game chat
- ✅ Trade proposals (accept/decline)

### Implemented (Phase 5)
- ✅ Attack bribe system (honor + ruthless modes)
- ✅ Visual overhaul (board rendering, ship icons, edge wall barriers)
- ✅ Treasure cards displayed to all players with dismiss popup
- ✅ Treasure deck auto-reshuffle with 5-second card animation
- ✅ Tabbed sidebar (Controls / Chat & Log) with unread message badge
- ✅ Top bar plunder points leaderboard with player names, sorted by score
- ✅ Configurable win points (0-99) in lobby settings

### Implemented (Phase 6)
- ✅ Board overlay animations for combat, trades, and building events
- ✅ Trade knowledge setting (open / selective / hidden) configurable in lobby
- ✅ Storm toll cancel move option
- ✅ Organic island shapes (smooth outlines with Bezier curves, replacing grid squares)
- ✅ Water depth gradients (shallow turquoise near islands → deep blue in open ocean)
- ✅ Shore rings and beach edges around islands
- ✅ Subtle dashed grid lines on water only

### To Do
- 🔲 Ships need clearer visuals for masts/cannons/lives
- 🔲 Add zoom in/out for board

## Tech Stack
- **Frontend**: React 18, Vite, Tailwind CSS, HTML5 Canvas
- **Backend**: Node.js, Express, Socket.IO
- **Deploy**: Railway (single service)
- **State**: Server-authoritative in-memory game state
