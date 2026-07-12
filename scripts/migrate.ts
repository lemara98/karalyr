import "./load-env";
import { mkdirSync } from "node:fs";
import { migrate } from "drizzle-orm/libsql/migrator";
import { getDb } from "../lib/db/client";

async function main() {
  const url = process.env.DATABASE_URL ?? "file:./data/karalyr.db";
  if (url.startsWith("file:")) {
    // Ensure the directory for the SQLite file exists.
    const path = url.slice("file:".length);
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".";
    mkdirSync(dir, { recursive: true });
  }
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
  console.log("Migrations applied.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
