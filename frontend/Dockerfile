# ── Stage 1: build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Vite bakes VITE_* vars into the JS bundle at build time — must be an ARG, not a runtime ENV.
# Set VITE_API_BASE_URL in Railway as a build variable (not a service env var).
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

# Copy package files first for layer caching
COPY package.json package-lock.json* ./

# --mount=type=cache persists the npm cache across builds (requires BuildKit, enabled by default in Docker 23+)
# --no-audit --no-fund skip extra network roundtrips that aren't needed in CI/Docker
# Switch to `npm ci` once you have a committed package-lock.json
#RUN --mount=type=cache,target=/root/.npm \
#    npm install --no-audit --no-fund
RUN npm install --no-audit --no-fund

COPY . .

RUN npm run build

# ── Stage 2: serve with nginx ─────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

# nginx:1.27 runs every *.template file in /etc/nginx/templates/ through
# envsubst automatically at container start (before nginx itself starts),
# writing the result to /etc/nginx/conf.d/<name without .template>. This is
# what lets BACKEND_URL be a runtime env var instead of something baked into
# the image at build time — same image works unchanged behind docker-compose
# (BACKEND_URL defaults to the "backend" service name below) or split across
# separate hosts/platforms (override BACKEND_URL with the backend's public URL,
# no rebuild required). See nginx.conf.template for what gets proxied and why.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# Default for docker-compose, where "backend" resolves via Docker's embedded
# DNS on the shared network. Override at `docker run`/compose/platform level
# for any deployment where frontend and backend aren't on the same network.
ENV BACKEND_URL=http://backend:8000

# Copy built assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost/health || exit 1

CMD ["nginx", "-g", "daemon off;"]