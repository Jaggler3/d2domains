import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { loadEnv } from "../config/env";

const env = loadEnv();

export const sql = postgres(env.OTTER_DATABASE_URL, { max: 10 });

export const db = drizzle(sql, { schema });
