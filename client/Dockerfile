FROM oven/bun:1.2-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json* bun.lock* ./
RUN bun install --frozen-lockfile || bun install

FROM oven/bun:1.2-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG HOG_URL=http://hog:8787
ENV HOG_URL=$HOG_URL
ENV NEXT_TELEMETRY_DISABLED=1

RUN bun run build

FROM oven/bun:1.2-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["bun", "server.js"]
