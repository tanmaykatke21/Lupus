// Tiger Data (Postgres/TimescaleDB). Optional: features degrade when DATABASE_URL is unset.
import postgres from "postgres";

let sql: postgres.Sql | null = null;

export const dbConfigured = () => !!process.env.DATABASE_URL;

export function db() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  // One connection per serverless instance; prepare:false keeps poolers happy.
  sql ??= postgres(process.env.DATABASE_URL, { max: 1, prepare: false, idle_timeout: 20, connect_timeout: 8 });
  return sql;
}
