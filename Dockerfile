# =============================================================================
#  Plunder: A Pirate's Life — Docker Build
# =============================================================================
#  Multi-stage build:
#    Stage 1 (builder): Install all deps + build the Vite React frontend
#    Stage 2 (production): Copy only what's needed to run the Express server
#
#  The Express server serves both the Socket.IO API and the built React
#  frontend as static files, all on a single port (3001).
# =============================================================================

# --- Stage 1: Build ----------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Copy workspace root files
COPY package.json package-lock.json ./

# Copy workspace package.json files so npm can resolve workspaces
COPY client/package.json client/
COPY server/package.json server/
COPY shared/package.json shared/

# Install all dependencies (including devDependencies for the Vite build)
RUN npm ci

# Copy all source code
COPY . .

# Build the React frontend (outputs to client/dist/)
RUN npm run build

# --- Stage 2: Production -----------------------------------------------------
FROM node:20-alpine

WORKDIR /app

# Copy workspace root files
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY shared/package.json shared/
COPY client/package.json client/

# Install production dependencies only
RUN npm ci --omit=dev

# Copy server source
COPY server/ server/

# Copy shared constants
COPY shared/ shared/

# Copy the built frontend from the builder stage
COPY --from=builder /app/client/dist client/dist

# Run as non-root user for security
USER node

EXPOSE 3001

CMD ["npm", "start"]
