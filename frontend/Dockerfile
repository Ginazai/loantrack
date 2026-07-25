# ── Stage 1: build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

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

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy our custom config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost/health || exit 1

CMD ["nginx", "-g", "daemon off;"]