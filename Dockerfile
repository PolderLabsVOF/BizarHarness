# ── Bizar Dashboard — multi-stage Docker build ──────────────────────────────
#
# Stage 1: Build the dashboard (Vite React SPA + TypeScript SDK)
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

# Stage 2: Production runtime
FROM node:22-alpine AS runtime
ENV BIZAR_SKIP_INSTALL=1
WORKDIR /app

# Runtime dependencies: git for memory sync, python3 for graphify/browser-harness
RUN apk add --no-cache git python3 py3-pip

# Install production dependencies first (layer caching)
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Copy build artifacts and runtime assets
COPY --from=builder /app/bizar-dash/dist ./dist
COPY --from=builder /app/bizar-dash ./bizar-dash
COPY plugins ./plugins
COPY cli ./cli
COPY config ./config
COPY templates ./templates
COPY install.sh ./
RUN chmod +x install.sh

# Runtime environment defaults
ENV BIZAR_HOME=/home/bizar/.config/bizar
ENV BIZAR_DASHBOARD_PORT=4097
ENV BIZAR_DASHBOARD_BIND=0.0.0.0
ENV NODE_ENV=production

# Dashboard HTTP port + WebSocket port
EXPOSE 4097
EXPOSE 4098

# Healthcheck — hits the public v2 health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4097/api/v2/health || exit 1

# Default: start the dashboard on all interfaces
CMD ["node", "cli/bin.mjs", "dash", "start", "--port", "4097", "--host", "0.0.0.0"]
