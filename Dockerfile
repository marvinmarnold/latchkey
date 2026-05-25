FROM oven/bun:1-alpine AS base
WORKDIR /app

# Install dependencies — separate layer so it caches unless lockfile changes
COPY package.json bun.lock ./
COPY packages/proxy/package.json ./packages/proxy/
RUN bun install --frozen-lockfile --production

# Copy source
COPY packages/proxy/src ./packages/proxy/src

# SQLite data directory — mount a volume here for persistence
RUN mkdir -p /app/data && chown -R bun:bun /app/data

EXPOSE 3000

ENV PORT=3000
ENV DB_PATH=/app/data/colosseum.db
ENV NODE_ENV=production

USER bun

CMD ["bun", "run", "packages/proxy/src/index.ts"]
