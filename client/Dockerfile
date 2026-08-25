FROM oven/bun:1.2-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json* bun.lock* ./
RUN bun install --frozen-lockfile || bun install

FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG HOG_URL=http://hog:8787
ENV HOG_URL=$HOG_URL
# NEXT_PUBLIC_* vars are inlined into the client bundle at build time.
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=""
ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
