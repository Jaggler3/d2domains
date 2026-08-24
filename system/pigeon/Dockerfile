FROM oven/bun:1.2-slim
WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install

COPY . .

CMD ["bun", "run", "src/index.ts"]