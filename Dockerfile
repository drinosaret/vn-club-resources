# VN Club Frontend Dockerfile
# Multi-stage build for optimized production image

# Stage 1: Dependencies
# Pin to specific Node.js version for reproducible builds and security
FROM node:20.11.1-alpine3.19 AS deps
WORKDIR /app

# Install dependencies needed for native modules
RUN apk add --no-cache libc6-compat

COPY package.json package-lock.json ./
RUN npm ci

# Stage 2: Builder
FROM node:20.11.1-alpine3.19 AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build arguments for environment variables needed at build time
ARG NEXT_PUBLIC_VNDB_STATS_API
ARG NEXT_PUBLIC_API_URL

ENV NEXT_PUBLIC_VNDB_STATS_API=$NEXT_PUBLIC_VNDB_STATS_API
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# Stage 3: Runner
FROM node:20.11.1-alpine3.19 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Install wget for Docker health checks
RUN apk add --no-cache wget

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built application
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Create cache directory for VNDB images (mount as Docker volume for persistence)
# Set VNDB_CACHE_DIR to keep image cache outside the app tree.
# Docker-compose mounts a named volume here for persistence across deploys.
ENV VNDB_CACHE_DIR=/data/vndb-cache
RUN mkdir -p /data/vndb-cache && chown -R nextjs:nodejs /data/vndb-cache

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
