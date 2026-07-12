import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";

export type Db = LibSQLDatabase<typeof schema> & { $client: Client };

// Reuse one client across dev hot reloads / route handler invocations.
const globalForDb = globalThis as unknown as { __karalyrDb?: Db };

export function getDb(): Db {
  if (!globalForDb.__karalyrDb) {
    const url = process.env.DATABASE_URL ?? "file:./data/karalyr.db";
    const authToken = process.env.DATABASE_AUTH_TOKEN || undefined;
    const client = createClient({ url, authToken });
    globalForDb.__karalyrDb = drizzle(client, { schema });
  }
  return globalForDb.__karalyrDb;
}

/** Build a throwaway in-memory database (used by tests). */
export function createTestDb(): Db {
  const client = createClient({ url: ":memory:" });
  return drizzle(client, { schema });
}
