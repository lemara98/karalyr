import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";

export type Db = LibSQLDatabase<typeof schema> & { $client: Client };

// Reuse one client across dev hot reloads / route handler invocations.
const globalForDb = globalThis as unknown as { __karalyrDb?: Db };

export function getDb(): Db {
  if (!globalForDb.__karalyrDb) {
    const url = process.env.DATABASE_URL ?? "file:./data/karalyr.db";
    // The local-file default is right for dev and useless on a hosted deploy:
    // the file is not in the bundle and the filesystem is read-only, so every
    // query fails somewhere deep in a page render and surfaces as an opaque
    // "server-side exception ... Digest: NNN". Say what is actually wrong.
    if (process.env.NODE_ENV === "production" && url.startsWith("file:")) {
      throw new Error(
        "DATABASE_URL is not set for this deployment. Production needs a libsql:// URL " +
          "plus DATABASE_AUTH_TOKEN — a local SQLite file cannot work on a serverless host. " +
          "Check the variable is enabled for this environment (Production vs Preview) and redeploy."
      );
    }
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
