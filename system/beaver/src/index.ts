import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";

const REDIS_URL = Bun.env.REDIS_URL ?? "redis://localhost:6379";

mkdirSync("./data", { recursive: true });
const db = new Database("./data/beaver.db");
db.exec("PRAGMA journal_mode = WAL;");
db.exec(`
  CREATE TABLE IF NOT EXISTS search_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    keyword TEXT NOT NULL,
    result_count INTEGER NOT NULL,
    cached INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
`);

const insertSearchLog = db.prepare(
  "INSERT INTO search_logs (user_id, keyword, result_count, cached, created_at) VALUES (?, ?, ?, ?, ?)",
);

const connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

const worker = new Worker(
  "domains-jobs",
  async (job) => {
    if (job.name !== "search-log") return;
    const { userId, keyword, resultCount, cached } = job.data as {
      userId: string;
      keyword: string;
      resultCount: number;
      cached: boolean;
    };
    insertSearchLog.run(
      userId,
      keyword,
      resultCount,
      cached ? 1 : 0,
      new Date().toISOString(),
    );
    console.log(
      `[beaver] search-log: "${keyword}" -> ${resultCount} results (cached=${cached})`,
    );
  },
  { connection, concurrency: 5 },
);

worker.on("failed", (job, err) => {
  console.error(`[beaver] job ${job?.id ?? "?"} failed:`, err);
});

async function shutdown() {
  await worker.close();
  connection.disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("beaver (queue worker) consuming from queue: domains-jobs");
